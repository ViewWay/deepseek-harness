/**
 * Managed adapter install: download in the execution world, verify the
 * checksum, write under the platform install path, self-test, and roll back
 * partial output on any failure.
 */

import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { DebugProviderId } from '@deepseek-ai/dsh-debug'
import type { DebugAdapterInstallEnvironment, DebugPypiInstallEnvironment } from '../src/install.ts'
import { installAdapter, installPypiAdapter } from '../src/install.ts'
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

/** One pypi install-environment double: the contract plus observable mocks. */
type PypiEnvironmentDouble = DebugPypiInstallEnvironment & {
  fetchJson: Mock<(url: string) => Promise<unknown>>
  fetchBytes: Mock<(url: string) => Promise<Uint8Array>>
  write: Mock<(path: string, bytes: Uint8Array) => Promise<void>>
  remove: Mock<(path: string) => Promise<void>>
  runPython: Mock<(python: string, args: readonly string[]) => Promise<{ exitCode: number; stdout?: string; stderr?: string }>>
}

describe('managed pypi adapter install', () => {
  const wheelBytes = new Uint8Array([9, 9, 9])
  const wheelSha = sha256Hex(wheelBytes)

  function pypiMetadata(): unknown {
    return {
      urls: [
        { filename: 'debugpy-1.8.22-cp312-cp312-win_amd64.whl', url: 'https://files.example/debugpy-win.whl', digests: { sha256: wheelSha }, size: 100 },
        { filename: 'debugpy-1.8.22-cp312-cp312-manylinux_2_34_x86_64.whl', url: 'https://files.example/debugpy-linux.whl', digests: { sha256: wheelSha }, size: 3 },
        { filename: 'debugpy-1.8.22-cp312-cp312-macosx_15_0_universal2.whl', url: 'https://files.example/debugpy-mac.whl', digests: { sha256: wheelSha }, size: 50 },
      ],
    }
  }

  function pypiManifest(): DebugAdapterManifest {
    return {
      providerId: DebugProviderId('python'),
      version: '1.8.22',
      license: 'MIT',
      source: { kind: 'pypi', package: 'debugpy' },
      command: ['python', '-m', 'debugpy.adapter'],
    }
  }

  function pypiEnvironment(overrides: Partial<PypiEnvironmentDouble> = {}): PypiEnvironmentDouble {
    return {
      pathSeparator: '/',
      fetchJson: vi.fn(async () => pypiMetadata()),
      fetchBytes: vi.fn(async () => wheelBytes),
      write: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      runPython: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
      ...overrides,
    }
  }

  function pypiRequest(environment: DebugPypiInstallEnvironment, platform = 'linux-x64') {
    return {
      manifest: pypiManifest(),
      platform,
      python: '/usr/bin/python3',
      pythonTag: 'cp312',
      installRoot: '/adapters',
      environment,
    }
  }

  it('selects the platform wheel, verifies its digest, creates a venv, and pip-installs the local wheel', async () => {
    const environment = pypiEnvironment()
    await installPypiAdapter(pypiRequest(environment))
    expect(environment.fetchBytes).toHaveBeenCalledWith('https://files.example/debugpy-linux.whl')
    expect(environment.write).toHaveBeenCalledWith(
      '/adapters/python/1.8.22/cache/debugpy-1.8.22-cp312-cp312-manylinux_2_34_x86_64.whl',
      wheelBytes,
    )
    expect(environment.runPython).toHaveBeenCalledWith('/usr/bin/python3', ['-m', 'venv', '/adapters/python/1.8.22/venv'])
    expect(environment.runPython).toHaveBeenCalledWith('/adapters/python/1.8.22/venv/bin/python', [
      '-m', 'pip', 'install', '--no-index', '--no-deps',
      '/adapters/python/1.8.22/cache/debugpy-1.8.22-cp312-cp312-manylinux_2_34_x86_64.whl',
    ])
    expect(environment.runPython).toHaveBeenCalledWith('/adapters/python/1.8.22/venv/bin/python', ['-c', 'import debugpy'])
  })

  it('selects arm64 and windows wheels for their platforms', async () => {
    const macEnvironment = pypiEnvironment()
    await installPypiAdapter(pypiRequest(macEnvironment, 'darwin-arm64'))
    expect(macEnvironment.fetchBytes).toHaveBeenCalledWith('https://files.example/debugpy-mac.whl')
    const winEnvironment = pypiEnvironment()
    await installPypiAdapter({ ...pypiRequest(winEnvironment, 'win32-x64'), environment: { ...winEnvironment, pathSeparator: '\\' } })
    expect(winEnvironment.fetchBytes).toHaveBeenCalledWith('https://files.example/debugpy-win.whl')
  })

  it('fails unsupported when no wheel matches the platform', async () => {
    await expect(installPypiAdapter(pypiRequest(pypiEnvironment(), 'linux-arm64')))
      .rejects.toMatchObject({ code: 'DEBUG_ADAPTER_UNSUPPORTED' })
  })

  it('removes the partial install when the wheel digest mismatches', async () => {
    const environment = pypiEnvironment()
    environment.fetchBytes = vi.fn(async () => new Uint8Array([1]))
    await expect(installPypiAdapter(pypiRequest(environment))).rejects.toMatchObject({ code: 'DEBUG_ADAPTER_CHECKSUM' })
    expect(environment.remove).toHaveBeenCalledWith('/adapters/python/1.8.22')
  })

  it('removes the partial install when the venv step fails', async () => {
    const environment = pypiEnvironment({
      runPython: vi.fn(async (_python: string, args: readonly string[]) => ({ exitCode: args.includes('venv') ? 1 : 0, stdout: '', stderr: 'no venv support' })),
    })
    await expect(installPypiAdapter(pypiRequest(environment))).rejects.toMatchObject({ code: 'DEBUG_ADAPTER_UNSUPPORTED' })
    expect(environment.remove).toHaveBeenCalledWith('/adapters/python/1.8.22')
  })
})
