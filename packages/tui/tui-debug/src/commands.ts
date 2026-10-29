/**
 * The TUI `:` debug command family: the closed command union parsed from one
 * raw input line (design 9.8.3). Parsing follows argv rules without a shell —
 * conditions and log messages stay one argument and reach the debug seam as
 * plain text, so command substitution never happens. Unknown commands and
 * malformed arguments fail loud with the seam's stable codes.
 * @module @deepseek-ai/dsh-tui-debug/commands
 */

import { DebugError } from '@deepseek-ai/dsh-debug'

/** One parsed TUI debug command; every member is a closed variant. */
export type TuiDebugCommand =
  | { readonly name: 'run'; readonly config?: string }
  | { readonly name: 'attach'; readonly target: string }
  | {
    readonly name: 'break'
    readonly file: string
    readonly line: number
    readonly condition?: string
    readonly logMessage?: string
  }
  | { readonly name: 'break-off'; readonly file: string; readonly line: number }
  | { readonly name: 'exception'; readonly filter?: string }
  | { readonly name: 'pause' }
  | { readonly name: 'continue' }
  | { readonly name: 'next' }
  | { readonly name: 'step' }
  | { readonly name: 'out' }
  | { readonly name: 'back' }
  | { readonly name: 'bt'; readonly thread?: string }
  | { readonly name: 'frame'; readonly index: number }
  | { readonly name: 'vars' }
  | { readonly name: 'eval'; readonly expression: string }
  | { readonly name: 'watch'; readonly expression: string }
  | { readonly name: 'threads' }
  | { readonly name: 'sessions' }
  | { readonly name: 'switch'; readonly sessionId: string }
  | { readonly name: 'terminate' }
  | { readonly name: 'disconnect' }
  | { readonly name: 'adapter-list' }
  | { readonly name: 'adapter-install'; readonly providerId: string }
  | { readonly name: 'chat' }
  | { readonly name: 'debug' }
  | { readonly name: 'split' }
  | { readonly name: 'expand'; readonly index: number }
  | { readonly name: 'help' }
  | { readonly name: 'quit' }

/** Commands the TUI app itself owns (layouts, history, help, exit); the pane source declines them. */
const APP_OWNED: ReadonlySet<string> = new Set(['chat', 'debug', 'split', 'expand', 'help', 'quit'])

/** The debug function keys (apps/tui `TuiFunctionKey` names) and the command line each one runs. */
export const DEBUG_KEY_COMMANDS: Readonly<Record<string, string>> = {
  'f5': ':continue',
  'shift-f5': ':pause',
  'f9': ':break',
  'f10': ':next',
  'f11': ':step',
  'shift-f11': ':out',
}

/**
 * Report a malformed command argument.
 * @param line - the raw line the argument came from.
 * @param detail - what the argument must look like.
 * @returns the typed invalid-config failure.
 */
function invalid(line: string, detail: string): DebugError {
  return new DebugError(`invalid debug command "${line}": ${detail}`, 'DEBUG_INVALID_CONFIG')
}

/**
 * Parse one non-empty positive integer argument.
 * @param raw - the argument text.
 * @param line - the raw command line, for the failure.
 * @param field - what the argument names.
 * @returns the parsed integer.
 */
function parseIndex(raw: string | undefined, line: string, field: string): number {
  if (raw === undefined || !/^\d+$/.test(raw) || Number(raw) < 1) {
    throw invalid(line, `${field} must be a positive integer`)
  }
  return Number(raw)
}

/**
 * Join the raw argument tokens after `keyword` into one expression argument.
 * @param tokens - tokens after the keyword.
 * @param line - the raw command line, for the failure.
 * @param keyword - the clause keyword that introduced the tokens.
 * @returns the joined clause text; empty tails stay invalid.
 */
function joinClause(tokens: readonly string[], line: string, keyword: string): string {
  if (tokens.length === 0) throw invalid(line, `${keyword} requires an expression`)
  return tokens.join(' ')
}

/**
 * Parse `file:line` into its path and positive line number; the last colon
 * separates the two so directory-colon paths keep working.
 * @param raw - the argument text.
 * @param line - the raw command line, for the failure.
 * @returns the file path and line number.
 */
function parseFileLine(raw: string, line: string): { readonly file: string; readonly line: number } {
  const separator = raw.lastIndexOf(':')
  if (separator <= 0 || separator === raw.length - 1) throw invalid(line, 'breakpoint needs <file>:<line>')
  const lineText = raw.slice(separator + 1)
  if (!/^\d+$/.test(lineText) || Number(lineText) < 1) throw invalid(line, 'breakpoint line must be a positive integer')
  return { file: raw.slice(0, separator), line: Number(lineText) }
}

/** One command line split into its name and raw argument tokens. */
interface SplitLine {
  readonly name: string
  readonly args: readonly string[]
  readonly line: string
}

/**
 * Split one raw input line into the command name and argument tokens.
 * @param raw - the raw input line, with or without the leading colon.
 * @returns the split line.
 */
function splitLine(raw: string): SplitLine {
  const line = raw.trim()
  const body = line.startsWith(':') ? line.slice(1) : line
  const tokens = body.trim().split(/\s+/).filter(token => token !== '')
  const name = tokens[0]
  if (name === undefined) throw invalid(raw, 'a command needs a name')
  return { name, args: tokens.slice(1), line }
}

/**
 * Parse the `:break` argument clauses (`[if <expr>] [log <text>]`).
 * @param args - the raw argument tokens after `file:line`.
 * @param line - the raw command line, for the failures.
 * @returns the optional condition and log message.
 */
function parseBreakClauses(
  args: readonly string[],
  line: string,
): { readonly condition?: string; readonly logMessage?: string } {
  let condition: string | undefined
  let logMessage: string | undefined
  let index = 0
  while (index < args.length) {
    const keyword = args[index]
    if (keyword === 'if') {
      // The condition runs to the next `log` token or the end, so an `if`
      // clause can contain the token `if`; a second clause keyword can only
      // be `log`, and `log` consumes the rest — each clause appears once.
      const tail: string[] = []
      index += 1
      while (index < args.length) {
        const token = args[index]
        if (token === undefined || token === 'log') break
        tail.push(token)
        index += 1
      }
      condition = joinClause(tail, line, 'if')
    } else if (keyword === 'log') {
      logMessage = joinClause(args.slice(index + 1), line, 'log')
      index = args.length
    } else {
      throw invalid(line, `unexpected argument "${String(keyword)}"`)
    }
  }
  return {
    ...(condition !== undefined ? { condition } : {}),
    ...(logMessage !== undefined ? { logMessage } : {}),
  }
}

/**
 * Parse one raw TUI input line into a debug command.
 * @param line - the raw input line; the leading `:` is optional.
 * @returns the parsed command; bare commands carry no extra fields.
 * @throws {@link DebugError} `DEBUG_UNKNOWN_OPERATION` when the command name is
 * not in the design 9.8.3 table; `DEBUG_INVALID_CONFIG` for malformed or
 * missing arguments, including an empty line.
 */
export function parseDebugCommand(line: string): TuiDebugCommand {
  const split = splitLine(line)
  const { name, args, line: raw } = split
  const rest = (): string => args.join(' ')
  switch (name) {
    case 'run':
      if (args.length > 1) throw invalid(raw, 'run takes at most one config name')
      if (args[0] === undefined) return { name: 'run' }
      return { name: 'run', config: args[0] }
    case 'attach': {
      const target = args[0]
      if (target === undefined || args.length !== 1) throw invalid(raw, 'attach takes one pid, port, or url')
      return { name: 'attach', target }
    }
    case 'break': {
      const location0 = args[0]
      if (location0 === undefined) throw invalid(raw, 'breakpoint needs <file>:<line>')
      if (location0 === 'off') {
        const target = args[1]
        if (target === undefined || args.length !== 2) throw invalid(raw, 'break off takes exactly <file>:<line>')
        return { name: 'break-off', ...parseFileLine(target, raw) }
      }
      const location = parseFileLine(location0, raw)
      return { name: 'break', ...location, ...parseBreakClauses(args.slice(1), raw) }
    }
    case 'exception':
      if (args.length > 1) throw invalid(raw, 'exception takes at most one filter')
      return args.length === 1 ? { name: 'exception', filter: rest() } : { name: 'exception' }
    case 'pause':
    case 'continue':
    case 'next':
    case 'step':
    case 'out':
    case 'back':
    case 'vars':
    case 'threads':
    case 'sessions':
    case 'terminate':
    case 'disconnect':
    case 'chat':
    case 'debug':
    case 'split':
    case 'help':
    case 'quit':
      if (args.length > 0) throw invalid(raw, `${name} takes no arguments`)
      return { name }
    case 'bt': {
      const thread = args[0]
      if (args.length > 1) throw invalid(raw, 'bt takes at most one thread id')
      if (thread === undefined) return { name: 'bt' }
      return { name: 'bt', thread }
    }
    case 'frame':
      return { name: 'frame', index: parseIndex(args[0], raw, 'frame index') }
    case 'eval':
    case 'watch':
      if (args.length < 1) throw invalid(raw, `${name} requires an expression`)
      return { name, expression: rest() }
    case 'switch':
      if (args.length !== 1) throw invalid(raw, 'switch takes exactly one session id')
      return { name: 'switch', sessionId: rest() }
    case 'adapter': {
      if (args.length < 1 || args[0] === undefined) throw invalid(raw, 'adapter needs list or install <provider>')
      const action = args[0]
      if (action === 'list') {
        if (args.length !== 1) throw invalid(raw, 'adapter list takes no arguments')
        return { name: 'adapter-list' }
      }
      if (action === 'install') {
        const providerId = args[1]
        if (providerId === undefined || args.length !== 2) throw invalid(raw, 'adapter install takes exactly one provider id')
        return { name: 'adapter-install', providerId }
      }
      throw new DebugError(
        `unknown debug command ":adapter ${action}"; expected list or install`,
        'DEBUG_UNKNOWN_OPERATION',
      )
    }
    case 'expand':
      return { name: 'expand', index: parseIndex(args[0], raw, 'expand index') }
    default:
      throw new DebugError(`unknown debug command ":${name}"`, 'DEBUG_UNKNOWN_OPERATION')
  }
}

/**
 * Decide whether a command name belongs to the pane source rather than the
 * TUI app's own builtins.
 * @param name - the parsed command name.
 * @returns true when the debug pane source consumes the command.
 */
export function isDebugCommand(name: string): boolean {
  return !APP_OWNED.has(name)
}
