import type { DebugCapabilities } from '@deepseek-ai/dsh-debug'

/**
 * The seam capability set with every flag off, typed without casts; overrides
 * turn individual capabilities on.
 * @param overrides - capabilities to switch on.
 * @returns the complete capability set.
 */
export function capabilities(overrides: Partial<DebugCapabilities> = {}): DebugCapabilities {
  return {
    supportsConditionalBreakpoints: false,
    supportsHitConditionalBreakpoints: false,
    supportsLogPoints: false,
    supportsFunctionBreakpoints: false,
    supportsDataBreakpoints: false,
    supportsInstructionBreakpoints: false,
    supportsExceptionFilterOptions: false,
    supportsStepBack: false,
    supportsRestartFrame: false,
    supportsSetVariable: false,
    supportsSetExpression: false,
    supportsCompletionsRequest: false,
    supportsModulesRequest: false,
    supportsLoadedSourcesRequest: false,
    supportsDisassembleRequest: false,
    supportsReadMemoryRequest: false,
    supportsWriteMemoryRequest: false,
    supportsTerminateRequest: false,
    supportsRestartRequest: false,
    supportsDelayedStackTraceLoading: false,
    supportsValueFormattingOptions: false,
    supportsEvaluateForHovers: false,
    supportsExceptionInfoRequest: false,
    supportsCancelRequest: false,
    supportsANSIStyling: false,
    supportsProgressReporting: false,
    supportsRunInTerminalRequest: false,
    supportsStartDebuggingRequest: false,
    ...overrides,
  }
}
