import { describe, expect, it } from 'vitest'
import { DebugBreakpointId, DebugSessionId } from '@deepseek-ai/dsh-debug'
import { fixtureDebugSessionId, fixtureSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { createDebugPaneState, foldDebugEvent, renderDebugPaneLines } from '../src/panels.ts'

/** Fold one event into a fresh state for one-line test setups. */
function folded(event: Parameters<typeof foldDebugEvent>[1], options?: Parameters<typeof foldDebugEvent>[2]) {
  return foldDebugEvent(createDebugPaneState(), event, options)
}

/** One applied breakpoint row fixture. */
function appliedBreakpoint(id: string, file: string, line: number, verified: boolean) {
  return {
    id: DebugBreakpointId(id),
    source: { workspaceRelativePath: file, absolutePath: `/ws/${file}` },
    requestedLine: line,
    verified,
  }
}

describe('TUI debug pane reducer', () => {
  it('starts empty with bounded defaults', () => {
    const state = createDebugPaneState()
    expect(state).toEqual({
      sessions: [],
      activeSessionId: undefined,
      console: [],
      breakpoints: [],
      stack: [],
      variables: [],
      watch: [],
      source: undefined,
    })
    expect(renderDebugPaneLines(state)).toEqual(['debug: no sessions'])
  })

  it('tracks session lifecycle rows and picks the first active session', () => {
    const id = fixtureDebugSessionId(1)
    let state = folded({ kind: 'session/starting', sessionId: id, workspaceId: 'ws-1' })
    expect(state.sessions).toEqual([{ id, workspaceId: 'ws-1', state: 'starting', actor: undefined }])
    expect(state.activeSessionId).toBe(id)
    state = foldDebugEvent(state, { kind: 'session/running', sessionId: id, workspaceId: 'ws-1' })
    expect(state.sessions[0]?.state).toBe('running')
    state = foldDebugEvent(state, { kind: 'session/stopped', sessionId: id, workspaceId: 'ws-1' })
    expect(state.sessions[0]?.state).toBe('stopped')
    state = foldDebugEvent(state, { kind: 'session/failed', sessionId: id, workspaceId: 'ws-1' })
    expect(state.sessions[0]?.state).toBe('failed')
    state = foldDebugEvent(state, { kind: 'session/terminated', sessionId: id, workspaceId: 'ws-1', actor: 'agent' })
    expect(state.sessions).toEqual([{ id, workspaceId: 'ws-1', state: 'terminated', actor: 'agent' }])
  })

  it('keeps the first session active while later ones register', () => {
    const first = fixtureDebugSessionId(1)
    const second = fixtureDebugSessionId(2)
    let state = folded({ kind: 'session/starting', sessionId: first, workspaceId: 'ws-1' })
    state = foldDebugEvent(state, { kind: 'session/starting', sessionId: second, workspaceId: 'ws-1' })
    expect(state.activeSessionId).toBe(first)
    expect(state.sessions).toHaveLength(2)
  })

  it('folds console and adapter output into a bounded ring', () => {
    const id = fixtureDebugSessionId(3)
    const options = { maxConsoleEntries: 2 }
    let state = foldDebugEvent(createDebugPaneState(), { kind: 'console/output', sessionId: id, workspaceId: 'ws-1', text: 'hello', truncated: false }, options)
    state = foldDebugEvent(state, { kind: 'adapter/output', sessionId: id, workspaceId: 'ws-1', text: 'DAP frame', truncated: true }, options)
    state = foldDebugEvent(state, { kind: 'console/output', sessionId: id, workspaceId: 'ws-1', text: 'world', truncated: false }, options)
    expect(state.console).toEqual([
      { channel: 'adapter', text: 'DAP frame', truncated: true },
      { channel: 'console', text: 'world', truncated: false },
    ])
  })

  it('rebuilds breakpoint rows from one per-file breakpoint/changed event', () => {
    const id = fixtureDebugSessionId(4)
    const state = folded({
      kind: 'breakpoint/changed',
      sessionId: id,
      workspaceId: 'ws-1',
      result: {
        applied: [{ ...appliedBreakpoint('debug-b2', 'src/b.ts', 9, false), actualLine: 10 }],
        rejected: [
          { ...appliedBreakpoint('debug-b3', 'src/b.ts', 2, false), message: 'no code' },
        ],
      },
    })
    expect(state.breakpoints).toEqual([
      { sessionId: id, file: 'src/b.ts', line: 9, verified: false, actualLine: 10 },
      { sessionId: id, file: 'src/b.ts', line: 2, verified: false, message: 'no code' },
    ])
  })

  it('merges per-file breakpoint events, keeping rows the registry still holds for other files', () => {
    const id = fixtureDebugSessionId(4)
    let state = folded({
      kind: 'breakpoint/changed',
      sessionId: id,
      workspaceId: 'ws-1',
      result: { applied: [appliedBreakpoint('debug-b1', 'src/a.ts', 4, true)], rejected: [] },
    })
    state = foldDebugEvent(state, {
      kind: 'breakpoint/changed',
      sessionId: id,
      workspaceId: 'ws-1',
      result: { applied: [{ ...appliedBreakpoint('debug-b2', 'src/b.ts', 9, false), actualLine: 10 }], rejected: [] },
    })
    expect(state.breakpoints).toEqual([
      { sessionId: id, file: 'src/a.ts', line: 4, verified: true },
      { sessionId: id, file: 'src/b.ts', line: 9, verified: false, actualLine: 10 },
    ])
  })

  it('records ownership changes as console notices and ignores capability changes', () => {
    const id = fixtureDebugSessionId(5)
    let state = folded({
      kind: 'session/owner-changed',
      sessionId: id,
      workspaceId: 'ws-1',
      from: { kind: 'user', sessionId: fixtureSessionId(1) },
      to: { kind: 'agent', sessionId: fixtureSessionId(2) },
    })
    expect(state.console.at(-1)?.text).toContain(id)
    const before = state
    state = foldDebugEvent(state, { kind: 'capabilities/changed', sessionId: id, workspaceId: 'ws-1', capabilities: { supportsConditionalBreakpoints: false, supportsHitConditionalBreakpoints: false, supportsLogPoints: false, supportsFunctionBreakpoints: false, supportsDataBreakpoints: false, supportsInstructionBreakpoints: false, supportsExceptionFilterOptions: false, supportsStepBack: false, supportsRestartFrame: false, supportsSetVariable: false, supportsSetExpression: false, supportsCompletionsRequest: false, supportsModulesRequest: false, supportsLoadedSourcesRequest: false, supportsDisassembleRequest: false, supportsReadMemoryRequest: false, supportsWriteMemoryRequest: false, supportsTerminateRequest: false, supportsRestartRequest: false, supportsDelayedStackTraceLoading: false, supportsValueFormattingOptions: false, supportsEvaluateForHovers: false, supportsExceptionInfoRequest: false, supportsCancelRequest: false, supportsANSIStyling: false, supportsProgressReporting: false, supportsRunInTerminalRequest: false, supportsStartDebuggingRequest: false } })
    expect(state).toEqual(before)
  })

  it('renders sessions, breakpoints, and console sections and hides empty ones', () => {
    const id = fixtureDebugSessionId(6)
    let state = folded({ kind: 'session/starting', sessionId: id, workspaceId: 'ws-1' })
    state = foldDebugEvent(state, { kind: 'session/running', sessionId: id, workspaceId: 'ws-1' })
    state = foldDebugEvent(state, {
      kind: 'breakpoint/changed',
      sessionId: id,
      workspaceId: 'ws-1',
      result: {
        applied: [appliedBreakpoint('debug-b1', 'src/a.ts', 4, true)],
        rejected: [],
      },
    })
    state = foldDebugEvent(state, { kind: 'console/output', sessionId: id, workspaceId: 'ws-1', text: 'ready', truncated: false })
    state = { ...state, source: { file: 'src/a.ts', line: 4 } }
    const lines = renderDebugPaneLines(state)
    expect(lines).toEqual([
      `debug · ${id} · ws-1 · running (active)`,
      'breakpoints:',
      '  + src/a.ts:4 verified',
      'console:',
      '  ready',
      'source src/a.ts:4',
    ])
  })

  it('renders rejected breakpoints and stack/variable sections only when present', () => {
    const id = fixtureDebugSessionId(7)
    let state = folded({ kind: 'session/starting', sessionId: id, workspaceId: 'ws-1' })
    state = foldDebugEvent(state, {
      kind: 'breakpoint/changed',
      sessionId: id,
      workspaceId: 'ws-1',
      result: {
        applied: [],
        rejected: [{ ...appliedBreakpoint('debug-b2', 'src/c.ts', 2, false), message: 'no code' }],
      },
    })
    state = foldDebugEvent(state, {
      kind: 'breakpoint/changed',
      sessionId: id,
      workspaceId: 'ws-1',
      result: {
        applied: [],
        rejected: [appliedBreakpoint('debug-b5', 'src/e.ts', 6, false)],
      },
    })
    state = {
      ...state,
      sessions: [
        { id, workspaceId: 'ws-1', state: 'starting', actor: undefined },
        { id: fixtureDebugSessionId(8), workspaceId: 'ws-2', state: 'running', actor: undefined },
      ],
      stack: [{ id: 'frame-1', name: 'main', file: 'src/main.ts', line: 1 }],
      variables: [{ scope: 'Locals', name: 'x', value: '1' }],
      watch: ['len(items)'],
    }
    const lines = renderDebugPaneLines(state)
    expect(lines).toEqual([
      `debug · ${id} · ws-1 · starting (active)`,
      `debug · ${fixtureDebugSessionId(8)} · ws-2 · running`,
      'stack:',
      '  frame-1 main src/main.ts:1',
      'variables:',
      '  Locals.x = 1',
      'watch:',
      '  len(items)',
      'breakpoints:',
      '  x src/c.ts:2 no code',
      '  ? src/e.ts:6',
    ])
  })

  it('names the terminated session actor in the status row', () => {
    const id = fixtureDebugSessionId(8)
    let state = folded({ kind: 'session/starting', sessionId: id, workspaceId: 'ws-1' })
    state = foldDebugEvent(state, { kind: 'session/terminated', sessionId: id, workspaceId: 'ws-1', actor: 'user' })
    expect(renderDebugPaneLines(state)).toContain(`debug · ${id} · ws-1 · terminated by user (active)`)
  })

  it('renders breakpoints without any live session', () => {
    const id = fixtureDebugSessionId(9)
    const state = folded({
      kind: 'breakpoint/changed',
      sessionId: id,
      workspaceId: 'ws-1',
      result: {
        applied: [{ ...appliedBreakpoint('debug-b4', 'src/d.ts', 3, false), actualLine: 5 }],
        rejected: [],
      },
    })
    expect(state.sessions).toEqual([])
    expect(renderDebugPaneLines(state)).toEqual([
      'breakpoints:',
      '  ? src/d.ts:3 (actual 5)',
    ])
  })

  it('keeps the terminated actor on later lifecycle rows and renders adapter output', () => {
    const id = fixtureDebugSessionId(10)
    const other = fixtureDebugSessionId(11)
    let state = folded({ kind: 'session/starting', sessionId: id, workspaceId: 'ws-1' })
    state = foldDebugEvent(state, { kind: 'session/starting', sessionId: other, workspaceId: 'ws-2' })
    state = foldDebugEvent(state, { kind: 'session/terminated', sessionId: id, workspaceId: 'ws-1', actor: 'user' })
    state = foldDebugEvent(state, { kind: 'session/running', sessionId: id, workspaceId: 'ws-1' })
    expect(state.sessions[0]).toEqual({ id, workspaceId: 'ws-1', state: 'running', actor: 'user' })
    state = foldDebugEvent(state, { kind: 'adapter/output', sessionId: id, workspaceId: 'ws-1', text: 'DAP frame', truncated: true })
    const lines = renderDebugPaneLines(state)
    expect(lines).toContain('  [adapter] DAP frame (truncated)')
    expect(lines).toContain(`debug · ${id} · ws-1 · running (active)`)
    expect(lines).toContain(`debug · ${other} · ws-2 · starting`)
  })

  it('uses DebugSessionId branding without behavior change', () => {
    expect(DebugSessionId('debug-x')).toBe('debug-x')
  })
})
