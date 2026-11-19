/**
 * Config loading and diagnostics (ported from pi-cord's config.ts).
 *
 * Tokens are never logged: diagnostics only report whether a token is set and
 * how many user ids are allowlisted.
 */
import { accessSync, constants } from "node:fs"
import { readGatewayLock } from "./lock"
import { expandTilde, readJson } from "./util"

export interface PlatformConfig {
  token?: string
  /** Platform user ids allowed to use the bot. Empty/absent = deny everyone (fail closed). */
  allowedUsers?: string[]
}

export interface CordConfig {
  /** Start the gateway when the plugin loads. Default true (mirrors pi-cord autostart). */
  autostart?: boolean
  /** OpenCode-only: command used to launch the standalone gateway process. */
  gatewayCommand?: string | string[]
  /** Explicit config path override (OpenCode plugin option). */
  configPath?: string
  piPath?: string
  cwd?: string
  model?: string
  thinking?: string
  childExtensions?: boolean
  trustProject?: boolean
  interactiveDialogs?: boolean
  dialogTimeoutSeconds?: number
  forwardNotifications?: boolean
  notify?: { info?: "all" | "once" | "off"; suppress?: string[] }
  progressUpdates?: boolean
  streaming?: boolean
  slashCommands?: boolean
  uiHistoryTurns?: number
  agentsMd?: string
  childIdleMinutes?: number
  childArgs?: string[]
  discord?: PlatformConfig
  telegram?: PlatformConfig
}

export interface LoadedConfig {
  config: CordConfig
  path: string
}

/**
 * Config lookup order:
 *   1. explicit argument (plugin option `configPath`)
 *   2. $CORD_CONFIG / $PI_CORD_CONFIG
 *   3. ~/.config/opencode-cord/config.json
 *   4. ~/.pi/agent/pi-cord/config.json   (pi-cord's recommended path)
 *   5. ~/pi-cord/config.json
 * Tokens can also come from PI_CORD_DISCORD_TOKEN / PI_CORD_TELEGRAM_TOKEN,
 * which override whatever the file says.
 */
export function findConfigPath(explicit?: string): string | null {
  const candidates: string[] = []
  if (explicit) candidates.push(explicit)
  if (process.env.CORD_CONFIG) candidates.push(process.env.CORD_CONFIG)
  if (process.env.PI_CORD_CONFIG) candidates.push(process.env.PI_CORD_CONFIG)
  candidates.push(
    "~/.config/opencode-cord/config.json",
    "~/.pi/agent/pi-cord/config.json",
    "~/pi-cord/config.json",
  )
  for (const c of candidates) {
    const p = expandTilde(c)
    if (readJson<unknown>(p) != null) return p
  }
  return null
}

export function loadConfig(explicitPath?: string): LoadedConfig | null {
  const path = findConfigPath(explicitPath)
  if (!path) return null
  const raw = readJson<CordConfig>(path)
  if (!raw) return null
  const config: CordConfig = { ...raw }

  if (process.env.PI_CORD_DISCORD_TOKEN) {
    config.discord = { ...(config.discord ?? { allowedUsers: [] }), token: process.env.PI_CORD_DISCORD_TOKEN }
  }
  if (process.env.PI_CORD_TELEGRAM_TOKEN) {
    config.telegram = { ...(config.telegram ?? { allowedUsers: [] }), token: process.env.PI_CORD_TELEGRAM_TOKEN }
  }
  return { config, path }
}

/** True when at least one platform has a usable token. */
export function hasAnyToken(config: CordConfig): boolean {
  return Boolean(config.telegram?.token || config.discord?.token)
}

export function resolveCwd(config: CordConfig): string {
  return expandTilde(config.cwd ?? "~/.pi/agent/pi-cord/workspace")
}

export function resolvePiPath(config: CordConfig): string {
  const p = config.piPath?.trim() || "pi"
  if (p.includes("/")) return expandTilde(p)
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (!dir) continue
    const candidate = `${dir}/${p}`
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      /* keep looking */
    }
  }
  return p
}

/** One-line allowlist diagnostics (no secrets). Mirrors GatewayHost.allowlistSummary(). */
export function allowlistSummary(config: CordConfig): string {
  const d = config.discord
  const t = config.telegram
  return [
    `discord: ${d?.token ? "token set" : "no token"}, allowed: ${d?.allowedUsers?.length ?? 0}`,
    `telegram: ${t?.token ? "token set" : "no token"}, allowed: ${t?.allowedUsers?.length ?? 0}`,
  ].join("\n")
}

/** Secret-free diagnostics, ported from pi-cord's main.ts `--diag`. */
export function diagLines(config: CordConfig, path: string | null): string[] {
  const lines = [
    `config:       ${path ?? "NOT FOUND"}`,
    `autostart:    ${config.autostart === false ? "false" : "true"} (plugin load only)`,
    `pi path:      ${resolvePiPath(config)}`,
    `model:        ${config.model ?? "(default)"}`,
    `thinking:     ${config.thinking ?? "(default)"}`,
    `child exts:   ${config.childExtensions === false ? "disabled" : "enabled"}`,
    `dialogs:      ${config.interactiveDialogs === false ? "off" : `on (timeout ${config.dialogTimeoutSeconds ?? 180}s)`}`,
    `discord:      ${config.discord?.token ? "token set" : "no token"}, allowedUsers: ${config.discord?.allowedUsers?.length ?? 0}`,
    `telegram:     ${config.telegram?.token ? "token set" : "no token"}, allowedUsers: ${config.telegram?.allowedUsers?.length ?? 0}`,
  ]
  const lock = readGatewayLock()
  lines.push(
    lock
      ? `gateway lock: HELD by pid ${lock.pid} (started ${lock.startedAt})`
      : "gateway lock: free",
  )
  if (!config.discord?.allowedUsers?.length && !config.telegram?.allowedUsers?.length) {
    lines.push("", "WARNING: allowlists are empty - every user is denied (fail closed).")
  }
  return lines
}
