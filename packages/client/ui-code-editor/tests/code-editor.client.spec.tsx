// @vitest-environment jsdom
/** Editor presentation: language family, gutter toggles, conflict choices, and stop-line highlight. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { CodeEditor, editorLanguage } from '../src/client/CodeEditor.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(zh)

function mount(overrides: Partial<Parameters<typeof CodeEditor>[0]> = {}) {
  const gestures = {
    onChange: vi.fn(),
    onToggleBreakpoint: vi.fn(),
    onSave: vi.fn(),
    onResolveReload: vi.fn(),
    onResolveKeepMine: vi.fn(),
    onResolveSaveAs: vi.fn(),
  }
  const view = render(<CodeEditor
    t={t}
    path="src/a.ts"
    text={'a\nb\nc'}
    dirty={false}
    readOnly={false}
    conflict={undefined}
    breakpoints={[]}
    currentLine={undefined}
    {...gestures}
    {...overrides}
  />)
  return { view, gestures }
}

describe('editorLanguage', () => {
  it('maps known suffixes and falls back to plain text', () => {
    expect(editorLanguage('x.ts')).toBe('typescript')
    expect(editorLanguage('x.js')).toBe('javascript')
    expect(editorLanguage('x.py')).toBe('python')
    expect(editorLanguage('x.go')).toBe('go')
    expect(editorLanguage('x.rs')).toBe('rust')
    expect(editorLanguage('x.cpp')).toBe('cpp')
    expect(editorLanguage('x.unknown')).toBe('plain')
  })
})

describe('CodeEditor', () => {
  it('renders the buffer with the file language', () => {
    const { view } = mount()
    expect(view.container.querySelector('[data-editor="code"]')?.getAttribute('data-language')).toBe('typescript')
    expect(view.container.querySelectorAll('.cm-line').length).toBe(3)
  })

  it('shows the dirty and read-only states only while they hold', () => {
    const plain = mount()
    expect(plain.view.container.querySelector('[data-editor-state]')).toBeNull()
    const marked = mount({ dirty: true, readOnly: true })
    expect(marked.view.container.querySelector('[data-editor-state="dirty"]')?.textContent).toBe(zh.dirty)
    expect(marked.view.container.querySelector('[data-editor-state="read-only"]')?.textContent).toBe(zh.readOnly)
  })

  it('offers the three conflict choices on the banner', () => {
    const { view, gestures } = mount({
      conflict: { openingVersion: 'v1', diskVersion: 'v2' },
    })
    expect(view.container.querySelector('[data-editor-conflict]')).not.toBeNull()
    fireEvent.click(view.getByRole('button', { name: zh['conflict.reload'] }))
    fireEvent.click(view.getByRole('button', { name: zh['conflict.keepMine'] }))
    fireEvent.click(view.getByRole('button', { name: zh['conflict.saveAs'] }))
    expect(gestures.onResolveReload).toHaveBeenCalledOnce()
    expect(gestures.onResolveKeepMine).toHaveBeenCalledOnce()
    expect(gestures.onResolveSaveAs).toHaveBeenCalledOnce()
  })

  it('toggles a breakpoint from an existing marker button', () => {
    const { view, gestures } = mount({ breakpoints: [{ line: 2 }] })
    const marker = view.container.querySelector('[data-breakpoint="2"]') as HTMLButtonElement
    expect(marker.getAttribute('aria-label')).toBe(zh['gutter.toggle'].replace('{line}', '2'))
    fireEvent.click(marker)
    expect(gestures.onToggleBreakpoint).toHaveBeenCalledWith(2)
  })

  it('toggles the clicked line from an empty gutter click', () => {
    const { view, gestures } = mount()
    // Each gutter carries its own listeners, and jsdom reports no
    // coordinates, so the click resolves to the first line: the assertion is
    // the toggle itself, not the line number.
    for (const gutter of view.container.querySelectorAll('.cm-gutter')) {
      fireEvent.mouseDown(gutter)
    }
    expect(gestures.onToggleBreakpoint).toHaveBeenCalledWith(expect.any(Number))
  })

  it('highlights the stopped frame line', () => {
    const { view } = mount({ currentLine: 2 })
    const lines = [...view.container.querySelectorAll('.cm-line')]
    expect(lines[1]!.className).toContain('dsw-cm-debug-line')
    expect(lines[0]!.className).not.toContain('dsw-cm-debug-line')
  })

  it('saves through the editor save binding', () => {
    const { view, gestures } = mount()
    const content = view.container.querySelector('.cm-content') as HTMLElement
    // jsdom reports no platform, so CodeMirror normalizes Mod-s to Ctrl-s here.
    fireEvent.keyDown(content, { key: 's', code: 'KeyS', ctrlKey: true })
    expect(gestures.onSave).toHaveBeenCalledOnce()
  })

  it('adopts externally replaced buffer text and reports it through onChange', () => {
    const { view, gestures } = mount()
    view.rerender(<CodeEditor
      t={t} path="src/a.ts" text={'a\nb\nc\nd'} dirty={false} readOnly={false}
      conflict={undefined} breakpoints={[]} currentLine={undefined}
      onChange={gestures.onChange} onToggleBreakpoint={gestures.onToggleBreakpoint} onSave={gestures.onSave}
      onResolveReload={gestures.onResolveReload} onResolveKeepMine={gestures.onResolveKeepMine}
      onResolveSaveAs={gestures.onResolveSaveAs}
    />)
    expect(view.container.querySelectorAll('.cm-line').length).toBe(4)
    expect(gestures.onChange).toHaveBeenCalledWith('a\nb\nc\nd')
  })
})
