/**
 * `codeEditor` namespace dictionaries, and the namespace's declaration.
 *
 * Copy the editor surface owns: buffer and read-only states, the save-conflict
 * choice, breakpoint gutter labels, and the editor's accessible name. User and
 * model data (paths, versions, expressions) stay verbatim and interpolate by
 * placeholder.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'codeEditor'>` or `PropsLocale<'codeEditor'>` needs only this
 * file, whichever entry a program loads first.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Editor states, save-conflict choices, gutter labels, and editor name. */
    codeEditor: CodeEditorKey
  }
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'dirty': '未保存的更改',
  'readOnly': '只读',
  'conflict.title': '文件已在磁盘上变更',
  'conflict.detail': '打开时的版本是 {opening}，磁盘当前版本是 {disk}。',
  'conflict.reload': '重新加载',
  'conflict.keepMine': '保留我的更改',
  'conflict.saveAs': '另存为…',
  'gutter.toggle': '切换第 {line} 行的断点',
  'editor.label': '代码编辑器',
} satisfies Record<string, string>

/** Editor dictionary key union. */
export type CodeEditorKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'dirty': 'Unsaved changes',
  'readOnly': 'Read-only',
  'conflict.title': 'The file changed on disk',
  'conflict.detail': 'Opened as version {opening}; the disk is now at {disk}.',
  'conflict.reload': 'Reload from disk',
  'conflict.keepMine': 'Keep my changes',
  'conflict.saveAs': 'Save as…',
  'gutter.toggle': 'Toggle breakpoint on line {line}',
  'editor.label': 'Code editor',
} satisfies Record<CodeEditorKey, string>

/** Japanese copy, checked against the English keys. */
export const ja = {
  'dirty': '未保存の変更',
  'readOnly': '読み取り専用',
  'conflict.title': 'ファイルがディスク上で変更されました',
  'conflict.detail': '開いた時点のバージョンは {opening}、ディスクは現在 {disk} です。',
  'conflict.reload': 'ディスクから再読み込み',
  'conflict.keepMine': '自分の変更を残す',
  'conflict.saveAs': '名前を付けて保存…',
  'gutter.toggle': '{line} 行目のブレークポイントを切り替える',
  'editor.label': 'コードエディター',
} satisfies Record<CodeEditorKey, string>

/** Spanish copy, checked against the English keys. */
export const es = {
  'dirty': 'Cambios sin guardar',
  'readOnly': 'Solo lectura',
  'conflict.title': 'El archivo cambió en el disco',
  'conflict.detail': 'Abierto como versión {opening}; el disco está en {disk}.',
  'conflict.reload': 'Recargar desde el disco',
  'conflict.keepMine': 'Conservar mis cambios',
  'conflict.saveAs': 'Guardar como…',
  'gutter.toggle': 'Alternar punto de interrupción en la línea {line}',
  'editor.label': 'Editor de código',
} satisfies Record<CodeEditorKey, string>

/** French copy, checked against the English keys. */
export const fr = {
  'dirty': 'Modifications non enregistrées',
  'readOnly': 'Lecture seule',
  'conflict.title': 'Le fichier a changé sur le disque',
  'conflict.detail': 'Ouvert en version {opening} ; le disque est en {disk}.',
  'conflict.reload': 'Recharger depuis le disque',
  'conflict.keepMine': 'Garder mes modifications',
  'conflict.saveAs': 'Enregistrer sous…',
  'gutter.toggle': "Basculer le point d'arrêt à la ligne {line}",
  'editor.label': 'Éditeur de code',
} satisfies Record<CodeEditorKey, string>

/** German copy, checked against the English keys. */
export const de = {
  'dirty': 'Ungespeicherte Änderungen',
  'readOnly': 'Schreibgeschützt',
  'conflict.title': 'Die Datei wurde auf der Festplatte geändert',
  'conflict.detail': 'Als Version {opening} geöffnet; die Festplatte ist jetzt bei {disk}.',
  'conflict.reload': 'Von der Festplatte neu laden',
  'conflict.keepMine': 'Meine Änderungen behalten',
  'conflict.saveAs': 'Speichern unter…',
  'gutter.toggle': 'Haltepunkt in Zeile {line} umschalten',
  'editor.label': 'Code-Editor',
} satisfies Record<CodeEditorKey, string>

/** Russian copy, checked against the English keys. */
export const ru = {
  'dirty': 'Несохранённые изменения',
  'readOnly': 'Только чтение',
  'conflict.title': 'Файл изменился на диске',
  'conflict.detail': 'Открыт как версия {opening}; на диске сейчас {disk}.',
  'conflict.reload': 'Перезагрузить с диска',
  'conflict.keepMine': 'Сохранить мои изменения',
  'conflict.saveAs': 'Сохранить как…',
  'gutter.toggle': 'Переключить точку останова в строке {line}',
  'editor.label': 'Редактор кода',
} satisfies Record<CodeEditorKey, string>

/** Portuguese copy, checked against the English keys. */
export const pt = {
  'dirty': 'Alterações não salvas',
  'readOnly': 'Somente leitura',
  'conflict.title': 'O arquivo mudou no disco',
  'conflict.detail': 'Aberto como versão {opening}; o disco está em {disk}.',
  'conflict.reload': 'Recarregar do disco',
  'conflict.keepMine': 'Manter minhas alterações',
  'conflict.saveAs': 'Salvar como…',
  'gutter.toggle': 'Alternar breakpoint na linha {line}',
  'editor.label': 'Editor de código',
} satisfies Record<CodeEditorKey, string>
