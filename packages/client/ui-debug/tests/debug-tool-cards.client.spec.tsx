// @vitest-environment jsdom
/** Debug tool cards: pure projections, generic fallbacks, the keyed row, and registration. */
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import type { ReactNode } from 'react'
import { Context } from '@deepseek-ai/cordis'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { DEBUG_TOOL_NAMES, DebugToolRow, debugToolCard } from '../src/client/debug-tool-cards.tsx'
// Type-only: pulls the keyed tool.call.toolview entry into this program's SlotMap face.
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { StartedToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { zh, en } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(en)
const zhT = makeTranslate(zh)

/** Common head fields of one fabricated call block. */
function callHead(name: string) {
  return {
    callId: 'call-1',
    name,
    turn: 0,
    step: 0,
    time: 0,
    subCalls: [] as never[],
    args: PartialArguments.EMPTY,
  }
}

describe('debugToolCard', () => {
  it('renders session state and puts stop locations on the card', () => {
    const sessionCard = debugToolCard('debug_session', { sessionId: 'debug-1', state: 'running' })
    expect(sessionCard.card).toBe('generic')
    expect(sessionCard.title).toBe('debug_session')
    expect(debugToolCard('debug_execution', { reason: 'breakpoint', source: 'src/a.ts', line: 4 }))
      .toMatchObject({ locations: [{ path: 'src/a.ts', line: 4 }] })
  })

  it('falls back for malformed or unknown payloads', () => {
    expect(debugToolCard('debug_inspect', null)).toMatchObject({ card: 'generic' })
    expect(debugToolCard('debug_session', [1, 2])).toMatchObject({ card: 'generic' })
    expect(debugToolCard('custom_tool', undefined)).toMatchObject({ card: 'generic', title: 'custom_tool' })
  })

  it('summarizes session, breakpoints, and bounded inspect results', () => {
    expect(debugToolCard('debug_session', { sessionId: 'debug-1', state: 'running' }).summary)
      .toBe('debug-1 · running')
    expect(debugToolCard('debug_breakpoints', { path: 'src/a.ts', line: 4 }).locations)
      .toEqual([{ path: 'src/a.ts', line: 4 }])
    const long = 'y'.repeat(90)
    expect(debugToolCard('debug_inspect', { result: long }).summary).toBe(`${'y'.repeat(80)}…`)
    expect(debugToolCard('debug_session', {}).summary).toBeUndefined()
    expect(debugToolCard('debug_execution', { reason: 'step' })).toMatchObject({
      summary: 'step',
      card: 'generic',
    })
  })

  it('resolves titles through the translate seat when supplied', () => {
    expect(debugToolCard('debug_session', null, zhT).title).toBe(zhT('tool.session.title'))
    expect(debugToolCard('debug_session', null, zhT).title).toBe('调试会话')
  })
})

describe('DebugToolRow', () => {
  it('renders the title alone while preparing and without a recorded head', () => {
    const preparing = render(<DebugToolRow toolName="debug_session" t={t} block={{
      ...callHead('debug_session'), phase: 'preparing',
    }} />)
    expect(preparing.container.querySelector('[data-debug-card="debug_session"]')?.textContent)
      .toBe('Debug session')
    const truncated = render(<DebugToolRow toolName="debug_inspect" t={t} block={{
      kind: 'tool-result', seq: 1, time: 0, callId: 'call-1', name: 'debug_inspect',
      args: PartialArguments.EMPTY, call: null, callTime: null, content: [], isError: false, subCalls: [],
    } satisfies ToolResultNode} />)
    expect(truncated.container.querySelector('[data-debug-card="debug_inspect"]')?.textContent)
      .toBe('Debug inspect')
  })

  it('projects dispatched and settled arguments and falls back on malformed JSON', () => {
    const argsRaw = '{"reason":"breakpoint","source":"src/a.ts","line":4}'
    const started: StartedToolCall = { ...callHead('debug_execution'), phase: 'start', argsRaw }
    const startedView = render(<DebugToolRow toolName="debug_execution" t={t} block={started} />)
    expect(startedView.container.querySelector('[data-debug-card-location]')?.textContent).toBe('src/a.ts:4')
    expect(startedView.container.querySelector('[data-debug-card-summary]')?.textContent).toBe('breakpoint')

    const settled = render(<DebugToolRow toolName="debug_execution" t={t} block={{
      kind: 'tool-result', seq: 1, time: 0, callId: 'call-1', name: 'debug_execution',
      args: PartialArguments.EMPTY, call: { name: 'debug_execution', argsRaw }, callTime: 0,
      content: [], isError: false, subCalls: [],
    } satisfies ToolResultNode} />)
    expect(settled.container.querySelector('[data-debug-card-location]')).not.toBeNull()

    const malformed = render(<DebugToolRow toolName="debug_session" t={t} block={{
      ...callHead('debug_session'), phase: 'start', argsRaw: '{"truncated',
    }} />)
    expect(malformed.container.querySelector('[data-debug-card="debug_session"]')?.textContent)
      .toBe('Debug session')
    expect(malformed.container.querySelector('[data-debug-card-summary]')).toBeNull()
  })
})

describe('registration', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['locale', 'slots', 'remote', 'remote.debug'])
    expect(DEBUG_TOOL_NAMES).toEqual(['debug_session', 'debug_breakpoints', 'debug_execution', 'debug_inspect'])
  })

  it('registers all four tool cards and dictionaries; disposal frees them', async () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    // The debug view service polls `remote.debug` from apply; an empty
    // namespace double keeps this spec about the tool cards.
    new TestRemote(ctx, {
      debug: {
        sessionList: () => Promise.resolve({ ok: true as const, value: [] }),
        events: () => Promise.resolve({ ok: true as const, value: { records: [], expired: false, latestSeq: 0 } }),
      },
    })
    const dictionaries: unknown[] = []
    ctx.provide('locale', {
      register: (_namespace: string, dictionary: unknown) => {
        dictionaries.push(dictionary)
        return () => {}
      },
      bind: () => (key: string) => key,
    })
    const slots = new SlotRegistry(ctx)
    // The root frame's props are the composed contract of the declaration;
    // referencing renderSlot proves the declared child is consumed.
    type RootProps = ComposedProps<'root', string, 'tool.call.toolview', undefined, object>
    function Root(props: RootProps): ReactNode {
      void props.renderSlot
      return null
    }
    slots.register(
      {
        name: 'root',
        children: { 'tool.call.toolview': { kind: 'keyed', scope: 'session' } },
        inject: () => ({}),
      },
      Root,
    )
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entries = slots.entries('tool.call.toolview')
    expect(entries.map(entry => entry.options.key)).toEqual([...DEBUG_TOOL_NAMES])
    expect(entries.every(entry => entry.locale === 'debug')).toBe(true)
    expect(entries[0]?.component).toBe(DebugToolRow)
    expect(dictionaries).toHaveLength(1)
    // Fiber teardown (HMR) releases every registration.
    await ctx.fiber.dispose()
    expect(slots.entries('tool.call.toolview')).toHaveLength(0)
  })
})

// The pure projector is deterministic, so replay renders identically from the
// same logged slice; assert it directly against a settled call.
describe('replay stability', () => {
  it('projects the same card from the same logged arguments', () => {
    const argsRaw = '{"reason":"step","source":"src/b.go","line":10}'
    const first = debugToolCard('debug_execution', JSON.parse(argsRaw), t)
    const second = debugToolCard('debug_execution', JSON.parse(argsRaw), t)
    expect(first).toEqual(second)
  })
})
