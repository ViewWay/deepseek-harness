/**
 * Deterministic three-surface debug scenarios: one canonical fact timeline
 * replayed through the web view store, the TUI pane reducer, and the headless
 * NDJSON projection, with one normalizer that strips presentation-only fields
 * so a consistency test can compare the surfaces' retained debug facts.
 *
 * The timeline is the durable-commit granularity of the debug seam: lifecycle,
 * breakpoints, stops, controls, and the ending outcome. Each surface driver
 * projects the same timeline into that surface's real input (the client-plane
 * view events, the live `DebugEvent` union, the durable `debug/*` session
 * events), folds it through the surface's real reducer, and keeps the fold
 * output for presentation-level assertions. Ids come from the typed fixture
 * factories; tests never cast with `as never` or `as unknown`.
 * @module @deepseek-ai/dsh-debug-scenarios
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedModel } from '@deepseek-ai/dsh-agent-loop-testkit/src/model.ts'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit/src/inbox.ts'
import { createDebugViewStore } from '@deepseek-ai/dsh-client-ui-debug/src/client/store.ts'
import type { DebugStopReason, DebugViewEvent, DebugViewState } from '@deepseek-ai/dsh-client-ui-debug/src/client/store.ts'
import type {
  BreakpointSessionApplication,
  DebugBreakpoint,
  DebugBreakpointResult,
  DebugSessionId as DebugSessionIdValue,
  DebugSessionState,
  DebugThreadId as DebugThreadIdValue,
} from '@deepseek-ai/dsh-debug'
import type { DebugEvent, DebugEventActor } from '@deepseek-ai/dsh-debug'
import { fixtureDebugBreakpointId, fixtureDebugSessionId, fixtureSessionId, fixtureThreadId } from '@deepseek-ai/dsh-debug-fixture'
import { projectJsonRun } from '@deepseek-ai/dsh-headless/src/json-stream.ts'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { createDebugPaneState, foldDebugEvent } from '@deepseek-ai/dsh-tui-debug/src/panels.ts'
import type { TuiDebugPaneState } from '@deepseek-ai/dsh-tui-debug/src/panels.ts'
import { parseDebugCommand } from '@deepseek-ai/dsh-tui-debug/src/commands.ts'

/** Scenario names the factory knows; each maps to one deterministic timeline shape. */
export type DebugScenarioName = 'basic' | 'human-agent-handoff'

/** The surfaces a scenario can drive; the normalization keys match these. */
export type DebugSurface = 'web' | 'tui' | 'headless'

/** Why a debugged target stopped; the seam's closed stop-reason union. */
export type ScenarioStopReason = DebugStopReason

/** How the scenario's session ends; `failed` replaces the terminate control with a failure. */
export type ScenarioOutcome = 'terminated' | 'failed'

/** Overrides for one scenario's deterministic defaults. */
export interface DebugScenarioOptions {
  /** Provider-reported language label; defaults to `'node'`. */
  readonly language?: string
  /** Workspace-relative source file every stop points at; defaults to `'src/a.ts'`. */
  readonly file?: string
  /**
   * The stops the target takes, in order; each becomes one `stopped` fact.
   * Defaults to a breakpoint, a step, and an exception stop so every reason
   * is exercised. The first stop's line also pins the scenario's breakpoint.
   */
  readonly stops?: readonly { readonly reason: ScenarioStopReason; readonly line: number }[]
  /** Ending outcome; defaults to `'terminated'`. A `failed` ending drops the terminate control. */
  readonly outcome?: ScenarioOutcome
  /** Seed for the deterministic session, thread, and breakpoint ids; defaults to 1. */
  readonly sessionIdSeed?: number
}

/** One canonical debug fact, at the seam's durable-commit granularity. */
export type DebugScenarioFact =
  | {
    readonly kind: 'started'
    readonly mode: 'launch'
    readonly providerId: string
    readonly language: string
    readonly workspaceRoot: string
    readonly adapterVersion: string
  }
  | {
    readonly kind: 'breakpoints'
    readonly file: string
    /** Verified breakpoints the adapter applied, by line. */
    readonly appliedLines: readonly number[]
    /** Lines the adapter rejected, with its reason. */
    readonly rejectedLines: readonly { readonly line: number; readonly message: string }[]
  }
  | {
    readonly kind: 'stopped'
    readonly reason: ScenarioStopReason
    readonly threadId: DebugThreadIdValue
    /** The DAP thread number the adapter reports; the client plane carries it as a number. */
    readonly threadNumber: number
    readonly source: string
    readonly line: number
    readonly column: number
  }
  | { readonly kind: 'control'; readonly actor: DebugEventActor; readonly operation: string }
  | { readonly kind: 'ended'; readonly outcome: 'terminated'; readonly reason: string; readonly actor: DebugEventActor }
  | { readonly kind: 'ended'; readonly outcome: 'failed'; readonly reason: string }

/** One deterministic debug scenario: the name and its canonical fact timeline. */
export interface DebugScenario {
  readonly name: DebugScenarioName
  readonly sessionId: DebugSessionIdValue
  /** The harness session id seed the headless driver reuses for its store-attached session. */
  readonly sessionIdSeed: number
  readonly workspaceId: string
  readonly workspaceRoot: string
  readonly facts: readonly DebugScenarioFact[]
}

/** Default stop sequence: every stop reason the seam distinguishes by default. */
const DEFAULT_STOPS: readonly { readonly reason: ScenarioStopReason; readonly line: number }[] = [
  { reason: 'breakpoint', line: 4 },
  { reason: 'step', line: 5 },
  { reason: 'exception', line: 7 },
]

/** Which side terminates a scenario's session, by scenario name. */
const TERMINATOR_BY_NAME: Readonly<Record<DebugScenarioName, DebugEventActor>> = {
  basic: 'agent',
  'human-agent-handoff': 'user',
}

/** The scenario workspace root; every surface sees the same root. */
const SCENARIO_WORKSPACE_ROOT = '/ws'

/** The adapter version the scenario timeline reports. */
const SCENARIO_ADAPTER_VERSION = '1.140.0'

/** The DAP thread number the fake adapter reports; branded ids derive from the same seed. */
const SCENARIO_THREAD_NUMBER = 1

/** The one-based stop column every scenario stop reports. */
const SCENARIO_COLUMN = 2

/** Lifetime recorded for a scenario session that ends; fixed for determinism. */
const SCENARIO_DURATION_MS = 1000

/** Line the adapter deterministically rejects, beyond the fixture program's end. */
const SCENARIO_REJECTED_LINE = 99

/**
 * Build one deterministic scenario timeline.
 *
 * `'basic'` launches by the agent, sets a breakpoint at the first stop's
 * line, takes every stop, and resumes between stops; the terminator is the
 * agent. `'human-agent-handoff'` stops once and hands the session to the
 * human, whose terminate is the only user-issued control. Both end in
 * `terminated` unless `outcome` says `failed`, which replaces the terminate
 * control with a failure ending.
 * @param name - the scenario to build.
 * @param options - deterministic overrides for the defaults.
 * @returns the scenario with its fact timeline.
 * @throws RangeError when `sessionIdSeed` is not a non-negative safe integer.
 * @throws Error when the name is unknown.
 */
export function debugScenario(name: string, options: DebugScenarioOptions = {}): DebugScenario {
  if (name !== 'basic' && name !== 'human-agent-handoff') {
    throw new Error(`unknown debug scenario: ${name}`)
  }
  const seed = options.sessionIdSeed ?? 1
  const file = options.file ?? 'src/a.ts'
  // The handoff stops once — the story is one stop and the human's terminate —
  // while `basic` takes every stop reason and resumes between them.
  const stops = options.stops ?? (name === 'human-agent-handoff' ? DEFAULT_STOPS.slice(0, 1) : DEFAULT_STOPS)
  const outcome = options.outcome ?? 'terminated'
  const terminator = TERMINATOR_BY_NAME[name]
  const facts: DebugScenarioFact[] = [{
    kind: 'started',
    mode: 'launch',
    providerId: 'node',
    language: options.language ?? 'node',
    workspaceRoot: SCENARIO_WORKSPACE_ROOT,
    adapterVersion: SCENARIO_ADAPTER_VERSION,
  }]
  const firstStop = stops[0]
  if (firstStop !== undefined) {
    facts.push({
      kind: 'breakpoints',
      file,
      appliedLines: [firstStop.line],
      rejectedLines: [{ line: SCENARIO_REJECTED_LINE, message: 'line is beyond the end of the program' }],
    })
  }
  for (const [index, stop] of stops.entries()) {
    facts.push({
      kind: 'stopped',
      reason: stop.reason,
      threadId: fixtureThreadId(seed),
      threadNumber: SCENARIO_THREAD_NUMBER,
      source: file,
      line: stop.line,
      column: SCENARIO_COLUMN,
    })
    const last = index === stops.length - 1
    if (last) continue
    facts.push({
      kind: 'control',
      actor: 'agent',
      operation: stop.reason === 'breakpoint' ? 'continue' : 'step-over',
    })
  }
  if (outcome === 'terminated') {
    facts.push({ kind: 'control', actor: terminator, operation: 'terminate' })
    facts.push({ kind: 'ended', outcome, reason: `terminated by the ${terminator}`, actor: terminator })
  } else {
    facts.push({ kind: 'ended', outcome, reason: 'DEBUG_SESSION_FAILED' })
  }
  return {
    name,
    sessionId: fixtureDebugSessionId(seed),
    sessionIdSeed: seed,
    workspaceId: 'ws-scenario',
    workspaceRoot: SCENARIO_WORKSPACE_ROOT,
    facts,
  }
}

/**
 * Build one structural Agent stub over the given session. The headless
 * projection reads only the identity and the session; the loop-facing members
 * exist to satisfy the interface and are never invoked by a scenario.
 */
function scenarioAgent(id: SessionId, session: Agent['session'], ctx: Context): Agent {
  /* v8 ignore next 9 -- loop-facing stub members the NDJSON projection never calls. */
  return {
    id,
    options: {},
    session,
    model: unsupportedModel(),
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx,
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** One web breakpoint application as the controller's set-file response carries it. */
export type ScenarioBreakpointApplication = BreakpointSessionApplication

/** The web fold: the view-store state plus the client-plane stream that produced it. */
export interface WebScenarioFold {
  readonly surface: 'web'
  readonly state: DebugViewState
  readonly applied: readonly DebugViewEvent[]
  readonly breakpointApplications: readonly ScenarioBreakpointApplication[]
  /** The control operations the web surface itself issued (the user-actor controls). */
  readonly issuedOperations: readonly { readonly sessionId: string; readonly operation: string }[]
}

/** The TUI fold: the pane state plus the operations the terminal itself issued. */
export interface TuiScenarioFold {
  readonly surface: 'tui'
  readonly pane: TuiDebugPaneState
  readonly issuedOperations: readonly { readonly sessionId: string; readonly operation: string }[]
}

/** The headless fold: the NDJSON lines the JSON projection wrote. */
export interface HeadlessScenarioFold {
  readonly surface: 'headless'
  readonly lines: readonly string[]
}

/** What one surface's run kept: the fold output for presentation-level assertions. */
export type DebugScenarioFold = WebScenarioFold | TuiScenarioFold | HeadlessScenarioFold

/** One surface run: the scenario, the surface, and the fold output. */
export interface DebugScenarioRun {
  readonly surface: DebugSurface
  readonly scenario: DebugScenario
  readonly fold: DebugScenarioFold
}

/** Project one timeline fact into the web view store's client-plane events. */
function webEventsFor(scenario: DebugScenario, fact: DebugScenarioFact): readonly DebugViewEvent[] {
  const sessionId = String(scenario.sessionId)
  switch (fact.kind) {
    case 'started':
      return [
        { kind: 'session/state', sessionId, state: 'starting' },
        { kind: 'session/state', sessionId, state: 'running' },
      ]
    case 'stopped':
      return [{
        kind: 'session/stopped',
        stop: {
          sessionId,
          reason: fact.reason,
          threadId: fact.threadNumber,
          source: fact.source,
          line: fact.line,
          column: fact.column,
        },
      }]
    case 'control':
      return fact.operation === 'terminate'
        ? []
        : [{ kind: 'session/continued', sessionId }]
    case 'ended':
      return fact.outcome === 'terminated'
        ? [{ kind: 'session/terminated', sessionId }]
        : [{ kind: 'session/state', sessionId, state: 'failed' }]
    /* v8 ignore next 2 -- runWebScenario routes breakpoints through the set-file application channel. */
    case 'breakpoints':
      return []
    /* v8 ignore next 2 -- unreachable while the fact union stays fully handled at compile time. */
    default:
      return assertNeverFact(fact)
  }
}

/** Build one applied or rejected breakpoint for the web set-file response channel. */
function scenarioBreakpoint(
  scenario: DebugScenario,
  file: string,
  line: number,
  verified: boolean,
  message?: string,
): DebugBreakpoint {
  return {
    id: fixtureDebugBreakpointId(line),
    source: {
      workspaceRelativePath: file,
      absolutePath: `${scenario.workspaceRoot}/${file}`,
    },
    requestedLine: line,
    verified,
    ...(message !== undefined ? { message } : {}),
  }
}

/** Build the web set-file application for one breakpoints fact. */
function webBreakpointApplication(scenario: DebugScenario, fact: Extract<DebugScenarioFact, { kind: 'breakpoints' }>): ScenarioBreakpointApplication {
  const sessionResults: DebugBreakpointResult = {
    applied: fact.appliedLines.map(line => scenarioBreakpoint(scenario, fact.file, line, true)),
    rejected: fact.rejectedLines.map(entry =>
      scenarioBreakpoint(scenario, fact.file, entry.line, false, entry.message)),
  }
  return { sessionId: scenario.sessionId, sessionResults }
}

/** Project one timeline fact into the TUI pane source's live `DebugEvent` union. */
function liveEventsFor(scenario: DebugScenario, fact: DebugScenarioFact): readonly DebugEvent[] {
  const sessionId = scenario.sessionId
  const workspaceId = scenario.workspaceId
  switch (fact.kind) {
    case 'started':
      return [
        { kind: 'session/starting', sessionId, workspaceId },
        { kind: 'session/running', sessionId, workspaceId },
      ]
    case 'stopped':
      return [{ kind: 'session/stopped', sessionId, workspaceId }]
    case 'control':
      return []
    case 'ended':
      return fact.outcome === 'terminated'
        ? [{ kind: 'session/terminated', sessionId, workspaceId, actor: fact.actor }]
        : [{ kind: 'session/failed', sessionId, workspaceId }]
    case 'breakpoints':
      return [{
        kind: 'breakpoint/changed',
        sessionId,
        workspaceId,
        result: {
          applied: fact.appliedLines.map(line => scenarioBreakpoint(scenario, fact.file, line, true)),
          rejected: fact.rejectedLines.map(entry =>
            scenarioBreakpoint(scenario, fact.file, entry.line, false, entry.message)),
        },
      }]
    /* v8 ignore next 2 -- unreachable while the fact union stays fully handled at compile time. */
    default:
      return assertNeverFact(fact)
  }
}

/** Append one timeline fact's durable `debug/*` session events to the attached session. */
function appendDurableEvents(session: Agent['session'], scenario: DebugScenario, fact: DebugScenarioFact): void {
  const sessionId = String(scenario.sessionId)
  switch (fact.kind) {
    case 'started':
      session.append('debug/session-started', {
        sessionId,
        providerId: fact.providerId,
        language: fact.language,
        mode: fact.mode,
        workspaceRoot: fact.workspaceRoot,
        adapterVersion: fact.adapterVersion,
      })
      return
    case 'stopped':
      session.append('debug/stopped', {
        sessionId,
        reason: fact.reason,
        threadId: String(fact.threadId),
        source: fact.source,
        line: fact.line,
        column: fact.column,
      })
      return
    case 'control':
      session.append('debug/control', { sessionId, actor: fact.actor, operation: fact.operation })
      return
    case 'ended':
      session.append('debug/session-ended', {
        sessionId,
        outcome: fact.outcome,
        reason: fact.reason,
        durationMs: SCENARIO_DURATION_MS,
      })
      return
    case 'breakpoints':
      return
    /* v8 ignore next 2 -- unreachable while the fact union stays fully handled at compile time. */
    default:
      return assertNeverFact(fact)
  }
}

/** Run the web surface: fold the client-plane stream through the real view store. */
function runWebScenario(scenario: DebugScenario): WebScenarioFold {
  const store = createDebugViewStore()
  const applied: DebugViewEvent[] = []
  const breakpointApplications: ScenarioBreakpointApplication[] = []
  const issuedOperations: { readonly sessionId: string; readonly operation: string }[] = []
  for (const fact of scenario.facts) {
    if (fact.kind === 'breakpoints') {
      breakpointApplications.push(webBreakpointApplication(scenario, fact))
      continue
    }
    if (fact.kind === 'control' && fact.actor === 'user') {
      issuedOperations.push({ sessionId: String(scenario.sessionId), operation: fact.operation })
    }
    for (const event of webEventsFor(scenario, fact)) {
      store.apply(event)
      applied.push(event)
    }
  }
  return { surface: 'web', state: store.state, applied, breakpointApplications, issuedOperations }
}

/** Run the TUI surface: fold the live event stream through the real pane reducer. */
function runTuiScenario(scenario: DebugScenario): TuiScenarioFold {
  let pane = createDebugPaneState()
  const issuedOperations: { readonly sessionId: string; readonly operation: string }[] = []
  for (const fact of scenario.facts) {
    if (fact.kind === 'control' && fact.actor === 'user') {
      // Fail loud on an operation the `:` command family cannot parse, so a
      // renamed control fails the scenario instead of silently dropping out.
      parseDebugCommand(`:${fact.operation}`)
      issuedOperations.push({ sessionId: String(scenario.sessionId), operation: fact.operation })
    }
    for (const event of liveEventsFor(scenario, fact)) {
      pane = foldDebugEvent(pane, event)
    }
  }
  return { surface: 'tui', pane, issuedOperations }
}

/** Run the headless surface: append the durable events and read the NDJSON projection. */
async function runHeadlessScenario(scenario: DebugScenario): Promise<HeadlessScenarioFold> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const sessionId = fixtureSessionId(scenario.sessionIdSeed)
  const session = ctx.sessions.create(sessionId)
  const agent = scenarioAgent(sessionId, session, ctx)
  const lines: string[] = []
  const projection = projectJsonRun(ctx, agent, {
    write: (chunk: string) => {
      lines.push(chunk)
      return true
    },
  }, { cwd: scenario.workspaceRoot })
  for (const fact of scenario.facts) {
    appendDurableEvents(session, scenario, fact)
  }
  projection.dispose()
  await ctx.fiber.dispose()
  return { surface: 'headless', lines }
}

/**
 * Drive one scenario through one surface's real harness.
 *
 * The web surface folds the client-plane event stream through the debug view
 * store and drives breakpoints through the set-file response channel; the TUI
 * surface folds the live event stream through the pane reducer and drives
 * user controls through the real `:` command parser; the headless surface
 * appends the durable `debug/*` events to a store-attached session and reads
 * them back through `projectJsonRun`'s NDJSON projection.
 * @param surface - the surface to drive.
 * @param scenario - the scenario to run.
 * @returns the run with the surface's fold output.
 * @throws Error when the surface is unknown.
 */
export async function runScenario(surface: DebugSurface, scenario: DebugScenario): Promise<DebugScenarioRun> {
  switch (surface) {
    case 'web':
      return { surface, scenario, fold: runWebScenario(scenario) }
    case 'tui':
      return { surface, scenario, fold: runTuiScenario(scenario) }
    case 'headless':
      return { surface, scenario, fold: await runHeadlessScenario(scenario) }
    /* v8 ignore next 2 -- the narrowed surface type cannot reach the default while the union stays closed. */
    default:
      throw new Error(`unknown debug surface: ${String(surface)}`)
  }
}

/** One normalized session-lifecycle record: the shared retention every surface carries. */
export interface NormalizedSessionRecord {
  readonly sessionId: string
  readonly state: DebugSessionState
}

/** One normalized stop record: reason plus the workspace-relative location. */
export interface NormalizedStopRecord {
  readonly sessionId: string
  readonly reason: ScenarioStopReason
  readonly source: string
  readonly line: number
  readonly column: number
}

/** One normalized breakpoint-verification record. */
export interface NormalizedBreakpointRecord {
  readonly sessionId: string
  readonly file: string
  readonly line: number
  readonly verified: boolean
}

/** One normalized control record: which side issued which operation. */
export interface NormalizedControlRecord {
  readonly sessionId: string
  readonly actor: DebugEventActor
  readonly operation: string
}

/** One normalized failure record: the session and its error code. */
export interface NormalizedFailureRecord {
  readonly sessionId: string
  readonly errorCode: string
}

/**
 * The normalized fact groups one surface retained, with presentation-only
 * fields removed. Every group keeps the whitelist fields the surface's
 * channel carries: session id, state, stop reason, relative location,
 * breakpoint verification, error code, and control actor. A surface without
 * a channel for a fact family emits an empty group, so cross-surface
 * comparisons state which groups must agree.
 */
export interface NormalizedSurfaceEvents {
  readonly sessions: readonly NormalizedSessionRecord[]
  readonly stops: readonly NormalizedStopRecord[]
  readonly breakpoints: readonly NormalizedBreakpointRecord[]
  readonly controls: readonly NormalizedControlRecord[]
  readonly failures: readonly NormalizedFailureRecord[]
}

/** Normalize the web fold into the grouped records. */
function normalizeWebFold(fold: WebScenarioFold): NormalizedSurfaceEvents {
  const sessions: NormalizedSessionRecord[] = []
  for (const [sessionId, state] of Object.entries(fold.state.sessionStates)) {
    sessions.push({ sessionId, state })
  }
  return {
    sessions,
    stops: fold.applied.flatMap(event => event.kind === 'session/stopped'
      ? [{
        sessionId: event.stop.sessionId,
        reason: event.stop.reason,
        source: event.stop.source,
        line: event.stop.line,
        column: event.stop.column,
      }]
      : []),
    breakpoints: fold.breakpointApplications.flatMap(application => [
      ...application.sessionResults.applied.map(breakpoint => ({
        sessionId: String(application.sessionId),
        file: breakpoint.source.workspaceRelativePath,
        line: breakpoint.requestedLine,
        verified: breakpoint.verified,
      })),
      ...application.sessionResults.rejected.map(breakpoint => ({
        sessionId: String(application.sessionId),
        file: breakpoint.source.workspaceRelativePath,
        line: breakpoint.requestedLine,
        verified: breakpoint.verified,
      })),
    ]),
    controls: fold.issuedOperations.map(operation => ({
      sessionId: operation.sessionId,
      actor: 'user',
      operation: operation.operation,
    })),
    failures: [],
  }
}

/** Normalize the TUI fold into the grouped records. */
function normalizeTuiFold(fold: TuiScenarioFold): NormalizedSurfaceEvents {
  return {
    sessions: fold.pane.sessions.map(row => ({ sessionId: String(row.id), state: row.state })),
    stops: [],
    breakpoints: fold.pane.breakpoints.map(row => ({
      sessionId: String(row.sessionId),
      file: row.file,
      line: row.line,
      verified: row.verified,
    })),
    controls: fold.issuedOperations.map(operation => ({
      sessionId: operation.sessionId,
      actor: 'user',
      operation: operation.operation,
    })),
    failures: [],
  }
}

/** One parsed headless NDJSON line's debug payload. */
interface HeadlessDebugLine {
  readonly type: string
  readonly data: Record<string, unknown>
}

/** Parse the projection's NDJSON into its `debug/*` payloads. */
function headlessDebugLines(lines: readonly string[]): readonly HeadlessDebugLine[] {
  return lines.flatMap((line) => {
    const parsed: unknown = JSON.parse(line)
    if (typeof parsed !== 'object' || parsed === null) return []
    const record = parsed as Record<string, unknown>
    const type = record['type']
    const data = record['data']
    if (typeof type !== 'string' || !type.startsWith('debug/')) return []
    if (typeof data !== 'object' || data === null) return []
    return [{ type, data: data as Record<string, unknown> }]
  })
}

/** Normalize the headless fold into the grouped records. */
function normalizeHeadlessFold(fold: HeadlessScenarioFold): NormalizedSurfaceEvents {
  const sessions = new Map<string, DebugSessionState>()
  const stops: NormalizedStopRecord[] = []
  const controls: NormalizedControlRecord[] = []
  const failures: NormalizedFailureRecord[] = []
  for (const line of headlessDebugLines(fold.lines)) {
    const sessionId = line.data['sessionId']
    if (typeof sessionId !== 'string') continue
    switch (line.type) {
      case 'debug/session-started':
        sessions.set(sessionId, 'running')
        break
      case 'debug/stopped': {
        const reason = line.data['reason']
        const source = line.data['source']
        const lineNumber = line.data['line']
        const column = line.data['column']
        // A stop line's state transition rides its fully valid location, so a
        // malformed stop never moves the lifecycle.
        if (isStopReason(reason) && typeof source === 'string'
          && typeof lineNumber === 'number' && typeof column === 'number') {
          sessions.set(sessionId, 'stopped')
          stops.push({ sessionId, reason, source, line: lineNumber, column })
        }
        break
      }
      case 'debug/control': {
        const actor = line.data['actor']
        const operation = line.data['operation']
        if (isActor(actor) && typeof operation === 'string') {
          controls.push({ sessionId, actor, operation })
        }
        break
      }
      case 'debug/session-ended': {
        const outcome = line.data['outcome']
        const reason = line.data['reason']
        if (outcome === 'terminated') sessions.set(sessionId, 'terminated')
        else if (outcome === 'failed' && typeof reason === 'string') {
          sessions.set(sessionId, 'failed')
          failures.push({ sessionId, errorCode: reason })
        }
        break
      }
      /* v8 ignore next 2 -- the scenario timeline emits only the four durable debug types. */
      default:
        break
    }
  }
  return {
    sessions: [...sessions.entries()].map(([sessionId, state]) => ({ sessionId, state })),
    stops,
    breakpoints: [],
    controls,
    failures,
  }
}

/** Every stop reason the seam's durable stop event carries. */
const STOP_REASONS: readonly ScenarioStopReason[] = [
  'breakpoint', 'step', 'pause', 'entry', 'exception',
  'dataBreakpoint', 'instructionBreakpoint', 'restart', 'unknown',
]

/** Narrow one unknown value onto the stop-reason union. */
function isStopReason(value: unknown): value is ScenarioStopReason {
  return STOP_REASONS.some(reason => reason === value)
}

/** Narrow one unknown value onto the actor union. */
function isActor(value: unknown): value is DebugEventActor {
  return value === 'user' || value === 'agent'
}

/**
 * Strip presentation-only fields from one surface run and group the retained
 * debug facts. The grouped records keep exactly the whitelist fields each
 * surface's channel carries; groups a surface cannot express come back empty.
 * @param run - the surface run to normalize.
 * @returns the grouped normalized records.
 */
export function normalizeSurfaceEvents(run: DebugScenarioRun): NormalizedSurfaceEvents {
  switch (run.fold.surface) {
    case 'web':
      return normalizeWebFold(run.fold)
    case 'tui':
      return normalizeTuiFold(run.fold)
    case 'headless':
      return normalizeHeadlessFold(run.fold)
    /* v8 ignore next 2 -- unreachable while the fold union stays fully handled at compile time. */
    default:
      return assertNeverFold(run.fold)
  }
}

/** The closed fact union's exhaustiveness guard. */
/* v8 ignore next 3 -- unreachable at runtime while the fact union stays fully handled. */
function assertNeverFact(value: never): never {
  throw new Error(`unhandled debug scenario fact ${JSON.stringify(value)}`)
}

/** The closed fold union's exhaustiveness guard. */
/* v8 ignore next 3 -- unreachable at runtime while the fold union stays fully handled. */
function assertNeverFold(value: never): never {
  throw new Error(`unhandled debug scenario fold ${JSON.stringify(value)}`)
}
