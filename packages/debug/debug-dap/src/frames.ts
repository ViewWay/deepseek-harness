/**
 * Production Content-Length frame codec for the DAP wire.
 *
 * Frames follow the DAP base protocol: an ASCII header whose single required
 * field declares the UTF-8 byte length of the JSON body, a blank line, then
 * the body. Every rejection is a {@link DebugError} with code
 * `DEBUG_MALFORMED_RESPONSE` so callers route on the code and never parse the
 * message; a partial frame at the end of the buffer is returned as `rest`
 * for reassembly with the next chunk.
 * @module @deepseek-ai/dsh-debug-dap/frames
 */
import { DebugError } from '@deepseek-ai/dsh-debug'
import type { JsonValue } from '@deepseek-ai/dsh-debug'

/** Arguments of a client request; field shapes are command-specific. */
export type DapArguments = { readonly [key: string]: JsonValue }

/** A request sent over the wire, client-to-adapter or adapter-to-client. */
export interface DapRequest {
  readonly seq: number
  readonly type: 'request'
  readonly command: string
  readonly arguments?: DapArguments
}

/** A response answering one request by `request_seq`. */
export interface DapResponse {
  readonly seq: number
  readonly type: 'response'
  readonly request_seq: number
  readonly success: boolean
  readonly command: string
  readonly message?: string
  readonly body?: JsonValue
}

/** An event notification. */
export interface DapEvent {
  readonly seq: number
  readonly type: 'event'
  readonly event: string
  readonly body?: JsonValue
}

/** Any wire message. */
export type DapMessage = DapRequest | DapResponse | DapEvent

/** Messages a DAP client sends: its own requests plus reverse-request responses. */
export type DapClientMessage = DapRequest | DapResponse

/** Result of feeding one chunk to the decoder: complete messages and the tail. */
export interface DapFrameDecoding {
  readonly messages: DapMessage[]
  readonly rest: Uint8Array
}

/** Default per-frame byte ceiling; the session layer can pass its configured limit instead. */
export const MAX_MESSAGE_BYTES = 1024 * 1024

const HEADER_LINE = 'Content-Length: '
const SEPARATOR = '\r\n\r\n'
const headerLinePattern = /^Content-Length: ([0-9]+)$/
const utf8 = new TextEncoder()
const textDecoder = new TextDecoder()

function malformed(detail: string): DebugError {
  return new DebugError(detail, 'DEBUG_MALFORMED_RESPONSE')
}

/**
 * Encodes one message as a single wire frame.
 *
 * @param message Message to encode.
 * @returns Frame bytes ready for `transport.write`.
 */
export function encodeDapFrame(message: DapMessage): Uint8Array {
  const body = utf8.encode(JSON.stringify(message))
  const header = utf8.encode(HEADER_LINE + String(body.length) + SEPARATOR)
  const frame = new Uint8Array(header.length + body.length)
  frame.set(header)
  frame.set(body, header.length)
  return frame
}

/**
 * Decodes every complete frame in `buffer` under `maxMessageBytes`.
 *
 * @param buffer Bytes received so far.
 * @param maxMessageBytes Per-frame ceiling; frames whose declared body length
 *   exceeds it reject with `DEBUG_MALFORMED_RESPONSE` before allocation.
 * @returns Complete messages in arrival order plus the undecoded tail.
 * @throws DebugError(`DEBUG_MALFORMED_RESPONSE`) when a complete header is
 *   not a single non-negative numeric `Content-Length`, when the body is not
 *   a JSON object with a known message type, or when the frame exceeds the
 *   byte ceiling.
 */
export function decodeDapFrames(buffer: Uint8Array, maxMessageBytes: number = MAX_MESSAGE_BYTES): DapFrameDecoding {
  const messages: DapMessage[] = []
  let offset = 0
  while (offset < buffer.length) {
    const separator = indexOfSeparator(buffer, offset)
    if (separator < 0) break
    const header = textDecoder.decode(buffer.subarray(offset, separator))
    const match = headerLinePattern.exec(header)
    if (match === null) {
      throw malformed(`invalid Content-Length header: ${JSON.stringify(header)}`)
    }
    const declaredLength = Number(match[1])
    if (declaredLength > maxMessageBytes) {
      throw malformed(`frame of ${declaredLength} bytes exceeds the ${maxMessageBytes}-byte message limit`)
    }
    const bodyStart = separator + SEPARATOR.length
    const bodyEnd = bodyStart + declaredLength
    if (bodyEnd > buffer.length) break
    messages.push(parseFrameBody(textDecoder.decode(buffer.subarray(bodyStart, bodyEnd))))
    offset = bodyEnd
  }
  return { messages, rest: buffer.subarray(offset) }
}

/** Index of the next header/body separator at or after `from`, or `-1`. */
function indexOfSeparator(bytes: Uint8Array, from: number): number {
  outer: for (let i = from; i + SEPARATOR.length <= bytes.length; i += 1) {
    for (let j = 0; j < SEPARATOR.length; j += 1) {
      if (bytes[i + j] !== SEPARATOR.charCodeAt(j)) continue outer
    }
    return i
  }
  return -1
}

/** Parses one frame body, requiring a JSON object with a known message type. */
function parseFrameBody(body: string): DapMessage {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw malformed(`frame body is not JSON: ${body}`)
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw malformed(`frame body is not a message object: ${body}`)
  }
  const message = parsed as DapMessage
  if (message.type !== 'request' && message.type !== 'response' && message.type !== 'event') {
    throw malformed(`frame body has no known message type: ${body}`)
  }
  return message
}
