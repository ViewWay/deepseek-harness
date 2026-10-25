/** TUI Ink app: layouts, input dispatch, approval rendering, and exit confirmation. */

import { describe, expect, it, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { TuiApp } from '../src/app.tsx'
import type { TuiTranscriptSource } from '../src/app.tsx'
import { createTuiApprovalQueue } from '../src/approval.ts'
import { appendTranscript, createTranscript } from '../src/transcript.ts'
import type { TuiTranscript, TuiTranscriptEntry } from '../src/transcript.ts'

/** A controllable transcript source the tests push entries through. */
function makeSource(): TuiTranscriptSource & { push(entry: TuiTranscriptEntry): void } {
  let transcript: TuiTranscript = createTranscript()
  const listeners = new Set<(transcript: TuiTranscript) => void>()
  return {
    current: () => transcript,
    subscribe: (callback) => {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
    push(entry): void {
      transcript = appendTranscript(transcript, entry)
      for (const listener of listeners) listener(transcript)
    },
  }
}

/** Default app callbacks recording calls. */
function callbacks(): {
  onPrompt: (text: string) => Promise<void>
  onCommand: (name: string, args: readonly string[]) => void
  onExit: () => void
} {
  return {
    onPrompt: vi.fn(async (_text: string) => {}),
    onCommand: vi.fn((_name: string, _args: readonly string[]) => {}),
    onExit: vi.fn(() => {}),
  }
}

describe('TUI Ink app', () => {
  it('renders the status line, input prompt, and hint', () => {
    const source = makeSource()
    const calls = callbacks()
    const { lastFrame, unmount } = render(
      <TuiApp {...calls} transcriptSource={source} statusLabel="session session-1 · p/m" />,
    )
    expect(lastFrame()).toContain('session session-1 · p/m · chat')
    expect(lastFrame()).toContain('input >')
    expect(lastFrame()).toContain('prompt or :command')
    unmount()
  })

  it('echoes typed input and dispatches the prompt on Return', async () => {
    const source = makeSource()
    const calls = callbacks()
    const { lastFrame, stdin, unmount } = render(<TuiApp {...calls} transcriptSource={source} />)
    stdin.write('hello')
    await vi.waitFor(() => { expect(lastFrame()).toContain('hello') })
    stdin.write('\r')
    await vi.waitFor(() => { expect(calls.onPrompt).toHaveBeenCalledWith('hello') })
    unmount()
  })

  it('dispatches non-builtin commands and clears the input', async () => {
    const source = makeSource()
    const calls = callbacks()
    const { stdin, unmount } = render(<TuiApp {...calls} transcriptSource={source} />)
    stdin.write(':expand 2')
    stdin.write('\r')
    await vi.waitFor(() => { expect(calls.onCommand).toHaveBeenCalledWith('expand', ['2']) })
    unmount()
  })

  it('switches layouts on F6, F7, and :chat', async () => {
    const source = makeSource()
    const calls = callbacks()
    const { lastFrame, stdin, unmount } = render(<TuiApp {...calls} transcriptSource={source} />)
    stdin.write('\x1b[17~')
    await vi.waitFor(() => { expect(lastFrame()).toContain('· debug') })
    expect(lastFrame()).toContain('debug panels arrive')
    stdin.write('\x1b[18~')
    await vi.waitFor(() => { expect(lastFrame()).toContain('· split') })
    stdin.write(':chat')
    stdin.write('\r')
    await vi.waitFor(() => { expect(lastFrame()).toContain('· chat') })
    unmount()
  })

  it('renders the pending approval and routes y to the answerer', async () => {
    const source = makeSource()
    const calls = callbacks()
    const approvals = createTuiApprovalQueue()
    const { lastFrame, stdin, unmount } = render(<TuiApp {...calls} transcriptSource={source} approvals={approvals} />)
    const outcome = approvals.ask({ toolName: 'shell', reason: 'runs ls' })
    await vi.waitFor(() => { expect(lastFrame()).toContain('approve shell? runs ls') })
    stdin.write('y')
    await expect(outcome).resolves.toBe('allowed-once')
    unmount()
  })

  it('confirms exit while debug sessions run and leaves on y', async () => {
    const source = makeSource()
    const calls = callbacks()
    const { lastFrame, stdin, unmount } = render(
      <TuiApp {...calls} transcriptSource={source} runningDebugSessions={() => ['dbg-1']} />,
    )
    stdin.write(':q')
    stdin.write('\r')
    await vi.waitFor(() => { expect(lastFrame()).toContain('running debug sessions: dbg-1') })
    expect(calls.onExit).not.toHaveBeenCalled()
    stdin.write('n')
    await vi.waitFor(() => { expect(lastFrame()).not.toContain('quit anyway') })
    stdin.write(':q')
    stdin.write('\r')
    await vi.waitFor(() => { expect(lastFrame()).toContain('quit anyway') })
    stdin.write('y')
    await vi.waitFor(() => { expect(calls.onExit).toHaveBeenCalledTimes(1) })
    unmount()
  })

  it('exits without confirmation when no debug sessions run', async () => {
    const source = makeSource()
    const calls = callbacks()
    const { stdin, unmount } = render(<TuiApp {...calls} transcriptSource={source} />)
    stdin.write(':q')
    stdin.write('\r')
    await vi.waitFor(() => { expect(calls.onExit).toHaveBeenCalledTimes(1) })
    unmount()
  })

  it('renders transcript entries from the source', async () => {
    const source = makeSource()
    const calls = callbacks()
    const { lastFrame, unmount } = render(<TuiApp {...calls} transcriptSource={source} />)
    source.push({ kind: 'assistant', text: 'Done.' })
    await vi.waitFor(() => { expect(lastFrame()).toContain('Done.') })
    unmount()
  })
})
