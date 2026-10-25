/**
 * Debug tool rendering: workspace-relative stack locations, preserved
 * truncation totals, and value caps that keep child references.
 */

import { describe, expect, it } from 'vitest'
import { renderStackTrace, renderVariables } from '../src/render.ts'

describe('debug tool rendering', () => {
  it('relativizes paths and preserves the truncation total', () => {
    const view = renderStackTrace({ workspaceRoot: '/ws', frames: [
      { id: '1', name: 'main', source: '/ws/src/a.ts', line: 4, column: 2 },
    ], truncated: true, total: 20 })
    expect(view.frames[0]).toMatchObject({ source: 'src/a.ts', line: 4, column: 2 })
    expect(view).toMatchObject({ truncated: true, total: 20 })
  })

  it('caps values without dropping child references', () => {
    const view = renderVariables({ variables: [
      { name: 'big', value: 'x'.repeat(100), variablesReference: 7 },
    ], maxValueChars: 10 })
    const rendered = view.variables[0]
    expect(rendered?.value).toContain('truncated')
    expect(rendered?.variablesReference).toBe(7)
  })
})
