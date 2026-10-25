/**
 * The debug toolbar: capability-gated run controls, session and thread
 * selectors, the agent-stop notification toggle, and the actor indicator.
 *
 * Every control derives from the view state: actions render only when the
 * reported capabilities support them, and selectors list exactly the sessions
 * and threads the folded events carried. All copy goes through the `debug`
 * locale namespace.
 * @module @deepseek-ai/dsh-client-ui-debug/DebugToolbar
 */
import type { ReactElement } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { visibleDebugActions, type DebugAction, type DebugViewState } from './store.ts'
import type { DebugKey } from './locales.ts'
import { NotificationToggle } from './panels.tsx'

/** Who currently controls the debug composition, as the toolbar displays it. */
export type DebugToolbarActor = 'user' | 'agent'

/** Props of {@link DebugToolbar}. */
export interface DebugToolbarProps {
  /** The folded view state driving visibility and selectors. */
  readonly state: DebugViewState
  /** Dictionary translate for the `debug` namespace. */
  readonly t: TranslateNS<'debug'>
  /** Whether agent stop notifications are enabled. */
  readonly notifications: boolean
  /** Who controls the composition right now. */
  readonly actor: DebugToolbarActor
  /** Run-control gesture; the workbench wiring maps it to Remote calls. */
  readonly onAction: (action: DebugAction) => void
  /** Notification toggle gesture. */
  readonly onNotificationsChange: (enabled: boolean) => void
  /** Session-selector gesture. */
  readonly onSelectSession: (sessionId: string) => void
  /** Thread-selector gesture. */
  readonly onSelectThread: (threadId: number) => void
}

/** Toolbar order label for each action; one locale key per action. */
const ACTION_KEYS: Record<DebugAction, DebugKey> = {
  start: 'action.start',
  restart: 'action.restart',
  continue: 'action.continue',
  pause: 'action.pause',
  stepOver: 'action.stepOver',
  stepIn: 'action.stepIn',
  stepOut: 'action.stepOut',
  stepBack: 'action.stepBack',
  restartFrame: 'action.restartFrame',
  stop: 'action.stop',
  disconnect: 'action.disconnect',
}

/**
 * Render the debug toolbar. Without reported capabilities it renders the
 * selectors, toggle, and indicator only: no control appears that the adapter
 * has not declared support for.
 * @param props - view state, locale, and gestures.
 * @returns the toolbar element.
 */
export function DebugToolbar(props: DebugToolbarProps): ReactElement {
  const { state, t, notifications, actor, onAction, onNotificationsChange, onSelectSession, onSelectThread } = props
  const actions = state.capabilities === undefined ? [] : visibleDebugActions(state.capabilities)
  const sessions = Object.keys(state.sessionStates)
  return (
    <div role="toolbar" aria-label={t('toolbar.label')} data-debug-toolbar="">
      {actions.map(action => (
        <button
          key={action}
          type="button"
          data-debug-action={action}
          aria-label={t(ACTION_KEYS[action])}
          onClick={() => { onAction(action) }}
        >
          {t(ACTION_KEYS[action])}
        </button>
      ))}
      <select
        aria-label={t('select.session')}
        data-debug-session-select=""
        value={state.selectedSessionId ?? ''}
        onChange={(event) => { onSelectSession(event.target.value) }}
      >
        {sessions.length === 0 ? <option value="">{t('select.session')}</option> : null}
        {sessions.map(sessionId => (
          <option key={sessionId} value={sessionId}>{sessionId}</option>
        ))}
      </select>
      <select
        aria-label={t('select.thread')}
        data-debug-thread-select=""
        value={state.selectedThreadId === undefined ? '' : String(state.selectedThreadId)}
        onChange={(event) => { onSelectThread(Number(event.target.value)) }}
      >
        {state.threads.length === 0 ? <option value="">{t('select.thread')}</option> : null}
        {state.threads.map(thread => (
          <option key={thread.id} value={thread.id}>{thread.name}</option>
        ))}
      </select>
      <NotificationToggle checked={notifications} t={t} onChange={onNotificationsChange} />
      <span data-debug-actor={actor}>{t(actor === 'agent' ? 'actor.agent' : 'actor.user')}</span>
    </div>
  )
}
