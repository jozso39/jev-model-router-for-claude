# Jev per-turn model routing for oh-my-pi (`jev-route` extension)

[oh-my-pi](https://github.com/can1357/oh-my-pi) (omp) is a terminal coding agent.

omp already uses Jev (TypeSafe's System One decision model) for its small typed decisions
through the `judge` role: the `auto` thinking-level classifier, unexpected-stop detection,
git staging and `judge()` in eval. What it does not do out of the box is pick the **main
chat model** per turn. `omp/jev-route.ts` in this repository adds that.

Before each user turn the extension sends the prompt to Jev on OpenRouter
(`typesafe/jev-1.13`, `POST https://openrouter.ai/api/v1/systemone`) with one choice
question over three tiers (haiku, sonnet, opus) and switches the session model with
`pi.setModel` to the cheapest tier Jev says can finish the request in one pass. A decision
costs about $0.00004 and 0.4–0.9 s.

## Install

```bash
cp omp/jev-route.ts ~/.omp/agent/extensions/
```

Credential: `OPENROUTER_API_KEY` in the environment, or an `OPENROUTER_API_KEY=` line in
`~/.jev-router.env` (shared with `jev-claude` from this repository). No TypeSafe account is needed.

Recommended `~/.omp/agent/config.yml` so every role is on OpenRouter and Jev is the judge:

```yaml
modelRoles:
  default: openrouter/anthropic/claude-opus-5
  smol: openrouter/anthropic/claude-haiku-4.5
  slow: openrouter/anthropic/claude-opus-5:high
  plan: openrouter/anthropic/claude-opus-5
  commit: openrouter/anthropic/claude-haiku-4.5
  task: openrouter/anthropic/claude-sonnet-5
  judge: openrouter/typesafe/jev-1.13
defaultThinkingLevel: auto
```

## Policy

- `use opus` / `use sonnet` / `use haiku` (also `strong`, `balanced`, `fast`) in the prompt
  wins over Jev.
- Confidence below 0.3 never downgrades and caps upgrades at sonnet.
- Any Jev failure or timeout (3 s) keeps the current model. Routing never blocks a turn.
- Picking a model yourself with `/model` pauses routing; `/jev on` resumes it.
- `/jev`, `/jev status`, `/jev off`, `/jev on`.
- `JEV_OMP_TIERS="haiku=provider/id,sonnet=provider/id,opus=provider/id"` remaps the tiers,
  `JEV_MODEL` picks another Jev release (`~typesafe/jev-latest` tracks the newest).

Decisions are logged as `[jev] opus → haiku (jev p=0.98 901ms)` in omp's log file and shown
as a notification in the TUI.

## Limitations

- Switching models drops the provider prompt cache for the conversation; there is no
  context-size guard yet, unlike jev-router's `downgradeMaxContextTokens`.
- Subagents (`task`) are not routed by this extension; use `modelRoles.task` or a
  `before_subagent_spawn` handler.
