// Where Jev requests go. Jev is served both by TypeSafe directly and by OpenRouter, which
// exposes the same System One wire format under its own host, so the only differences are
// the base URL, the credential, and the model id (OpenRouter namespaces it as
// `typesafe/jev-...`). Everything here is resolved from the environment so the rest of the
// router never has to know which one is in use.

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api";
/** Pinned rather than `~typesafe/jev-latest` so routing behaviour does not shift under a release. */
export const OPENROUTER_MODEL = "typesafe/jev-1.13";
export const TYPESAFE_MODEL = "jev-latest";

const trimmed = (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/**
 * The Jev backend the environment describes, or null when no credential is present.
 *
 * `JEV_API_KEY` / `TYPESAFE_API_KEY` select TypeSafe directly; `OPENROUTER_API_KEY` alone
 * selects OpenRouter. When both are set TypeSafe wins, because an OpenRouter key is often in
 * the environment for unrelated tools; `JEV_PROVIDER=openrouter` forces OpenRouter anyway.
 * `JEV_BASE_URL` and `JEV_MODEL` override either backend's defaults, for gateways.
 *
 * @returns {?{provider: "typesafe"|"openrouter", apiKey: string, baseURL?: string, model: string}}
 */
export function resolveBackend(env = process.env) {
  const typesafeKey = trimmed(env.JEV_API_KEY) ?? trimmed(env.TYPESAFE_API_KEY);
  const openrouterKey = trimmed(env.OPENROUTER_API_KEY);
  const forced = trimmed(env.JEV_PROVIDER)?.toLowerCase();

  let provider;
  if (forced === "openrouter" || forced === "typesafe") provider = forced;
  else if (typesafeKey) provider = "typesafe";
  else if (openrouterKey) provider = "openrouter";
  else return null;

  // A forced provider still accepts the other variable's key: people do put an OpenRouter
  // key into JEV_API_KEY, and refusing it would only produce a confusing "no key" message.
  const apiKey =
    provider === "openrouter" ? (openrouterKey ?? typesafeKey) : (typesafeKey ?? openrouterKey);
  if (!apiKey) return null;

  const openrouter = provider === "openrouter";
  return {
    provider,
    apiKey,
    // Left undefined for TypeSafe so the SDK applies its own default.
    baseURL:
      trimmed(env.JEV_BASE_URL) ??
      trimmed(env.TYPESAFE_BASE_URL) ??
      (openrouter ? OPENROUTER_BASE_URL : undefined),
    model:
      trimmed(env.JEV_MODEL) ??
      trimmed(env.TYPESAFE_DEFAULT_MODEL) ??
      (openrouter ? OPENROUTER_MODEL : TYPESAFE_MODEL),
  };
}

/** Whether routing can be enabled at all. */
export const hasJevKey = (env = process.env) => resolveBackend(env) !== null;

/** One line naming the backend, for startup and debug output. Never includes the key. */
export const describeBackend = (backend) =>
  backend ? `${backend.provider} (${backend.baseURL ?? "default"}, ${backend.model})` : "none";

/** The hint printed when no credential is found. */
export const NO_KEY_HINT = "JEV_API_KEY=... (TypeSafe) or OPENROUTER_API_KEY=... (OpenRouter)";
