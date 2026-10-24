/**
 * dsh-debug's owned branded ids: the opaque cross-boundary identities of the
 * debug seam. The `Branded<B>` primitive and the duplicate-install-safe
 * constructor live in `@deepseek-ai/dsh-brand`; each type keeps its factory
 * here so `index.ts` re-exports both under one name.
 *
 * DAP's `threadId`, `frameId`, `variablesReference`, `breakpoint.id`, and
 * `sourceReference` are numbers at the protocol boundary. Converting between
 * those numbers and these branded values happens only inside the debug-dap
 * backend; this package's public types carry no bare numeric ids.
 * @module @deepseek-ai/dsh-debug/brand
 */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Opaque language-provider identity, reserved atomically with its extensions at registration. */
export type DebugProviderId = Branded<'DebugProviderId'>

/** Opaque debug-session identity; shaped `debug-` + 16 lowercase hex digits. */
export type DebugSessionId = Branded<'DebugSessionId'>

/** Opaque compound-configuration identity grouping an ordered session list. */
export type DebugCompoundId = Branded<'DebugCompoundId'>

/** Opaque stopped-thread identity, meaningful within one debug session. */
export type DebugThreadId = Branded<'DebugThreadId'>

/** Opaque stack-frame identity, meaningful while its thread stays stopped. */
export type DebugFrameId = Branded<'DebugFrameId'>

/** Opaque variable-container reference, meaningful while its frame stays stopped. */
export type DebugVariableReference = Branded<'DebugVariableReference'>

/** Opaque adapter-assigned breakpoint identity. */
export type DebugBreakpointId = Branded<'DebugBreakpointId'>

/** Opaque adapter-assigned source-content reference. */
export type DebugSourceReference = Branded<'DebugSourceReference'>

/**
 * Brand a string as a {@link DebugProviderId}. No validation — the registry
 * rejects an empty id at registration.
 * @param id - the provider's stable identifier.
 * @returns the same string, branded.
 */
export function DebugProviderId(id: string): DebugProviderId {
  return brandString<DebugProviderId>(id)
}

/**
 * Brand a string as a {@link DebugSessionId}. No format validation — the
 * session registry owns id allocation.
 * @param id - the session's identifier.
 * @returns the same string, branded.
 */
export function DebugSessionId(id: string): DebugSessionId {
  return brandString<DebugSessionId>(id)
}

/**
 * Brand a string as a {@link DebugCompoundId}.
 * @param id - the compound's identifier.
 * @returns the same string, branded.
 */
export function DebugCompoundId(id: string): DebugCompoundId {
  return brandString<DebugCompoundId>(id)
}

/**
 * Brand a string as a {@link DebugThreadId}.
 * @param id - the thread's identifier.
 * @returns the same string, branded.
 */
export function DebugThreadId(id: string): DebugThreadId {
  return brandString<DebugThreadId>(id)
}

/**
 * Brand a string as a {@link DebugFrameId}.
 * @param id - the frame's identifier.
 * @returns the same string, branded.
 */
export function DebugFrameId(id: string): DebugFrameId {
  return brandString<DebugFrameId>(id)
}

/**
 * Brand a string as a {@link DebugVariableReference}.
 * @param id - the reference's identifier.
 * @returns the same string, branded.
 */
export function DebugVariableReference(id: string): DebugVariableReference {
  return brandString<DebugVariableReference>(id)
}

/**
 * Brand a string as a {@link DebugBreakpointId}.
 * @param id - the breakpoint's identifier.
 * @returns the same string, branded.
 */
export function DebugBreakpointId(id: string): DebugBreakpointId {
  return brandString<DebugBreakpointId>(id)
}

/**
 * Brand a string as a {@link DebugSourceReference}.
 * @param id - the source reference's identifier.
 * @returns the same string, branded.
 */
export function DebugSourceReference(id: string): DebugSourceReference {
  return brandString<DebugSourceReference>(id)
}
