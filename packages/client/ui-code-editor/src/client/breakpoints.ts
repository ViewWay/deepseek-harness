/**
 * Breakpoint gutter state for one file.
 *
 * Lines are 1-based. A gutter click on a line that already holds a
 * breakpoint removes it. Otherwise the click adds a plain breakpoint —
 * with one move exception: when the file holds exactly one breakpoint and
 * it carries configuration (condition, hit count, or log message), the
 * click relocates that breakpoint to the clicked line, preserving its
 * configuration. This is the gutter's move interaction for a configured
 * breakpoint, whose placement follows the click until it sits somewhere
 * plain. All other fields round-trip untouched.
 */

/** One gutter breakpoint with its optional configuration. */
export interface EditorBreakpoint {
  /** 1-based line the breakpoint sits on. */
  readonly line: number
  /** Pause condition expression. */
  readonly condition?: string
  /** Hit-count condition expression. */
  readonly hitCondition?: string
  /** Log-point message template. */
  readonly logMessage?: string
  /** False while the breakpoint is switched off. */
  readonly enabled?: boolean
}

const isConfigured = (breakpoint: EditorBreakpoint): boolean =>
  breakpoint.condition !== undefined
  || breakpoint.hitCondition !== undefined
  || breakpoint.logMessage !== undefined

/**
 * Apply one gutter click to a file's breakpoints.
 * @param breakpoints - the file's current breakpoints, any order.
 * @param line - the 1-based line the click targeted.
 * @returns the next breakpoint list; input order is preserved.
 */
export function toggleBreakpoint(
  breakpoints: readonly EditorBreakpoint[],
  line: number,
): EditorBreakpoint[] {
  const withoutLine = breakpoints.filter(breakpoint => breakpoint.line !== line)
  if (withoutLine.length !== breakpoints.length) return withoutLine
  const only = breakpoints[0]
  if (breakpoints.length === 1 && only !== undefined && isConfigured(only)) {
    return [{ ...only, line }]
  }
  return [...breakpoints, { line }]
}
