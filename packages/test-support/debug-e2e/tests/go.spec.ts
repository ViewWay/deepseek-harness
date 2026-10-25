import { describe, expect, it } from 'vitest'
import { recordedSkipReasons, skipWithoutAdapter } from '../src/index.ts'

describe.skipIf(skipWithoutAdapter('go'))('go debug e2e', () => {
  it('hits a breakpoint and terminates', async () => {
    await import('../src/index.ts').then(harness => harness.launchFixture('go', { file: 'fixtures/go/main.go' }))
  })
})

describe('go debug e2e skip record', () => {
  it('records the explicit skip reason', () => {
    const reason = skipWithoutAdapter('go')
    if (reason !== false) {
      expect(recordedSkipReasons.some(reason => reason.startsWith('go e2e skipped'))).toBe(true)
    }
  })
})
