/**
 * Real-adapter debug e2e harness primitives.
 *
 * `skipWithoutAdapter` probes the language toolchain and the adapter
 * override/install locations and returns a skip REASON (never a mock) when
 * either is missing; `launchFixture` starts the real composition once the
 * full Task 25b harness lands — in this skeleton it fails loud so a wired
 * adapter can never silently run against an unfinished harness.
 * @module @deepseek-ai/dsh-debug-e2e
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

/** Languages the matrix covers. */
export type DebugE2eLanguage = 'node' | 'python' | 'go' | 'native'

/** Toolchain executable per language. */
const TOOLCHAIN: Readonly<Record<DebugE2eLanguage, string>> = {
  node: 'node',
  python: 'python3',
  go: 'go',
  native: 'clang',
}

/** Environment variable carrying one adapter override path per language. */
const OVERRIDE_ENV: Readonly<Record<DebugE2eLanguage, string>> = {
  node: 'DSH_E2E_NODE_ADAPTER',
  python: 'DSH_E2E_PYTHON_ADAPTER',
  go: 'DSH_E2E_GO_ADAPTER',
  native: 'DSH_E2E_NATIVE_ADAPTER',
}

/** Recorded skip reasons, one entry per skipped language, for the run log. */
export const recordedSkipReasons: readonly string[] = []

/**
 * Reports whether one language can run its real e2e path on this host.
 *
 * @param language - The matrix language.
 * @returns `false` when both the toolchain and an adapter are available;
 *   otherwise the human-readable skip reason (also recorded).
 */
export function skipWithoutAdapter(language: DebugE2eLanguage): string | false {
  const tool = TOOLCHAIN[language]
  const probe = spawnSync(tool, ['--version'], { stdio: 'ignore' })
  if (probe.error !== undefined || probe.status !== 0) {
    const reason = language + ' e2e skipped: toolchain ' + tool + ' is not available'
    recordedSkipReasons.push(reason)
    return reason
  }
  const override = process.env[OVERRIDE_ENV[language]]
  if (override === undefined || !existsSync(override)) {
    const reason = language + ' e2e skipped: no adapter override at $' + OVERRIDE_ENV[language] + ' and no managed install on this host'
    recordedSkipReasons.push(reason)
    return reason
  }
  return false
}

/**
 * Launches one fixture program under its real provider and adapter.
 *
 * @param language - The matrix language.
 * @param options - Fixture selection.
 * @returns The live session handle.
 * @throws Error always in this skeleton: the full composition arrives with
 *   Task 25b; a present adapter must fail loud, not run half a harness.
 */
export async function launchFixture(language: DebugE2eLanguage, options: { readonly file: string }): Promise<never> {
  void language
  void options
  throw new Error('debug e2e harness is not wired yet: launchFixture lands with the full Task 25b composition')
}
