/**
 * The four model-facing debug tools over `ctx.debug`: closed operation
 * unions validated loud, dispatch to the landed service and session faces,
 * and typed unavailability for operations whose backing face has not landed.
 * @module @deepseek-ai/dsh-tool-debug/tools
 */

import { DebugError, DebugProviderId, DebugSessionId } from '@deepseek-ai/dsh-debug'
import type { Debug, DebugSessionOperations } from '@deepseek-ai/dsh-debug'

/** The four tool names, in registration order. */
export const DEBUG_TOOL_NAMES = ['debug_session', 'debug_execution', 'debug_inspect', 'debug_breakpoints'] as const

/** One registered debug tool name. */
export type DebugToolName = (typeof DEBUG_TOOL_NAMES)[number]

/** debug_session operations. */
export const DEBUG_SESSION_OPERATIONS = [
  'launch', 'attach', 'launch_compound', 'list', 'list_compounds', 'get', 'get_compound',
  'terminate', 'terminate_compound', 'disconnect', 'attach_targets',
] as const

/** One validated debug_session operation name. */
export type DebugSessionOperation = (typeof DEBUG_SESSION_OPERATIONS)[number]

/** debug_execution operations. */
export const DEBUG_EXECUTION_OPERATIONS = [
  'continue', 'pause', 'step_over', 'step_in', 'step_out', 'step_back',
  'restart', 'restart_frame', 'wait_for_stop',
] as const

/** debug_inspect operations. */
export const DEBUG_INSPECT_OPERATIONS = [
  'threads', 'stack_trace', 'scopes', 'variables', 'evaluate', 'set_variable', 'set_expression',
  'completions', 'exception_info', 'modules', 'loaded_sources', 'source', 'disassemble',
  'read_memory', 'write_memory', 'breakpoint_locations', 'console',
] as const

/** debug_breakpoints operations. */
export const DEBUG_BREAKPOINTS_OPERATIONS = ['set_file', 'set_function', 'set_exception', 'set_data', 'set_instruction', 'list', 'clear'] as const

/** One validated debug_breakpoints operation name. */
export type DebugBreakpointsOperation = (typeof DEBUG_BREAKPOINTS_OPERATIONS)[number]

/** One validated debug_execution operation name. */
export type DebugExecutionOperation = (typeof DEBUG_EXECUTION_OPERATIONS)[number]

/** One validated debug_inspect operation name. */
export type DebugInspectOperation = (typeof DEBUG_INSPECT_OPERATIONS)[number]

/** The operation vocabulary one tool name parses into. */
export type DebugOperationOf<T extends DebugToolName> =
  T extends 'debug_session' ? DebugSessionOperation
    : T extends 'debug_execution' ? DebugExecutionOperation
      : T extends 'debug_inspect' ? DebugInspectOperation
        : DebugBreakpointsOperation

/** The operation vocabulary of one tool name. */
const VOCABULARY: Readonly<Record<DebugToolName, readonly string[]>> = {
  debug_session: DEBUG_SESSION_OPERATIONS,
  debug_execution: DEBUG_EXECUTION_OPERATIONS,
  debug_inspect: DEBUG_INSPECT_OPERATIONS,
  debug_breakpoints: DEBUG_BREAKPOINTS_OPERATIONS,
}

/**
 * Validate one operation against its tool's closed vocabulary.
 * @param tool - the tool the operation arrived on.
 * @param operation - the requested operation name.
 * @returns the validated operation, typed to the tool's union.
 * @throws {@link DebugError} `DEBUG_UNKNOWN_OPERATION` when the operation is
 * not in the tool's closed set.
 */
export function parseDebugOperation<T extends DebugToolName>(tool: T, operation: string): DebugOperationOf<T> {
  const vocabulary = VOCABULARY[tool]
  const match = vocabulary.find(entry => entry === operation)
  if (match === undefined) {
    throw new DebugError(
      `unknown ${tool} operation "${operation}"; expected one of ${vocabulary.join(', ')}`,
      'DEBUG_UNKNOWN_OPERATION',
    )
  }
  // The vocabulary lookup above is the validation; the assertion only types it.
  return match as DebugOperationOf<T>
}

/**
 * The typed failure for operations whose backing session face has not landed.
 * @param operation - the validated operation name.
 * @returns the typed unavailability error.
 */
export function unavailableBackend(operation: string): DebugError {
  return new DebugError(
    `operation "${operation}" needs the DAP session face, which this composition does not provide`,
    'DEBUG_UNAVAILABLE',
  )
}

/**
 * Narrow one session-id tool argument to its branded form.
 * @param value - the serialized session id.
 * @returns the branded id.
 */
export function parseSessionId(value: string): DebugSessionId {
  return DebugSessionId(value)
}

/**
 * Narrow one provider-id tool argument to its branded form.
 * @param value - the provider id text.
 * @returns the branded id.
 */
export function parseProviderId(value: string): DebugProviderId {
  return DebugProviderId(value)
}

/**
 * Resolve one session's registered backend to the shared session-operation
 * face the tool dispatch drives.
 * @param debug - the debug service holding the backend registry.
 * @param sessionId - the session the operation targets.
 * @param operation - the validated operation name, for the failure message.
 * @returns the session's registered backend.
 * @throws {@link DebugError} `DEBUG_UNAVAILABLE` when the session has no
 * registered backend.
 */
export function resolveSessionBackend(debug: Debug, sessionId: DebugSessionId, operation: string): DebugSessionOperations {
  const backend = debug.backendOf(sessionId)
  if (backend === undefined) throw unavailableBackend(operation)
  return backend
}
