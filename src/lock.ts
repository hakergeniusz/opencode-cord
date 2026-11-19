/**
 * Gateway singleton lock (ported from pi-cord's lock.ts, read side only).
 *
 * The bots must run in exactly one process: a second gateway would fight over
 * the Telegram long-poll (409 Conflict) and log in to Discord twice. The plugin
 * only *reads* the lock; the standalone gateway itself owns creation/removal.
 */
import { expandTilde, readJson } from "./util"

export interface GatewayLockInfo {
  pid: number
  startedAt: string
}

export function gatewayLockPath(): string {
  return expandTilde("~/.pi/agent/pi-cord/gateway.lock")
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return code !== "ESRCH" // EPERM (other user's process) still means alive
  }
}

/** The live gateway holding the lock, if any. */
export function readGatewayLock(): GatewayLockInfo | null {
  const lock = readJson<GatewayLockInfo>(gatewayLockPath())
  if (!lock || typeof lock.pid !== "number" || !alive(lock.pid)) return null
  return lock
}
