/**
 * Model-facing debug tools over `ctx.debug`: four registered tools with
 * closed operation unions, bounded canonical results, the fixed system-prompt
 * section, and pure call/result presenters. Launch and attach dispatch
 * through the approval gate and the service's orchestrator seam, agent memory
 * writes ask for approval, and stop notices reach the owning session's
 * transcript under this package's delivery Config.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-tool-debug
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DebugError } from '@deepseek-ai/dsh-debug'
import type { DebugScope, DebugStoppedEvent } from '@deepseek-ai/dsh-debug'
import { DEBUG_PROMPT_SECTION, DEBUG_PROMPT_TEXT } from './prompt.ts'
import { dispatchExecutionOperation, dispatchInspectOperation } from './dispatch.ts'
import { approvalFaceOf, authorizeWriteMemory, dispatchSessionLaunch } from './launch.ts'
import { deliverStopNotice } from './notices.ts'
import type { DebugStopDelivery } from './notices.ts'
import {
  DEBUG_BREAKPOINTS_OPERATIONS,
  DEBUG_EXECUTION_OPERATIONS,
  DEBUG_INSPECT_OPERATIONS,
  DEBUG_SESSION_OPERATIONS,
  parseDebugOperation,
  parseSessionId,
  resolveSessionBackend,
  unavailableBackend,
} from './tools.ts'

export {
  DEBUG_BREAKPOINTS_OPERATIONS,
  DEBUG_EXECUTION_OPERATIONS,
  DEBUG_INSPECT_OPERATIONS,
  DEBUG_SESSION_OPERATIONS,
  DEBUG_TOOL_NAMES,
  parseDebugOperation,
  parseProviderId,
  parseSessionId,
  resolveSessionBackend,
  unavailableBackend,
} from './tools.ts'
export type {
  DebugBreakpointsOperation,
  DebugExecutionOperation,
  DebugInspectOperation,
  DebugOperationOf,
  DebugSessionOperation,
  DebugToolName,
} from './tools.ts'
export { dispatchExecutionOperation, dispatchInspectOperation } from './dispatch.ts'
export type { DebugExecutionArgs, DebugInspectArgs } from './dispatch.ts'
export { approvalFaceOf, authorizeWriteMemory, dispatchSessionLaunch } from './launch.ts'
export type {
  DebugLaunchDeps,
  DebugLaunchOutcome,
  DebugLaunchService,
  DebugSessionLaunchArgs,
} from './launch.ts'
export { DEBUG_PROMPT_SECTION, DEBUG_PROMPT_TEXT } from './prompt.ts'
export { boundValue, renderSeamStackTrace, renderStackTrace, renderVariables } from './render.ts'
export type { RenderedFrame, RenderedStackTrace, RenderedVariable, RenderedVariables } from './render.ts'
export { createStopNotice, deliverStopNotice, shouldWake } from './notices.ts'
export type {
  DebugNoticeBounds,
  DebugNoticeDeliveryOutcome,
  DebugNoticeFacts,
  DebugNoticeTarget,
  DebugStopDelivery,
  DebugStopFacts,
  DebugWakeFacts,
} from './notices.ts'
export { grantControl, requestDebugApproval } from './approval.ts'
export type { DebugApprovalFace, DebugApprovalKind, DebugApprovalRequest, DebugControlGrant, DebugControlGrantSource, DebugControlFacts } from './approval.ts'

/** Largest stop notice in bytes before truncation. */
const DEFAULT_MAX_NOTICE_BYTES = 512

/** Configures debug stop-notice delivery. */
export interface Config {
  /** Whether a stop on an idle agent-owned session opens a turn (default wakeup). */
  readonly debugStopDelivery?: DebugStopDelivery
  /**
   * Turns one agent may have opened by debug wakes before the next notice
   * degrades to injection, reset by any user-authored input. Absent by
   * default: every qualifying stop wakes its owner.
   */
  readonly debugMaxConsecutiveWakes?: number
  /** Largest stop notice in bytes (default 512). */
  readonly maxNoticeBytes?: number
}

export const Config: z<Config> = z.object({
  debugStopDelivery: z.union(['wakeup', 'quiet'] as const).default('wakeup'),
  debugMaxConsecutiveWakes: z.number().min(1),
  maxNoticeBytes: z.natural().default(DEFAULT_MAX_NOTICE_BYTES),
})

/** Project one session info into its plain JSON form for tool results. */
function sessionJson(info: {
  readonly id: string
  readonly providerId: string
  readonly workspaceId: string
  readonly state: string
  readonly ownerSessionId?: string
}): Record<string, string> {
  return {
    id: info.id,
    providerId: info.providerId,
    workspaceId: info.workspaceId,
    state: info.state,
    ...(info.ownerSessionId !== undefined ? { ownerSessionId: info.ownerSessionId } : {}),
  }
}

/** Cordis plugin name for loader diagnostics. */
export const name = 'tool-debug'

/** Services required by this plugin. */
export const inject = ['tools', 'debug', 'systemPrompt']

/** Execution operations whose settlement is the next stop their result delivers. */
const RESUME_OPERATIONS: ReadonlySet<string> = new Set(['continue', 'step_over', 'step_in', 'step_out', 'step_back'])

/**
 * Register the four debug tools, the fixed system-prompt section, and the
 * stop-notice delivery. Each tool validates its closed operation union first,
 * then dispatches to the landed `ctx.debug` faces: launch and attach pass the
 * approval gate and the orchestrator seam, memory writes ask for approval,
 * and operations whose backing face has not landed fail typed.
 * @param ctx - the plugin's context (must inject tools, debug, systemPrompt).
 * @param config - stop-notice delivery policy and bounds.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const delivery = config.debugStopDelivery ?? 'wakeup'
  const wakeBudget = config.debugMaxConsecutiveWakes
  const noticeBounds = { maxBytes: config.maxNoticeBytes ?? DEFAULT_MAX_NOTICE_BYTES }
  const approval = approvalFaceOf(ctx.get('approval'))

  // A budget is a count of turns: a fraction never names a turn.
  if (wakeBudget !== undefined && !Number.isSafeInteger(wakeBudget)) {
    throw new Error(`tool-debug: debugMaxConsecutiveWakes (${wakeBudget}) must be a whole number of turns`)
  }

  // Caller kind per live debug session launched through this plugin; the
  // durable session-ended event releases the entry.
  const sessionOwners = new Map<string, 'agent' | 'user'>()
  // The harness session with an unsettled resume, keyed by debug session id.
  const pendingResume = new Map<string, string>()
  // Turns this plugin opened per agent since that agent last consumed human input.
  const spentWakes = new WeakMap<Agent, number>()

  /**
   * Deliver one durable stop to the session that logged it. The orchestrator
   * appends debug events to the calling session's log, so the receiving
   * session owns the debug session; an ownership this plugin never recorded
   * never wakes.
   * @param owner - the harness session whose log carries the stop event.
   * @param stop - the durable stop facts.
   */
  const deliverStop = (owner: Session, stop: DebugStoppedEvent): void => {
    const agent = ctx.get('agents')?.get(owner.id)
    if (agent === undefined) return
    const pendingBy = pendingResume.get(stop.sessionId)
    const outcome = deliverStopNotice(stop, {
      owner: sessionOwners.get(stop.sessionId) ?? 'user',
      delivery,
      ...(pendingBy !== undefined ? { pendingResumeBy: pendingBy } : {}),
      caller: owner.id,
      ...(wakeBudget !== undefined ? { remainingWakes: wakeBudget - (spentWakes.get(agent) ?? 0) } : {}),
    }, noticeBounds, {
      idle: agent.status === 'idle',
      inject: (message) => { agent.inject(message) },
      followup: (message) => { agent.followup(message) },
    })
    if (outcome === 'woken') spentWakes.set(agent, (spentWakes.get(agent) ?? 0) + 1)
  }

  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    // Claiming is the point the human's input actually enters a step; a
    // notice this plugin itself queued must not refill the budget it spent.
    if (delivery === 'wakeup' && wakeBudget !== undefined && message.source.kind === 'user') {
      spentWakes.delete(agent)
    }
  })
  ctx.on('session/event', (session, event) => {
    if (event.type === 'debug/stopped') {
      deliverStop(session, event.data)
      return
    }
    if (event.type === 'debug/session-ended') {
      sessionOwners.delete(event.data.sessionId)
      pendingResume.delete(event.data.sessionId)
    }
  })

  const debugSessionTool = defineTool({
    name: 'debug_session',
    description: 'Manage debug sessions. operation is one of launch, attach, launch_compound, list, list_compounds, get, get_compound, terminate, terminate_compound, disconnect, attach_targets. Launch and attach need providerId, workspaceId, workspaceRoot, and cwd (launch); agent calls require user approval, and the calling session owns the debug session.',
    parameters: {
      operation: { type: 'string', required: true, enum: [...DEBUG_SESSION_OPERATIONS], description: 'The session operation to run.' },
      sessionId: { type: 'string', description: 'Debug session id, serialized debug-<hex> form; required by get, terminate, and disconnect.' },
      workspaceId: { type: 'string', description: 'Workspace scope for list; the workspace a launch or attach debugs in.' },
      providerId: { type: 'string', description: 'Provider id for launch and attach, e.g. node, python, go, native.' },
      workspaceRoot: { type: 'string', description: 'Absolute workspace root for launch and attach.' },
      program: { type: 'string', description: 'Program path for launch, workspace-relative or absolute.' },
      module: { type: 'string', description: 'Module or package name for launch.' },
      cwd: { type: 'string', description: 'Working directory for launch.' },
      args: { type: 'array', items: { type: 'string' }, description: 'Target command-line arguments for launch.' },
      env: { type: 'object', additionalProperties: true, description: 'Environment variables for the launched target.' },
      stopOnEntry: { type: 'boolean', description: 'Stop immediately after launch.' },
      processId: { type: 'number', description: 'Process id for attach.' },
      port: { type: 'number', description: 'Inspector or debug port for attach.' },
      url: { type: 'string', description: 'Attach URL for browser or server targets.' },
      providerOptions: { type: 'object', additionalProperties: true, description: 'Provider-specific launch and attach options.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const operation = parseDebugOperation('debug_session', args.operation)
      switch (operation) {
        case 'list': {
          const scope: DebugScope | undefined = args.workspaceId !== undefined ? { workspaceId: args.workspaceId } : undefined
          return { sessions: ctx.debug.list(scope).map(sessionJson) }
        }
        case 'get': {
          if (args.sessionId === undefined) throw new DebugError('get requires sessionId', 'DEBUG_INVALID_CONFIG')
          const session = ctx.debug.get(parseSessionId(args.sessionId))
          if (session === undefined) throw new DebugError(`no debug session ${args.sessionId}`, 'DEBUG_SESSION_GONE')
          return sessionJson(session.info)
        }
        case 'terminate':
        case 'disconnect': {
          if (args.sessionId === undefined) throw new DebugError(`${operation} requires sessionId`, 'DEBUG_INVALID_CONFIG')
          const session = ctx.debug.get(parseSessionId(args.sessionId))
          if (session === undefined) throw new DebugError(`no debug session ${args.sessionId}`, 'DEBUG_SESSION_GONE')
          await (operation === 'terminate' ? session.terminate() : session.disconnect())
          return { sessionId: args.sessionId, state: 'terminated' }
        }
        case 'launch':
        case 'attach': {
          if (exec.agent === undefined) {
            throw new DebugError(`${operation} requires a calling agent session`, 'DEBUG_INVALID_CONFIG')
          }
          const session = exec.agent.session
          const { info, grant } = await dispatchSessionLaunch({
            debug: ctx.debug,
            approval,
            appendControl: (payload) => { session.append('debug/control', payload) },
            caller: { kind: 'agent', sessionId: session.id },
            agent: exec.agent,
            signal: exec.signal,
          }, operation, args)
          sessionOwners.set(info.id, 'agent')
          return { ...sessionJson(info), grantedBy: grant.source }
        }
        default:
          throw unavailableBackend(operation)
      }
    },
  })

  const debugExecutionTool = defineTool({
    name: 'debug_execution',
    description: 'Control a debug session. operation is one of continue, pause, step_over, step_in, step_out, step_back, restart, restart_frame, wait_for_stop. Most operations need the session id; continue and step wait for the next stop; threadId scopes control to one thread; restart_frame needs frameId.',
    parameters: {
      operation: { type: 'string', required: true, enum: [...DEBUG_EXECUTION_OPERATIONS], description: 'The execution operation to run.' },
      sessionId: { type: 'string', required: true, description: 'Debug session id, serialized debug-<hex> form.' },
      threadId: { type: 'string', description: 'Thread id for pause, continue, and stepping; the stopped thread when omitted.' },
      frameId: { type: 'string', description: 'Frame id for restart_frame.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const operation = parseDebugOperation('debug_execution', args.operation)
      const backend = resolveSessionBackend(ctx.debug, parseSessionId(args.sessionId), operation)
      if (!RESUME_OPERATIONS.has(operation) || exec.agent === undefined) {
        return dispatchExecutionOperation(backend, operation, args)
      }
      // The settlement of this resume delivers the stop it causes; mark it so
      // the stop notice suppresses instead of repeating that result.
      pendingResume.set(args.sessionId, exec.agent.session.id)
      try {
        return await dispatchExecutionOperation(backend, operation, args)
      } finally {
        pendingResume.delete(args.sessionId)
      }
    },
  })

  const debugInspectTool = defineTool({
    name: 'debug_inspect',
    description: 'Inspect a stopped debug session. operation is one of threads, stack_trace, scopes, variables, evaluate, set_variable, set_expression, completions, exception_info, modules, loaded_sources, source, disassemble, read_memory, write_memory, breakpoint_locations, console. Results are bounded; variables expand one level per call; write_memory needs user approval.',
    parameters: {
      operation: { type: 'string', required: true, enum: [...DEBUG_INSPECT_OPERATIONS], description: 'The inspection operation to run.' },
      sessionId: { type: 'string', required: true, description: 'Debug session id, serialized debug-<hex> form.' },
      threadId: { type: 'string', description: 'Thread id for stack traces and exception_info.' },
      frameId: { type: 'string', description: 'Frame id for scopes, evaluation, and set_expression.' },
      variablesReference: { type: 'string', description: 'Child container reference for variables and set_variable.' },
      expression: { type: 'string', description: 'Expression for evaluate and set_expression.' },
      name: { type: 'string', description: 'Variable name for set_variable.' },
      value: { type: 'string', description: 'Assignment source text for set_variable and set_expression.' },
      text: { type: 'string', description: 'Whole REPL line up to the cursor for completions.' },
      column: { type: 'number', description: 'Zero-based cursor column within text for completions; one-based start column for breakpoint_locations.' },
      memoryReference: { type: 'string', description: 'Memory anchor from variables, evaluate, or disassemble, for read_memory, write_memory, and disassemble.' },
      count: { type: 'number', description: 'Byte count for read_memory.' },
      offset: { type: 'number', description: 'Byte offset for read_memory and write_memory.' },
      data: { type: 'string', description: 'Base64-encoded bytes for write_memory.' },
      allowPartial: { type: 'boolean', description: 'Accept a prefix write for write_memory instead of failing the whole request.' },
      sourceReference: { type: 'string', description: 'Source reference from stack traces, loaded_sources, or console entries, for source.' },
      instructionCount: { type: 'number', description: 'Instruction count for disassemble.' },
      instructionOffset: { type: 'number', description: 'First-instruction offset from the reference for disassemble.' },
      file: { type: 'string', description: 'Workspace-relative or absolute source path for breakpoint_locations.' },
      line: { type: 'number', description: 'One-based start line for breakpoint_locations.' },
      endLine: { type: 'number', description: 'End line of the range for breakpoint_locations.' },
      endColumn: { type: 'number', description: 'One-based end column in UTF-16 code units for breakpoint_locations.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const operation = parseDebugOperation('debug_inspect', args.operation)
      if (operation === 'write_memory') {
        if (exec.agent === undefined) {
          throw new DebugError('write_memory requires a calling agent session', 'DEBUG_INVALID_CONFIG')
        }
        await authorizeWriteMemory(approval, { kind: 'agent' }, {
          agent: exec.agent,
          ...(args.memoryReference !== undefined ? { memoryReference: args.memoryReference } : {}),
          signal: exec.signal,
        })
      }
      const backend = resolveSessionBackend(ctx.debug, parseSessionId(args.sessionId), operation)
      return dispatchInspectOperation(backend, operation, args)
    },
  })

  const debugBreakpointsTool = defineTool({
    name: 'debug_breakpoints',
    description: 'Manage breakpoints. operation is one of set_file, set_function, set_exception, set_data, set_instruction, list, clear. Workspace-scoped operations replace the persisted set and apply to every matching live session; session-scoped operations need sessionId. set_file replaces the complete file set; an empty list clears.',
    parameters: {
      operation: { type: 'string', required: true, enum: [...DEBUG_BREAKPOINTS_OPERATIONS], description: 'The breakpoint operation to run.' },
      workspaceId: { type: 'string', required: true, description: 'Workspace owning the persisted breakpoint sets.' },
      sessionId: { type: 'string', description: 'Scope the operation to one live debug session.' },
      file: { type: 'string', description: 'Workspace-relative file path for file breakpoints.' },
      breakpoints: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            line: { type: 'number', required: true },
            condition: { type: 'string' },
            hitCondition: { type: 'string' },
            logMessage: { type: 'string' },
          },
        },
        description: 'Complete replacement set for set_file; omit with clear.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const operation = parseDebugOperation('debug_breakpoints', args.operation)
      if (args.sessionId !== undefined) parseSessionId(args.sessionId)
      switch (operation) {
        case 'set_file':
        case 'clear': {
          const file = args.file
          if (typeof file !== 'string') throw new DebugError(`${operation} requires file`, 'DEBUG_INVALID_CONFIG')
          if (args.sessionId !== undefined) throw unavailableBackend(`${operation} (session-scoped)`)
          const rawBreakpoints = operation === 'clear' ? [] : Array.isArray(args.breakpoints) ? args.breakpoints : []
          const breakpoints = rawBreakpoints.map(breakpoint => ({
            line: Number((breakpoint as Record<string, unknown>)['line']),
            ...((breakpoint as Record<string, unknown>)['condition'] !== undefined ? { condition: String((breakpoint as Record<string, unknown>)['condition']) } : {}),
            ...((breakpoint as Record<string, unknown>)['hitCondition'] !== undefined ? { hitCondition: String((breakpoint as Record<string, unknown>)['hitCondition']) } : {}),
            ...((breakpoint as Record<string, unknown>)['logMessage'] !== undefined ? { logMessage: String((breakpoint as Record<string, unknown>)['logMessage']) } : {}),
          }))
          const applications = await ctx.debug.breakpoints.setFile(args.workspaceId, file, breakpoints)
          return {
            file,
            applications: applications.map(application => ({
              sessionId: String(application.sessionId),
              applied: application.sessionResults.applied.map(breakpoint => ({ id: String(breakpoint.id), verified: breakpoint.verified })),
              rejected: application.sessionResults.rejected.map(breakpoint => ({
                id: String(breakpoint.id),
                ...(breakpoint.message !== undefined ? { message: breakpoint.message } : {}),
              })),
            })),
          }
        }
        default:
          throw unavailableBackend(operation)
      }
    },
  })

  for (const tool of [debugSessionTool, debugExecutionTool, debugInspectTool, debugBreakpointsTool]) {
    ctx.effect(() => ctx.tools.register(tool), `tool-debug.register(${tool.name})`)
  }
  ctx.effect(() => ctx.systemPrompt.section({
    name: DEBUG_PROMPT_SECTION,
    order: ctx.systemPrompt.getSectionOrder('TOOL_LSP') + 1,
    text: DEBUG_PROMPT_TEXT,
  }), 'tool-debug.prompt()')
}
