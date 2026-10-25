/**
 * Client-local editor drafts: one bounded buffer per Session and path.
 *
 * Drafts survive tab switches and page refreshes, never enter the Session
 * log, and are never model-visible. The store bounds the total UTF-8 bytes
 * it retains; a write that would overflow evicts the least recently
 * written draft first, and a single draft larger than the whole budget is
 * refused, not stored. Re-putting a key replaces its draft and refreshes
 * its recency.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One stored draft. */
export interface EditorDraft {
  /** Session whose editor produced the draft. */
  readonly sessionId: SessionId
  /** Workspace-relative file path. */
  readonly path: string
  /** Draft text in LF form. */
  readonly text: string
  /** Version the draft was written against. */
  readonly version: string | null
}

/** Retention budget. */
export interface DraftStoreOptions {
  /** Inclusive cap on the total UTF-8 bytes of all retained drafts. */
  readonly maxBytes: number
}

/** What `get` returns for a retained draft. */
export interface StoredEditorDraft {
  /** Draft text in LF form. */
  readonly text: string
  /** Version the draft was written against. */
  readonly version: string | null
}

/** The draft store's complete API. */
export interface EditorDraftStore {
  /**
   * Insert or replace one draft, evicting least-recently-written drafts as
   * the budget requires; a draft larger than the budget is refused.
   * @param draft - the draft to retain.
   */
  put(draft: EditorDraft): void
  /**
   * Read one retained draft.
   * @param sessionId - Session identity half of the key.
   * @param path - workspace-relative path half of the key.
   */
  get(sessionId: SessionId, path: string): StoredEditorDraft | undefined
  /**
   * Drop one retained draft, as a save or discard does.
   * @param sessionId - Session identity half of the key.
   * @param path - workspace-relative path half of the key.
   */
  clear(sessionId: SessionId, path: string): void
}

interface Retained {
  readonly text: string
  readonly version: string | null
  readonly bytes: number
}

const encoder = new TextEncoder()

const keyOf = (sessionId: SessionId, path: string): string => sessionId + '\u0000' + path

/**
 * Create one bounded draft store.
 * @param options - the retention budget.
 * @returns the store handle; one per client, no module-level singleton.
 */
export function createDraftStore(options: DraftStoreOptions): EditorDraftStore {
  const drafts = new Map<string, Retained>()
  let total = 0
  return {
    put(draft) {
      const bytes = encoder.encode(draft.text).length
      if (bytes > options.maxBytes) return
      const key = keyOf(draft.sessionId, draft.path)
      const replaced = drafts.get(key)
      if (replaced !== undefined) {
        drafts.delete(key)
        total -= replaced.bytes
      }
      while (total + bytes > options.maxBytes) {
        const oldest = drafts.keys().next()
        if (oldest.done === true) break
        const evicted = drafts.get(oldest.value)
        drafts.delete(oldest.value)
        total -= evicted?.bytes ?? 0
      }
      drafts.set(key, { text: draft.text, version: draft.version, bytes })
      total += bytes
    },
    get(sessionId, path) {
      const retained = drafts.get(keyOf(sessionId, path))
      if (retained === undefined) return undefined
      return { text: retained.text, version: retained.version }
    },
    clear(sessionId, path) {
      const key = keyOf(sessionId, path)
      const retained = drafts.get(key)
      if (retained === undefined) return
      drafts.delete(key)
      total -= retained.bytes
    },
  }
}
