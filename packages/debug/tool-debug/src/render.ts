/**
 * Debug tool rendering: workspace-relative locations, bounded values, and
 * preserved truncation totals for model-facing results.
 * @module @deepseek-ai/dsh-tool-debug/render
 */

import type { DebugStackTrace } from '@deepseek-ai/dsh-debug'

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
  readonly variablesReference: string
  /** Adapter-assigned memory anchor, kept so read_memory/disassemble stay reachable. */
  readonly memoryReference?: string
}

/** One rendered variables view. */
export interface RenderedVariables {
  readonly variables: readonly RenderedVariable[]
}

/** Strip the workspace root prefix from an absolute source path; an empty root means the path is already relative. */
function relativize(absolute: string, workspaceRoot: string): string {
  if (workspaceRoot === '') return absolute
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
 * Render one seam stack-trace page. The seam reports sources already
 * workspace-relative, so this applies the shared frame cap and totals without
 * re-relativizing.
 * @param trace - the seam's stack page with whole-stack totals.
 * @param maxFrames - largest rendered frame count (default 50).
 * @returns the bounded view with the seam's paths unchanged.
 */
export function renderSeamStackTrace(trace: DebugStackTrace, maxFrames = 50): RenderedStackTrace {
  return renderStackTrace({
    workspaceRoot: '',
    frames: trace.frames.map(frame => ({
      id: frame.id,
      name: frame.name,
      ...(frame.source !== undefined ? { source: frame.source.workspaceRelativePath } : {}),
      ...(frame.line !== undefined ? { line: frame.line } : {}),
      ...(frame.column !== undefined ? { column: frame.column } : {}),
    })),
    truncated: trace.truncated,
    total: trace.totalFrames,
  }, maxFrames)
}

/**
 * Bound one value string with the shared per-value character cap.
 * @param value - the raw value text.
 * @param maxValueChars - largest value length before ellipsis (default 200).
 * @returns the value, with the truncation marker and original length when capped.
 */
export function boundValue(value: string, maxValueChars = 200): string {
  return value.length > maxValueChars
    ? `${value.slice(0, maxValueChars)}… (truncated ${value.length} chars)`
    : value
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
    readonly variables: readonly {
      readonly name: string
      readonly value: string
      readonly variablesReference: string
      readonly memoryReference?: string
    }[]
    readonly maxValueChars?: number
  },
): RenderedVariables {
  return {
    variables: view.variables.map(variable => ({
      name: variable.name,
      value: boundValue(variable.value, view.maxValueChars ?? 200),
      variablesReference: variable.variablesReference,
      ...(variable.memoryReference !== undefined ? { memoryReference: variable.memoryReference } : {}),
    })),
  }
}
