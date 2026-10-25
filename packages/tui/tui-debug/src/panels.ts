/**
 * The TUI debug pane state: a pure reducer folding the live `ctx.debug`
 * event stream (design 9.8.2's debug workspace sections) into renderable
 * rows, and the plain-text renderer the Ink pane consumes. Stack, variables,
 * watch, and source sections exist in the state but stay empty until the DAP
 * session face publishes them; the renderer hides empty sections, which is
 * how unsupported actions stay invisible in the terminal.
 * @module @deepseek-ai/dsh-tui-debug/panels
 */

import type { DebugEvent, DebugEventActor, DebugSessionId, DebugSessionState } from '@deepseek-ai/dsh-debug'

/**
 * The closed-union exhaustiveness guard; the fold's default branch proves the
 * `DebugEvent` union stayed fully handled at compile time.
 * @param value - the unreachable event.
 * @returns never; always throws.
 */
/* v8 ignore next 3 -- unreachable at runtime while the union stays fully handled. */
function assertNever(value: never): never {
  throw new Error(`unhandled debug event kind ${JSON.stringify(value)}`)
}

/** Default console-ring capacity; older entries drop once the ring fills. */
export const DEFAULT_MAX_CONSOLE_ENTRIES = 200

/** One debug session's status row. */
export interface TuiDebugSessionRow {
  readonly id: DebugSessionId
  readonly workspaceId: string
  readonly state: DebugSessionState
  /** Which side terminated the session; set only on terminal rows. */
  readonly actor: DebugEventActor | undefined
}

/** One console or adapter output row. */
export interface TuiDebugConsoleRow {
  readonly channel: 'console' | 'adapter'
  readonly text: string
  readonly truncated: boolean
}

/** One breakpoint row projected from a `breakpoint/changed` result. */
export interface TuiDebugBreakpointRow {
  readonly sessionId: DebugSessionId
  readonly file: string
  readonly line: number
  readonly verified: boolean
  readonly actualLine?: number
  readonly message?: string
}

/** One call-stack frame row; populated when the session face lands. */
export interface TuiDebugFrameRow {
  readonly id: string
  readonly name: string
  readonly file: string
  readonly line: number
}

/** One variable row; populated when the session face lands. */
export interface TuiDebugVariableRow {
  readonly scope: string
  readonly name: string
  readonly value: string
}

/** The current source location; populated when the session face lands. */
export interface TuiDebugSourceLocation {
  readonly file: string
  readonly line: number
}

/** The TUI debug pane state at one point in time. */
export interface TuiDebugPaneState {
  readonly sessions: readonly TuiDebugSessionRow[]
  /** The session commands act on; the first registered session until switched. */
  readonly activeSessionId: DebugSessionId | undefined
  readonly console: readonly TuiDebugConsoleRow[]
  readonly breakpoints: readonly TuiDebugBreakpointRow[]
  /** Empty until the DAP session face publishes stack facts. */
  readonly stack: readonly TuiDebugFrameRow[]
  /** Empty until the DAP session face publishes variables. */
  readonly variables: readonly TuiDebugVariableRow[]
  /** Empty until the DAP session face publishes watch expressions. */
  readonly watch: readonly string[]
  /** Undefined until the DAP session face publishes the stop location. */
  readonly source: TuiDebugSourceLocation | undefined
}

/** Fold bounds for one pane source. */
export interface TuiDebugPaneOptions {
  /** Largest console ring; the newest survive (default {@link DEFAULT_MAX_CONSOLE_ENTRIES}). */
  readonly maxConsoleEntries?: number
}

/**
 * Create the empty pane state.
 * @returns the initial state.
 */
export function createDebugPaneState(): TuiDebugPaneState {
  return {
    sessions: [],
    activeSessionId: undefined,
    console: [],
    breakpoints: [],
    stack: [],
    variables: [],
    watch: [],
    source: undefined,
  }
}

/** One breakpoint result's row-able sides, narrowed from `DebugBreakpointResult`. */
interface BreakpointResultRows {
  readonly applied: readonly {
    readonly source: { readonly workspaceRelativePath: string }
    readonly requestedLine: number
    readonly verified: boolean
    readonly actualLine?: number
  }[]
  readonly rejected: readonly {
    readonly source: { readonly workspaceRelativePath: string }
    readonly requestedLine: number
    readonly verified: boolean
    readonly message?: string
  }[]
}

/**
 * Fold one committed debug event into the next pane state. The input state is
 * never mutated; callers pass the returned state on.
 * @param state - the current pane state.
 * @param event - one live debug event, published after its state committed.
 * @param options - fold bounds; the console ring defaults to
 * {@link DEFAULT_MAX_CONSOLE_ENTRIES}.
 * @returns the next pane state.
 * @throws when the event kind is outside the closed `DebugEvent` union.
 */
export function foldDebugEvent(
  state: TuiDebugPaneState,
  event: DebugEvent,
  options: TuiDebugPaneOptions = {},
): TuiDebugPaneState {
  const consoleBound = options.maxConsoleEntries ?? DEFAULT_MAX_CONSOLE_ENTRIES
  switch (event.kind) {
    case 'session/starting': {
      const row: TuiDebugSessionRow = { id: event.sessionId, workspaceId: event.workspaceId, state: 'starting', actor: undefined }
      return {
        ...state,
        sessions: [...state.sessions.filter(existing => existing.id !== event.sessionId), row],
        activeSessionId: state.activeSessionId ?? event.sessionId,
      }
    }
    case 'session/running':
      return withSessionState(state, event.sessionId, 'running')
    case 'session/stopped':
      return withSessionState(state, event.sessionId, 'stopped')
    case 'session/failed':
      return withSessionState(state, event.sessionId, 'failed')
    case 'session/terminated':
      return withSessionState(state, event.sessionId, 'terminated', event.actor)
    case 'breakpoint/changed': {
      // The seam publishes one event per set-breakpoints call, which is per
      // file; this event's rows replace only their file's rows.
      const fresh = breakpointRows(event.sessionId, event.result)
      const touched = new Set(fresh.map(row => `${row.sessionId} ${row.file}`))
      return {
        ...state,
        breakpoints: [...state.breakpoints.filter(row => !touched.has(`${row.sessionId} ${row.file}`)), ...fresh],
      }
    }
    case 'console/output':
    case 'adapter/output': {
      const row: TuiDebugConsoleRow = {
        channel: event.kind === 'console/output' ? 'console' : 'adapter',
        text: event.text,
        truncated: event.truncated,
      }
      return { ...state, console: [...state.console, row].slice(-consoleBound) }
    }
    case 'capabilities/changed':
      return state
    case 'session/owner-changed': {
      const row: TuiDebugConsoleRow = {
        channel: 'console',
        text: `ownership of ${event.sessionId}: ${event.from.kind} ${event.from.sessionId} -> ${event.to.kind} ${event.to.sessionId}`,
        truncated: false,
      }
      return { ...state, console: [...state.console, row].slice(-consoleBound) }
    }
    /* v8 ignore next 2 -- unreachable while the fold above stays fully handled at compile time. */
    default:
      return assertNever(event)
  }
}

/**
 * Replace one session row's state (and actor), keeping registration order.
 * @param state - the current pane state.
 * @param sessionId - the session whose row moves.
 * @param nextState - the new lifecycle state.
 * @param actor - the terminating side, on terminal rows.
 * @returns the next pane state.
 */
function withSessionState(
  state: TuiDebugPaneState,
  sessionId: DebugSessionId,
  nextState: DebugSessionState,
  actor?: DebugEventActor,
): TuiDebugPaneState {
  return {
    ...state,
    sessions: state.sessions.map(row =>
      row.id === sessionId
        ? { ...row, state: nextState, ...(actor !== undefined ? { actor } : { actor: row.actor }) }
        : row),
  }
}

/**
 * Project one breakpoint result into pane rows, applied first then rejected.
 * @param sessionId - the session the result belongs to.
 * @param result - the applied and rejected breakpoint sides.
 * @returns the pane rows.
 */
function breakpointRows(sessionId: DebugSessionId, result: BreakpointResultRows): readonly TuiDebugBreakpointRow[] {
  return [
    ...result.applied.map(breakpoint => ({
      sessionId,
      file: breakpoint.source.workspaceRelativePath,
      line: breakpoint.requestedLine,
      verified: breakpoint.verified,
      ...(breakpoint.actualLine !== undefined ? { actualLine: breakpoint.actualLine } : {}),
    })),
    ...result.rejected.map(breakpoint => ({
      sessionId,
      file: breakpoint.source.workspaceRelativePath,
      line: breakpoint.requestedLine,
      verified: false,
      ...(breakpoint.message !== undefined ? { message: breakpoint.message } : {}),
    })),
  ]
}

/**
 * Render the pane state as plain-text lines, one section header per
 * non-empty section. Empty sections (unsupported or unpopulated facts) are
 * hidden rather than rendered as gaps.
 * @param state - the pane state to render.
 * @returns the pane lines in display order.
 */
export function renderDebugPaneLines(state: TuiDebugPaneState): readonly string[] {
  const lines: string[] = []
  for (const session of state.sessions) {
    const label = session.state === 'terminated' && session.actor !== undefined
      ? `${session.state} by ${session.actor}`
      : session.state
    const activeSuffix = session.id === state.activeSessionId ? ' (active)' : ''
    lines.push(`debug · ${session.id} · ${session.workspaceId} · ${label}${activeSuffix}`)
  }
  if (state.stack.length > 0) {
    lines.push('stack:')
    for (const frame of state.stack) lines.push(`  ${frame.id} ${frame.name} ${frame.file}:${frame.line}`)
  }
  if (state.variables.length > 0) {
    lines.push('variables:')
    for (const variable of state.variables) lines.push(`  ${variable.scope}.${variable.name} = ${variable.value}`)
  }
  if (state.watch.length > 0) {
    lines.push('watch:')
    for (const expression of state.watch) lines.push(`  ${expression}`)
  }
  if (state.breakpoints.length > 0) {
    lines.push('breakpoints:')
    for (const breakpoint of state.breakpoints) lines.push(`  ${breakpointMark(breakpoint)}`)
  }
  if (state.console.length > 0) {
    lines.push('console:')
    for (const entry of state.console) {
      lines.push(`  ${entry.channel === 'adapter' ? '[adapter] ' : ''}${entry.text}${entry.truncated ? ' (truncated)' : ''}`)
    }
  }
  if (state.source !== undefined) lines.push(`source ${state.source.file}:${state.source.line}`)
  if (lines.length === 0) lines.push('debug: no sessions')
  return lines
}

/**
 * Render one breakpoint row: verified, moved, rejected, or unverified.
 * @param breakpoint - the row to render.
 * @returns the row text.
 */
function breakpointMark(breakpoint: TuiDebugBreakpointRow): string {
  if (breakpoint.message !== undefined) return `x ${breakpoint.file}:${breakpoint.line} ${breakpoint.message}`
  if (!breakpoint.verified) {
    return breakpoint.actualLine !== undefined
      ? `? ${breakpoint.file}:${breakpoint.line} (actual ${breakpoint.actualLine})`
      : `? ${breakpoint.file}:${breakpoint.line}`
  }
  return `+ ${breakpoint.file}:${breakpoint.line} verified`
}
