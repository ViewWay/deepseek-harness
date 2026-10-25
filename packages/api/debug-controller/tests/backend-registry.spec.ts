import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { fixtureDebugSessionId } from '@deepseek-ai/dsh-debug-fixture'
import Debug from '@deepseek-ai/dsh-debug/src/index.ts'

interface Handle { readonly tag: string }

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
    const handle: Handle = { tag: 'backend' }
    const dispose = debug.registerBackend(id, handle)
    expect(debug.backendOf<Handle>(id)).toBe(handle)
    dispose()
    expect(debug.backendOf<Handle>(id)).toBeUndefined()
  })

  it('keeps the latest registration and ignores a stale disposer', async () => {
    const debug = await mount()
    const id = fixtureDebugSessionId(10)
    const disposeFirst = debug.registerBackend(id, { tag: 'first' })
    debug.registerBackend(id, { tag: 'second' })
    disposeFirst()
    expect(debug.backendOf<Handle>(id)).toMatchObject({ tag: 'second' })
  })
})
