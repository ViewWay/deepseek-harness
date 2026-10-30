/**
 * Public wire-facing types of the debug controller: the editor save contract,
 * the event-cursor replay records, and the seam vocabulary that crosses the
 * Remote boundary. Client programs resolve this entry to source, so it must
 * stay free of host-module imports — the host `./index.ts` augments
 * `Context.sessions` and may not enter a client program.
 * @module @deepseek-ai/dsh-api-debug-controller/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DebugSessionOperations } from '@deepseek-ai/dsh-debug/types'

export type { EditorFileSystem, EditorWriteRequest, EditorWriteResult } from './editor-write.ts'
export type { DebugEventRecord, DebugEventReplay } from './ring.ts'
export type { DebugBreakpointInput, DebugSessionId, DebugSessionInfo } from '@deepseek-ai/dsh-debug/types'

/** Host-resolved editor scope: the Session identity and its workspace root. */
export interface DebugEditorScope {
  /** Session identity received on the wire. */
  readonly sessionId: SessionId
  /** Session workspace root, resolved from the session header host-side. */
  readonly workspaceRoot: string
}

/**
 * The session-backend slice this controller drives: the full session
 * operation surface plus the lifecycle controls the toolbar wires, reached
 * over the `ctx.debug` backend registry and satisfied structurally by
 * `DapDebugBackend`.
 */
export interface DebugSessionBackend extends DebugSessionOperations {
  /** Terminates the debuggee; requires the adapter's `supportsTerminateRequest`. */
  terminate(): Promise<void>
  /** Disconnects from the adapter, ending the session without touching the debuggee. */
  disconnect(): Promise<void>
}

/**
 * Wire form of one debug memory read. The Remote boundary moves JSON only,
 * so the backend's `Uint8Array` bytes travel as base64 with the standard
 * alphabet; `address` and `unreadableBytes` pass through unchanged.
 */
export interface DebugReadMemoryWireResult {
  /** Address of the first returned byte, in the adapter's notation; absent when the adapter returned no body. */
  readonly address?: string
  /** Base64 (standard alphabet) of the bytes read; empty string when the adapter read none. */
  readonly data: string
  /** Byte count after the read bytes the adapter could not read. */
  readonly unreadableBytes?: number
}
