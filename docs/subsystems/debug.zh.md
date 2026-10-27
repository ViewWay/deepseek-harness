# IDE 调试会话

[English](debug.md) | 中文

一个 `ctx.debug` 能力缝同时服务 Agent 工具、Web/Desktop 工作台、CLI TUI 与 headless NDJSON。[debug 分组地图](../../packages/debug/README.zh.md)维护包清单；本页记录超越单个包的能力缝契约：会话状态机、provider 与适配器角色、执行世界、所有权、耐久事件、上限与当前限制。

## 能力缝

`debug` 包定义了[服务定义](../../packages/debug/debug/README.zh.md)：以 `debug` 为服务键的 `ctx.debug` 服务，持有语言 provider 注册表、会话注册表、断点注册表与复合配置注册表。provider 注册以一个生命周期控制器原子地保留品牌化 provider id 与一组排他的文件扩展名，两个 provider 不可能同时认领 `.py`。每个失败都是类型化的 [`DebugError`](../../packages/debug/debug/src/error.ts)，带 [`types.ts`](../../packages/debug/debug/src/types.ts) 中封闭 union 的稳定 `DebugErrorCode`；调用方按 `code` 路由，从不解析 `message`。

服务面的 launch 与 attach 目前为类型化不可用——在审批接线编排落地前都拒绝 `DEBUG_UNAVAILABLE`（`packages/debug/debug/src/index.ts:312`）。[`launch.ts`](../../packages/debug/debug/src/launch.ts) 中的纯编排（`launchDebugSession`/`attachDebugSession`）与 DAP 后端已落地并由真实适配器 e2e 矩阵验证；剩余的只有服务级组合接线。

## 会话状态机

会话处于 `starting`、`running`、`stopped`、`terminated`、`failed` 五态之一。状态变化从固定的七个状态事件发布——`launch-succeeded`、`stopped`、`continued`、`restart`、`terminated`、`disconnected`、`failed`——每个都携带源状态与目标状态，转移表之外的组合按类型拒绝 `DEBUG_INVALID_STATE`。`terminated`（目标程序结束）与 `disconnected`（操作者主动断开）是两个不同的终态来源，耐久的 `debug/session-ended` outcome 记录发生了哪一种。

## Provider 与适配器

每种语言一个 provider——[`debug-node`](../../packages/debug/debug-node/README.zh.md)、[`debug-python`](../../packages/debug/debug-python/README.zh.md)、[`debug-go`](../../packages/debug/debug-go/README.zh.md)、[`debug-native`](../../packages/debug/debug-native/README.zh.md)——把 launch/attach 请求解析成冻结的计划形状（适配器命令、DAP 请求、隧道端点、所需能力），并把适配器清单交给[适配器管理器](../../packages/debug/debug-adapter-manager/README.zh.md)。管理器校验带每平台 SHA-256 记录的清单、在目标执行世界内解析适配器且不回退宿主机、首次使用时经校验和验证与自检回滚安装，并为自有工具链的部署接受按 provider 的命令覆盖。适配器来源是 GitHub release 归档（`archive`）与固定版本的 PyPI wheel（`pypi`）；系统自带的适配器走覆盖路径。

## 执行世界

调试环境复用现有 [`SubprocessRuntime`](../../packages/subprocess/README.zh.md) provider，因此 launch 跟随会话的本机、SSH 或沙箱世界。适配器经管道 stdio 启动；需要 TCP 的 SSH attach 走隧道传输（本地转发端口），隧道建立失败返回 `DEBUG_ATTACH_UNSUPPORTED` 而不是回退宿主机适配器。沙箱世界暴露目标声明的能力，不支持的能力请求按类型拒绝 `DEBUG_SANDBOX_DENIED`——沙箱从不被绕过。

## 所有权与工作区隔离

每次 launch/attach 都携带调用会话身份：Agent 的调试会话属于该 Agent 的会话，人的属于工作台对话。会话按工作区划分——一个工作区的调用方看不到、也控制不了另一个工作区的会话（`DEBUG_WORKSPACE_MISMATCH`）。Agent 控制人创建的会话（或反向）需要该会话的控制授权或一次单独审批，每次控制决策都落入带授权来源的耐久 `debug/control` 事件。launch、attach 与内存写入走 `ctx.approval` fail-closed：没有组合回答者即以 `DEBUG_APPROVAL_DENIED` 拒绝，detail 区分主动拒绝与缺少回答者。

## 耐久事件与投影

四个会话事件携带耐久调试事实，全部 `ignorable: true`：`debug/session-started`、`debug/stopped`、`debug/session-ended`、`debug/control`。载荷从不包含变量值、内存、环境值或 DAP 帧——模型可见事实永远可以从日志重建而不泄露目标状态。`debugSessions` [投影](../../packages/debug/debug/README.zh.md)把事件折叠为带停住快照的按会话行；后缀重放等于全量重放，消费方可以分页而不重放历史。

## 上限

输出上限是可部署调整的 `Config` 字段，不是硬编码常量：投影的 `maxProjectedSessions`/`maxProjectedStops`、`ctx.debug` 的 `maxBreakpointsPerFile`、控制器的事件环（`DEFAULT_DEBUG_EVENT_RING_LIMIT` = 500）、DAP 后端的 console 上限、编排的 30 秒默认握手超时。栈、变量与工具结果分页有界并带截断元数据；变量懒加载，整棵树绝不递归展开。协议常量、校验和验证与沙箱不绕过是固定不变量，不是配置。

## 三端

三个端消费同一份规范化状态。[Web/Desktop 工作台](../../packages/client/ui-debug/README.zh.md)驱动 [Remote 控制器](../../packages/api/debug-controller/README.zh.md)；[CLI TUI](../../packages/tui/tui-debug/README.zh.md) 在 `tui` profile 内经可选调试面板进程内消费 `ctx.debug`；headless NDJSON 把同一批会话事件投影进 `--json` 输出。组合在可选的 [`dsh-debug-bundle`](../../packages/bundle/debug/README.zh.md) 中：启用它的 headless、SDK 与 ACP 部署只加载模型侧，工作台行仅在 `web` 与 `desktop` profile 激活。

## 明确限制

- **服务级 launch 面待落地** — 在审批接线编排组合落地前，`ctx.debug.launch`/`attach` 按类型拒绝；工具与控制器对此报告 `DEBUG_UNAVAILABLE`/`DEBUG_SESSION_GONE`。
- **适配器按需安装** — 每个语言的首次会话会下载并校验适配器；离线部署必须先提供覆盖。
- **需要审批回答者** — 没有回答者的部署无法 launch/attach；这是 fail-closed 设计，不是缺陷。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdebug--debug"></a>

### `ctx.debug` — `Debug`

`ctx.debug`. Owns the provider table with its extension routes, the workspace-scoped session registry with live events, and the compound registry. A provider registration's id reservation and extension reservations commit in one lifecycle controller so disposal always releases them together.

```ts cordis-catalog
/**
 * Register one live session's backend handle; controllers resolve it to
 * drive execution and inspection without touching DAP.
 * @param sessionId - the session the backend serves.
 * @param backend - the composition's backend handle.
 * @returns disposer removing the registration.
 */
registerBackend<T>(sessionId: DebugSessionId, backend: T): () => void

/**
 * Resolve one session's registered backend handle.
 * @param sessionId - the session to resolve.
 * @returns the handle, or undefined when the session has none registered.
 */
backendOf<T>(sessionId: DebugSessionId): T | undefined

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
 * Launch a debug session.
 * @param _request - the launch request; consumed once the DAP backend lands.
 * @returns a promise for the live session; rejects until the backend lands.
 * @throws {@link DebugError} `DEBUG_UNAVAILABLE` until the backend lands.
 */
launch(_request: DebugLaunchRequest): Promise<DebugLiveSession>

/**
 * Attach to a running target.
 * @param _request - the attach request; consumed once the DAP backend lands.
 * @returns a promise for the live session; rejects until the backend lands.
 * @throws {@link DebugError} `DEBUG_UNAVAILABLE` until the backend lands.
 */
attach(_request: DebugAttachRequest): Promise<DebugLiveSession>

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
<!-- END GENERATED cordis-surface -->
