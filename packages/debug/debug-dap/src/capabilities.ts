/**
 * Normalizes adapter capability declarations into the seam's
 * {@link DebugCapabilities} projection.
 *
 * Per the DAP specification, the absence of a capability flag always means the
 * feature is unsupported, and adapters need not return an explicit false. The
 * mapper therefore defaults every flag to false, treats only literal `true`
 * as support, and ignores unknown fields without failing.
 * @module @deepseek-ai/dsh-debug-dap/capabilities
 */
import type { DebugCapabilities, JsonValue } from '@deepseek-ai/dsh-debug'

function flag(flags: { readonly [key: string]: JsonValue }, name: string): boolean {
  return flags[name] === true
}

/**
 * Maps an adapter's declared capabilities onto the seam projection.
 *
 * @param capabilities The `capabilities` value of an `initialize` response;
 *   non-record values (including `undefined`) map to an all-false projection.
 * @returns Every known capability, defaulted to false when undeclared.
 */
export function mapCapabilities(capabilities: JsonValue | undefined): DebugCapabilities {
  const flags = isJsonObject(capabilities) ? capabilities : {}
  return {
    supportsConditionalBreakpoints: flag(flags, 'supportsConditionalBreakpoints'),
    supportsHitConditionalBreakpoints: flag(flags, 'supportsHitConditionalBreakpoints'),
    supportsLogPoints: flag(flags, 'supportsLogPoints'),
    supportsFunctionBreakpoints: flag(flags, 'supportsFunctionBreakpoints'),
    supportsDataBreakpoints: flag(flags, 'supportsDataBreakpoints'),
    supportsInstructionBreakpoints: flag(flags, 'supportsInstructionBreakpoints'),
    supportsExceptionFilterOptions: flag(flags, 'supportsExceptionFilterOptions'),
    supportsStepBack: flag(flags, 'supportsStepBack'),
    supportsRestartFrame: flag(flags, 'supportsRestartFrame'),
    supportsSetVariable: flag(flags, 'supportsSetVariable'),
    supportsSetExpression: flag(flags, 'supportsSetExpression'),
    supportsCompletionsRequest: flag(flags, 'supportsCompletionsRequest'),
    supportsModulesRequest: flag(flags, 'supportsModulesRequest'),
    supportsLoadedSourcesRequest: flag(flags, 'supportsLoadedSourcesRequest'),
    supportsDisassembleRequest: flag(flags, 'supportsDisassembleRequest'),
    supportsReadMemoryRequest: flag(flags, 'supportsReadMemoryRequest'),
    supportsWriteMemoryRequest: flag(flags, 'supportsWriteMemoryRequest'),
    supportsTerminateRequest: flag(flags, 'supportsTerminateRequest'),
    supportsRestartRequest: flag(flags, 'supportsRestartRequest'),
    supportsDelayedStackTraceLoading: flag(flags, 'supportsDelayedStackTraceLoading'),
    supportsValueFormattingOptions: flag(flags, 'supportsValueFormattingOptions'),
    supportsEvaluateForHovers: flag(flags, 'supportsEvaluateForHovers'),
    supportsExceptionInfoRequest: flag(flags, 'supportsExceptionInfoRequest'),
    supportsCancelRequest: flag(flags, 'supportsCancelRequest'),
    supportsANSIStyling: flag(flags, 'supportsANSIStyling'),
    supportsProgressReporting: flag(flags, 'supportsProgressReporting'),
    supportsRunInTerminalRequest: flag(flags, 'supportsRunInTerminalRequest'),
    supportsStartDebuggingRequest: flag(flags, 'supportsStartDebuggingRequest'),
  }
}

/**
 * Whether the value is a JSON object record (not an array or primitive).
 * @param value - Candidate JSON value from an adapter response.
 * @returns Whether the value is a string-keyed record.
 */
export function isJsonObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
