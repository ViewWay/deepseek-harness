/**
 * Debug telemetry attributes: the allowlist projection every debug span may
 * carry. The input deliberately accepts the sensitive facts a launch context
 * holds (workspace root, environment values) so the projection is the single
 * place they are dropped; only the five allowlisted keys survive, so no path
 * segment, environment value, or variable content can ride into telemetry.
 * @module @deepseek-ai/dsh-debug/telemetry
 */

/** The debug surfaces that emit spans. */
export type DebugTelemetrySurface = 'web' | 'desktop' | 'cli' | 'agent'

/** The execution world a debug session ran in. */
export type DebugTelemetryWorld = 'local' | 'ssh' | 'sandbox'

/** Why a debug operation emitted its span. */
export type DebugTelemetryOutcome = 'ok' | 'denied' | 'failed'

/** The sensitive-bearing input a launch context hands to telemetry. */
export interface DebugTelemetryInput {
  /** Surface the operation ran on. */
  readonly surface: DebugTelemetrySurface
  /** Provider that resolved the session. */
  readonly providerId: string
  /** Provider-reported language label. */
  readonly language: string
  /** Execution world the session ran in. */
  readonly executionWorld: DebugTelemetryWorld
  /** Workspace root; dropped by the projection, never a span attribute. */
  readonly workspaceRoot: string
  /** Environment values; dropped by the projection, never span attributes. */
  readonly env: Readonly<Record<string, string>>
  /** Operation outcome. */
  readonly outcome: DebugTelemetryOutcome
}

/** The allowlisted span attributes; carries no paths or environment values. */
export interface DebugTelemetryAttributes {
  readonly surface: DebugTelemetrySurface
  readonly providerId: string
  readonly language: string
  readonly executionWorld: DebugTelemetryWorld
  readonly outcome: DebugTelemetryOutcome
}

/**
 * Project one telemetry input onto its allowlisted span attributes.
 *
 * @param input - The launch-context facts, including the sensitive fields
 *   the projection exists to drop.
 * @returns Only the five allowlisted attributes; `workspaceRoot` and every
 *   `env` value are never carried through.
 */
export function debugSpanAttributes(input: DebugTelemetryInput): DebugTelemetryAttributes {
  return {
    surface: input.surface,
    providerId: input.providerId,
    language: input.language,
    executionWorld: input.executionWorld,
    outcome: input.outcome,
  }
}
