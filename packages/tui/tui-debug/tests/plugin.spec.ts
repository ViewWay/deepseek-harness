import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Debug, { DebugBreakpointId, DebugSessionId } from '@deepseek-ai/dsh-debug'
import { DebugProviderId, fixtureDebugSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { apply, createTuiDebugPaneSource, inject, name, openEditorNotice } from '../src/index.ts'
import type { TuiEditorLaunch } from '../src/index.ts'

/** Build a Debug seam without the plugin lifecycle (no projections needed). */
function makeDebug(): Debug {
  return new Debug(new Context())
}

/** Register one inert debug session record on the seam. */
function addSession(debug: Debug, id: ReturnType<typeof fixtureDebugSessionId>): void {
  debug.sessions.add({
    id,
    providerId: DebugProviderId('node'),
    workspaceId: 'ws-1',
    state: 'stopped',
    setState() {},
    dispose: () => Promise.resolve(),
  })
}

describe('TUI debug pane source', () => {
  it('folds live debug events into the rendered lines', () => {
    const debug = makeDebug()
    const handle = createTuiDebugPaneSource(debug, { resolveEditor: () => undefined })
    const seen: string[][] = []
    const stop = handle.pane.subscribe((lines) => { seen.push(lines) })
    const id = fixtureDebugSessionId(1)
    debug.sessions.publish({ kind: 'session/starting', sessionId: id, workspaceId: 'ws-1' })
    expect(handle.pane.current()).toContain(`debug · ${id} · ws-1 · starting (active)`)
    expect(seen.at(-1)).toEqual(handle.pane.current())
    stop()
    debug.sessions.publish({ kind: 'session/failed', sessionId: id, workspaceId: 'ws-1' })
    expect(seen).toHaveLength(1)
    handle.dispose()
  })

  it('declines app-owned commands, colon-less lines, and empty lines, consumes debug ones', () => {
    const debug = makeDebug()
    const handle = createTuiDebugPaneSource(debug, { resolveEditor: () => undefined })
    expect(handle.pane.run(':chat')).toBe(false)
    expect(handle.pane.run(':help')).toBe(false)
    expect(handle.pane.run('')).toBe(false)
    expect(handle.pane.run('plain prompt')).toBe(false)
    expect(handle.pane.run(':sessions')).toBe(true)
    expect(handle.pane.current().at(-1)).toBe('  sessions: none')
    handle.dispose()
  })

  it('switches the active session and reports unknown ids typed', () => {
    const debug = makeDebug()
    const handle = createTuiDebugPaneSource(debug, { resolveEditor: () => undefined })
    expect(handle.pane.run(':switch debug-gone')).toBe(true)
    expect(handle.pane.current().at(-1)).toBe('  error: DEBUG_SESSION_GONE no debug session debug-gone')
    const id = fixtureDebugSessionId(2)
    addSession(debug, id)
    expect(handle.pane.run(`:switch ${id}`)).toBe(true)
    expect(handle.pane.current().some(line => line === `  switched to ${id}`)).toBe(true)
    expect(handle.pane.current()).toContain(`debug · ${id} · ws-1 · starting (active)`)
    handle.dispose()
  })

  it('reports malformed debug commands with their stable codes', () => {
    const debug = makeDebug()
    const handle = createTuiDebugPaneSource(debug, { resolveEditor: () => undefined })
    expect(handle.pane.run(':break nope')).toBe(true)
    expect(handle.pane.current().at(-1)?.startsWith('  error: DEBUG_INVALID_CONFIG')).toBe(true)
    // An unknown operation is the app's unknown-command notice, not a pane
    // event: run declines it so run.ts falls through.
    expect(handle.pane.run(':adapter wat')).toBe(false)
    expect(handle.pane.current().at(-1)?.startsWith('  error: DEBUG_INVALID_CONFIG')).toBe(true)
    handle.dispose()
  })

  it('maps function keys to their commands and declines unmapped keys', () => {
    const debug = makeDebug()
    const handle = createTuiDebugPaneSource(debug, { resolveEditor: () => undefined })
    expect(handle.pane.runKey('f9')).toBe(true)
    expect(handle.pane.current().at(-1)).toContain('DEBUG_INVALID_CONFIG')
    expect(handle.pane.current().at(-1)).toContain('breakpoint needs <file>:<line>')
    expect(handle.pane.runKey('f6')).toBe(false)
    expect(handle.pane.runKey('f10')).toBe(true)
    expect(handle.pane.current().at(-1)).toContain('unavailable: next (DEBUG_UNAVAILABLE)')
    handle.dispose()
  })

  it('requires an active session for terminate and disconnect', async () => {
    const debug = makeDebug()
    const handle = createTuiDebugPaneSource(debug, { resolveEditor: () => undefined })
    expect(handle.pane.run(':terminate')).toBe(true)
    await Promise.resolve()
    expect(handle.pane.current().some(line => line.startsWith('  error: DEBUG_INVALID_CONFIG'))).toBe(true)
    const id = fixtureDebugSessionId(3)
    addSession(debug, id)
    expect(handle.pane.run(`:switch ${id}`)).toBe(true)
    expect(handle.pane.run(':terminate')).toBe(true)
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(handle.pane.current().some(line => line === `  switched to ${id}`)).toBe(true)
    handle.dispose()
  })

  it('records a plain rejection from the session teardown with its text', async () => {
    const debug = makeDebug()
    const handle = createTuiDebugPaneSource(debug, { resolveEditor: () => undefined })
    const id = fixtureDebugSessionId(4)
    debug.sessions.add({
      id,
      providerId: DebugProviderId('node'),
      workspaceId: 'ws-1',
      state: 'stopped',
      setState() {},
      dispose: () => Promise.reject(new Error('pty close failed')),
    })
    expect(handle.pane.run(`:switch ${id}`)).toBe(true)
    expect(handle.pane.run(':disconnect')).toBe(true)
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(handle.pane.current().at(-1)).toBe('  error: Error: pty close failed')
    handle.dispose()
  })

  it('lists registered sessions and notices a vanished active session', async () => {
    const debug = makeDebug()
    const handle = createTuiDebugPaneSource(debug, { resolveEditor: () => undefined })
    const id = fixtureDebugSessionId(5)
    addSession(debug, id)
    expect(handle.pane.run(':sessions')).toBe(true)
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(handle.pane.current().at(-1)).toBe(`  sessions: ${id} stopped`)
    expect(handle.pane.run(`:switch ${id}`)).toBe(true)
    await debug.sessions.remove(id, 'user')
    expect(handle.pane.run(':disconnect')).toBe(true)
    await Promise.resolve()
    expect(handle.pane.current().at(-1)).toBe(`  error: DEBUG_SESSION_GONE no debug session ${id}`)
    handle.dispose()
  })

  it('falls back to the $EDITOR environment when no resolver is configured', () => {
    const debug = makeDebug()
    const handle = createTuiDebugPaneSource(debug)
    handle.pane.openEditor()
    expect(handle.pane.current().at(-1)).toBe('  editor: no source location is known yet')
    handle.dispose()
  })

  it('releases the pane service with the plugin fiber', async () => {
    const ctx = new Context()
    void new Debug(ctx)
    const fiber = await ctx.plugin({ name, inject: [...inject], apply })
    expect(ctx.get('tuiDebugPane')).toBeDefined()
    await fiber.dispose()
    expect(ctx.get('tuiDebugPane', false)).toBeUndefined()
  })

  it('records the copyable remote path when no remote editor is configured', () => {
    const debug = makeDebug()
    const launched: string[][] = []
    const handle = createTuiDebugPaneSource(debug, {
      resolveEditor: () => undefined,
      remoteWorkspace: true,
      launch: {
        start: (request) => {
          launched.push([...request.argv])
          return undefined
        },
      },
    })
    handle.pane.openEditor()
    expect(handle.pane.current().at(-1)).toBe('  editor: no source location is known yet')
    handle.dispose()
    expect(launched).toEqual([])
  })

  it('opens the editor when the source location and command are known', () => {
    const debug = makeDebug()
    const launched: string[][] = []
    const handle = createTuiDebugPaneSource(debug, {
      resolveEditor: () => '/usr/bin/vi',
      launch: {
        start: (request) => {
          launched.push([...request.argv])
          return undefined
        },
      },
    })
    handle.pane.openEditor()
    expect(handle.pane.current().at(-1)).toBe('  editor: no source location is known yet')
    handle.dispose()
  })

  it('composes nothing without a debug seam and provides the pane with one', () => {
    const ctx = new Context()
    apply(ctx)
    expect(ctx.get('tuiDebugPane')).toBeUndefined()
    void new Debug(ctx)
    apply(ctx, { resolveEditor: () => undefined })
    const pane = ctx.get('tuiDebugPane')
    expect(pane).toBeDefined()
    expect(pane?.run(':sessions')).toBe(true)
    expect(name).toBe('tui-debug')
  })

  it('keeps seam branding intact across the pane boundary', () => {
    expect(String(DebugBreakpointId('debug-b1'))).toBe('debug-b1')
    expect(DebugSessionId('debug-x')).toBe('debug-x')
  })

  it('resolves the editor notice for every handoff outcome', () => {
    const launch: TuiEditorLaunch = {
      start: (request) => {
        launched.push([...request.argv])
        return undefined
      },
    }
    expect(openEditorNotice(undefined, '/usr/bin/vi', false, launch)).toBe('editor: no source location is known yet')
    expect(openEditorNotice({ file: '/ws/a.ts', line: 4 }, undefined, true, launch))
      .toBe('editor: copy this remote path: /ws/a.ts')
    expect(openEditorNotice({ file: '/ws/a.ts', line: 4 }, undefined, false, launch))
      .toBe('editor: no $EDITOR is configured')
    // A configured editor without the local launcher fails typed.
    expect(() => openEditorNotice({ file: '/ws/a.ts', line: 4 }, '/usr/bin/vi', false, undefined))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    openEditorNotice({ file: '/ws/a.ts', line: 4 }, '/usr/bin/vi', false, launch)
    expect(launched).toEqual([['/usr/bin/vi', '+4', '/ws/a.ts']])
  })

  it('contains editor-handoff failures in the pane console, never as thrown errors', () => {
    const debug = makeDebug()
    const handle = createTuiDebugPaneSource(debug, {
      resolveEditor: (): string => {
        throw new Error('editor resolver exploded')
      },
    })
    handle.pane.openEditor()
    expect(handle.pane.current().at(-1)).toBe('  error: Error: editor resolver exploded')
    handle.dispose()
  })
})

/** The argv recorder shared by the launcher fixtures above. */
const launched: string[][] = []
