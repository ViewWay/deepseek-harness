// @vitest-environment jsdom
/** Debug panels: bounded values, lazy expand, capability hiding, and settings actions. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  AdapterSettingsPanel, BreakpointsPanel, ConsolePanel, DisassemblyPanel, ExceptionFiltersPanel,
  LoadedSourcesPanel, MemoryPanel, ModulesPanel, NotificationToggle, StackPanel, VariablesPanel,
  WatchPanel, truncateVariableValue,
} from '../src/client/panels.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(en)

describe('truncateVariableValue', () => {
  it('keeps short values and folds long ones at the cap', () => {
    expect(truncateVariableValue('abc')).toBe('abc')
    const folded = truncateVariableValue('x'.repeat(65))
    expect(folded).toBe(`${'x'.repeat(64)}…`)
  })
})

describe('VariablesPanel', () => {
  it('renders a truncated value and keeps the expand control', () => {
    const view = render(<VariablesPanel variables={[
      { name: 'big', value: 'x'.repeat(100) + '…', variablesReference: 7 },
    ]} onExpand={() => {}} t={t} />)
    expect(view.getByText(/big/)).toBeTruthy()
    expect(view.getByLabelText('Expand big')).toBeTruthy()
    expect(view.container.textContent).toContain(`${'x'.repeat(64)}…`)
  })

  it('expands child-bearing rows, skips reference-less rows, and shows the empty state', () => {
    const onExpand = vi.fn()
    const populated = render(<VariablesPanel
      variables={[
        { name: 'list', value: '[3]', variablesReference: 7 },
        { name: 'plain', value: '42', variablesReference: 0 },
      ]}
      onExpand={onExpand}
      t={t}
    />)
    fireEvent.click(populated.getByLabelText('Expand list'))
    expect(onExpand).toHaveBeenCalledWith(7)
    populated.rerender(<VariablesPanel variables={[]} onExpand={onExpand} t={t} />)
    expect(populated.container.textContent).toContain(t('panel.variables.empty'))
  })
})

describe('StackPanel', () => {
  it('shows the empty state, frames with locations, and routes selection', () => {
    const onSelect = vi.fn()
    const empty = render(<StackPanel frames={[]} selectedFrameId={undefined} t={t} onSelect={onSelect} />)
    expect(empty.container.textContent).toContain(t('panel.stack.empty'))
    const view = render(<StackPanel
      frames={[
        { frameId: 'frame-1', name: 'main', source: 'src/a.ts', line: 4 },
        { frameId: 'frame-2', name: 'start' },
      ]}
      selectedFrameId="frame-1"
      t={t}
      onSelect={onSelect}
    />)
    const frames = [...view.container.querySelectorAll('[data-debug-frame]')]
    expect(frames).toHaveLength(2)
    expect(frames[0]?.textContent).toContain('src/a.ts:4')
    expect(frames[1]?.textContent).not.toContain(':')
    fireEvent.click(frames[1] ?? new HTMLElement())
    expect(onSelect).toHaveBeenCalledWith('frame-2')
  })
})

describe('WatchPanel', () => {
  it('renders each expression independently and routes add and remove', () => {
    const onAdd = vi.fn()
    const onRemove = vi.fn()
    const view = render(<WatchPanel
      watches={['x > 0', 'broken']}
      results={{ 'x > 0': { value: 'true' }, broken: { error: 'EVAL_FAILED: undefined' } }}
      t={t}
      onAdd={onAdd}
      onRemove={onRemove}
    />)
    expect(view.getByText('x > 0')).toBeTruthy()
    expect(view.getByText('true')).toBeTruthy()
    expect(view.container.querySelector('[data-debug-watch-error]')?.textContent).toContain('EVAL_FAILED')
    fireEvent.click(view.getByLabelText('Remove broken'))
    expect(onRemove).toHaveBeenCalledWith('broken')
    fireEvent.click(view.container.querySelector('[data-debug-watch-add]') ?? new HTMLElement())
    expect(onAdd).toHaveBeenCalledWith('')
  })

  it('shows the empty state without expressions', () => {
    const view = render(<WatchPanel watches={[]} results={{}} t={t} onAdd={() => {}} onRemove={() => {}} />)
    expect(view.container.textContent).toContain(t('panel.watch.empty'))
  })
})

describe('BreakpointsPanel', () => {
  it('shows the empty state, toggles rows, and displays the unverified reason', () => {
    const onToggle = vi.fn()
    const empty = render(<BreakpointsPanel breakpoints={[]} t={t} onToggle={onToggle} />)
    expect(empty.container.textContent).toContain(t('panel.breakpoints.empty'))
    const view = render(<BreakpointsPanel
      breakpoints={[
        { id: 1, path: 'src/a.ts', line: 4, verified: true, enabled: true },
        { id: 2, path: 'src/b.ts', line: 9, verified: false, enabled: false, message: 'no code' },
      ]}
      t={t}
      onToggle={onToggle}
    />)
    expect(view.container.textContent).toContain('src/a.ts:4')
    expect(view.container.textContent).toContain('Unverified: no code')
    fireEvent.click(view.getByLabelText('Enable or disable the breakpoint on line 9'))
    expect(onToggle).toHaveBeenCalledWith(2)
  })
})

describe('ExceptionFiltersPanel', () => {
  it('hides entirely without support and toggles filters with support', () => {
    const onToggle = vi.fn()
    const hidden = render(<ExceptionFiltersPanel supported={false} filters={[]} t={t} onToggle={onToggle} />)
    expect(hidden.container.querySelector('[data-debug-panel="exceptions"]')).toBeNull()
    const view = render(<ExceptionFiltersPanel
      supported
      filters={[{ id: 'uncaught', label: 'Uncaught exceptions', enabled: true }]}
      t={t}
      onToggle={onToggle}
    />)
    fireEvent.click(view.getByLabelText('Enable or disable the exception filter Uncaught exceptions'))
    expect(onToggle).toHaveBeenCalledWith('uncaught')
  })
})

describe('ConsolePanel', () => {
  it('shows the empty state, entries, and the dropped notice', () => {
    const empty = render(<ConsolePanel entries={[]} dropped={0} t={t} />)
    expect(empty.container.textContent).toContain(t('panel.console.empty'))
    const view = render(<ConsolePanel entries={[{ seq: 1, text: 'hello ' }, { seq: 2, text: 'world' }]} dropped={3} t={t} />)
    expect(view.container.querySelector('pre')?.textContent).toBe('hello world')
    expect(view.container.querySelector('[data-debug-console-truncated]')?.textContent).toContain('3')
  })
})

describe('capability-gated inspection panels', () => {
  it('hide every panel without support', () => {
    const hidden = render(<div>
      <ModulesPanel supported={false} modules={[]} t={t} />
      <LoadedSourcesPanel supported={false} sources={[]} t={t} />
      <DisassemblyPanel supported={false} instructions={[]} t={t} />
      <MemoryPanel supported={false} memory={[]} t={t} />
    </div>)
    expect(hidden.container.querySelector('[data-debug-panel]')).toBeNull()
  })

  it('render modules, sources, instructions, and read-only memory with support', () => {
    const view = render(<div>
      <ModulesPanel
        supported
        modules={[{ name: 'main', version: '1.0.0', path: 'out/main.js' }, { name: 'bare' }]}
        t={t}
      />
      <LoadedSourcesPanel supported sources={[{ name: 'a.ts', path: 'src/a.ts' }, { name: 'vm' }]} t={t} />
      <DisassemblyPanel supported instructions={[{ address: '0x10', instruction: 'push rbp' }]} t={t} />
      <MemoryPanel supported memory={[{ address: '0xff00', contents: '48 65 6c' }]} t={t} />
    </div>)
    expect(view.container.querySelector('[data-debug-panel="modules"]')?.textContent).toContain('main 1.0.0 out/main.js')
    expect(view.container.querySelector('[data-debug-panel="modules"]')?.textContent).toContain('bare')
    expect(view.container.querySelector('[data-debug-panel="sources"]')?.textContent).toContain('a.ts src/a.ts')
    expect(view.container.querySelector('[data-debug-panel="sources"]')?.textContent).toContain('vm')
    expect(view.container.querySelector('[data-debug-panel="disassembly"]')?.textContent).toContain('0x10  push rbp')
    expect(view.container.querySelector('[data-debug-panel="memory"]')?.textContent).toContain(t('panel.memory.writeDisabled'))
    expect(view.container.querySelector('[data-debug-panel="memory"]')?.textContent).toContain('48 65 6c')
  })
})

describe('NotificationToggle', () => {
  it('routes both directions of the toggle', () => {
    const onChange = vi.fn()
    const view = render(<NotificationToggle checked t={t} onChange={onChange} />)
    expect(view.container.querySelector('[data-debug-notifications="on"]')).not.toBeNull()
    fireEvent.click(view.getByLabelText(t('notifications.agent')))
    expect(onChange).toHaveBeenCalledWith(false)
  })
})

describe('AdapterSettingsPanel', () => {
  it('renders adapter facts and routes every action', () => {
    const gestures = {
      onInstall: vi.fn(),
      onUpdate: vi.fn(),
      onUninstall: vi.fn(),
      onSelfTest: vi.fn(),
    }
    const view = render(<AdapterSettingsPanel
      installed={[{
        providerId: 'node', version: '1.140.0', platform: 'darwin-arm64', license: 'MIT',
        sha256: '27dab92937ec1ab35821ae955aac867544fe06a1b6307229049f2d789af10968',
      }]}
      overridePath="/adapters/override"
      busy={false}
      t={t}
      {...gestures}
    />)
    expect(view.container.textContent).toContain('Version 1.140.0')
    expect(view.container.textContent).toContain('Platform darwin-arm64')
    expect(view.container.textContent).toContain('License MIT')
    expect(view.container.textContent).toContain('SHA-256 27dab92937ec1ab35821ae955aac867544fe06a1b6307229049f2d789af10968')
    expect(view.container.textContent).toContain('Override path /adapters/override')
    expect(view.container.querySelector('[data-debug-adapter-busy]')).toBeNull()
    fireEvent.click(view.container.querySelector('[data-debug-adapter-install]') ?? new HTMLElement())
    fireEvent.click(view.container.querySelector('[data-debug-adapter-update]') ?? new HTMLElement())
    fireEvent.click(view.container.querySelector('[data-debug-adapter-uninstall]') ?? new HTMLElement())
    fireEvent.click(view.container.querySelector('[data-debug-adapter-self-test]') ?? new HTMLElement())
    expect(gestures.onInstall).toHaveBeenCalledWith('node')
    expect(gestures.onUpdate).toHaveBeenCalledWith('node')
    expect(gestures.onUninstall).toHaveBeenCalledWith('node')
    expect(gestures.onSelfTest).toHaveBeenCalledWith('node')
  })

  it('marks busy state and omits the override line when unset', () => {
    const view = render(<AdapterSettingsPanel
      installed={[]} busy t={t}
      onInstall={() => {}} onUpdate={() => {}} onUninstall={() => {}} onSelfTest={() => {}}
    />)
    expect(view.container.querySelector('[data-debug-adapter-busy]')).not.toBeNull()
    expect(view.container.textContent).not.toContain('Override path')
  })
})
