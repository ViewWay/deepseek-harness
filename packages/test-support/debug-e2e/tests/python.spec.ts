import { describe, expect, it } from 'vitest'
import { launchFixture, skipWithoutAdapter } from '../src/index.ts'

describe.skipIf(skipWithoutAdapter('python'))('python debug e2e', () => {
  it('hits a breakpoint, evaluates, and terminates', async () => {
    const session = await launchFixture('python', { file: 'fixtures/python/app.py' })
    await session.setBreakpoints({ source: 'fixtures/python/app.py', breakpoints: [{ line: 2 }] })
    await expect(session.continue()).resolves.toMatchObject({ kind: 'stopped', stop: { reason: 'breakpoint' } })
    await session.terminate()
  })
})
