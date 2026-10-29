/**
 * Three-surface debug consistency: one scenario timeline driven through the
 * web view store, the TUI pane reducer, and the headless NDJSON projection
 * normalizes to the same retained facts. The lifecycle stream must agree on
 * all three surfaces; stop facts agree on the two surfaces whose channels
 * carry them (web and headless), breakpoint verification on web and TUI, and
 * the handoff's user-issued control on all three.
 */

import { describe, expect, it } from 'vitest'
import {
  debugScenario,
  normalizeSurfaceEvents,
  runScenario,
} from '../src/index.ts'

describe('debug scenario factory', () => {
  it('builds the basic timeline with a breakpoint, resumptions, and an agent terminate', () => {
    const scenario = debugScenario('basic')
    expect(scenario.sessionId).toBe('debug-0000000000000001')
    expect(scenario.facts.map(fact => fact.kind)).toEqual([
      'started', 'breakpoints', 'stopped', 'control', 'stopped', 'control', 'stopped', 'control', 'ended',
    ])
    const control = scenario.facts.find(fact => fact.kind === 'control')
    expect(control).toMatchObject({ actor: 'agent', operation: 'continue' })
    const ended = scenario.facts.at(-1)
    expect(ended).toMatchObject({ kind: 'ended', outcome: 'terminated', actor: 'agent' })
  })

  it('builds the handoff timeline where the human issues the only terminate', () => {
    const scenario = debugScenario('human-agent-handoff')
    expect(scenario.facts.map(fact => fact.kind)).toEqual([
      'started', 'breakpoints', 'stopped', 'control', 'ended',
    ])
    const control = scenario.facts.find(fact => fact.kind === 'control')
    expect(control).toMatchObject({ actor: 'user', operation: 'terminate' })
  })

  it('honors the option overrides and replaces the terminate with a failure ending', () => {
    const scenario = debugScenario('basic', {
      language: 'python',
      file: 'src/main.py',
      stops: [{ reason: 'breakpoint', line: 4 }],
      outcome: 'failed',
      sessionIdSeed: 7,
    })
    expect(scenario.sessionId).toBe('debug-0000000000000007')
    const stopped = scenario.facts.find(fact => fact.kind === 'stopped')
    expect(stopped).toMatchObject({ reason: 'breakpoint', source: 'src/main.py', line: 4, column: 2 })
    expect(scenario.facts.some(fact => fact.kind === 'control')).toBe(false)
    const ended = scenario.facts.at(-1)
    expect(ended).toMatchObject({ kind: 'ended', outcome: 'failed', reason: 'DEBUG_SESSION_FAILED' })
  })

  it('rejects an unknown scenario name', () => {
    expect(() => debugScenario('no-such-scenario')).toThrow('unknown debug scenario')
  })
})

describe('three-surface debug consistency', () => {
  it('produces the same normalized lifecycle and stop facts for web, tui, and headless', async () => {
    const scenario = debugScenario('basic', { stops: [{ reason: 'breakpoint', line: 4 }] })
    const web = await runScenario('web', scenario)
    const tui = await runScenario('tui', scenario)
    const headless = await runScenario('headless', scenario)

    const normalizedWeb = normalizeSurfaceEvents(web)
    const normalizedTui = normalizeSurfaceEvents(tui)
    const normalizedHeadless = normalizeSurfaceEvents(headless)

    expect(normalizedWeb.sessions).toEqual(normalizedTui.sessions)
    expect(normalizedHeadless.sessions).toEqual(normalizedWeb.sessions)
    expect(normalizedHeadless.stops).toEqual(normalizedWeb.stops)
    expect(normalizedWeb.stops).toEqual([{
      sessionId: String(scenario.sessionId),
      reason: 'breakpoint',
      source: 'src/a.ts',
      line: 4,
      column: 2,
    }])
  })

  it('agrees on breakpoint verification between web and tui and keeps rejections unverified', async () => {
    const scenario = debugScenario('basic')
    const web = await runScenario('web', scenario)
    const tui = await runScenario('tui', scenario)
    const normalizedWeb = normalizeSurfaceEvents(web)
    const normalizedTui = normalizeSurfaceEvents(tui)
    expect(normalizedWeb.breakpoints).toEqual(normalizedTui.breakpoints)
    expect(normalizedWeb.breakpoints).toEqual([
      { sessionId: String(scenario.sessionId), file: 'src/a.ts', line: 4, verified: true },
      { sessionId: String(scenario.sessionId), file: 'src/a.ts', line: 99, verified: false },
    ])
  })

  it('agrees on agent-issued controls between headless and the scenario timeline', async () => {
    const scenario = debugScenario('basic')
    const headless = await runScenario('headless', scenario)
    const normalizedHeadless = normalizeSurfaceEvents(headless)
    const expected = scenario.facts.flatMap(fact => fact.kind === 'control'
      ? [{ sessionId: String(scenario.sessionId), actor: fact.actor, operation: fact.operation }]
      : [])
    expect(normalizedHeadless.controls).toEqual(expected)
    // The web and TUI surfaces carry only user-issued controls; the agent's
    // controls reach them as lifecycle transitions instead.
    expect(normalizeSurfaceEvents(await runScenario('web', scenario)).controls).toEqual([])
  })

  it('carries the human terminate control on every surface in the handoff scenario', async () => {
    const scenario = debugScenario('human-agent-handoff')
    const normalized = await Promise.all(
      (['web', 'tui', 'headless'] as const).map(async surface =>
        normalizeSurfaceEvents(await runScenario(surface, scenario))),
    )
    const terminate = { sessionId: String(scenario.sessionId), actor: 'user', operation: 'terminate' }
    const [web, tui, headless] = normalized
    expect(web).toBeDefined()
    expect(tui).toBeDefined()
    expect(headless).toBeDefined()
    expect(web?.controls).toEqual([terminate])
    expect(tui?.controls).toEqual([terminate])
    expect(headless?.controls).toEqual([terminate])
    expect(web?.sessions).toEqual([{ sessionId: String(scenario.sessionId), state: 'terminated' }])
    expect(web?.sessions).toEqual(tui?.sessions)
    expect(headless?.sessions).toEqual(web?.sessions)
  })

  it('normalizes a failed ending into the failed lifecycle state and its error code on headless', async () => {
    const scenario = debugScenario('basic', {
      stops: [{ reason: 'breakpoint', line: 4 }],
      outcome: 'failed',
    })
    const web = normalizeSurfaceEvents(await runScenario('web', scenario))
    const tui = normalizeSurfaceEvents(await runScenario('tui', scenario))
    const headless = normalizeSurfaceEvents(await runScenario('headless', scenario))
    const failed = { sessionId: String(scenario.sessionId), state: 'failed' }
    expect(web.sessions).toEqual([failed])
    expect(tui.sessions).toEqual([failed])
    expect(headless.sessions).toEqual([failed])
    expect(headless.failures).toEqual([{ sessionId: String(scenario.sessionId), errorCode: 'DEBUG_SESSION_FAILED' }])
    expect(web.failures).toEqual([])
  })
})

describe('fold outputs stay presentation-faithful', () => {
  it('keeps the TUI pane actor and the web store stop on the fold', async () => {
    const scenario = debugScenario('human-agent-handoff')
    const tui = await runScenario('tui', scenario)
    const web = await runScenario('web', scenario)
    if (tui.fold.surface !== 'tui' || web.fold.surface !== 'web') throw new Error('unexpected fold surfaces')
    expect(tui.fold.pane.sessions[0]).toMatchObject({ state: 'terminated', actor: 'user' })
    // The terminated fold clears the web stop; the applied stream retains it.
    expect(web.fold.state.stop).toBeUndefined()
    expect(web.fold.applied.some(event => event.kind === 'session/stopped')).toBe(true)
  })

  it('reads the headless NDJSON back as bounded debug lines without presentation payload', async () => {
    const scenario = debugScenario('basic')
    const headless = await runScenario('headless', scenario)
    if (headless.fold.surface !== 'headless') throw new Error('unexpected fold surface')
    const serialized = headless.fold.lines.join('\n')
    expect(serialized).toContain('"type":"debug/stopped"')
    expect(serialized).not.toContain('variables')
    expect(serialized).not.toContain('Content-Length')
  })

  it('fails loud on an unparseable headless NDJSON line', () => {
    const scenario = debugScenario('basic')
    expect(() => normalizeSurfaceEvents({
      surface: 'headless',
      scenario,
      fold: { surface: 'headless', lines: ['not json'] },
    })).toThrow(SyntaxError)
  })

  it('drops shape-mismatched or unrecognized headless NDJSON lines instead of guessing', () => {
    const scenario = debugScenario('basic')
    const sessionId = String(scenario.sessionId)
    const lines = [
      '42',
      '"text"',
      'null',
      '{"noType":true}',
      '{"type":"session"}',
      '{"type":"debug/stopped"}',
      `{"type":"debug/session-started","data":{"sessionId":"${sessionId}","providerId":"node","language":"node","mode":"launch","workspaceRoot":"/ws","adapterVersion":"1.140.0"}}`,
      '{"type":"debug/stopped","data":{"reason":"pause"}}',
      `{"type":"debug/stopped","data":{"sessionId":"${sessionId}","reason":"teleport","source":"a.ts","line":1,"column":1}}`,
      `{"type":"debug/control","data":{"sessionId":"${sessionId}","actor":"robot","operation":"continue"}}`,
      `{"type":"debug/session-ended","data":{"sessionId":"${sessionId}","outcome":"disconnected","reason":"gone"}}`,
    ]
    const normalized = normalizeSurfaceEvents({ surface: 'headless', scenario, fold: { surface: 'headless', lines } })
    expect(normalized.sessions).toEqual([{ sessionId, state: 'running' }])
    expect(normalized.stops).toEqual([])
    expect(normalized.controls).toEqual([])
    expect(normalized.failures).toEqual([])
  })
})
