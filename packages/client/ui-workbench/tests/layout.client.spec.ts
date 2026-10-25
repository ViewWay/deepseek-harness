import { describe, expect, it } from 'vitest'
import { createWorkbenchLayout, findPanel, openWorkbenchPanel } from '../src/client/layout.ts'

describe('workbench layout', () => {
  it('opens a panel in the requested location and survives a round trip', () => {
    const layout = openWorkbenchPanel(createWorkbenchLayout(), 'debug.stack', 'right')
    expect(findPanel(layout, 'debug.stack')?.location).toBe('right')
    expect(JSON.parse(JSON.stringify(layout))).toEqual(layout)
  })
})
