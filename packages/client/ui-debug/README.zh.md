---
description: "面向 Web/Desktop 工作台的调试工具条、视图存储、面板与对话工具卡。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-debug

[English](README.md) | 中文

## 概述

`dsh-client-ui-debug` 是调试工作台的视图层：能力门控的工具条、调试事件的客户端折叠、调用栈/变量/监视/断点/控制台/模块/已加载源/反汇编/内存/异常过滤器面板、适配器设置面板，以及四个调试工具的对话卡。每一块都是输入的纯展示——状态、行数据与能力标志以 props 传入，每个手势都经回调交给工作台装配层路由到 Remote。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

### 折叠实时事件

`createDebugViewStore` 把调试控制器的事件载荷折叠成一份不可变视图状态：选中的会话/线程/帧、上报的能力、线程列表、懒加载变量展开集、监视表达式，以及带游标的有界控制台环。继续或终止会清空停住、帧与变量引用并把栈和变量标记为过期，面板因此描述的是上一次停住而不是把它当现状展示。`visibleDebugActions` 从上报的能力推导工具条控件，适配器未声明的能力永远不会渲染出会失败的控件。

### 渲染工具条

`DebugToolbar` 渲染门控的运行控件、会话与线程选择器、Agent 停住通知开关和 actor 指示。能力未上报时只渲染选择器、开关与指示。

### 渲染面板

`panels.tsx` 中的面板逐个导出：调用栈、变量、监视、断点、异常过滤器、控制台、模块、已加载源、反汇编、内存，以及适配器设置行（版本、平台、许可证、SHA-256、安装/更新/卸载/自检、覆盖路径、进行中状态）。能力门控面板在无支持时不渲染；变量值按上限截断，懒加载展开是查看其余内容的途径；一个监视表达式失败只显示自身错误，不阻塞其他监视。

### 对话卡

`debugToolCard` 把一次调试工具调用的已记录参数投影到通用卡模型——标题、有界摘要与停住位置——格式错误或未知载荷退化为裸通用形状。客户端插件经 `tool.call.toolview` 注册四个工具名（`debug_session`、`debug_breakpoints`、`debug_execution`、`debug_inspect`），Session 回放从同一段日志渲染出同样的卡，未注册的名字回退到转录的通用行。

<a id="understand-the-implementation"></a>
## 理解实现

- `store.ts` 保存客户端平面的值——与调试控制器事件环一致的原生 id 和路径；品牌化的 seam id 不跨 Remote，这里不做任何转换。
- 面板与工具条从不适待 Remote 调用；拥有面板注册权的工作台布局包经 Remote 取数并把结果折叠进 props。
- 全部文案位于八个发布语言的类型化 `debug` locale 字典；无硬编码产品字符串。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

<a id="model-experience"></a>
## 模型体验（Model Experience）

None，本包在浏览器中渲染调试视图，不注册任何面向模型的内容。

#### KV Cache 影响

None；工具卡是已记录工具参数的纯投影，不组装模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 工作台面板装配、事件与操作的 Remote 接线、悬停求值随工作台布局包落地——面板注册归 `ctx.workbenchPanels` 所有；本包交付组件。
- 监视表达式编辑经回调路由；输入界面归工作台所有。
- 反汇编与内存是只读视图；按设计默认关闭的规则，内存写入完全不出现在界面上。
