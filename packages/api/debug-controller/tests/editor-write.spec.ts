import { describe, expect, it } from 'vitest'
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
