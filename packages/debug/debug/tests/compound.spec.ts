/**
 * Compound configurations: ordered child sessions, aggregated state,
 * stop-all propagation, and lifecycle completion.
 */

import { describe, expect, it } from 'vitest'
import { fixtureDebugCompoundId, fixtureDebugSessionId, fixtureCompoundChild } from '@deepseek-ai/dsh-debug-fixture'
import { DebugCompoundRegistry } from '../src/compound.ts'

describe('DebugCompound', () => {
  it('terminates all children when stopAll is set and aggregates state', async () => {
    const registry = new DebugCompoundRegistry()
    const children = [
      fixtureCompoundChild({ id: fixtureDebugSessionId(1), state: 'running' }),
      fixtureCompoundChild({ id: fixtureDebugSessionId(2), state: 'stopped' }),
    ]
    const compound = registry.create(fixtureDebugCompoundId(1), children, true)
    expect(compound.state).toBe('running')
    await compound.terminate()
    expect(children.flatMap(child => child.terminate.mock.calls)).toHaveLength(2)
    expect(compound.state).toBe('terminated')
  })

  it('keeps the compound while one child is unsettled and stopAll is false', async () => {
    const registry = new DebugCompoundRegistry()
    const settled = fixtureCompoundChild({ id: fixtureDebugSessionId(1), state: 'terminated' })
    const running = fixtureCompoundChild({ id: fixtureDebugSessionId(2), state: 'running' })
    const compound = registry.create(fixtureDebugCompoundId(2), [settled, running], false)
    await compound.settleChild(settled.id)
    expect(compound.state).toBe('running')
  })

  it('terminates the remaining children when one settles under stopAll', async () => {
    const registry = new DebugCompoundRegistry()
    const settled = fixtureCompoundChild({ id: fixtureDebugSessionId(1), state: 'terminated' })
    const other = fixtureCompoundChild({ id: fixtureDebugSessionId(2), state: 'running' })
    const compound = registry.create(fixtureDebugCompoundId(3), [settled, other], true)
    await compound.settleChild(settled.id)
    expect(other.terminate.mock.calls).toHaveLength(1)
    expect(compound.state).toBe('terminated')
  })

  it('rejects duplicate compound ids and resolves compounds by id', () => {
    const registry = new DebugCompoundRegistry()
    registry.create(fixtureDebugCompoundId(1), [fixtureCompoundChild({ id: fixtureDebugSessionId(1), state: 'running' })], false)
    expect(() => registry.create(fixtureDebugCompoundId(1), [], false))
      .toThrow(expect.objectContaining({ code: 'DEBUG_CONFLICT' }))
    expect(registry.get(fixtureDebugCompoundId(1))).toBeDefined()
    expect(registry.get(fixtureDebugCompoundId(9))).toBeUndefined()
  })
})
