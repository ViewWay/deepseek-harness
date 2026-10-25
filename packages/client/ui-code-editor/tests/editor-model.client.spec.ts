import { describe, expect, it } from 'vitest'
import { createEditorModel, EditorSaveBlockedError } from '../src/client/editor-model.ts'

describe('editor model', () => {
  it('tracks dirty state and saves with the opening version', () => {
    const model = createEditorModel({ path: 'src/a.ts', text: 'a\nb', version: 'v1', eol: '\n' })
    expect(model.dirty).toBe(false)
    model.setValue('a\nc')
    expect(model.dirty).toBe(true)
    expect(model.savePayload()).toEqual({ path: 'src/a.ts', content: 'a\nc', expectedVersion: 'v1' })
    model.markSaved('v2', 'a\nc')
    expect(model.dirty).toBe(false)
    expect(model.version).toBe('v2')
  })

  it('reports a disk change without discarding a dirty buffer', () => {
    const model = createEditorModel({ path: 'src/a.ts', text: 'a', version: 'v1', eol: '\n' })
    model.setValue('b')
    model.markDiskChanged('v2')
    expect(model.dirty).toBe(true)
    expect(model.diskChanged).toBe(true)
  })

  it('normalizes CRLF on load and restores the declared EOL on save', () => {
    const model = createEditorModel({ path: 'src/a.ts', text: 'a\r\nb', version: 'v1', eol: '\r\n' })
    model.setValue('a\nc')
    expect(model.savePayload()).toEqual({ path: 'src/a.ts', content: 'a\r\nc', expectedVersion: 'v1' })
  })

  it('blocks saving after a version conflict until the user resolves it', () => {
    const model = createEditorModel({ path: 'src/a.ts', text: 'a', version: 'v1', eol: '\n' })
    model.setValue('b')
    model.markDiskChanged('v2')
    expect(model.conflict).toEqual({ openingVersion: 'v1', diskVersion: 'v2' })
    expect(() => model.savePayload()).toThrow(EditorSaveBlockedError)
    model.resolveKeepMine()
    expect(model.savePayload()).toEqual({ path: 'src/a.ts', content: 'b', expectedVersion: 'v2' })
  })

  it('treats a disk change under a dirty buffer as the same conflict', () => {
    const model = createEditorModel({ path: 'src/a.ts', text: 'a', version: 'v1', eol: '\n' })
    model.setValue('b')
    model.markDiskChanged('v2')
    expect(() => model.savePayload()).toThrow(EditorSaveBlockedError)
    model.resolveReload('c')
    expect(model.dirty).toBe(false)
    expect(model.text).toBe('c')
    expect(model.version).toBe('v2')
    expect(model.diskChanged).toBe(false)
  })

  it('moves the save target and clears the conflict on save-as', () => {
    const model = createEditorModel({ path: 'src/a.ts', text: 'a', version: 'v1', eol: '\n' })
    model.setValue('b')
    model.markDiskChanged('v2')
    model.resolveSaveAs('src/a.copy.ts')
    expect(model.savePayload()).toEqual({ path: 'src/a.copy.ts', content: 'b', expectedVersion: null })
  })

  it('clears the disk-change flag when a save lands on the observed disk version', () => {
    const model = createEditorModel({ path: 'src/a.ts', text: 'a', version: 'v1', eol: '\n' })
    model.markDiskChanged('v2')
    expect(model.diskChanged).toBe(true)
    model.setValue('b')
    model.resolveKeepMine()
    model.markSaved('v2', 'b')
    expect(model.diskChanged).toBe(false)
    expect(model.dirty).toBe(false)
  })
})
