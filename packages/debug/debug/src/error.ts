/**
 * The debug seam's typed failure: a stable `DebugErrorCode` plus the
 * identity fields callers need to route and report a failure.
 * @module @deepseek-ai/dsh-debug/error
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { DebugProviderId, DebugSessionId } from './brand.ts'
import type { DebugErrorCode } from './types.ts'

/** Identity and remediation context attached to a thrown {@link DebugError}; each field is present only when it applies. */
export interface DebugErrorDetails {
  /** Provider whose registration, resolution, or session failed. */
  readonly providerId?: DebugProviderId
  /** Session the failure belongs to. */
  readonly sessionId?: DebugSessionId
  /** Workspace the failing request named. */
  readonly workspaceId?: string
  /** Actionable next step for the reported failure. */
  readonly detail?: string
}

/**
 * Structured debug failure. Extends {@link HarnessError} with a narrowed
 * `code` from {@link DebugErrorCode}; callers route on `code` and read
 * `providerId`/`sessionId`/`workspaceId`/`detail` when present instead of
 * parsing `message`.
 */
export class DebugError extends HarnessError {
  /** Narrowed stable failure code of the debug seam. */
  override readonly code: DebugErrorCode
  /** Provider the failure is about, when one applies. */
  readonly providerId: DebugProviderId | undefined
  /** Session the failure is about, when one applies. */
  readonly sessionId: DebugSessionId | undefined
  /** Workspace the failing request named, when one applies. */
  readonly workspaceId: string | undefined
  /** Actionable next step, when the failure admits one. */
  readonly detail: string | undefined

  /**
   * Build one typed debug failure.
   * @param message - human-readable description; routing never parses this.
   * @param code - stable failure class from {@link DebugErrorCode}.
   * @param details - optional identity and remediation context.
   * @param options - standard `ErrorOptions` for `cause` chaining.
   */
  constructor(message: string, code: DebugErrorCode, details: DebugErrorDetails = {}, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
    this.providerId = details.providerId
    this.sessionId = details.sessionId
    this.workspaceId = details.workspaceId
    this.detail = details.detail
  }
}
