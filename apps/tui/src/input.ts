/**
 * TUI input parsing: colon-prefixed commands, plain prompts; shell-safe.
 * @module @deepseek-ai/dsh-tui/input
 */

/** One parsed input line. */
export type TuiInput =
  | { readonly kind: 'prompt'; readonly text: string }
  | { readonly kind: 'command'; readonly name: string; readonly args: readonly string[] }

/**
 * Parse one input line. A leading `:` starts a command whose tokens split on
 * whitespace; everything else — including `!` — is a plain prompt that never
 * executes shell syntax.
 * @param line - the raw input line.
 * @returns the parsed input.
 */
export function parseTuiInput(line: string): TuiInput {
  if (!line.startsWith(':')) return { kind: 'prompt', text: line }
  const tokens = line.slice(1).trim().split(/\s+/).filter(token => token !== '')
  const name = tokens[0]
  if (name === undefined) return { kind: 'prompt', text: line }
  return { kind: 'command', name, args: tokens.slice(1) }
}
