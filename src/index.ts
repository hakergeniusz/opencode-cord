/**
 * opencode-cord — OpenCode V2 control-plane plugin for the pi-cord gateway.
 *
 * Ports the plugin-shaped part of the original pi extension: the `/pi-cord`
 * command (start | stop | status | diag), the session_start/session_shutdown
 * autostart lifecycle hooks, config diagnostics, and the singleton lock check.
 * The Discord/Telegram transports and per-chat agent sessions were a standalone
 * service in the original and remain a documented gap here (see README.md).
 */
import { Plugin } from "@opencode/plugin"
import { hasAnyToken, loadConfig, type CordConfig } from "./config"
import { GatewayController } from "./controller"
import { readGatewayLock } from "./lock"
import { createLogger } from "./util"

const log = createLogger("plugin")

const debugLog = (...args: unknown[]): void => {
  if (process.env.OPENCODE_CORD_DEBUG === "1" || process.env.PI_CORD_DEBUG === "1") log(...args)
}

/** Plugin options override file/env config for the keys the control plane uses. */
function mergeOptions(config: CordConfig, options: Record<string, unknown>): CordConfig {
  const merged: CordConfig = { ...config }
  const keys: Array<keyof CordConfig> = [
    "autostart",
    "gatewayCommand",
    "configPath",
    "piPath",
    "cwd",
    "model",
    "thinking",
    "childExtensions",
    "trustProject",
    "interactiveDialogs",
    "dialogTimeoutSeconds",
    "forwardNotifications",
    "notify",
    "progressUpdates",
    "streaming",
    "slashCommands",
    "uiHistoryTurns",
    "agentsMd",
    "childIdleMinutes",
    "childArgs",
    "discord",
    "telegram",
  ]
  for (const key of keys) {
    const value = options[key]
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value
  }
  return merged
}

async function handleCommand(
  text: string,
  controller: GatewayController,
): Promise<string> {
  const parts = text.trim().split(/\s+/).filter(Boolean)
  if (parts[0]?.toLowerCase() === "cord" || parts[0]?.toLowerCase() === "pi-cord") parts.shift()
  const sub = (parts[0] ?? "status").toLowerCase()
  try {
    switch (sub) {
      case "start":
        return await controller.start()
      case "stop":
        return await controller.stop()
      case "status":
        return controller.statusText()
      case "diag":
        return controller.diagText()
      default:
        return "Usage: /cord start | stop | status | diag"
    }
  } catch (err) {
    return `cord error: ${err instanceof Error ? err.message : String(err)}`
  }
}

export default Plugin.define({
  id: "opencode-cord",
  async setup(ctx) {
    // Same fork-bomb guard as the pi original: chat children must not start bots.
    if (process.env.PI_CORD_CHILD === "1") return
    if (process.env.OPENCODE_CORD_DISABLE === "1" || process.env.PI_CORD_DISABLE === "1") return

    const options = (ctx.options ?? {}) as Record<string, unknown>
    const loaded = loadConfig(typeof options.configPath === "string" ? options.configPath : undefined)
    const config = mergeOptions(loaded?.config ?? {}, options)
    const configPath = loaded?.path ?? (typeof options.configPath === "string" ? options.configPath : null)

    const controller = new GatewayController(config, configPath, config.gatewayCommand, log)

    await ctx.storage.set("opencode-cord:loaded", {
      at: new Date().toISOString(),
      configPath,
      hasToken: hasAnyToken(config),
    })

    // pi: pi.registerCommand("pi-cord", ...)  ->  OpenCode command transform.
    const run = async ({ sessionID, text }: { sessionID: string; text: string }) => {
      const report = await handleCommand(text, controller)
      // pi: ctx.ui.notify(...) -> OpenCode has no server-side notify surface;
      // inject the report as a session message so it is visible.
      await ctx.session.synthetic({ sessionID, text: report })
    }
    await ctx.command.transform((editor) => {
      editor.add({
        name: "pi-cord",
        description: "cord gateway control: start | stop | status | diag",
        execute: async ({ sessionID, prompt }) => run({ sessionID, text: prompt.text }),
      })
      editor.add({
        name: "cord",
        description: "Alias for /pi-cord (gateway control)",
        execute: async ({ sessionID, prompt }) => run({ sessionID, text: prompt.text }),
      })
    })

    // pi: (no tools) -> OpenCode tools expose the same diagnostics to the agent.
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "cord_status",
        description: "Report the pi-cord gateway status and allowlist summary (read-only, no secrets)",
        input: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["status", "diag"], description: "status = short summary, diag = full diagnostics" },
          },
          additionalProperties: false,
        },
        options: { codemode: true },
        execute: async (input) => {
          const action = (input as { action?: string }).action ?? "status"
          return { content: action === "diag" ? controller.diagText() : controller.statusText() }
        },
      })
      editor.add({
        name: "cord_control",
        description: "Start or stop the standalone cord gateway (asks permission first)",
        input: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["start", "stop"] },
          },
          required: ["action"],
          additionalProperties: false,
        },
        options: { codemode: true },
        execute: async (input, context) => {
          const action = (input as { action: "start" | "stop" }).action
          // pi: interactive confirm dialogs -> OpenCode permission rules.
          await ctx.permission.assert({
            sessionID: context.sessionID,
            agent: context.agent,
            source: { type: "tool", messageID: context.messageID, id: context.id },
            action: `cord_${action}`,
            resources: ["gateway"],
          })
          return { content: action === "start" ? await controller.start() : await controller.stop() }
        },
      })
    })

    // pi: pi.on("session_start", ...) -> plugin setup / autostart on load.
    if (config.autostart !== false && hasAnyToken(config) && !readGatewayLock()) {
      const message = await controller.start()
      debugLog("autostart:", message)
    } else {
      debugLog("autostart skipped (disabled, no token, or another gateway holds the lock)")
    }

    // pi: pi.on("session_shutdown", ...) -> returned cleanup function.
    return () => {
      void controller.stop().catch((err) => log("shutdown stop failed:", err))
    }
  },
})
