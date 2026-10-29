/**
 * Public wire-facing types of the debug controller: the editor save contract,
 * the event-cursor replay records, and the seam vocabulary that crosses the
 * Remote boundary. Client programs resolve this entry to source, so it must
 * stay free of host-module imports — the host `./index.ts` augments
 * `Context.sessions` and may not enter a client program.
 * @module @deepseek-ai/dsh-api-debug-controller/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DebugEvaluateResult, DebugResumeResult, DebugStackTrace } from '@deepseek-ai/dsh-debug/types'

export type { EditorFileSystem, EditorWriteRequest, EditorWriteResult } from './editor-write.ts'
export type { DebugEventRecord, DebugEventReplay } from './ring.ts'
export type { DebugBreakpointInput, DebugSessionInfo } from '@deepseek-ai/dsh-debug/types'
export type { DebugSessionId } from '@deepseek-ai/dsh-debug'

/** Host-resolved editor scope: the Session identity and its workspace root. */
export interface DebugEditorScope {
  /** Session identity received on the wire. */
  readonly sessionId: SessionId
  /** Session workspace root, resolved from the session header host-side. */
  readonly workspaceRoot: string
}

/** The session-backend slice this controller drives. */
export interface DebugSessionBackend {
  continue(): Promise<DebugResumeResult>
  pause(): Promise<void>
  step(kind: 'over' | 'in' | 'out' | 'back'): Promise<DebugResumeResult>
  currentThreadStack(): Promise<DebugStackTrace>
  evaluate(expression: string, context: string): Promise<DebugEvaluateResult>
}
