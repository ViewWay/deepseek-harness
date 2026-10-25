import { describe, expect, it } from 'vitest'
import { recordedSkipReasons, skipWithoutAdapter } from '../src/index.ts'

describe.skipIf(skipWithoutAdapter('native'))('native debug e2e', () => {
  it('hits a breakpoint and terminates', async () => {
    await import('../src/index.ts').then(harness => harness.launchFixture('native', { file: 'fixtures/native/main.c' }))
  })
})

describe('native debug e2e skip record', () => {
  it('records the explicit skip reason', () => {
    const reason = skipWithoutAdapter('native')
    if (reason !== false) {
      expect(recordedSkipReasons.some(reason => reason.startsWith('native e2e skipped'))).toBe(true)
    }
  })
})
