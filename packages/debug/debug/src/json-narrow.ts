/**
 * Shared fail-loud narrowing of untyped JSON configuration records.
 *
 * Both the named launch configurations and the adapter manifest parse
 * user-authored JSON whose static type is `unknown`; these helpers perform the
 * one runtime check each seam owes at its parser boundary and throw
 * `DEBUG_INVALID_CONFIG` with the offending field named. Typed same-process
 * values never pass through here.
 * @module @deepseek-ai/dsh-debug/json-narrow
 */
import { DebugError } from './error.ts'

/**
 * Build one seam-scoped `DEBUG_INVALID_CONFIG` thrower.
 * @param seam - Config surface name prefixing every invalid-field detail.
 * @returns Unary factory turning a field detail into a `DebugError`.
 */
export function configInvalidFactory(seam: string): (detail: string) => DebugError {
  return detail => new DebugError(`${seam}: ${detail}`, 'DEBUG_INVALID_CONFIG', { detail })
}

/**
 * Narrow one value to a plain record.
 *
 * @param value - The parsed JSON value.
 * @param field - The field name to name in the failure.
 * @param invalid - The seam's failure builder.
 * @returns The value as a plain record.
 * @throws DebugError `DEBUG_INVALID_CONFIG` when the value is not an object.
 */
export function recordOf(value: unknown, field: string, invalid: (detail: string) => DebugError): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${field} must be an object`)
  }
  // The runtime checks above proved the record shape; narrow the survivor.
  return value as Record<string, unknown>
}

/**
 * Read one optional string-record field.
 *
 * @param record - The parent record.
 * @param field - The field name to read and to name in failures.
 * @param invalid - The seam's failure builder.
 * @returns The string record, or undefined when the field is absent.
 * @throws DebugError `DEBUG_INVALID_CONFIG` when a present value or entry is not a string.
 */
export function optionalStringRecord(
  record: Record<string, unknown>,
  field: string,
  invalid: (detail: string) => DebugError,
): Readonly<Record<string, string>> | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  const entries = recordOf(value, field, invalid)
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(entries)) {
    if (typeof entry !== 'string') throw invalid(`${field}.${key} must be a string`)
    result[key] = entry
  }
  return result
}
