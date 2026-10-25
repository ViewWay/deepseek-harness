// @vitest-environment jsdom
/** The workbench page: regions, responsive collapse, stop announcement, config picker, panel docks. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { DebugError } from '@deepseek-ai/dsh-debug'
import { createDebugViewStore } from '@deepseek-ai/dsh-client-ui-debug/src/client/store.ts'
import type { DebugViewState } from '@deepseek-ai/dsh-client-ui-debug/src/client/store.ts'
import { en as debugEn } from '@deepseek-ai/dsh-client-ui-debug/src/client/locales.ts'
import { Workbench, parseWorkbenchConfigs } from '../src/client/Workbench.tsx'
import type { WorkbenchConfigResult, WorkbenchDebugControls } from '../src/client/Workbench.tsx'
import type { WorkbenchPanelContribution } from '../src/client/workbench-panels.ts'
import { openWorkbenchPanel } from '../src/client/layout.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(en)

/** A panel contribution whose component marks its render. */
function panel(id: string): WorkbenchPanelContribution {
  return {
    id, title: () => id, icon: 'stack',
    component: () => <p data-panel-body={id}>{id} body</p>,
    defaultLocation: 'right',
  }
}

const emptyState: DebugViewState = createDebugViewStore().state

const debug: WorkbenchDebugControls = {
  state: emptyState, t: makeTranslate(debugEn), notifications: false, actor: 'user',
  onAction: () => {}, onNotificationsChange: () => {}, onSelectSession: () => {}, onSelectThread: () => {},
}

const baseConfigs: WorkbenchConfigResult = { ok: true, configurations: [], compounds: [] }

const base = {
  layout: openWorkbenchPanel(openWorkbenchPanel(
    { panels: [] }, 'debug.stack', 'right',
  ), 'debug.console', 'bottom'),
  onClosePanel: () => {},
  debug,
  configs: baseConfigs,
  selectedConfig: undefined,
  onSelectConfig: () => {},
  onDebugCurrentFile: () => {},
  onAddConfiguration: () => {},
  narrow: false,
  focusOnStop: false,
  reducedMotion: false,
  stop: undefined,
  files: <p data-embed="files">files</p>,
  editor: <p data-embed="editor">editor</p>,
  terminal: <p data-embed="terminal">terminal</p>,
  t,
}

describe('parseWorkbenchConfigs', () => {
  const context = { workspaceFolder: '/ws', file: '/ws/a.ts', env: {} }

  it('treats an absent file as an empty configuration set', () => {
    expect(parseWorkbenchConfigs(undefined, context)).toEqual({ ok: true, configurations: [], compounds: [] })
  })

  it('parses a valid file into configurations', () => {
    const source = JSON.stringify({
      version: 1,
      configurations: [{ name: 'Node: current file', type: 'node', request: 'launch', program: '${file}' }],
    })
    const parsed = parseWorkbenchConfigs(source, context)
    expect(parsed.ok && parsed.configurations[0]?.name).toBe('Node: current file')
  })

  it('reports the typed validation failure for a malformed file', () => {
    const parsed = parseWorkbenchConfigs('{"version":2,"configurations":[]}', context)
    expect(!parsed.ok && parsed.error.code).toBe('DEBUG_INVALID_CONFIG')
  })
})

describe('Workbench', () => {
  it('renders the page, regions, embeds, and right-docked panels', () => {
    const view = render(<Workbench {...base} panels={[panel('debug.stack'), panel('debug.console')]} />)
    expect(view.getByLabelText('Debug workbench')).toBeTruthy()
    expect(view.getByLabelText('Files').textContent).toContain('files')
    expect(view.getByLabelText('Editor').textContent).toContain('editor')
    expect(view.getByLabelText('Terminal').textContent).toContain('terminal')
    expect(view.getByLabelText('Debug panels').textContent).toContain('debug.stack body')
  })

  it('keeps the announcement in a live region and never moves focus on a stop', () => {
    const view = render(<Workbench
      {...base}
      panels={[]}
      stop={{ reason: 'breakpoint', location: 'src/a.ts:4' }}
    />)
    const region = view.getByRole('status')
    expect(region.textContent).toBe('Stopped: breakpoint at src/a.ts:4')
    expect(document.activeElement).toBe(document.body)
    expect(view.container.querySelector('[data-workbench]')?.getAttribute('data-focus-policy')).toBe('retain')
  })

  it('collapses side panels into a bottom tab strip when narrow', () => {
    const view = render(<Workbench {...base} panels={[panel('debug.stack')]} narrow />)
    const frame = view.container.querySelector('[data-workbench]')
    expect(frame?.getAttribute('data-narrow')).toBe('true')
    expect(view.getByRole('tab', { name: 'debug.stack' })).toBeTruthy()
    expect(view.getByText('Side panels are collapsed into tabs; open the desktop app for the full layout.')).toBeTruthy()
  })

  it('lists configurations in the picker and offers the two built-in actions', () => {
    const configs: WorkbenchConfigResult = {
      ok: true,
      configurations: [{ name: 'Node: current file', type: 'node', request: 'launch', program: '/ws/a.ts' }],
      compounds: [],
    }
    const onDebugCurrentFile = vi.fn()
    const view = render(<Workbench
      {...base}
      panels={[]}
      configs={configs}
      selectedConfig="Node: current file"
      onDebugCurrentFile={onDebugCurrentFile}
    />)
    const picker = view.getByLabelText('Debug configuration') as HTMLSelectElement
    expect(picker.value).toBe('Node: current file')
    view.getByText('Debug current file').click()
    expect(onDebugCurrentFile).toHaveBeenCalledOnce()
    expect(view.getByText('Add configuration')).toBeTruthy()
  })

  it('surfaces a validation failure from the config file', () => {
    const configs: WorkbenchConfigResult = {
      ok: false,
      error: new DebugError('debug launch configuration: version must be 1', 'DEBUG_INVALID_CONFIG', {
        detail: 'version must be 1',
      }),
    }
    const view = render(<Workbench {...base} panels={[]} configs={configs} />)
    expect(view.getByText('Invalid debug configuration: version must be 1')).toBeTruthy()
  })
})
