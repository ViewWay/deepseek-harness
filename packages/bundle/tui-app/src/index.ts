/**
 * The tui profile's composition bundle: re-exports the TUI app plugin so the
 * profile's patch layer can stack it over dsh-base.
 * @module @deepseek-ai/dsh-tui-app
 */

export { name, apply, inject } from '@deepseek-ai/dsh-tui'
