/**
 * Persistence for workspace breakpoint sets.
 *
 * A store maps one `(workspaceId, workspace-relative path)` pair to the
 * complete replacement set of breakpoints for that file. The in-memory store
 * backs tests; the storage-domain store persists through a versioned
 * `debug_breakpoints` domain whose records are JSON-encoded breakpoint sets
 * keyed by `workspaceId\u0000path`.
 * @module @deepseek-ai/dsh-debug/breakpoint-store
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { DebugBreakpointInput } from './types.ts'

/** Persistence contract for one workspace's per-file breakpoint sets. */
export interface BreakpointStore {
  /**
   * Replaces the stored set for one file.
   *
   * @param workspaceId Owning workspace.
   * @param path Workspace-relative file path, already normalized.
   * @param breakpoints Complete replacement set; empty clears the file.
   */
  save(workspaceId: string, path: string, breakpoints: readonly DebugBreakpointInput[]): Promise<void>
  /**
   * Reads the stored set for one file.
   *
   * @param workspaceId Owning workspace.
   * @param path Workspace-relative file path, already normalized.
   * @returns The stored set; empty when nothing is stored.
   */
  load(workspaceId: string, path: string): Promise<readonly DebugBreakpointInput[]>
}

/** The versioned storage domain backing persisted breakpoint sets. */
export const breakpointDomain = defineDomain({
  name: 'debug_breakpoints',
  version: 1,
  tables: { files: domainTable<string, string>(z.string()) },
})

const NO_KEY = '\u0000'

function storageKey(workspaceId: string, path: string): string {
  return workspaceId + NO_KEY + path
}

/** In-memory store for tests and un-persisted compositions. */
export class MemoryBreakpointStore implements BreakpointStore {
  private readonly files = new Map<string, readonly DebugBreakpointInput[]>()

  save(workspaceId: string, path: string, breakpoints: readonly DebugBreakpointInput[]): Promise<void> {
    this.files.set(storageKey(workspaceId, path), [...breakpoints])
    return Promise.resolve()
  }

  load(workspaceId: string, path: string): Promise<readonly DebugBreakpointInput[]> {
    return Promise.resolve([...this.files.get(storageKey(workspaceId, path)) ?? []])
  }
}

/** Persists breakpoint sets in the `debug_breakpoints` storage domain. */
export class StorageBreakpointStore implements BreakpointStore {
  private readonly table: { get(key: string): string | undefined; put(key: string, value: string): Promise<void> }

  /**
   * @param table The opened `files` table of {@link breakpointDomain}.
   */
  constructor(table: { get(key: string): string | undefined; put(key: string, value: string): Promise<void> }) {
    this.table = table
  }

  async save(workspaceId: string, path: string, breakpoints: readonly DebugBreakpointInput[]): Promise<void> {
    await this.table.put(storageKey(workspaceId, path), JSON.stringify([...breakpoints]))
  }

  load(workspaceId: string, path: string): Promise<readonly DebugBreakpointInput[]> {
    const encoded = this.table.get(storageKey(workspaceId, path))
    if (encoded === undefined) return Promise.resolve([])
    const parsed: unknown = JSON.parse(encoded)
    if (!Array.isArray(parsed)) throw new Error('persisted breakpoint set is not an array')
    return Promise.resolve(parsed as readonly DebugBreakpointInput[])
  }
}
