import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createDraftStore } from '../src/client/draft-store.ts'

describe('editor draft store', () => {
  it('keeps one bounded draft per session/path and clears it on save or discard', () => {
    const store = createDraftStore({ maxBytes: 32 })
    store.put({ sessionId: SessionId('s1'), path: 'src/a.ts', text: 'draft', version: 'v1' })
    expect(store.get(SessionId('s1'), 'src/a.ts')).toMatchObject({ text: 'draft', version: 'v1' })
    store.clear(SessionId('s1'), 'src/a.ts')
    expect(store.get(SessionId('s1'), 'src/a.ts')).toBeUndefined()
  })

  it('keeps drafts of different sessions apart', () => {
    const store = createDraftStore({ maxBytes: 32 })
    store.put({ sessionId: SessionId('s1'), path: 'src/a.ts', text: 'mine', version: 'v1' })
    store.put({ sessionId: SessionId('s2'), path: 'src/a.ts', text: 'theirs', version: 'v1' })
    expect(store.get(SessionId('s1'), 'src/a.ts')).toMatchObject({ text: 'mine' })
    expect(store.get(SessionId('s2'), 'src/a.ts')).toMatchObject({ text: 'theirs' })
  })

  it('replaces a draft for the same key and counts the newest bytes only', () => {
    const store = createDraftStore({ maxBytes: 16 })
    store.put({ sessionId: SessionId('s1'), path: 'src/a.ts', text: 'x'.repeat(12), version: 'v1' })
    store.put({ sessionId: SessionId('s1'), path: 'src/a.ts', text: 'y'.repeat(4), version: 'v1' })
    expect(store.get(SessionId('s1'), 'src/a.ts')).toMatchObject({ text: 'yyyy' })
    store.put({ sessionId: SessionId('s1'), path: 'src/b.ts', text: 'z'.repeat(12), version: 'v1' })
    expect(store.get(SessionId('s1'), 'src/a.ts')).toBeDefined()
    expect(store.get(SessionId('s1'), 'src/b.ts')).toBeDefined()
  })

  it('evicts the least recently written draft when the budget would overflow', () => {
    const store = createDraftStore({ maxBytes: 24 })
    store.put({ sessionId: SessionId('s1'), path: 'a', text: 'x'.repeat(12), version: 'v1' })
    store.put({ sessionId: SessionId('s1'), path: 'b', text: 'y'.repeat(12), version: 'v1' })
    store.put({ sessionId: SessionId('s1'), path: 'c', text: 'z'.repeat(12), version: 'v1' })
    expect(store.get(SessionId('s1'), 'a')).toBeUndefined()
    expect(store.get(SessionId('s1'), 'b')).toBeDefined()
    expect(store.get(SessionId('s1'), 'c')).toBeDefined()
  })

  it('refuses to store one draft larger than the whole budget', () => {
    const store = createDraftStore({ maxBytes: 8 })
    store.put({ sessionId: SessionId('s1'), path: 'a', text: 'far too many bytes', version: 'v1' })
    expect(store.get(SessionId('s1'), 'a')).toBeUndefined()
  })

  it('counts bytes in UTF-8, not UTF-16 code units', () => {
    const store = createDraftStore({ maxBytes: 16 })
    store.put({ sessionId: SessionId('s1'), path: 'a', text: '安'.repeat(8), version: 'v1' })
    store.put({ sessionId: SessionId('s1'), path: 'b', text: 'ok', version: 'v1' })
    expect(store.get(SessionId('s1'), 'a')).toBeUndefined()
    expect(store.get(SessionId('s1'), 'b')).toBeDefined()
  })
})
