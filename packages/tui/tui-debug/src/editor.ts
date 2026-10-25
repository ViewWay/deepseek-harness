/**
 * The `$EDITOR` handoff (design 9.8.4): one argv builder for the configured
 * editor command and one opener that hands the argv list to the injected
 * local process launcher. Remote workspaces use the explicitly configured
 * remote editor command; without one the caller receives the remote path for
 * copying instead of a local open that would point at the wrong machine.
 *
 * The handoff is argv-only by contract: the configured command splits into an
 * argument list and every launch takes that list — no shell, no string
 * concatenation into a command line, so editor commands can neither inject
 * nor execute shell syntax (design 9.8.3).
 * @module @deepseek-ai/dsh-tui-debug/editor
 */

import { DebugError } from '@deepseek-ai/dsh-debug'

/**
 * The launcher face the opener drives; the composition adapts
 * `ctx.subprocess` onto it. The request carries an argv list only — this
 * contract has no shell-string member, so a command line cannot be routed
 * through a shell.
 */
export interface TuiEditorLaunch {
  /**
   * Start the editor process from an argv list, without a shell.
   * @param request - `argv`, the argument list passed to the OS exec path
   * element-wise, plus an optional working directory.
   * @returns the process handle; the TUI does not wait on the editor.
   */
  start(request: { readonly argv: readonly string[]; readonly cwd?: string }): unknown
}

/** What the opener did instead of, or by, opening the editor. */
export type TuiEditorOutcome =
  | { readonly kind: 'opened'; readonly argv: readonly string[] }
  | { readonly kind: 'remote-path'; readonly path: string }
  | { readonly kind: 'unavailable' }

/**
 * Build the editor argv for one `file:line`: the configured command split on
 * whitespace, then the `+<line>` jump argument and the file path. The result
 * is an argument list for direct exec — never a shell command line; the
 * file path and line land as two standalone arguments.
 * @param editor - the configured editor command (`$EDITOR` or the remote
 * editor command); its tokens split on whitespace without a shell.
 * @param file - the file to open, in the editor's own path space.
 * @param line - the 1-based line to jump to.
 * @returns the argv list.
 * @throws {@link DebugError} `DEBUG_INVALID_CONFIG` for a blank command or a
 * non-positive non-integer line.
 */
export function editorCommand(editor: string, file: string, line: number): readonly string[] {
  if (editor.trim() === '') {
    throw new DebugError('the editor command must be a non-empty string', 'DEBUG_INVALID_CONFIG')
  }
  if (!Number.isSafeInteger(line) || line < 1) {
    throw new DebugError(`the editor line must be a positive integer, got ${String(line)}`, 'DEBUG_INVALID_CONFIG')
  }
  return [...editor.trim().split(/\s+/), `+${String(line)}`, file]
}

/** Options of {@link openInEditor}. */
export interface OpenInEditorOptions {
  /** The resolved editor command; `undefined` means none is configured. */
  readonly editor: string | undefined
  /** The file to open, in the editor's own path space. */
  readonly file: string
  /** The 1-based line to jump to. */
  readonly line: number
  /** True for a remote (SSH) workspace, where the local path is not openable. */
  readonly remote: boolean
  /** The launcher face; required whenever an editor command is configured. */
  readonly launch?: TuiEditorLaunch
}

/**
 * Open the file at the current line, or report why that did not happen. A
 * remote workspace without a configured remote editor resolves to the
 * copyable remote path — never a local open of a path the local machine may
 * not have.
 * @param options - the editor command, file position, workspace kind, and
 * launcher face.
 * @returns what happened: the launched argv, the remote path to copy, or
 * unavailability when no editor applies.
 * @throws {@link DebugError} `DEBUG_INVALID_CONFIG` when a configured command
 * or the line is malformed.
 */
export function openInEditor(options: OpenInEditorOptions): TuiEditorOutcome {
  if (options.editor === undefined) {
    return options.remote ? { kind: 'remote-path', path: options.file } : { kind: 'unavailable' }
  }
  const argv = editorCommand(options.editor, options.file, options.line)
  if (options.launch === undefined) {
    throw new DebugError('opening an editor requires the local process launcher', 'DEBUG_INVALID_CONFIG')
  }
  options.launch.start({ argv })
  return { kind: 'opened', argv }
}
