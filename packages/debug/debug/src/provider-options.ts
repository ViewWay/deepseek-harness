/**
 * Shared option readers and entry-path helpers for the language providers.
 *
 * Every provider validates `providerOptions` at its parser boundary with the
 * same fail-loud shape; these helpers own that shape once so the providers
 * keep only their option vocabularies. Readers take the provider's `label`
 * and failure builder so each provider's error text stays its own.
 * @module @deepseek-ai/dsh-debug/provider-options
 */
import type { DebugError } from './error.ts'
import type { DebugAdapterCommand, DebugAttachRequest, DebugEnvironment, DebugLaunchRequest, ResolvedDebugAdapter } from './types.ts'

/** One provider's `DEBUG_INVALID_CONFIG` failure builder. */
export type ProviderInvalid = (detail: string) => DebugError

/**
 * Require exactly one launch entry form on the request.
 *
 * @param request - The launch request carrying at most one entry form.
 * @param nouns - The entry nouns naming the failure, e.g. `program or module`.
 * @param invalid - The provider's failure builder.
 * @returns Which form is present.
 * @throws DebugError `DEBUG_INVALID_CONFIG` when both or neither form is set.
 */
export function requireSingleEntry(
  request: Pick<DebugLaunchRequest, 'program' | 'module'>,
  nouns: string,
  invalid: ProviderInvalid,
): 'program' | 'module' {
  const hasProgram = request.program !== undefined
  const hasModule = request.module !== undefined
  if (hasProgram === hasModule) throw invalid(`launch requires exactly one of ${nouns}`)
  return hasProgram ? 'program' : 'module'
}

/**
 * Reject provider-option keys outside the provider's whitelist.
 *
 * @param options - The request's `providerOptions` record.
 * @param known - The provider's accepted option keys.
 * @param label - The provider id naming failures, e.g. `node`.
 * @param invalid - The provider's failure builder.
 * @throws DebugError `DEBUG_INVALID_CONFIG` on the first unknown key.
 */
export function rejectUnknownOptions(
  options: Readonly<Record<string, unknown>>,
  known: ReadonlySet<string>,
  label: string,
  invalid: ProviderInvalid,
): void {
  for (const key of Object.keys(options)) {
    if (!known.has(key)) throw invalid(`unknown ${label} launch option "${key}"`)
  }
}

/**
 * Build the launch plan's adapter command from the resolved adapter.
 *
 * @param resolved - The adapter the environment resolved for the provider.
 * @param environment - The target execution world's working directory.
 * @returns The plan's `adapter` block.
 */
export function adapterCommandOf(
  resolved: ResolvedDebugAdapter,
  environment: Pick<DebugEnvironment, 'cwd'>,
): DebugAdapterCommand {
  return {
    command: resolved.command,
    args: resolved.args,
    env: resolved.env,
    cwd: environment.cwd,
  }
}

/**
 * Absolutize a workspace-relative entry path in the target execution world.
 * @param entry - The entry as the request carried it.
 * @param workspaceRoot - The workspace root in the target world's separators.
 * @param separator - The target world's path separator.
 * @returns The entry unchanged when already absolute, else joined onto the
 *   workspace root.
 */
export function absoluteEntry(entry: string, workspaceRoot: string, separator: string): string {
  if (entry.startsWith('/') || entry.startsWith(separator) || /^[A-Za-z]:/.test(entry)) return entry
  return `${workspaceRoot}${separator}${entry}`
}

/**
 * Read one optional string provider option.
 *
 * @param options - The request's `providerOptions` record.
 * @param key - The option key to read.
 * @param label - The provider id naming failures, e.g. `node`.
 * @param invalid - The provider's failure builder.
 * @returns The option value, or undefined when absent.
 * @throws DebugError `DEBUG_INVALID_CONFIG` when a present value is not a string.
 */
export function readOptionalString(
  options: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  invalid: ProviderInvalid,
): string | undefined {
  const value = options[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw invalid(`${label} option "${key}" must be a string`)
  return value
}

/**
 * Read one optional boolean provider option.
 *
 * @param options - The request's `providerOptions` record.
 * @param key - The option key to read.
 * @param label - The provider id naming failures, e.g. `python`.
 * @param invalid - The provider's failure builder.
 * @returns The option value, or undefined when absent.
 * @throws DebugError `DEBUG_INVALID_CONFIG` when a present value is not a boolean.
 */
export function readOptionalBoolean(
  options: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  invalid: ProviderInvalid,
): boolean | undefined {
  const value = options[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw invalid(`${label} option "${key}" must be a boolean`)
  return value
}

/**
 * Read one optional string-array provider option.
 *
 * @param options - The request's `providerOptions` record.
 * @param key - The option key to read.
 * @param label - The provider id naming failures, e.g. `go`.
 * @param invalid - The provider's failure builder.
 * @returns The option values, or undefined when absent.
 * @throws DebugError `DEBUG_INVALID_CONFIG` when a present value is not an
 *   array of strings.
 */
export function readOptionalStringArray(
  options: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  invalid: ProviderInvalid,
): readonly string[] | undefined {
  const value = options[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw invalid(`${label} option "${key}" must be an array of strings`)
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') throw invalid(`${label} option "${key}" must be an array of strings`)
    result.push(item)
  }
  return result
}

/**
 * Narrow one attach request to its single process-id or port address form.
 *
 * @param request - The attach request carrying at most one address form.
 * @param invalid - The provider's failure builder.
 * @returns Exactly the one present address field.
 * @throws DebugError `DEBUG_INVALID_CONFIG` when both or neither form is set.
 */
export function processOrPortAttachForm(
  request: DebugAttachRequest,
  invalid: ProviderInvalid,
): { processId?: number; port?: number } {
  const forms = [request.processId, request.port].filter(value => value !== undefined)
  if (forms.length !== 1) {
    throw invalid('attach requires exactly one of processId or port')
  }
  return {
    ...(request.processId !== undefined ? { processId: request.processId } : {}),
    ...(request.port !== undefined ? { port: request.port } : {}),
  }
}
