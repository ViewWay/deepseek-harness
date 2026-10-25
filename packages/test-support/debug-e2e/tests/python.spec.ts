import { describe, expect, it } from 'vitest'
import { DebugError } from '@deepseek-ai/dsh-debug'
import { launchFixture, skipWithoutAdapter } from '../src/index.ts'
import type { DebugE2eSession } from '../src/index.ts'

describe.skipIf(skipWithoutAdapter('python'))('python debug e2e', () => {
  it('hits a breakpoint, continues, and terminates', { timeout: 120_000 }, async (ctx) => {
    let session: DebugE2eSession
    try {
      session = await launchFixture('python', { file: 'fixtures/python/app.py' })
    } catch (error: unknown) {
      // A missing debugpy surfaces as the adapter dying on stdio (SESSION_GONE)
      // or the handshake never completing (TIMEOUT); the launch is the probe.
      if (error instanceof DebugError && (error.code === 'DEBUG_SESSION_GONE' || error.code === 'DEBUG_TIMEOUT')) {
        ctx.skip(`debugpy adapter unavailable on this interpreter (${error.code}: ${error.message}); provisioning steps are in README.md`)
      }
      throw error
    }
    await session.setBreakpoints({ source: 'fixtures/python/app.py', breakpoints: [{ line: 2 }] })
    await expect(session.continue()).resolves.toMatchObject({ kind: 'stopped', stop: { reason: 'breakpoint' } })
    await session.terminate()
  })
})
