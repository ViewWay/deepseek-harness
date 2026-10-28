/**
 * The controller's Config field: the replay ring's retention bound is a
 * validated, cordis.yml-tunable `eventRingLimit` filled with its default, not
 * a hardcoded constant. Load-time enforcement is cordis's own `static Config`
 * seam (same as every controller here); these tests pin the schema contract
 * and the path from the validated value into the bounded ring.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_DEBUG_EVENT_RING_LIMIT, DebugController } from '../src/index.ts'
import { DebugEventRing } from '../src/ring.ts'

describe('debug controller config', () => {
  it('fills the documented default retention when cordis.yml stays silent', () => {
    expect(DebugController.Config({})).toMatchObject({ eventRingLimit: DEFAULT_DEBUG_EVENT_RING_LIMIT })
  })

  it('accepts a positive override and rejects non-positive or fractional retentions', () => {
    expect(DebugController.Config({ eventRingLimit: 2 }).eventRingLimit).toBe(2)
    expect(() => DebugController.Config({ eventRingLimit: 0 })).toThrow()
    expect(() => DebugController.Config({ eventRingLimit: -3 })).toThrow()
    expect(() => DebugController.Config({ eventRingLimit: 1.5 })).toThrow()
  })

  it('feeds the validated retention straight into the bounded ring', () => {
    const ring = new DebugEventRing(DebugController.Config({ eventRingLimit: 2 }).eventRingLimit)
    ring.append('s1', 'a')
    ring.append('s1', 'b')
    ring.append('s1', 'c')
    const replay = ring.replay('s1', 0)
    expect(replay.expired).toBe(true)
    expect(replay.records.map(record => record.payload)).toEqual(['b', 'c'])
  })
})
