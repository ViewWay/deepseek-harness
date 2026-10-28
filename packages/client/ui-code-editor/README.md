---
description: "Web code editor surface: CodeMirror 6 editing, breakpoint gutter, stop-line highlight, and version-guarded saves."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-code-editor

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-code-editor` is the debug workbench's editing surface: a CodeMirror 6 view with a breakpoint gutter, a current-line highlight for stopped frames, dirty and read-only states, and the save-conflict choice view. The component is pure presentation — the buffer, breakpoints, stop line, and conflict arrive as props and every gesture leaves through a callback. The package also owns the editor's save-facing model, its bounded client-local draft store, and the Remote face functions that open files and write guarded saves.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

### Editing a file

Open a file through `openEditorFile`: it reads the whole file once, decodes UTF-8 strictly, keeps the observed version and line separator, and refuses files past the byte cap or files that are not valid UTF-8 instead of opening them half-read. Editing goes through `createEditorModel`, which tracks dirty state against the last saved text, normalizes the buffer to LF, and restores the file's separator on save.

### Saving with a version guard

`saveEditorFile` sends the model's payload through the debug controller's `writeText`. A clean save returns the new version; a `FS_STALE_VERSION` collision resolves the disk's current version so the conflict view can name both sides. While a conflict is pending, `savePayload()` refuses with `EditorSaveBlockedError` until the user picks reload, keep mine, or save as.

### Toggling breakpoints

The gutter draws one keyboard-operable toggle per breakpoint. `toggleBreakpoint` applies one gutter click: a click on a line that holds a breakpoint removes it; any other click adds a plain breakpoint — except when the file's single breakpoint carries a condition, hit count, or log message, where the click relocates that configured breakpoint, preserving its configuration. `editorBreakpointInputs` projects the gutter state onto the seam's per-file replacement set; switched-off breakpoints stay client-side.

### Keeping drafts

`createDraftStore` keeps one bounded draft per Session and path across tab switches and refreshes. Drafts are client-local state, never Session events, and never model-visible. The store bounds total UTF-8 bytes, evicting the least recently written draft when a write would overflow, and refuses a single draft larger than the whole budget.

## Understand the implementation

- `editor-model.ts` derives the conflict instead of storing it: while the buffer is dirty and the known disk version differs from the baseline, saves are blocked. Reload adopts the disk text and version; keep mine moves the baseline to the disk version so the next save overwrites; save as retargets the path and writes through the create path.
- `CodeEditor.tsx` creates one CodeMirror view per mount, keyed by file path, which also fixes the language family (`editorLanguage`). Breakpoint markers are placed at line starts so document edits remap them; the stop line is a line decoration.
- `face.ts` consumes the `debug` and `workspaceFiles` Client Remote namespaces and folds each call into a discriminated outcome; components and stores never await Remote calls directly.
- All copy lives in the typed `codeEditor` locale dictionaries; no product string is hardcoded.

## Model Experience

None, as this package draws editor buffers in the browser and registers nothing model-facing.

#### KV Cache effect

None; file reads and guarded saves travel over the Remote and assemble no model request.

## Known Limitations and Deferred Work

- Composition into workbench panels, tab management, and the live Remote wiring (file reads, saves, breakpoint application, change-feed refresh) land with the workbench layout package, which owns panel registration; this package ships the pieces.
- Language extensions are bundled with the editor chunk; per-language lazy loading is deferred.
- Breakpoint line numbers are not remapped when the buffer is edited; the seam's breakpoint application owns positions.
- Hover evaluation (`supportsEvaluateForHovers`) and find/replace across files are deferred with the workbench wiring.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
