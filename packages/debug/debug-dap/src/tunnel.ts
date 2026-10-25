/**
 * SSH-world tunnel transport: connects a forwarded TCP stream through an
 * injected connector and adapts it as one `DebugTransport`.
 *
 * The connector is injected (the composition passes its `SshService`, whose
 * `connectTcpStream` satisfies it structurally), so this package never
 * depends on the SSH service directly. The stream arrives paused; the tunnel
 * resumes it only after the transport's consumer is attached. Attach never
 * falls back to a host-local adapter: without a working connector or stream,
 * tunnel creation fails with `DEBUG_ATTACH_UNSUPPORTED`.
 * @module @deepseek-ai/dsh-debug-dap/tunnel
 */
import type { Duplex } from 'node:stream'
import { DebugError } from '@deepseek-ai/dsh-debug'
import { createTunnelTransport } from './transport.ts'
import type { DebugTransport } from './transport.ts'

/** Connects one forwarded TCP stream; `SshService` satisfies this directly. */
export interface DebugTunnelConnector {
  /**
   * @param host - Forwarded target host on the remote side.
   * @param port - Forwarded target port.
   * @param signal - Cancels allocation and the resulting stream.
   * @returns A connected duplex stream carrying the tunneled bytes.
   */
  connectTcpStream(host: string, port: number, signal?: AbortSignal): Promise<Duplex>
}

/** One remote endpoint to tunnel a debug adapter connection to. */
export interface DebugTunnelEndpoint {
  readonly host: string
  readonly port: number
}

/**
 * Opens one debug tunnel and wraps it as a transport.
 *
 * @param connector - Stream connector; the composition passes its SSH service.
 * @param endpoint - Remote host and port from the attach plan's tunnel.
 * @param signal - Cancels the stream allocation.
 * @returns The tunnel-backed byte transport.
 * @throws DebugError(`DEBUG_ATTACH_UNSUPPORTED`) when the connector cannot
 *   establish the stream; never falls back to a host-local connection.
 */
export async function connectDebugTunnel(
  connector: DebugTunnelConnector,
  endpoint: DebugTunnelEndpoint,
  signal?: AbortSignal,
): Promise<DebugTransport> {
  let stream: Duplex
  try {
    stream = await connector.connectTcpStream(endpoint.host, endpoint.port, signal)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new DebugError('debug tunnel could not be established: ' + detail, 'DEBUG_ATTACH_UNSUPPORTED')
  }
  stream.resume()
  return createTunnelTransport(stream)
}
