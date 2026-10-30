/**
 * The controller's session-operation remotes: each forwards its wire
 * parameters to the registered session backend under the seam's branded
 * ids, returns the backend's answer unchanged, rejects every operation with
 * `DEBUG_SESSION_GONE` once no backend stays registered, and carries memory
 * bytes as base64 (standard alphabet) on the wire in both directions.
 */
import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { fixtureDebugSessionId } from '@deepseek-ai/dsh-debug-fixture'
import Debug, { DebugFrameId, DebugSourceReference, DebugThreadId, DebugVariableReference } from '@deepseek-ai/dsh-debug/src/index.ts'
import type {
  DebugBreakpointLocationsRequest,
  DebugBreakpointLocation,
  DebugCompletion,
  DebugConsolePage,
  DebugDisassembleRequest,
  DebugDisassembly,
  DebugEvaluateResult,
  DebugExceptionInfo,
  DebugModulesPage,
  DebugReadMemoryRequest,
  DebugReadMemoryResult,
  DebugScopeInfo,
  DebugSource,
  DebugSourceContent,
  DebugThread,
  DebugVariable,
  DebugVariablesPage,
  DebugWriteMemoryRequest,
  DebugWriteMemoryResult,
} from '@deepseek-ai/dsh-debug/types'
import { DEFAULT_DEBUG_EVENT_RING_LIMIT, DebugController } from '../src/index.ts'
import { fakeBackend } from './helpers/fake-backend.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

/** Mount the debug service and this controller on one fresh context. */
async function mount(): Promise<{ controller: DebugController; debug: InstanceType<typeof Debug> }> {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(Debug)
  const controller = new DebugController(ctx, { eventRingLimit: DEFAULT_DEBUG_EVENT_RING_LIMIT })
  return { controller, debug: ctx.debug }
}

const threadsValue: readonly DebugThread[] = [{ id: DebugThreadId('thread-1'), name: 'main' }]
const scopesValue: readonly DebugScopeInfo[] = [{ name: 'Local', variablesReference: DebugVariableReference('vars-scopes'), expensive: false }]
const variablesPageValue: DebugVariablesPage = {
  variables: [{ name: 'count', value: '3', variablesReference: DebugVariableReference('vars-leaf') }],
  total: 1,
  truncated: false,
}
const variableRowValue: DebugVariable = { name: 'count', value: '4', variablesReference: DebugVariableReference('vars-leaf') }
const evaluateValue: DebugEvaluateResult = { result: '4', variablesReference: DebugVariableReference('vars-leaf') }
const completionsValue: readonly DebugCompletion[] = [{ label: 'counter' }, { label: 'count', start: 0, length: 3 }]
const exceptionValue: DebugExceptionInfo = { exceptionId: 'TypeError', breakMode: 'unhandled' }
const modulesPageValue: DebugModulesPage = { modules: [{ id: 1, name: 'app' }], totalModules: 1, truncated: false }
const sourcesValue: readonly DebugSource[] = [{ workspaceRelativePath: 'src/main.ts', absolutePath: '/ws/src/main.ts' }]
const sourceContentValue: DebugSourceContent = { content: 'let x = 1\n' }
const locationsValue: readonly DebugBreakpointLocation[] = [{ line: 3, column: 1 }]
const disassemblyValue: DebugDisassembly = { instructions: [{ address: '0x1000', instruction: 'ret' }], truncated: false }
const writeMemoryValue: DebugWriteMemoryResult = { offset: 3, bytesWritten: 2 }
const consolePageValue: DebugConsolePage = { entries: [{ category: 'stdout', output: 'hello\n' }], nextOffset: 1, truncated: false }
const locationsRequestValue: DebugBreakpointLocationsRequest = { source: sourcesValue[0]!, line: 3 }
const disassembleRequestValue: DebugDisassembleRequest = { memoryReference: 'mem-1', instructionCount: 4 }

describe('debug controller session-operation remotes', () => {
  it('restarts one frame on the session backend', async () => {
    const { controller, debug } = await mount()
    const restartFrame = vi.fn(async (_frameId: DebugFrameId) => {})
    debug.registerBackend(fixtureDebugSessionId(21), fakeBackend({ restartFrame }))
    await controller.executionRestartFrame(String(fixtureDebugSessionId(21)), 'frame-7')
    expect(restartFrame).toHaveBeenCalledTimes(1)
    expect(restartFrame).toHaveBeenCalledWith(DebugFrameId('frame-7'))
  })

  it('restarts, terminates, and disconnects the session backend', async () => {
    const { controller, debug } = await mount()
    const id = fixtureDebugSessionId(20)
    const restart = vi.fn(async () => {})
    const terminate = vi.fn(async () => {})
    const disconnect = vi.fn(async () => {})
    debug.registerBackend(id, fakeBackend({ restart, terminate, disconnect }))
    await controller.executionRestart(String(id))
    await controller.executionTerminate(String(id))
    await controller.executionDisconnect(String(id))
    expect(restart).toHaveBeenCalledTimes(1)
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('reads threads, scopes, and one variable page', async () => {
    const { controller, debug } = await mount()
    const id = fixtureDebugSessionId(22)
    const threads = vi.fn(async () => threadsValue)
    const scopes = vi.fn(async (_frameId: DebugFrameId) => scopesValue)
    const variables = vi.fn(async (_reference: DebugVariableReference, _options?: { start: number; count: number }) => variablesPageValue)
    debug.registerBackend(id, fakeBackend({ threads, scopes, variables }))
    await expect(controller.inspectThreads(String(id))).resolves.toBe(threadsValue)
    await expect(controller.inspectScopes(String(id), 'frame-7')).resolves.toBe(scopesValue)
    expect(scopes).toHaveBeenCalledWith(DebugFrameId('frame-7'))
    await expect(controller.inspectVariables(String(id), 'vars-scopes', { start: 0, count: 10 })).resolves.toBe(variablesPageValue)
    expect(variables).toHaveBeenCalledWith(DebugVariableReference('vars-scopes'), { start: 0, count: 10 })
  })

  it('assigns variables and expressions and returns the adapter renderings', async () => {
    const { controller, debug } = await mount()
    const id = fixtureDebugSessionId(23)
    const setVariable = vi.fn(async (_reference: DebugVariableReference, _name: string, _value: string) => variableRowValue)
    const setExpression = vi.fn(async (_expression: string, _value: string, _frameId?: DebugFrameId) => evaluateValue)
    debug.registerBackend(id, fakeBackend({ setVariable, setExpression }))
    await expect(controller.inspectSetVariable(String(id), 'vars-scopes', 'count', '4')).resolves.toBe(variableRowValue)
    expect(setVariable).toHaveBeenCalledWith(DebugVariableReference('vars-scopes'), 'count', '4')
    await expect(controller.inspectSetExpression(String(id), 'a.b', '2', 'frame-7')).resolves.toBe(evaluateValue)
    expect(setExpression).toHaveBeenCalledWith('a.b', '2', DebugFrameId('frame-7'))
    await controller.inspectSetExpression(String(id), 'a.b', '2')
    expect(setExpression).toHaveBeenLastCalledWith('a.b', '2', undefined)
  })

  it('completes REPL lines and reports one stopped thread exception', async () => {
    const { controller, debug } = await mount()
    const id = fixtureDebugSessionId(24)
    const completions = vi.fn(async (_text: string, _column: number, _frameId?: DebugFrameId) => completionsValue)
    const exceptionInfo = vi.fn(async (_threadId: DebugThreadId) => exceptionValue)
    debug.registerBackend(id, fakeBackend({ completions, exceptionInfo }))
    await expect(controller.inspectCompletions(String(id), 'cou', 3)).resolves.toBe(completionsValue)
    expect(completions).toHaveBeenCalledWith('cou', 3, undefined)
    await expect(controller.inspectExceptionInfo(String(id), 'thread-1')).resolves.toBe(exceptionValue)
    expect(exceptionInfo).toHaveBeenCalledWith(DebugThreadId('thread-1'))
  })

  it('pages modules and lists loaded sources', async () => {
    const { controller, debug } = await mount()
    const id = fixtureDebugSessionId(25)
    const modules = vi.fn(async (_options?: { startModule: number }) => modulesPageValue)
    const loadedSources = vi.fn(async () => sourcesValue)
    debug.registerBackend(id, fakeBackend({ modules, loadedSources }))
    await expect(controller.inspectModules(String(id), { startModule: 0 })).resolves.toBe(modulesPageValue)
    expect(modules).toHaveBeenCalledWith({ startModule: 0 })
    await expect(controller.inspectLoadedSources(String(id))).resolves.toBe(sourcesValue)
  })

  it('fetches one dynamic source by its content reference', async () => {
    const { controller, debug } = await mount()
    const id = fixtureDebugSessionId(26)
    const source = vi.fn(async (_sourceReference: DebugSourceReference) => sourceContentValue)
    debug.registerBackend(id, fakeBackend({ source }))
    await expect(controller.inspectSource(String(id), 'src-5')).resolves.toBe(sourceContentValue)
    expect(source).toHaveBeenCalledWith(DebugSourceReference('src-5'))
  })

  it('resolves legal breakpoint positions for one source range', async () => {
    const { controller, debug } = await mount()
    const id = fixtureDebugSessionId(27)
    const breakpointLocations = vi.fn(async (_request: DebugBreakpointLocationsRequest) => locationsValue)
    debug.registerBackend(id, fakeBackend({ breakpointLocations }))
    await expect(controller.inspectBreakpointLocations(String(id), locationsRequestValue)).resolves.toBe(locationsValue)
    expect(breakpointLocations).toHaveBeenCalledWith(locationsRequestValue)
  })

  it('disassembles one instruction range', async () => {
    const { controller, debug } = await mount()
    const id = fixtureDebugSessionId(28)
    const disassemble = vi.fn(async (_request: DebugDisassembleRequest) => disassemblyValue)
    debug.registerBackend(id, fakeBackend({ disassemble }))
    await expect(controller.inspectDisassemble(String(id), disassembleRequestValue)).resolves.toBe(disassemblyValue)
    expect(disassemble).toHaveBeenCalledWith(disassembleRequestValue)
  })

  it('carries memory reads as base64 on the wire and round-trips the bytes', async () => {
    const { controller, debug } = await mount()
    const id = fixtureDebugSessionId(29)
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    const readMemory = vi.fn(async (_request: DebugReadMemoryRequest): Promise<DebugReadMemoryResult> => ({ address: '0x1000', data: bytes, unreadableBytes: 2 }))
    debug.registerBackend(id, fakeBackend({ readMemory }))
    const result = await controller.inspectReadMemory(String(id), { memoryReference: 'mem-1', count: 7, offset: 4 })
    expect(readMemory).toHaveBeenCalledWith({ memoryReference: 'mem-1', count: 7, offset: 4 })
    expect(result.address).toBe('0x1000')
    expect(result.unreadableBytes).toBe(2)
    expect(result.data).toBe(Buffer.from(bytes).toString('base64'))
    expect(Array.from(Buffer.from(result.data, 'base64'))).toEqual(Array.from(bytes))
  })

  it('omits unread members from the memory wire result', async () => {
    const { controller, debug } = await mount()
    const id = fixtureDebugSessionId(30)
    const readMemory = vi.fn(async (): Promise<DebugReadMemoryResult> => ({ data: new Uint8Array(0) }))
    debug.registerBackend(id, fakeBackend({ readMemory }))
    const result = await controller.inspectReadMemory(String(id), { memoryReference: 'mem-1', count: 4 })
    expect(result).not.toHaveProperty('address')
    expect(result).not.toHaveProperty('unreadableBytes')
    expect(result.data).toBe('')
  })

  it('writes memory with the base64 payload and surfaces the partial-write outcome', async () => {
    const { controller, debug } = await mount()
    const id = fixtureDebugSessionId(31)
    const writeMemory = vi.fn(async (_request: DebugWriteMemoryRequest) => writeMemoryValue)
    debug.registerBackend(id, fakeBackend({ writeMemory }))
    await expect(controller.inspectWriteMemory(String(id), { memoryReference: 'mem-1', data: 'AAEC', allowPartial: true })).resolves.toBe(writeMemoryValue)
    expect(writeMemory).toHaveBeenCalledWith({ memoryReference: 'mem-1', data: 'AAEC', allowPartial: true })
  })

  it('pages console output by cursor', async () => {
    const { controller, debug } = await mount()
    const id = fixtureDebugSessionId(32)
    const readConsole = vi.fn(async (_options?: { offset: number; limit: number }) => consolePageValue)
    debug.registerBackend(id, fakeBackend({ console: readConsole }))
    await expect(controller.inspectConsole(String(id), { offset: 0, limit: 1 })).resolves.toBe(consolePageValue)
    expect(readConsole).toHaveBeenCalledWith({ offset: 0, limit: 1 })
  })

  it('answers through a live registration and rejects after its disposer runs', async () => {
    const { controller, debug } = await mount()
    const id = fixtureDebugSessionId(33)
    const threads = vi.fn(async () => threadsValue)
    const dispose = debug.registerBackend(id, fakeBackend({ threads }))
    await expect(controller.inspectThreads(String(id))).resolves.toBe(threadsValue)
    dispose()
    await expect(controller.inspectThreads(String(id))).rejects.toMatchObject({ code: 'DEBUG_SESSION_GONE' })
  })

  it('answers DEBUG_SESSION_GONE for every session remote without a registered backend', async () => {
    const { controller } = await mount()
    const missing = String(fixtureDebugSessionId(99))
    const calls = [
      () => controller.executionContinue(missing),
      () => controller.executionRestartFrame(missing, 'frame-7'),
      () => controller.executionRestart(missing),
      () => controller.executionTerminate(missing),
      () => controller.executionDisconnect(missing),
      () => controller.inspectThreads(missing),
      () => controller.inspectScopes(missing, 'frame-7'),
      () => controller.inspectVariables(missing, 'vars-scopes'),
      () => controller.inspectSetVariable(missing, 'vars-scopes', 'count', '4'),
      () => controller.inspectSetExpression(missing, 'a.b', '2'),
      () => controller.inspectCompletions(missing, 'a', 0),
      () => controller.inspectExceptionInfo(missing, 'thread-1'),
      () => controller.inspectModules(missing),
      () => controller.inspectLoadedSources(missing),
      () => controller.inspectSource(missing, 'src-5'),
      () => controller.inspectBreakpointLocations(missing, locationsRequestValue),
      () => controller.inspectDisassemble(missing, disassembleRequestValue),
      () => controller.inspectReadMemory(missing, { memoryReference: 'mem-1', count: 4 }),
      () => controller.inspectWriteMemory(missing, { memoryReference: 'mem-1', data: 'AAEC' }),
      () => controller.inspectConsole(missing),
    ]
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ code: 'DEBUG_SESSION_GONE' })
    }
  })
})
