/**
 * Debug stop notices: bounded text without variable values, wake/quiet
 * delivery per session owner, and suppression of the stop the agent's own
 * unsettled resume request caused.
 *
 * Delivery policy and wake caps are this package's designated Config home
 * (`debugStopDelivery`, `debugMaxConsecutiveWakes` — deliberately not the
 * job package's same-named fields); they land together with the
 * approval-wired orchestration that first consumes these helpers.
 * @module @deepseek-ai/dsh-tool-debug/notices
 */

/** The facts one stop notice carries; never variable values or source excerpts. */
export interface DebugStopFacts {
  readonly sessionId: string
  readonly reason: string
  readonly threadId: string
  readonly source: string
  readonly line: number
  readonly column: number
  readonly description?: string
}

/** Bounds for one rendered notice. */
export interface DebugNoticeBounds {
  /** Largest notice text in bytes. */
  readonly maxBytes: number
}

/** Delivery mode for one session's stop notices. */
export type DebugStopDelivery = 'wakeup' | 'quiet'

/** Facts governing one stop's wake decision. */
export interface DebugWakeFacts {
  /** Who owns the debug session. */
  readonly owner: 'agent' | 'user'
  /** The session's delivery mode. */
  readonly delivery: DebugStopDelivery
  /** The harness session with an unsettled resume request, when one exists. */
  readonly pendingResumeBy?: string
  /** The harness session that would receive this wake. */
  readonly caller?: string
}

/** A suggested next step keyed by stop reason. */
const NEXT_STEP: Readonly<Record<string, string>> = {
  breakpoint: 'inspect the stack and scopes, then continue or step',
  step: 'inspect the result, then continue or step',
  pause: 'inspect threads and the stack, then continue or step',
  entry: 'inspect the entry frame, then continue or step',
  exception: 'inspect the exception info and the failing frame',
}

/**
 * Build one bounded stop-notice text. The notice names the session, reason,
 * thread, workspace-relative source position, and a suggested next step; it
 * never carries variable values, environment values, or source excerpts.
 * @param stop - the stop facts.
 * @param bounds - the notice byte cap.
 * @returns the bounded notice text.
 */
export function createStopNotice(stop: DebugStopFacts, bounds: DebugNoticeBounds): string {
  const next = NEXT_STEP[stop.reason] ?? 'inspect the session state'
  const parts = [
    `debug stop [${stop.reason}]: session ${stop.sessionId} thread ${stop.threadId} at ${stop.source}:${stop.line}:${stop.column}`,
    ...(stop.description !== undefined ? [`(${stop.description})`] : []),
    `next: ${next}`,
  ]
  const text = parts.join(' ')
  if (text.length <= bounds.maxBytes) return text
  return `${text.slice(0, Math.max(0, bounds.maxBytes - 1))}…`
}

/**
 * Decide whether one stop should wake the receiving agent.
 * @param facts - the owner, delivery mode, and any unsettled resume request.
 * @returns true only when the delivery mode is wakeup, the session is
 * agent-owned, and no unsettled resume from this same caller caused the stop.
 */
export function shouldWake(facts: DebugWakeFacts): boolean {
  if (facts.delivery !== 'wakeup') return false
  if (facts.owner !== 'agent') return false
  if (facts.pendingResumeBy !== undefined && facts.caller !== undefined
    && facts.pendingResumeBy === facts.caller) {
    return false
  }
  return true
}
