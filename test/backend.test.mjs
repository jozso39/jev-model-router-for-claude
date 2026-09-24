import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveBackend,
  hasJevKey,
  describeBackend,
  OPENROUTER_BASE_URL,
  OPENROUTER_MODEL,
  TYPESAFE_MODEL,
} from "../src/backend.mjs";

test("no credential means no backend", () => {
  assert.equal(resolveBackend({}), null);
  assert.equal(resolveBackend({ OPENROUTER_API_KEY: "   " }), null);
  assert.equal(hasJevKey({}), false);
});

test("a TypeSafe key selects TypeSafe with the SDK defaults", () => {
  const backend = resolveBackend({ JEV_API_KEY: "ts-key" });
  assert.deepEqual(backend, { provider: "typesafe", apiKey: "ts-key", baseURL: undefined, model: TYPESAFE_MODEL });
  assert.equal(resolveBackend({ TYPESAFE_API_KEY: "ts-key" }).provider, "typesafe");
});

test("an OpenRouter key alone selects OpenRouter with its host and namespaced model", () => {
  const backend = resolveBackend({ OPENROUTER_API_KEY: "or-key" });
  assert.deepEqual(backend, {
    provider: "openrouter",
    apiKey: "or-key",
    baseURL: OPENROUTER_BASE_URL,
    model: OPENROUTER_MODEL,
  });
  assert.equal(hasJevKey({ OPENROUTER_API_KEY: "or-key" }), true);
});

test("TypeSafe wins when both keys are present unless OpenRouter is forced", () => {
  const both = { JEV_API_KEY: "ts-key", OPENROUTER_API_KEY: "or-key" };
  assert.equal(resolveBackend(both).provider, "typesafe");
  assert.equal(resolveBackend(both).apiKey, "ts-key");
  const forced = resolveBackend({ ...both, JEV_PROVIDER: "openrouter" });
  assert.equal(forced.provider, "openrouter");
  assert.equal(forced.apiKey, "or-key");
  assert.equal(forced.baseURL, OPENROUTER_BASE_URL);
});

test("a forced provider accepts the other variable's key", () => {
  const backend = resolveBackend({ JEV_API_KEY: "or-key-in-wrong-var", JEV_PROVIDER: "openrouter" });
  assert.equal(backend.provider, "openrouter");
  assert.equal(backend.apiKey, "or-key-in-wrong-var");
  assert.equal(resolveBackend({ JEV_PROVIDER: "openrouter" }), null);
});

test("base URL and model overrides apply to either backend", () => {
  const backend = resolveBackend({
    OPENROUTER_API_KEY: "or-key",
    JEV_BASE_URL: "http://gateway:4000",
    JEV_MODEL: "~typesafe/jev-latest",
  });
  assert.equal(backend.baseURL, "http://gateway:4000");
  assert.equal(backend.model, "~typesafe/jev-latest");
  const legacy = resolveBackend({ JEV_API_KEY: "ts-key", TYPESAFE_BASE_URL: "http://gw", TYPESAFE_DEFAULT_MODEL: "jev-preview" });
  assert.equal(legacy.baseURL, "http://gw");
  assert.equal(legacy.model, "jev-preview");
});

test("the backend description never includes the key", () => {
  const text = describeBackend(resolveBackend({ OPENROUTER_API_KEY: "sk-or-secret" }));
  assert.match(text, /openrouter/);
  assert.doesNotMatch(text, /secret/);
  assert.equal(describeBackend(null), "none");
});
