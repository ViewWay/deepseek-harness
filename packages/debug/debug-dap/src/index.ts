/**
 * DAP wire support for the debug seam: frame codec, byte transports, and the
 * request client. The handshake and debug session backend build on these.
 * @module @deepseek-ai/dsh-debug-dap
 */
export { decodeDapFrames, encodeDapFrame, MAX_MESSAGE_BYTES } from './frames.ts'
export type { DapArguments, DapClientMessage, DapEvent, DapFrameDecoding, DapMessage, DapRequest, DapResponse } from './frames.ts'
export { createStdioTransport, createTunnelTransport } from './transport.ts'
export type { DebugTransport, StdioAdapterProcess } from './transport.ts'
export { DapClient } from './client.ts'
export type { DapEventListener, DapReverseRequestHandler } from './client.ts'
