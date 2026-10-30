/**
 * Session-backend doubles for controller specs: refusing defaults plus the
 * members one spec wires, so a registration satisfies the full
 * `DebugSessionOperations` face without spelling every stub per test.
 * @module ./fake-backend
 */
import type { DebugSessionOperations } from '@deepseek-ai/dsh-debug/types'

/** Uniform refusing stub for every operation a spec leaves unwired. */
async function refuse(): Promise<never> {
  throw new Error('fake backend member is not wired for this spec')
}

/**
 * Assemble one session-backend double from refusing defaults plus the
 * members one spec wires.
 * @param overrides - The members the spec exercises.
 * @returns The double, satisfying the full session operation surface.
 */
export function fakeBackend(overrides: Partial<DebugSessionOperations> = {}): DebugSessionOperations {
  const refusing: DebugSessionOperations = {
    continue: refuse,
    step: refuse,
    pause: refuse,
    restartFrame: refuse,
    restart: refuse,
    threads: refuse,
    currentThreadStack: refuse,
    stackTrace: refuse,
    scopes: refuse,
    variables: refuse,
    evaluate: refuse,
    setVariable: refuse,
    setExpression: refuse,
    completions: refuse,
    exceptionInfo: refuse,
    modules: refuse,
    loadedSources: refuse,
    source: refuse,
    breakpointLocations: refuse,
    disassemble: refuse,
    readMemory: refuse,
    writeMemory: refuse,
    console: refuse,
  }
  return Object.assign(refusing, overrides)
}
