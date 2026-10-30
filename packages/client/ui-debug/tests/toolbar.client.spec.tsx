// @vitest-environment jsdom
/** Toolbar presentation: capability gating, selectors, toggle, and actor indicator. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { DebugToolbar } from '../src/client/DebugToolbar.tsx'
import { createDebugViewStore, visibleDebugActions } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'
import type { DebugAction, DebugViewState } from '../src/client/store.ts'
import { capabilities } from './capabilities.client.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(en)

/** An empty view state the tests extend per case. */
function viewState(overrides: Partial<DebugViewState> = {}): DebugViewState {
  return {
    sessionStates: {},
    selectedSessionId: undefined,
    selectedThreadId: undefined,
    selectedFrameId: undefined,
    stop: undefined,
    threads: [],
    capabilities: undefined,
    expandedVariableReferences: [],
    variablesStale: false,
    stackStale: false,
    watches: [],
    consoleEntries: [],
    consoleCursor: 0,
    ...overrides,
  }
}

function mount(state: DebugViewState, actor: 'user' | 'agent' = 'user', notifications = true) {
  const gestures = {
    onAction: vi.fn<(action: DebugAction) => void>(),
    onNotificationsChange: vi.fn<(enabled: boolean) => void>(),
    onSelectSession: vi.fn<(sessionId: string) => void>(),
    onSelectThread: vi.fn<(threadId: number) => void>(),
  }
  const view = render(<DebugToolbar
    state={state}
    t={t}
    notifications={notifications}
    actor={actor}
    {...gestures}
  />)
  return { view, gestures }
}

describe('DebugToolbar', () => {
  it('renders no run controls before capabilities arrive, with empty selectors', () => {
    const { view } = mount(viewState())
    expect(view.container.querySelector('[data-debug-action]')).toBeNull()
    expect(view.getByLabelText(t('select.session'))).toBeTruthy()
    expect(view.getByLabelText(t('select.thread'))).toBeTruthy()
    expect(view.container.querySelector('[data-debug-actor="user"]')?.textContent).toBe(t('actor.user'))
  })

  it('renders every visible action once and routes clicks through onAction', () => {
    const { view, gestures } = mount(viewState({ capabilities: capabilities({
      supportsRestartRequest: true,
      supportsStepBack: true,
      supportsRestartFrame: true,
      supportsTerminateRequest: true,
    }) }))
    const buttons = [...view.container.querySelectorAll('[data-debug-action]')]
    expect(buttons).toHaveLength(11)
    for (const button of buttons) {
      fireEvent.click(button)
    }
    const routed = gestures.onAction.mock.calls.map(([action]) => action)
    expect(routed).toContain('start')
    expect(routed).toContain('restart')
    expect(routed).toContain('continue')
    expect(routed).toContain('pause')
    expect(routed).toContain('stepOver')
    expect(routed).toContain('stepIn')
    expect(routed).toContain('stepOut')
    expect(routed).toContain('stepBack')
    expect(routed).toContain('restartFrame')
    expect(routed).toContain('stop')
    expect(routed).toContain('disconnect')
  })

  it('gates the controls from a folded capabilities/changed event', () => {
    const store = createDebugViewStore()
    store.apply({ kind: 'session/state', sessionId: 'debug-1', state: 'stopped' })
    store.apply({ kind: 'capabilities/changed', sessionId: 'debug-1', capabilities: capabilities({ supportsStepBack: true }) })
    const { view } = mount(store.state)
    const gated = [...view.container.querySelectorAll('[data-debug-action]')]
      .map(button => button.getAttribute('data-debug-action'))
    expect(gated).toEqual([...visibleDebugActions(capabilities({ supportsStepBack: true }))])
    expect(gated).toContain('stepBack')
    expect(gated).not.toContain('restartFrame')
  })

  it('omits capability-gated actions when the adapter does not declare them', () => {
    const { view } = mount(viewState({ capabilities: capabilities() }))
    const gated = [...view.container.querySelectorAll('[data-debug-action]')]
      .map(button => button.getAttribute('data-debug-action'))
    expect(gated).toContain('start')
    expect(gated).toContain('disconnect')
    expect(gated).not.toContain('restart')
    expect(gated).not.toContain('stepBack')
    expect(gated).not.toContain('restartFrame')
    expect(gated).not.toContain('stop')
  })

  it('lists known sessions and routes selection', () => {
    const { view, gestures } = mount(viewState({
      sessionStates: { 'debug-1': 'stopped', 'debug-2': 'running' },
      selectedSessionId: 'debug-1',
    }))
    const select = view.getByLabelText(t('select.session')) as HTMLSelectElement
    expect(select.options).toHaveLength(2)
    fireEvent.change(select, { target: { value: 'debug-2' } })
    expect(gestures.onSelectSession).toHaveBeenCalledWith('debug-2')
  })

  it('lists threads by name and routes numeric selection', () => {
    const { view, gestures } = mount(viewState({
      threads: [{ id: 1, name: 'main' }, { id: 7, name: 'worker' }],
      selectedThreadId: 1,
    }))
    const select = view.getByLabelText(t('select.thread')) as HTMLSelectElement
    expect(select.options).toHaveLength(2)
    fireEvent.change(select, { target: { value: '7' } })
    expect(gestures.onSelectThread).toHaveBeenCalledWith(7)
  })

  it('routes the notification toggle and shows the agent actor', () => {
    const { view, gestures } = mount(viewState(), 'agent', false)
    expect(view.container.querySelector('[data-debug-actor="agent"]')?.textContent).toBe(t('actor.agent'))
    expect(view.container.querySelector('[data-debug-notifications="off"]')).not.toBeNull()
    fireEvent.click(view.getByLabelText(t('notifications.agent')))
    expect(gestures.onNotificationsChange).toHaveBeenCalledWith(true)
  })
})
