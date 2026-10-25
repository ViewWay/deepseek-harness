/** Offline adapter cache on the adapter manager's local install root; checksums gate every use. */

import { createHash } from 'node:crypto'
import { join } from 'node:path'

/** Target-world I/O the cache needs, bridged from the shell's file access. */
export interface DesktopAdapterCacheEnvironment {
  /** @param path - file path to test. @returns whether the file exists. */
  exists(path: string): Promise<boolean>
  /** @param path - file path to hash. @returns the file's SHA-256 hex digest. */
  sha256(path: string): Promise<string>
  /** @param path - destination file. @param bytes - content to write. */
  write(path: string, bytes: Uint8Array): Promise<void>
}

/** One adapter archive slot, identified like the adapter manager's install layout. */
export interface DesktopAdapterCacheEntry {
  readonly providerId: string
  readonly version: string
  readonly platform: string
  /** Archive file name inside the version-and-platform directory. */
  readonly archive: string
  /** Expected SHA-256 hex digest of the archive bytes. */
  readonly sha256: string
}

/** A cached archive failed its digest check; the stable code matches the seam. */
export class DesktopAdapterChecksumError extends Error {
  /** Stable failure code shared with the debug seam's checksum failures. */
  readonly code = 'DEBUG_ADAPTER_CHECKSUM'

  constructor(message: string) {
    super(message)
    this.name = 'DesktopAdapterChecksumError'
  }
}

/**
 * Offline reuse of downloaded adapter archives under the adapter manager's
 * local install root, laid out as `<installRoot>/<providerId>/<version>/<platform>/<archive>`
 * so the manager's install flow resolves the same files. Every read and write
 * verifies the manifest digest first; a mismatched archive is never reused
 * and a mismatched download is never stored.
 */
export class DesktopAdapterCache {
  private readonly environment: DesktopAdapterCacheEnvironment

  /**
   * @param installRoot - the adapter manager's local install root.
   * @param environment - file access bridged from the shell.
   */
  constructor(private readonly installRoot: string, environment: DesktopAdapterCacheEnvironment) {
    this.environment = environment
  }

  /**
   * Reuse one cached archive offline when its bytes match the manifest digest.
   * @param entry - the archive slot to check.
   * @returns the archive path when present and digest-verified, otherwise null.
   */
  async find(entry: DesktopAdapterCacheEntry): Promise<string | null> {
    const file = this.archiveFile(entry)
    if (!await this.environment.exists(file)) return null
    return await this.environment.sha256(file) === entry.sha256 ? file : null
  }

  /**
   * Verify downloaded bytes against the manifest digest, then persist them.
   * @param entry - the archive slot to fill.
   * @param bytes - the downloaded archive bytes.
   * @returns the stored archive path.
   * @throws {@link DesktopAdapterChecksumError} when the bytes do not match
   * the entry digest; nothing is written in that case.
   */
  async store(entry: DesktopAdapterCacheEntry, bytes: Uint8Array): Promise<string> {
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== entry.sha256) {
      throw new DesktopAdapterChecksumError(
        `adapter "${entry.providerId}" archive checksum mismatch: expected ${entry.sha256}, got ${digest}`,
      )
    }
    const file = this.archiveFile(entry)
    await this.environment.write(file, bytes)
    return file
  }

  private archiveFile(entry: DesktopAdapterCacheEntry): string {
    return join(this.installRoot, entry.providerId, entry.version, entry.platform, entry.archive)
  }
}
