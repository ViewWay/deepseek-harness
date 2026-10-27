/**
 * The tui profile's composition bundle. The bundle's `cordis.patch.yml`
 * stacks `@deepseek-ai/dsh-tui` over dsh-base by package name, so this
 * module only marks the package as a composition member — re-exporting the
 * app plugin here would pull `apps/tui` sources across the project rootDir
 * boundary into this package's compilation.
 * @module @deepseek-ai/dsh-tui-app
 */
