/**
 * PTY smoke: the shipped `tui` profile boots, renders the input line, echoes a
 * typed prompt, and routes `:expand` errors into the transcript. Consumes
 * `apps/cli/lib/bin.js` under the tsx source launch — the dev machine's
 * shipped entry for source-main apps (apps are outside the library artifact
 * set; packaged entries land with Task 26) — and self-skips on a clean tree.
 * Skips only when the platform cannot allocate a PTY or node-pty is absent.
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const binPath = path.join(repoRoot, 'apps/cli/lib/bin.js')

/** Poll until the predicate holds or the deadline passes. */
async function waitFor(predicate: () => boolean, deadlineMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < deadlineMs) {
    if (predicate()) return true
    await new Promise((resolve) => { setTimeout(resolve, 100) })
  }
  return predicate()
}

describe('dsh tui PTY', () => {
  it('boots, renders the input line, accepts a prompt, and routes :expand errors', { timeout: 90_000 }, async (context) => {
    if (!existsSync(binPath)) {
      context.skip()
      return
    }
    const pty = await import('node-pty').catch(() => undefined)
    if (pty === undefined) {
      context.skip()
      return
    }
    const seen: string[] = []
    let child: import('node-pty').IPty | undefined
    try {
      child = pty.spawn(process.execPath, [binPath, '--profile', 'tui'], {
        name: 'xterm-256color',
        cols: 100,
        rows: 30,
        cwd: repoRoot,
        env: {
          ...process.env,
          // The tsx source-launch loader, injected the way the dev `pnpm dsh`
          // entry injects it: apps outside the library artifact set keep
          // src mains, so the shipped dev entry boots them through tsx.
          NODE_OPTIONS: '--import=tsx/esm',
          TERM: 'xterm-256color',
          NO_COLOR: '1',
          DSH_TELEMETRY_DISABLED: '1',
        },
      })
    } catch {
      // The platform cannot allocate a PTY here; the plan allows exactly this skip.
      context.skip()
      return
    }
    try {
      child.onData((data) => { seen.push(data) })
      const output = (): string => seen.join('')
      const booted = await waitFor(() => output().includes('input >'), 60_000)
      expect(booted, `tui never rendered the input line; output was: ${JSON.stringify(output().slice(-2000))}`).toBe(true)
      // Each key waits for the previous one to render before it is written:
      // consecutive writes can coalesce into one stdin chunk, and Ink hands a
      // multi-key chunk to the app with no Return flag, printing "\r" as text
      // instead of submitting.
      child.write('hello')
      const echoed = await waitFor(() => output().includes('hello'), 10_000)
      expect(echoed, `typed prompt never appeared; output was: ${JSON.stringify(output().slice(-2000))}`).toBe(true)
      child.write('\r')
      // `:expand` routes through the runner into the transcript; on the empty
      // transcript the missing id surfaces as a visible error, not silence.
      child.write(':expand 9')
      const typed = await waitFor(() => output().includes(':expand 9'), 10_000)
      expect(typed, `:expand never echoed; output was: ${JSON.stringify(output().slice(-2000))}`).toBe(true)
      child.write('\r')
      const expandError = await waitFor(() => output().includes('no stored output 9'), 10_000)
      const expandTail = `:expand never reported the missing stored output; output was: ${JSON.stringify(output().slice(-2000))}`
      expect(expandError, expandTail).toBe(true)
    } finally {
      child.kill()
    }
  })
})
