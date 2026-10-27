import { describe, expect, it } from 'vitest'
import { readSourceWindow, sourceWindow, SourceWindowError, TuiSourceReader, TuiSourceTarget } from '../src/source-preview.ts'

describe('TUI source preview', () => {
  it('keeps a bounded window around the current line', () => {
    const lines = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`)
    expect(sourceWindow(lines, 50, 3)).toEqual({ start: 47, end: 53, current: 50 })
  })

  it('clamps the window at both file edges', () => {
    const lines = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`)
    expect(sourceWindow(lines, 1, 3)).toEqual({ start: 1, end: 4, current: 1 })
    expect(sourceWindow(lines, 10, 3)).toEqual({ start: 7, end: 10, current: 10 })
    expect(sourceWindow(lines, 99, 2)).toEqual({ start: 8, end: 10, current: 10 })
  })

  it('rejects non-positive lines, negative context, and empty files', () => {
    expect(() => sourceWindow(['a'], 0, 3)).toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    expect(() => sourceWindow(['a'], 1, -1)).toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    expect(() => sourceWindow([], 1, 1)).toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })

  it('reads the window through the fs reader without loading the whole file', async () => {
    const lines = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`)
    const reader = makeReader(lines.join('\n'))
    const window = await readSourceWindow(reader, 'src/a.ts', 50, { context: 3 })
    expect(window.lines).toEqual(lines.slice(46, 53))
    expect(window).toMatchObject({ start: 47, end: 53, current: 50, file: 'src/a.ts' })
  })

  it('fails typed when the scanned bytes exceed the cap', async () => {
    const lines = Array.from({ length: 40_000 }, (_, index) => `line ${index + 1}`)
    const reader = makeReader(lines.join('\n'))
    await expect(readSourceWindow(reader, 'src/big.ts', 39_000, { context: 2 }))
      .rejects.toThrow(SourceWindowError)
    await expect(readSourceWindow(reader, 'src/big.ts', 39_000, { context: 2 }))
      .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_WINDOW_TOO_LARGE' }))
  })

  it('measures the scan cap in bytes, not code units', async () => {
    // 64 UTF-16 code units but 192 UTF-8 bytes; a code-unit count would fit
    // the 100 budget and only fail far later.
    const chunk = '字'.repeat(64)
    const reader = makeReader(`${chunk}${'\n'.repeat(9999)}`)
    await expect(readSourceWindow(reader, 'src/wide.ts', 5000, { maxScanBytes: 100 }))
      .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_WINDOW_TOO_LARGE' }))
  })

  it('stops scanning once the window end line has streamed through', async () => {
    const lines = Array.from({ length: 5000 }, (_, index) => `line ${index + 1}`)
    const reader = makeReader(lines.join('\n'))
    const window = await readSourceWindow(reader, 'src/b.ts', 4, { context: 1, maxScanBytes: 4096 })
    expect(window.lines).toEqual(['line 3', 'line 4', 'line 5'])
  })

  it('propagates reader failures for missing paths', async () => {
    const reader: TuiSourceReader = {
      resolve: () => Promise.reject(new Error('FS_NOT_FOUND')),
      streamText: () => Promise.reject(new Error('unreached')),
    }
    await expect(readSourceWindow(reader, 'src/gone.ts', 1, {})).rejects.toThrow('FS_NOT_FOUND')
  })

  it('carries the cancellation signal into resolve and the stream', async () => {
    const seen: (AbortSignal | undefined)[] = []
    const reader: TuiSourceReader = {
      resolve: (_path, opts) => {
        seen.push(opts?.signal)
        return Promise.resolve({ targetKey: 'key-signal' })
      },
      streamText: (_target, signal) => {
        seen.push(signal)
        return Promise.resolve((async function* generate(): AsyncIterable<string> { })())
      },
    }
    const controller = new AbortController()
    await expect(readSourceWindow(reader, 'src/a.ts', 1, { signal: controller.signal })).rejects.toThrow()
    expect(seen[0]).toBe(controller.signal)
    expect(seen[1]).toBe(controller.signal)
  })

  it('strips carriage returns from CRLF sources', async () => {
    const reader = makeReader('line 1\r\nline 2\r\nline 3\r')
    const window = await readSourceWindow(reader, 'src/crlf.ts', 3, { context: 1 })
    expect(window.lines).toEqual(['line 2', 'line 3'])
    expect(window).toMatchObject({ start: 2, end: 3, current: 3 })
  })

  it('fails typed for a file with no lines', async () => {
    const reader = makeReader('')
    await expect(readSourceWindow(reader, 'src/empty.ts', 1, {}))
      .rejects.toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })
})

/** A minimal in-memory reader satisfying the structural fs face. */
function makeReader(text: string): TuiSourceReader {
  const target: TuiSourceTarget = { targetKey: 'key-1' }
  return {
    resolve: () => Promise.resolve(target),
    streamText: (_target, signal) => {
      const chunks = text.match(/.{1,64}/gs) ?? []
      async function* generate(): AsyncIterable<string> {
        for (const chunk of chunks) {
          signal?.throwIfAborted()
          yield chunk
        }
      }
      return Promise.resolve(generate())
    },
  }
}
