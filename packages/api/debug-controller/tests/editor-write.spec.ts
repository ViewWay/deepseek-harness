/**
 * Guarded editor saves: version-guarded updates, stale-version conflicts,
 * the full client-path escape family (leading `..`, absolute, NUL, lone
 * surrogate) rejected before any filesystem access, non-UTF-8 content
 * rejected up front, filesystem policy rejections passed through untouched,
 * and the resolved path always joined under the session's workspace root.
 */
import { describe, expect, it } from 'vitest'
import { FsError } from '@deepseek-ai/dsh-fs'
import { fixtureFsVersion, fixtureSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { writeEditorText } from '../src/editor-write.ts'
import { fakeFileSystem } from './helpers/fake-filesystem.ts'

const opened = fixtureFsVersion('v1')

describe('editor write', () => {
  it('guards the write with the version the editor opened', async () => {
    const fs = fakeFileSystem({ '/ws/src/a.ts': 'v1' })
    const result = await writeEditorText({
      sessionId: String(fixtureSessionId(1)),
      workspaceRoot: '/ws',
      path: 'src/a.ts',
      content: 'x',
      expectedVersion: opened,
      fs,
    })
    expect(result).toMatchObject({ bytes: 1, operation: 'update' })
    expect(fs.lastWriteIntent).toMatchObject({ kind: 'replaceIfVersion' })
    expect(fs.writeCount).toBe(1)
  })

  it('maps a stale version to a conflict without writing', async () => {
    const fs = fakeFileSystem({ '/ws/src/a.ts': 'v2' })
    await expect(writeEditorText({
      sessionId: String(fixtureSessionId(1)),
      workspaceRoot: '/ws',
      path: 'src/a.ts',
      content: 'x',
      expectedVersion: opened,
      fs,
    })).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    expect(fs.writeCount).toBe(0)
  })

  it('rejects a path outside the workspace before touching the backend', async () => {
    const fs = fakeFileSystem({})
    await expect(writeEditorText({
      sessionId: String(fixtureSessionId(1)),
      workspaceRoot: '/ws',
      path: '../escape.ts',
      content: 'x',
      expectedVersion: null,
      fs,
    })).rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' })
    expect(fs.writeCount).toBe(0)
    expect(fs.lastWriteIntent).toBeUndefined()
  })

  it('rejects every remaining escape flavor before resolving anything', async () => {
    const fs = fakeFileSystem({})
    for (const path of ['/abs.ts', 'a/../../escape.ts', 'nul\0byte.ts', '\uD800lone.ts']) {
      await expect(writeEditorText({
        sessionId: String(fixtureSessionId(1)),
        workspaceRoot: '/ws',
        path,
        content: 'x',
        expectedVersion: null,
        fs,
      })).rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' })
    }
    expect(fs.lastResolvedPath).toBeUndefined()
    expect(fs.writeCount).toBe(0)
  })

  it('rejects non-UTF-8 content before touching the backend', async () => {
    const fs = fakeFileSystem({ '/ws/src/a.ts': 'v1' })
    await expect(writeEditorText({
      sessionId: String(fixtureSessionId(1)),
      workspaceRoot: '/ws',
      path: 'src/a.ts',
      content: '\uDC00broken surrogate',
      expectedVersion: opened,
      fs,
    })).rejects.toMatchObject({ code: 'FS_NOT_TEXT' })
    expect(fs.lastResolvedPath).toBeUndefined()
    expect(fs.writeCount).toBe(0)
  })

  it('passes filesystem policy rejections through without rewriting them', async () => {
    const fs = fakeFileSystem({})
    fs.writeText = async () => {
      throw new FsError('file exceeds the editor size limit', 'FS_TOO_LARGE')
    }
    await expect(writeEditorText({
      sessionId: String(fixtureSessionId(1)),
      workspaceRoot: '/ws',
      path: 'src/big.ts',
      content: 'x',
      expectedVersion: null,
      fs,
    })).rejects.toMatchObject({ code: 'FS_TOO_LARGE' })
  })

  it('always resolves the joined root-anchored path, never a client-absolute one', async () => {
    const fs = fakeFileSystem({})
    await writeEditorText({
      sessionId: String(fixtureSessionId(1)),
      workspaceRoot: '/ws/',
      path: 'src/a.ts',
      content: 'x',
      expectedVersion: null,
      fs,
    })
    expect(fs.lastResolvedPath).toBe('/ws/src/a.ts')
  })

  it('creates through the absent path without overwriting an existing file', async () => {
    const fs = fakeFileSystem({ '/ws/new.ts': 'v9' })
    await expect(writeEditorText({
      sessionId: String(fixtureSessionId(2)),
      workspaceRoot: '/ws',
      path: 'new.ts',
      content: 'y',
      expectedVersion: null,
      fs,
    })).rejects.toMatchObject({ code: 'FS_NOT_OBSERVED' })
    expect(fs.writeCount).toBe(0)
  })
})
