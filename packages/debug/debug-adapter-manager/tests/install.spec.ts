/**
 * Managed adapter install: download in the execution world, verify the
 * checksum, write under the platform install path, self-test, and roll back
 * partial output on any failure.
 */

import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { DebugProviderId } from '@deepseek-ai/dsh-debug'
import type { DebugAdapterInstallEnvironment } from '../src/install.ts'
import { installAdapter } from '../src/install.ts'
import type { DebugAdapterManifest } from '../src/manifest.ts'

/** Hash one byte payload the way the installer verifies archives. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const archiveBytes = new Uint8Array([1, 2, 3])

function manifestWithChecksum(checksum: string): DebugAdapterManifest {
  return {
    providerId: DebugProviderId('node'),
    version: '1.0.0',
    license: 'MIT',
    source: { kind: 'archive', url: 'https://example.invalid/node.tgz' },
    platforms: {
      'linux-x64': { archive: 'node.tgz', sha256: checksum, executable: 'bin/node', sizeBytes: 3 },
    },
    command: ['bin/node', 'adapter.js'],
  }
}

/** One install-environment double: the contract plus observable mocks. */
export type InstallEnvironmentDouble = DebugAdapterInstallEnvironment & {
  fetchBytes: Mock<(url: string) => Promise<Uint8Array>>
  write: Mock<(path: string, bytes: Uint8Array) => Promise<void>>
  remove: Mock<(path: string) => Promise<void>>
  exists: Mock<(path: string) => Promise<boolean>>
  runSelfTest: Mock<(command: readonly string[]) => Promise<{ exitCode: number; stdout?: string; stderr?: string }>>
}

/** Build one install environment double from observable mocks. */
function installEnvironment(overrides: Partial<InstallEnvironmentDouble> = {}): InstallEnvironmentDouble {
  return {
    pathSeparator: '/',
    fetchBytes: vi.fn(async () => archiveBytes),
    write: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    exists: vi.fn(async () => true),
    runSelfTest: vi.fn(async () => ({ exitCode: 0, stdout: 'v1.0.0', stderr: '' })),
    ...overrides,
  }
}

describe('managed adapter install', () => {
  it('downloads in the execution world, verifies the checksum, and runs a self-test', async () => {
    const environment = installEnvironment()
    await installAdapter({
      manifest: manifestWithChecksum(sha256Hex(archiveBytes)),
      platform: 'linux-x64',
      installRoot: '/adapters',
      environment,
    })
    expect(environment.fetchBytes).toHaveBeenCalledOnce()
    expect(environment.write).toHaveBeenCalledOnce()
    expect(environment.runSelfTest).toHaveBeenCalledOnce()
  })

  it('writes under the platform install path and verifies before writing', async () => {
    const environment = installEnvironment()
    await installAdapter({
      manifest: manifestWithChecksum(sha256Hex(archiveBytes)),
      platform: 'linux-x64',
      installRoot: '/adapters',
      environment,
    })
    expect(environment.fetchBytes.mock.invocationCallOrder[0]).toBeLessThan(environment.write.mock.invocationCallOrder[0]!)
    expect(environment.write).toHaveBeenCalledWith('/adapters/node/1.0.0/linux-x64/node.tgz', archiveBytes)
  })

  it('removes a partial install when the checksum fails', async () => {
    const environment = installEnvironment()
    await expect(installAdapter({
      manifest: manifestWithChecksum('b'.repeat(64)),
      platform: 'linux-x64',
      installRoot: '/adapters',
      environment,
    })).rejects.toMatchObject({ code: 'DEBUG_ADAPTER_CHECKSUM' })
    expect(environment.remove).toHaveBeenCalledWith('/adapters/node/1.0.0/linux-x64')
    expect(environment.runSelfTest).not.toHaveBeenCalled()
  })

  it('removes a partial install and fails unsupported when the self-test exits nonzero', async () => {
    const environment = installEnvironment({
      runSelfTest: vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'missing lib' })),
    })
    await expect(installAdapter({
      manifest: manifestWithChecksum(sha256Hex(archiveBytes)),
      platform: 'linux-x64',
      installRoot: '/adapters',
      environment,
    })).rejects.toMatchObject({ code: 'DEBUG_ADAPTER_UNSUPPORTED' })
    expect(environment.remove).toHaveBeenCalledWith('/adapters/node/1.0.0/linux-x64')
  })
})
