/**
 * The debug bundle's composition plugin for the Remote debug controller:
 * re-exports `DebugController` as the package default so the loader can mount
 * the controller row (`@deepseek-ai/dsh-debug-bundle/debug-controller`),
 * because the controller package exports only named classes.
 * @module @deepseek-ai/dsh-debug-bundle/debug-controller
 */

import { DebugController } from '@deepseek-ai/dsh-api-debug-controller'

export default DebugController
