/**
 * Node provider option validation: the launch/attach fields and the
 * provider-option set js-debug accepts, validated loud with the seam's config
 * code. Unknown options fail; known ones map explicitly into the DAP request.
 * @module @deepseek-ai/dsh-debug-node/config
 */

import { DebugError, readOptionalBoolean, readOptionalString, readOptionalStringArray, rejectUnknownOptions, requireSingleEntry } from '@deepseek-ai/dsh-debug'
import type { DebugAttachRequest, DebugLaunchRequest, JsonSchema } from '@deepseek-ai/dsh-debug'

/** Provider-option keys js-debug understands; anything else fails. */
const LAUNCH_OPTION_KEYS = new Set(['runtimeExecutable', 'runtimeArgs', 'autoAttachChildProcesses', 'sourceMaps', 'outFiles', 'console'])

/** js-debug's supported console modes. */
const CONSOLE_MODES = ['internalConsole', 'integratedTerminal', 'externalTerminal'] as const

/** One validated node launch: standard request fields plus mapped options. */
export interface NodeLaunchConfig {
  readonly entry: string
  readonly entryKind: 'program' | 'module'
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly cwd: string
  readonly stopOnEntry?: boolean
  readonly runtimeExecutable?: string
  readonly runtimeArgs?: readonly string[]
  readonly autoAttachChildProcesses?: boolean
  readonly sourceMaps?: boolean
  readonly outFiles?: readonly string[]
  readonly console?: 'internalConsole' | 'integratedTerminal' | 'externalTerminal'
}

/** One validated node attach target: exactly one address form. */
export interface NodeAttachConfig {
  readonly processId?: number
  readonly port?: number
  readonly url?: string
}

/** Fail one config validation with the seam's config code. */
function invalid(detail: string): DebugError {
  return new DebugError(`node debug config: ${detail}`, 'DEBUG_INVALID_CONFIG', { detail })
}

/**
 * Validate one launch request into the node provider's normalized config.
 * @param request - the raw launch request.
 * @returns the validated launch config.
 * @throws {@link DebugError} `DEBUG_INVALID_CONFIG` when program and module
 * are not exactly one, or a provider option is unknown or mistyped.
 */
export function resolveNodeLaunchConfig(request: DebugLaunchRequest): NodeLaunchConfig {
  const entryKind = requireSingleEntry(request, 'program or module', invalid)

  const options = request.providerOptions ?? {}
  rejectUnknownOptions(options, LAUNCH_OPTION_KEYS, 'node', invalid)

  const runtimeExecutable = readOptionalString(options, 'runtimeExecutable', 'node', invalid)
  const rawConsole = readOptionalString(options, 'console', 'node', invalid)
  const consoleMode = CONSOLE_MODES.find(mode => mode === rawConsole)
  if (rawConsole !== undefined && consoleMode === undefined) {
    throw invalid('console must be internalConsole, integratedTerminal, or externalTerminal')
  }
  const runtimeArgs = readOptionalStringArray(options, 'runtimeArgs', 'node', invalid)
  const outFiles = readOptionalStringArray(options, 'outFiles', 'node', invalid)
  const autoAttachChildProcesses = readOptionalBoolean(options, 'autoAttachChildProcesses', 'node', invalid)
  const sourceMaps = readOptionalBoolean(options, 'sourceMaps', 'node', invalid)

  const entry = entryKind === 'program' ? request.program : request.module
  if (entry === undefined) throw invalid('launch entry is missing')
  return {
    entry,
    entryKind,
    args: request.args ?? [],
    env: request.env ?? {},
    cwd: request.cwd,
    ...(request.stopOnEntry !== undefined ? { stopOnEntry: request.stopOnEntry } : {}),
    ...(runtimeExecutable !== undefined ? { runtimeExecutable } : {}),
    ...(runtimeArgs !== undefined ? { runtimeArgs } : {}),
    ...(outFiles !== undefined ? { outFiles } : {}),
    ...(autoAttachChildProcesses !== undefined ? { autoAttachChildProcesses } : {}),
    ...(sourceMaps !== undefined ? { sourceMaps } : {}),
    ...(consoleMode !== undefined ? { console: consoleMode } : {}),
  }
}

/**
 * Validate one attach request into exactly one address form.
 * @param request - the raw attach request.
 * @returns the validated attach target.
 * @throws {@link DebugError} `DEBUG_INVALID_CONFIG` when the address forms
 * are not exactly one.
 */
export function resolveNodeAttachConfig(request: DebugAttachRequest): NodeAttachConfig {
  const forms = [request.processId, request.port, request.url].filter(value => value !== undefined)
  if (forms.length !== 1) {
    throw invalid('attach requires exactly one of processId, port, or url')
  }
  return {
    ...(request.processId !== undefined ? { processId: request.processId } : {}),
    ...(request.port !== undefined ? { port: request.port } : {}),
    ...(request.url !== undefined ? { url: request.url } : {}),
  }
}

/** The provider's configSchema describing its launch and attach options. */
export const NODE_OPTIONS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    runtimeExecutable: { type: 'string' },
    runtimeArgs: { type: 'array', items: { type: 'string' } },
    autoAttachChildProcesses: { type: 'boolean' },
    sourceMaps: { type: 'boolean' },
    outFiles: { type: 'array', items: { type: 'string' } },
    console: { type: 'string', enum: ['internalConsole', 'integratedTerminal', 'externalTerminal'] },
  },
  additionalProperties: false,
}
