/**
 * Typed fixture factories for debug-seam tests. Tests construct every
 * `Debug*` value through these factories instead of casting with `as never`
 * or `as unknown`: a missing factory shape is a contract gap to fix first,
 * not a cast to add.
 *
 * Ids derive deterministically from a numeric seed: session ids follow the
 * seam's `debug-` + 16 lowercase hex digits format, so failures name stable,
 * well-formed ids.
 * @module @deepseek-ai/dsh-debug-fixture
 */

import { vi } from 'vitest'
import type { Mock } from 'vitest'
import { DebugCompoundId, DebugSessionId } from '@deepseek-ai/dsh-debug'
import type {
  DebugCompoundId as DebugCompoundIdValue,
  DebugSessionId as DebugSessionIdValue,
  DebugSessionState,
} from '@deepseek-ai/dsh-debug'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

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

/**
 * Build one deterministic harness session id from a seed.
 * @param seed - non-negative safe integer identifying the session.
 * @returns a branded `SessionId` in the `session-` + 16 lowercase hex digits format.
 * @throws RangeError when the seed is negative or not a safe integer.
 */
export function fixtureSessionId(seed: number): SessionId {
  return brandString<SessionId>(`session-${fixtureHex(seed)}`)
}

/**
 * Build one deterministic debug compound id from a seed.
 * @param seed - non-negative safe integer identifying the compound.
 * @returns a branded id in the `debug-compound-` + 16 lowercase hex digits format.
 * @throws RangeError when the seed is negative or not a safe integer.
 */
export function fixtureDebugCompoundId(seed: number): DebugCompoundIdValue {
  return DebugCompoundId(`debug-compound-${fixtureHex(seed)}`)
}

/** One compound child test double: identity, state, and an observable terminate. */
export interface FixtureCompoundChild {
  readonly id: DebugSessionIdValue
  readonly state: DebugSessionState
  terminate: Mock<() => Promise<void>>
}

/**
 * Build one compound-child double whose `terminate` is a resolving mock.
 * @param init - the child's id and state.
 * @returns the child double; assert on `terminate.mock.calls`.
 */
export function fixtureCompoundChild(init: { id: DebugSessionIdValue; state: DebugSessionState }): FixtureCompoundChild {
  return { id: init.id, state: init.state, terminate: vi.fn(async () => {}) }
}
