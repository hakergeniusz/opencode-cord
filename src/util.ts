/** Small shared helpers. No external dependencies (mirrors pi-cord's util.ts). */
import { readFileSync } from "node:fs"

export type Platform = "discord" | "telegram"

export function expandTilde(p: string): string {
  if (p === "~") return process.env.HOME ?? p
  if (p.startsWith("~/")) return `${process.env.HOME ?? ""}/${p.slice(2)}`
  return p
}

/** Read a JSON file, returning null for any failure (missing, malformed, unreadable). */
export function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch {
    return null
  }
}

export function createLogger(scope: string): (...args: unknown[]) => void {
  const tag = `[opencode-cord:${scope}]`
  return (...args: unknown[]) => {
    const ts = new Date().toISOString()
    const msg = args
      .map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")
    process.stderr.write(`${ts} ${tag} ${msg}\n`)
  }
}
