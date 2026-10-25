/**
 * Public wire-facing types of the debug controller: the editor save contract,
 * the event-cursor replay records, and the seam vocabulary that crosses the
 * Remote boundary.
 * @module @deepseek-ai/dsh-api-debug-controller/types
 */

export type { DebugEditorScope, DebugSessionBackend } from './index.ts'
export type { EditorFileSystem, EditorWriteRequest, EditorWriteResult } from './editor-write.ts'
export type { DebugEventRecord, DebugEventReplay } from './ring.ts'
export type { DebugBreakpointInput, DebugSessionId, DebugSessionInfo } from '@deepseek-ai/dsh-debug'
