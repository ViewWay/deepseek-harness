// @vitest-environment jsdom
/** The workbench client plugin: the panel registry service, the debug view panel, and the toolbar controls store. */
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createDebugViewStore } from '@deepseek-ai/dsh-client-ui-debug/src/client/store.ts'
import type { DebugViewState } from '@deepseek-ai/dsh-client-ui-debug/src/client/store.ts'
import { en as debugEn } from '@deepseek-ai/dsh-client-ui-debug/src/client/locales.ts'
import { apply, inject } from '../src/client/index.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(debugEn)

/** The double's fixed empty notice set; one stable reference, as the external-store contract requires. */
const NO_NOTICES: readonly unknown[] = []

/** A debug view service double: one real store, a fixed notice set, a recorded action sink. */
interface DebugViewDouble {
  onAction: ReturnType<typeof vi.fn>
  store: ReturnType<typeof createDebugViewStore>
  notices: { getSnapshot: () => typeof NO_NOTICES; subscribe: () => () => void }
}

function debugViewDouble(): DebugViewDouble {
  return {
    store: createDebugViewStore(),
    notices: {
      getSnapshot: () => NO_NOTICES,
      subscribe: () => () => {},
    },
    onAction: vi.fn(),
  }
}

/**
 * Mount the workbench client plugin over the locale double and one debug
 * view service double.
 * @param service - the debug view service the plugin wires.
 * @returns the root context holding the provided services.
 */
async function mount(service: object): Promise<Context> {
  const ctx = new Context()
  ctx.provide('locale', {
    register: () => () => {},
    bind: () => t,
  })
  ctx.provide('debugView', service)
  await ctx.plugin({ inject: [...inject], apply }).await()
  return ctx
}

describe('workbench client plugin', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['locale', 'debugView'])
  })

  it('provides the panel registry with the debug view panel registered', async () => {
    const ctx = await mount(debugViewDouble())
    const registry = ctx.get('workbenchPanels')!
    const panels = registry.list()
    expect(panels.map(panel => panel.id)).toEqual(['debug.view'])
    expect(panels[0]?.title()).toBe(t('view.label'))
    expect(panels[0]?.defaultLocation).toBe('right')
    const panel = panels[0]
    if (panel === undefined) throw new Error('debug view panel is not registered')
    const view = render(createElement(panel.component))
    expect(view.container.querySelector('[data-debug-panel="view"]')).not.toBeNull()
    // Fiber teardown (HMR) releases the panel registration.
    await ctx.fiber.dispose()
    expect(registry.list()).toEqual([])
  })

  it('projects the controls store from the service and routes its gestures back', async () => {
    const service = debugViewDouble()
    const ctx = await mount(service)
    const debug = ctx.get('workbenchDebug')!
    const controls = debug.controls
    const snapshots: DebugViewState[] = []
    const unsubscribe = controls.subscribe(() => { snapshots.push(controls.getSnapshot().state) })
    expect(controls.getSnapshot().notifications).toBe(false)
    expect(controls.getSnapshot().actor).toBe('user')
    // A folded store transition rebuilds the bundle and notifies subscribers.
    service.store.apply({ kind: 'session/state', sessionId: 'debug-1', state: 'running' })
    expect(snapshots).toHaveLength(1)
    expect(controls.getSnapshot().state.selectedSessionId).toBe('debug-1')
    const bundle = controls.getSnapshot()
    bundle.onAction('continue')
    expect(service.onAction).toHaveBeenCalledWith('continue', 'debug-1')
    bundle.onSelectThread(4)
    expect(controls.getSnapshot().state.selectedThreadId).toBe(4)
    bundle.onSelectSession('debug-2')
    expect(controls.getSnapshot().state.selectedSessionId).toBe('debug-2')
    bundle.onNotificationsChange(true)
    expect(controls.getSnapshot().notifications).toBe(true)
    // One notification per store transition (fold, thread, session) plus the
    // notification-setting change.
    expect(snapshots).toHaveLength(4)
    unsubscribe()
    bundle.onNotificationsChange(false)
    expect(snapshots).toHaveLength(4)
    expect(controls.getSnapshot().notifications).toBe(false)
  })

  it('addresses actions to the selected session and reports none selected', async () => {
    const service = debugViewDouble()
    const ctx = await mount(service)
    const debug = ctx.get('workbenchDebug')!
    // No session is folded: the gesture forwards the empty selection, which
    // the service reports as action-unavailable.
    debug.controls.getSnapshot().onAction('pause')
    expect(service.onAction).toHaveBeenCalledWith('pause', '')
    service.store.apply({ kind: 'session/state', sessionId: 'debug-1', state: 'stopped' })
    debug.controls.getSnapshot().onAction('pause')
    expect(service.onAction).toHaveBeenLastCalledWith('pause', 'debug-1')
  })
})
