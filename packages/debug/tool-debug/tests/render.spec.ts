/**
 * Debug tool rendering: workspace-relative stack locations, preserved
 * truncation totals, and value caps that keep child references.
 */

import { describe, expect, it } from 'vitest'
import { DebugFrameId } from '@deepseek-ai/dsh-debug'
import { boundValue, renderSeamStackTrace, renderStackTrace, renderVariables } from '../src/render.ts'

describe('debug tool rendering', () => {
  it('relativizes paths and preserves the truncation total', () => {
    const view = renderStackTrace({ workspaceRoot: '/ws', frames: [
      { id: '1', name: 'main', source: '/ws/src/a.ts', line: 4, column: 2 },
    ], truncated: true, total: 20 })
    expect(view.frames[0]).toMatchObject({ source: 'src/a.ts', line: 4, column: 2 })
    expect(view).toMatchObject({ truncated: true, total: 20 })
  })

  it('renders a seam stack page without re-relativizing its paths', () => {
    const view = renderSeamStackTrace({
      frames: [{ id: DebugFrameId('1'), name: 'main', source: { workspaceRelativePath: '/ext/b.ts', absolutePath: '/ext/b.ts' }, line: 4 }],
      totalFrames: 60,
      truncated: false,
    })
    expect(view.frames[0]).toMatchObject({ id: '1', source: '/ext/b.ts', line: 4 })
    expect(view).toMatchObject({ truncated: false, total: 60 })
  })

  it('caps a seam stack page at the shared frame cap', () => {
    const frames = Array.from({ length: 51 }, (_, index) => ({ id: DebugFrameId(String(index)), name: `frame-${index}` }))
    const view = renderSeamStackTrace({ frames, totalFrames: 51, truncated: false })
    expect(view.frames).toHaveLength(50)
    expect(view).toMatchObject({ truncated: true, total: 51 })
  })

  it('caps values without dropping child references', () => {
    const view = renderVariables({ variables: [
      { name: 'big', value: 'x'.repeat(100), variablesReference: '7' },
    ], maxValueChars: 10 })
    const rendered = view.variables[0]
    expect(rendered?.value).toContain('truncated')
    expect(rendered?.variablesReference).toBe('7')
  })

  it('keeps the memory anchor and the untruncated value on variable rows', () => {
    const view = renderVariables({ variables: [
      { name: 'buffer', value: 'Uint8Array(3)', variablesReference: '0', memoryReference: '0x40' },
    ] })
    expect(view.variables[0]).toEqual({ name: 'buffer', value: 'Uint8Array(3)', variablesReference: '0', memoryReference: '0x40' })
  })

  it('bounds a single value with the shared cap', () => {
    expect(boundValue('short')).toBe('short')
    expect(boundValue('x'.repeat(25), 10)).toBe('xxxxxxxxxx… (truncated 25 chars)')
  })
})
