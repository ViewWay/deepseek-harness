/**
 * Debug telemetry projection: the allowlist is the whole contract — sensitive
 * input fields exist only to be dropped, and the serialized attributes never
 * contain a path segment or an environment value.
 */
import { describe, expect, it } from 'vitest'
import { debugSpanAttributes } from '../src/telemetry.ts'

describe('debug telemetry', () => {
  it('records surface, provider, and outcome but never paths or environment values', () => {
    const attributes = debugSpanAttributes({
      surface: 'cli',
      providerId: 'node',
      language: 'node',
      executionWorld: 'ssh',
      workspaceRoot: '/secret/ws',
      env: { TOKEN: 'do-not-show' },
      outcome: 'ok',
    })
    expect(attributes).toEqual({
      surface: 'cli',
      providerId: 'node',
      language: 'node',
      executionWorld: 'ssh',
      outcome: 'ok',
    })
    expect(JSON.stringify(attributes)).not.toContain('do-not-show')
    expect(JSON.stringify(attributes)).not.toContain('/secret')
  })

  it('keeps the denial and failure outcomes for audit without any extra fields', () => {
    const denied = debugSpanAttributes({
      surface: 'agent',
      providerId: 'python',
      language: 'python',
      executionWorld: 'sandbox',
      workspaceRoot: '/ws',
      env: {},
      outcome: 'denied',
    })
    expect(denied.outcome).toBe('denied')
    expect(Object.keys(denied).sort()).toEqual(['executionWorld', 'language', 'outcome', 'providerId', 'surface'])
  })
})
