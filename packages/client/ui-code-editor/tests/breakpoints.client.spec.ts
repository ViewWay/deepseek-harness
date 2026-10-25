import { describe, expect, it } from 'vitest'
import { toggleBreakpoint } from '../src/client/breakpoints.ts'

describe('breakpoint gutter state', () => {
  it('toggles one line without touching others', () => {
    expect(toggleBreakpoint([{ line: 2 }], 4)).toEqual([{ line: 2 }, { line: 4 }])
    expect(toggleBreakpoint([{ line: 2 }, { line: 4 }], 4)).toEqual([{ line: 2 }])
  })

  it('keeps condition and log message when moving a breakpoint', () => {
    const moved = toggleBreakpoint([{ line: 2, condition: 'x > 0', logMessage: 'x={x}' }], 5)
    expect(moved).toEqual([{ line: 5, condition: 'x > 0', logMessage: 'x={x}' }])
  })

  it('drops a breakpoint without disturbing its configured neighbors', () => {
    const before = [
      { line: 2, condition: 'x > 0' },
      { line: 6, logMessage: 'here' },
    ]
    expect(toggleBreakpoint(before, 6)).toEqual([{ line: 2, condition: 'x > 0' }])
  })

  it('adds a plain breakpoint beside configured ones instead of relocating them', () => {
    const before = [
      { line: 2, condition: 'x > 0' },
      { line: 3, logMessage: 'here' },
    ]
    expect(toggleBreakpoint(before, 8)).toEqual([...before, { line: 8 }])
  })
})
