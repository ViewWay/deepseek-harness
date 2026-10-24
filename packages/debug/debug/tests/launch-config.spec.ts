/**
 * Named launch configurations: variable expansion across workspace and file
 * context, schema validation, and the typed failures for duplicates,
 * unresolved variables, and command substitution.
 */

import { describe, expect, it } from 'vitest'
import { parseLaunchConfig } from '../src/launch-config.ts'

const json = JSON.stringify({
  version: 1,
  configurations: [
    { name: 'Node: current file', type: 'node', request: 'launch', program: '${file}', cwd: '${workspaceFolder}' },
    { name: 'API', type: 'node', request: 'attach', processId: 42 },
  ],
  compounds: [{ name: 'API + worker', configurations: ['Node: current file', 'API'], stopAll: true }],
})

describe('launch configuration', () => {
  it('expands workspace, file, and env variables', () => {
    const config = parseLaunchConfig(json, {
      workspaceFolder: '/ws', file: '/ws/src/a.ts', env: { NODE_ENV: 'test' },
    })
    expect(config.configurations[0]).toMatchObject({ program: '/ws/src/a.ts', cwd: '/ws' })
    expect(config.compounds[0]).toMatchObject({ stopAll: true })
  })

  it('expands relative, basename, dirname, and env variables', () => {
    const config = parseLaunchConfig(JSON.stringify({
      version: 1,
      configurations: [
        { name: 'Mixed', type: 'node', request: 'launch', module: '${relativeFile}', cwd: '${fileDirname}', args: ['${fileBasename}', '${env:NODE_ENV}'] },
      ],
    }), { workspaceFolder: '/ws', file: '/ws/src/a.ts', env: { NODE_ENV: 'test' } })
    expect(config.configurations[0]).toMatchObject({
      module: 'src/a.ts',
      cwd: '/ws/src',
      args: ['a.ts', 'test'],
    })
  })

  it('rejects duplicate names and unresolved variables', () => {
    expect(() => parseLaunchConfig(json.replace('"API"', '"Node: current file"'), { workspaceFolder: '/ws', file: '/ws/a.ts', env: {} }))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    expect(() => parseLaunchConfig(json.replace('${file}', '${missing}'), { workspaceFolder: '/ws', file: '/ws/a.ts', env: {} }))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })

  it('rejects command substitution with the offending field named', () => {
    expect(() => parseLaunchConfig(json.replace('${file}', '$(rm -rf /)'), { workspaceFolder: '/ws', file: '/ws/a.ts', env: {} }))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    expect(() => parseLaunchConfig(json.replace('${file}', '`rm -rf /`'), { workspaceFolder: '/ws', file: '/ws/a.ts', env: {} }))
      .toThrow(/program/)
  })

  it('rejects unknown top-level fields, wrong versions, empty lists, and dangling compound references', () => {
    const context = { workspaceFolder: '/ws', file: '/ws/a.ts', env: {} }
    expect(() => parseLaunchConfig(json.replace('"version":1', '"version":2'), context))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    expect(() => parseLaunchConfig(json.replace('"compounds"', '"extra":1,"compounds"'), context))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    expect(() => parseLaunchConfig(json.replace(json.slice(json.indexOf('"configurations"'), json.indexOf('"compounds"')), '"configurations": [], '), context))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    expect(() => parseLaunchConfig(json.replace('["Node: current file","API"]', '["Node: current file","Gone"]'), context))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })
})
