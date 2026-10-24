/**
 * The provider registry on `ctx.debug`: id and extension reservations commit
 * atomically after full validation, conflicts are typed failures, and the
 * disposer releases every reservation together.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Debug, { DebugProviderId, type DebugProvider } from '@deepseek-ai/dsh-debug'

function provider(id: string, extensions: string[]): DebugProvider {
  return {
    id: DebugProviderId(id),
    displayName: id,
    extensions,
    adapter: { kind: 'managed' },
    configSchema: { type: 'object' },
    resolveLaunch: async () => { throw new Error('not used') },
    resolveAttach: async () => { throw new Error('not used') },
  }
}

async function mount(): Promise<Debug> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(Debug)
  return ctx.debug
}

describe('Debug provider registry', () => {
  it('reserves provider ids and extensions atomically, then releases them', async () => {
    const debug = await mount()
    const dispose = debug.registerProvider(provider('node', ['.ts', '.js']))

    expect(() => debug.registerProvider(provider('node', ['.mjs'])))
      .toThrow(expect.objectContaining({ code: 'DEBUG_CONFLICT' }))
    expect(() => debug.registerProvider(provider('python', ['.ts'])))
      .toThrow(expect.objectContaining({ code: 'DEBUG_CONFLICT' }))

    dispose()
    expect(() => debug.registerProvider(provider('node', ['.mjs']))).not.toThrow()
  })

  it('rejects empty ids, duplicate extensions, and empty extension lists', async () => {
    const debug = await mount()
    expect(() => debug.registerProvider(provider('  ', ['.ts'])))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_PROVIDER' }))
    expect(() => debug.registerProvider(provider('node', ['.ts', '.TS'])))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_PROVIDER' }))
    expect(() => debug.registerProvider(provider('node', [])))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_PROVIDER' }))
    expect(() => debug.registerProvider(provider('node', ['ok.ts', ''])))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_PROVIDER' }))
  })

  it('lists registered providers and resolves one by id until disposal', async () => {
    const debug = await mount()
    const node = provider('node', ['.ts'])
    const dispose = debug.registerProvider(node)

    expect(debug.providers()).toHaveLength(1)
    expect(debug.providers()[0]?.id).toBe(node.id)
    expect(debug.provider(node.id)).toBe(node)
    expect(debug.provider(DebugProviderId('python'))).toBeUndefined()

    dispose()
    expect(debug.providers()).toHaveLength(0)
    expect(debug.provider(node.id)).toBeUndefined()
  })
})
