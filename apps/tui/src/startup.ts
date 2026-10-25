/**
 * The TUI app's command-line provider: it parses the session identity and
 * help, then publishes {@link TUI_STARTUP_SERVICE}. The Ink interactive loop
 * mounts from {@link mountTuiApp} as that service's consumer.
 * @module @deepseek-ai/dsh-tui/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cmdline'
import { mountTuiApp } from './run.ts'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before the app can start. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the TUI runner. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** What the runner reads from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
  /** Exact Session identity to adopt; absent for a fresh random identity. */
  sessionId: string | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Parsed arguments of this TUI invocation. */
    tuiStartup: TuiStartupValues
  }
}

/**
 * This app's command: its options and its help text.
 * @returns a fresh program, so one process can parse more than once.
 */
function tuiCommand(): Command {
  return new Command()
    .name('dsh --profile tui')
    .description('Interactive terminal UI for the DeepSeek Harness; press Ctrl+C to exit.')
    .helpOption('-h, --help', 'show this help')
    .option('--session-id <id>', 'adopt the persisted Session with this id; an unknown id is an error')
    .addHelpText('after', `
Examples:
  dsh --profile tui                                    start a new interactive session
  dsh --profile tui --session-id session-…             resume an existing Session
`)
}

/**
 * Parse and provide the TUI startup values. On `--help` and on missing
 * options commander prints and exits; the action then mounts the Ink loop.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    const options = program.opts<{ sessionId?: string }>()
    const sessionId = options.sessionId
    if (sessionId !== undefined && sessionId.trim() === '') {
      program.error('error: --session-id requires a non-empty session id')
    }
    ctx.provide(TUI_STARTUP_SERVICE, { sessionId })
    mountTuiApp(ctx).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`dsh: ${message}\n`)
      const exit = ctx.get('appExit')
      if (exit !== undefined) exit(1)
      else process.exitCode = 1
    })
  })
  program.parse(ctx.get('cmdlineArgs')?.get() ?? [], { from: 'user' })
}
