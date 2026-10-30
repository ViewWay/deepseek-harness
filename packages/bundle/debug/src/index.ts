/**
 * The optional debug composition bundle: re-exports the Remote debug
 * controller and the production launch host the bundle's patch mounts, so
 * the package main carries a real plugin surface beside the patch and locale
 * metadata.
 * @module @deepseek-ai/dsh-debug-bundle
 */

export { default } from './debug-controller.ts'
export { default as debugHost } from './debug-host.ts'
export type { Config as DebugHostConfig } from './debug-host.ts'
