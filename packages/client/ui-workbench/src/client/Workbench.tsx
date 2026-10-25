/**
 * The debug workbench page: the design §9.2 layout — a toolbar row with the
 * launch-config picker and the debug toolbar, the files/editor/panel regions,
 * and the bottom terminal — over the client-local panel registry and layout.
 *
 * Composition seams, in one place so embedders read the whole shape: open
 * panels and their dock locations come from the {@link WorkbenchLayout} (ids
 * only); panel components come from the registry contributions; the shared
 * file tree, terminal, and editor embeds arrive as nodes from the page host,
 * which is the second embedder of `ui-sidebar-files`, `ui-sidebar-terminal`,
 * and `ui-code-editor`; debug view state and gestures arrive through one
 * bundle for `DebugToolbar`. Nothing here awaits a Remote call.
 *
 * Responsive: wide layouts show files, editor, and panels side by side; narrow
 * layouts hide the side regions, turn every open panel into a tab strip over
 * the terminal, and hint toward the desktop app. Focus: a stop announces
 * through a live region and never moves focus; `focusOnStop` only records the
 * policy for the embedder to honour when routing focus itself. All copy goes
 * through the `workbench` locale namespace.
 * @module @deepseek-ai/dsh-client-ui-workbench/Workbench
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { DebugError, parseLaunchConfig } from '@deepseek-ai/dsh-debug'
import type {
  DebugCompoundConfiguration, DebugLaunchConfigContext, DebugLaunchConfiguration,
} from '@deepseek-ai/dsh-debug'
import { DockController, DockSurface, FloatLayer, findContentTab } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { DockIntents, DockLabels, TabRecord, TabRenderer } from '@deepseek-ai/dsh-client-ui-dockkit'
import { DebugToolbar } from '@deepseek-ai/dsh-client-ui-debug/src/client/DebugToolbar.tsx'
import type { DebugToolbarActor } from '@deepseek-ai/dsh-client-ui-debug/src/client/DebugToolbar.tsx'
import type { DebugAction, DebugViewState } from '@deepseek-ai/dsh-client-ui-debug/src/client/store.ts'
import type {} from '@deepseek-ai/dsh-client-ui-debug/src/client/locales.ts'
import type {} from './locales.ts'
import { panelsAt } from './layout.ts'
import type { WorkbenchLayout } from './layout.ts'
import type { WorkbenchPanelContribution, WorkbenchPanelLocation } from './workbench-panels.ts'
import css from './Workbench.module.css'

/** Tab kind the panel docks seat; the tab renderer maps it back to a contribution. */
const PANEL_KIND = 'workbench-panel'

/** The panel docks seat no new pane tabs, so their add controls stay hidden. */
const neverAdd = (): boolean => false

/** Why and where a debug session stopped, as the announcement receives it. */
export interface WorkbenchStopNotice {
  /** Stop reason as the wire string. */
  readonly reason: string
  /** Workspace-relative stop location, rendered `path:line`. */
  readonly location: string
}

/** The debug toolbar's state and gestures, as the workbench forwards them. */
export interface WorkbenchDebugControls {
  /** Folded debug view state driving the toolbar. */
  readonly state: DebugViewState
  /** Dictionary translate for the `debug` namespace, which the toolbar owns. */
  readonly t: TranslateNS<'debug'>
  /** Whether agent stop notifications are enabled. */
  readonly notifications: boolean
  /** Who controls the composition right now. */
  readonly actor: DebugToolbarActor
  /** Run-control gesture, mapped to Remote calls by the page host. */
  readonly onAction: (action: DebugAction) => void
  /** Notification toggle gesture. */
  readonly onNotificationsChange: (enabled: boolean) => void
  /** Session-selector gesture. */
  readonly onSelectSession: (sessionId: string) => void
  /** Thread-selector gesture. */
  readonly onSelectThread: (threadId: number) => void
}

/** The launch-config picker's parsed content, or the validation failure. */
export type WorkbenchConfigResult =
  | {
    /** Parsed successfully. */
    readonly ok: true
    /** Expanded configurations in file order. */
    readonly configurations: readonly DebugLaunchConfiguration[]
    /** Validated compounds in file order. */
    readonly compounds: readonly DebugCompoundConfiguration[]
  }
  | {
    /** Validation failed. */
    readonly ok: false
    /** The typed failure naming the offending field. */
    readonly error: DebugError
  }

/**
 * Parse the workspace's `.dsh/debug.json` for the config picker. An absent
 * file is an empty configuration set, not a failure: the picker still offers
 * "Debug current file" and "Add configuration". Schema validation rides
 * `parseLaunchConfig`, which fails with the offending field named; provider
 * `configSchema` merging stays with the launch path, which owns the provider
 * registry.
 * @param source - the raw file text, or `undefined` while the file is absent.
 * @param context - workspace, file, and environment values for substitution.
 * @returns the parsed configurations and compounds, or the validation failure.
 */
export function parseWorkbenchConfigs(
  source: string | undefined,
  context: DebugLaunchConfigContext,
): WorkbenchConfigResult {
  if (source === undefined) return { ok: true, configurations: [], compounds: [] }
  try {
    const parsed = parseLaunchConfig(source, context)
    return { ok: true, configurations: parsed.configurations, compounds: parsed.compounds }
  } catch (error: unknown) {
    if (error instanceof DebugError) return { ok: false, error }
    return { ok: false, error: new DebugError(`debug launch configuration: ${String(error)}`, 'DEBUG_INVALID_CONFIG', {}) }
  }
}

/** Props of {@link Workbench}. */
export interface WorkbenchProps {
  /** Registry contributions available to the page, in draw order. */
  readonly panels: readonly WorkbenchPanelContribution[]
  /** The persisted layout naming open panels and their dock locations. */
  readonly layout: WorkbenchLayout
  /** Panel-close gesture; the host closes the panel in the layout. */
  readonly onClosePanel: (id: string) => void
  /** Debug toolbar state and gestures. */
  readonly debug: WorkbenchDebugControls
  /** The launch-config picker's parsed content. */
  readonly configs: WorkbenchConfigResult
  /** Selected configuration name, owned by the page host. */
  readonly selectedConfig: string | undefined
  /** Configuration-selection gesture. */
  readonly onSelectConfig: (name: string) => void
  /** "Debug current file" gesture. */
  readonly onDebugCurrentFile: () => void
  /** "Add configuration" gesture. */
  readonly onAddConfiguration: () => void
  /** Narrow viewport: side regions collapse into a bottom tab strip. */
  readonly narrow: boolean
  /** The user's focus-on-stop setting, recorded for the embedder's focus routing. */
  readonly focusOnStop: boolean
  /** Whether to disable transitions regardless of the media query. */
  readonly reducedMotion: boolean
  /** The current stop, announced through the live region; `undefined` while running. */
  readonly stop: WorkbenchStopNotice | undefined
  /** The shared file-tree embed, supplied by the page host. */
  readonly files: ReactNode
  /** The editor-tabs embed, supplied by the page host. */
  readonly editor: ReactNode
  /** The shared terminal embed, supplied by the page host. */
  readonly terminal: ReactNode
  /** Dictionary translate for the `workbench` namespace. */
  readonly t: TranslateNS<'workbench'>
}

/** Build the dock surface's labels from the workbench dictionaries. */
function dockLabels(t: TranslateNS<'workbench'>): DockLabels {
  return {
    emptyPane: t('dock.emptyPane'),
    splitPane: t('dock.splitPane'),
    splitPaneDisabled: t('dock.splitPaneDisabled'),
    splitPaneNarrow: t('dock.splitPaneNarrow'),
    closeTab: t('dock.closeTab'),
    addTab: t('dock.addTab'),
    dockFloat: t('dock.dockFloat'),
    closeFloat: t('dock.closeFloat'),
    dropZone: {
      center: t('dock.dropZone.center'),
      top: t('dock.dropZone.top'),
      right: t('dock.dropZone.right'),
      bottom: t('dock.dropZone.bottom'),
      left: t('dock.dropZone.left'),
    },
  }
}

/** One location's open panels, in stored order. */
function panelsFor(
  layout: WorkbenchLayout,
  byId: ReadonlyMap<string, WorkbenchPanelContribution>,
  location: WorkbenchPanelLocation,
): readonly WorkbenchPanelContribution[] {
  return panelsAt(layout, location).flatMap((id) => {
    const panel = byId.get(id)
    return panel === undefined ? [] : [panel]
  })
}

/** Props of {@link PanelDock}. */
interface PanelDockProps {
  /** The location's open panels. */
  readonly panels: readonly WorkbenchPanelContribution[]
  /** Panel-close gesture; dock closes report through it after dropping the tab. */
  readonly onClosePanel: (id: string) => void
  /** Localized dock-surface labels. */
  readonly labels: DockLabels
  /** Layout class of the wrapping region; the CSS module's record lookup reads `string | undefined`. */
  readonly className: string | undefined
}

/**
 * One location's docked panels over `ui-dockkit`: a split-tree surface with
 * tabbed panels, floating panels, and the localized labels. Tabs track the
 * open-panel list — opened when a contribution arrives, closed when it leaves
 * — and a dock-tab close both drops the tab and reports the panel close.
 * @param props - panels, close gesture, labels, and the region's layout class.
 * @returns the docked panel surface with its float layer.
 */
function PanelDock(props: PanelDockProps): ReactElement {
  const { panels, onClosePanel, labels, className } = props
  const controller = useMemo(() => new DockController(), [])
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => {
    const state = controller.getSnapshot().state
    for (const panel of panels) {
      if (findContentTab(state, panel.id, PANEL_KIND) === undefined) {
        controller.openContent({ contentId: panel.id, kind: PANEL_KIND, title: panel.title() })
      }
    }
    for (const tab of Object.values(state.tabs)) {
      if (tab.kind === PANEL_KIND && !panels.some(panel => panel.id === tab.contentId)) controller.closeTab(tab.id)
    }
  }, [controller, panels])
  const intents: DockIntents = useMemo(() => ({
    focusTab: (tabId) => { controller.focusTab(tabId) },
    focusPane: (paneId) => { controller.focusPane(paneId) },
    splitPane: (paneId) => { controller.splitPane(paneId) },
    addTab: () => {},
    closeTab: (tabId) => {
      const tab = controller.getSnapshot().state.tabs[tabId]
      controller.closeTab(tabId)
      if (tab !== undefined) onClosePanel(tab.contentId)
    },
    duplicateTab: () => {},
    floatTab: (tabId, rect) => { controller.floatTab(tabId, rect) },
    unfloatPane: (paneId) => { controller.unfloatPane(paneId) },
    placeTab: (tabId, toPaneId, index) => { controller.placeTab(tabId, toPaneId, index) },
    dropTab: (tabId, paneId, zone) => { controller.dropTab(tabId, paneId, zone) },
    moveFloat: (paneId, x, y) => { controller.moveFloat(paneId, x, y) },
    resizeFloat: (paneId, rect) => { controller.resizeFloat(paneId, rect) },
    resizeSplit: (splitId, sizes) => { controller.resizeSplit(splitId, sizes) },
  }), [controller, onClosePanel])
  const renderTab: TabRenderer = (tab: TabRecord) => {
    if (tab.kind !== PANEL_KIND) return null
    const panel = panels.find(candidate => candidate.id === tab.contentId)
    if (panel === undefined) return null
    const Panel = panel.component
    return <Panel />
  }
  return (
    <div className={className} data-workbench-dock="">
      <DockSurface
        state={snapshot.state}
        canSplit={snapshot.canSplit}
        intents={intents}
        labels={labels}
        renderTab={renderTab}
        canAddTab={neverAdd}
      />
      <FloatLayer state={snapshot.state} intents={intents} labels={labels} renderTab={renderTab} />
    </div>
  )
}

/** Props of {@link PanelStrip}. */
interface PanelStripProps {
  /** The collapsed panels, in draw order. */
  readonly panels: readonly WorkbenchPanelContribution[]
  /** Dictionary translate for the `workbench` namespace. */
  readonly t: TranslateNS<'workbench'>
}

/**
 * The narrow layout's panel strip: every open panel becomes a tab button over
 * one tab panel. Plain buttons keep the controls keyboard-operable without a
 * drag surface.
 * @param props - panels and locale.
 * @returns the strip, or `null` while no panel is open.
 */
function PanelStrip(props: PanelStripProps): ReactElement | null {
  const { panels, t } = props
  const [selected, setSelected] = useState<string | undefined>(undefined)
  if (panels.length === 0) return null
  const active = panels.find(panel => panel.id === selected) ?? panels[0]
  return (
    <div className={css.tabs} data-workbench-panel-strip="">
      <div role="tablist" aria-label={t('panels.label')}>
        {panels.map(panel => (
          <button
            key={panel.id}
            type="button"
            role="tab"
            className={css.tab}
            id={`workbench-tab-${panel.id}`}
            aria-selected={active?.id === panel.id}
            onClick={() => { setSelected(panel.id) }}
          >
            {panel.title()}
          </button>
        ))}
      </div>
      {active === undefined
        ? null
        : (
          <div
            role="tabpanel"
            id={`workbench-panel-${active.id}`}
            aria-labelledby={`workbench-tab-${active.id}`}
          >
            {(() => {
              const Panel = active.component
              return <Panel />
            })()}
          </div>
        )}
    </div>
  )
}

/**
 * Render the debug workbench page.
 * @param props - panels, layout, debug controls, config picker state, and the
 *   responsive, focus, and reduced-motion settings.
 * @returns the page element.
 */
export function Workbench(props: WorkbenchProps): ReactElement {
  const {
    panels, layout, onClosePanel, debug, configs, selectedConfig, onSelectConfig, onDebugCurrentFile,
    onAddConfiguration, narrow, focusOnStop, reducedMotion, stop, files, editor, terminal, t,
  } = props
  const byId = useMemo(() => new Map(panels.map(panel => [panel.id, panel])), [panels])
  const labels = useMemo(() => dockLabels(t), [t])
  const openPanels = useMemo(() => panelsFor(layout, byId, 'left')
    .concat(panelsFor(layout, byId, 'center'), panelsFor(layout, byId, 'right'), panelsFor(layout, byId, 'bottom')),
  [layout, byId])
  const configMessage = configs.ok ? undefined : configs.error.detail ?? configs.error.message
  const regionDock = (location: WorkbenchPanelLocation): ReactElement => (
    <PanelDock panels={panelsFor(layout, byId, location)} onClosePanel={onClosePanel} labels={labels} className={css.dock} />
  )
  return (
    <section
      aria-label={t('page.label')}
      className={css.frame}
      data-workbench=""
      data-narrow={narrow ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-focus-policy={focusOnStop ? 'on-stop' : 'retain'}
    >
      <p role="status" aria-live="polite" className={css.announcement} data-workbench-announcement="">
        {stop === undefined ? '' : t('stop.announce', { reason: stop.reason, location: stop.location })}
      </p>
      <header className={css.header}>
        {configs.ok && configs.configurations.length > 0
          ? (
            <select
              aria-label={t('config.picker.label')}
              value={selectedConfig ?? ''}
              onChange={(event) => { onSelectConfig(event.target.value) }}
            >
              {configs.configurations.map(config => (
                <option key={config.name} value={config.name}>{config.name}</option>
              ))}
            </select>
          )
          : null}
        {!configs.ok
          ? <p className={css.error} data-workbench-config-error="">{t('config.invalid', { message: configMessage })}</p>
          : null}
        <button type="button" data-workbench-debug-current="" onClick={() => { onDebugCurrentFile() }}>
          {t('config.debugCurrentFile')}
        </button>
        <button type="button" data-workbench-add-config="" onClick={() => { onAddConfiguration() }}>
          {t('config.addConfiguration')}
        </button>
        <DebugToolbar
          state={debug.state}
          t={debug.t}
          notifications={debug.notifications}
          actor={debug.actor}
          onAction={debug.onAction}
          onNotificationsChange={debug.onNotificationsChange}
          onSelectSession={debug.onSelectSession}
          onSelectThread={debug.onSelectThread}
        />
      </header>
      <section aria-label={t('region.files')} className={css.left}>
        {files}
        {narrow ? null : regionDock('left')}
      </section>
      <section aria-label={t('region.editor')} className={css.center}>
        {editor}
        {narrow ? null : regionDock('center')}
      </section>
      <aside aria-label={t('panels.label')} className={css.right}>
        {narrow ? null : regionDock('right')}
      </aside>
      <section aria-label={t('region.terminal')} className={css.bottom}>
        {narrow ? <PanelStrip panels={openPanels} t={t} /> : regionDock('bottom')}
        {narrow ? <p className={css.hint}>{t('narrow.hint')}</p> : null}
        {terminal}
      </section>
    </section>
  )
}
