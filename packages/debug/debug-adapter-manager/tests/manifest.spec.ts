/**
 * Adapter-manifest parsing: complete platform entries validate, unpublished
 * platforms stay absent instead of emulated, and malformed checksums fail
 * with the manifest's typed checksum code.
 */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseAdapterManifest, resolveAdapterPlatform } from '../src/manifest.ts'

/** Hash one byte payload the way the installer verifies archives. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const archiveBytes = new Uint8Array([1, 2, 3])
const manifest = {
  providerId: 'node',
  version: '1.0.0',
  license: 'MIT',
  source: { kind: 'archive', url: 'https://example.invalid/node.tgz' },
  platforms: {
    'linux-x64': { archive: 'node.tgz', sha256: sha256Hex(archiveBytes), executable: 'bin/node', sizeBytes: 10 },
  },
  command: ['bin/node', 'adapter.js'],
}

describe('adapter manifest', () => {
  it('accepts a complete platform entry', () => {
    expect(parseAdapterManifest(manifest).providerId).toBe('node')
    expect(parseAdapterManifest(manifest).platforms?.['linux-x64']).toMatchObject({
      archive: 'node.tgz',
      executable: 'bin/node',
      sizeBytes: 10,
    })
  })

  it('omits platforms that are not published instead of emulating them', () => {
    expect(parseAdapterManifest(manifest).platforms?.['win32-x64']).toBeUndefined()
    expect(() => resolveAdapterPlatform(parseAdapterManifest(manifest), 'win32-x64'))
      .toThrow(expect.objectContaining({ code: 'DEBUG_ADAPTER_UNSUPPORTED' }))
  })

  it('rejects a malformed checksum', () => {
    expect(() => parseAdapterManifest({ ...manifest, platforms: {
      'linux-x64': { ...manifest.platforms['linux-x64'], sha256: 'nope' },
    } })).toThrow(expect.objectContaining({ code: 'DEBUG_ADAPTER_CHECKSUM' }))
  })

  it('rejects floating versions, empty commands, and unknown top-level fields', () => {
    expect(() => parseAdapterManifest({ ...manifest, version: 'latest' }))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    expect(() => parseAdapterManifest({ ...manifest, command: [] }))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    expect(() => parseAdapterManifest({ ...manifest, extra: true }))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })
})

describe('adapter manifest pypi sources', () => {
  const pypiManifest = {
    providerId: 'python',
    version: '1.8.22',
    license: 'MIT',
    source: { kind: 'pypi', package: 'debugpy' },
    command: ['python', '-m', 'debugpy.adapter'],
  }

  it('accepts a pypi source without platforms', () => {
    const manifest = parseAdapterManifest(pypiManifest)
    expect(manifest.source).toEqual({ kind: 'pypi', package: 'debugpy' })
    expect(manifest.platforms).toBeUndefined()
    expect(manifest.command).toEqual(['python', '-m', 'debugpy.adapter'])
  })

  it('rejects retired npm and system kinds', () => {
    expect(() => parseAdapterManifest({ ...pypiManifest, source: { kind: 'npm', url: 'https://x', package: 'p' } }))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    expect(() => parseAdapterManifest({ ...pypiManifest, source: { kind: 'system' } }))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })

  it('rejects pypi sources with platforms, a missing package, or a non-python command', () => {
    expect(() => parseAdapterManifest({ ...pypiManifest, platforms: {
      'linux-x64': { archive: 'a.whl', sha256: 'a'.repeat(64), executable: 'bin/x', sizeBytes: 1 },
    } })).toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    expect(() => parseAdapterManifest({ ...pypiManifest, source: { kind: 'pypi' } }))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    expect(() => parseAdapterManifest({ ...pypiManifest, command: ['node', 'x.js'] }))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })
})
