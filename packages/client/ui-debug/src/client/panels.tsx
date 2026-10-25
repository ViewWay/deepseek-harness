/**
 * The debug panels: call stack, variables, watch, breakpoints, exception
 * filters, console, modules, loaded sources, disassembly, and memory, plus
 * the adapter settings panel and the agent-stop notification toggle.
 *
 * Panels are pure presentations of the workbench wiring's fetched data: every
 * list, error, and value arrives as a prop and every gesture leaves through a
 * callback. Capability-gated panels render nothing when the adapter did not
 * declare support, so no control appears that would fail; values truncate at
 * a bounded length and one failing watch expression never blocks the others.
 * All copy goes through the `debug` locale namespace.
 * @module @deepseek-ai/dsh-client-ui-debug/panels
 */
import type { ReactElement } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary translate seat shared by every panel. */
type DebugTranslate = TranslateNS<'debug'>

/** Inclusive character cap on one rendered variable value; longer values fold. */
const MAX_VARIABLE_CHARS = 64

/**
 * Fold one variable value for display: values past the character cap show
 * their head plus an ellipsis, keeping lazy expansion as the way to inspect
 * the rest.
 * @param value - the adapter-rendered variable value.
 * @returns the bounded display value.
 */
export function truncateVariableValue(value: string): string {
  return value.length > MAX_VARIABLE_CHARS ? `${value.slice(0, MAX_VARIABLE_CHARS)}…` : value
}

/** One variable row as the variables panel receives it. */
export interface DebugVariableRow {
  /** Variable name. */
  readonly name: string
  /** Adapter-rendered value, already stringified. */
  readonly value: string
  /** Child container reference; zero means the variable has no children. */
  readonly variablesReference: number
}

/** Props of {@link VariablesPanel}. */
export interface VariablesPanelProps {
  /** The scope's variable rows. */
  readonly variables: readonly DebugVariableRow[]
  /** Dictionary translate for the `debug` namespace. */
  readonly t: DebugTranslate
  /** Lazy expansion gesture for one variable's children. */
  readonly onExpand: (variablesReference: number) => void
}

/**
 * Render one scope's variables with bounded values and a lazy expand control
 * per child-bearing row.
 * @param props - variable rows, locale, and the expand gesture.
 * @returns the panel element.
 */
export function VariablesPanel(props: VariablesPanelProps): ReactElement {
  const { variables, t, onExpand } = props
  return (
    <section aria-label={t('panel.variables.label')} data-debug-panel="variables">
      {variables.length === 0 ? <p>{t('panel.variables.empty')}</p> : null}
      <ul>
        {variables.map(variable => (
          <li key={variable.name} data-debug-variable={variable.name}>
            <span>{variable.name}</span>
            <span>{truncateVariableValue(variable.value)}</span>
            {variable.variablesReference > 0
              ? (
                <button
                  type="button"
                  aria-label={t('panel.variables.expand', { name: variable.name })}
                  onClick={() => { onExpand(variable.variablesReference) }}
                >
                  +
                </button>
              )
              : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One stack frame as the call stack panel receives it. */
export interface DebugStackFrameRow {
  /** Frame id as the wire string. */
  readonly frameId: string
  /** Adapter-rendered frame name. */
  readonly name: string
  /** Workspace-relative source path when the frame has one. */
  readonly source?: string | undefined
  /** Frame line, one-based. */
  readonly line?: number | undefined
}

/** Props of {@link StackPanel}. */
export interface StackPanelProps {
  /** Frames of the selected thread, innermost first. */
  readonly frames: readonly DebugStackFrameRow[]
  /** Selected frame id. */
  readonly selectedFrameId: string | undefined
  /** Dictionary translate for the `debug` namespace. */
  readonly t: DebugTranslate
  /** Frame-selection gesture. */
  readonly onSelect: (frameId: string) => void
}

/**
 * Render the call stack. While nothing is stopped the empty state names the
 * next step instead of showing a dead list.
 * @param props - frames, selection, locale, and the select gesture.
 * @returns the panel element.
 */
export function StackPanel(props: StackPanelProps): ReactElement {
  const { frames, selectedFrameId, t, onSelect } = props
  return (
    <section aria-label={t('panel.stack.label')} data-debug-panel="stack">
      {frames.length === 0 ? <p>{t('panel.stack.empty')}</p> : null}
      <ul>
        {frames.map(frame => (
          <li key={frame.frameId}>
            <button
              type="button"
              data-debug-frame={frame.frameId}
              aria-pressed={frame.frameId === selectedFrameId}
              onClick={() => { onSelect(frame.frameId) }}
            >
              {frame.name}
              {frame.source === undefined ? null : <span> {frame.source}{frame.line === undefined ? '' : `:${frame.line}`}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One watch expression's evaluated outcome. */
export interface DebugWatchResult {
  /** Rendered value when evaluation succeeded. */
  readonly value?: string | undefined
  /** Short error reason when evaluation failed. */
  readonly error?: string | undefined
}

/** Props of {@link WatchPanel}. */
export interface WatchPanelProps {
  /** Watch expressions in user order. */
  readonly watches: readonly string[]
  /** Per-expression outcomes; a missing entry means not yet evaluated. */
  readonly results: Readonly<Record<string, DebugWatchResult>>
  /** Dictionary translate for the `debug` namespace. */
  readonly t: DebugTranslate
  /** Add gesture; the workbench wiring owns the input surface. */
  readonly onAdd: (expression: string) => void
  /** Remove gesture. */
  readonly onRemove: (expression: string) => void
}

/**
 * Render watch expressions with their individual outcomes. Each row renders
 * from its own entry, so one failed evaluation shows its error and leaves the
 * other rows untouched.
 * @param props - watches, outcomes, locale, and gestures.
 * @returns the panel element.
 */
export function WatchPanel(props: WatchPanelProps): ReactElement {
  const { watches, results, t, onAdd, onRemove } = props
  return (
    <section aria-label={t('panel.watch.label')} data-debug-panel="watch">
      {watches.length === 0 ? <p>{t('panel.watch.empty')}</p> : null}
      <ul>
        {watches.map((expression) => {
          const outcome = results[expression]
          return (
            <li key={expression} data-debug-watch={expression}>
              <span>{expression}</span>
              {outcome?.value === undefined ? null : <span>{outcome.value}</span>}
              {outcome?.error === undefined ? null : <span data-debug-watch-error="">{outcome.error}</span>}
              <button
                type="button"
                aria-label={t('panel.watch.remove', { expression })}
                onClick={() => { onRemove(expression) }}
              >
                ×
              </button>
            </li>
          )
        })}
      </ul>
      <button type="button" data-debug-watch-add="" onClick={() => { onAdd('') }}>{t('panel.watch.add')}</button>
    </section>
  )
}

/** One breakpoint as the breakpoints panel receives it. */
export interface DebugBreakpointRow {
  /** Adapter-assigned breakpoint id. */
  readonly id: number
  /** Workspace-relative source path. */
  readonly path: string
  /** Requested line, one-based. */
  readonly line: number
  /** Whether the adapter verified the breakpoint. */
  readonly verified: boolean
  /** Whether the user enabled the breakpoint. */
  readonly enabled: boolean
  /** The adapter's unverified-reason message when verification failed. */
  readonly message?: string | undefined
}

/** Props of {@link BreakpointsPanel}. */
export interface BreakpointsPanelProps {
  /** The file breakpoints in workspace order. */
  readonly breakpoints: readonly DebugBreakpointRow[]
  /** Dictionary translate for the `debug` namespace. */
  readonly t: DebugTranslate
  /** Enable/disable gesture. */
  readonly onToggle: (id: number) => void
}

/**
 * Render file breakpoints with enable/disable controls and the visible
 * unverified reason.
 * @param props - breakpoints, locale, and the toggle gesture.
 * @returns the panel element.
 */
export function BreakpointsPanel(props: BreakpointsPanelProps): ReactElement {
  const { breakpoints, t, onToggle } = props
  return (
    <section aria-label={t('panel.breakpoints.label')} data-debug-panel="breakpoints">
      {breakpoints.length === 0 ? <p>{t('panel.breakpoints.empty')}</p> : null}
      <ul>
        {breakpoints.map(breakpoint => (
          <li key={breakpoint.id} data-debug-breakpoint={breakpoint.id} data-verified={breakpoint.verified}>
            <label>
              <input
                type="checkbox"
                checked={breakpoint.enabled}
                aria-label={t('panel.breakpoints.toggle', { line: breakpoint.line })}
                onChange={() => { onToggle(breakpoint.id) }}
              />
              <span>{breakpoint.path}:{breakpoint.line}</span>
            </label>
            {!breakpoint.verified && breakpoint.message !== undefined
              ? <span data-debug-breakpoint-message="">{t('panel.breakpoints.unverified', { message: breakpoint.message })}</span>
              : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One exception filter as the exception filters panel receives it. */
export interface DebugExceptionFilterRow {
  /** Filter id as the wire string. */
  readonly id: string
  /** Adapter-provided filter label. */
  readonly label: string
  /** Whether the filter is enabled. */
  readonly enabled: boolean
}

/** Props of {@link ExceptionFiltersPanel}. */
export interface ExceptionFiltersPanelProps {
  /** Whether the adapter declared exception filter support. */
  readonly supported: boolean
  /** The adapter's exception filters. */
  readonly filters: readonly DebugExceptionFilterRow[]
  /** Dictionary translate for the `debug` namespace. */
  readonly t: DebugTranslate
  /** Enable/disable gesture. */
  readonly onToggle: (id: string) => void
}

/**
 * Render the adapter's exception filters; renders nothing when the adapter
 * did not declare support, so no failing control appears.
 * @param props - support flag, filters, locale, and the toggle gesture.
 * @returns the panel element, or null without support.
 */
export function ExceptionFiltersPanel(props: ExceptionFiltersPanelProps): ReactElement | null {
  const { supported, filters, t, onToggle } = props
  if (!supported) return null
  return (
    <section aria-label={t('panel.exceptions.label')} data-debug-panel="exceptions">
      <ul>
        {filters.map(filter => (
          <li key={filter.id}>
            <label>
              <input
                type="checkbox"
                checked={filter.enabled}
                aria-label={t('panel.exceptions.toggle', { label: filter.label })}
                onChange={() => { onToggle(filter.id) }}
              />
              <span>{filter.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Props of {@link ConsolePanel}. */
export interface ConsolePanelProps {
  /** Bounded console entries, oldest first. */
  readonly entries: readonly { readonly seq: number; readonly text: string }[]
  /** How many older entries the bound dropped. */
  readonly dropped: number
  /** Dictionary translate for the `debug` namespace. */
  readonly t: DebugTranslate
}

/**
 * Render the debug console with its truncation notice, so a full ring states
 * what was dropped instead of silently hiding it.
 * @param props - entries, dropped count, and locale.
 * @returns the panel element.
 */
export function ConsolePanel(props: ConsolePanelProps): ReactElement {
  const { entries, dropped, t } = props
  return (
    <section aria-label={t('panel.console.label')} data-debug-panel="console" data-dropped={dropped}>
      {entries.length === 0 ? <p>{t('panel.console.empty')}</p> : null}
      {dropped > 0 ? <p data-debug-console-truncated="">{t('panel.console.truncated', { count: dropped })}</p> : null}
      <pre>{entries.map(entry => entry.text).join('')}</pre>
    </section>
  )
}

/** One module as the modules panel receives it. */
export interface DebugModuleRow {
  /** Module name. */
  readonly name: string
  /** Module version when the adapter reported one. */
  readonly version?: string | undefined
  /** Module path when the adapter reported one. */
  readonly path?: string | undefined
}

/** Shared props of the four capability-gated inspection panels. */
interface GatedPanelProps {
  /** Whether the adapter declared support for this panel's request. */
  readonly supported: boolean
  /** Dictionary translate for the `debug` namespace. */
  readonly t: DebugTranslate
}

/** Props of {@link ModulesPanel}. */
export interface ModulesPanelProps extends GatedPanelProps {
  /** Modules of the selected session. */
  readonly modules: readonly DebugModuleRow[]
}

/**
 * Render the module list; renders nothing when `supportsModulesRequest` is
 * false.
 * @param props - support flag, modules, and locale.
 * @returns the panel element, or null without support.
 */
export function ModulesPanel(props: ModulesPanelProps): ReactElement | null {
  const { supported, modules, t } = props
  if (!supported) return null
  return (
    <section aria-label={t('panel.modules.label')} data-debug-panel="modules">
      <ul>
        {modules.map(module => (
          <li key={module.name}>
            {module.name}
            {module.version === undefined ? null : <span> {module.version}</span>}
            {module.path === undefined ? null : <span> {module.path}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One loaded source as the loaded-sources panel receives it. */
export interface DebugLoadedSourceRow {
  /** Source name as the adapter reported it. */
  readonly name: string
  /** Workspace-relative path when the source maps to one. */
  readonly path?: string | undefined
}

/** Props of {@link LoadedSourcesPanel}. */
export interface LoadedSourcesPanelProps extends GatedPanelProps {
  /** Loaded sources of the selected session. */
  readonly sources: readonly DebugLoadedSourceRow[]
}

/**
 * Render the loaded-source list; renders nothing when
 * `supportsLoadedSourcesRequest` is false.
 * @param props - support flag, sources, and locale.
 * @returns the panel element, or null without support.
 */
export function LoadedSourcesPanel(props: LoadedSourcesPanelProps): ReactElement | null {
  const { supported, sources, t } = props
  if (!supported) return null
  return (
    <section aria-label={t('panel.sources.label')} data-debug-panel="sources">
      <ul>
        {sources.map(source => (
          <li key={source.name}>
            {source.name}
            {source.path === undefined ? null : <span> {source.path}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One disassembled instruction as the disassembly panel receives it. */
export interface DebugInstructionRow {
  /** Instruction address as the adapter formatted it. */
  readonly address: string
  /** Instruction text. */
  readonly instruction: string
}

/** Props of {@link DisassemblyPanel}. */
export interface DisassemblyPanelProps extends GatedPanelProps {
  /** Instructions around the stopped location. */
  readonly instructions: readonly DebugInstructionRow[]
}

/**
 * Render disassembled instructions read-only; renders nothing when
 * `supportsDisassembleRequest` is false.
 * @param props - support flag, instructions, and locale.
 * @returns the panel element, or null without support.
 */
export function DisassemblyPanel(props: DisassemblyPanelProps): ReactElement | null {
  const { supported, instructions, t } = props
  if (!supported) return null
  return (
    <section aria-label={t('panel.disassembly.label')} data-debug-panel="disassembly">
      <pre>{instructions.map(instruction => `${instruction.address}  ${instruction.instruction}`).join('\n')}</pre>
    </section>
  )
}

/** One memory block as the memory panel receives it. */
export interface DebugMemoryRow {
  /** Memory reference as the adapter formatted it. */
  readonly address: string
  /** Hex-rendered block contents. */
  readonly contents: string
}

/** Props of {@link MemoryPanel}. */
export interface MemoryPanelProps extends GatedPanelProps {
  /** Read memory blocks of the selected session. */
  readonly memory: readonly DebugMemoryRow[]
}

/**
 * Render read-only memory blocks. Memory writes stay absent entirely: the
 * design keeps write disabled by default, so the panel states that instead of
 * offering a control the composition must not expose.
 * @param props - support flag, memory blocks, and locale.
 * @returns the panel element, or null without support.
 */
export function MemoryPanel(props: MemoryPanelProps): ReactElement | null {
  const { supported, memory, t } = props
  if (!supported) return null
  return (
    <section aria-label={t('panel.memory.label')} data-debug-panel="memory">
      <p>{t('panel.memory.writeDisabled')}</p>
      <ul>
        {memory.map(block => (
          <li key={block.address}>
            <span>{block.address}</span>
            <code>{block.contents}</code>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Notification toggle props, shared by the toolbar and the settings panel. */
export interface NotificationToggleProps {
  /** Whether agent stop notifications are enabled. */
  readonly checked: boolean
  /** Dictionary translate for the `debug` namespace. */
  readonly t: DebugTranslate
  /** Toggle gesture. */
  readonly onChange: (enabled: boolean) => void
}

/**
 * Render the agent-stop notification toggle as a labelled checkbox.
 * @param props - state, locale, and the toggle gesture.
 * @returns the toggle element.
 */
export function NotificationToggle(props: NotificationToggleProps): ReactElement {
  const { checked, t, onChange } = props
  return (
    <label data-debug-notifications={checked ? 'on' : 'off'}>
      <input
        type="checkbox"
        checked={checked}
        aria-label={t('notifications.agent')}
        onChange={(event) => { onChange(event.target.checked) }}
      />
      <span>{t('notifications.agent')}</span>
    </label>
  )
}

/** One installed adapter as the adapter settings panel receives it. */
export interface DebugAdapterRow {
  /** Provider id as the wire string. */
  readonly providerId: string
  /** Installed adapter version. */
  readonly version: string
  /** Platform the installed build targets. */
  readonly platform: string
  /** License of the installed build. */
  readonly license: string
  /** SHA-256 of the installed archive. */
  readonly sha256: string
}

/** Props of {@link AdapterSettingsPanel}. */
export interface AdapterSettingsPanelProps {
  /** Installed adapters in provider order. */
  readonly installed: readonly DebugAdapterRow[]
  /** The user's adapter override path when one is configured. */
  readonly overridePath?: string | undefined
  /** Whether an install/update/uninstall/self-test operation is running. */
  readonly busy: boolean
  /** Dictionary translate for the `debug` namespace. */
  readonly t: DebugTranslate
  /** Install gesture for one provider. */
  readonly onInstall: (providerId: string) => void
  /** Update gesture for one provider. */
  readonly onUpdate: (providerId: string) => void
  /** Uninstall gesture for one provider. */
  readonly onUninstall: (providerId: string) => void
  /** Self-test gesture for one provider. */
  readonly onSelfTest: (providerId: string) => void
}

/**
 * Render the adapter settings panel: installed versions, platform, license,
 * SHA-256, the install/update/uninstall/self-test actions, the override path,
 * and the in-progress notice. The workbench wiring owns progress reporting
 * and cancellation; this panel states that an operation is running.
 * @param props - installed rows, override path, locale, and gestures.
 * @returns the panel element.
 */
export function AdapterSettingsPanel(props: AdapterSettingsPanelProps): ReactElement {
  const { installed, overridePath, busy, t, onInstall, onUpdate, onUninstall, onSelfTest } = props
  return (
    <section aria-label={t('adapter.label')} data-debug-panel="adapters" data-busy={busy ? 'true' : 'false'}>
      {overridePath === undefined ? null : <p>{t('adapter.override', { path: overridePath })}</p>}
      {busy ? <p data-debug-adapter-busy="">{t('adapter.busy')}</p> : null}
      <ul>
        {installed.map(adapter => (
          <li key={adapter.providerId} data-debug-adapter={adapter.providerId}>
            <span>{adapter.providerId}</span>
            <span>{t('adapter.version', { version: adapter.version })}</span>
            <span>{t('adapter.platform', { platform: adapter.platform })}</span>
            <span>{t('adapter.license', { license: adapter.license })}</span>
            <span>{t('adapter.sha256', { sha256: adapter.sha256 })}</span>
            <button type="button" data-debug-adapter-install="" onClick={() => { onInstall(adapter.providerId) }}>
              {t('adapter.install')}
            </button>
            <button type="button" data-debug-adapter-update="" onClick={() => { onUpdate(adapter.providerId) }}>
              {t('adapter.update')}
            </button>
            <button type="button" data-debug-adapter-uninstall="" onClick={() => { onUninstall(adapter.providerId) }}>
              {t('adapter.uninstall')}
            </button>
            <button type="button" data-debug-adapter-self-test="" onClick={() => { onSelfTest(adapter.providerId) }}>
              {t('adapter.selfTest')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
