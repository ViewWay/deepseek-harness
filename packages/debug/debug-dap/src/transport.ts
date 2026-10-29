/**
 * Byte transports that carry DAP frames between the client and an adapter.
 *
 * A transport is deliberately minimal: an async iterable of received chunks,
 * backpressure-aware writes, and a half-close. Execution worlds provide the
 * underlying streams — a spawned adapter's stdio or a forwarded tunnel socket —
 * and own their lifecycle; the transport never spawns, connects, or closes a
 * process.
 * @module @deepseek-ai/dsh-debug-dap/transport
 */
import type { Duplex, Readable, Writable } from 'node:stream'

/** Carries raw DAP frame bytes to and from one debug adapter. */
export interface DebugTransport {
  /** Chunks received from the adapter; ends when the stream ends. */
  readonly input: AsyncIterable<Uint8Array>
  /**
   * Writes one batch of frame bytes.
   *
   * @param bytes Frame bytes to send.
   * @returns Resolves once the underlying stream accepts the bytes, including
   *   waiting for drain; rejects on a stream failure.
   */
  write(bytes: Uint8Array): Promise<void>
  /** Half-closes the sending side; resolves when the stream finishes it. */
  end(): Promise<void>
}

/** Shape `createStdioTransport` needs from a spawned adapter process. */
export interface StdioAdapterProcess {
  /** The adapter's stdout, carrying frames to this client. */
  readonly stdout: Readable
  /** The adapter's stdin, carrying frames from this client. */
  readonly stdin: Writable
}

/**
 * Adapts a spawned adapter's stdio pipes to a {@link DebugTransport}.
 *
 * @param process Object exposing the adapter's `stdin`/`stdout` streams.
 * @returns The stdio transport.
 */
export function createStdioTransport(process: StdioAdapterProcess): DebugTransport {
  return {
    input: streamChunks(process.stdout),
    write: bytes => writeChunks(process.stdin, bytes),
    end: () => endStream(process.stdin),
  }
}

/**
 * Adapts a connected tunnel socket to a {@link DebugTransport}.
 *
 * @param socket The connected duplex socket of an established tunnel.
 * @returns The tunnel transport.
 */
export function createTunnelTransport(socket: Duplex): DebugTransport {
  return {
    input: streamChunks(socket),
    write: bytes => writeChunks(socket, bytes),
    end: () => endStream(socket),
  }
}

/** Yields the stream's data chunks until it ends or errors. */
async function* streamChunks(stream: Readable): AsyncGenerator<Uint8Array> {
  for await (const chunk of stream) yield chunk
}

/** Writes bytes and resolves once the stream has flushed them to the sink. */
function writeChunks(stream: Writable, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(bytes, (error: Error | null | undefined) => {
      if (error == null) resolve()
      else reject(error)
    })
  })
}

/** Ends the sending side and resolves when the stream reports finish. */
function endStream(stream: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((error: Error | null) => {
      if (error === null) resolve()
      else reject(error)
    })
  })
}
