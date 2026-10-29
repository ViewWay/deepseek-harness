/**
 * Go provider option validation: entry exclusivity, delve modes, and the
 * delve flag whitelists, validated loud with the seam's config code.
 * @module @deepseek-ai/dsh-debug-go/config
 */

import { DebugError, processOrPortAttachForm, readOptionalStringArray, rejectUnknownOptions, requireSingleEntry } from '@deepseek-ai/dsh-debug'
import type { DebugAttachRequest, DebugLaunchRequest, JsonSchema } from '@deepseek-ai/dsh-debug'

/** Delve launch modes. */
const DELVE_MODES = ['debug', 'test', 'exec', 'auto'] as const

/** Provider-option keys delve understands; anything else fails. */
const LAUNCH_OPTION_KEYS = new Set(['mode', 'buildFlags', 'dlvFlags'])

/** One validated go launch. */
export interface GoLaunchConfig {
  readonly entry: string
  readonly entryKind: 'program' | 'package'
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly cwd: string
  readonly mode: (typeof DELVE_MODES)[number]
  readonly buildFlags?: readonly string[]
  readonly dlvFlags?: readonly string[]
  readonly stopOnEntry?: boolean
}

/** One validated go attach target. */
export interface GoAttachConfig {
  readonly processId?: number
  readonly port?: number
}

/** Fail one config validation with the seam's config code. */
function invalid(detail: string): DebugError {
  return new DebugError(`go debug config: ${detail}`, 'DEBUG_INVALID_CONFIG', { detail })
}

/**
 * Validate one launch request into the go provider's normalized config.
 * @param request - the raw launch request.
 * @returns the validated launch config.
 * @throws {@link DebugError} `DEBUG_INVALID_CONFIG` when program and module
 * are not exactly one, or an option is unknown or mistyped.
 */
export function resolveGoLaunchConfig(request: DebugLaunchRequest): GoLaunchConfig {
  const entryKind = requireSingleEntry(request, 'program or package (module)', invalid) === 'program' ? 'program' : 'package'

  const options = request.providerOptions ?? {}
  rejectUnknownOptions(options, LAUNCH_OPTION_KEYS, 'go', invalid)
  const rawMode = options['mode']
  const mode = DELVE_MODES.find(entry => entry === rawMode)
  if (rawMode !== undefined && mode === undefined) {
    throw invalid('mode must be debug, test, exec, or auto')
  }
  const buildFlags = readOptionalStringArray(options, 'buildFlags', 'go', invalid)
  const dlvFlags = readOptionalStringArray(options, 'dlvFlags', 'go', invalid)

  const entry = entryKind === 'program' ? request.program : request.module
  if (entry === undefined) throw invalid('launch entry is missing')
  return {
    entry,
    entryKind,
    args: request.args ?? [],
    env: request.env ?? {},
    cwd: request.cwd,
    mode: mode ?? 'debug',
    ...(buildFlags !== undefined ? { buildFlags } : {}),
    ...(dlvFlags !== undefined ? { dlvFlags } : {}),
    ...(request.stopOnEntry !== undefined ? { stopOnEntry: request.stopOnEntry } : {}),
  }
}

/**
 * Validate one attach request into exactly one address form.
 * @param request - the raw attach request.
 * @returns the validated attach target.
 * @throws {@link DebugError} `DEBUG_INVALID_CONFIG` when the address forms
 * are not exactly one.
 */
export function resolveGoAttachConfig(request: DebugAttachRequest): GoAttachConfig {
  return processOrPortAttachForm(request, invalid)
}

/** The provider's configSchema describing its launch and attach options. */
export const GO_OPTIONS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: [...DELVE_MODES] },
    buildFlags: { type: 'array', items: { type: 'string' } },
    dlvFlags: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
}
