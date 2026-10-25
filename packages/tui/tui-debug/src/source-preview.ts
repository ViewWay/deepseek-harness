/**
 * The TUI source preview: a bounded read-only window around the current
 * execution line (design 9.8.4). `sourceWindow` computes the 1-based line
 * window; `readSourceWindow` streams the file through the execution world's
 * `ctx.fs` reader and stops as soon as the window end has passed, so a large
 * file is never loaded in full. Failures are typed with stable codes.
 * @module @deepseek-ai/dsh-tui-debug/source-preview
 */

import { DebugError } from '@deepseek-ai/dsh-debug'

/** Default byte budget one preview may scan before refusing. */
export const DEFAULT_MAX_SCAN_BYTES = 256 * 1024

/** A resolved file identity; the structural subset of the fs seam's target the preview carries. */
export interface TuiSourceTarget {
  /** Opaque backend key; never parsed or displayed. */
  readonly targetKey: string
}

/**
 * The read face the preview needs. `ctx.fs` (the `FileSystem` service)
 * satisfies it structurally; tests substitute a small in-memory reader.
 */
export interface TuiSourceReader {
  /**
   * Resolve one path into a stable target.
   * @param path - the workspace-relative or absolute path to read.
   * @param opts - cwd override and cancellation.
   * @returns the resolved target.
   */
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<TuiSourceTarget>
  /**
   * Stream the target as decoded text chunks.
   * @param target - the resolved target.
   * @param signal - aborts the stream between chunks.
   * @returns the decoded chunk iterable.
   */
  streamText(target: TuiSourceTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>
}

/** A stable presentation failure of the source preview. */
export class SourceWindowError extends Error {
  /** Stable machine-routable code; callers branch on it, never on `message`. */
  readonly code: 'SOURCE_WINDOW_TOO_LARGE'

  /**
   * Build one typed preview failure.
   * @param message - human-readable description; routing never parses this.
   */
  constructor(message: string) {
    super(message)
    this.name = 'SourceWindowError'
    this.code = 'SOURCE_WINDOW_TOO_LARGE'
  }
}

/** One rendered source window; `lines[current - start]` is the current line. */
export interface SourceWindow {
  readonly file: string
  readonly start: number
  readonly end: number
  readonly current: number
  readonly lines: readonly string[]
}

/**
 * Compute the 1-based line window around the current line, clamped to the
 * file's edges.
 * @param lines - the complete line list; only its length bounds the window.
 * @param current - the 1-based current line; values past the end clamp to it.
 * @param context - lines of context on each side; zero means only the line.
 * @returns the inclusive window bounds and the clamped current line.
 * @throws {@link DebugError} `DEBUG_INVALID_CONFIG` for a non-positive line, a
 * negative context, or an empty file.
 */
export function sourceWindow(
  lines: readonly string[],
  current: number,
  context: number,
): { readonly start: number; readonly end: number; readonly current: number } {
  if (!Number.isSafeInteger(current) || current < 1) {
    throw new DebugError('the current line must be a positive integer', 'DEBUG_INVALID_CONFIG')
  }
  if (!Number.isSafeInteger(context) || context < 0) {
    throw new DebugError('context must be a non-negative integer', 'DEBUG_INVALID_CONFIG')
  }
  if (lines.length === 0) {
    throw new DebugError('the source file has no lines to preview', 'DEBUG_INVALID_CONFIG')
  }
  const clamped = Math.min(current, lines.length)
  return {
    start: Math.max(1, clamped - context),
    end: Math.min(lines.length, clamped + context),
    current: clamped,
  }
}

/** Options of {@link readSourceWindow}. */
export interface ReadSourceWindowOptions {
  /** Lines of context around the current line (default 3). */
  readonly context?: number
  /**
   * Byte budget the preview may scan before refusing; the window stops
   * streaming at its end line, so only a current line past the end of a huge
   * file can reach the cap (default {@link DEFAULT_MAX_SCAN_BYTES}).
   */
  readonly maxScanBytes?: number
  /** Cancellation carried into the reader. */
  readonly signal?: AbortSignal
}

/**
 * Read one bounded source window through the execution world's fs reader.
 * The stream stops once the window end line has passed, so the whole file is
 * never buffered; scanning past a missing end line is capped by
 * `maxScanBytes` and fails typed.
 * @param reader - the fs read face; pass `ctx.fs`.
 * @param path - the file to preview.
 * @param current - the 1-based current line.
 * @param options - context size, scan cap, and cancellation.
 * @returns the window with its lines; `lines[current - start]` is current.
 * @throws {@link SourceWindowError} when the scan cap is exceeded;
 * {@link DebugError} `DEBUG_INVALID_CONFIG` for invalid bounds; reader
 * failures (missing path, binary content) propagate unchanged.
 */
export async function readSourceWindow(
  reader: TuiSourceReader,
  path: string,
  current: number,
  options: ReadSourceWindowOptions = {},
): Promise<SourceWindow> {
  const context = options.context ?? 3
  const maxScanBytes = options.maxScanBytes ?? DEFAULT_MAX_SCAN_BYTES
  const target = await reader.resolve(path, options.signal === undefined ? undefined : { signal: options.signal })
  const lines: string[] = []
  let buffer = ''
  let scanned = 0
  for await (const chunk of await reader.streamText(target, options.signal)) {
    buffer += chunk
    scanned += Buffer.byteLength(chunk)
    if (scanned > maxScanBytes) {
      throw new SourceWindowError(
        `source preview gave up after ${String(maxScanBytes)} bytes without reaching line ${String(current)} of "${path}"`,
      )
    }
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      let end = newline
      if (end > 0 && buffer.charCodeAt(end - 1) === 13) end -= 1
      lines.push(buffer.slice(0, end))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
    // Keep one line past the window end: the chunk boundary must not cut the
    // final line before its content has fully streamed through.
    if (lines.length > current + context) break
  }
  if (buffer !== '') lines.push(buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer)
  if (lines.length === 0) {
    throw new DebugError(`"${path}" has no lines to preview`, 'DEBUG_INVALID_CONFIG')
  }
  const window = sourceWindow(lines, current, context)
  return {
    file: path,
    start: window.start,
    end: window.end,
    current: window.current,
    lines: lines.slice(window.start - 1, window.end),
  }
}
