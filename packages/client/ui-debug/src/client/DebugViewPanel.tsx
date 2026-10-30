/**
 * The debug view panel: the live summary of the debug view service — every
 * known session with its state, the current stop location, and the surfaced
 * failures of actions and polling.
 *
 * The panel is the wiring wave's live-event payoff: it renders straight from
 * the service's store and notice external stores, so every replayed ring
 * event and every dispatch failure appears without a props plumbing chain.
 * Notice messages are seam diagnostics and stay verbatim.
 * @module @deepseek-ai/dsh-client-ui-debug/DebugViewPanel
 */
import { useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { DebugSessionState } from '@deepseek-ai/dsh-debug'
import type { DebugViewService } from './debug-service.ts'
import type { DebugKey } from './locales.ts'

/** Locale key for each session state. */
const STATE_KEYS: Record<DebugSessionState, DebugKey> = {
  starting: 'view.state.starting',
  running: 'view.state.running',
  stopped: 'view.state.stopped',
  terminated: 'view.state.terminated',
  failed: 'view.state.failed',
}

/** Props of {@link DebugViewPanel}. */
export interface DebugViewPanelProps {
  /** The debug view service whose store and notices the panel renders. */
  readonly service: DebugViewService
  /** Dictionary translate for the `debug` namespace. */
  readonly t: TranslateNS<'debug'>
}

/**
 * Render the live debug view summary.
 * @param props - the debug view service and locale.
 * @returns the panel element.
 */
export function DebugViewPanel(props: DebugViewPanelProps): ReactElement {
  const { service, t } = props
  const state = useSyncExternalStore(
    listener => service.store.subscribe(listener),
    () => service.store.state,
  )
  const notices = useSyncExternalStore(
    listener => service.notices.subscribe(listener),
    () => service.notices.getSnapshot(),
  )
  const sessions = Object.entries(state.sessionStates)
  return (
    <section aria-label={t('view.label')} data-debug-panel="view">
      {sessions.length === 0 ? <p>{t('view.empty')}</p> : null}
      <ul>
        {sessions.map(([sessionId, sessionState]) => (
          <li key={sessionId} data-debug-session={sessionId} data-debug-state={sessionState}>
            <span>{sessionId}</span>
            <span>{t(STATE_KEYS[sessionState])}</span>
          </li>
        ))}
      </ul>
      {state.stop === undefined
        ? null
        : (
          <p data-debug-stop="">{t('view.stop', { location: `${state.stop.source}:${String(state.stop.line)}` })}</p>
        )}
      {notices.map((notice, index) => (
        <p key={index} role="alert" data-debug-notice={notice.reason}>{notice.message}</p>
      ))}
    </section>
  )
}
