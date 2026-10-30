import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { fixtureDebugSessionId } from '@deepseek-ai/dsh-debug-fixture'
import Debug from '@deepseek-ai/dsh-debug/src/index.ts'
import { fakeBackend } from './helpers/fake-backend.ts'

async function mount(): Promise<InstanceType<typeof Debug>> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(Debug)
  return ctx.debug
}

describe('debug service backend registry', () => {
  it('registers, resolves, and releases per session', async () => {
    const debug = await mount()
    const id = fixtureDebugSessionId(9)
    const backend = fakeBackend()
    const dispose = debug.registerBackend(id, backend)
    expect(debug.backendOf(id)).toBe(backend)
    dispose()
    expect(debug.backendOf(id)).toBeUndefined()
  })

  it('keeps the latest registration and ignores a stale disposer', async () => {
    const debug = await mount()
    const id = fixtureDebugSessionId(10)
    const first = fakeBackend()
    const second = fakeBackend()
    const disposeFirst = debug.registerBackend(id, first)
    debug.registerBackend(id, second)
    disposeFirst()
    expect(debug.backendOf(id)).toBe(second)
  })
})
