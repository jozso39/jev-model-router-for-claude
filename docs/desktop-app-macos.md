# Routing Claude Desktop sessions on macOS

`jev-claude` wraps a `claude` process it starts itself. The Claude desktop app starts its own
Claude Code processes, so the wrapper never runs and "Jev Router" does not appear in the
app's model picker. Instead, keep `jev-proxy` running in the background and give every
Claude Code process the routing environment through `~/.claude/settings.json`, which the
desktop app's sessions read too.

## 1. Run the proxy as a launchd agent

`npm link` put `jev-proxy` on your PATH (for Homebrew Node that is `/opt/homebrew/bin`).
Create `~/Library/LaunchAgents/ai.jev.proxy.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.jev.proxy</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/jev-proxy</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>JEV_PROXY_PORT</key><string>4517</string>
    <key>JEV_DEBUG</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/YOU/Library/Logs/jev-proxy.log</string>
  <key>StandardErrorPath</key><string>/Users/YOU/Library/Logs/jev-proxy.log</string>
</dict>
</plist>
```

Replace `YOU` with your user name (launchd does not expand `~`), then:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.jev.proxy.plist
tail -3 ~/Library/Logs/jev-proxy.log     # "proxy listening on 127.0.0.1:4517"
```

The proxy reads the key from `~/.claude/jev-router.env`.

## 2. Point Claude Code at it

Add an `env` block to `~/.claude/settings.json` (merge with what is already there):

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:4517",
    "ANTHROPIC_MODEL": "jev-router",
    "ANTHROPIC_CUSTOM_MODEL_OPTION": "jev-router",
    "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME": "Jev Router",
    "ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES": "thinking,adaptive_thinking,interleaved_thinking,effort,max_effort",
    "CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT": "1",
    "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY": "1"
  }
}
```

Start a new session in the desktop app and send a prompt. The routing decision appears in
the proxy log:

```text
[jev] 1a2b3c4d5e6f 480ms p=0.99 opus -> haiku (jev) ctx~3000 | your prompt
[jev] 200 served by claude-haiku-4-5-20251001
```

## What to expect

- Every Claude Code process on the machine now goes through the proxy: the desktop app,
  plain `claude`, and IDE extensions. `jev-claude` is no longer needed.
- The desktop picker shows its own model list, not a "Jev Router" row. Sessions start on the
  routed default because `ANTHROPIC_MODEL` is set. Choosing a concrete model in the picker
  makes that session pass through unrouted, which is the same rule `jev-claude` applies.
- If the proxy is not running, every session fails to connect. `KeepAlive` restarts it, and
  it starts at login.

## Undo

Remove the `env` block from `~/.claude/settings.json`, then:

```bash
launchctl bootout gui/$(id -u)/ai.jev.proxy
rm ~/Library/LaunchAgents/ai.jev.proxy.plist
```
