/** TUI transcript feed: assistant text blocks and paired tool summaries from Session events. */

import { describe, expect, it } from 'vitest'
import { createTuiTranscriptFeed } from '../src/feed.ts'
import type { TuiFeedEvent } from '../src/feed.ts'

/** One committed assistant message carrying the given text block. */
function assistantText(text: string): TuiFeedEvent {
  return {
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text }] } },
  }
}

/** One step boundary event the feed ignores. */
function stepEnd(): TuiFeedEvent {
  return { type: 'step/end' }
}

/** One tool call remembering the call id's tool name. */
function toolCall(callId: string, name: string): TuiFeedEvent {
  return {
    type: 'tool/call',
    data: { callId, name },
  }
}

/** One appended tool result carrying the given text. */
function toolResult(callId: string, text: string, isError = false): TuiFeedEvent {
  return {
    type: 'tool/result',
    surfaceOp: 'append',
    data: { message: { toolCallId: callId, isError, content: [{ type: 'text', text }] } },
  }
}

describe('TUI transcript feed', () => {
  it('derives assistant entries from text blocks only', () => {
    const feed = createTuiTranscriptFeed()
    expect(feed.push(assistantText('hello'))).toEqual([{ kind: 'assistant', text: 'hello' }])
    expect(feed.push(stepEnd())).toEqual([])
  })

  it('pairs tool results with their called names and bounds summaries', () => {
    const feed = createTuiTranscriptFeed({ maxSummaryLength: 10 })
    expect(feed.push(toolCall('call-1', 'debug_execution'))).toEqual([])
    expect(feed.push(toolResult('call-1', '0123456789ABC'))).toEqual([
      { kind: 'tool', name: 'debug_execution', summary: '012345678…' },
    ])
  })

  it('marks error results and falls back to the call id for unknown names', () => {
    const feed = createTuiTranscriptFeed()
    expect(feed.push(toolResult('call-2', 'boom', true))).toEqual([
      { kind: 'tool', name: 'call-2', summary: 'error: boom' },
    ])
  })

  it('skips tool results the surface replaced', () => {
    const feed = createTuiTranscriptFeed()
    feed.push(toolCall('call-1', 'debug_inspect'))
    const replaced: TuiFeedEvent = {
      type: 'tool/result',
      surfaceOp: { op: 'replace' },
      data: { message: { toolCallId: 'call-1', content: [{ type: 'text', text: 'later' }] } },
    }
    expect(feed.push(replaced)).toEqual([])
  })
})
