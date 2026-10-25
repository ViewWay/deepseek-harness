/**
 * TUI input parsing: colon-prefixed commands, plain prompts, and shell-safe.
 */

import { describe, expect, it } from 'vitest'
import { parseTuiInput } from '../src/input.ts'

describe('TUI input', () => {
  it('treats ordinary text as a prompt and a leading colon as a command', () => {
    expect(parseTuiInput('hello')).toEqual({ kind: 'prompt', text: 'hello' })
    expect(parseTuiInput(':debug')).toEqual({ kind: 'command', name: 'debug', args: [] })
    expect(parseTuiInput(':break src/a.ts:4 if x > 1')).toEqual({
      kind: 'command', name: 'break', args: ['src/a.ts:4', 'if', 'x', '>', '1'],
    })
  })

  it('does not execute shell syntax', () => {
    expect(parseTuiInput('!rm -rf /')).toEqual({ kind: 'prompt', text: '!rm -rf /' })
  })
})
