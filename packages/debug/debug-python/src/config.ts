/**
 * Python provider option validation: entry exclusivity, the required target
 * interpreter, and the debugpy option whitelist, validated loud with the
 * seam's config code.
 * @module @deepseek-ai/dsh-debug-python/config
 */

import { DebugError, processOrPortAttachForm, readOptionalBoolean, readOptionalString, rejectUnknownOptions, requireSingleEntry } from '@deepseek-ai/dsh-debug'
import type { DebugAttachRequest, DebugLaunchRequest, JsonSchema } from '@deepseek-ai/dsh-debug'

/** Provider-option keys debugpy understands; anything else fails. */
const LAUNCH_OPTION_KEYS = new Set(['python', 'justMyCode', 'subProcess', 'django', 'flask'])

/** One validated python launch. */
export interface PythonLaunchConfig {
  readonly entry: string
  readonly entryKind: 'program' | 'module'
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly cwd: string
  readonly python: string
  readonly stopOnEntry?: boolean
  readonly justMyCode?: boolean
  readonly subProcess?: boolean
  readonly django?: boolean
  readonly flask?: boolean
}

/** One validated python attach target. */
export interface PythonAttachConfig {
  readonly processId?: number
  readonly port?: number
}

/** Fail one config validation with the seam's config code. */
function invalid(detail: string): DebugError {
  return new DebugError(`python debug config: ${detail}`, 'DEBUG_INVALID_CONFIG', { detail })
}

/**
 * Validate one launch request into the python provider's normalized config.
 * @param request - the raw launch request.
 * @returns the validated launch config.
 * @throws {@link DebugError} `DEBUG_INVALID_CONFIG` when program and module
 * are not exactly one, the interpreter is missing, or an option is unknown
 * or mistyped.
 */
export function resolvePythonLaunchConfig(request: DebugLaunchRequest): PythonLaunchConfig {
  const entryKind = requireSingleEntry(request, 'program or module', invalid)

  const options = request.providerOptions ?? {}
  rejectUnknownOptions(options, LAUNCH_OPTION_KEYS, 'python', invalid)
  const python = readOptionalString(options, 'python', 'python', invalid)
  if (python === undefined) throw invalid('the python interpreter option is required')

  const justMyCode = readOptionalBoolean(options, 'justMyCode', 'python', invalid)
  const subProcess = readOptionalBoolean(options, 'subProcess', 'python', invalid)
  const django = readOptionalBoolean(options, 'django', 'python', invalid)
  const flask = readOptionalBoolean(options, 'flask', 'python', invalid)

  const entry = entryKind === 'program' ? request.program : request.module
  if (entry === undefined) throw invalid('launch entry is missing')
  return {
    entry,
    entryKind,
    args: request.args ?? [],
    env: request.env ?? {},
    cwd: request.cwd,
    python,
    ...(request.stopOnEntry !== undefined ? { stopOnEntry: request.stopOnEntry } : {}),
    ...(justMyCode !== undefined ? { justMyCode } : {}),
    ...(subProcess !== undefined ? { subProcess } : {}),
    ...(django !== undefined ? { django } : {}),
    ...(flask !== undefined ? { flask } : {}),
  }
}

/**
 * Validate one attach request into exactly one address form.
 * @param request - the raw attach request.
 * @returns the validated attach target.
 * @throws {@link DebugError} `DEBUG_INVALID_CONFIG` when the address forms
 * are not exactly one.
 */
export function resolvePythonAttachConfig(request: DebugAttachRequest): PythonAttachConfig {
  return processOrPortAttachForm(request, invalid)
}

/** The provider's configSchema describing its launch and attach options. */
export const PYTHON_OPTIONS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    python: { type: 'string' },
    justMyCode: { type: 'boolean' },
    subProcess: { type: 'boolean' },
    django: { type: 'boolean' },
    flask: { type: 'boolean' },
  },
  required: ['python'],
  additionalProperties: false,
}
