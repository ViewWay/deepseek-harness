/**
 * Terminal approval answerer: bridges the user-approval waterfall into the
 * TUI's single input loop, so approval keys never race the prompt line. The
 * queue is the only surface; rendering and y/n routing live in the Ink app.
 * @module @deepseek-ai/dsh-tui/approval
 */

import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'

/** The approval-request fields the terminal answerer reads. */
export interface TuiApprovalEvent {
  readonly toolName: string
  readonly reason?: string
  readonly signal?: AbortSignal
}

/** The minimal host face the answerer registers through; a full Context satisfies it. */
export interface TuiApprovalHost {
  on(name: 'approval/request', listener: (request: TuiApprovalEvent, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>): () => void
}

/** The approval facts the TUI renders. */
export interface TuiApprovalRequest {
  readonly toolName: string
  readonly reason?: string
}

/** Outcomes the terminal answerer itself decides; everything else stays queued. */
export type TuiApprovalAnswer = 'allowed-once' | 'rejected' | 'cancelled'

/** The queue face shared between the waterfall listener and the Ink app. */
export interface TuiApprovalQueue {
  /** Whether {@link close} ran; closed queues answer `unavailable` without queueing. */
  readonly closed: boolean
  /** Queue one approval for the terminal answerer; resolves when answered, aborted, or closed. */
  ask(request: TuiApprovalRequest & { readonly signal?: AbortSignal }): Promise<ApprovalOutcome>
  /** Answer the pending request; ignored when nothing is pending. */
  answer(outcome: TuiApprovalAnswer): void
  /** The request the terminal should render now, if any. */
  pending(): TuiApprovalRequest | undefined
  /** Notify on pending-request changes; returns the unsubscribe function. */
  subscribe(callback: (pending: TuiApprovalRequest | undefined) => void): () => void
  /** Cancel everything pending and make later asks report `unavailable`; used at app exit. */
  close(): void
}

/**
 * Create the approval queue backing the terminal answerer.
 * @returns the queue to pass to {@link installTuiApproval} and the Ink app.
 */
export function createTuiApprovalQueue(): TuiApprovalQueue {
  interface Waiting {
    request: TuiApprovalRequest & { readonly signal?: AbortSignal }
    resolve: (outcome: ApprovalOutcome) => void
    detach: () => void
    settle: (outcome: ApprovalOutcome) => void
  }
  const waiting: Waiting[] = []
  const listeners = new Set<(pending: TuiApprovalRequest | undefined) => void>()
  let closed = false
  let lastNotified: Waiting | undefined
  // Notify only when the pending request itself changes; queueing behind an
  // unchanged head would re-render the same approval line for nothing.
  const notify = (): void => {
    const head = waiting[0]
    if (head === lastNotified && waiting.length > 0) return
    lastNotified = head
    for (const listener of listeners) listener(head?.request)
  }
  return {
    get closed(): boolean {
      return closed
    },
    ask(request): Promise<ApprovalOutcome> {
      return new Promise((resolve) => {
        if (closed) {
          resolve('unavailable')
          return
        }
        const entry: Waiting = {
          request,
          resolve,
          detach: () => {},
          settle: () => {},
        }
        const onAbort = (): void => { entry.settle('cancelled') }
        const signal = request.signal
        entry.detach = signal === undefined
          ? () => {}
          : () => { signal.removeEventListener('abort', onAbort) }
        entry.settle = (outcome: ApprovalOutcome): void => {
          entry.detach()
          const index = waiting.indexOf(entry)
          if (index === -1) return
          waiting.splice(index, 1)
          resolve(outcome)
          notify()
        }
        if (request.signal !== undefined) {
          if (request.signal.aborted) {
            resolve('cancelled')
            return
          }
          request.signal.addEventListener('abort', onAbort, { once: true })
        }
        waiting.push(entry)
        notify()
      })
    },
    answer(outcome): void {
      waiting[0]?.settle(outcome)
    },
    pending(): TuiApprovalRequest | undefined {
      return waiting[0]?.request
    },
    subscribe(callback): () => void {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
    close(): void {
      closed = true
      for (const head of waiting.splice(0)) {
        head.detach()
        head.resolve('cancelled')
      }
      notify()
    },
  }
}

/**
 * Register the terminal answerer on the user-approval waterfall. While the
 * queue is open every request is answered by the TUI; once closed the listener
 * delegates with `next()`.
 * @param host - the host whose `approval/request` waterfall feeds the queue.
 * @param queue - the queue the Ink app renders and answers through.
 */
export function installTuiApproval(host: TuiApprovalHost, queue: TuiApprovalQueue): void {
  host.on('approval/request', (request, next) => {
    if (queue.closed) return next()
    return queue.ask({
      toolName: request.toolName,
      ...request.reason === undefined ? {} : { reason: request.reason },
      ...request.signal === undefined ? {} : { signal: request.signal },
    })
  })
}
