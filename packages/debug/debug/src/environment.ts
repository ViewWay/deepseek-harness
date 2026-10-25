/**
 * Execution-environment probing for the debug seam: every fact comes from the
 * target world's own services — never host `child_process` or `fs` — and
 * required capabilities fail typed before any adapter starts.
 * @module @deepseek-ai/dsh-debug/environment
 */

import type { DebugEnvironment, DebugExecutionCapability } from './types.ts'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { DebugError } from './error.ts'

/** Facts a caller supplies that the world's services cannot report alone. */
export interface DebugEnvironmentProbe {
  /** The target world's subprocess service; probing runs through it only. */
  readonly subprocess: SubprocessRuntime
  /** The target world's filesystem service; the frozen environment requires one. */
  readonly fs: FileSystem
  readonly workspaceRoot: string
  /** Working directory inside the world; defaults to the workspace root. */
  readonly cwd?: string
  /** OS-arch key of the world, e.g. `linux-x64`. */
  readonly platformKey: string
  /** Adapter resolution of the world. */
  readonly adapters: DebugEnvironment['adapters']
  /** Capabilities the planned adapters need before they may run. */
  readonly requiredCapabilities?: readonly DebugExecutionCapability[]
  /** Whether the world's sandbox permits spawning and controlling processes. */
  readonly sandboxAllowsProcessControl?: boolean
}

/** Platform keys the seam understands, with their facts. */
const PLATFORM_FACTS: Readonly<Record<string, { readonly platform: NodeJS.Platform; readonly arch: string; readonly separator: '/' | '\\' }>> = {
  'darwin-x64': { platform: 'darwin', arch: 'x64', separator: '/' },
  'darwin-arm64': { platform: 'darwin', arch: 'arm64', separator: '/' },
  'linux-x64': { platform: 'linux', arch: 'x64', separator: '/' },
  'linux-arm64': { platform: 'linux', arch: 'arm64', separator: '/' },
  'win32-x64': { platform: 'win32', arch: 'x64', separator: '\\' },
}

/** Capabilities that need OS-level process tracing; unsupported on Windows worlds. */
const TRACE_CAPABILITIES: ReadonlySet<DebugExecutionCapability> = new Set(['ptrace'])

/** Interpreter commands the interpreter capabilities resolve through. */
const INTERPRETER_COMMANDS: Readonly<Partial<Record<DebugExecutionCapability, string>>> = {
  python: 'python3',
  go: 'go',
}

/**
 * Probe one execution world and validate the capabilities the caller needs.
 * @param probe - the world's services, facts, and required capabilities.
 * @returns the assembled `DebugEnvironment` for provider resolution.
 * @throws {@link DebugError} `DEBUG_ADAPTER_UNSUPPORTED` for an unknown
 * platform key, a world that cannot host a required capability, or a missing
 * interpreter; `DEBUG_SANDBOX_DENIED` when the world's sandbox forbids a
 * required process capability.
 */
export async function probeDebugEnvironment(probe: DebugEnvironmentProbe): Promise<DebugEnvironment> {
  const facts = PLATFORM_FACTS[probe.platformKey]
  if (facts === undefined) {
    throw new DebugError(
      `the debug seam publishes no ${probe.platformKey} environment facts`,
      'DEBUG_ADAPTER_UNSUPPORTED',
      { detail: `known keys: ${Object.keys(PLATFORM_FACTS).join(', ')}` },
    )
  }

  const terminal = await probe.subprocess.terminalEnvironment()
  const shell = terminal.defaultShell
  const required = probe.requiredCapabilities ?? []

  if (probe.sandboxAllowsProcessControl === false
    && (required.includes('processControl') || required.includes('ptrace'))) {
    throw new DebugError(
      'the target world\'s sandbox denies the process control this adapter needs',
      'DEBUG_SANDBOX_DENIED',
    )
  }

  for (const capability of required) {
    if (TRACE_CAPABILITIES.has(capability) && facts.platform === 'win32') {
      throw new DebugError(
        `capability "${capability}" needs an OS-level tracer this ${facts.platform} world does not host`,
        'DEBUG_ADAPTER_UNSUPPORTED',
      )
    }
    const command = INTERPRETER_COMMANDS[capability]
    if (command !== undefined) {
      try {
        await probe.subprocess.resolveExecutable(command)
      } catch (error: unknown) {
        throw new DebugError(
          `capability "${capability}" needs the "${command}" interpreter, which the world cannot resolve`,
          'DEBUG_ADAPTER_UNSUPPORTED',
          { detail: error instanceof Error ? error.message : String(error) },
        )
      }
    }
  }

  const environment: DebugEnvironment = {
    workspaceRoot: probe.workspaceRoot,
    cwd: probe.cwd ?? probe.workspaceRoot,
    platform: facts.platform,
    arch: facts.arch,
    pathSeparator: facts.separator,
    ...(shell !== undefined ? { shell } : {}),
    subprocess: probe.subprocess,
    fs: probe.fs,
    adapters: probe.adapters,
    requiredCapabilities: required,
  }
  return environment
}
