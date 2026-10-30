/**
 * The debug view's wire projection: one replay-ring record's JSON payload
 * narrowed onto the store's fold event.
 *
 * The ring carries the debug domain's live-event payloads (`DebugEvent`:
 * `kind`-tagged objects with `sessionId` and `workspaceId`), so this module
 * is the one runtime check the client owes at its wire boundary. Payloads
 * the view vocabulary cannot present (`breakpoint/changed`,
 * `adapter/output`, `session/owner-changed`, and unknown future kinds) and
 * payloads with missing or malformed fields decode to `undefined` and the
 * fold skips them: one bad record never stops the poll, and a newer Host's
 * new kinds must not wedge an older client.
 *
 * `session/stopped` carries no stop fields in the domain union; when the
 * payload carries them (thread, reason, source, line, column — flattened, or
 * the snapshot's `source` object and string thread id) the stop folds as the
 * view snapshot, and otherwise the session folds as merely stopped.
 * @module @deepseek-ai/dsh-client-ui-debug/wire-events
 */
import type { DebugCapabilities, JsonObject, JsonValue } from '@deepseek-ai/dsh-debug'
import type { DebugStopReason, DebugStopView, DebugViewEvent } from './store.ts'

/** The closed stop-reason vocabulary, as the wire carries it. */
const STOP_REASONS: readonly DebugStopReason[] = [
  'breakpoint', 'step', 'pause', 'entry', 'exception',
  'dataBreakpoint', 'instructionBreakpoint', 'restart', 'unknown',
]

/**
 * Narrow one payload to a plain JSON object.
 * @param payload - the record's wire payload, or an absent field.
 * @returns the object, or `undefined` for every other JSON kind.
 */
function objectOf(payload: JsonValue | undefined): JsonObject | undefined {
  if (payload === undefined || typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return undefined
  }
  // The runtime checks above proved the object shape; narrow the survivor.
  return payload as JsonObject
}

/**
 * Read one string field.
 * @param record - the payload object.
 * @param field - the field to read.
 * @returns the string value, or `undefined` for any other kind.
 */
function stringField(record: JsonObject, field: string): string | undefined {
  const value = record[field]
  return typeof value === 'string' ? value : undefined
}

/**
 * Read one number field.
 * @param record - the payload object.
 * @param field - the field to read.
 * @returns the number value, or `undefined` for any other kind.
 */
function numberField(record: JsonObject, field: string): number | undefined {
  const value = record[field]
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

/**
 * Read one thread id the view can seat: the DAP number, or its decimal
 * string form as the snapshot's branded id travels.
 * @param record - the payload object.
 * @param field - the field to read.
 * @returns the numeric thread id, or `undefined` for any other value.
 */
function threadIdField(record: JsonObject, field: string): number | undefined {
  const value = record[field]
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value)
    if (Number.isSafeInteger(parsed)) return parsed
  }
  return undefined
}

/**
 * Read one stop source path: the workspace-relative string, or the snapshot
 * source object's `workspaceRelativePath`.
 * @param record - the payload object.
 * @param field - the field to read.
 * @returns the workspace-relative path, or `undefined` for any other value.
 */
function sourceField(record: JsonObject, field: string): string | undefined {
  const value = record[field]
  if (typeof value === 'string') return value
  const object = objectOf(value)
  return object === undefined ? undefined : stringField(object, 'workspaceRelativePath')
}

/**
 * Decode one capabilities payload. An entry that is not `true` reads as
 * `false`, the seam's contract for an undeclared capability, so a partial
 * payload still gates the toolbar honestly.
 * @param value - the payload's `capabilities` field, or an absent field.
 * @returns the complete capability set, or `undefined` for a non-object.
 */
function capabilitiesOf(value: JsonValue | undefined): DebugCapabilities | undefined {
  const object = objectOf(value)
  if (object === undefined) return undefined
  return {
    supportsConditionalBreakpoints: object.supportsConditionalBreakpoints === true,
    supportsHitConditionalBreakpoints: object.supportsHitConditionalBreakpoints === true,
    supportsLogPoints: object.supportsLogPoints === true,
    supportsFunctionBreakpoints: object.supportsFunctionBreakpoints === true,
    supportsDataBreakpoints: object.supportsDataBreakpoints === true,
    supportsInstructionBreakpoints: object.supportsInstructionBreakpoints === true,
    supportsExceptionFilterOptions: object.supportsExceptionFilterOptions === true,
    supportsStepBack: object.supportsStepBack === true,
    supportsRestartFrame: object.supportsRestartFrame === true,
    supportsSetVariable: object.supportsSetVariable === true,
    supportsSetExpression: object.supportsSetExpression === true,
    supportsCompletionsRequest: object.supportsCompletionsRequest === true,
    supportsModulesRequest: object.supportsModulesRequest === true,
    supportsLoadedSourcesRequest: object.supportsLoadedSourcesRequest === true,
    supportsBreakpointLocationsRequest: object.supportsBreakpointLocationsRequest === true,
    supportsDisassembleRequest: object.supportsDisassembleRequest === true,
    supportsReadMemoryRequest: object.supportsReadMemoryRequest === true,
    supportsWriteMemoryRequest: object.supportsWriteMemoryRequest === true,
    supportsTerminateRequest: object.supportsTerminateRequest === true,
    supportsRestartRequest: object.supportsRestartRequest === true,
    supportsDelayedStackTraceLoading: object.supportsDelayedStackTraceLoading === true,
    supportsValueFormattingOptions: object.supportsValueFormattingOptions === true,
    supportsEvaluateForHovers: object.supportsEvaluateForHovers === true,
    supportsExceptionInfoRequest: object.supportsExceptionInfoRequest === true,
    supportsCancelRequest: object.supportsCancelRequest === true,
    supportsANSIStyling: object.supportsANSIStyling === true,
    supportsProgressReporting: object.supportsProgressReporting === true,
    supportsRunInTerminalRequest: object.supportsRunInTerminalRequest === true,
    supportsStartDebuggingRequest: object.supportsStartDebuggingRequest === true,
  }
}

/**
 * Decode one `session/stopped` payload's stop snapshot.
 * @param sessionId - the session the record names.
 * @param record - the payload object.
 * @returns the stop view, or `undefined` while a required field is absent or
 *   malformed; the caller then folds the session as merely stopped.
 */
function stopOf(sessionId: string, record: JsonObject): DebugStopView | undefined {
  const reason = STOP_REASONS.find(known => known === stringField(record, 'reason'))
  if (reason === undefined) return undefined
  const threadId = threadIdField(record, 'threadId')
  const source = sourceField(record, 'source')
  const line = numberField(record, 'line')
  const column = numberField(record, 'column')
  if (threadId === undefined || source === undefined || line === undefined || column === undefined) {
    return undefined
  }
  const frameId = stringField(record, 'frameId')
  const description = stringField(record, 'description')
  return {
    sessionId,
    reason,
    threadId,
    ...(frameId === undefined ? {} : { frameId }),
    source,
    line,
    column,
    ...(description === undefined ? {} : { description }),
  }
}

/**
 * Project one replay-ring record's payload onto the store's fold event.
 * @param seq - the record's per-session ring sequence; console entries carry it.
 * @param payload - the record's wire payload.
 * @returns the view event to fold, or `undefined` for every payload the view
 *   vocabulary cannot present.
 */
export function debugViewEventOf(seq: number, payload: JsonValue): DebugViewEvent | undefined {
  const record = objectOf(payload)
  if (record === undefined) return undefined
  const kind = stringField(record, 'kind')
  const sessionId = stringField(record, 'sessionId')
  if (kind === undefined || sessionId === undefined) return undefined
  switch (kind) {
    case 'session/starting':
      return { kind: 'session/state', sessionId, state: 'starting' }
    case 'session/running':
      return { kind: 'session/state', sessionId, state: 'running' }
    case 'session/stopped': {
      const stop = stopOf(sessionId, record)
      return stop === undefined
        ? { kind: 'session/state', sessionId, state: 'stopped' }
        : { kind: 'session/stopped', stop }
    }
    case 'session/failed':
      return { kind: 'session/state', sessionId, state: 'failed' }
    case 'session/terminated':
      return { kind: 'session/terminated', sessionId }
    case 'console/output': {
      const text = stringField(record, 'text')
      if (text === undefined) return undefined
      return {
        kind: 'console/output',
        sessionId,
        seq,
        text,
        truncated: record.truncated === true,
      }
    }
    case 'capabilities/changed': {
      const capabilities = capabilitiesOf(record.capabilities)
      return capabilities === undefined ? undefined : { kind: 'capabilities/changed', sessionId, capabilities }
    }
    default:
      // `breakpoint/changed`, `adapter/output`, `session/owner-changed`, and
      // future kinds have no view fold yet; the poll skips them.
      return undefined
  }
}
