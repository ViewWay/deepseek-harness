import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { DesktopAdapterCacheEntry, DesktopAdapterCacheEnvironment } from '../src/debug/adapter-cache.ts'
import { DesktopAdapterCache, DesktopAdapterChecksumError } from '../src/debug/adapter-cache.ts'

/** In-memory file table with real SHA-256 digests, standing in for shell file access. */
function fakeEnvironment() {
  const files = new Map<string, Uint8Array>()
  const environment: DesktopAdapterCacheEnvironment = {
    exists: async path => files.has(path),
    sha256: async (path) => {
      const bytes = files.get(path)
      if (bytes === undefined) throw new Error(`missing file: ${path}`)
      return createHash('sha256').update(bytes).digest('hex')
    },
    write: async (path, bytes) => { files.set(path, bytes) },
  }
  return { files, environment }
}

const entry: DesktopAdapterCacheEntry = {
  providerId: 'node', version: '1.2.3', platform: 'darwin-arm64', archive: 'js-debug.tar.gz',
  sha256: createHash('sha256').update(new Uint8Array([1, 2, 3])).digest('hex'),
}

describe('desktop adapter cache', () => {
  it('reuses an offline archive only when its digest matches', async () => {
    const { environment } = fakeEnvironment()
    const cache = new DesktopAdapterCache('/adapters', environment)
    await expect(cache.find(entry)).resolves.toBeNull()
    await environment.write('/adapters/node/1.2.3/darwin-arm64/js-debug.tar.gz', new Uint8Array([9, 9]))
    await expect(cache.find(entry)).resolves.toBeNull()
    await environment.write('/adapters/node/1.2.3/darwin-arm64/js-debug.tar.gz', new Uint8Array([1, 2, 3]))
    await expect(cache.find(entry)).resolves.toBe('/adapters/node/1.2.3/darwin-arm64/js-debug.tar.gz')
  })

  it('stores verified bytes under the adapter manager install layout', async () => {
    const { files, environment } = fakeEnvironment()
    const cache = new DesktopAdapterCache('/adapters', environment)
    await expect(cache.store(entry, new Uint8Array([1, 2, 3])))
      .resolves.toBe('/adapters/node/1.2.3/darwin-arm64/js-debug.tar.gz')
    expect([...files.keys()]).toEqual(['/adapters/node/1.2.3/darwin-arm64/js-debug.tar.gz'])
  })

  it('never stores bytes that fail the manifest digest', async () => {
    const { files, environment } = fakeEnvironment()
    const cache = new DesktopAdapterCache('/adapters', environment)
    const failure = await cache.store(entry, new Uint8Array([4, 5])).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DesktopAdapterChecksumError)
    expect(failure).toMatchObject({ code: 'DEBUG_ADAPTER_CHECKSUM' })
    expect(files.size).toBe(0)
  })
})
