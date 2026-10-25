/**
 * The `ctx.debugAdapters` service: manifest registration, concurrent-install
 * sharing, override-free resolution, uninstall, and committed lifecycle
 * events.
 */

import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DebugProviderId } from '@deepseek-ai/dsh-debug'
import type { DebugAdapterEvent, DebugAdapterInstallEnvironment } from '@deepseek-ai/dsh-debug-adapter-manager'
import DebugAdapterManager from '@deepseek-ai/dsh-debug-adapter-manager'

/** Hash one byte payload the way the installer verifies archives. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const archiveBytes = new Uint8Array([1, 2, 3])

/** Build one raw manifest record for the tests. */
function manifestRecord(): Record<string, unknown> {
  return {
    providerId: 'node',
    version: '1.0.0',
    license: 'MIT',
    source: { kind: 'archive', url: 'https://example.invalid/node.tgz' },
    platforms: {
      'linux-x64': { archive: 'node.tgz', sha256: sha256Hex(archiveBytes), executable: 'bin/node', sizeBytes: 3 },
    },
    command: ['bin/node', 'adapter.js'],
  }
}

/** Build one install-environment double with an observable installed file set. */
function installEnvironment(): DebugAdapterInstallEnvironment & {
  fetchBytes: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  exists: ReturnType<typeof vi.fn>
  runSelfTest: ReturnType<typeof vi.fn>
  /** Files reported present; tests simulate extraction by adding executables. */
  written: Set<string>
} {
  const written = new Set<string>()
  return {
    written,
    pathSeparator: '/',
    fetchBytes: vi.fn(async () => archiveBytes),
    write: vi.fn(async (path: string) => {
      written.add(path)
    }),
    remove: vi.fn(async (path: string) => {
      for (const key of [...written]) {
        if (key.startsWith(path)) written.delete(key)
      }
    }),
    exists: vi.fn(async (path: string) => written.has(path)),
    runSelfTest: vi.fn(async () => ({ exitCode: 0, stdout: 'v1.0.0', stderr: '' })),
  }
}

async function mount(): Promise<DebugAdapterManager> {
  const ctx = new Context()
  await ctx.plugin(DebugAdapterManager)
  return ctx.debugAdapters
}

describe('DebugAdapterManager', () => {
  it('registers manifests, lists them, and releases on disposal', async () => {
    const manager = await mount()
    const dispose = manager.registerManifest(manifestRecord())
    expect(manager.list()).toMatchObject([{ providerId: 'node', version: '1.0.0', platforms: ['linux-x64'] }])
    dispose()
    expect(manager.list()).toEqual([])
  })

  it('rejects a duplicate manifest with a typed conflict', async () => {
    const manager = await mount()
    manager.registerManifest(manifestRecord())
    expect(() => manager.registerManifest(manifestRecord()))
      .toThrow(expect.objectContaining({ code: 'DEBUG_CONFLICT' }))
  })

  it('shares one operation between concurrent installs of the same platform', async () => {
    const manager = await mount()
    manager.registerManifest(manifestRecord())
    const environment = installEnvironment()
    const call = { platform: 'linux-x64', installRoot: '/adapters', environment }
    await Promise.all([manager.install(DebugProviderId('node'), call), manager.install(DebugProviderId('node'), call)])
    expect(environment.fetchBytes).toHaveBeenCalledOnce()
  })

  it('resolves installed adapters without host fallback', async () => {
    const manager = await mount()
    manager.registerManifest(manifestRecord())
    const environment = installEnvironment()
    await manager.install(DebugProviderId('node'), { platform: 'linux-x64', installRoot: '/adapters', environment })
    // Extraction is the environment bridge's job; simulate it for resolution.
    environment.written.add('/adapters/node/1.0.0/linux-x64/bin/node')
    const resolved = await manager.resolve(DebugProviderId('node'), {
      platform: 'linux-x64',
      installRoot: '/adapters',
      environment,
    })
    expect(resolved).toMatchObject({
      command: ['/adapters/node/1.0.0/linux-x64/bin/node', 'adapter.js'],
      version: '1.0.0',
      platform: 'linux-x64',
      source: 'managed',
    })
  })

  it('fails resolution typed for unknown manifests, unpublished platforms, and absent installs', async () => {
    const manager = await mount()
    const environment = installEnvironment()
    await expect(manager.resolve(DebugProviderId('node'), {
      platform: 'linux-x64', installRoot: '/adapters', environment,
    })).rejects.toMatchObject({ code: 'DEBUG_ADAPTER_NOT_FOUND' })

    manager.registerManifest(manifestRecord())
    await expect(manager.resolve(DebugProviderId('node'), {
      platform: 'win32-x64', installRoot: '/adapters', environment,
    })).rejects.toMatchObject({ code: 'DEBUG_ADAPTER_UNSUPPORTED' })
    await expect(manager.resolve(DebugProviderId('node'), {
      platform: 'linux-x64', installRoot: '/adapters', environment,
    })).rejects.toMatchObject({ code: 'DEBUG_ADAPTER_NOT_FOUND' })
  })

  it('publishes committed lifecycle events and contains listener failures', async () => {
    const manager = await mount()
    manager.registerManifest(manifestRecord())
    const environment = installEnvironment()
    const seen: DebugEventKind[] = []
    manager.events.subscribe(event => seen.push(event.kind))
    manager.events.subscribe(() => {
      throw new Error('listener failure is contained')
    })
    await manager.install(DebugProviderId('node'), { platform: 'linux-x64', installRoot: '/adapters', environment })
    await manager.uninstall(DebugProviderId('node'), { platform: 'linux-x64', installRoot: '/adapters', environment })
    expect(seen).toEqual(['adapter/installed', 'adapter/uninstalled'])
  })

  it('publishes install-failed with the failing code', async () => {
    const manager = await mount()
    manager.registerManifest(manifestRecord())
    const environment = installEnvironment()
    const failed: DebugAdapterEvent[] = []
    manager.events.subscribe(event => failed.push(event))
    await expect(manager.install(DebugProviderId('node'), {
      platform: 'linux-x64',
      installRoot: '/adapters',
      environment: { ...environment, fetchBytes: vi.fn(async () => new Uint8Array([9])) },
    })).rejects.toMatchObject({ code: 'DEBUG_ADAPTER_CHECKSUM' })
    expect(failed).toMatchObject([{ kind: 'adapter/install-failed', code: 'DEBUG_ADAPTER_CHECKSUM' }])
  })
})

type DebugEventKind = DebugAdapterEvent['kind']

describe('DebugAdapterManager pypi sources', () => {
  const wheelBytes = new Uint8Array([7, 7])
  const wheelSha = sha256Hex(wheelBytes)

  function pypiManifestRecord(): Record<string, unknown> {
    return {
      providerId: 'python',
      version: '1.8.22',
      license: 'MIT',
      source: { kind: 'pypi', package: 'debugpy' },
      command: ['python', '-m', 'debugpy.adapter'],
    }
  }

  function pypiEnvironment() {
    const written = new Set<string>()
    return {
      pathSeparator: '/' as const,
      exists: vi.fn(async (path: string) => written.has(path)),
      fetchJson: vi.fn(async () => ({
        urls: [
          { filename: 'debugpy-1.8.22-cp312-cp312-manylinux_2_34_x86_64.whl', url: 'https://files.example/debugpy-linux.whl', digests: { sha256: wheelSha }, size: 2 },
        ],
      })),
      fetchBytes: vi.fn(async () => wheelBytes),
      write: vi.fn(async (path: string) => {
        written.add(path)
      }),
      remove: vi.fn(async (path: string) => {
        for (const key of [...written]) {
          if (key.startsWith(path)) written.delete(key)
        }
      }),
      runPython: vi.fn(async (python: string) => {
        written.add(python)
        return { exitCode: 0, stdout: '', stderr: '' }
      }),
      written,
    }
  }

  it('installs into a venv, resolves the venv interpreter, and uninstalls the version directory', async () => {
    const manager = await mount()
    manager.registerManifest(pypiManifestRecord())
    const environment = pypiEnvironment()
    await manager.install(DebugProviderId('python'), {
      platform: 'linux-x64',
      installRoot: '/adapters',
      environment,
      python: '/usr/bin/python3',
      pythonTag: 'cp312',
    })
    expect(environment.runPython).toHaveBeenCalledWith('/usr/bin/python3', ['-m', 'venv', '/adapters/python/1.8.22/venv'])

    const resolved = await manager.resolve(DebugProviderId('python'), {
      platform: 'linux-x64',
      installRoot: '/adapters',
      environment,
    })
    expect(resolved).toMatchObject({
      command: ['/adapters/python/1.8.22/venv/bin/python', '-m', 'debugpy.adapter'],
      executablePath: '/adapters/python/1.8.22/venv/bin/python',
      version: '1.8.22',
      source: 'managed',
    })

    await manager.uninstall(DebugProviderId('python'), {
      platform: 'linux-x64',
      installRoot: '/adapters',
      environment,
    })
    await expect(manager.resolve(DebugProviderId('python'), {
      platform: 'linux-x64',
      installRoot: '/adapters',
      environment,
    })).rejects.toMatchObject({ code: 'DEBUG_ADAPTER_NOT_FOUND' })
  })

  it('rejects a pypi install without interpreter facts', async () => {
    const manager = await mount()
    manager.registerManifest(pypiManifestRecord())
    await expect(manager.install(DebugProviderId('python'), {
      platform: 'linux-x64',
      installRoot: '/adapters',
      environment: pypiEnvironment(),
    })).rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
  })
})
