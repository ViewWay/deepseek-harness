import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsInfo, FsTarget, FsWriteIntent, FsWriteOutcome, FileSystem } from '@deepseek-ai/dsh-fs'

/** Recordable filesystem double for editor-write specs. */
export interface FakeFileSystem extends FileSystem {
  /** Intent of the last write attempt, when one happened. */
  lastWriteIntent: FsWriteIntent | undefined
  /** How many writes reached the backend. */
  writeCount: number
  /** Absolute path of the last resolve call, when one happened. */
  lastResolvedPath: string | undefined
}

/**
 * Build one filesystem double whose files carry fixed versions.
 *
 * @param files - absolute path to the version text each file holds.
 * @returns The double, typed as `FileSystem`, with observable write facts.
 */
export function fakeFileSystem(files: Readonly<Record<string, string>>): FakeFileSystem {
  const state = new Map(Object.entries(files))
  const double = {
    lastWriteIntent: undefined as FsWriteIntent | undefined,
    lastResolvedPath: undefined as string | undefined,
    writeCount: 0,
    async resolve(path: string): Promise<FsTarget> {
      double.lastResolvedPath = path
      return { targetKey: path as never, displayPath: path }
    },
    async stat(target: FsTarget): Promise<FsInfo | undefined> {
      const version = state.get(target.displayPath)
      if (version === undefined) return undefined
      return { version: version as never, type: 'file', size: 0 }
    },
    async writeText(target: FsTarget, content: string, expected?: FsWriteIntent): Promise<FsWriteOutcome> {
      double.lastWriteIntent = expected
      void content
      if (expected?.kind === 'createIfAbsent' && state.has(target.displayPath)) {
        throw new FsError('target already exists: ' + target.displayPath, 'FS_NOT_OBSERVED')
      }
      if (expected?.kind === 'replaceIfVersion' && state.get(target.displayPath) !== expected.version) {
        throw new FsError('stale version for ' + target.displayPath, 'FS_STALE_VERSION')
      }
      double.writeCount += 1
      const existed = state.has(target.displayPath)
      const version = 'v' + (double.writeCount + 1)
      state.set(target.displayPath, version)
      return { operation: existed ? 'update' : 'create', version: version as never, before: null, after: content }
    },
  }
  return double as unknown as FakeFileSystem
}
