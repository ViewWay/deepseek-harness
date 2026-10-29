/**
 * The TUI debug surface (design 9.8): the `:` command family parser, the pane
 * reducer and renderer over the live `ctx.debug` events, the bounded source
 * preview, and the `$EDITOR` handoff — all consuming the in-process
 * `ctx.debug` seam directly, with no Remote layer and no PTY dependency.
 *
 * The plugin provides the optional `tuiDebugPane` service (the rendered pane
 * lines plus the command dispatcher) when a debug seam is composed; the TUI
 * app renders its placeholder when the service is absent or fails.
 * @module @deepseek-ai/dsh-tui-debug
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Debug } from '@deepseek-ai/dsh-debug'
import { DebugError, DebugSessionId as brandSessionId } from '@deepseek-ai/dsh-debug'
import { DEBUG_KEY_COMMANDS, isDebugCommand, parseDebugCommand } from './commands.ts'
import type { TuiDebugCommand } from './commands.ts'
import { DEFAULT_MAX_CONSOLE_ENTRIES, createDebugPaneState, foldDebugEvent, renderDebugPaneLines } from './panels.ts'
import type { TuiDebugPaneState } from './panels.ts'
import { openInEditor } from './editor.ts'
import type { TuiEditorLaunch } from './editor.ts'

export {
  DEBUG_KEY_COMMANDS,
  isDebugCommand,
  parseDebugCommand,
} from './commands.ts'
export type { TuiDebugCommand } from './commands.ts'
export {
  DEFAULT_MAX_CONSOLE_ENTRIES,
  createDebugPaneState,
  foldDebugEvent,
  renderDebugPaneLines,
} from './panels.ts'
export type {
  TuiDebugBreakpointRow,
  TuiDebugConsoleRow,
  TuiDebugFrameRow,
  TuiDebugPaneOptions,
  TuiDebugPaneState,
  TuiDebugSessionRow,
  TuiDebugSourceLocation,
  TuiDebugVariableRow,
} from './panels.ts'
export {
  DEFAULT_MAX_SCAN_BYTES,
  SourceWindowError,
  readSourceWindow,
  sourceWindow,
} from './source-preview.ts'
export type {
  ReadSourceWindowOptions,
  SourceWindow,
  TuiSourceReader,
  TuiSourceTarget,
} from './source-preview.ts'
export { editorCommand, openInEditor } from './editor.ts'
export type { OpenInEditorOptions, TuiEditorLaunch, TuiEditorOutcome } from './editor.ts'

/**
 * The pane face the TUI app renders: the pane lines as of now, change
 * notifications, and the `:` command dispatcher. Command failures land in
 * the pane console, never as thrown errors, so consumption stays total.
 */
export interface TuiDebugPaneSource {
  /**
   * The rendered pane lines as of now.
   * @returns the plain-text lines in display order.
   */
  current(): readonly string[]
  /**
   * Subscribe to pane-line changes.
   * @param listener - the listener receiving the next lines.
   * @returns the disposer; after it runs the listener sees nothing further.
   */
  subscribe(listener: (lines: readonly string[]) => void): () => void
  /**
   * Run one raw `:` input line against the debug seam.
   * @param line - the raw line, with or without the leading colon.
   * @returns false when the line is empty, names an app-owned command
   * (layouts, help, quit), or names an operation outside the debug table —
   * the app then shows its own unknown-command notice; true when the pane
   * consumed it, including malformed-argument errors recorded in the console.
   */
  run(line: string): boolean
  /**
   * Run one debug function key (design 9.8.2: F5, Shift+F5, F9, F10, F11,
   * Shift+F11) as its mapped command.
   * @param key - the decoded function-key name.
   * @returns false when the key has no debug mapping; otherwise the mapped
   * command's {@link TuiDebugPaneSource.run} outcome.
   */
  runKey(key: string): boolean
  /**
   * Open the current source location in the configured editor. Without a
   * known location or editor command the pane console records why nothing
   * opened; a remote workspace without one records the copyable path.
   */
  openEditor(): void
}

/** Options of the pane source and the plugin. */
export interface TuiDebugPaneSourceOptions {
  /** Console-ring capacity (default {@link DEFAULT_MAX_CONSOLE_ENTRIES}). */
  readonly maxConsoleEntries?: number
  /**
   * Resolve the editor command at command time; defaults to the `$EDITOR`
   * environment variable. Returning undefined records unavailability.
   */
  readonly resolveEditor?: () => string | undefined
  /** True when the debugged workspace is remote (default false). */
  readonly remoteWorkspace?: boolean
  /** The process launcher for the editor handoff; required to open editors. */
  readonly launch?: TuiEditorLaunch
}

/** One pane source with its live subscription, released together. */
export interface TuiDebugPaneSourceHandle {
  /** The pane face provided to the TUI app. */
  readonly pane: TuiDebugPaneSource
  /** Stop the event subscription; the pane source is inert afterwards. */
  dispose(): void
}

/**
 * One pane source's mutable parts: the state, its subscribers, and the
 * options the command dispatcher resolves at call time.
 */
interface PaneCore {
  state: TuiDebugPaneState
  readonly listeners: Set<(lines: readonly string[]) => void>
  readonly maxConsoleEntries: number
  readonly resolveEditor: () => string | undefined
  readonly remoteWorkspace: boolean
  readonly launch: TuiEditorLaunch | undefined
}

/**
 * Fold one event into the core state and notify subscribers.
 * @param core - the pane core.
 * @param event - the committed debug event.
 */
function absorb(core: PaneCore, event: Parameters<typeof foldDebugEvent>[1]): void {
  core.state = foldDebugEvent(core.state, event, { maxConsoleEntries: core.maxConsoleEntries })
  emit(core)
}

/**
 * Notify every subscriber of the current lines.
 * @param core - the pane core.
 */
function emit(core: PaneCore): void {
  const lines = renderDebugPaneLines(core.state)
  for (const listener of core.listeners) listener(lines)
}

/**
 * Record one console line in the pane.
 * @param core - the pane core.
 * @param text - the line text.
 */
function notice(core: PaneCore, text: string): void {
  const sessionId = core.state.activeSessionId ?? brandSessionId('debug-pane')
  absorb(core, { kind: 'console/output', sessionId, workspaceId: 'pane', text, truncated: false })
}

/**
 * Describe one thrown value with its stable code when it is a seam failure.
 * @param error - the thrown value.
 * @returns the code-plus-message line.
 */
function errorLine(error: unknown): string {
  return error instanceof DebugError ? `${error.code} ${error.message}` : String(error)
}

/**
 * Resolve the editor-handoff console notice for the pane's current location.
 * @param location - the pane's current source location; undefined when the
 * session face has not published one yet.
 * @param editor - the configured editor command; undefined when none is.
 * @param remote - whether the workspace is remote.
 * @param launch - the process launcher, required to open a configured editor.
 * @returns the notice line describing what happened.
 */
export function openEditorNotice(
  location: { readonly file: string; readonly line: number } | undefined,
  editor: string | undefined,
  remote: boolean,
  launch: TuiEditorLaunch | undefined,
): string {
  if (location === undefined) return 'editor: no source location is known yet'
  const outcome = openInEditor({
    editor,
    file: location.file,
    line: location.line,
    remote,
    ...(launch !== undefined ? { launch } : {}),
  })
  if (outcome.kind === 'opened') return `editor: ${outcome.argv.join(' ')}`
  if (outcome.kind === 'remote-path') return `editor: copy this remote path: ${outcome.path}`
  return 'editor: no $EDITOR is configured'
}

/**
 * Create the pane source over one debug seam.
 * @param debug - the in-process debug seam this surface consumes directly.
 * @param options - ring bounds, editor resolution, workspace kind, and the
 * editor launcher.
 * @returns the source handle: the pane face and its subscription disposer.
 */
export function createTuiDebugPaneSource(debug: Debug, options: TuiDebugPaneSourceOptions = {}): TuiDebugPaneSourceHandle {
  const core: PaneCore = {
    state: createDebugPaneState(),
    listeners: new Set(),
    maxConsoleEntries: options.maxConsoleEntries ?? DEFAULT_MAX_CONSOLE_ENTRIES,
    resolveEditor: options.resolveEditor ?? ((): string | undefined => process.env['EDITOR']),
    remoteWorkspace: options.remoteWorkspace ?? false,
    launch: options.launch,
  }
  const stopEvents = debug.events.subscribe({}, (event) => { absorb(core, event) })
  const pane: TuiDebugPaneSource = {
    current: () => renderDebugPaneLines(core.state),
    subscribe(listener) {
      core.listeners.add(listener)
      return () => {
        core.listeners.delete(listener)
      }
    },
    run(line) {
      const trimmed = line.trim()
      if (!trimmed.startsWith(':')) return false
      const name = trimmed.slice(1).split(/\s+/)[0]
      if (name === undefined || name === '' || !isDebugCommand(name)) return false
      let command: TuiDebugCommand
      try {
        command = parseDebugCommand(line)
      } catch (error: unknown) {
        // An unknown operation belongs to the app's unknown-command notice,
        // not the pane console: declining it lets run.ts fall through.
        if (error instanceof DebugError && error.code === 'DEBUG_UNKNOWN_OPERATION') return false
        notice(core, `error: ${errorLine(error)}`)
        emit(core)
        return true
      }
      void execute(core, debug, command).then(() => { emit(core) })
      emit(core)
      return true
    },
    runKey(key) {
      const line = DEBUG_KEY_COMMANDS[key]
      if (line === undefined) return false
      return this.run(line)
    },
    openEditor() {
      // The containment contract: handoff failures land in the pane console,
      // never as thrown errors into the app's input callback.
      try {
        notice(core, openEditorNotice(core.state.source, core.resolveEditor(), core.remoteWorkspace, core.launch))
      } catch (error: unknown) {
        notice(core, `error: ${errorLine(error)}`)
      }
      emit(core)
    },
  }
  return {
    pane,
    dispose: stopEvents,
  }
}

/**
 * Execute one parsed command against the seam's landed face. Operations whose
 * backing session face has not landed record a typed unavailability in the
 * pane console instead of failing the command loop.
 * @param core - the pane core.
 * @param debug - the debug seam.
 * @param command - the parsed command.
 */
async function execute(core: PaneCore, debug: Debug, command: TuiDebugCommand): Promise<void> {
  switch (command.name) {
    case 'sessions': {
      const rows = debug.list().map(info => `${info.id} ${info.state}`).join('; ')
      notice(core, rows === '' ? 'sessions: none' : `sessions: ${rows}`)
      return
    }
    case 'switch': {
      const session = debug.get(brandSessionId(command.sessionId))
      if (session === undefined) {
        notice(core, `error: DEBUG_SESSION_GONE no debug session ${command.sessionId}`)
        return
      }
      core.state = { ...core.state, activeSessionId: session.id }
      notice(core, `switched to ${String(session.id)}`)
      return
    }
    case 'terminate':
    case 'disconnect': {
      const session = activeSession(debug, core)
      if (session === undefined) return
      try {
        await (command.name === 'terminate' ? session.terminate() : session.disconnect())
      } catch (error: unknown) {
        notice(core, `error: ${errorLine(error)}`)
      }
      return
    }
    default:
      notice(core, `unavailable: ${command.name} (DEBUG_UNAVAILABLE) the DAP session face has not landed for this operation`)
  }
}

/**
 * Resolve the pane's active session.
 * @param debug - the debug seam.
 * @param core - the pane core.
 * @returns the live session, or undefined with a console notice.
 */
function activeSession(debug: Debug, core: PaneCore): ReturnType<Debug['get']> {
  const id = core.state.activeSessionId
  if (id === undefined) {
    notice(core, 'error: DEBUG_INVALID_CONFIG no active debug session')
    return undefined
  }
  const session = debug.get(id)
  if (session === undefined) notice(core, `error: DEBUG_SESSION_GONE no debug session ${String(id)}`)
  return session
}

/** Stable Cordis plugin name. */
export const name = 'tui-debug'

/** No required services: the debug seam is consumed only when composed. */
export const inject: readonly string[] = []

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The TUI debug pane source; provided only when a debug seam is composed. */
    tuiDebugPane?: TuiDebugPaneSource
  }
}

/**
 * Provide the optional `tuiDebugPane` service when a debug seam is composed.
 * The registration (event subscription and service value) releases with the
 * plugin effect; without a debug seam this plugin composes nothing and the
 * TUI app keeps its placeholder pane.
 * @param ctx - the plugin context.
 * @param options - pane bounds and editor-handoff configuration.
 */
export function apply(ctx: Context, options: TuiDebugPaneSourceOptions = {}): void {
  const debug: Debug | undefined = ctx.get('debug')
  if (debug === undefined) return
  ctx.effect(function* (this: Context) {
    const handle = createTuiDebugPaneSource(debug, options)
    const disposeProvide = this.provide('tuiDebugPane', handle.pane)
    yield () => {
      disposeProvide()
      handle.dispose()
    }
  }.bind(ctx), 'tui-debug.apply()')
}
