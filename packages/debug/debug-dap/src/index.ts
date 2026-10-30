/**
 * DAP wire support for the debug seam: frame codec, byte transports, the
 * request client, the session handshake, and the debug session backend.
 * @module @deepseek-ai/dsh-debug-dap
 */
export { decodeDapFrames, encodeDapFrame, MAX_MESSAGE_BYTES } from './frames.ts'
export type { DapArguments, DapClientMessage, DapEvent, DapFrameDecoding, DapMessage, DapRequest, DapResponse } from './frames.ts'
export { createStdioTransport, createTunnelTransport } from './transport.ts'
export type { DebugTransport, StdioAdapterProcess } from './transport.ts'
export { connectDebugTunnel } from './tunnel.ts'
export type { DebugTunnelConnector, DebugTunnelEndpoint } from './tunnel.ts'
export { DapClient } from './client.ts'
export type { DapEventListener, DapReverseRequestHandler } from './client.ts'
export { mapCapabilities, mergeCapabilities } from './capabilities.ts'
export { initializeDebugAdapter, mapStopReason } from './handshake.ts'
export type { DebugAdapterStop, DebugHandshakeBreakpoints, DebugHandshakePlan, DebugHandshakeResult } from './handshake.ts'
export { DapDebugBackend, DEFAULT_CONSOLE_LIMIT } from './backend.ts'
export type { DapDebugBackendOptions, DapReverseRequestHandlers } from './backend.ts'
