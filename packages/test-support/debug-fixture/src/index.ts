/**
 * Typed fixture factories for debug-seam tests. Tests construct every
 * `Debug*` value through these factories instead of casting with `as never`
 * or `as unknown`: a missing factory shape is a contract gap to fix first,
 * not a cast to add.
 *
 * Session ids follow the seam's `debug-` + 16 lowercase hex digits format and
 * derive deterministically from a numeric seed, so failures name stable ids.
 * @module @deepseek-ai/dsh-debug-fixture
 */

import { DebugSessionId } from '@deepseek-ai/dsh-debug'
import type { DebugSessionId as DebugSessionIdValue } from '@deepseek-ai/dsh-debug'

/**
 * Render one fixture seed as exactly 16 lowercase hex digits.
 * @param seed - non-negative safe integer identifying the fixture value.
 * @returns the zero-padded 16-digit lowercase hex form.
 * @throws RangeError when the seed is negative or not a safe integer.
 */
function fixtureHex(seed: number): string {
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new RangeError(`fixture seed must be a non-negative safe integer, got ${seed}`)
  }
  return seed.toString(16).padStart(16, '0')
}

/**
 * Build one deterministic debug session id from a seed.
 * @param seed - non-negative safe integer identifying the session.
 * @returns a branded id in the `debug-` + 16 lowercase hex digits format.
 * @throws RangeError when the seed is negative or not a safe integer.
 */
export function fixtureDebugSessionId(seed: number): DebugSessionIdValue {
  return DebugSessionId(`debug-${fixtureHex(seed)}`)
}
