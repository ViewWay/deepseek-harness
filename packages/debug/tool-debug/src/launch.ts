/**
 * Launch/attach dispatch behind `debug_session`: argument validation, the
 * fail-closed approval gate for agent callers, control authorization for the
 * session the caller will own, delegation to the service's orchestrator seam,
 * and the durable `debug/control` audit append on the calling session's log.
 * @module @deepseek-ai/dsh-tool-debug/launch
 */

import type {
  DebugAttachRequest,
  DebugCaller,
  DebugControlEvent,
  DebugLaunchRequest,
  DebugSessionInfo,
} from '@deepseek-ai/dsh-debug'
import { DebugError } from '@deepseek-ai/dsh-debug'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { grantControl, requestDebugApproval } from './approval.ts'
import type { DebugApprovalFace, DebugControlGrant } from './approval.ts'
import { parseProviderId } from './tools.ts'

/** The approval outcome every ask resolves to without a composed approval service. */
const UNAVAILABLE_APPROVAL: DebugApprovalFace = {
  request: () => Promise.resolve('unavailable'),
}

/**
 * The approval face for one dispatch: the composed `ctx.approval` service, or
 * the fail-closed `unavailable` stand-in when the composition has none.
 * @param approval - the composed approval service, when present.
 * @returns the face every debug approval ask routes through.
 */
export function approvalFaceOf(approval: DebugApprovalFace | undefined): DebugApprovalFace {
  return approval ?? UNAVAILABLE_APPROVAL
}

/**
 * Render one tool-face environment value as the string a debuggee environment needs:
 * scalars as their literal text, composites as their JSON form (never `[object Object]`).
 * @param value - the environment value exactly as the tool arguments carried it.
 * @returns the string sent in the launch/attach request.
 */
function envValueText(value: JsonValue): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
}

/** `debug_session` launch/attach arguments, matching the tool's parameter schema. */
export interface DebugSessionLaunchArgs {
  readonly providerId?: string
  readonly workspaceId?: string
  readonly workspaceRoot?: string
  readonly cwd?: string
  readonly program?: string
  readonly module?: string
  readonly args?: readonly string[]
  /** Environment values as the tool face received them; stringified into the request. */
  readonly env?: Readonly<Record<string, JsonValue>>
  readonly stopOnEntry?: boolean
  readonly processId?: number
  readonly port?: number
  readonly url?: string
  readonly providerOptions?: Readonly<Record<string, unknown>>
}

/** The `ctx.debug` slice launch and attach delegate to. */
export interface DebugLaunchService {
  /** Launch through the installed orchestrator; `DEBUG_UNAVAILABLE` without one. */
  launch(request: DebugLaunchRequest): Promise<{ readonly info: DebugSessionInfo }>
  /** Attach through the installed orchestrator; `DEBUG_UNAVAILABLE` without one. */
  attach(request: DebugAttachRequest): Promise<{ readonly info: DebugSessionInfo }>
}

/** Dependencies one launch/attach dispatch consumes. */
export interface DebugLaunchDeps {
  readonly debug: DebugLaunchService
  readonly approval: DebugApprovalFace
  /** Appends the durable `debug/control` audit event to the calling session's log. */
  readonly appendControl: (payload: DebugControlEvent) => void
  /** Who is launching; agent callers pass the approval gate, user callers bypass it. */
  readonly caller: DebugCaller
  /** The live agent approval asks route through; agent callers only. */
  readonly agent?: unknown
  readonly signal?: AbortSignal
}

/** One completed launch or attach: the registered session and its control grant. */
export interface DebugLaunchOutcome {
  readonly info: DebugSessionInfo
  readonly grant: DebugControlGrant
}

/**
 * Fail loud for a launch/attach argument the operation cannot run without.
 * @param operation - the validated operation name.
 * @param field - the missing field's name.
 * @param value - the missing value.
 * @returns the present value.
 */
function requireLaunchArg<T>(operation: string, field: string, value: T | undefined): T {
  if (value === undefined) throw new DebugError(`${operation} requires ${field}`, 'DEBUG_INVALID_CONFIG')
  return value
}

/**
 * Run one validated `debug_session` launch or attach: validate the fields,
 * ask the approval seam for agent callers, authorize control of the session
 * the caller will own, delegate to the service's orchestrator seam, and
 * append the `debug/control` audit event once the session registers. The
 * audit payload is the durable `DebugControlEvent` contract — session, actor,
 * operation, thread/frame when applicable; the grant source rides the tool
 * result.
 * @param deps - service, approval, audit sink, caller, and cancellation.
 * @param operation - the validated operation name.
 * @param args - the tool call's launch/attach arguments.
 * @returns the registered session's info and the control grant.
 * @throws {@link DebugError} `DEBUG_INVALID_CONFIG` for missing fields;
 * `DEBUG_APPROVAL_DENIED` when the agent approval fails closed;
 * `DEBUG_CONTROL_NOT_GRANTED` when control authorization fails;
 * `DEBUG_UNAVAILABLE` when no orchestrator is installed.
 */
export async function dispatchSessionLaunch(
  deps: DebugLaunchDeps,
  operation: 'launch' | 'attach',
  args: DebugSessionLaunchArgs,
): Promise<DebugLaunchOutcome> {
  const providerId = parseProviderId(requireLaunchArg(operation, 'providerId', args.providerId))
  const workspaceRoot = requireLaunchArg(operation, 'workspaceRoot', args.workspaceRoot)
  const workspaceId = requireLaunchArg(operation, 'workspaceId', args.workspaceId)
  const caller = deps.caller
  const base = {
    providerId,
    workspaceRoot,
    workspaceId,
    ...(args.providerOptions !== undefined ? { providerOptions: args.providerOptions } : {}),
    caller,
  }
  /** The launch request, built where its required fields are checked. */
  const launchRequest = (): DebugLaunchRequest => ({
    ...base,
    cwd: requireLaunchArg('launch', 'cwd', args.cwd),
    ...(args.program !== undefined ? { program: args.program } : {}),
    ...(args.module !== undefined ? { module: args.module } : {}),
    ...(args.args !== undefined ? { args: args.args } : {}),
    ...(args.env !== undefined
      ? { env: Object.fromEntries(Object.entries(args.env).map(([name, value]) => [name, envValueText(value)])) }
      : {}),
    ...(args.stopOnEntry !== undefined ? { stopOnEntry: args.stopOnEntry } : {}),
  })
  /** The attach request, built where its target fields live. */
  const attachRequest = (): DebugAttachRequest => ({
    ...base,
    ...(args.processId !== undefined ? { processId: args.processId } : {}),
    ...(args.port !== undefined ? { port: args.port } : {}),
    ...(args.url !== undefined ? { url: args.url } : {}),
  })
  const reason = `${operation} ${providerId} under ${workspaceRoot}`
  // Validate every required field before the approval gate: an invalid
  // request never asks.
  if (operation === 'launch') requireLaunchArg('launch', 'cwd', args.cwd)
  if (caller.kind === 'agent') {
    await requestDebugApproval(deps.approval, {
      kind: operation,
      toolName: 'debug_session',
      reason,
      agent: deps.agent,
      ...(deps.signal !== undefined ? { signal: deps.signal } : {}),
    })
  }
  const grant = await grantControl(deps.approval, {
    owner: caller.kind,
    caller: caller.kind,
    toolName: 'debug_session',
    reason,
    ...(caller.kind === 'agent' && deps.agent !== undefined ? { agent: deps.agent } : {}),
    ...(deps.signal !== undefined ? { signal: deps.signal } : {}),
  })
  const session = operation === 'launch'
    ? await deps.debug.launch(launchRequest())
    : await deps.debug.attach(attachRequest())
  deps.appendControl({ sessionId: session.info.id, actor: caller.kind, operation })
  return { info: session.info, grant }
}

/**
 * Gate one `debug_inspect` memory write through the approval seam. Agent
 * callers need a grant for every write; user callers confirm in their own
 * surface and bypass this seam.
 * @param approval - the approval service face.
 * @param caller - who is writing.
 * @param options - the agent approval asks route through and the write's
 * memory anchor, for the audited reason.
 * @throws {@link DebugError} `DEBUG_APPROVAL_DENIED` on every non-grant outcome.
 */
export async function authorizeWriteMemory(
  approval: DebugApprovalFace,
  caller: { readonly kind: 'agent' | 'user' },
  options: { readonly agent?: unknown; readonly memoryReference?: string; readonly signal?: AbortSignal },
): Promise<void> {
  if (caller.kind !== 'agent') return
  await requestDebugApproval(approval, {
    kind: 'write_memory',
    toolName: 'debug_inspect',
    reason: `write memory at ${options.memoryReference ?? 'the requested reference'}`,
    agent: options.agent,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  })
}
