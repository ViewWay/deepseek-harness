/** TUI key decoding: function-key sequences, modifiers, and printable text. */

import { describe, expect, it } from 'vitest'
import { NO_MODS, functionKeyOf, parseTuiKey } from '../src/keys.ts'

describe('TUI function-key sequences', () => {
  it('recognizes the xterm sequences Ink swallows', () => {
    expect(functionKeyOf('\x1b[15~')).toBe('f5')
    expect(functionKeyOf('\x1b[15;2~')).toBe('shift-f5')
    expect(functionKeyOf('\x1b[15$')).toBe('shift-f5')
    expect(functionKeyOf('\x1b[17~')).toBe('f6')
    expect(functionKeyOf('\x1b[18~')).toBe('f7')
    expect(functionKeyOf('\x1b[20~')).toBe('f9')
    expect(functionKeyOf('\x1b[21~')).toBe('f10')
    expect(functionKeyOf('\x1b[23~')).toBe('f11')
    expect(functionKeyOf('\x1b[23;2~')).toBe('shift-f11')
    expect(functionKeyOf('\x1b[23$')).toBe('shift-f11')
  })

  it('returns undefined for text and unknown sequences', () => {
    expect(functionKeyOf('hello')).toBeUndefined()
    expect(functionKeyOf('\x1b[99~')).toBeUndefined()
  })
})

describe('TUI key decoding', () => {
  it('decodes modifiers', () => {
    expect(parseTuiKey('\r', { ...NO_MODS, return: true })).toEqual({ kind: 'return' })
    expect(parseTuiKey('', { ...NO_MODS, backspace: true })).toEqual({ kind: 'backspace' })
    expect(parseTuiKey('', { ...NO_MODS, delete: true })).toEqual({ kind: 'delete' })
    expect(parseTuiKey('', { ...NO_MODS, tab: true })).toEqual({ kind: 'tab' })
    expect(parseTuiKey('\x1b', { ...NO_MODS, escape: true })).toEqual({ kind: 'escape' })
  })

  it('decodes Ctrl+C as Ink reports it and as the raw interrupt', () => {
    expect(parseTuiKey('c', { ...NO_MODS, ctrl: true })).toEqual({ kind: 'ctrl-c' })
    expect(parseTuiKey('\u0003', NO_MODS)).toEqual({ kind: 'ctrl-c' })
  })

  it('carries printable text and filters control characters', () => {
    expect(parseTuiKey('hi', NO_MODS)).toEqual({ kind: 'print', text: 'hi' })
    expect(parseTuiKey('\x00', NO_MODS)).toEqual({ kind: 'other' })
  })
})
