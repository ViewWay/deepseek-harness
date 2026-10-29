/**
 * The four debug tools' conversation cards: pure projections of the logged
 * call arguments, so Session replay renders the same card from the same
 * log. `debugToolCard` folds one call's argument JSON into the generic card
 * model — title, optional summary, and optional stop locations — and
 * malformed or unknown payloads fall back to that same generic shape with
 * only the title, letting the transcript's generic row carry the rest.
 * @module @deepseek-ai/dsh-client-ui-debug/debug-tool-cards
 */
import type { ReactElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: loads ui-tool's SlotMap augmentation (the keyed tool.call.toolview entry).
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { DebugKey } from './locales.ts'

/** Inclusive character cap on one card summary; longer text folds. */
const MAX_SUMMARY_CHARS = 80

/** The tool names this package presents with debug cards. */
export const DEBUG_TOOL_NAMES = ['debug_session', 'debug_breakpoints', 'debug_execution', 'debug_inspect'] as const

/** One debug tool name. */
export type DebugToolName = (typeof DEBUG_TOOL_NAMES)[number]

/** One stop or breakpoint location a card puts on its face. */
export interface DebugToolCardLocation {
  /** Workspace-relative path. */
  readonly path: string
  /** One-based line when the location carries one. */
  readonly line?: number | undefined
}

/** The card model every debug tool call projects onto. */
export interface DebugToolCardModel {
  /** Every debug card stays the transcript's generic card shape. */
  readonly card: 'generic'
  /** Card title, resolved through `translate` or the English default. */
  readonly title: string
  /** One-line summary when the payload carried one. */
  readonly summary?: string | undefined
  /** Stop or breakpoint locations when the payload carried them. */
  readonly locations?: readonly DebugToolCardLocation[] | undefined
}

/** Locale key for one tool's card title; an absent dictionary leaves the wire name. */
const TITLE_KEYS: Record<DebugToolName, DebugKey> = {
  debug_session: 'tool.session.title',
  debug_breakpoints: 'tool.breakpoints.title',
  debug_execution: 'tool.execution.title',
  debug_inspect: 'tool.inspect.title',
}

/**
 * Fold one string past the summary cap.
 * @param text - the summary text.
 * @returns the bounded summary.
 */
function boundedSummary(text: string): string {
  return text.length > MAX_SUMMARY_CHARS ? `${text.slice(0, MAX_SUMMARY_CHARS)}…` : text
}

/**
 * Read one string field off a payload object.
 * @param payload - the parsed call arguments.
 * @param field - field to read.
 * @returns the string value, or undefined for any other shape.
 */
function stringField(payload: Record<string, unknown>, field: string): string | undefined {
  const value = payload[field]
  return typeof value === 'string' ? value : undefined
}

/**
 * Read one number field off a payload object.
 * @param payload - the parsed call arguments.
 * @param field - field to read.
 * @returns the number value, or undefined for any other shape.
 */
function numberField(payload: Record<string, unknown>, field: string): number | undefined {
  const value = payload[field]
  return typeof value === 'number' ? value : undefined
}

/**
 * Read one path/line location off a payload object.
 * @param payload - the parsed call arguments.
 * @returns the location, or undefined when the path is missing.
 */
function locationField(payload: Record<string, unknown>): DebugToolCardLocation | undefined {
  const path = stringField(payload, 'source') ?? stringField(payload, 'path')
  if (path === undefined) return undefined
  const line = numberField(payload, 'line')
  return line === undefined ? { path } : { path, line }
}

/**
 * Project one debug tool call's logged arguments onto the generic card
 * model. Unknown names and malformed payloads degrade to the bare generic
 * card: the title names the tool and no field claims structure the payload
 * does not carry.
 * @param name - wire tool name.
 * @param payload - the call's parsed argument object, or anything else when
 *   the arguments were absent or malformed.
 * @param translate - optional dictionary translate resolving the title key;
 *   without it the wire tool name stands in.
 * @returns the card model.
 */
export function debugToolCard(
  name: string,
  payload: unknown,
  translate?: (key: DebugKey) => string,
): DebugToolCardModel {
  const known: DebugKey | undefined
    = Object.hasOwn(TITLE_KEYS, name) ? TITLE_KEYS[name as DebugToolName] : undefined
  const title = known === undefined ? name : (translate?.(known) ?? name)
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { card: 'generic', title }
  }
  const args = payload as Record<string, unknown>
  switch (name as DebugToolName) {
    case 'debug_session': {
      const sessionId = stringField(args, 'sessionId')
      const state = stringField(args, 'state')
      return {
        card: 'generic',
        title,
        summary: sessionId === undefined || state === undefined ? undefined : boundedSummary(`${sessionId} · ${state}`),
      }
    }
    case 'debug_execution': {
      const location = locationField(args)
      const reason = stringField(args, 'reason')
      return {
        card: 'generic',
        title,
        summary: reason === undefined ? undefined : boundedSummary(reason),
        ...(location === undefined ? {} : { locations: [location] }),
      }
    }
    case 'debug_breakpoints': {
      const location = locationField(args)
      return {
        card: 'generic',
        title,
        ...(location === undefined ? {} : { locations: [location] }),
      }
    }
    case 'debug_inspect': {
      const result = stringField(args, 'result')
      return {
        card: 'generic',
        title,
        summary: result === undefined ? undefined : boundedSummary(result),
      }
    }
    default:
      return { card: 'generic', title }
  }
}

/** Props of {@link DebugToolRow}: the slice of the keyed slot's owner props the row reads. */
export interface DebugToolRowProps {
  /** Wire tool name and keyed dispatch value. */
  readonly toolName: string
  /** Preparing, dispatched, or settled call block. */
  readonly block: ToolCallBlock
  /** Dictionary translate for the `debug` namespace. */
  readonly t: PropsLocale<'debug'>['t']
}

/**
 * Read one call's parsed argument object from its raw JSON.
 * @param argsRaw - the recorded raw arguments.
 * @returns the argument object, or undefined for absent or malformed JSON.
 */
function parsedArgs(argsRaw: string): Record<string, unknown> | undefined {
  if (argsRaw === '') return undefined
  try {
    const value: unknown = JSON.parse(argsRaw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    return value as Record<string, unknown>
  } catch {
    // A truncated streamed prefix is malformed arguments; the generic card
    // fallback carries the call instead of a half-read model.
    return undefined
  }
}

/**
 * Render one debug tool call as the transcript's card. Preparation and calls
 * without a recorded head render the title only; dispatched and settled calls
 * project their logged arguments through {@link debugToolCard}, so replay
 * renders identically.
 * @param props - the keyed slot's owner props and the debug locale.
 * @returns the card element.
 */
export function DebugToolRow(props: DebugToolRowProps): ReactElement {
  const { toolName, block, t } = props
  const call = 'kind' in block
    ? block.call
    : (block.phase === 'preparing' ? undefined : block)
  if (call === undefined || call === null) {
    return <span data-debug-card={toolName}>{debugToolCard(toolName, undefined, t).title}</span>
  }
  const model = debugToolCard(toolName, parsedArgs(call.argsRaw), t)
  return (
    <span data-debug-card={toolName}>
      {model.title}
      {model.summary === undefined ? null : <span data-debug-card-summary="">{model.summary}</span>}
      {model.locations === undefined
        ? null
        : model.locations.map(location => (
          <span
            key={`${location.path}:${location.line ?? ''}`}
            data-debug-card-location=""
          >{location.path}{location.line === undefined ? '' : `:${location.line}`}</span>
        ))}
    </span>
  )
}

/**
 * Register the four debug tools' transcript cards. Registration is a slot
 * effect: disposal removes all four, and unregistered names fall back to the
 * transcript's generic row.
 * @param ctx - client root context carrying the slots service.
 */
export function applyDebugToolCards(ctx: ClientContext): void {
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const name of DEBUG_TOOL_NAMES) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key: name, locale: 'debug' }, DebugToolRow)
    }
  })
}
