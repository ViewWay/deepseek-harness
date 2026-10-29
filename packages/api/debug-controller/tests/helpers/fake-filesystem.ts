import { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import FileSystem from '@deepseek-ai/dsh-fs'
import type { FsInfo, FsTarget, FsWriteIntent, FsWriteOutcome } from '@deepseek-ai/dsh-fs'

/** Recordable filesystem double for editor-write specs. */
export interface FakeFileSystem {
  /** Intent of the last write attempt, when one happened. */
  lastWriteIntent: FsWriteIntent | undefined
  /** How many writes reached the backend. */
  writeCount: number
  /** Absolute path of the last resolve call, when one happened. */
  lastResolvedPath: string | undefined
  /** The editor-write seam's filesystem slice. */
  resolve(path: string): Promise<FsTarget>
  stat(target: FsTarget): Promise<FsInfo | undefined>
  writeText(target: FsTarget, content: string, expected?: FsWriteIntent): Promise<FsWriteOutcome>
}

/** Refuse one member the editor-write seam never touches. */
function unused(): never {
  throw new Error('fake filesystem member is not used by editor writes')
}

/** Filesystem double whose files carry fixed versions; extends the service for a typed mount. */
class RecordingFileSystem extends FileSystem {
  lastWriteIntent: FsWriteIntent | undefined
  lastResolvedPath: string | undefined
  writeCount = 0
  private readonly state: Map<string, string>

  constructor(ctx: Context, files: Readonly<Record<string, string>>) {
    super(ctx)
    this.state = new Map(Object.entries(files))
  }

  override resolve(path: string): Promise<FsTarget> {
    this.lastResolvedPath = path
    return Promise.resolve({ targetKey: path as never, displayPath: path })
  }

  override stat(target: FsTarget): Promise<FsInfo | undefined> {
    const version = this.state.get(target.displayPath)
    if (version === undefined) return Promise.resolve(undefined)
    return Promise.resolve({ version: version as never, type: 'file', size: 0 })
  }

  override writeText(target: FsTarget, content: string, expected?: FsWriteIntent): Promise<FsWriteOutcome> {
    this.lastWriteIntent = expected
    if (expected?.kind === 'createIfAbsent' && this.state.has(target.displayPath)) {
      return Promise.reject(new FsError('target already exists: ' + target.displayPath, 'FS_NOT_OBSERVED'))
    }
    if (expected?.kind === 'replaceIfVersion' && this.state.get(target.displayPath) !== expected.version) {
      return Promise.reject(new FsError('stale version for ' + target.displayPath, 'FS_STALE_VERSION'))
    }
    this.writeCount += 1
    const existed = this.state.has(target.displayPath)
    const version = 'v' + (this.writeCount + 1)
    this.state.set(target.displayPath, version)
    return Promise.resolve({ operation: existed ? 'update' : 'create', version: version as never, before: null, after: content })
  }

  override processPath(): string { throw unused() }
  override fileUrl(): string { throw unused() }
  override contains(): boolean { throw unused() }
  override lstat(): Promise<never> { throw unused() }
  override readText(): Promise<never> { throw unused() }
  override streamText(): Promise<never> { throw unused() }
  override readBytes(): Promise<never> { throw unused() }
  override readByteRange(): Promise<never> { throw unused() }
  override listDir(): Promise<never> { throw unused() }
  override editText(): Promise<never> { throw unused() }
}

/**
 * Build one filesystem double whose files carry fixed versions.
 *
 * @param files - absolute path to the version text each file holds.
 * @returns The double, typed as the editor-write seam's slice, with observable write facts.
 */
export function fakeFileSystem(files: Readonly<Record<string, string>>): FakeFileSystem {
  return new RecordingFileSystem(new Context(), files)
}
