/**
 * The debug tool dispatch: the closed vocabularies, operation-to-method
 * dispatch with typed arguments over a registered backend double, bounded
 * results, and the typed no-backend failure through the real registry.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { Debug, DebugError, DebugFrameId, DebugSourceReference, DebugThreadId, DebugVariableReference } from '@deepseek-ai/dsh-debug'
import type { DebugResumeResult, DebugSessionOperations, DebugStackTrace } from '@deepseek-ai/dsh-debug'
import { fixtureDebugSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { dispatchExecutionOperation, dispatchInspectOperation } from '../src/dispatch.ts'
import type { DebugExecutionArgs, DebugInspectArgs } from '../src/dispatch.ts'
import { DEBUG_TOOL_NAMES, parseDebugOperation, resolveSessionBackend } from '../src/tools.ts'

/** One stack page with no frames, the empty-backing shape every test shares. */
const emptyStack: DebugStackTrace = { frames: [], totalFrames: 0, truncated: false }

/**
 * One recording backend double: every method is a standalone spy with a
 * canned outcome, and `overrides` replaces the spies one test focuses on.
 * @param overrides - per-test method replacements.
 * @returns the spies; they satisfy the session operations contract.
 */
function backendSpies(overrides: Partial<DebugSessionOperations> = {}) {
  return {
    continue: vi.fn(async (): Promise<DebugResumeResult> => ({ kind: 'running' })),
    step: vi.fn(async (): Promise<DebugResumeResult> => ({ kind: 'running' })),
    pause: vi.fn(async () => {}),
    restartFrame: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    threads: vi.fn(async () => [{ id: DebugThreadId('1'), name: 'main' }]),
    currentThreadStack: vi.fn(async () => emptyStack),
    stackTrace: vi.fn(async () => emptyStack),
    scopes: vi.fn(async () => [{ name: 'Local', variablesReference: DebugVariableReference('7'), expensive: false }]),
    variables: vi.fn(async () => ({
      variables: [{ name: 'count', value: '3', variablesReference: DebugVariableReference('0'), memoryReference: '0x40' }],
      total: 1,
      truncated: false,
    })),
    evaluate: vi.fn(async () => ({ result: '4', variablesReference: DebugVariableReference('9'), memoryReference: '0x80' })),
    setVariable: vi.fn(async () => ({ name: 'count', value: '4', variablesReference: DebugVariableReference('9'), memoryReference: '0x80' })),
    setExpression: vi.fn(async () => ({ result: 'undefined', variablesReference: DebugVariableReference('0') })),
    completions: vi.fn(async () => [{ label: 'console.log', text: 'console.log(', start: 0, length: 8 }]),
    exceptionInfo: vi.fn(async () => ({ exceptionId: 'TypeError', description: 'boom', breakMode: 'unhandled' as const, details: { message: 'boom' } })),
    modules: vi.fn(async () => ({ modules: [{ id: 1, name: 'app', path: '/app', version: '1.0' }], totalModules: 1, truncated: false })),
    loadedSources: vi.fn(async () => [{ workspaceRelativePath: 'src/a.ts', absolutePath: '/ws/src/a.ts', sourceReference: DebugSourceReference('3') }]),
    source: vi.fn(async () => ({ content: 'line1', mimeType: 'text/javascript' })),
    breakpointLocations: vi.fn(async () => [{ line: 4 }, { line: 2, column: 8 }]),
    disassemble: vi.fn(async () => ({ instructions: [{ address: '0x1', instruction: 'nop', symbol: 'f' }], truncated: false })),
    readMemory: vi.fn(async () => ({ address: '0x1000', data: new Uint8Array([1, 2, 3]), unreadableBytes: 4 })),
    writeMemory: vi.fn(async () => ({ offset: 16, bytesWritten: 3 })),
    console: vi.fn(async () => ({
      entries: [{ category: 'stdout' as const, output: 'hi', groupId: 1, variablesReference: DebugVariableReference('5') }],
      nextOffset: 1,
      truncated: false,
    })),
    ...overrides,
  }
}

/** One execution-args record with the shared session id and per-test fields. */
function executionArgs(overrides: Partial<DebugExecutionArgs> = {}): DebugExecutionArgs {
  return { operation: 'continue', sessionId: 'debug-0000000000000001', ...overrides }
}

/** One inspect-args record with the shared session id and per-test fields. */
function inspectArgs(overrides: Partial<DebugInspectArgs> = {}): DebugInspectArgs {
  return { operation: 'threads', sessionId: 'debug-0000000000000001', ...overrides }
}

/** Mount the real debug service with its projection registry dependency. */
async function mountDebug(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(Debug)
  return ctx
}

describe('debug tool vocabulary', () => {
  it('registers exactly four tools', () => {
    expect(DEBUG_TOOL_NAMES).toEqual(['debug_session', 'debug_execution', 'debug_inspect', 'debug_breakpoints'])
  })

  it('rejects an unknown operation instead of falling through', () => {
    expect(() => parseDebugOperation('debug_execution', 'explode'))
      .toThrow(expect.objectContaining({ code: 'DEBUG_UNKNOWN_OPERATION' }))
    expect(() => parseDebugOperation('debug_session', 'launchh'))
      .toThrow(expect.objectContaining({ code: 'DEBUG_UNKNOWN_OPERATION' }))
  })

  it('accepts every documented operation', () => {
    expect(parseDebugOperation('debug_session', 'launch')).toBe('launch')
    expect(parseDebugOperation('debug_session', 'attach_targets')).toBe('attach_targets')
    expect(parseDebugOperation('debug_execution', 'step_over')).toBe('step_over')
    expect(parseDebugOperation('debug_execution', 'wait_for_stop')).toBe('wait_for_stop')
    expect(parseDebugOperation('debug_inspect', 'variables')).toBe('variables')
    expect(parseDebugOperation('debug_inspect', 'write_memory')).toBe('write_memory')
    expect(parseDebugOperation('debug_inspect', 'breakpoint_locations')).toBe('breakpoint_locations')
    expect(parseDebugOperation('debug_breakpoints', 'set_file')).toBe('set_file')
    expect(parseDebugOperation('debug_breakpoints', 'clear')).toBe('clear')
  })
})

describe('debug backend resolution', () => {
  it('fails typed when the session has no registered backend', async () => {
    const ctx = await mountDebug()
    const sessionId = fixtureDebugSessionId(21)
    expect(() => resolveSessionBackend(ctx.debug, sessionId, 'evaluate'))
      .toThrow(expect.objectContaining({ code: 'DEBUG_UNAVAILABLE' }))
  })

  it('resolves the registered backend and releases it with the disposer', async () => {
    const ctx = await mountDebug()
    const sessionId = fixtureDebugSessionId(22)
    const spies = backendSpies()
    const dispose = ctx.debug.registerBackend(sessionId, spies)
    expect(resolveSessionBackend(ctx.debug, sessionId, 'evaluate')).toBe(spies)
    dispose()
    expect(() => resolveSessionBackend(ctx.debug, sessionId, 'evaluate'))
      .toThrow(DebugError)
  })
})

describe('debug_execution dispatch', () => {
  it('dispatches continue with the requested thread', async () => {
    const spies = backendSpies()
    await dispatchExecutionOperation(spies, 'continue', executionArgs({ threadId: '4' }))
    expect(spies.continue).toHaveBeenCalledWith(DebugThreadId('4'))
  })

  it.each([
    ['step_over', 'over'],
    ['step_in', 'in'],
    ['step_out', 'out'],
    ['step_back', 'back'],
  ] as const)('dispatches %s as a %s step of the stopped thread', async (operation, kind) => {
    const spies = backendSpies()
    await dispatchExecutionOperation(spies, operation, executionArgs({}))
    expect(spies.step).toHaveBeenCalledWith(kind, undefined)
  })

  it('dispatches pause and reports it', async () => {
    const spies = backendSpies()
    await expect(dispatchExecutionOperation(spies, 'pause', executionArgs({}))).resolves.toEqual({ paused: true })
    expect(spies.pause).toHaveBeenCalledWith(undefined)
  })

  it('dispatches restart and reports it', async () => {
    const spies = backendSpies()
    await expect(dispatchExecutionOperation(spies, 'restart', executionArgs({ operation: 'restart' }))).resolves.toEqual({ restarted: true })
    expect(spies.restart).toHaveBeenCalled()
  })

  it('dispatches restart_frame with the branded frame id', async () => {
    const spies = backendSpies()
    await expect(dispatchExecutionOperation(spies, 'restart_frame', executionArgs({ operation: 'restart_frame', frameId: '2' })))
      .resolves.toEqual({ frameId: '2', restarted: true })
    expect(spies.restartFrame).toHaveBeenCalledWith(DebugFrameId('2'))
  })

  it('fails typed when restart_frame carries no frame id', async () => {
    const spies = backendSpies()
    await expect(dispatchExecutionOperation(spies, 'restart_frame', executionArgs({ operation: 'restart_frame' })))
      .rejects.toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })

  it('renders every resume settlement', async () => {
    const stopBase = {
      sessionId: fixtureDebugSessionId(3),
      reason: 'breakpoint' as const,
      threadId: DebugThreadId('2'),
      source: { workspaceRelativePath: 'src/a.ts', absolutePath: '/ws/src/a.ts' },
      line: 5,
      column: 1,
    }
    const spies = backendSpies({
      continue: vi.fn(async (): Promise<DebugResumeResult> => ({
        kind: 'stopped',
        stop: { ...stopBase, frameId: DebugFrameId('9'), description: 'hit' },
      })),
      step: vi.fn(async (): Promise<DebugResumeResult> => ({ kind: 'stopped', stop: stopBase })),
    })
    await expect(dispatchExecutionOperation(spies, 'continue', executionArgs({}))).resolves.toEqual({
      kind: 'stopped',
      stop: {
        sessionId: 'debug-0000000000000003',
        reason: 'breakpoint',
        threadId: '2',
        frameId: '9',
        source: 'src/a.ts',
        line: 5,
        column: 1,
        description: 'hit',
      },
    })
    await expect(dispatchExecutionOperation(spies, 'step_over', executionArgs({ operation: 'step_over' }))).resolves.toEqual({
      kind: 'stopped',
      stop: {
        sessionId: 'debug-0000000000000003',
        reason: 'breakpoint',
        threadId: '2',
        source: 'src/a.ts',
        line: 5,
        column: 1,
      },
    })
    const ended = backendSpies({ continue: vi.fn(async (): Promise<DebugResumeResult> => ({ kind: 'terminated' })) })
    await expect(dispatchExecutionOperation(ended, 'continue', executionArgs({}))).resolves.toEqual({ kind: 'terminated' })
    const running = backendSpies()
    await expect(dispatchExecutionOperation(running, 'continue', executionArgs({}))).resolves.toEqual({ kind: 'running' })
  })

  it('fails typed for wait_for_stop until its stop-event face lands', async () => {
    const spies = backendSpies()
    await expect(dispatchExecutionOperation(spies, 'wait_for_stop', executionArgs({ operation: 'wait_for_stop' })))
      .rejects.toThrow(expect.objectContaining({ code: 'DEBUG_UNAVAILABLE' }))
  })
})

describe('debug_inspect dispatch', () => {
  it('lists threads', async () => {
    const spies = backendSpies()
    await expect(dispatchInspectOperation(spies, 'threads', inspectArgs({}))).resolves.toEqual({
      threads: [{ id: '1', name: 'main' }],
    })
  })

  it('reads the stopped thread stack and one named thread stack', async () => {
    const spies = backendSpies({
      currentThreadStack: vi.fn(async () => ({
        frames: [{ id: DebugFrameId('1'), name: 'main', source: { workspaceRelativePath: 'src/a.ts', absolutePath: '/ws/src/a.ts' }, line: 4, column: 2 }],
        totalFrames: 1,
        truncated: false,
      })),
      stackTrace: vi.fn(async () => ({ frames: [{ id: DebugFrameId('2'), name: 'worker' }], totalFrames: 1, truncated: true })),
    })
    await expect(dispatchInspectOperation(spies, 'stack_trace', inspectArgs({}))).resolves.toEqual({
      frames: [{ id: '1', name: 'main', source: 'src/a.ts', line: 4, column: 2 }],
      truncated: false,
      total: 1,
    })
    await expect(dispatchInspectOperation(spies, 'stack_trace', inspectArgs({ threadId: '4' }))).resolves.toEqual({
      frames: [{ id: '2', name: 'worker' }],
      truncated: true,
      total: 1,
    })
    expect(spies.stackTrace).toHaveBeenCalledWith(DebugThreadId('4'))
  })

  it('lists the scopes of one frame', async () => {
    const spies = backendSpies()
    await expect(dispatchInspectOperation(spies, 'scopes', inspectArgs({ operation: 'scopes', frameId: '3' }))).resolves.toEqual({
      scopes: [{ name: 'Local', variablesReference: '7', expensive: false }],
    })
    expect(spies.scopes).toHaveBeenCalledWith(DebugFrameId('3'))
  })

  it('expands one variables container with totals and anchors', async () => {
    const spies = backendSpies()
    await expect(dispatchInspectOperation(spies, 'variables', inspectArgs({ operation: 'variables', variablesReference: '7' }))).resolves.toEqual({
      variables: [{ name: 'count', value: '3', variablesReference: '0', memoryReference: '0x40' }],
      total: 1,
      truncated: false,
    })
    expect(spies.variables).toHaveBeenCalledWith(DebugVariableReference('7'))
  })

  it('evaluates one expression in the repl context of the frame', async () => {
    const spies = backendSpies()
    await expect(dispatchInspectOperation(spies, 'evaluate', inspectArgs({ operation: 'evaluate', expression: '1+1', frameId: '3' }))).resolves.toEqual({
      result: '4',
      variablesReference: '9',
      memoryReference: '0x80',
    })
    expect(spies.evaluate).toHaveBeenCalledWith('1+1', 'repl', DebugFrameId('3'))
  })

  it('bounds an oversized evaluation value', async () => {
    const spies = backendSpies({
      evaluate: vi.fn(async () => ({ result: 'x'.repeat(300), variablesReference: DebugVariableReference('0') })),
    })
    await expect(dispatchInspectOperation(spies, 'evaluate', inspectArgs({ operation: 'evaluate', expression: 'big' }))).resolves.toEqual({
      result: `${'x'.repeat(200)}… (truncated 300 chars)`,
      variablesReference: '0',
    })
  })

  it('assigns one variable through its container', async () => {
    const spies = backendSpies()
    await expect(dispatchInspectOperation(spies, 'set_variable', inspectArgs({
      operation: 'set_variable',
      variablesReference: '5',
      name: 'count',
      value: '42',
    }))).resolves.toEqual({
      name: 'count',
      value: '4',
      variablesReference: '9',
      memoryReference: '0x80',
    })
    expect(spies.setVariable).toHaveBeenCalledWith(DebugVariableReference('5'), 'count', '42')
  })

  it('assigns one expression in the frame', async () => {
    const spies = backendSpies()
    await expect(dispatchInspectOperation(spies, 'set_expression', inspectArgs({
      operation: 'set_expression',
      expression: 'x',
      value: '1',
      frameId: '3',
    }))).resolves.toEqual({
      result: 'undefined',
      variablesReference: '0',
    })
    expect(spies.setExpression).toHaveBeenCalledWith('x', '1', DebugFrameId('3'))
  })

  it('completes one repl line at the cursor column', async () => {
    const spies = backendSpies()
    await expect(dispatchInspectOperation(spies, 'completions', inspectArgs({ operation: 'completions', text: 'console.', column: 8 }))).resolves.toEqual({
      completions: [{ label: 'console.log', text: 'console.log(', start: 0, length: 8 }],
    })
    expect(spies.completions).toHaveBeenCalledWith('console.', 8, undefined)
  })

  it('fails typed when a required argument is missing', async () => {
    const spies = backendSpies()
    await expect(dispatchInspectOperation(spies, 'evaluate', inspectArgs({ operation: 'evaluate' })))
      .rejects.toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    await expect(dispatchInspectOperation(spies, 'completions', inspectArgs({ operation: 'completions', text: 'a' })))
      .rejects.toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })

  it('reports the exception of one stopped thread', async () => {
    const bare = backendSpies({
      exceptionInfo: vi.fn(async () => ({ exceptionId: 'TypeError', breakMode: 'never' as const })),
    })
    await expect(dispatchInspectOperation(bare, 'exception_info', inspectArgs({ operation: 'exception_info', threadId: '4' }))).resolves.toEqual({
      exceptionId: 'TypeError',
      breakMode: 'never',
    })
    const rich = backendSpies()
    await expect(dispatchInspectOperation(rich, 'exception_info', inspectArgs({ operation: 'exception_info', threadId: '4' }))).resolves.toEqual({
      exceptionId: 'TypeError',
      description: 'boom',
      breakMode: 'unhandled',
      details: { message: 'boom' },
    })
  })

  it('pages modules with totals', async () => {
    const bare = backendSpies({
      modules: vi.fn(async () => ({ modules: [{ id: 'm', name: 'app' }], totalModules: 2, truncated: true })),
    })
    await expect(dispatchInspectOperation(bare, 'modules', inspectArgs({ operation: 'modules' }))).resolves.toEqual({
      modules: [{ id: 'm', name: 'app' }],
      totalModules: 2,
      truncated: true,
    })
    const rich = backendSpies()
    await expect(dispatchInspectOperation(rich, 'modules', inspectArgs({ operation: 'modules' }))).resolves.toEqual({
      modules: [{ id: 1, name: 'app', path: '/app', version: '1.0' }],
      totalModules: 1,
      truncated: false,
    })
  })

  it('lists loaded sources with their content references', async () => {
    const bare = backendSpies({
      loadedSources: vi.fn(async () => [{ workspaceRelativePath: 'src/b.ts', absolutePath: '/ws/src/b.ts' }]),
    })
    await expect(dispatchInspectOperation(bare, 'loaded_sources', inspectArgs({ operation: 'loaded_sources' }))).resolves.toEqual({
      sources: [{ path: 'src/b.ts' }],
    })
    const rich = backendSpies()
    await expect(dispatchInspectOperation(rich, 'loaded_sources', inspectArgs({ operation: 'loaded_sources' }))).resolves.toEqual({
      sources: [{ path: 'src/a.ts', sourceReference: '3' }],
    })
  })

  it('fetches one dynamic source by reference', async () => {
    const bare = backendSpies({
      source: vi.fn(async () => ({ content: 'line1' })),
    })
    await expect(dispatchInspectOperation(bare, 'source', inspectArgs({ operation: 'source', sourceReference: '3' }))).resolves.toEqual({
      content: 'line1',
    })
    const rich = backendSpies()
    await expect(dispatchInspectOperation(rich, 'source', inspectArgs({ operation: 'source', sourceReference: '3' }))).resolves.toEqual({
      content: 'line1',
      mimeType: 'text/javascript',
    })
    expect(bare.source).toHaveBeenCalledWith(DebugSourceReference('3'))
  })

  it('resolves breakpoint locations for a source range, sorted by position', async () => {
    const spies = backendSpies()
    await expect(dispatchInspectOperation(spies, 'breakpoint_locations', inspectArgs({
      operation: 'breakpoint_locations',
      file: 'src/a.ts',
      line: 2,
      endLine: 4,
      column: 1,
      endColumn: 40,
    }))).resolves.toEqual({
      locations: [{ line: 2, column: 8 }, { line: 4 }],
    })
    expect(spies.breakpointLocations).toHaveBeenCalledWith({
      source: { workspaceRelativePath: 'src/a.ts', absolutePath: 'src/a.ts' },
      line: 2,
      column: 1,
      endLine: 4,
      endColumn: 40,
    })
    const bare = backendSpies({
      breakpointLocations: vi.fn(async () => [{ line: 6, endLine: 8, endColumn: 3 }]),
    })
    await expect(dispatchInspectOperation(bare, 'breakpoint_locations', inspectArgs({ operation: 'breakpoint_locations', file: 'a.py', line: 6 }))).resolves.toEqual({
      locations: [{ line: 6, endLine: 8, endColumn: 3 }],
    })
    expect(bare.breakpointLocations).toHaveBeenCalledWith({
      source: { workspaceRelativePath: 'a.py', absolutePath: 'a.py' },
      line: 6,
    })
  })

  it('disassembles one instruction range', async () => {
    const bare = backendSpies({
      disassemble: vi.fn(async () => ({ instructions: [{ address: '0x1', instruction: 'nop' }], truncated: true })),
    })
    await expect(dispatchInspectOperation(bare, 'disassemble', inspectArgs({
      operation: 'disassemble',
      memoryReference: '0x1000',
      instructionCount: 10,
    }))).resolves.toEqual({
      instructions: [{ address: '0x1', instruction: 'nop' }],
      truncated: true,
    })
    const rich = backendSpies()
    await dispatchInspectOperation(rich, 'disassemble', inspectArgs({
      operation: 'disassemble',
      memoryReference: '0x1000',
      instructionCount: 10,
      instructionOffset: -2,
      offset: 4,
    }))
    expect(rich.disassemble).toHaveBeenCalledWith({
      memoryReference: '0x1000',
      instructionCount: 10,
      instructionOffset: -2,
      offset: 4,
    })
  })

  it('reads memory as base64 with the resolved address and unreadable tail', async () => {
    const spies = backendSpies()
    await expect(dispatchInspectOperation(spies, 'read_memory', inspectArgs({
      operation: 'read_memory',
      memoryReference: '0x1000',
      count: 3,
      offset: 8,
    }))).resolves.toEqual({
      memoryReference: '0x1000',
      address: '0x1000',
      data: 'AQID',
      bytes: 3,
      unreadableBytes: 4,
    })
    expect(spies.readMemory).toHaveBeenCalledWith({ memoryReference: '0x1000', count: 3, offset: 8 })
    const bare = backendSpies({
      readMemory: vi.fn(async () => ({ data: new Uint8Array([]) })),
    })
    await expect(dispatchInspectOperation(bare, 'read_memory', inspectArgs({ operation: 'read_memory', memoryReference: '0x1000', count: 0 }))).resolves.toEqual({
      memoryReference: '0x1000',
      data: '',
      bytes: 0,
    })
  })

  it('writes memory and surfaces the adapter write report', async () => {
    const spies = backendSpies()
    await expect(dispatchInspectOperation(spies, 'write_memory', inspectArgs({
      operation: 'write_memory',
      memoryReference: '0x1000',
      data: 'AQID',
      offset: 16,
      allowPartial: true,
    }))).resolves.toEqual({
      memoryReference: '0x1000',
      offset: 16,
      bytesWritten: 3,
    })
    expect(spies.writeMemory).toHaveBeenCalledWith({ memoryReference: '0x1000', data: 'AQID', offset: 16, allowPartial: true })
    const bare = backendSpies({
      writeMemory: vi.fn(async () => ({})),
    })
    await expect(dispatchInspectOperation(bare, 'write_memory', inspectArgs({ operation: 'write_memory', memoryReference: '0x1000', data: '' }))).resolves.toEqual({
      memoryReference: '0x1000',
    })
  })

  it('pages the console ring with the next cursor', async () => {
    const spies = backendSpies()
    await expect(dispatchInspectOperation(spies, 'console', inspectArgs({ operation: 'console' }))).resolves.toEqual({
      entries: [{ category: 'stdout', output: 'hi', groupId: 1, variablesReference: '5' }],
      nextOffset: 1,
      truncated: false,
    })
    const bare = backendSpies({
      console: vi.fn(async () => ({ entries: [{ category: 'stderr' as const, output: 'bad' }], nextOffset: 2, truncated: true })),
    })
    await expect(dispatchInspectOperation(bare, 'console', inspectArgs({ operation: 'console' }))).resolves.toEqual({
      entries: [{ category: 'stderr', output: 'bad' }],
      nextOffset: 2,
      truncated: true,
    })
  })
})
