# 在 Web 与 Desktop 工作台中调试

[English](debugging.md) | 中文

## 概述

开启[调试 bundle](../../../packages/bundle/debug/README.zh.md) 后，你的会话即获得 IDE 级调试：对 Node.js/TypeScript、Python、Go 或 Rust/C/C++ 程序 launch 或 attach，然后在工作台中控制执行、查看状态，同时 Agent 在同一会话中工作。该 bundle 为可选且默认关闭，由 plugin manager 按 profile 开启。

## 目录

- [开启 bundle](#enable-the-bundle)
- [准备适配器](#adapter-setup)
- [启动调试会话](#start-a-session)
- [使用面板](#work-the-panels)
- [调试时编辑文件](#editing-and-save-conflicts)
- [失败排查](#common-failures)
- [延伸阅读](#further-exploration)

<a id="enable-the-bundle"></a>
## 开启 bundle

从侧栏打开 Plugins 页，找到 **Debugger** 并开启。bundle 会在当前 profile 之上堆叠调试缝、四个语言 provider、Agent 调试工具与工作台面板；关闭即一并移除。bundle 启动后创建的会话中出现 Agent 的 `debug_session`、`debug_execution`、`debug_inspect`、`debug_breakpoints` 工具。

<a id="adapter-setup"></a>
## 准备适配器

适配器不需要手动安装。某语言的首次 launch 会解析它的适配器——Node 用 js-debug DAP server，Python 用 debugpy，Go 用 Delve，Rust/C/C++ 用 lldb-dap——校验其发布的 SHA-256 并安装到托管位置。适配器设置面板显示每个适配器的版本、平台、许可证、摘要与安装状态，并提供安装、更新、卸载与自检操作。

如果机器上已有偏好的工具链（系统 lldb-dap、指定版本的 debugpy），在适配器设置的覆盖路径中把 provider 指向它；管理器将原样使用该命令并跳过下载。

语言前置条件就是工具链本身：调试 Go 需要 `go` 与 Delve 兼容工具链；原生调试需要 lldb-dap 二进制，Linux 上还需 ptrace 权限，macOS 上需要为 task_for_pid 批准开发者模式。

<a id="start-a-session"></a>
## 启动调试会话

可以直接对 Agent 说——"用 node provider 启动 src/server.ts，入口停住"——也可以打开工作台自行配置 launch：选择 provider、程序或模块、工作目录与参数。launch 与 attach 总是携带当前对话身份，因此会话出现在工作台，Agent 的工具结果描述的也是同一次运行。

attach 有三种方式：进程 id、调试端口，或（Node）URL。语言支持时 provider 会探测可附加目标；SSH 或沙箱目标在其所属执行世界内附加，绝不回退宿主机适配器。

会话运行期间，launch、attach 与内存写入走正常审批流。你或部署无法应答的请求按 fail-closed 以 `DEBUG_APPROVAL_DENIED` 拒绝——不会有任何操作静默启动。

<a id="work-the-panels"></a>
## 使用面板

工具栏承载运行控制、会话与线程选择器以及 Agent 停住通知开关。控件只在适配器报告了对应能力时出现，因此缺席的面板或按钮表示适配器不支持该特性。

- **栈与线程** — 选线程，再选帧；编辑器跟随所选帧的源码位置。
- **变量与监视** — 变量逐层加载，展开节点看更多。监视表达式每次停住重新求值，单个失败只显示自身错误，不影响其他。
- **断点** — 在编辑器边栏或断点面板设置；断点经断点存储跨会话保留，面板显示适配器已验证的条目。
- **Console** — 调试目标的有界输出环，按需分页加载。
- **模块、已加载源码、反汇编、内存** — 能力门控面板；内存读写需适配器声明支持，内存写入每次都要审批。

停止 Agent 不会停止你的调试会话；二者是独立的所有者。你可以接管 Agent 启动的会话，接管会记入审计轨迹。

<a id="editing-and-save-conflicts"></a>
## 调试时编辑文件

工作台编辑器经宿主文件系统的版本守卫写入。文件自打开后在磁盘上发生变化时，保存以过期版本冲突被拒绝而不是覆盖；重新加载文件再套用你的修改。创建文件时若同名文件已出现则拒绝覆盖。不存在静默合并。

<a id="common-failures"></a>
## 失败排查

- **`DEBUG_APPROVAL_DENIED`** — 没有组合审批回答者，或请求被拒绝。检查审批对象并回应提示，或在组合了审批对话框的 profile 中开启 bundle。
- **`DEBUG_ADAPTER_NOT_FOUND` / `DEBUG_ADAPTER_CHECKSUM`** — 适配器未安装或校验失败；在适配器设置面板重试安装，或用自有工具链覆盖命令。
- **`DEBUG_ATTACH_UNSUPPORTED`** — 目标世界无法服务该附加（例如隧道无法建立）；改为本地附加或修复转发。
- **`DEBUG_WORKSPACE_MISMATCH`** — 会话属于另一工作区；切换工作区而不是跨越边界。
- **`DEBUG_TIMEOUT`** — 适配器未在握手期限内应答；确认适配器在目标世界可运行后重试。
- **`DEBUG_SESSION_GONE`** — 会话已结束；面板将最后一次停住显示为过期，直到你启动或选择一个存活会话。

<a id="further-exploration"></a>
## 延伸阅读

- [调试子系统契约](../../subsystems/debug.zh.md)
- [终端与 headless 调试](./debugging-cli.zh.md)
- [调试组合 bundle](../../../packages/bundle/debug/README.zh.md)
