/**
 * `@deepseek-ai/dsh-debug-adapter-manager`: the `ctx.debugAdapters` service
 * and the managed-install vocabulary — validated manifests with per-platform
 * SHA-256 records, checksum-verified atomic install with self-test rollback,
 * and override-free resolution for the target execution world.
 * @module @deepseek-ai/dsh-debug-adapter-manager
 */

export { parseAdapterManifest, resolveAdapterPlatform } from './manifest.ts'
export type {
  DebugAdapterManifest,
  DebugAdapterPlatformEntry,
  DebugAdapterPlatformKey,
  DebugAdapterSource,
} from './manifest.ts'
export { DEFAULT_PYPI_INDEX, adapterInstallPath, installAdapter, installPypiAdapter, pypiInstallLayout } from './install.ts'
export type {
  DebugAdapterInstallEnvironment,
  DebugAdapterInstallPath,
  DebugAdapterInstallRequest,
  DebugPypiInstallEnvironment,
  DebugPypiInstallLayout,
  DebugPypiInstallRequest,
} from './install.ts'
import { DebugAdapterManager } from './manager.ts'
export { DebugAdapterManager }
export default DebugAdapterManager
export type {
  DebugAdapterEvent,
  DebugAdapterEventSource,
  DebugAdapterInstallCall,
  DebugAdapterResolveCall,
  DebugAdapterStatus,
} from './manager.ts'
