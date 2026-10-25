/**
 * The Python debug provider (`debug-python`): registers on `ctx.debug` and
 * resolves launch and attach into the frozen plan shapes. The managed debugpy
 * manifest is deferred until the venv-based install model lands; the resolve
 * layer works against any adapter the environment resolves.
 * @module @deepseek-ai/dsh-debug-python
 */

import type { Context } from '@deepseek-ai/cordis'
import { DebugProviderId } from '@deepseek-ai/dsh-debug'
import type {
  DebugAttachPlan,
  DebugAttachRequest,
  DebugEnvironment,
  DebugLaunchPlan,
  DebugLaunchRequest,
  DebugProvider,
  JsonValue,
} from '@deepseek-ai/dsh-debug'
import { PYTHON_OPTIONS_SCHEMA, resolvePythonAttachConfig, resolvePythonLaunchConfig } from './config.ts'
import type { PythonAttachConfig, PythonLaunchConfig } from './config.ts'

/** Absolutize a workspace-relative script path in the target world. */
function absolute(entry: string, workspaceRoot: string, separator: string): string {
  if (entry.startsWith('/') || entry.startsWith(separator) || /^[A-Za-z]:/.test(entry)) return entry
  return `${workspaceRoot}${separator}${entry}`
}

/** Build the DAP launch request from the validated config. */
function launchRequest(config: PythonLaunchConfig, entryPath: string): Readonly<Record<string, JsonValue>> {
  return {
    type: 'debugpy',
    request: 'launch',
    ...(config.entryKind === 'program' ? { program: entryPath } : { module: config.entry }),
    python: config.python,
    args: config.args,
    cwd: config.cwd,
    env: config.env,
    ...(config.stopOnEntry !== undefined ? { stopOnEntry: config.stopOnEntry } : {}),
    ...(config.justMyCode !== undefined ? { justMyCode: config.justMyCode } : {}),
    ...(config.subProcess !== undefined ? { subProcess: config.subProcess } : {}),
    ...(config.django !== undefined ? { django: config.django } : {}),
    ...(config.flask !== undefined ? { flask: config.flask } : {}),
  }
}

/** Build the DAP attach request from the validated target. */
function attachRequest(config: PythonAttachConfig): Readonly<Record<string, JsonValue>> {
  return {
    type: 'debugpy',
    request: 'attach',
    ...(config.processId !== undefined ? { processId: config.processId } : {}),
    ...(config.port !== undefined ? { listen: { host: '127.0.0.1', port: config.port } } : {}),
  }
}

/** The Python provider object; register it on `ctx.debug`. */
export const pythonDebugProvider: DebugProvider = {
  id: DebugProviderId('python'),
  displayName: 'Python',
  extensions: ['.py', '.pyw'],
  adapter: { kind: 'managed' },
  configSchema: PYTHON_OPTIONS_SCHEMA,
  async resolveLaunch(request: DebugLaunchRequest, environment: DebugEnvironment): Promise<DebugLaunchPlan> {
    const config = resolvePythonLaunchConfig(request)
    const resolved = await environment.adapters.resolve(request.providerId)
    const entryPath = config.entryKind === 'program'
      ? absolute(config.entry, request.workspaceRoot, environment.pathSeparator)
      : config.entry
    return {
      adapter: {
        command: resolved.command,
        args: resolved.args,
        env: resolved.env,
        cwd: environment.cwd,
      },
      dapRequest: launchRequest(config, entryPath),
      target: {
        executable: config.python,
        args: [...(config.entryKind === 'module' ? ['-m', config.entry] : [entryPath]), ...config.args],
        env: config.env,
        cwd: config.cwd,
      },
      requires: ['python'],
      manifestVersion: resolved.version,
      failureHint: 'check the python interpreter path and that the debugpy adapter is installed for it',
    }
  },
  async resolveAttach(request: DebugAttachRequest, environment: DebugEnvironment): Promise<DebugAttachPlan> {
    const config = resolvePythonAttachConfig(request)
    const resolved = await environment.adapters.resolve(request.providerId)
    return {
      adapter: {
        command: resolved.command,
        args: resolved.args,
        env: resolved.env,
        cwd: environment.cwd,
      },
      dapRequest: attachRequest(config),
      requires: ['python'],
      manifestVersion: resolved.version,
      failureHint: 'check the process id or that the target listens with debugpy (--listen)',
    }
  },
}

export const name = 'debug-python'

export const inject = ['debug']

/**
 * Register the python provider on `ctx.debug`.
 * @param ctx - the plugin's context.
 */
export function apply(ctx: Context): void {
  ctx.effect(function* (this: Context) {
    const disposeProvider = this.debug.registerProvider(pythonDebugProvider)
    yield () => {
      disposeProvider()
    }
  }.bind(ctx), 'debug-python.apply()')
}
