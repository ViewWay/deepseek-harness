/**
 * The Go debug provider (`debug-go`): registers on `ctx.debug`, resolves
 * launch and attach into the frozen plan shapes for delve, and contributes
 * the verified delve v1.27.2 manifest with GitHub-published SHA-256 digests.
 * @module @deepseek-ai/dsh-debug-go
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
import type { DebugAdapterManager } from '@deepseek-ai/dsh-debug-adapter-manager'
import { GO_OPTIONS_SCHEMA, resolveGoAttachConfig, resolveGoLaunchConfig } from './config.ts'
import type { GoAttachConfig, GoLaunchConfig } from './config.ts'

/** Per-platform delve archive entries (verified upstream facts, v1.27.2). */
const DELVE_PLATFORMS = {
  'darwin-x64': { archive: 'dlv_1.27.2_darwin_amd64.tar.gz', sha256: '66992990307bd0328994960df0cbfa34ecfb16e9cd32f5cf6c83c34912e59cc3', executable: 'dlv', sizeBytes: 12662970 },
  'darwin-arm64': { archive: 'dlv_1.27.2_darwin_arm64.tar.gz', sha256: 'c32fc68e11ff3820ba267ab12c96fa68e3804319f807fc5db4fba3b9d868df26', executable: 'dlv', sizeBytes: 11278797 },
  'linux-x64': { archive: 'dlv_1.27.2_linux_amd64.tar.gz', sha256: '30783eb68dc1598d965491cc97762270cd63ce13f09d0cac22faa7e3eafc1b9c', executable: 'dlv', sizeBytes: 12970664 },
  'linux-arm64': { archive: 'dlv_1.27.2_linux_arm64.tar.gz', sha256: 'b2969e00711f905d189784654e485ea5bc6c2eaa8c5d3effcb646487f4e0bb2f', executable: 'dlv', sizeBytes: 10942815 },
  'win32-x64': { archive: 'dlv_1.27.2_windows_amd64.zip', sha256: '630b5b9b14c89becb1123790563111c70f7e0cf90820a666582ad1caba05dbd6', executable: 'dlv.exe', sizeBytes: 12410128 },
} as const

/** Raw manifest data for the managed delve adapter. */
export const GO_ADAPTER_MANIFEST = {
  providerId: 'go',
  version: '1.27.2',
  license: 'MIT',
  source: { kind: 'archive', url: 'https://github.com/go-delve/delve/releases/download/v1.27.2' },
  platforms: DELVE_PLATFORMS,
  command: ['dlv', 'dap'],
  requires: ['go'],
}

/** Absolutize a workspace-relative program path in the target world. */
function absolute(entry: string, workspaceRoot: string, separator: string): string {
  if (entry.startsWith('/') || entry.startsWith(separator) || /^[A-Za-z]:/.test(entry)) return entry
  return `${workspaceRoot}${separator}${entry}`
}

/** Build the DAP launch request from the validated config. */
function launchRequest(config: GoLaunchConfig, programPath: string): Readonly<Record<string, JsonValue>> {
  return {
    type: 'go',
    request: 'launch',
    mode: config.mode,
    ...(config.entryKind === 'program' ? { program: programPath } : { package: config.entry }),
    args: config.args,
    cwd: config.cwd,
    env: config.env,
    ...(config.buildFlags !== undefined ? { buildFlags: config.buildFlags } : {}),
    ...(config.dlvFlags !== undefined ? { dlvFlags: config.dlvFlags } : {}),
    ...(config.stopOnEntry !== undefined ? { stopOnEntry: config.stopOnEntry } : {}),
  }
}

/** Build the DAP attach request from the validated target. */
function attachRequest(config: GoAttachConfig): Readonly<Record<string, JsonValue>> {
  return {
    type: 'go',
    request: 'attach',
    mode: 'local',
    ...(config.processId !== undefined ? { processId: config.processId } : {}),
    ...(config.port !== undefined ? { port: config.port } : {}),
  }
}

/** The Go provider object; register it on `ctx.debug`. */
export const goDebugProvider: DebugProvider = {
  id: DebugProviderId('go'),
  displayName: 'Go',
  extensions: ['.go'],
  adapter: { kind: 'managed' },
  configSchema: GO_OPTIONS_SCHEMA,
  async resolveLaunch(request: DebugLaunchRequest, environment: DebugEnvironment): Promise<DebugLaunchPlan> {
    const config = resolveGoLaunchConfig(request)
    const resolved = await environment.adapters.resolve(request.providerId)
    const programPath = config.entryKind === 'program'
      ? absolute(config.entry, request.workspaceRoot, environment.pathSeparator)
      : config.entry
    return {
      adapter: {
        command: resolved.command,
        args: resolved.args,
        env: resolved.env,
        cwd: environment.cwd,
      },
      dapRequest: launchRequest(config, programPath),
      target: {
        executable: resolved.command[0] ?? 'dlv',
        args: resolved.command.slice(1),
        env: config.env,
        cwd: config.cwd,
      },
      requires: ['go'],
      manifestVersion: resolved.version,
      failureHint: 'check that Go is installed, the delve adapter is installed (ctx.debugAdapters), and the program or package path is correct',
    }
  },
  async resolveAttach(request: DebugAttachRequest, environment: DebugEnvironment): Promise<DebugAttachPlan> {
    const config = resolveGoAttachConfig(request)
    const resolved = await environment.adapters.resolve(request.providerId)
    return {
      adapter: {
        command: resolved.command,
        args: resolved.args,
        env: resolved.env,
        cwd: environment.cwd,
      },
      dapRequest: attachRequest(config),
      requires: ['go'],
      manifestVersion: resolved.version,
      failureHint: 'check the process id or that the target was started with --headless --listen',
    }
  },
}

export const name = 'debug-go'

export const inject = ['debug']

/**
 * Register the go provider and, when the adapter manager is composed, its
 * verified manifest. Both registrations release together with the plugin.
 * @param ctx - the plugin's context.
 */
export function apply(ctx: Context): void {
  ctx.effect(function* (this: Context) {
    const disposeProvider = this.debug.registerProvider(goDebugProvider)
    const manager: DebugAdapterManager | undefined = this.get('debugAdapters')
    const disposeManifest = manager?.registerManifest(GO_ADAPTER_MANIFEST)
    yield () => {
      disposeManifest?.()
      disposeProvider()
    }
  }.bind(ctx), 'debug-go.apply()')
}
