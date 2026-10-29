/**
 * Adapter-manifest validation and platform resolution. Manifests are repo
 * data crossing a file boundary, so every field is validated here; platforms
 * that were never published stay absent — resolution rejects them instead of
 * emulating compatibility. Versions are pinned; `latest` never validates.
 * @module @deepseek-ai/dsh-debug-adapter-manager/manifest
 */

import { configInvalidFactory, DebugError, DebugProviderId, optionalStringRecord, recordOf } from '@deepseek-ai/dsh-debug'
import type { DebugExecutionCapability, DebugProviderId as DebugProviderIdValue } from '@deepseek-ai/dsh-debug'

/** One published platform combination, e.g. `linux-x64`. */
export type DebugAdapterPlatformKey = string

/** Where an adapter comes from: a release archive download, or a PyPI package installed into a venv. */
export type DebugAdapterSource =
  | { readonly kind: 'archive'; readonly url: string }
  | { readonly kind: 'pypi'; readonly package: string; readonly subpath?: string }

/** One platform's downloadable entry. */
export interface DebugAdapterPlatformEntry {
  /** Archive file name inside the source. */
  readonly archive: string
  /** SHA-256 of the archive bytes, 64 lowercase hex digits. */
  readonly sha256: string
  /** Executable path inside the install directory. */
  readonly executable: string
  /** Archive size in bytes. */
  readonly sizeBytes: number
  /** Required system package names, for install-time reporting. */
  readonly dependencies?: readonly string[]
}

/** A validated adapter manifest: identity, source, per-platform downloads (archive sources), and argv template. */
export interface DebugAdapterManifest {
  readonly providerId: DebugProviderIdValue
  readonly version: string
  readonly license: string
  readonly source: DebugAdapterSource
  /** Present with at least one entry for archive sources; omitted for pypi sources. */
  readonly platforms?: Readonly<Record<DebugAdapterPlatformKey, DebugAdapterPlatformEntry>>
  readonly command: readonly string[]
  readonly environment?: Readonly<Record<string, string>>
  readonly requires?: readonly DebugExecutionCapability[]
}

/** Every capability a manifest may require. */
const CAPABILITIES: readonly DebugExecutionCapability[] = ['ptrace', 'processControl', 'networkListen', 'python', 'go']

/** Manifest field names accepted at the top level; anything else fails loud. */
const TOP_LEVEL_KEYS = new Set(['providerId', 'version', 'license', 'source', 'platforms', 'command', 'environment', 'requires'])

/** Validate-and-fail helper carrying the manifest's config code. */
const invalid = configInvalidFactory('adapter manifest')

/** Read one required non-empty string field. */
function requiredString(record: Record<string, unknown>, key: string, label: string = key): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(`${label} must be a non-empty string`)
  }
  return value
}

/** Read one optional array-of-strings field, validated element by element. */
function parseStringArray(record: Record<string, unknown>, field: string, label: string): readonly string[] | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw invalid(`${label} must be an array of strings`)
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') throw invalid(`${label} must be an array of strings`)
    result.push(item)
  }
  return result
}

/** Validate one source descriptor. */
function parseSource(value: unknown): DebugAdapterSource {
  const record = recordOf(value, 'source', invalid)
  const kind = record['kind']
  if (kind === 'archive') {
    return { kind, url: requiredString(record, 'url', 'source.url') }
  }
  if (kind === 'pypi') {
    const subpath = record['subpath']
    if (subpath !== undefined && typeof subpath !== 'string') throw invalid('source.subpath must be a string')
    return {
      kind,
      package: requiredString(record, 'package', 'source.package'),
      ...(subpath !== undefined ? { subpath } : {}),
    }
  }
  throw invalid('source.kind must be archive or pypi')
}

/** Validate one platform entry including its checksum format. */
function parsePlatformEntry(provider: string, key: string, value: unknown): DebugAdapterPlatformEntry {
  const record = recordOf(value, `platforms.${key}`, invalid)
  const archive = requiredString(record, 'archive', `platforms.${key}.archive`)
  if (archive.includes('/')) throw invalid(`platforms.${key}.archive must be a file name`)
  const sha256 = requiredString(record, 'sha256', `platforms.${key}.sha256`)
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new DebugError(
      `adapter manifest for "${provider}": platforms.${key}.sha256 must be 64 lowercase hex digits`,
      'DEBUG_ADAPTER_CHECKSUM',
      { providerId: DebugProviderId(provider) },
    )
  }
  const executable = requiredString(record, 'executable', `platforms.${key}.executable`)
  if (executable.startsWith('/') || executable.includes('..')) {
    throw invalid(`platforms.${key}.executable must be a path inside the install directory`)
  }
  const sizeBytes = record['sizeBytes']
  if (typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw invalid(`platforms.${key}.sizeBytes must be a positive safe integer`)
  }
  const dependencies: readonly string[] | undefined = parseStringArray(record, 'dependencies', `platforms.${key}.dependencies`)
  return {
    archive,
    sha256,
    executable,
    sizeBytes,
    ...(dependencies !== undefined ? { dependencies } : {}),
  }
}

/**
 * Validate one adapter manifest value.
 * @param value - the raw manifest, as read from its data file.
 * @returns the validated manifest with a branded provider id.
 * @throws {@link DebugError} `DEBUG_ADAPTER_CHECKSUM` for a malformed SHA-256;
 * `DEBUG_INVALID_CONFIG` for every other malformed field.
 */
export function parseAdapterManifest(value: unknown): DebugAdapterManifest {
  const record = recordOf(value, 'manifest', invalid)
  for (const key of Object.keys(record)) {
    if (!TOP_LEVEL_KEYS.has(key)) throw invalid(`unknown field "${key}"`)
  }
  const providerId = requiredString(record, 'providerId')
  const version = requiredString(record, 'version')
  if (version === 'latest') throw invalid('version must be pinned, not "latest"')
  const license = requiredString(record, 'license')
  const source = parseSource(record['source'])

  // Archive sources publish per-platform downloads; pypi sources resolve
  // wheels against the target interpreter and must not carry platforms.
  let platforms: Record<DebugAdapterPlatformKey, DebugAdapterPlatformEntry> | undefined
  if (source.kind === 'archive') {
    const rawPlatforms = recordOf(record['platforms'], 'platforms', invalid)
    const platformKeys = Object.keys(rawPlatforms)
    if (platformKeys.length === 0) throw invalid('platforms must list at least one platform')
    platforms = {}
    for (const key of platformKeys) {
      if (!/^[a-z0-9]+-[a-z0-9]+$/.test(key)) throw invalid(`platform key "${key}" must be <platform>-<arch>`)
      platforms[key] = parsePlatformEntry(providerId, key, rawPlatforms[key])
    }
  } else if (record['platforms'] !== undefined) {
    throw invalid('pypi sources omit platforms; wheels resolve against the target interpreter')
  }

  const command = parseStringArray(record, 'command', 'command')
  if (command === undefined || command.length === 0) {
    throw invalid('command must be a non-empty array of strings')
  }
  if (source.kind === 'pypi' && command[0] !== 'python') {
    throw invalid('pypi sources template their command on the venv interpreter: command[0] must be "python"')
  }

  const rawRequires = record['requires']
  let requires: readonly DebugExecutionCapability[] | undefined
  if (rawRequires !== undefined) {
    if (!Array.isArray(rawRequires)) throw invalid('requires must list known execution capabilities')
    const validated: DebugExecutionCapability[] = []
    for (const item of rawRequires) {
      const match = CAPABILITIES.find(capability => capability === item)
      if (typeof item !== 'string' || match === undefined) {
        throw invalid('requires must list known execution capabilities')
      }
      validated.push(match)
    }
    requires = validated
  }

  const environment = optionalStringRecord(record, 'environment', invalid)
  return {
    providerId: DebugProviderId(providerId),
    version,
    license,
    source,
    ...(platforms !== undefined ? { platforms } : {}),
    command,
    ...(environment !== undefined ? { environment } : {}),
    ...(requires !== undefined ? { requires } : {}),
  }
}

/**
 * Resolve one published platform entry.
 * @param manifest - the validated manifest.
 * @param platform - the requested platform key, e.g. `darwin-arm64`.
 * @returns the platform's download entry.
 * @throws {@link DebugError} `DEBUG_ADAPTER_UNSUPPORTED` when the platform was never published.
 */
export function resolveAdapterPlatform(manifest: DebugAdapterManifest, platform: DebugAdapterPlatformKey): DebugAdapterPlatformEntry {
  const entry = manifest.platforms?.[platform]
  if (entry === undefined) {
    throw new DebugError(
      `adapter "${manifest.providerId}" publishes no ${platform} build`,
      'DEBUG_ADAPTER_UNSUPPORTED',
      { providerId: manifest.providerId },
    )
  }
  return entry
}
