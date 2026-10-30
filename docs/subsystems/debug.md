# IDE Debug Sessions

English | [中文](debug.zh.md)

One `ctx.debug` capability seam serves agent tools, the Web/Desktop workbench, the CLI TUI, and headless NDJSON. The [debug group map](../../packages/debug/README.md) owns the package roster; this page records the seam contract that outlives any one package: the session state machine, provider and adapter roles, execution worlds, ownership, durable events, bounds, and the current limits.

## Capability seam

The `debug` package defines the [Service Definition](../../packages/debug/debug/README.md): a `ctx.debug` service keyed `debug` that owns the language-provider registry, the session registry, the breakpoint registry, and the compound registry. Provider registration reserves a branded provider id and an exclusive set of file extensions atomically, so two providers can never claim `.py`; the reservation and its release share one lifecycle controller. Every failure is a typed [`DebugError`](../../packages/debug/debug/src/error.ts) with a stable `DebugErrorCode` from the closed union in [`types.ts`](../../packages/debug/debug/src/types.ts); callers route on `code` and never parse `message`.

Launch and attach are available through the composition-level `DebugLaunchOrchestrator` seam: a host plugin installs the orchestration (environment, adapter resolution, backend factory) and `ctx.debug.launch`/`attach` delegate to it. The tool face in [`dsh-tool-debug`](../../packages/debug/tool-debug/README.md) validates the fields, passes agent launch/attach and memory writes through `ctx.approval` fail-closed, authorizes control of the session the caller will own, and appends the durable `debug/control` audit on the calling session's log; UI-originated launches confirm in the UI and never enter the agent approval seam. A composition without an installed orchestrator fails closed `DEBUG_UNAVAILABLE` — the honest answer for compositions without a backend, not a defect. The pure orchestration in [`launch.ts`](../../packages/debug/debug/src/launch.ts) (`launchDebugSession`/`attachDebugSession`) and the DAP backend are landed and exercised by the real-adapter e2e matrix.

## Session state machine

A session is one of `starting`, `running`, `stopped`, `terminated`, or `failed`. State changes publish from a fixed set of seven state events — `launch-succeeded`, `stopped`, `continued`, `restart`, `terminated`, `disconnected`, `failed` — each carrying the source and target state, and every transition outside the table rejects typed with `DEBUG_INVALID_STATE`. `terminated` (the target ended) and `disconnected` (the operator detached) are distinct terminal sources, and the durable `debug/session-ended` outcome records which one happened.

## Providers and adapters

One provider per language — [`debug-node`](../../packages/debug/debug-node/README.md), [`debug-python`](../../packages/debug/debug-python/README.md), [`debug-go`](../../packages/debug/debug-go/README.md), and [`debug-native`](../../packages/debug/debug-native/README.md) — resolves launch and attach requests into frozen plan shapes (adapter command, DAP request, tunnel endpoint, required capabilities) and contributes its adapter manifest to the [adapter manager](../../packages/debug/debug-adapter-manager/README.md). The manager validates manifests with per-platform SHA-256 records, resolves the adapter in the target execution world without host fallback, installs on first use with checksum verification and self-test rollback, and accepts per-provider command overrides for deployments that own their toolchain. Adapter sources are GitHub release archives (`archive`) and pinned PyPI wheels (`pypi`); system-provided adapters ride the override path.

## Execution worlds

The debug environment rides the existing [`SubprocessRuntime`](../../packages/subprocess/README.md) provider, so launch follows the session's local, SSH, or sandbox world. Adapters spawn through piped stdio; SSH attach that needs TCP goes through the tunnel transport (a local forwarded port), and a failed tunnel returns `DEBUG_ATTACH_UNSUPPORTED` rather than falling back to a host-local adapter. Sandbox worlds expose the target's declared capabilities, and an unsupported capability request rejects with `DEBUG_SANDBOX_DENIED` — the sandbox is never bypassed.

## Ownership and workspace isolation

Every launch and attach carries the calling session's identity: an agent's debug sessions belong to that agent's session, a person's belong to the workbench conversation. Sessions are workspace-scoped — a caller in one workspace cannot see or control another workspace's sessions (`DEBUG_WORKSPACE_MISMATCH`). An agent controlling a session a person created (or vice versa) needs the session's control grant or a single approval, and every control decision lands in the durable `debug/control` event; the grant source (`owned` / `session-grant` / `single-approval`) rides the tool result, because the pinned durable payload carries session, actor, operation, and thread/frame. Launch, attach, and memory write go through `ctx.approval` fail-closed: no answerer composed means denial with `DEBUG_APPROVAL_DENIED`, and the detail distinguishes an active rejection from a missing answerer.

## Durable events and projection

Four session events carry the durable debug facts, all `ignorable: true`: `debug/session-started`, `debug/stopped`, `debug/session-ended`, and `debug/control`. Payloads never include variable values, memory, environment values, or DAP frames — a model-visible fact is always reconstructable from the log without leaking target state. The `debugSessions` [projection](../../packages/debug/debug/README.md) folds these events into per-session rows with stop snapshots; suffix replay equals full replay, so consumers can page without replaying history.

## Bounds

Output bounds are deployment-tunable `Config` fields, not hardcoded constants: the projection's `maxProjectedSessions`/`maxProjectedStops`, `maxBreakpointsPerFile` on `ctx.debug`, the controller's event ring (`DEFAULT_DEBUG_EVENT_RING_LIMIT` = 500), the DAP backend's console limit, the orchestration's 30-second default handshake timeout, and `dsh-tool-debug`'s stop-notice delivery (`debugStopDelivery`, `debugMaxConsecutiveWakes`, `maxNoticeBytes` — deliberately not the job package's same-named fields). Stack, variable, and tool-result pages are bounded with truncation metadata; variables load lazily and the whole tree is never expanded. Protocol constants, checksum verification, and the sandbox non-bypass rule are fixed invariants, not configuration.

## Surfaces

All three surfaces consume the same normalized state. The [Web/Desktop workbench](../../packages/client/ui-debug/README.md) drives the [Remote controller](../../packages/api/debug-controller/README.md); the [CLI TUI](../../packages/tui/tui-debug/README.md) consumes `ctx.debug` in-process through its optional debug pane in the `tui` profile; headless NDJSON projects the same session events into `--json` output. Composition lives in the optional [`dsh-debug-bundle`](../../packages/bundle/debug/README.md): headless, SDK, and ACP deployments that enable it load the model side only, and the workbench rows activate only in the `web` and `desktop` profiles.

## Explicit limitations

- **Launch and attach need the orchestrator composition** — `ctx.debug.launch`/`attach` delegate to the installed `DebugLaunchOrchestrator`; without one they fail closed `DEBUG_UNAVAILABLE`, and agent calls additionally need an approval answerer.
- **Adapters install on demand** — the first session in a language downloads and verifies its adapter; air-gapped deployments must supply overrides first.
- **Approval answerer required for agent launch, attach, and memory writes** — deployments without one fail closed with `DEBUG_APPROVAL_DENIED`; this is the fail-closed design, not a defect.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdebug--debug"></a>

### `ctx.debug` — `Debug`

`ctx.debug`. Owns the provider table with its extension routes, the workspace-scoped session registry with live events, and the compound registry. A provider registration's id reservation and extension reservations commit in one lifecycle controller so disposal always releases them together.

```ts cordis-catalog
/**
 * Install the composition-level launch orchestrator that launch and attach
 * delegate to. The domain stays DAP-free; a host plugin provides the
 * environment, adapter resolution, backend factory, and approval wiring.
 * @param orchestrator - the orchestration to install.
 * @returns disposer removing the orchestrator.
 */
installLaunchOrchestrator(orchestrator: DebugLaunchOrchestrator): () => void

/**
 * Register one live session's backend; controllers resolve it to drive
 * execution and inspection without touching DAP.
 * @param sessionId - the session the backend serves.
 * @param backend - the composition's backend serving {@link DebugSessionOperations}.
 * @returns disposer removing the registration.
 */
registerBackend(sessionId: DebugSessionId, backend: DebugSessionOperations): () => void

/**
 * Resolve one session's registered backend.
 * @param sessionId - the session to resolve.
 * @returns the backend serving the session's operations, or undefined when
 * the session has none registered.
 */
backendOf(sessionId: DebugSessionId): DebugSessionOperations | undefined

/**
 * List debug sessions as read-facing infos.
 * @param scope - workspace and owner narrowing; omit for every session.
 * @returns the matching infos in registration order.
 */
list(scope?: DebugScope): readonly DebugSessionInfo[]

/**
 * Resolve one registered session to its stable live-session object.
 * @param id - the session's id.
 * @returns the live session, or undefined when the id is not registered.
 */
get(id: DebugSessionId): DebugLiveSession | undefined

/**
 * Launch a debug session through the installed orchestrator.
 * @param request - the launch request carrying provider, target, and caller.
 * @returns a promise for the live session.
 * @throws {@link DebugError} `DEBUG_UNAVAILABLE` until a composition
 * installs an orchestrator; the orchestrator's own failures propagate.
 */
launch(request: DebugLaunchRequest): Promise<DebugLiveSession>

/**
 * Attach to a running target through the installed orchestrator.
 * @param request - the attach request carrying provider, target, and caller.
 * @returns a promise for the live session.
 * @throws {@link DebugError} `DEBUG_UNAVAILABLE` until a composition
 * installs an orchestrator; the orchestrator's own failures propagate.
 */
attach(request: DebugAttachRequest): Promise<DebugLiveSession>

/**
 * Register one language provider after validating it completely.
 * @param provider - the provider to register.
 * @returns the disposer releasing the id and every extension reservation together.
 * @throws {@link DebugError} `DEBUG_INVALID_PROVIDER` for an empty id, an empty
 * extension list, a malformed extension, or duplicate extensions;
 * `DEBUG_CONFLICT` when the id or any extension is already reserved.
 */
registerProvider(provider: DebugProvider): () => void

/**
 * Read one registered provider.
 * @param id - the provider's branded id.
 * @returns the provider, or undefined when the id is not registered.
 */
provider(id: DebugProviderId): DebugProvider | undefined

/**
 * List every registered provider.
 * @returns the providers in registration order.
 */
providers(): readonly DebugProvider[]
```

Source: [`packages/debug/debug/src/index.ts`](../../packages/debug/debug/src/index.ts)

<a id="ctxdebugadapters--debugadaptermanager"></a>

### `ctx.debugAdapters` — `DebugAdapterManager`

The adapter manager service. Manifest registrations commit through `ctx.effect` so disposal releases them; installs share one in-flight promise per provider and platform.

```ts cordis-catalog
/**
 * Register one validated adapter manifest.
 * @param value - the raw manifest, as read from its data file.
 * @returns the disposer releasing the registration.
 * @throws {@link DebugError} `DEBUG_INVALID_CONFIG` or
 * `DEBUG_ADAPTER_CHECKSUM` from manifest validation;
 * `DEBUG_CONFLICT` when the provider already has a manifest.
 */
registerManifest(value: unknown): () => void

/**
 * List registered manifests.
 * @returns one status per manifest, in registration order.
 */
list(): readonly DebugAdapterStatus[]

/**
 * Install one provider's adapter for one platform in the target world.
 * Concurrent calls for the same provider and platform share one operation.
 * @param providerId - the registered manifest's provider.
 * @param call - platform, install root, and target-world I/O.
 * @returns the committed install layout.
 * @throws {@link DebugError} `DEBUG_ADAPTER_NOT_FOUND` when no manifest is
 * registered; install failures carry `DEBUG_ADAPTER_CHECKSUM` or
 * `DEBUG_ADAPTER_UNSUPPORTED`.
 */
async install(providerId: DebugProviderIdValue, call: DebugAdapterInstallCall): Promise<DebugAdapterInstalledLayout>

/**
 * Remove one provider's installed adapter directory for one platform.
 * @param providerId - the registered manifest's provider.
 * @param call - platform, install root, and target-world I/O.
 */
async uninstall(providerId: DebugProviderIdValue, call: DebugAdapterInstallCall): Promise<void>

/**
 * Resolve one installed adapter. Managed resolution never falls back to a
 * host adapter: an absent install in the target world fails.
 * @param providerId - the registered manifest's provider.
 * @param call - platform, install root, and target-world presence check.
 * @returns the resolved adapter command for the target world.
 * @throws {@link DebugError} `DEBUG_ADAPTER_NOT_FOUND` when no manifest is
 * registered or the platform has no install in the target world;
 * `DEBUG_ADAPTER_UNSUPPORTED` when the platform was never published.
 */
async resolve(providerId: DebugProviderIdValue, call: DebugAdapterResolveCall): Promise<ResolvedDebugAdapter>
```

Source: [`packages/debug/debug-adapter-manager/src/manager.ts`](../../packages/debug/debug-adapter-manager/src/manager.ts)

<a id="ctxdebughost--debughost"></a>

### `ctx.debugHost` — `DebugHost`

`ctx.debugHost`: the launch orchestrator this bundle installs. The domain stays DAP-free; this plugin owns the environment probe, managed-adapter resolution with install-on-miss, the stdio DAP backend, capability publication onto the live event bus, and the caller session's durable `debug/*` events.

```ts cordis-catalog
/**
 * Launch one debug session for the request's provider.
 * @param request - the validated launch request; the caller session must be live.
 * @returns the registered session's id.
 * @throws {@link DebugError} `DEBUG_ADAPTER_NOT_FOUND` for an unregistered
 * provider or an unresolvable adapter; `DEBUG_SESSION_GONE` when the caller
 * session is not live; launch failures propagate from the orchestration.
 */
async launch(request: DebugLaunchRequest): Promise<DebugSessionId>

/**
 * Attach to a running target for the request's provider.
 * @param request - the validated attach request; the caller session must be live.
 * @returns the registered session's id.
 * @throws the same typed failures as {@link launch}.
 */
async attach(request: DebugAttachRequest): Promise<DebugSessionId>
```

Source: [`packages/bundle/debug/src/debug-host.ts`](../../packages/bundle/debug/src/debug-host.ts)
<!-- END GENERATED cordis-surface -->
