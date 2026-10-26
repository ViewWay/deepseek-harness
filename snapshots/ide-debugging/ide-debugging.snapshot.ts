/**
 * Recorded-session adapter for the `snapshots/ide-debugging/` scenarios.
 *
 * Each scenario replays through the shipped `web` profile plus its own
 * `cordis.yml` live-recording patch. Until a `DEEPSEEK_API_KEY` recording
 * commits the scenario's session fixtures, the replay cases stay skipped so
 * `-t ide-debugging` surfaces them explicitly instead of matching nothing.
 * `scripts/session-snapshot-corpus.corpus.ts` pins the exact full-tree adapter
 * set, so adding or renaming this file updates that whitelist in the same
 * change; the whitelist row is staged by the lead (shared registration file),
 * and until it lands this adapter is that assertion's one expected failure.
 */

import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseSnapshotManifest, type SnapshotManifest } from '@deepseek-ai/dsh-session-snapshot'

const scenariosRoot = fileURLToPath(new URL('./', import.meta.url))

/** One declared debug scenario and its ownership metadata. */
interface DebugSnapshotScenario {
  readonly name: string
  readonly dir: string
  readonly manifest: SnapshotManifest & {
    readonly composition: string
    readonly recording: 'live' | 'authored'
    readonly header: NonNullable<SnapshotManifest['header']>
  }
}

/**
 * Collect the declared scenarios beside this adapter.
 * @returns the scenarios sorted by directory name.
 */
async function collectScenarios(): Promise<DebugSnapshotScenario[]> {
  const scenarios: DebugSnapshotScenario[] = []
  for (const entry of await readdir(scenariosRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(scenariosRoot, entry.name)
    const manifestPath = join(dir, 'snapshot.yml')
    if (!existsSync(manifestPath)) continue
    const manifest = parseSnapshotManifest(await readFile(manifestPath, 'utf8'), manifestPath)
    if (manifest.composition === undefined || manifest.recording === undefined || manifest.header === undefined) {
      throw new Error(`${entry.name}: a debug scenario manifest needs composition, recording, and header metadata`)
    }
    if (!existsSync(join(dir, 'cordis.yml'))) {
      throw new Error(`${entry.name}: a debug scenario needs its live-recording patch`)
    }
    scenarios.push({
      name: entry.name,
      dir,
      manifest: {
        ...manifest,
        composition: manifest.composition,
        recording: manifest.recording,
        header: manifest.header,
      },
    })
  }
  return scenarios.sort((left, right) => left.name.localeCompare(right.name))
}

const scenarios = await collectScenarios()

describe('ide-debugging recorded-session snapshots', () => {
  it('gives every debug composition and header class exactly one pin', () => {
    const pins = new Map<string, string>()
    for (const scenario of scenarios) {
      if (scenario.manifest.header.pin !== true) continue
      const key = `${scenario.manifest.composition}/${scenario.manifest.header.class}`
      expect(pins.has(key), `header class ${key} has multiple pins`).toBe(false)
      pins.set(key, scenario.name)
    }
    expect(pins.size, 'debug scenarios declare pinned header classes').toBeGreaterThan(0)
  })
})

for (const scenario of scenarios) {
  describe.skip(`ide-debugging ${scenario.name} replay — fixture 未录制：等待 DEEPSEEK_API_KEY live 录制`, () => {
    it('replays the recorded debug session through the shipped web profile', () => {
      // Fail loud if the skip is lifted before the live recording commits the
      // scenario fixtures; the real replay driver lands with that recording.
      expect(existsSync(join(scenario.dir, 'session.jsonl')), `${scenario.name}: session fixture`).toBe(true)
    })
  })
}
