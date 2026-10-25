/**
 * Managed adapter installation: archive sources download in the target
 * execution world, verify the archive SHA-256 before anything is written,
 * write under the platform's install directory, self-test, and roll the whole
 * directory back on any failure; pypi sources select the platform wheel from
 * PyPI metadata, verify its official digest, and install into an isolated
 * venv owned by the target interpreter. The checksum is never optional.
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

/** The download URL of an archive source; pypi sources never reach this path. */
function downloadUrl(manifest: DebugAdapterManifest): string {
  if (manifest.source.kind === 'archive') return manifest.source.url
  throw new DebugError(
    `adapter "${manifest.providerId}" is a pypi source and installs through the venv flow`,
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

/** The execution-world I/O a pypi (venv) install needs. */
export interface DebugPypiInstallEnvironment {
  /** Path separator of the target execution world. */
  readonly pathSeparator: '/' | '\\'
  /** Fetch one JSON document (the PyPI version metadata). */
  fetchJson(url: string): Promise<unknown>
  /** Download one file's bytes (the selected wheel). */
  fetchBytes(url: string): Promise<Uint8Array>
  /** Atomically write one file in the target world. */
  write(path: string, bytes: Uint8Array): Promise<void>
  /** Remove one directory tree in the target world. */
  remove(path: string): Promise<void>
  /** Run one python invocation in the target world. */
  runPython(python: string, args: readonly string[]): Promise<{ exitCode: number; stdout?: string; stderr?: string }>
}

/** One pypi (venv) install request. */
export interface DebugPypiInstallRequest {
  readonly manifest: DebugAdapterManifest
  /** OS-arch key of the target world, e.g. `linux-x64`. */
  readonly platform: DebugAdapterPlatformKey
  /** Target interpreter that owns the venv. */
  readonly python: string
  /** Target interpreter ABI tag, e.g. `cp312`. */
  readonly pythonTag: string
  readonly installRoot: string
  readonly environment: DebugPypiInstallEnvironment
}

/** Where one pypi adapter version lives. */
export interface DebugPypiInstallLayout {
  /** The version directory; removal rolls the install back. */
  readonly directory: string
  /** The venv's interpreter, also the resolved executable. */
  readonly venvPython: string
  /** The verified wheel cached before pip install. */
  readonly wheelFile: string
}

/** One wheel candidate from the PyPI metadata. */
interface WheelCandidate {
  readonly filename: string
  readonly url: string
  readonly sha256: string
}

/** The default PyPI index; deployments override through the owning service's config. */
export const DEFAULT_PYPI_INDEX = 'https://pypi.org/pypi'

/** Wheel filename fragments each OS-arch key requires. */
const WHEEL_PLATFORM_FRAGMENTS: Readonly<Record<string, readonly string[]>> = {
  'linux-x64': ['manylinux', 'x86_64'],
  'linux-arm64': ['manylinux', 'aarch64'],
  'darwin-x64': ['macosx', 'x86_64'],
  'darwin-arm64': ['macosx', 'universal2'],
  'win32-x64': ['win_amd64'],
}

/**
 * Resolve the install layout for one pypi manifest.
 * @param manifest - the validated pypi manifest.
 * @param installRoot - the target world's install root.
 * @param environment - the target world's I/O, for its path separator.
 * @returns the version directory and venv interpreter.
 */
export function pypiInstallLayout(
  manifest: DebugAdapterManifest,
  installRoot: string,
  environment: Pick<DebugPypiInstallEnvironment, 'pathSeparator'>,
): Omit<DebugPypiInstallLayout, 'wheelFile'> {
  const separator = environment.pathSeparator
  const directory = [installRoot, manifest.providerId, manifest.version].join(separator)
  return {
    directory,
    venvPython: [directory, 'venv', 'bin', 'python'].join(separator),
  }
}

/**
 * Select the wheel matching the python tag and platform from PyPI metadata.
 * @param metadata - the parsed `/pypi/<package>/<version>/json` document.
 * @param platform - OS-arch key of the target world.
 * @param pythonTag - ABI tag of the target interpreter.
 * @returns the matching wheel candidate.
 * @throws {@link DebugError} `DEBUG_ADAPTER_UNSUPPORTED` when the metadata is
 * malformed or no wheel matches.
 */
function selectWheel(metadata: unknown, platform: DebugAdapterPlatformKey, pythonTag: string): WheelCandidate {
  const fragments = WHEEL_PLATFORM_FRAGMENTS[platform]
  if (fragments === undefined) {
    throw new DebugError(`no wheel platform mapping for ${platform}`, 'DEBUG_ADAPTER_UNSUPPORTED')
  }
  if (typeof metadata !== 'object' || metadata === null) {
    throw new DebugError('pypi metadata is not an object', 'DEBUG_ADAPTER_UNSUPPORTED')
  }
  const urls = (metadata as { urls?: unknown }).urls
  if (!Array.isArray(urls)) {
    throw new DebugError('pypi metadata carries no urls list', 'DEBUG_ADAPTER_UNSUPPORTED')
  }
  for (const entry of urls) {
    if (typeof entry !== 'object' || entry === null) continue
    const candidate = entry as { filename?: unknown; url?: unknown; digests?: { sha256?: unknown } }
    if (typeof candidate.filename !== 'string' || typeof candidate.url !== 'string') continue
    const filename = candidate.filename
    const url = candidate.url
    const sha256 = candidate.digests?.sha256
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) continue
    if (!filename.includes(pythonTag)) continue
    if (!fragments.every(fragment => filename.includes(fragment))) continue
    return { filename, url, sha256 }
  }
  throw new DebugError(`no wheel matches ${pythonTag} on ${platform}`, 'DEBUG_ADAPTER_UNSUPPORTED')
}

/**
 * Install one pypi adapter into an isolated venv in the target world: select
 * the platform wheel from PyPI metadata, verify its official digest before
 * anything is installed, create the venv with the target interpreter,
 * pip-install the verified wheel offline, and import-test the package. Any
 * failure removes the whole version directory.
 * @param request - manifest, platform, interpreter, tag, root, and target-world I/O.
 * @returns the install layout after the import test passes.
 * @throws {@link DebugError} `DEBUG_ADAPTER_UNSUPPORTED` for a non-pypi
 * manifest, an unmatched wheel, or a failing venv/pip/import step;
 * `DEBUG_ADAPTER_CHECKSUM` when the downloaded wheel does not hash to the
 * published digest.
 */
export async function installPypiAdapter(request: DebugPypiInstallRequest): Promise<DebugPypiInstallLayout> {
  const { manifest, platform, python, pythonTag, installRoot, environment } = request
  if (manifest.source.kind !== 'pypi') {
    throw new DebugError(`adapter "${manifest.providerId}" is not a pypi source`, 'DEBUG_ADAPTER_UNSUPPORTED', { providerId: manifest.providerId })
  }
  const layout = pypiInstallLayout(manifest, installRoot, environment)
  const separator = environment.pathSeparator

  const metadata = await environment.fetchJson(`${DEFAULT_PYPI_INDEX}/${manifest.source.package}/${manifest.version}/json`)
  const wheel = selectWheel(metadata, platform, pythonTag)

  const bytes = await environment.fetchBytes(wheel.url)
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== wheel.sha256) {
    await environment.remove(layout.directory)
    throw new DebugError(
      `pypi wheel checksum mismatch for "${manifest.source.package}": expected ${wheel.sha256}, got ${digest}`,
      'DEBUG_ADAPTER_CHECKSUM',
      { providerId: manifest.providerId },
    )
  }

  const installedWheelFile = [layout.directory, 'cache', wheel.filename].join(separator)
  await environment.write(installedWheelFile, bytes)

  const venv = await environment.runPython(python, ['-m', 'venv', [layout.directory, 'venv'].join(separator)])
  if (venv.exitCode !== 0) {
    await environment.remove(layout.directory)
    throw new DebugError(
      `creating the venv for "${manifest.providerId}" failed with exit code ${venv.exitCode}`,
      'DEBUG_ADAPTER_UNSUPPORTED',
      { providerId: manifest.providerId, detail: venv.stderr ?? 'no venv stderr' },
    )
  }

  const pip = await environment.runPython(layout.venvPython, ['-m', 'pip', 'install', '--no-index', '--no-deps', installedWheelFile])
  if (pip.exitCode !== 0) {
    await environment.remove(layout.directory)
    throw new DebugError(
      `pip install for "${manifest.providerId}" failed with exit code ${pip.exitCode}`,
      'DEBUG_ADAPTER_UNSUPPORTED',
      { providerId: manifest.providerId, detail: pip.stderr ?? 'no pip stderr' },
    )
  }

  const importTest = await environment.runPython(layout.venvPython, ['-c', `import ${manifest.source.package}`])
  if (importTest.exitCode !== 0) {
    await environment.remove(layout.directory)
    throw new DebugError(
      `adapter "${manifest.providerId}" import test failed with exit code ${importTest.exitCode}`,
      'DEBUG_ADAPTER_UNSUPPORTED',
      { providerId: manifest.providerId, detail: importTest.stderr ?? 'no import stderr' },
    )
  }
  return { ...layout, wheelFile: installedWheelFile }
}
