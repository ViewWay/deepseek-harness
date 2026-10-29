/**
 * Named launch configurations (`.dsh/debug.json`): schema-versioned parsing
 * with variable expansion over the workspace and file context. Only the six
 * documented variables substitute; command substitution, shell evaluation,
 * and unresolved variables fail with the offending field named. Provider
 * options pass through verbatim for the provider's own schema validation.
 * @module @deepseek-ai/dsh-debug/launch-config
 */

import { configInvalidFactory, optionalStringRecord, recordOf } from './json-narrow.ts'

/** One named launch or attach configuration after expansion. */
export interface DebugLaunchConfiguration {
  readonly name: string
  /** Provider id text; the provider registry brands it at resolution. */
  readonly type: string
  readonly request: 'launch' | 'attach'
  readonly program?: string
  readonly module?: string
  readonly cwd?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly stopOnEntry?: boolean
  readonly processId?: number
  readonly port?: number
  readonly host?: string
  readonly url?: string
  /** Provider-owned options, verbatim; the provider's schema validates them. */
  readonly options?: Readonly<Record<string, unknown>>
}

/** One named compound configuration after validation. */
export interface DebugCompoundConfiguration {
  readonly name: string
  /** Referenced configuration names, in start order; every one must exist. */
  readonly configurations: readonly string[]
  readonly stopAll: boolean
}

/** The variable-substitution context of one parse. */
export interface DebugLaunchConfigContext {
  readonly workspaceFolder: string
  readonly file: string
  readonly env: Readonly<Record<string, string>>
}

/** The parsed workspace debug configuration. */
export interface DebugLaunchConfig {
  readonly configurations: readonly DebugLaunchConfiguration[]
  readonly compounds: readonly DebugCompoundConfiguration[]
}

/** Fail one configuration parse with the seam's config code. */
const invalid = configInvalidFactory('debug launch configuration')

/** The variables one string field may carry. */
const KNOWN_VARIABLES = new Set(['workspaceFolder', 'file', 'relativeFile', 'fileBasename', 'fileDirname'])

/**
 * Substitute the documented variables in one string field.
 * @param value - the raw template text.
 * @param field - the field's name, for failure messages.
 * @param context - workspace, file, and environment values.
 * @returns the expanded text.
 * @throws {@link DebugError} `DEBUG_INVALID_CONFIG` naming the field for
 * command substitution, unknown variables, or missing environment values.
 */
export function expandDebugVariables(value: string, field: string, context: DebugLaunchConfigContext): string {
  if (value.includes('$(') || value.includes('`')) {
    throw invalid(`${field} uses command substitution, which is not supported`)
  }
  return value.replace(/\$\{([^}]+)\}/g, (whole: string, name: string): string => {
    if (name.startsWith('env:')) {
      const envName = name.slice('env:'.length)
      const envValue = context.env[envName]
      if (envValue === undefined) throw invalid(`${field} references unset environment variable ${envName}`)
      return envValue
    }
    if (KNOWN_VARIABLES.has(name)) return whole
    throw invalid(`${field} references unsupported variable ${name}`)
  }).replace(/\$\{workspaceFolder\}/g, context.workspaceFolder)
    .replace(/\$\{file\}/g, context.file)
    .replace(/\$\{relativeFile\}/g, relativeFile(context))
    .replace(/\$\{fileBasename\}/g, fileBasename(context))
    .replace(/\$\{fileDirname\}/g, fileDirname(context))
}

/** The file path relative to the workspace folder. */
function relativeFile(context: DebugLaunchConfigContext): string {
  const prefix = context.workspaceFolder.endsWith('/')
    ? context.workspaceFolder
    : `${context.workspaceFolder}/`
  if (!context.file.startsWith(prefix)) {
    throw invalid(`file "${context.file}" is outside workspace folder "${context.workspaceFolder}"`)
  }
  return context.file.slice(prefix.length)
}

/** The file's base name. */
function fileBasename(context: DebugLaunchConfigContext): string {
  const segments = context.file.split('/')
  return segments[segments.length - 1] ?? ''
}

/** The file's directory. */
function fileDirname(context: DebugLaunchConfigContext): string {
  const segments = context.file.split('/')
  return segments.slice(0, -1).join('/')
}

/** Read one optional expanded string field. */
function expandedString(record: Record<string, unknown>, field: string, context: DebugLaunchConfigContext): string | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw invalid(`${field} must be a string`)
  return expandDebugVariables(value, field, context)
}

/** Read one optional string-array field, expanding every element. */
function expandedStringArray(
  record: Record<string, unknown>,
  field: string,
  context: DebugLaunchConfigContext,
): readonly string[] | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw invalid(`${field} must be an array of strings`)
  return value.map((item, index) => {
    if (typeof item !== 'string') throw invalid(`${field}[${index}] must be a string`)
    return expandDebugVariables(item, `${field}[${index}]`, context)
  })
}

/** Configuration fields read verbatim with their expected kinds. */
const CONFIGURATION_KEYS = new Set(['name', 'type', 'request', 'program', 'module', 'cwd', 'args', 'env', 'stopOnEntry', 'processId', 'port', 'host', 'url', 'options'])
const COMPOUND_KEYS = new Set(['name', 'configurations', 'stopAll'])

/** Read one optional safe-integer field. */
function narrowSafeInteger(record: Record<string, unknown>, field: string, name: string): number | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw invalid(`configuration "${name}": ${field} must be a safe integer`)
  }
  return value
}

/** Read one optional string-record field, naming the owning configuration. */
function narrowStringRecord(record: Record<string, unknown>, field: string, name: string): Readonly<Record<string, string>> | undefined {
  return optionalStringRecord(record, field, detail => invalid(`configuration "${name}": ${detail}`))
}

/** Parse one configuration entry. */
function parseConfiguration(value: unknown, context: DebugLaunchConfigContext, seenNames: Set<string>): DebugLaunchConfiguration {
  const record = recordOf(value, 'configuration', invalid)
  for (const key of Object.keys(record)) {
    if (!CONFIGURATION_KEYS.has(key)) throw invalid(`unknown configuration field "${key}"`)
  }
  const name = record['name']
  if (typeof name !== 'string' || name.trim() === '') throw invalid('configuration name must be a non-empty string')
  if (seenNames.has(name)) throw invalid(`duplicate configuration name "${name}"`)
  seenNames.add(name)

  const type = record['type']
  if (typeof type !== 'string' || type.trim() === '') throw invalid(`configuration "${name}": type must be a non-empty string`)
  const request = record['request']
  if (request !== 'launch' && request !== 'attach') {
    throw invalid(`configuration "${name}": request must be launch or attach`)
  }

  const processId = narrowSafeInteger(record, 'processId', name)
  const port = narrowSafeInteger(record, 'port', name)

  const env = narrowStringRecord(record, 'env', name)
  const stopOnEntry = record['stopOnEntry']
  if (stopOnEntry !== undefined && typeof stopOnEntry !== 'boolean') {
    throw invalid(`configuration "${name}": stopOnEntry must be a boolean`)
  }
  const options = record['options']
  if (options !== undefined) recordOf(options, 'options', invalid)

  const program = expandedString(record, 'program', context)
  const module = expandedString(record, 'module', context)
  const cwd = expandedString(record, 'cwd', context)
  const url = expandedString(record, 'url', context)
  const host = expandedString(record, 'host', context)
  const args = expandedStringArray(record, 'args', context)

  return {
    name,
    type,
    request,
    ...(program !== undefined ? { program } : {}),
    ...(module !== undefined ? { module } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(host !== undefined ? { host } : {}),
    ...(args !== undefined ? { args } : {}),
    ...(env !== undefined ? { env } : {}),
    ...(stopOnEntry !== undefined ? { stopOnEntry } : {}),
    ...(processId !== undefined ? { processId } : {}),
    ...(port !== undefined ? { port } : {}),
    ...(options !== undefined ? { options: recordOf(options, 'options', invalid) } : {}),
  }
}

/** Parse one compound entry after all configurations are known. */
function parseCompound(value: unknown, knownNames: ReadonlySet<string>, seenNames: Set<string>): DebugCompoundConfiguration {
  const record = recordOf(value, 'compound', invalid)
  for (const key of Object.keys(record)) {
    if (!COMPOUND_KEYS.has(key)) throw invalid(`unknown compound field "${key}"`)
  }
  const name = record['name']
  if (typeof name !== 'string' || name.trim() === '') throw invalid('compound name must be a non-empty string')
  if (seenNames.has(name)) throw invalid(`duplicate compound name "${name}"`)
  seenNames.add(name)
  const references = record['configurations']
  if (!Array.isArray(references) || references.length === 0 || references.some(item => typeof item !== 'string')) {
    throw invalid(`compound "${name}": configurations must be a non-empty list of names`)
  }
  for (const reference of references) {
    if (typeof reference === 'string' && !knownNames.has(reference)) {
      throw invalid(`compound "${name}" references unknown configuration "${reference}"`)
    }
  }
  const stopAll = record['stopAll']
  if (stopAll !== undefined && typeof stopAll !== 'boolean') {
    throw invalid(`compound "${name}": stopAll must be a boolean`)
  }
  return { name, configurations: references as readonly string[], stopAll: stopAll === true }
}

/**
 * Parse one workspace debug configuration.
 * @param json - the raw `.dsh/debug.json` text.
 * @param context - workspace, file, and environment values for substitution.
 * @returns the expanded configurations and validated compounds.
 * @throws {@link DebugError} `DEBUG_INVALID_CONFIG` for malformed JSON,
 * unknown fields, duplicate or dangling names, unsupported versions, command
 * substitution, and unresolved variables (failures name the offending field).
 */
export function parseLaunchConfig(json: string, context: DebugLaunchConfigContext): DebugLaunchConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error: unknown) {
    throw invalid(`not valid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
  const record = recordOf(parsed, 'document', invalid)
  for (const key of Object.keys(record)) {
    if (key !== 'version' && key !== 'configurations' && key !== 'compounds') {
      throw invalid(`unknown top-level field "${key}"`)
    }
  }
  if (record['version'] !== 1) throw invalid('version must be 1')

  const rawConfigurations = record['configurations']
  if (!Array.isArray(rawConfigurations) || rawConfigurations.length === 0) {
    throw invalid('configurations must be a non-empty list')
  }
  const configurationNames = new Set<string>()
  const configurations = rawConfigurations.map(entry => parseConfiguration(entry, context, configurationNames))

  const rawCompounds = record['compounds']
  const compounds: DebugCompoundConfiguration[] = []
  if (rawCompounds !== undefined) {
    if (!Array.isArray(rawCompounds)) throw invalid('compounds must be a list')
    const compoundNames = new Set<string>()
    for (const entry of rawCompounds) {
      compounds.push(parseCompound(entry, configurationNames, compoundNames))
    }
  }
  return { configurations, compounds }
}
