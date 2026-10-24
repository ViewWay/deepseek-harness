/**
 * Compound debug configurations: an ordered child-session list with a
 * stop-all policy, aggregated state, and settle-driven completion.
 * @module @deepseek-ai/dsh-debug/compound
 */

import type { DebugCompoundId, DebugSessionId } from './brand.ts'
import { DebugError } from './error.ts'
import type { DebugSessionState } from './types.ts'

/** The child capability a compound drives: identity, lifecycle state, and teardown. */
export interface DebugCompoundChild {
  readonly id: DebugSessionId
  readonly state: DebugSessionState
  terminate(): Promise<void>
}

/** Whether one child state is terminal for aggregation purposes. */
function isTerminal(state: DebugSessionState): boolean {
  return state === 'terminated' || state === 'failed'
}

/**
 * One compound: holds its ordered children, aggregates their state, and
 * terminates the rest when a child settles under the stop-all policy.
 * `settleChild` records natural child endings (process exit, teardown);
 * `terminate` tears every child down and completes the compound.
 */
export class DebugCompound {
  private settled = new Set<DebugSessionId>()
  private terminated = false

  constructor(
    readonly id: DebugCompoundId,
    private readonly children: readonly DebugCompoundChild[],
    readonly stopAll: boolean,
  ) {}

  /** The compound's ordered child ids. */
  get sessions(): readonly DebugSessionId[] {
    return this.children.map(child => child.id)
  }

  /** Aggregated state: any active child means running, any stopped child means stopped, else terminal. */
  get state(): DebugSessionState {
    if (this.terminated) return 'terminated'
    if (this.children.some(child => child.state === 'starting' || child.state === 'running')) return 'running'
    if (this.children.some(child => child.state === 'stopped')) return 'stopped'
    return 'terminated'
  }

  /**
   * Tear every child down and complete the compound.
   * @returns a promise that settles when every child's teardown settled.
   */
  async terminate(): Promise<void> {
    this.terminated = true
    await Promise.all(this.children.map(child => child.terminate()))
  }

  /**
   * Record one child's natural ending; under stop-all, terminate the rest.
   * @param id - the child whose session ended on its own.
   * @returns a promise that settles when any stop-all teardown completed.
   */
  async settleChild(id: DebugSessionId): Promise<void> {
    if (this.terminated) return
    this.settled.add(id)
    if (this.stopAll) {
      this.terminated = true
      await Promise.all(this.children
        .filter(child => child.id !== id && !isTerminal(child.state) && !this.settled.has(child.id))
        .map(child => child.terminate()))
      return
    }
    if (this.settled.size >= this.children.length) this.terminated = true
  }
}

/** Registry of live compounds by id. */
export class DebugCompoundRegistry {
  private readonly compounds = new Map<DebugCompoundId, DebugCompound>()

  /**
   * Create and register one compound.
   * @param id - the compound's id.
   * @param children - ordered child sessions.
   * @param stopAll - whether one child ending terminates the rest.
   * @returns the registered compound.
   * @throws {@link DebugError} `DEBUG_CONFLICT` when the id is already registered.
   */
  create(id: DebugCompoundId, children: readonly DebugCompoundChild[], stopAll: boolean): DebugCompound {
    if (this.compounds.has(id)) {
      throw new DebugError(`a debug compound with id "${id}" is already registered`, 'DEBUG_CONFLICT')
    }
    const compound = new DebugCompound(id, children, stopAll)
    this.compounds.set(id, compound)
    return compound
  }

  /**
   * Read one compound.
   * @param id - the compound's id.
   * @returns the compound, or undefined when not registered.
   */
  get(id: DebugCompoundId): DebugCompound | undefined {
    return this.compounds.get(id)
  }
}
