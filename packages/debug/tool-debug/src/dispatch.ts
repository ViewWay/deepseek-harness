/**
 * Session-operation dispatch behind `debug_execution` and `debug_inspect`:
 * one branch per validated operation, mapping tool arguments onto the shared
 * `DebugSessionOperations` contract and bounding every model-facing result
 * through the render helpers.
 * @module @deepseek-ai/dsh-tool-debug/dispatch
 */

import { Buffer } from 'node:buffer'
import { DebugError, DebugFrameId, DebugSourceReference, DebugThreadId, DebugVariableReference } from '@deepseek-ai/dsh-debug'
import type { DebugEvaluateResult, DebugResumeResult, DebugSessionOperations, DebugStepKind, DebugVariable } from '@deepseek-ai/dsh-debug'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { boundValue, renderSeamStackTrace, renderVariables } from './render.ts'
import { unavailableBackend } from './tools.ts'
import type { DebugExecutionOperation, DebugInspectOperation } from './tools.ts'

/** `debug_execution` arguments, matching the tool's parameter schema. */
export interface DebugExecutionArgs {
  readonly operation: DebugExecutionOperation
  readonly sessionId: string
  readonly threadId?: string
  readonly frameId?: string
}

/** `debug_inspect` arguments, matching the tool's parameter schema. */
export interface DebugInspectArgs {
  readonly operation: DebugInspectOperation
  readonly sessionId: string
  readonly threadId?: string
  readonly frameId?: string
  readonly variablesReference?: string
  readonly expression?: string
  readonly name?: string
  readonly value?: string
  readonly text?: string
  readonly column?: number
  readonly memoryReference?: string
  readonly count?: number
  readonly offset?: number
  readonly data?: string
  readonly allowPartial?: boolean
  readonly sourceReference?: string
  readonly instructionCount?: number
  readonly instructionOffset?: number
  readonly file?: string
  readonly line?: number
  readonly endLine?: number
  readonly endColumn?: number
}

/** The step operation names and the step kinds they request. */
const STEP_KIND: Readonly<Record<'step_over' | 'step_in' | 'step_out' | 'step_back', DebugStepKind>> = {
  step_over: 'over',
  step_in: 'in',
  step_out: 'out',
  step_back: 'back',
}

/** Fail loud for an operation argument the operation cannot run without. */
function requireArg<T>(operation: string, field: string, value: T | undefined): T {
  if (value === undefined) throw new DebugError(`${operation} requires ${field}`, 'DEBUG_INVALID_CONFIG')
  return value
}

/**
 * Project one resume settlement into its model-facing JSON, keeping the seam's
 * `kind` discriminants and the stop's workspace-relative location.
 * @param result - the settlement `continue` or `step` returned.
 * @returns the canonical result for the tool call.
 */
function resumeJson(result: DebugResumeResult): JsonValue {
  switch (result.kind) {
    case 'stopped':
      return {
        kind: 'stopped',
        stop: {
          sessionId: result.stop.sessionId,
          reason: result.stop.reason,
          threadId: result.stop.threadId,
          ...(result.stop.frameId !== undefined ? { frameId: result.stop.frameId } : {}),
          source: result.stop.source.workspaceRelativePath,
          line: result.stop.line,
          column: result.stop.column,
          ...(result.stop.description !== undefined ? { description: result.stop.description } : {}),
        },
      }
    case 'terminated':
      return { kind: 'terminated' }
    case 'running':
      return { kind: 'running' }
  }
}

/**
 * Project one evaluation outcome, bounding the value and keeping the child and
 * memory anchors for follow-up `variables` and memory calls.
 * @param result - the evaluation outcome.
 * @returns the canonical result for the tool call.
 */
function evaluateJson(result: DebugEvaluateResult): JsonValue {
  return {
    result: boundValue(result.result),
    ...(result.type !== undefined ? { type: result.type } : {}),
    variablesReference: result.variablesReference,
    ...(result.memoryReference !== undefined ? { memoryReference: result.memoryReference } : {}),
  }
}

/**
 * Project one variable row the adapter re-rendered, bounding the value and
 * keeping the child and memory anchors.
 * @param variable - the variable as the adapter reported it.
 * @returns the canonical result for the tool call.
 */
function variableJson(variable: DebugVariable): JsonValue {
  return {
    name: variable.name,
    value: boundValue(variable.value),
    variablesReference: variable.variablesReference,
    ...(variable.memoryReference !== undefined ? { memoryReference: variable.memoryReference } : {}),
  }
}

/**
 * Run one validated `debug_execution` operation against the session backend.
 * @param backend - the session's registered operations face.
 * @param operation - the validated operation name.
 * @param args - the tool call's arguments.
 * @returns the bounded canonical result.
 * @throws {@link DebugError} `DEBUG_UNAVAILABLE` for `wait_for_stop`, whose
 * stop-event face lands with the notice orchestration.
 */
export async function dispatchExecutionOperation(
  backend: DebugSessionOperations,
  operation: DebugExecutionOperation,
  args: DebugExecutionArgs,
): Promise<JsonValue> {
  const threadId = args.threadId !== undefined ? DebugThreadId(args.threadId) : undefined
  switch (operation) {
    case 'continue':
      return resumeJson(await backend.continue(threadId))
    case 'pause':
      await backend.pause(threadId)
      return { paused: true }
    case 'step_over':
    case 'step_in':
    case 'step_out':
    case 'step_back':
      return resumeJson(await backend.step(STEP_KIND[operation], threadId))
    case 'restart':
      await backend.restart()
      return { restarted: true }
    case 'restart_frame': {
      const frameId = requireArg('restart_frame', 'frameId', args.frameId)
      await backend.restartFrame(DebugFrameId(frameId))
      return { frameId, restarted: true }
    }
    case 'wait_for_stop':
      // Stops arrive as stop events; the waiting face lands with the notice
      // orchestration, not with the session operations contract.
      throw unavailableBackend('wait_for_stop')
    /* v8 ignore next -- dispatch accepts the closed execution operation union */
    default:
      assertNever(operation, 'debug_execution dispatch')
  }
}

/**
 * Run one validated `debug_inspect` operation against the session backend.
 * @param backend - the session's registered operations face.
 * @param operation - the validated operation name.
 * @param args - the tool call's arguments.
 * @returns the bounded canonical result.
 */
export async function dispatchInspectOperation(
  backend: DebugSessionOperations,
  operation: DebugInspectOperation,
  args: DebugInspectArgs,
): Promise<JsonValue> {
  switch (operation) {
    case 'threads':
      return { threads: (await backend.threads()).map(thread => ({ id: thread.id, name: thread.name })) }
    case 'stack_trace': {
      const trace = args.threadId !== undefined
        ? await backend.stackTrace(DebugThreadId(args.threadId))
        : await backend.currentThreadStack()
      const view = renderSeamStackTrace(trace)
      return { frames: view.frames.map(frame => ({ ...frame })), truncated: view.truncated, total: view.total }
    }
    case 'scopes': {
      const frameId = requireArg('scopes', 'frameId', args.frameId)
      const scopes = await backend.scopes(DebugFrameId(frameId))
      return {
        scopes: scopes.map(scope => ({
          name: scope.name,
          variablesReference: scope.variablesReference,
          expensive: scope.expensive,
        })),
      }
    }
    case 'variables': {
      const reference = requireArg('variables', 'variablesReference', args.variablesReference)
      const page = await backend.variables(DebugVariableReference(reference))
      const rendered = renderVariables({ variables: page.variables })
      return {
        variables: rendered.variables.map(variable => ({ ...variable })),
        total: page.total,
        truncated: page.truncated,
      }
    }
    case 'evaluate': {
      const expression = requireArg('evaluate', 'expression', args.expression)
      const frameId = args.frameId !== undefined ? DebugFrameId(args.frameId) : undefined
      // Tool-face evaluation is REPL evaluation; watch and hover contexts
      // belong to surfaces, so the context stays fixed here.
      return evaluateJson(await backend.evaluate(expression, 'repl', frameId))
    }
    case 'set_variable': {
      const reference = requireArg('set_variable', 'variablesReference', args.variablesReference)
      const name = requireArg('set_variable', 'name', args.name)
      const value = requireArg('set_variable', 'value', args.value)
      return variableJson(await backend.setVariable(DebugVariableReference(reference), name, value))
    }
    case 'set_expression': {
      const expression = requireArg('set_expression', 'expression', args.expression)
      const value = requireArg('set_expression', 'value', args.value)
      const frameId = args.frameId !== undefined ? DebugFrameId(args.frameId) : undefined
      return evaluateJson(await backend.setExpression(expression, value, frameId))
    }
    case 'completions': {
      const text = requireArg('completions', 'text', args.text)
      const column = requireArg('completions', 'column', args.column)
      const frameId = args.frameId !== undefined ? DebugFrameId(args.frameId) : undefined
      const completions = await backend.completions(text, column, frameId)
      return {
        completions: completions.map(completion => ({
          label: completion.label,
          ...(completion.text !== undefined ? { text: completion.text } : {}),
          ...(completion.start !== undefined ? { start: completion.start } : {}),
          ...(completion.length !== undefined ? { length: completion.length } : {}),
        })),
      }
    }
    case 'exception_info': {
      const threadId = requireArg('exception_info', 'threadId', args.threadId)
      const info = await backend.exceptionInfo(DebugThreadId(threadId))
      return {
        exceptionId: info.exceptionId,
        ...(info.description !== undefined ? { description: info.description } : {}),
        breakMode: info.breakMode,
        ...(info.details !== undefined ? { details: { ...info.details } } : {}),
      }
    }
    case 'modules': {
      const page = await backend.modules()
      return {
        modules: page.modules.map(module => ({
          id: module.id,
          name: module.name,
          ...(module.path !== undefined ? { path: module.path } : {}),
          ...(module.version !== undefined ? { version: module.version } : {}),
        })),
        totalModules: page.totalModules,
        truncated: page.truncated,
      }
    }
    case 'loaded_sources':
      return {
        sources: (await backend.loadedSources()).map(source => ({
          path: source.workspaceRelativePath,
          ...(source.sourceReference !== undefined ? { sourceReference: source.sourceReference } : {}),
        })),
      }
    case 'source': {
      const sourceReference = requireArg('source', 'sourceReference', args.sourceReference)
      const content = await backend.source(DebugSourceReference(sourceReference))
      return { content: content.content, ...(content.mimeType !== undefined ? { mimeType: content.mimeType } : {}) }
    }
    case 'breakpoint_locations': {
      const file = requireArg('breakpoint_locations', 'file', args.file)
      const line = requireArg('breakpoint_locations', 'line', args.line)
      const locations = await backend.breakpointLocations({
        source: { workspaceRelativePath: file, absolutePath: file },
        line,
        ...(args.column !== undefined ? { column: args.column } : {}),
        ...(args.endLine !== undefined ? { endLine: args.endLine } : {}),
        ...(args.endColumn !== undefined ? { endColumn: args.endColumn } : {}),
      })
      return {
        locations: [...locations]
          .sort((first, second) => first.line - second.line || (first.column ?? 0) - (second.column ?? 0))
          .map(location => ({
            line: location.line,
            ...(location.column !== undefined ? { column: location.column } : {}),
            ...(location.endLine !== undefined ? { endLine: location.endLine } : {}),
            ...(location.endColumn !== undefined ? { endColumn: location.endColumn } : {}),
          })),
      }
    }
    case 'disassemble': {
      const memoryReference = requireArg('disassemble', 'memoryReference', args.memoryReference)
      const instructionCount = requireArg('disassemble', 'instructionCount', args.instructionCount)
      const disassembly = await backend.disassemble({
        memoryReference,
        instructionCount,
        ...(args.instructionOffset !== undefined ? { instructionOffset: args.instructionOffset } : {}),
        ...(args.offset !== undefined ? { offset: args.offset } : {}),
      })
      return {
        instructions: disassembly.instructions.map(instruction => ({
          address: instruction.address,
          instruction: instruction.instruction,
          ...(instruction.symbol !== undefined ? { symbol: instruction.symbol } : {}),
        })),
        truncated: disassembly.truncated,
      }
    }
    case 'read_memory': {
      const memoryReference = requireArg('read_memory', 'memoryReference', args.memoryReference)
      const count = requireArg('read_memory', 'count', args.count)
      const read = await backend.readMemory({
        memoryReference,
        count,
        ...(args.offset !== undefined ? { offset: args.offset } : {}),
      })
      return {
        memoryReference,
        ...(read.address !== undefined ? { address: read.address } : {}),
        data: Buffer.from(read.data).toString('base64'),
        bytes: read.data.byteLength,
        ...(read.unreadableBytes !== undefined ? { unreadableBytes: read.unreadableBytes } : {}),
      }
    }
    case 'write_memory': {
      const memoryReference = requireArg('write_memory', 'memoryReference', args.memoryReference)
      const data = requireArg('write_memory', 'data', args.data)
      const written = await backend.writeMemory({
        memoryReference,
        data,
        ...(args.offset !== undefined ? { offset: args.offset } : {}),
        ...(args.allowPartial !== undefined ? { allowPartial: args.allowPartial } : {}),
      })
      return {
        memoryReference,
        ...(written.offset !== undefined ? { offset: written.offset } : {}),
        ...(written.bytesWritten !== undefined ? { bytesWritten: written.bytesWritten } : {}),
      }
    }
    case 'console': {
      const page = await backend.console()
      return {
        entries: page.entries.map(entry => ({
          category: entry.category,
          output: entry.output,
          ...(entry.groupId !== undefined ? { groupId: entry.groupId } : {}),
          ...(entry.variablesReference !== undefined ? { variablesReference: entry.variablesReference } : {}),
        })),
        nextOffset: page.nextOffset,
        truncated: page.truncated,
      }
    }
    /* v8 ignore next -- dispatch accepts the closed inspection operation union */
    default:
      assertNever(operation, 'debug_inspect dispatch')
  }
}
