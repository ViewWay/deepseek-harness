/**
 * The workbench's code editor surface: a CodeMirror 6 view with a breakpoint
 * gutter, a current-line highlight for stopped frames, and the save-conflict
 * choice view.
 *
 * The component is pure presentation: the buffer, breakpoints, stop line, and
 * conflict all arrive as props, and every gesture leaves through a callback.
 * The editor instance is created once per mount; parents key it by file path,
 * which also fixes its language. Buffer text is LF here; the editor model
 * restores the file's separator on save. Line numbers are 1-based and shared
 * with the breakpoint vocabulary.
 */
import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import clsx from 'clsx'
import { Compartment, EditorState, Prec, RangeSet, StateEffect, StateField } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import type { Text } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, gutter, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { go } from '@codemirror/lang-go'
import { rust } from '@codemirror/lang-rust'
import { cpp } from '@codemirror/lang-cpp'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { EditorBreakpoint } from './breakpoints.ts'
import type { EditorConflict } from './editor-model.ts'
import type {} from './locales.ts'
import css from './CodeEditor.module.css'

/** Language families the editor highlights; anything else edits as text. */
export type EditorLanguage = 'javascript' | 'typescript' | 'python' | 'go' | 'rust' | 'cpp' | 'plain'

/**
 * Pick a file's language family from its suffix.
 * @param path - workspace-relative file path.
 * @returns the language family to highlight, or 'plain'.
 */
export function editorLanguage(path: string): EditorLanguage {
  const suffix = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  switch (suffix) {
    case 'js': case 'jsx': case 'mjs': case 'cjs': return 'javascript'
    case 'ts': case 'tsx': case 'mts': case 'cts': return 'typescript'
    case 'py': case 'pyi': return 'python'
    case 'go': return 'go'
    case 'rs': return 'rust'
    case 'c': case 'h': case 'cpp': case 'cc': case 'hpp': case 'hh': case 'cxx': return 'cpp'
    default: return 'plain'
  }
}

const languageExtension = (language: EditorLanguage): readonly Extension[] => {
  switch (language) {
    case 'javascript': return [javascript({ jsx: true })]
    case 'typescript': return [javascript({ typescript: true, jsx: true })]
    case 'python': return [python()]
    case 'go': return [go()]
    case 'rust': return [rust()]
    case 'cpp': return [cpp()]
    case 'plain': return []
  }
}

/** What one gutter breakpoint draws: its line and its accessible name. */
interface BreakpointMark {
  /** 1-based line the marker toggles. */
  readonly line: number
  /** Localized toggle label for the marker's accessible name. */
  readonly label: string
}

/** One gutter breakpoint: a keyboard-operable toggle rendered per line. */
class BreakpointMarker extends GutterMarker {
  constructor(
    /** Toggle target and payload. */
    readonly mark: BreakpointMark,
    /**
     * Gesture callback. The value dispatched with the marker set reads the
     * owning mount's latest props, so marker DOM never holds a stale closure.
     * @param line - the marker's 1-based line.
     */
    readonly onToggle: (line: number) => void,
  ) { super() }

  override toDOM(): HTMLElement {
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'dsw-cm-breakpoint'
    toggle.dataset.breakpoint = String(this.mark.line)
    toggle.setAttribute('aria-label', this.mark.label)
    toggle.addEventListener('click', () => { this.onToggle(this.mark.line) })
    return toggle
  }
}

/** Replace the file's breakpoints, with labels and the owning gesture. */
interface BreakpointSetEffect {
  readonly marks: readonly BreakpointMark[]
  readonly onToggle: (line: number) => void
}

const setBreakpoints = StateEffect.define<BreakpointSetEffect>()
/** Move the stopped-frame highlight, or clear it with null. */
const setCurrentLine = StateEffect.define<number | null>()

/**
 * Place one file's breakpoints at their line starts, so document edits remap
 * them; breakpoints past the end of the document stay unplaced until the
 * document is long enough.
 * @param effect - the markers to place and the gesture they invoke.
 * @param doc - the document to place them in.
 */
const breakpointRangeSet = (effect: BreakpointSetEffect, doc: Text): RangeSet<BreakpointMarker> => {
  const ranges = effect.marks
    .filter(mark => mark.line >= 1 && mark.line <= doc.lines)
    .map(mark => new BreakpointMarker(mark, effect.onToggle).range(doc.line(mark.line).from))
  return RangeSet.of(ranges, true)
}

const breakpointField = StateField.define<RangeSet<BreakpointMarker>>({
  create: () => RangeSet.empty,
  update(value, transaction) {
    let next = value.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (effect.is(setBreakpoints)) next = breakpointRangeSet(effect.value, transaction.state.doc)
    }
    return next
  },
})

/**
 * Highlight one stopped frame's line, clamped to the document.
 * @param line - 1-based line to highlight.
 * @param doc - the document that holds it.
 */
const currentLineRangeSet = (line: number, doc: Text): RangeSet<Decoration> => {
  const clamped = Math.min(Math.max(line, 1), doc.lines)
  return Decoration.set([Decoration.line({ class: 'dsw-cm-debug-line' }).range(doc.line(clamped).from)])
}

const currentLineField = StateField.define<RangeSet<Decoration>>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (!effect.is(setCurrentLine)) continue
      next = effect.value === null ? Decoration.none : currentLineRangeSet(effect.value, transaction.state.doc)
    }
    return next
  },
  provide: field => EditorView.decorations.from(field),
})

const languageCompartment = new Compartment()
const editableCompartment = new Compartment()

/** The component's composed props: buffer facts, gestures, and copy. */
export type CodeEditorProps = PropsLocale<'codeEditor'> & {
  /** Workspace-relative file path; fixes the language at mount. */
  readonly path: string
  /** Buffer text in LF form. */
  readonly text: string
  /** True while the buffer differs from the last saved text. */
  readonly dirty: boolean
  /** True for virtual sources and files outside the workspace. */
  readonly readOnly: boolean
  /** The pending save conflict, or undefined while saves may proceed. */
  readonly conflict: EditorConflict | undefined
  /** The file's breakpoints. */
  readonly breakpoints: readonly EditorBreakpoint[]
  /** The stopped frame's 1-based line, or undefined while running. */
  readonly currentLine: number | undefined
  /** Buffer edited from the editor. @param text - the new LF buffer. */
  readonly onChange: (text: string) => void
  /** Gutter toggle requested. @param line - the 1-based toggled line. */
  readonly onToggleBreakpoint: (line: number) => void
  /** Save requested through the editor's save binding. */
  readonly onSave: () => void
  /** Conflict choice: adopt the disk content. */
  readonly onResolveReload: () => void
  /** Conflict choice: keep the buffer and overwrite the disk version. */
  readonly onResolveKeepMine: () => void
  /** Conflict choice: write the buffer to a new path instead. */
  readonly onResolveSaveAs: () => void
}

/**
 * Render one file's editor.
 * @param props - buffer facts, gestures, and copy.
 */
export function CodeEditor(props: CodeEditorProps): ReactElement {
  const { t } = props
  const host = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const language = editorLanguage(props.path)

  useEffect(() => {
    const mount = host.current
    if (mount === null) return
    const current = propsRef.current
    const saveBinding = Prec.highest(keymap.of([{
      key: 'Mod-s',
      preventDefault: true,
      run: () => { propsRef.current.onSave(); return true },
    }]))
    const breakpointGutter = gutter({
      class: 'dsw-cm-breakpoints',
      markers: view => view.state.field(breakpointField),
      domEventHandlers: {
        // A marker toggle handles its own line through its button; gutter
        // clicks elsewhere toggle the clicked line.
        mousedown: (view, line, event) => {
          if ((event.target as HTMLElement | null)?.closest('[data-breakpoint]') !== null) return false
          propsRef.current.onToggleBreakpoint(view.state.doc.lineAt(line.from).number)
          return true
        },
      },
    })
    const view = new EditorView({
      state: EditorState.create({
        doc: current.text,
        extensions: [
          lineNumbers(),
          breakpointGutter,
          breakpointField,
          currentLineField,
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          keymap.of(searchKeymap),
          search({ top: true }),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          languageCompartment.of(languageExtension(editorLanguage(current.path))),
          editableCompartment.of([
            EditorState.readOnly.of(current.readOnly),
            EditorView.editable.of(!current.readOnly),
          ]),
          saveBinding,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) propsRef.current.onChange(update.state.doc.toString())
          }),
          EditorView.contentAttributes.of({ 'aria-label': current.t('editor.label') }),
        ],
      }),
      parent: mount,
    })
    viewRef.current = view
    return () => {
      viewRef.current = null
      view.destroy()
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    if (view.state.doc.toString() !== props.text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.text } })
    }
  }, [props.text])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: setBreakpoints.of({
        marks: props.breakpoints.map(breakpoint => ({
          line: breakpoint.line,
          label: t('gutter.toggle', { line: breakpoint.line }),
        })),
        onToggle: (line) => { propsRef.current.onToggleBreakpoint(line) },
      }),
    })
  }, [props.breakpoints, t])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setCurrentLine.of(props.currentLine ?? null) })
  }, [props.currentLine])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableCompartment.reconfigure([
        EditorState.readOnly.of(props.readOnly),
        EditorView.editable.of(!props.readOnly),
      ]),
    })
  }, [props.readOnly])

  return (
    <div className={clsx(css.editor, props.readOnly && css.readOnly)} data-editor="code" data-language={language}>
      {props.dirty || props.readOnly
        ? (
          <div className={css.status}>
            {props.dirty ? <span className={css.dirty} data-editor-state="dirty">{t('dirty')}</span> : null}
            {props.readOnly ? <span className={css.readonly} data-editor-state="read-only">{t('readOnly')}</span> : null}
          </div>
        )
        : null}
      {props.conflict !== undefined
        ? (
          <div className={css.conflict} role="alert" data-editor-conflict="version">
            <span className={css.conflictTitle}>{t('conflict.title')}</span>
            <span className={css.conflictDetail}>
              {t('conflict.detail', { opening: props.conflict.openingVersion ?? '—', disk: props.conflict.diskVersion })}
            </span>
            <div className={css.conflictActions}>
              <button type="button" onClick={props.onResolveReload}>{t('conflict.reload')}</button>
              <button type="button" onClick={props.onResolveKeepMine}>{t('conflict.keepMine')}</button>
              <button type="button" onClick={props.onResolveSaveAs}>{t('conflict.saveAs')}</button>
            </div>
          </div>
        )
        : null}
      <div ref={host} className={css.host} />
    </div>
  )
}
