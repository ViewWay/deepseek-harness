/**
 * Managed adapter installation: download in the target execution world,
 * verify the archive SHA-256 before anything is written, write under the
 * platform's install directory, self-test, and roll the whole directory back
 * on any failure. The checksum is never optional.
 * @module @deepseek-ai/dsh-debug-adapter-manager/install
 */

import { createHash } from 'node:crypto'
import { DebugError } from '@deepseek-ai/dsh-debug'
import type { DebugProviderId as DebugProviderIdValue } from '@deepseek-ai/dsh-debug'
import type { DebugAdapterManifest, DebugAdapterPlatformEntry, DebugAdapterPlatformKey } from './manifest.ts'
import { resolveAdapterPlatform } from './manifest.ts'

/**
 * The execution-world I/O the installer needs. Callers bridge this from the
 * target world's services; the installer never touches host Node directly.
 */
export interface DebugAdapterInstallEnvironment {
  /** Path separator of the target execution world. */
  readonly pathSeparator: '/' | '\\'
  /** Download one archive's bytes from its source URL. */
  fetchBytes(url: string): Promise<Uint8Array>
  /** Atomically write one file in the target world. */
  write(path: string, bytes: Uint8Array): Promise<void>
  /** Remove one directory tree in the target world. */
  remove(path: string): Promise<void>
  /** Test whether one path exists in the target world. */
  exists(path: string): Promise<boolean>
  /** Run the adapter's handshake self-test in the target world. */
  runSelfTest(command: readonly string[]): Promise<{ exitCode: number; stdout?: string; stderr?: string }>
}

/** One managed install request. */
export interface DebugAdapterInstallRequest {
  readonly manifest: DebugAdapterManifest
  readonly platform: DebugAdapterPlatformKey
  /** Install root of the target execution world, e.g. its `debug-adapters` directory. */
  readonly installRoot: string
  readonly environment: DebugAdapterInstallEnvironment
}

/** Where one adapter version lives for one platform. */
export interface DebugAdapterInstallPath {
  /** The version-and-platform directory; removal rolls the install back. */
  readonly directory: string
  /** The downloaded archive file inside the directory. */
  readonly archiveFile: string
  /** The resolved executable inside the directory. */
  readonly executableFile: string
}

/**
 * Join path parts with the target world's separator.
 * @param environment - anything carrying the target world's path separator.
 * @param parts - path segments to join.
 * @returns the joined path.
 */
function join(environment: Pick<DebugAdapterInstallEnvironment, 'pathSeparator'>, ...parts: readonly string[]): string {
  return parts.join(environment.pathSeparator)
}

/**
 * Resolve the install layout for one manifest, platform, and root.
 * @param manifest - the validated manifest.
 * @param platform - the target platform key.
 * @param installRoot - the target world's install root.
 * @param environment - the target world's I/O, for its path separator.
 * @returns the directory, archive file, and executable file paths.
 * @throws {@link DebugError} `DEBUG_ADAPTER_UNSUPPORTED` when the platform is unpublished.
 */
export function adapterInstallPath(
  manifest: DebugAdapterManifest,
  platform: DebugAdapterPlatformKey,
  installRoot: string,
  environment: Pick<DebugAdapterInstallEnvironment, 'pathSeparator'>,
): DebugAdapterInstallPath {
  const entry = resolveAdapterPlatform(manifest, platform)
  const directory = join(environment, installRoot, manifest.providerId, manifest.version, platform)
  return {
    directory,
    archiveFile: join(environment, directory, entry.archive),
    executableFile: join(environment, directory, entry.executable),
  }
}

/** The download URL of a downloadable source; system sources are never managed-installed. */
function downloadUrl(manifest: DebugAdapterManifest): string {
  if (manifest.source.kind === 'archive' || manifest.source.kind === 'npm') return manifest.source.url
  throw new DebugError(
    `adapter "${manifest.providerId}" uses the system installation and is not managed-installed`,
    'DEBUG_ADAPTER_UNSUPPORTED',
    { providerId: manifest.providerId },
  )
}

/**
 * Install one adapter into the target execution world.
 * @param request - manifest, platform, install root, and target-world I/O.
 * @returns the install layout after a passing self-test.
 * @throws {@link DebugError} `DEBUG_ADAPTER_UNSUPPORTED` for an unpublished
 * platform, a system source, or a failing self-test (partial output is
 * removed); `DEBUG_ADAPTER_CHECKSUM` when the downloaded bytes do not hash
 * to the manifest's digest (partial output is removed).
 */
export async function installAdapter(request: DebugAdapterInstallRequest): Promise<DebugAdapterInstallPath> {
  const { manifest, platform, installRoot, environment } = request
  const entry: DebugAdapterPlatformEntry = resolveAdapterPlatform(manifest, platform)
  const layout = adapterInstallPath(manifest, platform, installRoot, environment)
  const provider: DebugProviderIdValue = manifest.providerId

  const bytes = await environment.fetchBytes(downloadUrl(manifest))
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== entry.sha256) {
    await environment.remove(layout.directory)
    throw new DebugError(
      `adapter "${provider}" archive checksum mismatch: expected ${entry.sha256}, got ${digest}`,
      'DEBUG_ADAPTER_CHECKSUM',
      { providerId: provider },
    )
  }

  await environment.write(layout.archiveFile, bytes)
  const selfTest = await environment.runSelfTest([layout.executableFile, '--version'])
  if (selfTest.exitCode !== 0) {
    await environment.remove(layout.directory)
    throw new DebugError(
      `adapter "${provider}" self-test failed with exit code ${selfTest.exitCode}`,
      'DEBUG_ADAPTER_UNSUPPORTED',
      { providerId: provider, detail: selfTest.stderr ?? selfTest.stdout ?? 'no self-test output' },
    )
  }
  return layout
}
