import { describe, expect, it } from 'vitest'
import { decodeDapFrames, encodeDapFrame, MAX_MESSAGE_BYTES } from '../src/frames.ts'

describe('DAP framing', () => {
  it('round-trips one message and keeps a partial tail', () => {
    const message = { seq: 1, type: 'response', request_seq: 1, success: true, command: 'initialize' } as const
    const encoded = encodeDapFrame(message)
    const first = decodeDapFrames(encoded.subarray(0, 10))
    expect(first.messages).toEqual([])
    const second = decodeDapFrames(Buffer.concat([first.rest, encoded.subarray(10)]))
    expect(second.messages).toEqual([message])
    expect(second.rest).toHaveLength(0)

    const bodyTruncated = decodeDapFrames(encoded.subarray(0, encoded.length - 3))
    expect(bodyTruncated.messages).toEqual([])
    expect(bodyTruncated.rest).toHaveLength(encoded.length - 3)
  })

  it('rejects a missing or non-numeric Content-Length', () => {
    expect(() => decodeDapFrames(Buffer.from('Content-Length: nope\r\n\r\n{}')))
      .toThrow(expect.objectContaining({ code: 'DEBUG_MALFORMED_RESPONSE' }))
    expect(() => decodeDapFrames(Buffer.from('Content-Length: -4\r\n\r\n{}')))
      .toThrow(expect.objectContaining({ code: 'DEBUG_MALFORMED_RESPONSE' }))
  })

  it('rejects a body that is not a JSON object with a known message type', () => {
    expect(() => decodeDapFrames(Buffer.from('Content-Length: 4\r\n\r\noops')))
      .toThrow(expect.objectContaining({ code: 'DEBUG_MALFORMED_RESPONSE' }))
    expect(() => decodeDapFrames(Buffer.from('Content-Length: 4\r\n\r\nnull')))
      .toThrow(expect.objectContaining({ code: 'DEBUG_MALFORMED_RESPONSE' }))
    expect(() => decodeDapFrames(Buffer.from('Content-Length: 3\r\n\r\n[1]')))
      .toThrow(expect.objectContaining({ code: 'DEBUG_MALFORMED_RESPONSE' }))
  })

  it('rejects frames above the byte limit and keeps the limit configurable', () => {
    const message = { seq: 1, type: 'event', event: 'output', body: { output: 'x'.repeat(64) } } as const
    const frame = encodeDapFrame(message)
    expect(() => decodeDapFrames(frame, 8)).toThrow(expect.objectContaining({ code: 'DEBUG_MALFORMED_RESPONSE' }))
    expect(decodeDapFrames(frame).messages).toHaveLength(1)

    const oversized = encodeDapFrame({ seq: 2, type: 'event', event: 'output', body: { output: 'x'.repeat(MAX_MESSAGE_BYTES) } })
    expect(() => decodeDapFrames(oversized)).toThrow(expect.objectContaining({ code: 'DEBUG_MALFORMED_RESPONSE' }))
  })
})
