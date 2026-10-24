/**
 * Durable `debug/*` session events and the `debug` message source. Payloads
 * carry only ids, mode, provider, workspace root, relative source, line and
 * column, reason, outcome, actor, and operation — never variable values,
 * memory, environment values, or DAP frames. Ids are the serialized string
 * form of branded values; replay must not treat them as live handles.
 *
 * Writers mark every envelope `ignorable: true` so readers without this
 * plugin skip the events; `SESSION_FORMAT_VERSION` does not change.
 * @module @deepseek-ai/dsh-debug/session-events
 */

/** A debug session started (launch or attach) and reached its adapter handshake. */
export interface DebugSessionStartedEvent {
  /** Serialized `DebugSessionId`. */
  readonly sessionId: string
  /** Registered provider that resolved the session. */
  readonly providerId: string
  /** Provider-reported language label. */
  readonly language: string
  /** Whether the session launched a target or attached to one. */
  readonly mode: 'launch' | 'attach'
  /** Workspace root the session debugs in. */
  readonly workspaceRoot: string
  /** Named configuration that produced the session, when one was used. */
  readonly configurationName?: string
  /** Adapter version the session runs against. */
  readonly adapterVersion: string
}

/** A debugged target stopped at one location. */
export interface DebugStoppedEvent {
  /** Serialized `DebugSessionId`. */
  readonly sessionId: string
  /** Why the target stopped. */
  readonly reason: 'breakpoint' | 'step' | 'pause' | 'entry' | 'exception' | 'dataBreakpoint' | 'instructionBreakpoint' | 'restart' | 'unknown'
  /** Serialized `DebugThreadId` that stopped; audit and location only. */
  readonly threadId: string
  /** Workspace-relative source path. */
  readonly source: string
  /** One-based stop line. */
  readonly line: number
  /** One-based stop column. */
  readonly column: number
  /** Adapter-reported stop description. */
  readonly description?: string
}

/** A debug session ended; `disconnected` stays distinct from target exit. */
export interface DebugSessionEndedEvent {
  /** Serialized `DebugSessionId`. */
  readonly sessionId: string
  /** Which side ended the session and how. */
  readonly outcome: 'terminated' | 'disconnected' | 'failed'
  /** Human-readable ending reason. */
  readonly reason: string
  /** Session lifetime in milliseconds. */
  readonly durationMs: number
}

/** Audit-only record of one control operation on a debug session. */
export interface DebugControlEvent {
  /** Serialized `DebugSessionId` the control targeted. */
  readonly sessionId: string
  /** Which side issued the control. */
  readonly actor: 'agent' | 'user'
  /** The control operation name (continue, step-over, terminate, …). */
  readonly operation: string
  /** Serialized `DebugThreadId`, audit only. */
  readonly threadId?: string
  /** Serialized `DebugFrameId`, audit only. */
  readonly frameId?: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Debug session started: identity, mode, workspace root, adapter version. */
    'debug/session-started': DebugSessionStartedEvent
    /** Debugged target stopped: reason, location, and description. */
    'debug/stopped': DebugStoppedEvent
    /** Debug session ended with outcome, reason, and lifetime. */
    'debug/session-ended': DebugSessionEndedEvent
    /** Audit-only record of one control operation. */
    'debug/control': DebugControlEvent
  }
}

/** Attribution of a model-visible message this seam produced (stop notices, wake-ups). */
export interface DebugMessageSource {
  readonly kind: 'debug'
  /** Serialized `DebugSessionId` the message reports on. */
  readonly sessionId: string
  /** Why the message was produced. */
  readonly reason: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    debug: DebugMessageSource
  }
}
