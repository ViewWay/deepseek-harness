/**
 * The four model-facing debug tools over `ctx.debug`: closed operation
 * unions validated loud, dispatch to the landed service face, and typed
 * unavailability for operations whose backing face arrives with the DAP
 * session object.
 * @module @deepseek-ai/dsh-tool-debug/tools
 */

import { DebugError, DebugProviderId, DebugSessionId } from '@deepseek-ai/dsh-debug'

/** The four tool names, in registration order. */
export const DEBUG_TOOL_NAMES = ['debug_session', 'debug_execution', 'debug_inspect', 'debug_breakpoints'] as const

/** One registered debug tool name. */
export type DebugToolName = (typeof DEBUG_TOOL_NAMES)[number]

/** debug_session operations. */
export const DEBUG_SESSION_OPERATIONS = [
  'launch', 'attach', 'launch_compound', 'list', 'list_compounds', 'get', 'get_compound',
  'terminate', 'terminate_compound', 'disconnect', 'attach_targets',
] as const

/** debug_execution operations. */
export const DEBUG_EXECUTION_OPERATIONS = [
  'continue', 'pause', 'step_over', 'step_in', 'step_out', 'step_back',
  'restart', 'restart_frame', 'wait_for_stop',
] as const

/** debug_inspect operations. */
export const DEBUG_INSPECT_OPERATIONS = [
  'threads', 'stack_trace', 'scopes', 'variables', 'evaluate', 'set_variable', 'set_expression',
  'completions', 'exception_info', 'modules', 'loaded_sources', 'source', 'disassemble',
  'read_memory', 'write_memory', 'console',
] as const

/** debug_breakpoints operations. */
export const DEBUG_BREAKPOINTS_OPERATIONS = ['set_file', 'set_function', 'set_exception', 'set_data', 'set_instruction', 'list', 'clear'] as const

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
 * @returns the validated operation.
 * @throws {@link DebugError} `DEBUG_UNKNOWN_OPERATION` when the operation is
 * not in the tool's closed set.
 */
export function parseDebugOperation(tool: DebugToolName, operation: string): string {
  const vocabulary = VOCABULARY[tool]
  const match = vocabulary.find(entry => entry === operation)
  if (match === undefined) {
    throw new DebugError(
      `unknown ${tool} operation "${operation}"; expected one of ${vocabulary.join(', ')}`,
      'DEBUG_UNKNOWN_OPERATION',
    )
  }
  return match
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
