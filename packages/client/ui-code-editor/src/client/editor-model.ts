/**
 * One open editor buffer's save-facing state.
 *
 * The model owns exactly what a guarded write needs: the opening version,
 * the file's line separator, the dirty flag against the last saved text, and
 * the disk version last seen through the change feed or a rejected save.
 * A conflict is derived, never stored: while the buffer is dirty and the
 * known disk version differs from the model's baseline, `savePayload`
 * refuses until the user picks reload, keep-mine, or save-as. Buffers
 * normalize to LF internally and restore the file's separator on save.
 */

/** Line separator a file was opened with; the buffer normalizes to LF. */
export type EditorEol = '\n' | '\r\n'

/** What a save hands to the guarded `writeText` Remote call. */
export interface EditorSavePayload {
  /** Workspace-relative save target. */
  readonly path: string
  /** Full replacement text in the file's original line separator. */
  readonly content: string
  /** The baseline version the guard compares against, or null to create. */
  readonly expectedVersion: string | null
}

/** The two versions a version conflict names, for the choice view. */
export interface EditorConflict {
  /** The baseline the blocked save would have carried. */
  readonly openingVersion: string | null
  /** The disk version that displaced it. */
  readonly diskVersion: string
}

/** A save was attempted while a version conflict awaits the user's choice. */
export class EditorSaveBlockedError extends Error {
  override readonly name = 'EditorSaveBlockedError'
  /** Stable code the UI routes on. */
  readonly code = 'editor/save-blocked'
  /** The conflicting versions named by the refusal. */
  readonly conflict: EditorConflict
  /**
   * @param conflict - the baseline and disk versions that collided.
   */
  constructor(conflict: EditorConflict) {
    super('save blocked until the version conflict is resolved')
    this.conflict = conflict
  }
}

/** Opening facts for one editor buffer. */
export interface EditorModelInit {
  /** Workspace-relative file path. */
  readonly path: string
  /** File text in its original line separator. */
  readonly text: string
  /** Version observed when the file was opened. */
  readonly version: string
  /** Line separator to restore on save. */
  readonly eol: EditorEol
}

/** Save-facing state of one open buffer. */
export interface EditorModel {
  /** Current workspace-relative save target. */
  readonly path: string
  /** Line separator restored on save. */
  readonly eol: EditorEol
  /** Baseline version the next save carries, or null after save-as. */
  readonly version: string | null
  /** Buffer text normalized to LF. */
  readonly text: string
  /** True while the buffer differs from the last saved text. */
  readonly dirty: boolean
  /** True while the disk version differs from the baseline. */
  readonly diskChanged: boolean
  /** The pending conflict, or undefined while saves may proceed. */
  readonly conflict: EditorConflict | undefined
  /**
   * Replace the buffer. Same text leaves the dirty flag unchanged.
   * @param text - new buffer text in LF form.
   */
  setValue(text: string): void
  /**
   * The guarded-write request for the current buffer.
   * @throws EditorSaveBlockedError while a version conflict is pending.
   */
  savePayload(): EditorSavePayload
  /**
   * Record a successful save.
   * @param version - the version the write returned.
   * @param text - the saved text in its original line separator.
   */
  markSaved(version: string, text: string): void
  /**
   * Record a new disk version, from the change feed or a rejected save.
   * @param version - the version now on disk.
   */
  markDiskChanged(version: string): void
  /** Adopt the disk content; clears dirty, the disk-change flag, and the conflict. */
  resolveReload(text: string): void
  /** Keep the buffer; the next save overwrites the disk version. */
  resolveKeepMine(): void
  /**
   * Retarget the save; the next write creates the new path.
   * @param path - new workspace-relative save target.
   */
  resolveSaveAs(path: string): void
}

const toLf = (text: string): string => text.replace(/\r\n?/g, '\n')

/**
 * Create one buffer's save-facing model.
 * @param init - opening path, text, version, and line separator.
 * @returns the buffer's mutable model.
 */
export function createEditorModel(init: EditorModelInit): EditorModel {
  let path = init.path
  let version: string | null = init.version
  let savedText = toLf(init.text)
  let buffer = savedText
  let diskVersion: string | undefined
  let diskChanged = false
  const pendingConflict = (): EditorConflict | undefined =>
    buffer !== savedText && diskVersion !== undefined && diskVersion !== version
      ? { openingVersion: version, diskVersion }
      : undefined
  return {
    get path() { return path },
    get eol() { return init.eol },
    get version() { return version },
    get text() { return buffer },
    get dirty() { return buffer !== savedText },
    get diskChanged() { return diskChanged },
    get conflict() { return pendingConflict() },
    setValue(text) { buffer = toLf(text) },
    savePayload() {
      const conflict = pendingConflict()
      if (conflict !== undefined) throw new EditorSaveBlockedError(conflict)
      return {
        path,
        content: init.eol === '\r\n' ? buffer.replace(/\n/g, '\r\n') : buffer,
        expectedVersion: version,
      }
    },
    markSaved(savedVersion, text) {
      version = savedVersion
      diskVersion = savedVersion
      diskChanged = false
      savedText = toLf(text)
    },
    markDiskChanged(newDiskVersion) {
      diskVersion = newDiskVersion
      diskChanged = true
    },
    resolveReload(text) {
      buffer = toLf(text)
      savedText = buffer
      if (diskVersion === undefined) return
      version = diskVersion
      diskChanged = false
    },
    resolveKeepMine() {
      if (diskVersion === undefined) return
      version = diskVersion
    },
    resolveSaveAs(newPath) {
      path = newPath
      version = null
      diskVersion = undefined
      diskChanged = false
    },
  }
}
