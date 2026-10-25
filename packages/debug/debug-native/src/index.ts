/**
 * The native (Rust/C/C++) debug provider (`debug-native`): registers on
 * `ctx.debug`, resolves launch and attach into the frozen plan shapes for
 * lldb-dap, and contributes the verified LLVM 23.1.4 archive manifest with
 * GitHub-published SHA-256 digests. macOS Intel has no LLVM release binary;
 * system installs (Xcode and distro packages) ride user overrides.
 * @module @deepseek-ai/dsh-debug-native
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
  JsonSchema,
} from '@deepseek-ai/dsh-debug'
import { DebugError } from '@deepseek-ai/dsh-debug'
import type { DebugAdapterManager } from '@deepseek-ai/dsh-debug-adapter-manager'

/** Per-platform LLVM archive entries (verified upstream facts, 23.1.4). */
const LLVM_PLATFORMS = {
  'darwin-arm64': { archive: 'LLVM-23.1.4-macOS-ARM64.tar.xz', sha256: '5d3179db39adeca5b17a34d82708fe976bc60e055b05fe557878fb3fb64d39ef', executable: 'bin/lldb-dap', sizeBytes: 1570051292 },
  'linux-x64': { archive: 'LLVM-23.1.4-Linux-X64.tar.xz', sha256: '25d814fda50d5fb0084b42be09605d8b1595d49d5e2e03a3345d7e112ff6f9f3', executable: 'bin/lldb-dap', sizeBytes: 2017061664 },
  'linux-arm64': { archive: 'LLVM-23.1.4-Linux-ARM64.tar.xz', sha256: '9b27cf263d711aa6ebfd4045ab241d947bd09b3cd19ffa5728f48a80c9eb3a91', executable: 'bin/lldb-dap', sizeBytes: 1829686400 },
  'win32-x64': { archive: 'clang+llvm-23.1.4-x86_64-pc-windows-msvc.tar.xz', sha256: '854bffcfc84528e0ee92490ff5c178920abd358a79c3e98f053e41e3e8e4c6d2', executable: 'bin/lldb-dap.exe', sizeBytes: 901281460 },
} as const

/** Raw manifest data for the managed lldb-dap adapter. */
export const NATIVE_ADAPTER_MANIFEST = {
  providerId: 'native',
  version: '23.1.4',
  license: 'Apache-2.0 WITH LLVM-exception',
  source: { kind: 'archive', url: 'https://github.com/llvm/llvm-project/releases/download/llvmorg-23.1.4' },
  platforms: LLVM_PLATFORMS,
  command: ['lldb-dap'],
  requires: ['ptrace'],
}

/** The provider's configSchema: no provider options are modeled. */
export const NATIVE_OPTIONS_SCHEMA: JsonSchema = { type: 'object', properties: {}, additionalProperties: false }

/** Absolutize a workspace-relative program path in the target world. */
function absolute(entry: string, workspaceRoot: string, separator: string): string {
  if (entry.startsWith('/') || entry.startsWith(separator) || /^[A-Za-z]:/.test(entry)) return entry
  return `${workspaceRoot}${separator}${entry}`
}

/** Fail one config validation with the seam's config code. */
function invalid(detail: string): DebugError {
  return new DebugError(`native debug config: ${detail}`, 'DEBUG_INVALID_CONFIG', { detail })
}

/** The native (Rust/C/C++) provider object; register it on `ctx.debug`. */
export const nativeDebugProvider: DebugProvider = {
  id: DebugProviderId('native'),
  displayName: 'Rust / C / C++',
  extensions: ['.rs', '.c', '.cc', '.cpp', '.h', '.hpp'],
  adapter: { kind: 'managed' },
  configSchema: NATIVE_OPTIONS_SCHEMA,
  async resolveLaunch(request: DebugLaunchRequest, environment: DebugEnvironment): Promise<DebugLaunchPlan> {
    if (request.program === undefined) {
      throw invalid('launch requires a program binary path')
    }
    if (request.providerOptions !== undefined && Object.keys(request.providerOptions).length > 0) {
      throw invalid('the native provider models no launch options')
    }
    const resolved = await environment.adapters.resolve(request.providerId)
    const program = absolute(request.program, request.workspaceRoot, environment.pathSeparator)
    return {
      adapter: {
        command: resolved.command,
        args: resolved.args,
        env: resolved.env,
        cwd: environment.cwd,
      },
      dapRequest: {
        request: 'launch',
        program,
        args: request.args ?? [],
        cwd: request.cwd,
        env: request.env ?? {},
        ...(request.stopOnEntry !== undefined ? { stopOnEntry: request.stopOnEntry } : {}),
      },
      target: {
        executable: program,
        args: request.args ?? [],
        env: request.env ?? {},
        cwd: request.cwd,
      },
      requires: ['ptrace'],
      manifestVersion: resolved.version,
      failureHint: 'check the binary path and that the lldb-dap adapter is installed (ctx.debugAdapters); system LLDB installs ride user overrides',
    }
  },
  async resolveAttach(request: DebugAttachRequest, environment: DebugEnvironment): Promise<DebugAttachPlan> {
    const forms = [request.processId, request.port].filter(value => value !== undefined)
    if (forms.length !== 1) {
      throw invalid('attach requires exactly one of processId or port')
    }
    const resolved = await environment.adapters.resolve(request.providerId)
    return {
      adapter: {
        command: resolved.command,
        args: resolved.args,
        env: resolved.env,
        cwd: environment.cwd,
      },
      dapRequest: {
        request: 'attach',
        ...(request.processId !== undefined ? { pid: request.processId } : {}),
        ...(request.port !== undefined ? { attachCommands: [`process connect connect://127.0.0.1:${request.port}`] } : {}),
      },
      requires: ['ptrace'],
      manifestVersion: resolved.version,
      failureHint: 'check the process id or gdbserver/lldb-server port; ptrace permissions govern attach on Linux',
    }
  },
}

export const name = 'debug-native'

export const inject = ['debug']

/**
 * Register the native provider and, when the adapter manager is composed, its
 * verified manifest. Both registrations release together with the plugin.
 * @param ctx - the plugin's context.
 */
export function apply(ctx: Context): void {
  ctx.effect(function* (this: Context) {
    const disposeProvider = this.debug.registerProvider(nativeDebugProvider)
    const manager: DebugAdapterManager | undefined = this.get('debugAdapters')
    const disposeManifest = manager?.registerManifest(NATIVE_ADAPTER_MANIFEST)
    yield () => {
      disposeManifest?.()
      disposeProvider()
    }
  }.bind(ctx), 'debug-native.apply()')
}
