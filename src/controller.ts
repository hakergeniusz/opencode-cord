/**
 * GatewayController — the pi-cord control plane, mapped to OpenCode.
 *
 * In pi-cord the extension hosted the bots in-process (importing discord.js and
 * the RPC child machinery). An OpenCode V2 plugin must stay self-contained and
 * must not pull in discord.js, so instead this controller manages the bots as an
 * *external standalone gateway process* (the same process pi-cord's `main.ts`
 * runs under systemd). `gatewayCommand` is opt-in: without it, start/stop report
 * the gap instead of pretending to run bots.
 *
 * This preserves the original intent — one gateway at a time, autostart on
 * session load, and clean start/stop/status/diag control — while leaving the
 * actual chat transports documented as a gap in README.md.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { allowlistSummary, diagLines, hasAnyToken, type CordConfig } from "./config"
import { readGatewayLock } from "./lock"

export class GatewayController {
  private child: ChildProcess | null = null
  private lastError: string | null = null

  constructor(
    private readonly config: CordConfig,
    private readonly configPath: string | null,
    private readonly gatewayCommand: string | string[] | undefined,
    private readonly log: (...args: unknown[]) => void = () => {},
  ) {}

  private get commandParts(): string[] {
    const cmd = this.gatewayCommand
    if (typeof cmd === "string") return cmd.trim().split(/\s+/).filter(Boolean)
    if (Array.isArray(cmd)) return cmd.filter((part) => typeof part === "string" && part.length > 0)
    return []
  }

  get running(): boolean {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed)
  }

  get pid(): number | undefined {
    return this.running ? this.child?.pid : undefined
  }

  async start(): Promise<string> {
    if (this.running) return `cord gateway is already running (pid ${this.pid}).`

    const held = readGatewayLock()
    if (held) {
      return `Another gateway already holds the lock (pid ${held.pid}). Stop it via its service manager first.`
    }
    if (!hasAnyToken(this.config)) {
      return "No bot tokens configured. Add a token to the config or set PI_CORD_TELEGRAM_TOKEN / PI_CORD_DISCORD_TOKEN."
    }

    const parts = this.commandParts
    if (parts.length === 0) {
      return [
        "The Discord/Telegram bots are a standalone service and are not bundled in this plugin.",
        "Set the plugin option `gatewayCommand` (e.g. [\"bun\", \"/path/to/gateway/main.ts\"]) to let /cord start manage it.",
        "See README.md (Gaps) for details.",
      ].join("\n")
    }

    const [program, ...args] = parts
    try {
      const child = spawn(program!, args, {
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      })
      this.child = child
      this.lastError = null
      child.on("error", (err) => {
        this.lastError = err.message
        if (this.child === child) this.child = null
        this.log("gateway process error:", err)
      })
      child.on("exit", (code, signal) => {
        if (this.child === child) this.child = null
        this.log(`gateway process exited (code ${code}, signal ${signal})`)
      })
      child.unref()
      return `cord gateway launched (pid ${child.pid}).`
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.lastError = message
      return `Failed to launch gateway: ${message}`
    }
  }

  async stop(): Promise<string> {
    if (this.running && this.child) {
      const pid = this.child.pid
      this.child.kill("SIGTERM")
      this.child = null
      return `cord gateway stop signalled (pid ${pid}).`
    }
    const held = readGatewayLock()
    if (held) {
      return `Gateway is running outside this plugin (pid ${held.pid}). Stop it via its service manager (e.g. systemctl --user stop pi-cord).`
    }
    return "cord gateway is not running."
  }

  statusText(): string {
    const held = readGatewayLock()
    const lines = [
      `running: ${this.running ? `yes (managed child pid ${this.pid})` : "no"}`,
      `lock:    ${held ? `held by pid ${held.pid} (${held.startedAt})` : "free"}`,
      `config:  ${this.configPath ?? "NOT FOUND"}`,
      `gatewayCommand: ${this.commandParts.length ? this.commandParts.join(" ") : "(not configured — bots are a separate service)"}`,
    ]
    if (this.lastError) lines.push(`last error: ${this.lastError}`)
    lines.push("", allowlistSummary(this.config))
    return lines.join("\n")
  }

  diagText(): string {
    const lines = diagLines(this.config, this.configPath)
    const parts = this.commandParts
    lines.push("", `gatewayCommand: ${parts.length ? parts.join(" ") : "(not configured)"}`)
    lines.push(`managed child: ${this.running ? `pid ${this.pid}` : "none"}`)
    return lines.join("\n")
  }
}
