// @vitest-environment jsdom
/** The debug view panel: live sessions and states, the stop location, and surfaced notices. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { DebugViewPanel } from '../src/client/DebugViewPanel.tsx'
import type { DebugViewNotice, DebugViewService } from '../src/client/debug-service.ts'
import { createDebugViewStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(en)

/** A service double over one real store and one fixed notice set. */
function serviceOf(notices: readonly DebugViewNotice[] = []): DebugViewService {
  return {
    store: createDebugViewStore(),
    notices: {
      getSnapshot: () => notices,
      subscribe: () => () => {},
    },
    onAction: vi.fn(),
  }
}

describe('DebugViewPanel', () => {
  it('states the empty state before any session arrives', () => {
    const view = render(<DebugViewPanel service={serviceOf()} t={t} />)
    expect(view.getByText(t('view.empty'))).toBeTruthy()
    expect(view.container.querySelector('[data-debug-session]')).toBeNull()
    expect(view.container.querySelector('[data-debug-stop]')).toBeNull()
    expect(view.container.querySelector('[data-debug-notice]')).toBeNull()
  })

  it('lists sessions with localized states and the stop location', () => {
    const service = serviceOf()
    service.store.apply({ kind: 'session/state', sessionId: 'debug-1', state: 'stopped' })
    service.store.apply({ kind: 'session/stopped', stop: {
      sessionId: 'debug-1', reason: 'breakpoint', threadId: 1, source: 'src/a.ts', line: 4, column: 2,
    } })
    const view = render(<DebugViewPanel service={service} t={t} />)
    expect(view.container.querySelector('[data-debug-session="debug-1"]')?.textContent)
      .toContain(t('view.state.stopped'))
    expect(view.container.querySelector('[data-debug-stop]')?.textContent)
      .toBe(t('view.stop', { location: 'src/a.ts:4' }))
  })

  it('renders surfaced notices verbatim with their reason', () => {
    const service = serviceOf([{ reason: 'action-unavailable', message: 'start: the debug controller exposes no Remote for this action yet' }])
    service.store.apply({ kind: 'session/state', sessionId: 'debug-1', state: 'failed' })
    const view = render(<DebugViewPanel service={service} t={t} />)
    expect(view.container.querySelector('[data-debug-notice="action-unavailable"]')?.textContent)
      .toContain('start: the debug controller exposes no Remote')
    expect(view.container.querySelector('[data-debug-session="debug-1"]')?.textContent)
      .toContain(t('view.state.failed'))
  })
})
