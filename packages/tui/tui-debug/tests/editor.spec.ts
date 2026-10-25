import { describe, expect, it } from 'vitest'
import { editorCommand, openInEditor, TuiEditorLaunch } from '../src/editor.ts'

describe('external editor', () => {
  it('opens a local file at the current line', () => {
    expect(editorCommand('/usr/bin/vi', '/ws/src/a.ts', 4)).toEqual(['/usr/bin/vi', '+4', '/ws/src/a.ts'])
  })

  it('uses the configured remote command for a remote workspace', () => {
    expect(editorCommand('code --remote ssh-remote+host', '/remote/a.ts', 4)).toEqual([
      'code', '--remote', 'ssh-remote+host', '+4', '/remote/a.ts',
    ])
  })

  it('rejects an empty command and non-positive lines', () => {
    expect(() => editorCommand('   ', '/a.ts', 1)).toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    expect(() => editorCommand('vi', '/a.ts', 0)).toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    expect(() => editorCommand('vi', '/a.ts', 1.5)).toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })

  it('spawns the built argv through the injected local subprocess', () => {
    const spawned: string[][] = []
    const outcome = openInEditor({
      editor: '/usr/bin/vi',
      file: '/ws/src/a.ts',
      line: 4,
      remote: false,
      launch: makeLaunch(spawned),
    })
    expect(outcome).toEqual({ kind: 'opened', argv: ['/usr/bin/vi', '+4', '/ws/src/a.ts'] })
    expect(spawned).toEqual([['/usr/bin/vi', '+4', '/ws/src/a.ts']])
  })

  it('spawns the configured remote editor for a remote workspace', () => {
    const spawned: string[][] = []
    const outcome = openInEditor({
      editor: 'code --remote ssh-remote+host',
      file: '/remote/a.ts',
      line: 4,
      remote: true,
      launch: makeLaunch(spawned),
    })
    expect(outcome).toEqual({ kind: 'opened', argv: ['code', '--remote', 'ssh-remote+host', '+4', '/remote/a.ts'] })
    expect(spawned).toHaveLength(1)
  })

  it('returns the copyable remote path when no remote editor is configured', () => {
    const spawned: string[][] = []
    const outcome = openInEditor({
      editor: undefined,
      file: '/remote/a.ts',
      line: 4,
      remote: true,
      launch: makeLaunch(spawned),
    })
    expect(outcome).toEqual({ kind: 'remote-path', path: '/remote/a.ts' })
    expect(spawned).toEqual([])
  })

  it('reports unavailability when the local editor is unset', () => {
    const spawned: string[][] = []
    const outcome = openInEditor({
      editor: undefined,
      file: '/ws/src/a.ts',
      line: 4,
      remote: false,
      launch: makeLaunch(spawned),
    })
    expect(outcome).toEqual({ kind: 'unavailable' })
    expect(spawned).toEqual([])
  })

  it('fails typed when an editor is configured but no launcher is injected', () => {
    expect(() => openInEditor({
      editor: '/usr/bin/vi',
      file: '/ws/src/a.ts',
      line: 4,
      remote: false,
    })).toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })
})

/** A recording launcher satisfying the argv-only face. */
function makeLaunch(spawned: string[][]): TuiEditorLaunch {
  return {
    start: (request) => {
      spawned.push([...request.argv])
      return undefined
    },
  }
}
