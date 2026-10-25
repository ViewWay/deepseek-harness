/**
 * The editor's asynchronous half: opening files, guarded saves, and
 * breakpoint application over the Client Remote namespaces.
 *
 * The component never awaits anything; the workbench wiring calls these
 * functions and folds the outcomes into editor state. Opening decodes UTF-8
 * strictly and preserves the file's line separator; files past the byte cap
 * or not valid UTF-8 refuse editing instead of opening half-read. A save that
 * collides on version resolves the disk's current version so the conflict
 * view can name both sides. Breakpoint application maps the editor's gutter
 * state onto the seam's per-file replacement set; switched-off breakpoints
 * stay client-side bookkeeping and never travel.
 */
import type { ClientRemote, RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { EditorBreakpoint } from './breakpoints.ts'
import type { EditorEol, EditorSavePayload } from './editor-model.ts'

/** The Client Remote slice the editor consumes. */
export interface EditorRemote {
  /** Debug namespace: guarded editor writes and per-file breakpoint sets. */
  readonly debug: Pick<ClientRemote['debug'], 'writeText' | 'breakpointsSetFile'>
  /** Workspace-files namespace: whole-file byte reads and stats. */
  readonly workspaceFiles: Pick<ClientRemote['workspaceFiles'], 'readBytes' | 'stat'>
}

/** One breakpoint as the debug seam's replacement set carries it. */
export type EditorBreakpointWire = Parameters<ClientRemote['debug']['breakpointsSetFile']>[2]

/** Inclusive byte cap on one file the editor will open. */
export interface EditorOpenLimits {
  /** Files at or below this size open; larger ones refuse editing. */
  readonly maxBytes: number
}

/** What opening one file decided. */
export type EditorOpenOutcome =
  | { readonly outcome: 'opened'; readonly text: string; readonly version: string; readonly eol: EditorEol }
  | { readonly outcome: 'too-large'; readonly bytes: number }
  | { readonly outcome: 'not-text' }
  | { readonly outcome: 'failed'; readonly failure: RemoteFailure }

/** What one guarded save decided. */
export type EditorSaveOutcome =
  | { readonly outcome: 'saved'; readonly version: string }
  | { readonly outcome: 'conflict'; readonly diskVersion: string }
  | { readonly outcome: 'failed'; readonly failure: RemoteFailure }

const utf8 = new TextDecoder('utf-8', { fatal: true })

/**
 * Read one workspace file for editing.
 * @param remote - the Client Remote slice.
 * @param sessionId - session whose workspace root resolves the path.
 * @param path - workspace-relative file path.
 * @param limits - the editor's inclusive byte cap.
 * @returns decoded text with its version and separator, or the refusal.
 */
export async function openEditorFile(
  remote: EditorRemote,
  sessionId: SessionId,
  path: string,
  limits: EditorOpenLimits,
): Promise<EditorOpenOutcome> {
  const read = await remote.workspaceFiles.readBytes(sessionId, path, {})
  if (!read.ok) return { outcome: 'failed', failure: read.error }
  const total = read.value.bytes ?? read.value.data.byteLength
  if (total > limits.maxBytes) return { outcome: 'too-large', bytes: total }
  try {
    const text = utf8.decode(read.value.data)
    return {
      outcome: 'opened',
      text,
      version: read.value.version,
      eol: text.includes('\r\n') ? '\r\n' : '\n',
    }
  } catch (error) {
    // TextDecoder rejects invalid UTF-8 with TypeError: the file is binary
    // for editing purposes and refuses to open rather than corrupting it.
    void error
    return { outcome: 'not-text' }
  }
}

/**
 * Save one buffer through the guarded write.
 * @param remote - the Client Remote slice.
 * @param sessionId - session whose workspace root resolves the path.
 * @param payload - the model's save payload.
 * @returns the new version, the conflict with the disk's version, or the failure.
 */
export async function saveEditorFile(
  remote: EditorRemote,
  sessionId: SessionId,
  payload: EditorSavePayload,
): Promise<EditorSaveOutcome> {
  const write = await remote.debug.writeText(sessionId, payload.path, payload.content, payload.expectedVersion)
  if (write.ok) return { outcome: 'saved', version: write.value.version }
  // The filesystem's wire codes cross the gateway verbatim but carry no
  // static RemoteErrorDetailsMap declaration yet; compare the code as the
  // string the wire carries until the controller declares them.
  const writeCode: string = write.error.code
  if (writeCode !== 'FS_STALE_VERSION') return { outcome: 'failed', failure: write.error }
  // The conflict view names both sides, and the wire rejection carries no
  // version: read the disk's current one.
  const stat = await remote.workspaceFiles.stat(sessionId, payload.path)
  if (!stat.ok) return { outcome: 'failed', failure: stat.error }
  return { outcome: 'conflict', diskVersion: stat.value.version }
}

/**
 * Project the gutter's breakpoints onto the seam's replacement set.
 * Switched-off breakpoints stay local and never travel.
 * @param breakpoints - the file's editor breakpoints.
 * @returns the wire replacement set.
 */
export function editorBreakpointInputs(
  breakpoints: readonly EditorBreakpoint[],
): EditorBreakpointWire {
  return breakpoints
    .filter(breakpoint => breakpoint.enabled !== false)
    .map(({ line, condition, hitCondition, logMessage }) => ({
      line,
      ...(condition !== undefined ? { condition } : {}),
      ...(hitCondition !== undefined ? { hitCondition } : {}),
      ...(logMessage !== undefined ? { logMessage } : {}),
    }))
}
