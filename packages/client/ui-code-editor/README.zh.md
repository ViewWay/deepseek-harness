---
description: "Web 代码编辑器界面：CodeMirror 6 编辑、断点槽、停住行高亮与版本守卫保存。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-code-editor

[English](README.md) | 中文

## 概述

`dsh-client-ui-code-editor` 是调试工作台的编辑界面：带断点槽的 CodeMirror 6 视图、停住帧的当前行高亮、脏状态与只读状态，以及保存冲突选择视图。组件是纯展示——缓冲区、断点、停住行与冲突都经 props 到达，每个手势经回调离开。包同时持有编辑器的保存模型、按会话与路径限界的客户端草稿存储，以及打开文件与版本守卫写入的 Remote 面函数。

## 使用本包

### 编辑文件

用 `openEditorFile` 打开文件：整读一次、严格按 UTF-8 解码、保留观测版本与换行风格；超过字节上限或非 UTF-8 的文件拒绝打开，而不是半开。编辑经 `createEditorModel`：相对最近保存文本跟踪脏状态，缓冲区内统一 LF，保存时恢复文件的换行风格。

### 版本守卫保存

`saveEditorFile` 把模型的载荷经调试控制器的 `writeText` 发送。干净保存返回新版本；`FS_STALE_VERSION` 冲突会解析磁盘当前版本，冲突视图因此能同时命名两侧。冲突未决期间 `savePayload()` 以 `EditorSaveBlockedError` 拒绝，直到用户选择重新加载、保留我的或另存为。

### 切换断点

槽内每个断点绘制一个可键盘操作的切换钮。`toggleBreakpoint` 应用一次槽点击：点击已有断点的行将其移除；其他点击增加一个普通断点——唯一例外是文件仅有一个带条件、命中次数或日志点的断点时，点击将该配置断点搬移到新行并保留其配置。`editorBreakpointInputs` 把槽状态投影到 seam 的按文件替换集；关闭的断点只留在客户端。

### 保存草稿

`createDraftStore` 按会话与路径保存一个有界草稿，跨标签切换与刷新保留。草稿是客户端本地状态，绝不是 Session 事件，也绝不模型可见。存储按总 UTF-8 字节限界：写入将溢出时逐出最久未写的草稿；单条超过整个预算的草稿直接拒存。

## 理解实现

- `editor-model.ts` 派生而非存储冲突：缓冲区为脏且已知磁盘版本异于基线时阻止保存。重新加载采纳磁盘文本与版本；保留我的把基线移到磁盘版本，下一次保存覆盖；另存为改换路径并走创建路径写入。
- `CodeEditor.tsx` 每次挂载创建一个 CodeMirror 视图，按文件路径 key，同时固定语言族（`editorLanguage`）。断点标记放在行首，文档编辑时随之重映射；停住行是行装饰。
- `face.ts` 消费 `debug` 与 `workspaceFiles` 两个 Client Remote 命名空间，把每次调用折叠为判别结果；组件与 store 从不直接 await Remote 调用。
- 所有文案都在类型化的 `codeEditor` locale 词典里，没有硬编码产品字符串。

## Model Experience

无：本包在浏览器中绘制编辑器缓冲区，不注册任何模型可见内容。

#### KV Cache effect

无；文件读取与守卫写入走 Remote，不组装任何模型请求。

## 已知限制与延后工作

- 工作台面板组合、标签管理以及实时 Remote 接线（文件读取、保存、断点应用、变更订阅刷新）随工作台布局包落地，面板注册归那里；本包交付构件。
- 语言扩展随编辑器 chunk 一起打包；按语言懒加载延后。
- 缓冲区被编辑时断点行号不重映射；位置由 seam 的断点应用所有。
- 悬停求值（`supportsEvaluateForHovers`）与跨文件查找替换随工作台接线延后。
