import { describe, expect, it } from 'vitest'
import { WorkbenchPanelRegistry } from '../src/client/workbench-panels.ts'

const contribution = {
  id: 'debug.stack', title: () => 'Call stack', icon: 'stack', component: () => null, defaultLocation: 'right' as const,
}

describe('WorkbenchPanelRegistry', () => {
  it('registers, lists, rejects duplicates, and releases panels', () => {
    const registry = new WorkbenchPanelRegistry()
    const dispose = registry.register(contribution)
    expect(registry.list().map(panel => panel.id)).toEqual(['debug.stack'])
    expect(() => registry.register(contribution)).toThrow(expect.objectContaining({ code: 'DEBUG_CONFLICT' }))
    dispose()
    expect(registry.list()).toEqual([])
  })
})
