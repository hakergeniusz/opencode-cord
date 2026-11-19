# opencode-cord

An **OpenCode V2** plugin that ports the plugin-shaped part of [pi-cord](https://github.com/hakergeniusz/pi-cord): a control plane for the Discord/Telegram gateway.

pi-cord was primarily a **standalone service** (a `pi --mode rpc` child per chat, Discord/Telegram adapters, streaming, dialog forwarding, etc.). Its pi *extension* was only a thin control plane: one `/pi-cord` command plus `session_start`/`session_shutdown` autostart hooks. This plugin implements exactly that control plane with native OpenCode APIs; the transport/agent machinery is deliberately **not** bundled. See [Gaps](#gaps).

## What it does

- `/pi-cord start | stop | status | diag` (plus `/cord` alias) — gateway control and secret-free diagnostics.
- `cord_status` tool — lets the agent query status/diagnostics.
- `cord_control` tool — start/stop with an OpenCode permission check.
- Autostart on plugin load, guarded by the same singleton lock check as the original (one gateway at a time).
- Clean shutdown stops a gateway started by this plugin.

No `discord.js`, no pi runtime packages, no bundled gateway binary.

## Map from the pi original

| pi-cord (pi extension) | OpenCode V2 plugin |
|---|---|
| `pi.registerCommand("pi-cord", { handler })` | `ctx.command.transform` → `/pi-cord` + `/cord` |
| `ctx.ui.notify(...)` from the command | `ctx.session.synthetic({ sessionID, text })` (server plugins have no notify surface) |
| `pi.on("session_start")` autostart | `setup(ctx)` autostart (after config/lock checks) |
| `pi.on("session_shutdown")` stop | cleanup function returned from `setup` |
| `findConfigPath` / `loadConfig` / `hasAnyToken` | `src/config.ts` (same lookup order + env token overrides) |
| `readGatewayLock()` singleton check | `src/lock.ts` (read side ported) |
| `main.ts --diag` / `allowlistSummary()` | `/cord diag`, `cord_status` tool (`src/config.ts`) |
| Interactive confirm dialogs (`ctx.ui.select/confirm`) | `ctx.permission.assert` in the `cord_control` tool |
| config via env / CLI | `ctx.options` (object form in `opencode.jsonc`) + env/file fallbacks |
| (no equivalent in the original) | `cord_status` / `cord_control` tools added to expose the same data to the agent |

Behavior kept: fail-closed allowlist diagnostics (tokens are never printed), empty-allowlist warning, autostart disabled when no token or when another gateway holds the lock, and the `PI_CORD_CHILD` / disable guards.

## Load it

Put it in `opencode.json(c)`:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-cord",
      "options": {
        "autostart": true,
        "gatewayCommand": ["bun", "/home/you/Projects/pi-cord/src/main.ts"]
      }
    }
  ]
}
```

`gatewayCommand` is optional and OpenCode-specific. Without it, `/cord start` explains that the bots are a standalone service and must be run separately (e.g. the original systemd unit). The plugin never downloads or bundles a gateway binary.

Config lookup (unchanged from pi-cord, plus one new path): explicit `configPath` option → `$CORD_CONFIG` → `$PI_CORD_CONFIG` → `~/.config/opencode-cord/config.json` → `~/.pi/agent/pi-cord/config.json` → `~/pi-cord/config.json`. Tokens may also come from `PI_CORD_DISCORD_TOKEN` / `PI_CORD_TELEGRAM_TOKEN`. Tokens are never written to logs or session text.

## Options

The pi-cord config keys are accepted (`autostart`, `cwd`, `model`, `thinking`, `childExtensions`, `trustProject`, `interactiveDialogs`, `dialogTimeoutSeconds`, `forwardNotifications`, `notify`, `progressUpdates`, `streaming`, `slashCommands`, `uiHistoryTurns`, `agentsMd`, `childIdleMinutes`, `childArgs`, `discord`, `telegram`) plus:

- `gatewayCommand` — `string | string[]`; command used by `/cord start` to launch the standalone gateway.
- `configPath` — explicit config file path.

Environment overrides: `OPENCODE_CORD_DISABLE=1` (or `PI_CORD_DISABLE=1`) disables the plugin; `OPENCODE_CORD_DEBUG=1` (or `PI_CORD_DEBUG=1`) logs routine startup decisions; `PI_CORD_CHILD=1` keeps spawned chat children dormant (inherited from pi-cord).

## Gaps (not ported)

These were standalone-service features in pi-cord and have no 1:1 OpenCode plugin equivalent; they are intentionally omitted rather than stubbed:

- **Discord/Telegram adapters** — no `discord.js` dependency; no long polling, inline keyboards, slash-command menus, or message chunking (`format.ts`).
- **Per-chat agent sessions** — no `pi --mode rpc` child processes, no per-chat session dirs/history, `/new`, `/sessions`, `/resume`, `/model`, `/thinking`, `/compact`, `/cwd` chat commands.
- **Prompt steering/queueing, tool-progress edits, token streaming, typing indicators** (`chat.ts`).
- **Interactive dialog forwarding to chat buttons/ForceReply** and notification mirroring (`rpc.ts`, `gateway.ts`) — only the agent-side `permission.assert` mapping remains.
- **Chat-only AGENTS.md system-prompt injection** — it was for child sessions only; the interactive host must not read it. `ctx.session.hook("context", ...)` could inject it into OpenCode sessions, but that would invert the original intent, so it is left out.
- **Singleton lock acquisition, config-file watching/restart, systemd unit, daemon `--diag` CLI** — the plugin only reads the lock and reports status.
- **TUI part** — none; all output goes through session messages/tools/stderr.

Running those features still requires the original standalone gateway process.

## Tests

Not ported. The original tests use `bun:test` and import the chat/RPC gateway layers (`commands.test.ts`, `gateway-e2e.test.ts`, `fake-pi.mjs`); `format.test.ts` covers delivery-only formatting. None can run without pi/bun runtime dependencies, so no test files are included here.

## License

MIT — 2026 hakergeniusz.
