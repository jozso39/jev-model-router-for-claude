#!/usr/bin/env node
// Standalone routing proxy, for Claude Code processes that jev-claude cannot wrap: a
// `claude remote-control` service, an IDE extension, or anything started by a supervisor.
// Run it once (e.g. as a systemd user service) on a fixed port, then give those processes
// the environment printed below. Routing behaviour is identical to jev-claude.
import { homedir } from "node:os";
import { join } from "node:path";
import { startProxy } from "../src/proxy.mjs";
import { AUTO_MODEL } from "../src/config.mjs";
import { hasJevKey, NO_KEY_HINT, resolveBackend, describeBackend } from "../src/backend.mjs";
import { loadEnvFiles, PRIMARY_ENV_FILE } from "../src/env-files.mjs";

loadEnvFiles();

if (!hasJevKey()) {
  process.stderr.write(`[jev] no Jev credential found; set ${NO_KEY_HINT} in ${PRIMARY_ENV_FILE}\n`);
  process.exit(1);
}

const port = Number(process.env.JEV_PROXY_PORT ?? 0);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  process.stderr.write(`[jev] JEV_PROXY_PORT must be a port number, got ${process.env.JEV_PROXY_PORT}\n`);
  process.exit(1);
}

const proxy = await startProxy({ port }).catch((err) => {
  process.stderr.write(`[jev] could not listen on 127.0.0.1:${port}: ${err.message}\n`);
  process.exit(1);
});

process.stderr.write(
  [
    `[jev] proxy listening on 127.0.0.1:${proxy.port}, backend ${describeBackend(resolveBackend())}`,
    `[jev] give Claude Code this environment to route through it:`,
    `[jev]   ANTHROPIC_BASE_URL=http://127.0.0.1:${proxy.port}`,
    `[jev]   ANTHROPIC_MODEL=${AUTO_MODEL}`,
    `[jev]   ANTHROPIC_CUSTOM_MODEL_OPTION=${AUTO_MODEL}`,
    `[jev]   ANTHROPIC_CUSTOM_MODEL_OPTION_NAME="Jev Router"`,
    `[jev]   ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES=thinking,adaptive_thinking,interleaved_thinking,effort,max_effort`,
    `[jev]   CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1`,
    `[jev]   CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`,
    "",
  ].join("\n"),
);

const stop = () => {
  proxy.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
