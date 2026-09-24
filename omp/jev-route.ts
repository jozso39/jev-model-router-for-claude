/**
 * Jev router for omp: before each user turn, ask Jev (TypeSafe's System One decision model,
 * served through OpenRouter) which Claude tier can finish the request in one pass, and switch
 * the session model to it. Mirrors the policy of jev-router (github.com/gargpratyush/jev-router)
 * for Claude Code, but as a native omp extension: no proxy, the model switch goes through
 * `pi.setModel`, so omp's own cost tracking, caching and UI stay truthful.
 *
 * Fail-open: any Jev failure keeps the current model. `/jev` toggles routing, `/jev status`
 * shows the last decision. "use opus" / "use haiku" / "use sonnet" in a prompt wins over Jev.
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type TierName = "haiku" | "sonnet" | "opus";

interface Tier {
	name: TierName;
	spec: string;
	what: string;
	signals: string[];
	not_for: string;
}

/** Cheapest first. Override specs with JEV_OMP_TIERS="haiku=provider/id,sonnet=...,opus=...". */
const TIERS: Tier[] = [
	{
		name: "haiku",
		spec: "openrouter/anthropic/claude-haiku-4.5",
		what: "Trivial, mechanical, or purely factual work.",
		signals: ["Rename, reformat, comment, or run one obvious command", "Answer a direct question"],
		not_for: "Design judgement or multi-file reasoning.",
	},
	{
		name: "sonnet",
		spec: "openrouter/anthropic/claude-sonnet-5",
		what: "Ordinary day-to-day engineering with a clear, bounded shape.",
		signals: ["Implement a specified function, test existing behaviour, or fix an understood local bug"],
		not_for: "Open-ended architecture, subtle concurrency, or unknown-cause debugging.",
	},
	{
		name: "opus",
		spec: "openrouter/anthropic/claude-opus-5",
		what: "Hard reasoning, ambiguity, or high blast radius.",
		signals: ["Unknown-cause debugging, cross-module design, security, auth, concurrency, or migrations"],
		not_for: "Routine work with a clear implementation.",
	},
];

const JEV_URL = "https://openrouter.ai/api/v1/systemone";
const JEV_MODEL = process.env.JEV_MODEL ?? "typesafe/jev-1.13";
/** Below this confidence Jev may not downgrade, and upgrades stop at sonnet. */
const MIN_CONFIDENCE = 0.3;
const DEADLINE_MS = 3000;

const OVERRIDES: Array<{ tier: TierName; re: RegExp }> = [
	{ tier: "haiku", re: /\b(?:use|switch to|with|on)\s+(?:haiku|fast)\b/i },
	{ tier: "sonnet", re: /\b(?:use|switch to|with|on)\s+(?:sonnet|balanced)\b/i },
	{ tier: "opus", re: /\b(?:use|switch to|with|on)\s+(?:opus|strong)\b/i },
];

const rank = (name: TierName) => TIERS.findIndex((t) => t.name === name);

function applyTierOverrides(): void {
	const raw = process.env.JEV_OMP_TIERS;
	if (!raw) return;
	for (const pair of raw.split(",")) {
		const [name, spec] = pair.split("=").map((s) => s.trim());
		const tier = TIERS.find((t) => t.name === name);
		if (tier && spec) tier.spec = spec;
	}
}

/** The OpenRouter key: the environment first, then the file shared with jev-claude. */
function openrouterKey(): string | undefined {
	const fromEnv = process.env.OPENROUTER_API_KEY?.trim();
	if (fromEnv) return fromEnv;
	try {
		const text = readFileSync(join(homedir(), ".jev-router.env"), "utf8");
		const line = text.split("\n").find((l) => l.startsWith("OPENROUTER_API_KEY="));
		return line?.slice("OPENROUTER_API_KEY=".length).trim().replace(/^["']|["']$/g, "") || undefined;
	} catch {
		return undefined;
	}
}

/** Which tier a session model belongs to, by id substring, or undefined for a non-Claude model. */
function tierOf(model: { id: string } | undefined): TierName | undefined {
	if (!model) return undefined;
	return TIERS.find((t) => model.id.includes(t.name))?.name;
}

interface JevAnswer {
	choice: TierName;
	confidence: number;
	probabilities: Record<string, number>;
	ms: number;
}

async function askJev(prompt: string, current: string | undefined, key: string): Promise<JevAnswer | null> {
	const started = Date.now();
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), DEADLINE_MS);
	try {
		const res = await fetch(JEV_URL, {
			method: "POST",
			signal: abort.signal,
			headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
			body: JSON.stringify({
				model: JEV_MODEL,
				state: { request: prompt, session: { current_model: current ?? "unknown" } },
				questions: {
					model: {
						type: "choice",
						instructions: [
							"Pick the cheapest model tier that can fully complete this coding request in one pass, without retrying on a stronger model.",
							"Judge required reasoning, not requested reply length.",
						],
						criteria: Object.fromEntries(
							TIERS.map((t) => [t.name, { model: t.spec, what: t.what, signals: t.signals, not_for: t.not_for }]),
						),
					},
				},
			}),
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
		const data = (await res.json()) as { answers: { model: { choice: TierName; confidence: number; probabilities: Record<string, number> } } };
		const answer = data.answers.model;
		return { choice: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities, ms: Date.now() - started };
	} finally {
		clearTimeout(timer);
	}
}

export default function (pi: ExtensionAPI) {
	applyTierOverrides();
	pi.setLabel("Jev router");
	const key = openrouterKey();
	let enabled = Boolean(key);
	/** provider/id the router last set, to notice when the user picks a model themselves. */
	let lastSet: string | undefined;
	let last: { tier: TierName; reason: string; confidence?: number; ms?: number; prompt: string } | undefined;

	const say = (ctx: ExtensionContext, text: string, level: "info" | "warning" = "info") => {
		pi.logger.info(`[jev] ${text}`);
		if (ctx.hasUI) ctx.ui.notify(`jev: ${text}`, level);
	};

	if (!key) pi.logger.warn("[jev] no OPENROUTER_API_KEY in the environment or ~/.jev-router.env; routing disabled");

	pi.on("before_agent_start", async (event, ctx) => {
		if (!enabled || !key) return;
		const prompt = event.prompt?.trim();
		if (!prompt) return;

		const current = ctx.models.current();
		const currentKey = current ? `${current.provider}/${current.id}` : undefined;
		// The user changed the model since we last set it: their choice beats the router until /jev on.
		if (lastSet && currentKey && currentKey !== lastSet) {
			enabled = false;
			lastSet = undefined;
			say(ctx, `paused, you picked ${currentKey} yourself (/jev on to resume)`, "warning");
			return;
		}

		const currentTier = tierOf(current);
		let target: TierName;
		let reason: string;
		let confidence: number | undefined;
		let ms: number | undefined;

		const override = OVERRIDES.find((o) => o.re.test(prompt));
		if (override) {
			target = override.tier;
			reason = "override";
		} else {
			let jev: JevAnswer | null = null;
			try {
				jev = await askJev(prompt, currentKey, key);
			} catch (err) {
				pi.logger.warn(`[jev] routing failed, keeping ${currentKey}: ${(err as Error).message}`);
				return;
			}
			if (!jev) return;
			confidence = jev.confidence;
			ms = jev.ms;
			target = jev.choice;
			reason = "jev";
			if (currentTier && jev.confidence < MIN_CONFIDENCE) {
				if (rank(target) < rank(currentTier)) {
					target = currentTier;
					reason = "low-confidence-no-downgrade";
				} else if (rank(target) > Math.max(rank(currentTier), rank("sonnet"))) {
					target = "sonnet";
					reason = "low-confidence-capped";
				}
			}
		}

		const tier = TIERS.find((t) => t.name === target)!;
		const model = ctx.models.resolve(tier.spec);
		if (!model) {
			pi.logger.warn(`[jev] ${tier.spec} is not available in this session; keeping ${currentKey}`);
			return;
		}
		const modelKey = `${model.provider}/${model.id}`;
		last = { tier: target, reason, confidence, ms, prompt: prompt.slice(0, 80) };
		if (modelKey === currentKey) {
			lastSet = modelKey;
			pi.logger.info(`[jev] ${target} unchanged (${reason}${confidence !== undefined ? ` p=${confidence.toFixed(2)}` : ""})`);
			return;
		}
		const ok = await pi.setModel(model);
		if (!ok) {
			pi.logger.warn(`[jev] could not switch to ${modelKey} (no credentials?)`);
			return;
		}
		lastSet = modelKey;
		say(ctx, `${currentTier ?? current?.id ?? "?"} → ${target} (${reason}${confidence !== undefined ? ` p=${confidence.toFixed(2)}` : ""}${ms !== undefined ? ` ${ms}ms` : ""})`);
	});

	pi.registerCommand("jev", {
		description: "Jev per-turn model routing: /jev [on|off|status]",
		handler: async (args, ctx) => {
			const word = (args ?? "").trim().toLowerCase();
			if (word === "on") {
				if (!key) return say(ctx, "no OpenRouter key, cannot enable", "warning");
				enabled = true;
				lastSet = undefined;
				return say(ctx, "routing on");
			}
			if (word === "off") {
				enabled = false;
				return say(ctx, "routing off");
			}
			const state = enabled ? "on" : "off";
			const detail = last
				? `last: ${last.tier} (${last.reason}${last.confidence !== undefined ? ` p=${last.confidence.toFixed(2)}` : ""}) for "${last.prompt}"`
				: "no decision yet";
			say(ctx, `routing ${state}; tiers ${TIERS.map((t) => `${t.name}=${t.spec}`).join(", ")}; ${detail}`);
		},
	});
}
