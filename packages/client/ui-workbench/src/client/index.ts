/**
 * Browser half: the debug workbench's composition plugin. It provides the
 * panel registry service (`ctx.workbenchPanels`), registers the debug view
 * panel into it, and provides the debug toolbar wiring (`ctx.workbenchDebug`)
 * the page host reads as one external store and forwards into
 * {@link Workbench} as the `debug` props bundle.
 *
 * The toolbar wiring owns the two controls the debug view service cannot:
 * the agent-stop notification setting and the actor indicator (no Remote
 * carries either yet, so both hold their defaults until one does). Every
 * other controls field projects the service's store, and every gesture
 * routes back through the service's Remote dispatch or store selection.
 * @module @deepseek-ai/dsh-client-ui-workbench/client
 */
import { createElement } from 'react'
import type { ReactElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the `debugView` service merge (and the debug copy namespace).
import type {} from '@deepseek-ai/dsh-client-ui-debug/src/client/index.ts'
import { DebugViewPanel } from '@deepseek-ai/dsh-client-ui-debug/src/client/DebugViewPanel.tsx'
import type { WorkbenchDebugControls } from './Workbench.tsx'
import { WorkbenchPanelRegistry } from './workbench-panels.ts'
import { de, en, es, fr, ja, pt, ru, zh } from './locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The workbench panel registry panels contribute into. */
    workbenchPanels: WorkbenchPanelRegistry
    /** The debug toolbar wiring the workbench page host forwards into `Workbench`. */
    workbenchDebug: WorkbenchDebugFace
  }
}

/** The workbench's debug toolbar wiring for the page host. */
export interface WorkbenchDebugFace {
  /** The toolbar controls bundle: live view state, locale, and gestures. */
  readonly controls: HostObservable<WorkbenchDebugControls>
}

/** This package's copy namespace. */
const NS = 'workbench'

/** Stable panel id of the debug view summary panel. */
export const DEBUG_VIEW_PANEL_ID = 'debug.view'

/** Required browser services: copy and the debug view service. */
export const inject = ['locale', 'debugView']

/**
 * Client plugin body: register the workbench dictionaries, provide the panel
 * registry with the debug view panel registered into it, and provide the
 * debug toolbar wiring.
 * @param ctx - client root context carrying the locale and debug view services.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-workbench: dictionaries')
  const t = ctx.locale.bind('debug')
  const service = ctx.debugView

  // The registry is built at apply's top level, not inside an effect: a
  // registry other packages register into cannot have an effect-internal
  // scope as its host, because their `register()` would add an effect to
  // this fiber and stall browser boot.
  const registry = new WorkbenchPanelRegistry()
  // `createElement`, not JSX: this entry stays `index.ts`, the package's
  // client bundle entrypoint.
  const DebugViewPanelBound = (): ReactElement => createElement(DebugViewPanel, { service, t })
  ctx.effect(() => registry.register({
    id: DEBUG_VIEW_PANEL_ID,
    title: () => t('view.label'),
    icon: 'debug',
    component: DebugViewPanelBound,
    defaultLocation: 'right',
  }), 'ui-workbench: debug view panel')

  const listeners = new Set<() => void>()
  /** The agent-stop notification setting; no Remote carries it yet. */
  let notifications = false
  const build = (): WorkbenchDebugControls => {
    const state = service.store.state
    return {
      state,
      t,
      notifications,
      actor: 'user',
      onAction: (action) => { service.onAction(action, service.store.state.selectedSessionId ?? '') },
      onNotificationsChange: (enabled) => {
        notifications = enabled
        rebuild()
      },
      onSelectSession: (sessionId) => { service.store.selectSession(sessionId) },
      onSelectThread: (threadId) => { service.store.selectThread(threadId) },
    }
  }
  /**
   * Rebuild the controls bundle and notify subscribers; the store's own
   * transitions and the notification setting both route through here.
   */
  const rebuild = (): void => {
    snapshot = build()
    for (const listener of [...listeners]) listener()
  }
  let snapshot = build()
  ctx.effect(() => service.store.subscribe(rebuild), 'ui-workbench: debug controls source')
  const debug: WorkbenchDebugFace = {
    controls: {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
  }
  const disposePanels = ctx.reflect.provide('workbenchPanels', registry)
  const disposeDebug = ctx.reflect.provide('workbenchDebug', debug)
  ctx.effect(() => () => {
    void disposeDebug()
    void disposePanels()
  }, 'ui-workbench: service faces')
}
