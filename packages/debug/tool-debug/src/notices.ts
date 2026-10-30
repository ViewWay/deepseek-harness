/**
 * Debug stop notices: bounded text without variable values, wake/quiet
 * delivery per session owner, and suppression of the stop the agent's own
 * unsettled resume request caused.
 *
 * Delivery policy and wake caps are this package's Config home
 * (`debugStopDelivery`, `debugMaxConsecutiveWakes`, `maxNoticeBytes` —
 * deliberately not the job package's same-named fields).
 * @module @deepseek-ai/dsh-tool-debug/notices
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

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

/** The agent face one stop notice delivers through. */
export interface DebugNoticeTarget {
  /** Whether the receiving agent currently holds an open turn. */
  readonly idle: boolean
  /** Queue context for the next step without waking the driver. */
  inject(message: UserMessage): void
  /** Queue a follow-up turn and wake the driver. */
  followup(message: UserMessage): void
}

/** Wake facts plus the remaining wake budget. */
export interface DebugNoticeFacts extends DebugWakeFacts {
  /**
   * Turns this notice may still open before delivery degrades to injection;
   * unbounded when omitted. The caller owns the spent-wake counter.
   */
  readonly remainingWakes?: number
}

/** How one stop notice was delivered. */
export type DebugNoticeDeliveryOutcome = 'woken' | 'injected' | 'suppressed'

/**
 * Deliver one stop to the session that logged it: build the bounded notice,
 * decide the delivery mode, and hand the built message to the receiving
 * agent. A wake needs `wakeup` delivery, an agent-owned session, no
 * unsettled resume from the receiving session, an idle receiver, and wake
 * budget; every other stop is injected for the next step. The stop that
 * settles the receiving session's own unsettled resume is suppressed — that
 * resume's result already delivers it.
 * @param stop - the stop facts.
 * @param facts - owner, delivery mode, resume state, idleness, and budget.
 * @param bounds - the notice byte cap.
 * @param target - the receiving agent face.
 * @returns how the notice was delivered.
 */
export function deliverStopNotice(
  stop: DebugStopFacts,
  facts: DebugNoticeFacts,
  bounds: DebugNoticeBounds,
  target: DebugNoticeTarget,
): DebugNoticeDeliveryOutcome {
  const wake = shouldWake(facts)
  if (!wake
    && facts.pendingResumeBy !== undefined
    && facts.pendingResumeBy === facts.caller) {
    return 'suppressed'
  }
  const message = createUserMessage({
    content: [{ type: 'text', text: createStopNotice(stop, bounds) }],
    source: { kind: 'debug', sessionId: stop.sessionId, reason: stop.reason },
  })
  if (wake && target.idle && (facts.remainingWakes === undefined || facts.remainingWakes > 0)) {
    target.followup(message)
    return 'woken'
  }
  target.inject(message)
  return 'injected'
}
