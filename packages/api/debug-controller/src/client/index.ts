/**
 * Browser half of the debug controller: the Remote face binding.
 *
 * The generated `remote.debug` namespace (from `./remote`) carries every
 * unary method and the `events` replay. The debug workbench UI (Track E)
 * owns provider and panel registrations over that face; this entry only
 * anchors the client bundle so the generated client is linkable.
 * @module @deepseek-ai/dsh-api-debug-controller/client
 */

/** Client plugin body: nothing to register yet; the workbench owns the face. */
export function apply(): void {}
