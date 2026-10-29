/**
 * Content-Length frame codec and wire message types for the fake debug adapter.
 *
 * Framing follows the DAP base protocol: an ASCII header terminated by a blank
 * line, then a UTF-8 JSON body whose byte length the header declares. Malformed
 * input fails loud instead of being skipped, so tests can observe exactly what
 * a client would reject.
 *
 * This codec is a deliberate independent re-implementation of
 * `@deepseek-ai/dsh-debug-dap`'s frames, not an import: the fake is the wire
 * oracle that exercises the real client's codec, so sharing one implementation
 * would let a codec bug pass both sides of the test.
 * @module @deepseek-ai/dsh-fake-debug-adapter/frames
 */

/* jscpd:ignore-start */

/** JSON value shapes carried by DAP message fields. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** Read-only JSON object record. */
export type JsonRecord = { readonly [key: string]: JsonValue }

/** A client-to-adapter request. `arguments` shapes are command-specific. */
export interface DapRequest {
  readonly seq: number
  readonly type: 'request'
  readonly command: string
  readonly arguments?: JsonRecord
}

/** An adapter-to-client response, answering a request by `request_seq`. */
export interface DapResponse {
  readonly seq: number
  readonly type: 'response'
  readonly request_seq: number
  readonly success: boolean
  readonly command: string
  readonly message?: string
  readonly body?: JsonValue
}

/** An adapter-to-client event notification. */
export interface DapEvent {
  readonly seq: number
  readonly type: 'event'
  readonly event: string
  readonly body?: JsonValue
}

/** Any adapter-to-client message. */
export type DapMessage = DapRequest | DapResponse | DapEvent

/** Messages a client may send: requests plus responses to reverse requests. */
export type DapClientMessage = DapRequest | DapResponse

/** Outcome of decoding a byte buffer: complete messages plus the partial tail. */
export interface DapFrameDecodeResult {
  readonly messages: DapMessage[]
  readonly rest: Uint8Array
}

const HEADER_PREFIX = 'Content-Length: '
const HEADER_END = '\r\n\r\n'
const headerPattern = /^Content-Length: (\d+)$/
const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Encodes one message as a DAP wire frame.
 *
 * @param message Message to encode.
 * @returns The frame bytes: `Content-Length` header, blank line, UTF-8 JSON body.
 */
export function encodeDapFrame(message: DapMessage): Uint8Array {
  const bodyBytes = encoder.encode(JSON.stringify(message))
  const headerBytes = encoder.encode(`${HEADER_PREFIX}${bodyBytes.length}${HEADER_END}`)
  const frame = new Uint8Array(headerBytes.length + bodyBytes.length)
  frame.set(headerBytes, 0)
  frame.set(bodyBytes, headerBytes.length)
  return frame
}

/**
 * Decodes every complete frame in `buffer`, keeping any partial tail.
 *
 * @param buffer Bytes received so far; a frame split across buffers is
 *   reassembled by feeding the previous `rest` back with the next chunk.
 * @returns Complete messages in arrival order plus the undecoded tail bytes.
 * @throws Error when a complete header is not a single numeric
 *   `Content-Length` field or a complete body is not a JSON object with a
 *   known message type.
 */
export function decodeDapFrames(buffer: Uint8Array): DapFrameDecodeResult {
  const messages: DapMessage[] = []
  let offset = 0
  while (offset < buffer.length) {
    const separatorIndex = findHeaderSeparator(buffer, offset)
    if (separatorIndex === -1) break
    const headerText = decoder.decode(buffer.subarray(offset, separatorIndex))
    const match = headerPattern.exec(headerText)
    if (match === null) {
      throw new Error(`fake debug adapter: invalid Content-Length header: ${JSON.stringify(headerText)}`)
    }
    const contentStart = separatorIndex + 4
    const contentEnd = contentStart + Number(match[1])
    if (contentEnd > buffer.length) break
    messages.push(parseMessage(decoder.decode(buffer.subarray(contentStart, contentEnd))))
    offset = contentEnd
  }
  return { messages, rest: buffer.subarray(offset) }
}

/** Finds the next header/body separator (`\r\n\r\n`) at or after `from`. */
function findHeaderSeparator(bytes: Uint8Array, from: number): number {
  for (let i = from; i + 3 < bytes.length; i += 1) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) return i
  }
  return -1
}

/** Parses one frame body, requiring a JSON object with a known message type. */
function parseMessage(json: string): DapMessage {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`fake debug adapter: frame body is not JSON: ${json}`, { cause: error })
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`fake debug adapter: frame body is not a JSON object: ${json}`)
  }
  const type = (parsed as { readonly type?: unknown }).type
  if (type !== 'request' && type !== 'response' && type !== 'event') {
    throw new Error(`fake debug adapter: frame body has no DAP message type: ${json}`)
  }
  return parsed as DapMessage
}

/* jscpd:ignore-end */
