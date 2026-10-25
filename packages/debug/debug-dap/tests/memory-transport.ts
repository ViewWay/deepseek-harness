import { FakeDebugAdapterCrashError, type FakeDebugAdapter } from '@deepseek-ai/dsh-fake-debug-adapter'
import { decodeDapFrames } from '../src/frames.ts'
import type { DebugTransport } from '../src/transport.ts'

/**
 * Bridges a fake adapter to a {@link DebugTransport} at the wire level: the
 * input iterable yields the adapter's encoded frames (malformed chunks pass
 * through raw) and writes decode back into adapter messages.
 *
 * @param adapter The fake adapter to bridge.
 * @returns A transport wired to the adapter.
 */
export function createMemoryTransport(adapter: FakeDebugAdapter): DebugTransport {
  return {
    input: adapterFrames(adapter),
    async write(bytes: Uint8Array) {
      for (const message of decodeDapFrames(bytes).messages) {
        if (message.type === 'event') throw new Error('memory transport received a client-side event')
        adapter.write(message)
      }
    },
    async end() {},
  }
}

async function* adapterFrames(adapter: FakeDebugAdapter): AsyncGenerator<Uint8Array> {
  for (;;) {
    try {
      yield await adapter.readWire()
    } catch (error) {
      if (error instanceof FakeDebugAdapterCrashError) return
      throw error
    }
  }
}
