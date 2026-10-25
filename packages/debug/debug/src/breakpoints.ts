/**
 * The breakpoint registry: validated per-file breakpoint sets, persisted
 * through a {@link BreakpointStore}, applied to every bound session of the
 * matching workspace, with adapter verification recorded per session.
 *
 * One `setFile` call replaces the file's complete set atomically: validation
 * and the limit check run before anything is persisted or sent, the store is
 * updated first, then every bound applier runs and its
 * `applied`/`rejected` result is returned (and published as
 * `breakpoint/changed` when a publisher is configured).
 * @module @deepseek-ai/dsh-debug/breakpoints
 */
import { DebugError } from './error.ts'
import type { DebugSessionId } from './brand.ts'
import type { DebugBreakpointInput, DebugBreakpointResult } from './types.ts'
import type { DebugSessionRecord } from './session.ts'
import type { BreakpointStore } from './breakpoint-store.ts'

export { MemoryBreakpointStore, StorageBreakpointStore, breakpointDomain } from './breakpoint-store.ts'
export type { BreakpointStore } from './breakpoint-store.ts'

/** Default per-file breakpoint ceiling; compositions pass their configured value. */
export const DEFAULT_MAX_BREAKPOINTS_PER_FILE = 500

/** Callable that applies one file's breakpoints to a live session. */
export interface BreakpointApplier {
  /**
   * @param request The relative source path and the complete replacement set.
   * @returns The adapter's verification split into applied and rejected.
   */
  (request: { readonly source: string; readonly breakpoints: readonly DebugBreakpointInput[] }): Promise<DebugBreakpointResult>
}

/** Registry construction options. */
export interface BreakpointRegistryOptions {
  /** Per-file breakpoint ceiling; defaults to {@link DEFAULT_MAX_BREAKPOINTS_PER_FILE}. */
  readonly maxPerFile?: number
  /** Live-event publisher invoked after each session's result commits. */
  readonly publish?: (event: { readonly kind: 'breakpoint/changed'; readonly sessionId: DebugSessionId; readonly workspaceId: string; readonly result: DebugBreakpointResult }) => void
}

/** One session's application outcome of a `setFile` call. */
export interface BreakpointSessionApplication {
  readonly sessionId: DebugSessionId
  readonly sessionResults: DebugBreakpointResult
}

interface BoundSession {
  readonly record: DebugSessionRecord
  readonly applier: BreakpointApplier
}

/**
 * Validates, persists, and applies per-file breakpoint sets.
 */
export class BreakpointRegistry {
  private readonly store: BreakpointStore
  private readonly maxPerFile: number
  private readonly publish: BreakpointRegistryOptions['publish']
  private readonly bound = new Map<DebugSessionId, BoundSession>()

  /**
   * @param store Persistence for per-file sets.
   * @param options Limit and live-event publishing.
   */
  constructor(store: BreakpointStore, options: BreakpointRegistryOptions = {}) {
    this.store = store
    this.maxPerFile = options.maxPerFile ?? DEFAULT_MAX_BREAKPOINTS_PER_FILE
    this.publish = options.publish
  }

  /**
   * Binds one live session so later `setFile` calls reach it.
   *
   * @param record The session record providing identity and workspace scope.
   * @param applier Applies one file's set to the session's adapter.
   * @returns Disposer unbinding the session.
   */
  bindSession(record: DebugSessionRecord, applier: BreakpointApplier): () => void {
    this.bound.set(record.id, { record, applier })
    return () => {
      const bound = this.bound.get(record.id)
      if (bound?.applier === applier) this.bound.delete(record.id)
    }
  }

  /**
   * Replaces one file's breakpoint set for a workspace.
   *
   * @param workspaceId Owning workspace.
   * @param path Workspace-relative file path; normalized before use.
   * @param breakpoints Complete replacement set; empty clears the file.
   * @returns Each matched session's verification result.
   * @throws DebugError(`DEBUG_INVALID_CONFIG`) on a non-1-based line;
   *   DebugError(`DEBUG_BREAKPOINT_LIMIT`) when the set exceeds `maxPerFile`.
   */
  async setFile(
    workspaceId: string,
    path: string,
    breakpoints: readonly DebugBreakpointInput[],
  ): Promise<readonly BreakpointSessionApplication[]> {
    for (const breakpoint of breakpoints) {
      if (!Number.isInteger(breakpoint.line) || breakpoint.line < 1) {
        throw new DebugError(`breakpoint lines are 1-based, got ${breakpoint.line}`, 'DEBUG_INVALID_CONFIG')
      }
    }
    if (breakpoints.length > this.maxPerFile) {
      throw new DebugError(`${breakpoints.length} breakpoints exceed the per-file limit of ${this.maxPerFile}`, 'DEBUG_BREAKPOINT_LIMIT')
    }
    const normalized = normalizeWorkspacePath(path)
    const inputs = [...breakpoints]
    await this.store.save(workspaceId, normalized, inputs)

    const applications: BreakpointSessionApplication[] = []
    for (const { record, applier } of [...this.bound.values()]) {
      if (record.workspaceId !== workspaceId) continue
      const sessionResults = await applier({ source: normalized, breakpoints: inputs })
      applications.push({ sessionId: record.id, sessionResults })
      this.publish?.({ kind: 'breakpoint/changed', sessionId: record.id, workspaceId, result: sessionResults })
    }
    return applications
  }
}

/** Lexically normalizes a workspace-relative path (`./` and `..` segments). */
export function normalizeWorkspacePath(path: string): string {
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.join('/')
}
