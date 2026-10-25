/**
 * Debug tool rendering: workspace-relative locations, bounded values, and
 * preserved truncation totals for model-facing results.
 * @module @deepseek-ai/dsh-tool-debug/render
 */

/** One rendered stack frame with a workspace-relative source path. */
export interface RenderedFrame {
  readonly id: string
  readonly name: string
  readonly source?: string
  readonly line?: number
  readonly column?: number
}

/** One rendered stack-trace view. */
export interface RenderedStackTrace {
  readonly frames: readonly RenderedFrame[]
  readonly truncated: boolean
  readonly total: number
}

/** One rendered variable row. */
export interface RenderedVariable {
  readonly name: string
  readonly value: string
  readonly variablesReference: number
}

/** One rendered variables view. */
export interface RenderedVariables {
  readonly variables: readonly RenderedVariable[]
}

/** Strip the workspace root prefix from an absolute source path. */
function relativize(absolute: string, workspaceRoot: string): string {
  const prefix = workspaceRoot.endsWith('/') ? workspaceRoot : `${workspaceRoot}/`
  return absolute.startsWith(prefix) ? absolute.slice(prefix.length) : absolute
}

/** One raw stack frame as inspection results carry it. */
export interface RawFrame {
  readonly id: string
  readonly name: string
  readonly source?: string
  readonly line?: number
  readonly column?: number
}

/**
 * Render one stack trace with workspace-relative sources and frame caps.
 * @param view - the raw frames and whole-stack totals.
 * @param maxFrames - largest rendered frame count (default 50).
 * @returns the bounded, relativized view.
 */
export function renderStackTrace(
  view: {
    readonly workspaceRoot: string
    readonly frames: readonly RawFrame[]
    readonly truncated: boolean
    readonly total: number
  },
  maxFrames = 50,
): RenderedStackTrace {
  const rendered = view.frames.slice(0, maxFrames).map(frame => ({
    id: frame.id,
    name: frame.name,
    ...(frame.source !== undefined ? { source: relativize(frame.source, view.workspaceRoot) } : {}),
    ...(frame.line !== undefined ? { line: frame.line } : {}),
    ...(frame.column !== undefined ? { column: frame.column } : {}),
  }))
  return {
    frames: rendered,
    truncated: view.truncated || view.frames.length > maxFrames,
    total: view.total,
  }
}

/**
 * Render one variables page with per-value character caps. Truncation marks
 * the value text; the child reference survives so lazy expansion keeps working.
 * @param view - the raw variables page and its value cap.
 * @param view.variables - the raw variable rows.
 * @param view.maxValueChars - largest value length before ellipsis (default 200).
 * @returns the bounded view.
 */
export function renderVariables(
  view: {
    readonly variables: readonly { readonly name: string; readonly value: string; readonly variablesReference: number }[]
    readonly maxValueChars?: number
  },
): RenderedVariables {
  const maxValueChars = view.maxValueChars ?? 200
  return {
    variables: view.variables.map(variable => ({
      name: variable.name,
      value: variable.value.length > maxValueChars
        ? `${variable.value.slice(0, maxValueChars)}… (truncated ${variable.value.length} chars)`
        : variable.value,
      variablesReference: variable.variablesReference,
    })),
  }
}
