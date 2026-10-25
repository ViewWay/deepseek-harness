import { describe, expect, it } from 'vitest'
import { DebugEventRing } from '../src/ring.ts'

describe('DebugEventRing', () => {
  it('assigns monotonic per-session sequences starting at one', () => {
    const ring = new DebugEventRing(8)
    expect(ring.append('s1', 'a')).toBe(1)
    expect(ring.append('s1', 'b')).toBe(2)
    expect(ring.append('s2', 'c')).toBe(1)
  })

  it('replays everything for a fresh cursor', () => {
    const ring = new DebugEventRing(8)
    ring.append('s1', 'a')
    ring.append('s1', 'b')
    const replay = ring.replay('s1', 0)
    expect(replay.records.map(record => record.payload)).toEqual(['a', 'b'])
    expect(replay.expired).toBe(false)
    expect(replay.latestSeq).toBe(2)
  })

  it('reports expired once the ring dropped events the cursor has not seen', () => {
    const ring = new DebugEventRing(2)
    ring.append('s1', 'a')
    ring.append('s1', 'b')
    ring.append('s1', 'c')
    const replay = ring.replay('s1', 0)
    expect(replay.expired).toBe(true)
    expect(replay.records.map(record => record.payload)).toEqual(['b', 'c'])
    expect(replay.latestSeq).toBe(3)
  })

  it('stays within retention for a current cursor', () => {
    const ring = new DebugEventRing(2)
    ring.append('s1', 'a')
    ring.append('s1', 'b')
    ring.append('s1', 'c')
    const replay = ring.replay('s1', 2)
    expect(replay.expired).toBe(false)
    expect(replay.records.map(record => record.payload)).toEqual(['c'])
    expect(replay.latestSeq).toBe(3)
  })

  it('advances latestSeq as the cursor for the next read', () => {
    const ring = new DebugEventRing(4)
    ring.append('s1', 'a')
    const first = ring.replay('s1', 0)
    const second = ring.replay('s1', first.latestSeq)
    expect(second.records).toEqual([])
    expect(second.expired).toBe(false)
  })

  it('isolates sessions in both replay and expiry', () => {
    const ring = new DebugEventRing(2)
    ring.append('s1', 'a')
    ring.append('s2', 'b')
    ring.append('s1', 'c')
    const s2 = ring.replay('s2', 0)
    expect(s2.records.map(record => record.payload)).toEqual(['b'])
    expect(s2.expired).toBe(false)
    const empty = ring.replay('s3', 0)
    expect(empty.records).toEqual([])
    expect(empty.expired).toBe(false)
  })
})
