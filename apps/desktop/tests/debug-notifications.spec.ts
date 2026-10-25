import { describe, expect, it, vi } from 'vitest'
import type { DesktopDebugLiveEvent, DesktopDebugStopSnapshot } from '../src/debug/notifications.ts'
import { installDesktopDebugNotifications, notifyDebugStop } from '../src/debug/notifications.ts'
import { resolveDesktopLocale } from '../src/locale.ts'

const stopReasonKeys = [
  'breakpoint', 'step', 'pause', 'entry', 'exception', 'dataBreakpoint', 'instructionBreakpoint', 'restart', 'unknown',
] as const

/** The nine stop-reason titles, resolved from the shell's English dictionary. */
function englishTitles(): Record<(typeof stopReasonKeys)[number], string> {
  const messages = resolveDesktopLocale('en').messages
  return {
    breakpoint: messages.debugStopBreakpoint,
    step: messages.debugStopStep,
    pause: messages.debugStopPause,
    entry: messages.debugStopEntry,
    exception: messages.debugStopException,
    dataBreakpoint: messages.debugStopDataBreakpoint,
    instructionBreakpoint: messages.debugStopInstructionBreakpoint,
    restart: messages.debugStopRestart,
    unknown: messages.debugStopUnknown,
  }
}


function stopSnapshot(): DesktopDebugStopSnapshot {
  return {
    sessionId: 'debug-1',
    reason: 'breakpoint',
    source: { workspaceRelativePath: 'src/a.ts', absolutePath: '/tmp/project/src/a.ts' },
    line: 4,
    description: 'paused on breakpoint',
  }
}

/** In-process stand-in for the debug seam's live event bus. */
function fakeEvents() {
  const listeners = new Set<(event: DesktopDebugLiveEvent) => void>()
  return {
    subscribe(_filter: object, listener: (event: DesktopDebugLiveEvent) => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish(event: DesktopDebugLiveEvent): void {
      for (const listener of [...listeners]) listener(event)
    },
  }
}

describe('desktop debug notifications', () => {
  it('shows location and reason but never variable values', () => {
    const show = vi.fn()
    const focus = vi.fn()
    // An extension beyond the contract type proves the formatter reads only
    // its committed fields: even a carried variable map cannot reach the copy.
    const snapshot: DesktopDebugStopSnapshot & { readonly variables: Record<string, string> } = {
      ...stopSnapshot(), variables: { secret: 'do-not-show' },
    }
    notifyDebugStop({ show }, snapshot, englishTitles(), focus)
    expect(show).toHaveBeenCalledExactlyOnceWith({ title: 'Breakpoint', body: 'src/a.ts:4' }, focus)
    expect(JSON.stringify(show.mock.calls)).not.toContain('do-not-show')
    expect(JSON.stringify(show.mock.calls)).not.toContain('/tmp/project/src/a.ts')
    expect(JSON.stringify(show.mock.calls)).not.toContain('paused on breakpoint')
  })

  it('hands every notification the click handler for the localized reason and location', () => {
    const show = vi.fn()
    const focus = vi.fn()
    const titles = englishTitles()
    for (const reason of stopReasonKeys) {
      show.mockClear()
      notifyDebugStop({ show }, { ...stopSnapshot(), reason, line: 41 }, titles, focus)
      expect(show).toHaveBeenCalledExactlyOnceWith({ title: titles[reason], body: 'src/a.ts:41' }, focus)
    }
  })

  it('notifies once per committed stop, routes click to focus, and never after disposal', async () => {
    const bus = fakeEvents()
    const show = vi.fn()
    const focus = vi.fn()
    const stopSnapshotFor = vi.fn(async (sessionId: string) => sessionId === 'debug-1' ? stopSnapshot() : null)
    const dispose = installDesktopDebugNotifications({
      events: bus,
      stopSnapshot: stopSnapshotFor,
      notify: { show },
      titles: englishTitles(),
      focus,
    })
    bus.publish({ kind: 'session/running', sessionId: 'debug-1' })
    expect(show).not.toHaveBeenCalled()
    expect(focus).not.toHaveBeenCalled()
    bus.publish({ kind: 'session/stopped', sessionId: 'debug-2' })
    await vi.waitFor(() => { expect(stopSnapshotFor).toHaveBeenCalledWith('debug-2') })
    expect(show).not.toHaveBeenCalled()
    bus.publish({ kind: 'session/stopped', sessionId: 'debug-1' })
    const expected = { title: 'Breakpoint', body: 'src/a.ts:4' }
    await vi.waitFor(() => { expect(show).toHaveBeenCalledExactlyOnceWith(expected, focus) })
    expect(focus).not.toHaveBeenCalled()
    dispose()
    bus.publish({ kind: 'session/stopped', sessionId: 'debug-1' })
    await vi.waitFor(() => { expect(stopSnapshotFor).toHaveBeenCalledTimes(2) })
    expect(show).toHaveBeenCalledOnce()
    expect(focus).not.toHaveBeenCalled()
  })

  it('contains a failed stop lookup and keeps later stops deliverable', async () => {
    const bus = fakeEvents()
    const show = vi.fn()
    const focus = vi.fn()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let failing = true
    const stopSnapshotFor = vi.fn(async (sessionId: string) => {
      if (failing) throw new Error('stop unavailable')
      return sessionId === 'debug-1' ? stopSnapshot() : null
    })
    const dispose = installDesktopDebugNotifications({
      events: bus,
      stopSnapshot: stopSnapshotFor,
      notify: { show },
      titles: englishTitles(),
      focus,
    })
    bus.publish({ kind: 'session/stopped', sessionId: 'debug-1' })
    await vi.waitFor(() => { expect(console.warn).toHaveBeenCalledWith('desktop debug notifications: stop lookup failed', expect.anything()) })
    expect(show).not.toHaveBeenCalled()
    failing = false
    bus.publish({ kind: 'session/stopped', sessionId: 'debug-1' })
    const expected = { title: 'Breakpoint', body: 'src/a.ts:4' }
    await vi.waitFor(() => { expect(show).toHaveBeenCalledExactlyOnceWith(expected, focus) })
    dispose()
  })
})
