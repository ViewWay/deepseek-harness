# Debugging in the terminal: TUI and headless

English | [中文](debugging-cli.zh.md)

## Summary

The `tui` profile debugs in the terminal: chat, split, and debug layouts over the same agent session, with colon-prefixed debug commands and function keys, source preview in `$EDITOR`, and no browser. The headless profile reports debug facts in its `--json` event stream for scripts and CI. Both consume the same `ctx.debug` seam as the Web/Desktop workbench.

## Table of Contents

- [Start the TUI](#start-the-tui)
- [The debug layout](#debug-layout)
- [Commands and keys](#commands-and-keys)
- [Source preview and $EDITOR](#editor-handoff)
- [Debugging headless runs](#headless-ndjson)
- [CI adapter setup](#ci-adapters)
- [Further Exploration](#further-exploration)

<a id="start-the-tui"></a>
## Start the TUI

```sh
dsh --profile tui
```

The TUI opens in the chat layout. Ordinary text is a prompt; a leading `:` runs a command (`:help` lists them). The debug panels live in the debug layout (`:debug`), and the split layout (`:split`) shows the transcript beside the panels. The TUI runs in the same process as the agent session — no browser, no Remote layer, no extra ports.

The debug pane appears only when the debug bundle is enabled in the profile. Enable it through `dsh plugin` before starting the TUI; without the seam the `:debug` layout renders its placeholder.

<a id="debug-layout"></a>
## The debug layout

`:debug` switches to the debug layout; `:chat` returns. The pane folds the live `ctx.debug` event stream directly — the same events the Web workbench and the NDJSON stream see — into bounded console, stack, breakpoint, and frame rows. Output caps keep the pane usable in long runs; older console lines scroll off instead of growing without limit.

<a id="commands-and-keys"></a>
## Commands and keys

Colon commands drive the session: `:pause`, `:continue`, `:next`, `:step`, `:out`, and `:break` (with a `file:line` argument), plus adapter listing and installation through `:adapter`. The function keys map to the same commands: F5 continues, Shift+F5 pauses, F9 toggles a breakpoint, F10 steps over, F11 steps in, and Shift+F11 steps out.

Long tool outputs are summarized in the transcript with an `(:expand n)` marker; `:expand <n>` opens the stored full output in place, and the marker disappears once expanded.

Launch and attach from the terminal report the debug service's own notice until the service-level launch face is enabled; a typed notice appears in the pane rather than a silent failure. Operations that need approval ask through the TUI's approval answerer — no answerer, no launch.

<a id="editor-handoff"></a>
## Source preview and $EDITOR

When a stop selects a frame, the pane shows a bounded source preview around the stopped line. `open-editor` (or the pane's editor action) hands the current file and line to `$EDITOR` as argv — `+<line> file`, no shell in between. Set `$EDITOR` before starting the TUI; an unset or unusable editor reports the failure instead of opening nothing.

<a id="headless-ndjson"></a>
## Debugging headless runs

```sh
dsh --profile headless --json "run the test suite" > run.jsonl
```

`--json` projects the run as newline-delimited JSON events on stdout. Debug facts ride the same durable `debug/*` session events every surface writes: session starts, stops, endings, and control decisions, each carrying `ignorable` so downstream parsers can skip them. The stream stays bounded — every string except the terminal `final` is capped at 8 KiB and flagged with `truncated` — so a debug-heavy run cannot flood a CI log. The stream is a projection, not the log; it omits what the projection does not model.

Enabling the debug bundle in a headless profile gives the agent the debug tools, and the NDJSON stream reports what they did. The deployment must still provide an approval answerer; a headless run without one fails closed on launch and attach.

<a id="ci-adapters"></a>
## CI adapter setup

Adapters install on first use, which you do not want mid-CI-run. Pre-warm the cache in setup: run one throwaway launch per language (or the adapter self-test through the adapter manager) so the download and checksum verification happen before the measured run. Air-gapped runners should provide adapter commands through provider overrides — pinned adapter versions resolved inside the image — instead of downloading at run time.

<a id="further-exploration"></a>
## Further Exploration

- [The debug subsystem contract](../../subsystems/debug.md)
- [Debugging in the Web/Desktop workbench](./debugging.md)
- [The headless profile](../../../packages/bundle/headless/README.md)
