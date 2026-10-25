/** The editor's Remote half: opens, guarded saves, and breakpoint projection. */
import { describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteErrorCode, RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceFileBytes, WorkspaceFileStat } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { EditorWriteResult } from '@deepseek-ai/dsh-api-debug-controller/types'
import type { EditorRemote } from '../src/client/face.ts'
import { editorBreakpointInputs, openEditorFile, saveEditorFile } from '../src/client/face.ts'

const SESSION = SessionId('editor-face-spec')

/**
 * A wire failure carrying any code. The filesystem's wire codes cross the
 * gateway verbatim without a static map declaration yet, so the double widens
 * the code once, here, instead of at every comparison.
 */
const failure = (code: string): RemoteFailure =>
  new RemoteError(code as RemoteErrorCode, code + ' message', {})

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

const bytes = (data: Uint8Array, version = 'v1'): WorkspaceFileBytes => ({
  absolutePath: '/work/src/a.ts', version, bytes: data.byteLength, offset: 0, data, eof: true,
})

const ok = <T>(value: T): RemoteResult<T> => ({ ok: true, value })

const remoteWith = (overrides: {
  readBytes?: EditorRemote['workspaceFiles']['readBytes']
  stat?: EditorRemote['workspaceFiles']['stat']
  writeText?: EditorRemote['debug']['writeText']
}): EditorRemote => ({
  debug: {
    writeText: overrides.writeText ?? vi.fn(async () => ok<EditorWriteResult>({ version: 'v3', bytes: 0, operation: 'update' })),
    breakpointsSetFile: vi.fn(async () => ok([])),
  },
  workspaceFiles: {
    readBytes: overrides.readBytes ?? vi.fn(async () => ok(bytes(encode('a')))),
    stat: overrides.stat ?? vi.fn(async () => ok<WorkspaceFileStat>({ absolutePath: '/work/src/a.ts', version: 'v1' })),
  },
})

describe('openEditorFile', () => {
  it('decodes UTF-8, keeps the version, and detects the separator', async () => {
    const remote = remoteWith({
      readBytes: vi.fn(async () => ok(bytes(encode('a\r\nb')))),
    })
    await expect(openEditorFile(remote, SESSION, 'src/a.ts', { maxBytes: 16 }))
      .resolves.toEqual({ outcome: 'opened', text: 'a\r\nb', version: 'v1', eol: '\r\n' })
  })

  it('refuses files past the byte cap before decoding', async () => {
    const remote = remoteWith({
      readBytes: vi.fn(async () => ok(bytes(encode('x'.repeat(64))))),
    })
    await expect(openEditorFile(remote, SESSION, 'big.bin', { maxBytes: 16 }))
      .resolves.toEqual({ outcome: 'too-large', bytes: 64 })
  })

  it('falls back to the read window when the size is unreported', async () => {
    const remote = remoteWith({
      readBytes: vi.fn(async () => ok({ ...bytes(encode('x'.repeat(4))), bytes: undefined })),
    })
    await expect(openEditorFile(remote, SESSION, 'quiet.bin', { maxBytes: 2 }))
      .resolves.toEqual({ outcome: 'too-large', bytes: 4 })
  })

  it('refuses non-UTF-8 files instead of corrupting them', async () => {
    const remote = remoteWith({
      readBytes: vi.fn(async () => ok(bytes(new Uint8Array([0xff, 0xfe])))),
    })
    await expect(openEditorFile(remote, SESSION, 'blob', { maxBytes: 16 }))
      .resolves.toEqual({ outcome: 'not-text' })
  })

  it('carries read failures out unchanged', async () => {
    const error = failure('gateway/internal')
    const remote = remoteWith({ readBytes: vi.fn(async () => ({ ok: false as const, error })) })
    await expect(openEditorFile(remote, SESSION, 'gone.ts', { maxBytes: 16 }))
      .resolves.toEqual({ outcome: 'failed', failure: error })
  })
})

describe('saveEditorFile', () => {
  const payload = { path: 'src/a.ts', content: 'b', expectedVersion: 'v1' as string | null }

  it('reports the new version on a clean save', async () => {
    const remote = remoteWith({
      writeText: vi.fn(async () => ok<EditorWriteResult>({ version: 'v2', bytes: 1, operation: 'update' })),
    })
    await expect(saveEditorFile(remote, SESSION, payload)).resolves.toEqual({ outcome: 'saved', version: 'v2' })
  })

  it('resolves the disk version on a stale-version collision', async () => {
    const remote = remoteWith({
      writeText: vi.fn(async () => ({ ok: false as const, error: failure('FS_STALE_VERSION') })),
      stat: vi.fn(async () => ok<WorkspaceFileStat>({ absolutePath: '/work/src/a.ts', version: 'v9' })),
    })
    await expect(saveEditorFile(remote, SESSION, payload)).resolves.toEqual({ outcome: 'conflict', diskVersion: 'v9' })
  })

  it('reports non-conflict failures as themselves', async () => {
    const error = failure('FS_PERMISSION_DENIED')
    const remote = remoteWith({ writeText: vi.fn(async () => ({ ok: false as const, error })) })
    await expect(saveEditorFile(remote, SESSION, payload)).resolves.toEqual({ outcome: 'failed', failure: error })
  })

  it('reports the follow-up stat failure when the conflict cannot be named', async () => {
    const error = failure('gateway/internal')
    const remote = remoteWith({
      writeText: vi.fn(async () => ({ ok: false as const, error: failure('FS_STALE_VERSION') })),
      stat: vi.fn(async () => ({ ok: false as const, error })),
    })
    await expect(saveEditorFile(remote, SESSION, payload)).resolves.toEqual({ outcome: 'failed', failure: error })
  })
})

describe('editorBreakpointInputs', () => {
  it('projects enabled breakpoints and keeps configured fields', () => {
    expect(editorBreakpointInputs([
      { line: 2, condition: 'x > 0', logMessage: 'x={x}' },
      { line: 3, enabled: false, condition: 'never' },
      { line: 4 },
    ])).toEqual([
      { line: 2, condition: 'x > 0', logMessage: 'x={x}' },
      { line: 4 },
    ])
  })
})
