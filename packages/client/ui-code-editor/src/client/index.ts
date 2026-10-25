/**
 * Browser half: the workbench's code editor package.
 *
 * This entry owns the editor's copy namespace. The editor itself is a
 * presentation component composed by the workbench layout package, which owns
 * tabs, panel registration, and the Remote wiring for reads, saves, and
 * breakpoint application.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { de, en, es, fr, ja, pt, ru, zh } from './locales.ts'

/** This package's copy namespace. */
const NS = 'codeEditor'

/** Required browser services: copy. */
export const inject = ['locale']

/**
 * Client plugin body: register the editor's dictionaries.
 * @param ctx - client root context carrying the locale service.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-code-editor: dictionaries')
}
