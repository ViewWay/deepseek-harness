/**
 * The debug view store: the client-side fold of one composition's live debug
 * events. It keeps the selected session/thread/frame, the lazy variable
 * expansion set, watch expressions, and the console cursor. A continue or
 * termination clears the stop, frame, and variable references and marks the
 * stack and variables stale, so panels describe the previous stop instead of
 * presenting it as current.
 *
 * Ids and paths are plain client-plane values decoded from the debug
 * controller's event ring (whose payloads are wire JSON); branded seam ids
 * never cross the Remote. Action visibility derives from the reported
 * capabilities, so an adapter that lacks a feature never shows the control
 * that would fail.
 * @module @deepseek-ai/dsh-client-ui-debug/store
 */
import type { DebugCapabilities, DebugSessionState } from '@deepseek-ai/dsh-debug'
import type { DebugStopSnapshot } from '@deepseek-ai/dsh-debug/types'
import { assertNever } from '@deepseek-ai/dsh-util-values'

/** Stop reason as the seam's closed union; the wire carries the same strings. */
export type DebugStopReason = DebugStopSnapshot['reason']

/** One stopped-thread snapshot as the view plane receives it. */
export interface DebugStopView {
  /** Session the stop belongs to. */
  readonly sessionId: string
  /** Why the thread stopped. */
  readonly reason: DebugStopReason
  /** Thread that stopped, as the DAP number the wire carries. */
  readonly threadId: number
  /** Top stack frame when the adapter reported one. */
  readonly frameId?: string
  /** Workspace-relative source path of the stop location. */
  readonly source: string
  /** Stop line, one-based. */
  readonly line: number
  /** Stop column, one-based. */
  readonly column: number
  /** Adapter's human-readable description of the stop. */
  readonly description?: string
}

/** One thread of a debug session as the view plane receives it. */
export interface DebugThreadView {
  /** Thread id, as the DAP number the wire carries. */
  readonly id: number
  /** Adapter-provided thread name. */
  readonly name: string
}

/** One bounded console entry with its per-session sequence. */
export interface DebugConsoleEntry {
  /** Per-session monotonic console sequence; the view cursor stores it. */
  readonly seq: number
  /** Output text, ANSI stripped or kept as delivered. */
  readonly text: string
  /** True when the host truncated this entry. */
  readonly truncated: boolean
}

/**
 * Live debug notification as the view plane folds it; the discriminated
 * client projection of the debug controller's event ring payloads.
 */
export type DebugViewEvent =
  | { readonly kind: 'session/state'; readonly sessionId: string; readonly state: DebugSessionState }
  | { readonly kind: 'session/stopped'; readonly stop: DebugStopView }
  | { readonly kind: 'session/continued'; readonly sessionId: string }
  | { readonly kind: 'session/terminated'; readonly sessionId: string }
  | { readonly kind: 'capabilities/changed'; readonly sessionId: string; readonly capabilities: DebugCapabilities }
  | { readonly kind: 'threads/changed'; readonly sessionId: string; readonly threads: readonly DebugThreadView[] }
  | {
    readonly kind: 'console/output'
    readonly sessionId: string
    readonly seq: number
    readonly text: string
    readonly truncated: boolean
  }

/** Immutable view state one debug composition renders from. */
export interface DebugViewState {
  /** Known sessions and their states, insertion-ordered. */
  readonly sessionStates: Readonly<Record<string, DebugSessionState>>
  /** Session the panels and toolbar address. */
  readonly selectedSessionId: string | undefined
  /** Thread selected within the stopped session. */
  readonly selectedThreadId: number | undefined
  /** Frame selected within the stopped thread; cleared on continue. */
  readonly selectedFrameId: string | undefined
  /** Current stop snapshot; cleared on continue and termination. */
  readonly stop: DebugStopView | undefined
  /** Threads of the selected session. */
  readonly threads: readonly DebugThreadView[]
  /** Reported capabilities of the selected session. */
  readonly capabilities: DebugCapabilities | undefined
  /** Variable container references the user expanded, as wire numbers. */
  readonly expandedVariableReferences: readonly number[]
  /** True when the last continue or termination invalidated variable values. */
  readonly variablesStale: boolean
  /** True when the last continue or termination invalidated stack frames. */
  readonly stackStale: boolean
  /** Watch expressions in user order, deduplicated. */
  readonly watches: readonly string[]
  /** Console entries, oldest first, bounded to the newest. */
  readonly consoleEntries: readonly DebugConsoleEntry[]
  /** Newest applied console sequence. */
  readonly consoleCursor: number
}

/** Toolbar action, capability-gated through {@link visibleDebugActions}. */
export type DebugAction =
  | 'start'
  | 'restart'
  | 'continue'
  | 'pause'
  | 'stepOver'
  | 'stepIn'
  | 'stepOut'
  | 'stepBack'
  | 'restartFrame'
  | 'stop'
  | 'disconnect'

/** Console entries the view keeps; older entries drop as one bounded ring. */
const CONSOLE_BOUND = 200

/** Initial empty view state. */
const EMPTY_STATE: DebugViewState = {
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
}

/**
 * Order the toolbar's capability-gated actions. Session-level actions
 * (start, disconnect) and the DAP-mandatory controls (continue, pause, step)
 * are always offered; adapter capabilities gate the rest, so an unsupported
 * action never renders.
 * @param capabilities - the selected session's reported capabilities.
 * @returns visible actions in toolbar order.
 */
export function visibleDebugActions(capabilities: DebugCapabilities): readonly DebugAction[] {
  const actions: DebugAction[] = ['start']
  if (capabilities.supportsRestartRequest) actions.push('restart')
  actions.push('continue', 'pause', 'stepOver', 'stepIn', 'stepOut')
  if (capabilities.supportsStepBack) actions.push('stepBack')
  if (capabilities.supportsRestartFrame) actions.push('restartFrame')
  if (capabilities.supportsTerminateRequest) actions.push('stop')
  actions.push('disconnect')
  return actions
}

/** The store face the toolbar, panels, and workbench wiring consume. */
export interface DebugViewStore {
  /** The current immutable view state. */
  get state(): DebugViewState
  /**
   * Subscribe to state changes.
   * @param listener - notified after every applied transition.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void
  /**
   * Fold one live debug event into the state.
   * @param event - the committed debug fact to fold.
   */
  apply(event: DebugViewEvent): void
  /**
   * Select the session the panels address.
   * @param sessionId - session to select.
   */
  selectSession(sessionId: string): void
  /**
   * Select one thread within the selected session.
   * @param threadId - thread to select.
   */
  selectThread(threadId: number): void
  /**
   * Select one stack frame within the selected thread.
   * @param frameId - frame to select.
   */
  selectFrame(frameId: string): void
  /**
   * Toggle one variable container's lazy expansion.
   * @param reference - variable reference as the wire number.
   */
  toggleExpanded(reference: number): void
  /**
   * Add one watch expression, deduplicated and trimmed.
   * @param expression - expression to watch.
   */
  addWatch(expression: string): void
  /**
   * Remove one watch expression.
   * @param expression - expression to stop watching.
   */
  removeWatch(expression: string): void
}

/**
 * Create one debug view store folding live events into immutable state.
 * @returns the store; state reads reflect every fold already applied.
 */
export function createDebugViewStore(): DebugViewStore {
  let current: DebugViewState = EMPTY_STATE
  const listeners = new Set<() => void>()
  const set = (next: DebugViewState): void => {
    current = next
    for (const listener of [...listeners]) listener()
  }
  const clearStopSelection = (state: DebugViewState): DebugViewState => ({
    ...state,
    stop: undefined,
    selectedFrameId: undefined,
    variablesStale: true,
    stackStale: true,
  })
  const store: DebugViewStore = {
    get state(): DebugViewState {
      return current
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    apply(event: DebugViewEvent): void {
      const state = current
      switch (event.kind) {
        case 'session/state': {
          const known = state.sessionStates[event.sessionId] !== undefined
          set({
            ...state,
            sessionStates: { ...state.sessionStates, [event.sessionId]: event.state },
            ...(known || state.selectedSessionId !== undefined
              ? {}
              : { selectedSessionId: event.sessionId }),
          })
          return
        }
        case 'session/stopped':
          set({
            ...state,
            stop: event.stop,
            selectedSessionId: event.stop.sessionId,
            selectedThreadId: event.stop.threadId,
            selectedFrameId: event.stop.frameId,
            expandedVariableReferences: [],
            variablesStale: false,
            stackStale: false,
          })
          return
        case 'session/continued':
          if (state.selectedSessionId === event.sessionId) set(clearStopSelection(state))
          return
        case 'session/terminated': {
          const selected = state.selectedSessionId === event.sessionId
          const cleared = selected ? clearStopSelection(state) : state
          set({
            ...cleared,
            sessionStates: { ...state.sessionStates, [event.sessionId]: 'terminated' },
            ...(selected ? { selectedThreadId: undefined } : {}),
          })
          return
        }
        case 'capabilities/changed':
          if (state.selectedSessionId === event.sessionId) {
            set({ ...state, capabilities: event.capabilities })
          }
          return
        case 'threads/changed':
          if (state.selectedSessionId === event.sessionId) {
            set({ ...state, threads: event.threads })
          }
          return
        case 'console/output': {
          const entries = [...state.consoleEntries, {
            seq: event.seq,
            text: event.text,
            truncated: event.truncated,
          }]
          set({
            ...state,
            consoleEntries: entries.slice(Math.max(0, entries.length - CONSOLE_BOUND)),
            consoleCursor: Math.max(state.consoleCursor, event.seq),
          })
          return
        }
        default:
          assertNever(event)
      }
    },
    selectSession(sessionId: string): void {
      if (current.selectedSessionId === sessionId) return
      set({ ...EMPTY_STATE, sessionStates: current.sessionStates, selectedSessionId: sessionId })
    },
    selectThread(threadId: number): void {
      set({ ...current, selectedThreadId: threadId })
    },
    selectFrame(frameId: string): void {
      set({ ...current, selectedFrameId: frameId })
    },
    toggleExpanded(reference: number): void {
      const expanded = current.expandedVariableReferences.includes(reference)
        ? current.expandedVariableReferences.filter(seen => seen !== reference)
        : [...current.expandedVariableReferences, reference]
      set({ ...current, expandedVariableReferences: expanded })
    },
    addWatch(expression: string): void {
      const trimmed = expression.trim()
      if (trimmed === '' || current.watches.includes(trimmed)) return
      set({ ...current, watches: [...current.watches, trimmed] })
    },
    removeWatch(expression: string): void {
      set({ ...current, watches: current.watches.filter(watch => watch !== expression) })
    },
  }
  return store
}
