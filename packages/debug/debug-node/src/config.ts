/**
 * Node provider option validation: the launch/attach fields and the
 * provider-option set js-debug accepts, validated loud with the seam's config
 * code. Unknown options fail; known ones map explicitly into the DAP request.
 * @module @deepseek-ai/dsh-debug-node/config
 */

import { DebugError } from '@deepseek-ai/dsh-debug'
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
  const hasProgram = request.program !== undefined
  const hasModule = request.module !== undefined
  if (hasProgram === hasModule) {
    throw invalid('launch requires exactly one of program or module')
  }

  const options = request.providerOptions ?? {}
  for (const key of Object.keys(options)) {
    if (!LAUNCH_OPTION_KEYS.has(key)) throw invalid(`unknown node launch option "${key}"`)
  }

  const runtimeExecutable = readOptionalString(options, 'runtimeExecutable')
  const rawConsole = readOptionalString(options, 'console')
  const consoleMode = CONSOLE_MODES.find(mode => mode === rawConsole)
  if (rawConsole !== undefined && consoleMode === undefined) {
    throw invalid('console must be internalConsole, integratedTerminal, or externalTerminal')
  }
  const runtimeArgs = readOptionalStringArray(options, 'runtimeArgs')
  const outFiles = readOptionalStringArray(options, 'outFiles')
  const autoAttachChildProcesses = readOptionalBoolean(options, 'autoAttachChildProcesses')
  const sourceMaps = readOptionalBoolean(options, 'sourceMaps')

  const entry = hasProgram ? request.program : request.module
  if (entry === undefined) throw invalid('launch entry is missing')
  return {
    entry,
    entryKind: hasProgram ? 'program' : 'module',
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

/** Read one optional string option. */
function readOptionalString(options: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = options[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw invalid(`node option "${key}" must be a string`)
  return value
}

/** Read one optional string-array option. */
function readOptionalStringArray(options: Readonly<Record<string, unknown>>, key: string): readonly string[] | undefined {
  const value = options[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw invalid(`node option "${key}" must be an array of strings`)
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') throw invalid(`node option "${key}" must be an array of strings`)
    result.push(item)
  }
  return result
}

/** Read one optional boolean option. */
function readOptionalBoolean(options: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  const value = options[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw invalid(`node option "${key}" must be a boolean`)
  return value
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
