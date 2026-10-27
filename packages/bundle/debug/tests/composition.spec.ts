import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { DebugController } from '@deepseek-ai/dsh-api-debug-controller'
import compositionPlugin from '../src/index.ts'

const bundleDir = resolve(fileURLToPath(import.meta.url), '../..')

/** The composed rows of the bundle's own patch. */
function rows(): EntryOptions[] {
  const patches = loadOverlayPatches('test', resolve(bundleDir, 'cordis.patch.yml'))
  return patches.flatMap(patch => patch.insert ?? [])
}

describe('debug bundle composition', () => {
  it('exposes the debug controller as the default plugin', () => {
    expect(compositionPlugin).toBe(DebugController)
  })

  it('stacks the model side, the controller, and the workbench rows', () => {
    expect(rows().map(row => [row.id, row.name])).toEqual([
      ['debug', '@deepseek-ai/dsh-debug'],
      ['debug-adapters', '@deepseek-ai/dsh-debug-adapter-manager'],
      ['debug-provider-node', '@deepseek-ai/dsh-debug-node'],
      ['debug-provider-python', '@deepseek-ai/dsh-debug-python'],
      ['debug-provider-go', '@deepseek-ai/dsh-debug-go'],
      ['debug-provider-native', '@deepseek-ai/dsh-debug-native'],
      ['tool-debug', '@deepseek-ai/dsh-tool-debug'],
      ['debug-controller', '@deepseek-ai/dsh-debug-bundle/debug-controller'],
      ['ui-code-editor', '@deepseek-ai/dsh-client-ui-code-editor'],
      ['ui-debug', '@deepseek-ai/dsh-client-ui-debug'],
      ['ui-workbench', '@deepseek-ai/dsh-client-ui-workbench'],
    ])
  })

  it('keeps the workbench rows on the web and desktop profiles only', () => {
    const guard = (id: string): string => {
      const row = rows().find(entry => entry.id === id)
      const expression = row?.disabled as { __jsExpr?: string } | undefined
      if (typeof expression?.__jsExpr !== 'string') throw new Error(`${id} has no disabled guard`)
      return expression.__jsExpr
    }
    const withProfile = (name: string): unknown => {
      const get = (key: string) => key === 'profileContext' ? { name } : undefined
      return new Function('ctx', `"use strict"; return (${guard('ui-debug')})`)({ get })
    }
    expect(withProfile('web')).toBe(false)
    expect(withProfile('desktop')).toBe(false)
    expect(withProfile('headless')).toBe(true)
    expect(withProfile('sdk')).toBe(true)
    expect(withProfile('acp')).toBe(true)
    expect(withProfile('tui')).toBe(true)
  })

  it('ships display metadata for every shipped locale', () => {
    for (const language of ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt']) {
      const dictionary = JSON.parse(readFileSync(resolve(bundleDir, 'locale', `${language}.json`), 'utf8')) as {
        meta?: { title?: unknown; description?: unknown }
      }
      expect(typeof dictionary.meta?.title, language).toBe('string')
      expect(String(dictionary.meta?.title).trim().length, language).toBeGreaterThan(0)
      expect(typeof dictionary.meta?.description, language).toBe('string')
      expect(String(dictionary.meta?.description).trim().length, language).toBeGreaterThan(0)
    }
    expect(pathToFileURL(resolve(bundleDir, 'icon.svg')).href).toMatch(/icon\.svg$/)
  })
})
