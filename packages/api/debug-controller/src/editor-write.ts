/**
 * Guarded editor saves: the controller's only write path, delegating every
 * write to `ctx.fs`'s version-guarded `writeText`.
 *
 * The path is client-supplied and never trusted: NUL bytes, absolute paths,
 * and `..` segments that escape the session's workspace root reject with
 * `FS_PERMISSION_DENIED` before the filesystem is touched. A non-null
 * `expectedVersion` writes through `replaceIfVersion` (`FS_STALE_VERSION`
 * on conflict); `null` is the create path (`createIfAbsent` — an existing
 * target conflicts and is never overwritten). Directory, non-UTF-8, and
 * size rejections surface as the filesystem's own `FsError` codes. No
 * rename, delete, or mkdir crosses this seam.
 * @module @deepseek-ai/dsh-api-debug-controller/editor-write
 */
import { FsError, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsTarget, FsWriteIntent, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import type { FsVersion as FsVersionValue } from '@deepseek-ai/dsh-fs'

/** The filesystem slice the write path consumes. */
export interface EditorFileSystem {
  /** Resolves one absolute path to an opaque target. */
  resolve(path: string): Promise<FsTarget>
  /** Version-guarded full-file write. */
  writeText(target: FsTarget, content: string, expected?: FsWriteIntent): Promise<FsWriteOutcome>
}

/** One editor save request; `workspaceRoot` is resolved host-side. */
export interface EditorWriteRequest {
  readonly sessionId: string
  readonly workspaceRoot: string
  readonly path: string
  readonly content: string
  /** The version the editor opened, or `null` for the create path. */
  readonly expectedVersion: FsVersionValue | null
  readonly fs: EditorFileSystem
}

/** One committed editor save. */
export interface EditorWriteResult {
  /** The file's new opaque version after the write. */
  readonly version: string
  /** Byte length of the written content. */
  readonly bytes: number
  /** Whether the write created or replaced the file. */
  readonly operation: 'create' | 'update'
}

const LONE_SURROGATE = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/u

function rejectClientPath(path: string): void {
  if (path.length === 0 || path.includes('\0') || path.startsWith('/') || LONE_SURROGATE.test(path)) {
    throw new FsError('editor path is not a workspace-relative text path', 'FS_PERMISSION_DENIED')
  }
  let depth = 0
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      depth -= 1
      if (depth < 0) {
        throw new FsError('editor path escapes the session workspace', 'FS_PERMISSION_DENIED')
      }
      continue
    }
    depth += 1
  }
}

/**
 * Performs one guarded editor save through the filesystem service.
 *
 * @param request - Session identity, host-resolved workspace root, the
 *   client-supplied relative path, content, and the opened version or null.
 * @returns The new version, byte count, and create/update outcome.
 * @throws FsError(`FS_PERMISSION_DENIED`) for escaping or malformed paths;
 *   FsError(`FS_STALE_VERSION`) on a version conflict; FsError(`FS_NOT_OBSERVED`)
 *   when the create path targets an existing file; other `FsError` codes
 *   (directory, non-UTF-8, size) pass through from the filesystem.
 */
export async function writeEditorText(request: EditorWriteRequest): Promise<EditorWriteResult> {
  rejectClientPath(request.path)
  if (LONE_SURROGATE.test(request.content)) {
    throw new FsError('editor content is not encodable as UTF-8', 'FS_NOT_TEXT')
  }
  const target = await request.fs.resolve(joinPath(request.workspaceRoot, request.path))
  const intent: FsWriteIntent | undefined = request.expectedVersion === null
    ? { kind: 'createIfAbsent' }
    : { kind: 'replaceIfVersion', version: request.expectedVersion }
  const outcome = await request.fs.writeText(target, request.content, intent)
  return {
    version: String(outcome.version),
    bytes: new TextEncoder().encode(request.content).length,
    operation: outcome.operation,
  }
}

/** Joins a root and a pre-validated relative path without trusting either separator. */
function joinPath(root: string, relative: string): string {
  const trimmed = root.endsWith('/') ? root.slice(0, -1) : root
  return trimmed + '/' + relative
}

/** Re-exported so the Remote layer can brand wire-side version strings once. */
export function editorVersion(wire: string): FsVersionValue {
  return FsVersion(wire)
}
