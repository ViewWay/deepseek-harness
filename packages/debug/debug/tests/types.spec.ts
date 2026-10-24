/**
 * Type-level contracts of the Task-6 seam vocabulary: the inspection,
 * breakpoint, and console request/result shapes the DAP backend normalizes
 * into and every surface consumes. Assertions run at compile time; negative
 * cases use `@ts-expect-error` so a regression fails typecheck, not runtime.
 */

import { describe, expectTypeOf, it } from 'vitest'
import { DebugVariableReference } from '@deepseek-ai/dsh-debug'
import type {
  DebugBreakpoint,
  DebugBreakpointResult,
  DebugCompletion,
  DebugConsoleCategory,
  DebugConsoleEntry,
  DebugConsoleOptions,
  DebugConsolePage,
  DebugDataBreakpointInput,
  DebugDataBreakpointRequest,
  DebugDisassembleRequest,
  DebugDisassembledInstruction,
  DebugDisassembly,
  DebugEvaluateContext,
  DebugEvaluateResult,
  DebugExceptionBreakpointRequest,
  DebugExceptionDetails,
  DebugExceptionInfo,
  DebugFunctionBreakpointInput,
  DebugFunctionBreakpointRequest,
  DebugInstructionBreakpointInput,
  DebugInstructionBreakpointRequest,
  DebugModule,
  DebugModulesOptions,
  DebugModulesPage,
  DebugReadMemoryRequest,
  DebugSourceContent,
  DebugStackFrame,
  DebugStackTrace,
  DebugStackTraceOptions,
  DebugSteppingGranularity,
  DebugVariablesOptions,
  DebugVariablesPage,
  DebugWriteMemoryRequest,
} from '@deepseek-ai/dsh-debug'

describe('debug inspection vocabulary types', () => {
  it('steps carry a DAP granularity', () => {
    expectTypeOf<DebugSteppingGranularity>().toEqualTypeOf<'statement' | 'instruction' | 'line'>()
  })

  it('stack traces page with totals and truncation', () => {
    expectTypeOf<DebugStackTraceOptions['startFrame']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<DebugStackTraceOptions['levels']>().toEqualTypeOf<number | undefined>()
    const trace: DebugStackTrace = {
      frames: [],
      totalFrames: 0,
      truncated: false,
    }
    expectTypeOf(trace.frames).toEqualTypeOf<readonly DebugStackFrame[]>()
  })

  it('variables page one level with DAP filters', () => {
    expectTypeOf<DebugVariablesOptions['start']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<DebugVariablesOptions['count']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<DebugVariablesOptions['filter']>().toEqualTypeOf<'indexed' | 'named' | undefined>()
    const page: DebugVariablesPage = { variables: [], total: 0, truncated: false }
    expectTypeOf(page.total).toEqualTypeOf<number>()
  })

  it('evaluate covers the DAP context set and brands its sub-reference', () => {
    expectTypeOf<DebugEvaluateContext>().toEqualTypeOf<'watch' | 'repl' | 'hover' | 'clipboard' | 'variables'>()
    const result: DebugEvaluateResult = { result: '3', variablesReference: DebugVariableReference('0') }
    expectTypeOf(result.variablesReference).toEqualTypeOf<DebugVariableReference>()
    // @ts-expect-error a bare number is not a branded variable reference
    const bare: DebugEvaluateResult = { result: '3', variablesReference: 0 }
    expectTypeOf(bare).not.toBeNever()
  })

  it('completions normalize the DAP item', () => {
    const completion: DebugCompletion = { label: 'len' }
    expectTypeOf(completion.label).toEqualTypeOf<string>()
    expectTypeOf<DebugCompletion['text']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<DebugCompletion['start']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<DebugCompletion['length']>().toEqualTypeOf<number | undefined>()
  })

  it('breakpoint requests stay public and symmetric', () => {
    const exception: DebugExceptionBreakpointRequest = { filters: ['uncaught'] }
    const functions: DebugFunctionBreakpointRequest = {
      breakpoints: [{ name: 'main' }],
    }
    const data: DebugDataBreakpointRequest = {
      breakpoints: [{ dataId: 'x', bytes: 4 }],
    }
    const instructions: DebugInstructionBreakpointRequest = {
      breakpoints: [{ instructionReference: '0x1000', offset: -4 }],
    }
    expectTypeOf(exception.filters).toEqualTypeOf<readonly string[]>()
    expectTypeOf(functions.breakpoints).toEqualTypeOf<readonly DebugFunctionBreakpointInput[]>()
    expectTypeOf(data.breakpoints).toEqualTypeOf<readonly DebugDataBreakpointInput[]>()
    expectTypeOf(instructions.breakpoints).toEqualTypeOf<readonly DebugInstructionBreakpointInput[]>()
    expectTypeOf<DebugBreakpointResult['applied']>().toEqualTypeOf<readonly DebugBreakpoint[]>()
    expectTypeOf<DebugBreakpointResult['rejected']>().toEqualTypeOf<readonly DebugBreakpoint[]>()
  })

  it('exception info closes the break-mode union and carries the message', () => {
    const info: DebugExceptionInfo = { exceptionId: 'TypeError', breakMode: 'unhandled' }
    expectTypeOf(info.breakMode).toEqualTypeOf<'never' | 'always' | 'unhandled' | 'userUnhandled' | 'all'>()
    const details: DebugExceptionDetails = { message: 'boom', typeName: 'TypeError' }
    expectTypeOf(details.stack).toEqualTypeOf<string | undefined>()
  })

  it('modules page like the stack does', () => {
    const module: DebugModule = { id: 'm1', name: 'app' }
    expectTypeOf<DebugModulesOptions['startModule']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<DebugModulesOptions['moduleCount']>().toEqualTypeOf<number | undefined>()
    const page: DebugModulesPage = { modules: [module], totalModules: 1, truncated: false }
    expectTypeOf(page.modules).toEqualTypeOf<readonly DebugModule[]>()
  })

  it('source content, disassembly, and memory carry their DAP fields', () => {
    const content: DebugSourceContent = { content: 'let x = 1' }
    const request: DebugDisassembleRequest = {
      memoryReference: '0x1000',
      instructionCount: 16,
      resolveSymbols: true,
    }
    const instruction: DebugDisassembledInstruction = { address: '0x1000', instruction: 'mov' }
    const disassembly: DebugDisassembly = { instructions: [instruction], truncated: false }
    expectTypeOf(disassembly.truncated).toEqualTypeOf<boolean>()
    const read: DebugReadMemoryRequest = { memoryReference: '0x1000', count: 64 }
    const write: DebugWriteMemoryRequest = { memoryReference: '0x1000', data: 'AAE=' }
    expectTypeOf(content.mimeType).toEqualTypeOf<string | undefined>()
    expectTypeOf(request.instructionOffset).toEqualTypeOf<number | undefined>()
    expectTypeOf(instruction.column).toEqualTypeOf<number | undefined>()
    expectTypeOf(read.offset).toEqualTypeOf<number | undefined>()
    expectTypeOf(write.data).toEqualTypeOf<string>()
  })

  it('console entries categorize per DAP and page by non-consuming offset', () => {
    const entry: DebugConsoleEntry = { category: 'stdout', output: 'hi' }
    expectTypeOf<DebugConsoleCategory>().toEqualTypeOf<'console' | 'important' | 'stdout' | 'stderr' | 'telemetry'>()
    expectTypeOf<DebugConsoleOptions['offset']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<DebugConsoleOptions['limit']>().toEqualTypeOf<number | undefined>()
    const page: DebugConsolePage = { entries: [entry], nextOffset: 1, truncated: false }
    expectTypeOf(page.nextOffset).toEqualTypeOf<number>()
  })
})
