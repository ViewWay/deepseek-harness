import { describe, expect, it } from 'vitest'
import { createDebugViewStore, visibleDebugActions } from '../src/client/store.ts'
import { capabilities } from './capabilities.client.ts'

describe('debug view store', () => {
  it('selects the stopped thread/frame and clears them on continue', () => {
    const store = createDebugViewStore()
    store.apply({ kind: 'session/stopped', stop: {
      sessionId: 'debug-1', reason: 'breakpoint', threadId: 1, frameId: 'frame-1', source: 'src/a.ts', line: 4, column: 2,
    } })
    expect(store.state.selectedThreadId).toBe(1)
    expect(store.state.selectedFrameId).toBe('frame-1')
    store.apply({ kind: 'session/continued', sessionId: 'debug-1' })
    expect(store.state.selectedFrameId).toBeUndefined()
    expect(store.state.stop).toBeUndefined()
    expect(store.state.variablesStale).toBe(true)
    expect(store.state.stackStale).toBe(true)
  })

  it('hides unsupported actions', () => {
    expect(visibleDebugActions(capabilities())).not.toContain('stepBack')
    expect(visibleDebugActions(capabilities({ supportsStepBack: true }))).toContain('stepBack')
  })

  it('selects the first seen session and tracks its capabilities and threads', () => {
    const store = createDebugViewStore()
    store.apply({ kind: 'session/state', sessionId: 'debug-1', state: 'starting' })
    expect(store.state.selectedSessionId).toBe('debug-1')
    store.apply({ kind: 'session/state', sessionId: 'debug-2', state: 'running' })
    expect(store.state.selectedSessionId).toBe('debug-1')
    expect(store.state.sessionStates['debug-2']).toBe('running')
    store.apply({ kind: 'capabilities/changed', sessionId: 'debug-1', capabilities: capabilities() })
    store.apply({ kind: 'threads/changed', sessionId: 'debug-1', threads: [{ id: 1, name: 'main' }] })
    expect(store.state.capabilities).toEqual(capabilities())
    expect(store.state.threads).toEqual([{ id: 1, name: 'main' }])
    // Events for the unselected session never touch its selection state.
    store.apply({ kind: 'capabilities/changed', sessionId: 'debug-2', capabilities: capabilities({ supportsStepBack: true }) })
    store.apply({ kind: 'threads/changed', sessionId: 'debug-2', threads: [] })
    expect(store.state.capabilities).toEqual(capabilities())
    expect(store.state.threads).toEqual([{ id: 1, name: 'main' }])
  })

  it('drops frame and thread selection on the selected session and ignores foreign continues', () => {
    const store = createDebugViewStore()
    store.apply({ kind: 'session/stopped', stop: {
      sessionId: 'debug-1', reason: 'step', threadId: 2, frameId: 'frame-9', source: 'src/b.go', line: 10, column: 1,
    } })
    store.apply({ kind: 'session/continued', sessionId: 'debug-2' })
    expect(store.state.stop).toBeDefined()
    store.apply({ kind: 'session/terminated', sessionId: 'debug-1' })
    expect(store.state.stop).toBeUndefined()
    expect(store.state.selectedThreadId).toBeUndefined()
    expect(store.state.sessionStates['debug-1']).toBe('terminated')
  })

  it('bounds the console ring and advances the cursor', () => {
    const store = createDebugViewStore()
    for (let seq = 1; seq <= 201; seq += 1) {
      store.apply({ kind: 'console/output', sessionId: 'debug-1', seq, text: `out-${seq}\n`, truncated: false })
    }
    expect(store.state.consoleEntries).toHaveLength(200)
    expect(store.state.consoleEntries[0]?.text).toBe('out-2\n')
    expect(store.state.consoleCursor).toBe(201)
  })

  it('manages selection, expansion, and watches through its methods', () => {
    const store = createDebugViewStore()
    store.selectSession('debug-1')
    expect(store.state.selectedSessionId).toBe('debug-1')
    store.selectThread(3)
    store.selectFrame('frame-3')
    expect(store.state.selectedThreadId).toBe(3)
    expect(store.state.selectedFrameId).toBe('frame-3')
    store.toggleExpanded(7)
    store.toggleExpanded(8)
    expect(store.state.expandedVariableReferences).toEqual([7, 8])
    store.toggleExpanded(7)
    expect(store.state.expandedVariableReferences).toEqual([8])
    store.addWatch(' x > 0 ')
    store.addWatch('x > 0')
    store.addWatch('   ')
    expect(store.state.watches).toEqual(['x > 0'])
    store.removeWatch('x > 0')
    expect(store.state.watches).toEqual([])
    // Switching sessions resets per-session selection state.
    store.selectThread(5)
    store.selectSession('debug-2')
    expect(store.state.selectedThreadId).toBeUndefined()
    expect(store.state.selectedFrameId).toBeUndefined()
  })
})
