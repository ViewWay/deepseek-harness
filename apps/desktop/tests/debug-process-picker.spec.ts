import { describe, expect, it, vi } from 'vitest'
import type { DesktopAttachEnvironment, DesktopAttachTarget } from '../src/debug/process-picker.ts'
import { attachTargetDialog, listAttachTargets } from '../src/debug/process-picker.ts'

const environment: DesktopAttachEnvironment = {
  workspaceRoot: '/tmp/project', cwd: '/tmp/project', platform: 'darwin', arch: 'arm64', pathSeparator: '/',
}

describe('desktop process picker', () => {
  it('lists only provider-declared targets', async () => {
    const targets: readonly DesktopAttachTarget[] = [{ name: 'node app', processId: 42 }]
    const provider = { probeAttachTargets: vi.fn(async () => targets) }
    await expect(listAttachTargets(provider, environment)).resolves.toBe(targets)
    expect(provider.probeAttachTargets).toHaveBeenCalledExactlyOnceWith(environment, undefined)
  })

  it('cancels an in-flight probe through the picker signal', async () => {
    const controller = new AbortController()
    const provider = {
      probeAttachTargets: vi.fn(async (_environment: DesktopAttachEnvironment, signal?: AbortSignal) => {
        signal?.throwIfAborted()
        return []
      }),
    }
    controller.abort()
    await expect(listAttachTargets(provider, environment, controller.signal)).rejects.toThrow()
  })

  it('offers no targets when the provider declares no probe', async () => {
    await expect(listAttachTargets({}, environment)).resolves.toEqual([])
  })

  it('renders provider order as dialog buttons with a cancel entry', () => {
    const dialog = attachTargetDialog(
      { title: 'Attach to process', message: 'Choose the process to attach to', cancel: 'Cancel' },
      [{ name: 'node app', processId: 42 }, { name: 'python REPL', port: 5678 }],
    )
    expect(dialog).toEqual({
      type: 'info',
      title: 'Attach to process',
      message: 'Choose the process to attach to',
      buttons: ['node app', 'python REPL', 'Cancel'],
      cancelId: 2,
      defaultId: 0,
      noLink: true,
    })
  })
})
