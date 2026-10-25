import { describe, expect, it } from 'vitest'
import { launchFixture, skipWithoutAdapter } from '../src/index.ts'

describe.skipIf(skipWithoutAdapter('node'))('node debug e2e', () => {
  it('hits a breakpoint, steps, and terminates', async () => {
    const session = await launchFixture('node', { file: 'fixtures/node/app.ts' })
    await session.setBreakpoints({ source: 'fixtures/node/app.ts', breakpoints: [{ line: 4 }] })
    await expect(session.continue()).resolves.toMatchObject({ kind: 'stopped', stop: { reason: 'breakpoint' } })
    await expect(session.step('over')).resolves.toMatchObject({ kind: 'stopped' })
    await session.terminate()
  })
})
