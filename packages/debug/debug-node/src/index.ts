/**
 * The Node.js/TypeScript debug provider (`debug-node`): registers on
 * `ctx.debug`, resolves launch and attach into the frozen plan shapes, and
 * contributes the js-debug adapter manifest with the GitHub-published
 * SHA-256 digest. All facts below were verified against the v1.140.0 release
 * on 2026-10-25; the archive's interior layout is documented as pending real
 * e2e verification.
 * @module @deepseek-ai/dsh-debug-node
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
import { NODE_OPTIONS_SCHEMA, resolveNodeAttachConfig, resolveNodeLaunchConfig } from './config.ts'
import type { NodeAttachConfig, NodeLaunchConfig } from './config.ts'
import type { DebugAdapterManager } from '@deepseek-ai/dsh-debug-adapter-manager'

/** The js-debug DAP-server archive, identical on every platform. */
const JS_DEBUG_PLATFORM_ENTRY = {
  archive: 'js-debug-dap-v1.140.0.tar.gz',
  sha256: '27dab92937ec1ab35821ae955aac867544fe06a1b6307229049f2d789af10968',
  executable: 'js-debug/src/dapDebugServer.js',
  sizeBytes: 1249709,
}

/** Raw manifest data for the managed js-debug adapter (verified upstream facts). */
export const NODE_ADAPTER_MANIFEST = {
  providerId: 'node',
  version: '1.140.0',
  license: 'MIT',
  source: { kind: 'archive', url: 'https://github.com/microsoft/vscode-js-debug/releases/download/v1.140.0/js-debug-dap-v1.140.0.tar.gz' },
  platforms: {
    'darwin-arm64': JS_DEBUG_PLATFORM_ENTRY,
    'darwin-x64': JS_DEBUG_PLATFORM_ENTRY,
    'linux-x64': JS_DEBUG_PLATFORM_ENTRY,
    'linux-arm64': JS_DEBUG_PLATFORM_ENTRY,
    'win32-x64': JS_DEBUG_PLATFORM_ENTRY,
  },
  command: ['node', 'js-debug/src/dapDebugServer.js'],
}

/** Join a workspace-relative entry into an absolute path in the target world. */
function absolute(entry: string, workspaceRoot: string, separator: string): string {
  if (entry.startsWith('/') || entry.startsWith(separator) || /^[A-Za-z]:/.test(entry)) return entry
  return `${workspaceRoot}${separator}${entry}`
}

/** Build the DAP launch request from the validated config. */
function launchRequest(config: NodeLaunchConfig, entryPath: string): Readonly<Record<string, JsonValue>> {
  return {
    type: 'node',
    request: 'launch',
    ...(config.entryKind === 'program' ? { program: entryPath } : { module: entryPath }),
    args: config.args,
    cwd: config.cwd,
    env: config.env,
    ...(config.stopOnEntry !== undefined ? { stopOnEntry: config.stopOnEntry } : {}),
    ...(config.runtimeExecutable !== undefined ? { runtimeExecutable: config.runtimeExecutable } : {}),
    ...(config.runtimeArgs !== undefined ? { runtimeArgs: config.runtimeArgs } : {}),
    ...(config.autoAttachChildProcesses !== undefined ? { autoAttachChildProcesses: config.autoAttachChildProcesses } : {}),
    ...(config.sourceMaps !== undefined ? { sourceMaps: config.sourceMaps } : {}),
    ...(config.outFiles !== undefined ? { outFiles: config.outFiles } : {}),
    ...(config.console !== undefined ? { console: config.console } : {}),
  }
}

/** Build the DAP attach request from the validated target. */
function attachRequest(config: NodeAttachConfig): Readonly<Record<string, JsonValue>> {
  return {
    type: 'node',
    request: 'attach',
    ...(config.processId !== undefined ? { processId: config.processId } : {}),
    ...(config.port !== undefined ? { port: config.port } : {}),
    ...(config.url !== undefined ? { url: config.url } : {}),
  }
}

/** The Node.js/TypeScript provider object; register it on `ctx.debug`. */
export const nodeDebugProvider: DebugProvider = {
  id: DebugProviderId('node'),
  displayName: 'Node.js / TypeScript',
  extensions: ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx'],
  adapter: { kind: 'managed' },
  configSchema: NODE_OPTIONS_SCHEMA,
  async resolveLaunch(request: DebugLaunchRequest, environment: DebugEnvironment): Promise<DebugLaunchPlan> {
    const config = resolveNodeLaunchConfig(request)
    const resolved = await environment.adapters.resolve(request.providerId)
    const entryPath = absolute(config.entry, request.workspaceRoot, environment.pathSeparator)
    return {
      adapter: {
        command: resolved.command,
        args: resolved.args,
        env: resolved.env,
        cwd: environment.cwd,
      },
      dapRequest: launchRequest(config, entryPath),
      target: {
        executable: config.runtimeExecutable ?? 'node',
        args: [entryPath, ...config.args],
        env: config.env,
        cwd: config.cwd,
      },
      requires: ['processControl'],
      manifestVersion: resolved.version,
      failureHint: 'check that the managed js-debug adapter is installed (ctx.debugAdapters) and the program path is correct',
    }
  },
  async resolveAttach(request: DebugAttachRequest, environment: DebugEnvironment): Promise<DebugAttachPlan> {
    const config = resolveNodeAttachConfig(request)
    const resolved = await environment.adapters.resolve(request.providerId)
    return {
      adapter: {
        command: resolved.command,
        args: resolved.args,
        env: resolved.env,
        cwd: environment.cwd,
      },
      dapRequest: attachRequest(config),
      requires: config.processId !== undefined ? ['processControl'] : [],
      manifestVersion: resolved.version,
      failureHint: 'check the process id or inspector port, and that the target was started with inspector enabled',
    }
  },
}

export const name = 'debug-node'

export const inject = ['debug']

/**
 * Register the node provider and, when the adapter manager is composed, its
 * verified manifest. Both registrations release together with the plugin.
 * @param ctx - the plugin's context.
 */
export function apply(ctx: Context): void {
  ctx.effect(function* (this: Context) {
    const disposeProvider = this.debug.registerProvider(nodeDebugProvider)
    const manager: DebugAdapterManager | undefined = this.get('debugAdapters')
    const disposeManifest = manager?.registerManifest(NODE_ADAPTER_MANIFEST)
    yield () => {
      disposeManifest?.()
      disposeProvider()
    }
  }.bind(ctx), 'debug-node.apply()')
}
