/**
 * Browser half: the debug workbench's toolbar and panels package.
 *
 * This entry owns the package's copy namespace, the four debug tools'
 * transcript cards, and the debug view client service (`ctx.debugView`):
 * the live store the Remote wiring keeps current and the toolbar action
 * dispatch onto the debug controller's execution Remotes. The toolbar,
 * store, and panels are presentation pieces composed by the workbench
 * layout package, which owns panel registration and the page layout.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { applyDebugToolCards } from './debug-tool-cards.tsx'
import { createDebugViewService } from './debug-service.ts'
import type { DebugViewService } from './debug-service.ts'
import { de, en, es, fr, ja, pt, ru, zh } from './locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The debug view client service: live store, notices, and action dispatch. */
    debugView: DebugViewService
  }
}

/** This package's copy namespace. */
const NS = 'debug'

/** Default event poll interval; the Config's minimum bounds it from below. */
export const DEFAULT_DEBUG_EVENT_POLL_MS = 1000

/** Debug view runtime configuration. */
export interface Config {
  /** Debug event poll interval in milliseconds (default {@link DEFAULT_DEBUG_EVENT_POLL_MS}, minimum 250). */
  readonly debugEventPollMs?: number
}

/** Validated debug view runtime configuration. */
export const Config: z<Config> = z.object({
  debugEventPollMs: z.natural().min(250).default(DEFAULT_DEBUG_EVENT_POLL_MS),
})

/** Required browser services: copy, the transcript slot registry, and the debug Remote namespace. */
export const inject = ['locale', 'slots', 'remote', 'remote.debug']

/**
 * Client plugin body: register the dictionaries, the four debug tools'
 * cards, and the debug view service.
 * @param ctx - client root context carrying the locale and slots services
 *   and the `remote.debug` namespace.
 * @param config - validated debug view configuration; schemastery has filled
 *   the defaulted fields before this body runs.
 */
export function apply(ctx: ClientContext, config: Config = Config({})): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-debug: dictionaries')
  applyDebugToolCards(ctx)
  const resolved = config as Required<Config>
  const service = createDebugViewService(ctx, resolved.debugEventPollMs)
  const dispose = ctx.reflect.provide('debugView', service)
  ctx.effect(() => () => { void dispose() }, 'ui-debug: debug view service')
}
