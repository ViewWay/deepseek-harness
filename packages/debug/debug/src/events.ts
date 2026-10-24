/**
 * Live debug events: the closed `DebugEvent` union, the `DebugEventSource`
 * subscription face, and the in-process bus that publishes only after the
 * owning state committed. Live `session/*` events never enter the session
 * log; durable debug facts use the `debug/*` session events.
 * @module @deepseek-ai/dsh-debug/events
 */

import type { DebugSessionId } from './brand.ts'
import type { DebugBreakpointResult, DebugCaller, DebugCapabilities } from './types.ts'

/** Who triggered a termination path; the durable `debug/*` events carry the full caller. */
export type DebugEventActor = 'user' | 'agent'

/** Live debug notification, discriminated by `kind`; fields grow additively as surfaces land. */
export type DebugEvent =
  | { readonly kind: 'session/starting'; readonly sessionId: DebugSessionId; readonly workspaceId: string }
  | { readonly kind: 'session/running'; readonly sessionId: DebugSessionId; readonly workspaceId: string }
  | { readonly kind: 'session/stopped'; readonly sessionId: DebugSessionId; readonly workspaceId: string }
  | { readonly kind: 'session/terminated'; readonly sessionId: DebugSessionId; readonly workspaceId: string; readonly actor: DebugEventActor }
  | { readonly kind: 'session/failed'; readonly sessionId: DebugSessionId; readonly workspaceId: string }
  | { readonly kind: 'breakpoint/changed'; readonly sessionId: DebugSessionId; readonly workspaceId: string; readonly result: DebugBreakpointResult }
  | { readonly kind: 'console/output'; readonly sessionId: DebugSessionId; readonly workspaceId: string; readonly text: string; readonly truncated: boolean }
  | { readonly kind: 'adapter/output'; readonly sessionId: DebugSessionId; readonly workspaceId: string; readonly text: string; readonly truncated: boolean }
  | { readonly kind: 'capabilities/changed'; readonly sessionId: DebugSessionId; readonly workspaceId: string; readonly capabilities: DebugCapabilities }
  | { readonly kind: 'session/owner-changed'; readonly sessionId: DebugSessionId; readonly workspaceId: string; readonly from: DebugCaller; readonly to: DebugCaller }

/** One subscription's narrowing filter: by workspace, by session, both, or neither. */
export interface DebugEventFilter {
  readonly workspaceId?: string
  readonly sessionId?: DebugSessionId
}

/** Process-local subscription face over live debug events. */
export interface DebugEventSource {
  /**
   * Subscribe to live debug events.
   * @param filter - narrowing filter; an empty filter receives every event.
   * @param listener - synchronous listener invoked after the owning state committed.
   * @returns the disposer; after it runs, no further event reaches the listener.
   */
  subscribe(filter: DebugEventFilter, listener: (event: DebugEvent) => void): () => void
}

/** One registered subscription of the in-process bus. */
interface Subscription {
  readonly filter: DebugEventFilter
  readonly listener: (event: DebugEvent) => void
}

/**
 * In-process synchronous event bus behind `DebugEventSource`. Listener
 * failures are contained: publishing follows a committed state change and
 * must never fail that operation because one subscriber threw.
 */
export class DebugEventBus implements DebugEventSource {
  private readonly subscriptions = new Set<Subscription>()

  /**
   * Register one subscriber.
   * @param filter - narrowing filter; an empty filter receives every event.
   * @param listener - synchronous listener for matching events.
   * @returns the disposer removing exactly this subscription.
   */
  subscribe(filter: DebugEventFilter, listener: (event: DebugEvent) => void): () => void {
    const subscription: Subscription = { filter, listener }
    this.subscriptions.add(subscription)
    return () => {
      this.subscriptions.delete(subscription)
    }
  }

  /**
   * Dispatch one event to every matching subscriber synchronously.
   * @param event - the committed debug fact to publish.
   */
  publish(event: DebugEvent): void {
    for (const subscription of this.subscriptions) {
      if (subscription.filter.workspaceId !== undefined
        && subscription.filter.workspaceId !== event.workspaceId) continue
      if (subscription.filter.sessionId !== undefined
        && subscription.filter.sessionId !== event.sessionId) continue
      try {
        subscription.listener(event)
      } catch {
        // One subscriber's throw must not fail the committed operation that
        // publishes this event; containment is the bus's contract.
      }
    }
  }
}
