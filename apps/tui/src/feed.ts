/**
 * Transcript feed: derives bounded TUI transcript entries from committed
 * Session events — assistant text blocks and paired tool summaries, mirroring
 * how the headless NDJSON projection derives them. The feed maps; the session
 * owns the single transcript store.
 * @module @deepseek-ai/dsh-tui/feed
 */

import type { TuiTranscriptEntry } from './transcript.ts'

/** A content block as the feed reads it; real message content assigns to it. */
export interface TuiFeedBlock {
  readonly type: string
  readonly text?: string
}

/** A tool-result message as the feed reads it. */
interface TuiFeedToolResultMessage {
  readonly toolCallId: string
  readonly isError?: boolean
  readonly content: readonly TuiFeedBlock[]
}

/** The Session-event fields the feed reads; real events are structurally compatible. */
export type TuiFeedEvent =
  | { readonly type: 'assistant/message'; readonly data: { readonly message: { readonly content: readonly TuiFeedBlock[] } } }
  | { readonly type: 'tool/call'; readonly data: { readonly callId: string; readonly name: string } }
  | { readonly type: 'tool/result'; readonly surfaceOp?: unknown; readonly data: { readonly message: TuiFeedToolResultMessage } }
  | { readonly type: string }

/** Bounds for the feed. */
export interface TuiTranscriptFeedOptions {
  /** Largest tool-summary length in characters; longer text is truncated (default 160). */
  readonly maxSummaryLength?: number
}

/** The feed face the runner pushes events through. */
export interface TuiTranscriptFeed {
  /** Fold one committed Session event and return the entries it derived (possibly none). */
  push(event: TuiFeedEvent): readonly TuiTranscriptEntry[]
}

/** Content-block reader shape kept for the helper below. */
interface TextBlock {
  readonly type: string
  readonly text?: string
}

/**
 * Create the transcript feed.
 * @param options - truncation bounds.
 * @returns the feed.
 */
export function createTuiTranscriptFeed(options: TuiTranscriptFeedOptions = {}): TuiTranscriptFeed {
  const maxSummaryLength = options.maxSummaryLength ?? 160
  const toolNames = new Map<string, string>()

  const bound = (text: string): string =>
    text.length <= maxSummaryLength ? text : `${text.slice(0, Math.max(0, maxSummaryLength - 1))}…`

  const textOf = (blocks: readonly TextBlock[]): string =>
    blocks.filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('')

  return {
    push(event): readonly TuiTranscriptEntry[] {
      // The `in` checks drop the generic arm; a bare `type` comparison cannot.
      if (event.type === 'assistant/message' && 'data' in event) {
        const entries: TuiTranscriptEntry[] = []
        for (const block of event.data.message.content) {
          if (block.type === 'text' && typeof block.text === 'string' && block.text !== '') {
            entries.push({ kind: 'assistant', text: block.text })
          }
        }
        return entries
      }
      if (event.type === 'tool/call' && 'data' in event) {
        toolNames.set(event.data.callId, event.data.name)
        return []
      }
      if (event.type === 'tool/result' && 'data' in event) {
        // Compaction replaces older results in the surface; those are history,
        // not live output, and would duplicate a callId already summarized.
        if (event.surfaceOp !== 'append') return []
        const message = event.data.message
        const name = toolNames.get(message.toolCallId) ?? message.toolCallId
        const summary = message.isError === true
          ? `error: ${bound(textOf(message.content))}`
          : bound(textOf(message.content))
        return [{ kind: 'tool', name, summary }]
      }
      return []
    },
  }
}
