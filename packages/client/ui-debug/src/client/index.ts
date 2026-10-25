/**
 * Browser half: the debug workbench's toolbar and panels package.
 *
 * This entry owns the package's copy namespace and the four debug tools'
 * transcript cards. The toolbar, store, and panels are presentation pieces
 * composed by the workbench layout package, which owns panel registration,
 * the Remote wiring for events and operations, and the session-notification
 * and actor state.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { applyDebugToolCards } from './debug-tool-cards.tsx'
import { de, en, es, fr, ja, pt, ru, zh } from './locales.ts'

/** This package's copy namespace. */
const NS = 'debug'

/** Required browser services: copy and the transcript slot registry. */
export const inject = ['locale', 'slots']

/**
 * Client plugin body: register the dictionaries and the four debug tools'
 * cards.
 * @param ctx - client root context carrying the locale and slots services.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-debug: dictionaries')
  applyDebugToolCards(ctx)
}
