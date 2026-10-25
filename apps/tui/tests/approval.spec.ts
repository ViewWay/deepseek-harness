/** TUI approval queue and terminal answerer: serial pending, answers, abort, close, delegation. */

import { describe, expect, it, vi } from 'vitest'
import { createTuiApprovalQueue, installTuiApproval } from '../src/approval.ts'
import type { TuiApprovalHost, TuiApprovalQueue } from '../src/approval.ts'

/** One waterfall-listener signature as the host face declares it. */
type Answerer = Parameters<TuiApprovalHost['on']>[1]

/** The delegating `next` used to observe hand-offs. */
type Next = () => Promise<'unavailable'>

describe('TUI approval queue', () => {
  it('queues serially, answers the pending head, and notifies subscribers', async () => {
    const queue = createTuiApprovalQueue()
    const pending: Array<string | undefined> = []
    const stop = queue.subscribe((request) => { pending.push(request?.toolName) })
    const first = queue.ask({ toolName: 'shell' })
    const second = queue.ask({ toolName: 'web' })
    expect(queue.pending()).toEqual({ toolName: 'shell' })
    queue.answer('allowed-once')
    await expect(first).resolves.toBe('allowed-once')
    expect(queue.pending()).toEqual({ toolName: 'web' })
    queue.answer('rejected')
    await expect(second).resolves.toBe('rejected')
    expect(queue.pending()).toBeUndefined()
    stop()
    expect(pending).toEqual(['shell', 'web', undefined])
  })

  it('ignores answers when nothing is pending', () => {
    const queue = createTuiApprovalQueue()
    expect(() => { queue.answer('rejected') }).not.toThrow()
    expect(queue.pending()).toBeUndefined()
  })

  it('cancels pending requests and reports unavailable once closed', async () => {
    const queue = createTuiApprovalQueue()
    const pending = queue.ask({ toolName: 'shell' })
    queue.close()
    await expect(pending).resolves.toBe('cancelled')
    await expect(queue.ask({ toolName: 'next' })).resolves.toBe('unavailable')
    expect(queue.closed).toBe(true)
  })

  it('settles a queued request as cancelled when its signal aborts', async () => {
    const queue = createTuiApprovalQueue()
    const controller = new AbortController()
    const pending = queue.ask({ toolName: 'shell', signal: controller.signal })
    controller.abort()
    await expect(pending).resolves.toBe('cancelled')
    expect(queue.pending()).toBeUndefined()
  })

  it('settles immediately when the signal is already aborted', async () => {
    const queue = createTuiApprovalQueue()
    const controller = new AbortController()
    controller.abort()
    await expect(queue.ask({ toolName: 'shell', signal: controller.signal })).resolves.toBe('cancelled')
    expect(queue.pending()).toBeUndefined()
  })
})

describe('TUI terminal answerer', () => {
  /** Install the answerer on a capturing host and return its listener with a delegating `next`. */
  function registerAnswerer(queue: TuiApprovalQueue): { answerer: Answerer; next: Next } {
    let answerer: Answerer | undefined
    const next = vi.fn(async () => 'unavailable' as const)
    const host: TuiApprovalHost = {
      on: (_name, listener) => {
        answerer = listener
        return () => {}
      },
    }
    installTuiApproval(host, queue)
    if (answerer === undefined) throw new Error('approval listener never registered')
    return { answerer, next }
  }

  it('answers queued requests through the queue while it is open', async () => {
    const queue = createTuiApprovalQueue()
    const { answerer, next } = registerAnswerer(queue)
    const outcome = answerer({ toolName: 'shell', reason: 'runs ls' }, next)
    expect(queue.pending()).toEqual({ toolName: 'shell', reason: 'runs ls' })
    queue.answer('allowed-once')
    await expect(outcome).resolves.toBe('allowed-once')
    expect(next).not.toHaveBeenCalled()
  })

  it('delegates with next() once the queue is closed', async () => {
    const queue = createTuiApprovalQueue()
    const { answerer, next } = registerAnswerer(queue)
    queue.close()
    await expect(answerer({ toolName: 'shell' }, next)).resolves.toBe('unavailable')
    expect(next).toHaveBeenCalledTimes(1)
  })
})
