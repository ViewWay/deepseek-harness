/**
 * Provider option readers: each helper's pass, absent, and fail-loud paths,
 * plus the entry absolutizer's three absolute flavors and the attach form's
 * exactly-one rule. Request values come from the typed factories.
 */
import { describe, expect, it } from 'vitest'
import { fixtureSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { DebugProviderId } from '../src/brand.ts'
import { DebugError } from '../src/error.ts'
import {
  absoluteEntry,
  adapterCommandOf,
  processOrPortAttachForm,
  readOptionalBoolean,
  readOptionalString,
  readOptionalStringArray,
  rejectUnknownOptions,
  requireSingleEntry,
} from '../src/provider-options.ts'
import type { DebugAttachRequest, DebugLaunchRequest, ResolvedDebugAdapter } from '../src/types.ts'

const invalid = (detail: string): DebugError => new DebugError(`test: ${detail}`, 'DEBUG_INVALID_CONFIG', { detail })

function launchRequest(init: { program?: string | undefined; module?: string | undefined } = {}): Pick<DebugLaunchRequest, 'program' | 'module'> {
  return init
}

function attachRequest(init: { processId?: number; port?: number } = {}): DebugAttachRequest {
  return {
    providerId: DebugProviderId('node'),
    workspaceRoot: '/ws',
    workspaceId: 'ws-1',
    caller: { kind: 'user', sessionId: fixtureSessionId(1) },
    ...init,
  }
}

describe('absoluteEntry', () => {
  it('keeps posix-absolute, separator-absolute, and windows-drive entries unchanged', () => {
    expect(absoluteEntry('/abs/a.ts', '/ws', '/')).toBe('/abs/a.ts')
    expect(absoluteEntry('\\abs\\a.ts', '\\ws', '\\')).toBe('\\abs\\a.ts')
    expect(absoluteEntry('C:\\abs\\a.ts', '\\ws', '\\')).toBe('C:\\abs\\a.ts')
  })

  it('joins relative entries onto the workspace root with the target separator', () => {
    expect(absoluteEntry('src/a.ts', '/ws', '/')).toBe('/ws/src/a.ts')
    expect(absoluteEntry('src\\a.ts', '\\ws', '\\')).toBe('\\ws\\src\\a.ts')
  })
})

describe('readOptionalString', () => {
  it('returns the value, undefined when absent, and fails a non-string', () => {
    expect(readOptionalString({ py: 'x' }, 'py', 'python', invalid)).toBe('x')
    expect(readOptionalString({}, 'py', 'python', invalid)).toBeUndefined()
    expect(() => readOptionalString({ py: 1 }, 'py', 'python', invalid))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })
})

describe('readOptionalBoolean', () => {
  it('returns the value, undefined when absent, and fails a non-boolean', () => {
    expect(readOptionalBoolean({ f: true }, 'f', 'node', invalid)).toBe(true)
    expect(readOptionalBoolean({}, 'f', 'node', invalid)).toBeUndefined()
    expect(() => readOptionalBoolean({ f: 'yes' }, 'f', 'node', invalid))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })
})

describe('readOptionalStringArray', () => {
  it('returns the values, undefined when absent, and fails non-arrays and non-string items', () => {
    expect(readOptionalStringArray({ flags: ['-v', 'x'] }, 'flags', 'go', invalid)).toEqual(['-v', 'x'])
    expect(readOptionalStringArray({}, 'flags', 'go', invalid)).toBeUndefined()
    expect(() => readOptionalStringArray({ flags: '-v' }, 'flags', 'go', invalid))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    expect(() => readOptionalStringArray({ flags: ['-v', 1] }, 'flags', 'go', invalid))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })
})

describe('requireSingleEntry', () => {
  it('returns the present form for program and for module', () => {
    expect(requireSingleEntry(launchRequest({ program: 'a.ts' }), 'program or module', invalid)).toBe('program')
    expect(requireSingleEntry(launchRequest({ module: 'mod' }), 'program or module', invalid)).toBe('module')
  })

  it('fails when both or neither form is set', () => {
    expect(() => requireSingleEntry(launchRequest(), 'program or module', invalid))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    expect(() => requireSingleEntry(launchRequest({ program: 'a.ts', module: 'mod' }), 'program or module', invalid))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })
})

describe('rejectUnknownOptions', () => {
  it('passes known keys and fails the first unknown key', () => {
    expect(() => {
      rejectUnknownOptions({ py: 'x' }, new Set(['py']), 'python', invalid)
    }).not.toThrow()
    expect(() => {
      rejectUnknownOptions({ py: 'x', rogue: 1 }, new Set(['py']), 'python', invalid)
    }).toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })
})

describe('adapterCommandOf', () => {
  it('copies the resolved adapter command with the environment cwd', () => {
    const resolved: ResolvedDebugAdapter = {
      command: ['dlv', 'dap'],
      args: ['--port=1'],
      env: { A: '1' },
      version: '1.27.2',
      platform: 'darwin-arm64',
      source: 'managed',
      executablePath: '/adapters/dlv',
    }
    expect(adapterCommandOf(resolved, { cwd: '/ws' })).toEqual({
      command: ['dlv', 'dap'],
      args: ['--port=1'],
      env: { A: '1' },
      cwd: '/ws',
    })
  })
})

describe('processOrPortAttachForm', () => {
  it('returns exactly the one present address form', () => {
    expect(processOrPortAttachForm(attachRequest({ processId: 42 }), invalid)).toEqual({ processId: 42 })
    expect(processOrPortAttachForm(attachRequest({ port: 5678 }), invalid)).toEqual({ port: 5678 })
  })

  it('fails when both or neither form is set', () => {
    expect(() => processOrPortAttachForm(attachRequest(), invalid))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    expect(() => processOrPortAttachForm(attachRequest({ processId: 1, port: 2 }), invalid))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })
})
