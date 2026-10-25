/**
 * `workbench` namespace dictionaries, and the namespace's declaration.
 *
 * Copy the workbench page owns: the page and region labels, the launch-config
 * picker entries and validation line, the stop announcement, the narrow-layout
 * hint, and the dock-kit surface labels. User data (configuration names, stop
 * reasons and locations) stays verbatim and interpolates by placeholder.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'workbench'>` needs only this file.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Workbench page, regions, config picker, and dock surface copy. */
    workbench: WorkbenchKey
  }
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'page.label': '调试工作台',
  'panels.label': '调试面板',
  'region.files': '文件',
  'region.editor': '编辑器',
  'region.terminal': '终端',
  'config.picker.label': '调试配置',
  'config.debugCurrentFile': '调试当前文件',
  'config.addConfiguration': '添加配置',
  'config.invalid': '调试配置无效：{message}',
  'stop.announce': '已停住：{reason}，位置 {location}',
  'narrow.hint': '侧栏已折叠为标签；完整布局请使用桌面端。',
  'dock.emptyPane': '没有打开的面板。',
  'dock.splitPane': '拆分面板',
  'dock.splitPaneDisabled': '没有空间再容纳一个面板',
  'dock.splitPaneNarrow': '此面板太窄，无法拆分',
  'dock.closeTab': '关闭面板标签',
  'dock.addTab': '添加面板',
  'dock.dockFloat': '停靠面板',
  'dock.closeFloat': '关闭面板',
  'dock.dropZone.center': '停靠到中间',
  'dock.dropZone.top': '停靠到上方',
  'dock.dropZone.right': '停靠到右侧',
  'dock.dropZone.bottom': '停靠到下方',
  'dock.dropZone.left': '停靠到左侧',
} satisfies Record<string, string>

/** Workbench dictionary key union. */
export type WorkbenchKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'page.label': 'Debug workbench',
  'panels.label': 'Debug panels',
  'region.files': 'Files',
  'region.editor': 'Editor',
  'region.terminal': 'Terminal',
  'config.picker.label': 'Debug configuration',
  'config.debugCurrentFile': 'Debug current file',
  'config.addConfiguration': 'Add configuration',
  'config.invalid': 'Invalid debug configuration: {message}',
  'stop.announce': 'Stopped: {reason} at {location}',
  'narrow.hint': 'Side panels are collapsed into tabs; open the desktop app for the full layout.',
  'dock.emptyPane': 'No panels open.',
  'dock.splitPane': 'Split pane',
  'dock.splitPaneDisabled': 'No room for another pane',
  'dock.splitPaneNarrow': 'This pane is too narrow to split',
  'dock.closeTab': 'Close panel tab',
  'dock.addTab': 'Add panel',
  'dock.dockFloat': 'Dock panel',
  'dock.closeFloat': 'Close panel',
  'dock.dropZone.center': 'Dock in the middle',
  'dock.dropZone.top': 'Dock above',
  'dock.dropZone.right': 'Dock right',
  'dock.dropZone.bottom': 'Dock below',
  'dock.dropZone.left': 'Dock left',
} satisfies Record<WorkbenchKey, string>

/** Japanese dictionary, checked against the Chinese key set. */
export const ja = {
  'page.label': 'デバッグワークベンチ',
  'panels.label': 'デバッグパネル',
  'region.files': 'ファイル',
  'region.editor': 'エディター',
  'region.terminal': 'ターミナル',
  'config.picker.label': 'デバッグ構成',
  'config.debugCurrentFile': '現在のファイルをデバッグ',
  'config.addConfiguration': '構成を追加',
  'config.invalid': 'デバッグ構成が無効です：{message}',
  'stop.announce': '停止：{reason}、位置 {location}',
  'narrow.hint':
    '側面パネルはタブに折りたたまれています。完全なレイアウトはデスクトップアプリで開けます。',
  'dock.emptyPane': '開いているパネルはありません。',
  'dock.splitPane': 'ペインを分割',
  'dock.splitPaneDisabled': '新しいペインの空きがありません',
  'dock.splitPaneNarrow': 'このペインは分割できる幅ではありません',
  'dock.closeTab': 'パネルタブを閉じる',
  'dock.addTab': 'パネルを追加',
  'dock.dockFloat': 'パネルをドッキング',
  'dock.closeFloat': 'パネルを閉じる',
  'dock.dropZone.center': '中央にドッキング',
  'dock.dropZone.top': '上にドッキング',
  'dock.dropZone.right': '右にドッキング',
  'dock.dropZone.bottom': '下にドッキング',
  'dock.dropZone.left': '左にドッキング',
} satisfies Record<WorkbenchKey, string>

/** Spanish dictionary, checked against the Chinese key set. */
export const es = {
  'page.label': 'Banco de depuración',
  'panels.label': 'Paneles de depuración',
  'region.files': 'Archivos',
  'region.editor': 'Editor',
  'region.terminal': 'Terminal',
  'config.picker.label': 'Configuración de depuración',
  'config.debugCurrentFile': 'Depurar archivo actual',
  'config.addConfiguration': 'Añadir configuración',
  'config.invalid': 'Configuración de depuración no válida: {message}',
  'stop.announce': 'Detenido: {reason} en {location}',
  'narrow.hint':
    'Los paneles laterales están plegados en pestañas; abre la aplicación de escritorio para el diseño completo.',
  'dock.emptyPane': 'No hay paneles abiertos.',
  'dock.splitPane': 'Dividir panel',
  'dock.splitPaneDisabled': 'No hay espacio para otro panel',
  'dock.splitPaneNarrow': 'Este panel es demasiado estrecho para dividirlo',
  'dock.closeTab': 'Cerrar pestaña del panel',
  'dock.addTab': 'Añadir panel',
  'dock.dockFloat': 'Acoplar panel',
  'dock.closeFloat': 'Cerrar panel',
  'dock.dropZone.center': 'Acoplar en el centro',
  'dock.dropZone.top': 'Acoplar arriba',
  'dock.dropZone.right': 'Acoplar a la derecha',
  'dock.dropZone.bottom': 'Acoplar abajo',
  'dock.dropZone.left': 'Acoplar a la izquierda',
} satisfies Record<WorkbenchKey, string>

/** French dictionary, checked against the Chinese key set. */
export const fr = {
  'page.label': 'Atelier de débogage',
  'panels.label': 'Panneaux de débogage',
  'region.files': 'Fichiers',
  'region.editor': 'Éditeur',
  'region.terminal': 'Terminal',
  'config.picker.label': 'Configuration de débogage',
  'config.debugCurrentFile': 'Déboguer le fichier actuel',
  'config.addConfiguration': 'Ajouter une configuration',
  'config.invalid': 'Configuration de débogage invalide : {message}',
  'stop.announce': 'Arrêté : {reason} à {location}',
  'narrow.hint':
    'Les panneaux latéraux sont repliés en onglets ; ouvrez l’application de bureau pour la disposition complète.',
  'dock.emptyPane': 'Aucun panneau ouvert.',
  'dock.splitPane': 'Scinder le panneau',
  'dock.splitPaneDisabled': 'Pas de place pour un autre panneau',
  'dock.splitPaneNarrow': 'Ce panneau est trop étroit pour être scindé',
  'dock.closeTab': 'Fermer l’onglet du panneau',
  'dock.addTab': 'Ajouter un panneau',
  'dock.dockFloat': 'Ancrer le panneau',
  'dock.closeFloat': 'Fermer le panneau',
  'dock.dropZone.center': 'Ancrer au centre',
  'dock.dropZone.top': 'Ancrer en haut',
  'dock.dropZone.right': 'Ancrer à droite',
  'dock.dropZone.bottom': 'Ancrer en bas',
  'dock.dropZone.left': 'Ancrer à gauche',
} satisfies Record<WorkbenchKey, string>

/** German dictionary, checked against the Chinese key set. */
export const de = {
  'page.label': 'Debug-Workbench',
  'panels.label': 'Debug-Panels',
  'region.files': 'Dateien',
  'region.editor': 'Editor',
  'region.terminal': 'Terminal',
  'config.picker.label': 'Debug-Konfiguration',
  'config.debugCurrentFile': 'Aktuelle Datei debuggen',
  'config.addConfiguration': 'Konfiguration hinzufügen',
  'config.invalid': 'Ungültige Debug-Konfiguration: {message}',
  'stop.announce': 'Angehalten: {reason} bei {location}',
  'narrow.hint': 'Seitenpanels sind zu Registerkarten eingeklappt; öffne die Desktop-App für das vollständige Layout.',
  'dock.emptyPane': 'Keine Panels geöffnet.',
  'dock.splitPane': 'Panel teilen',
  'dock.splitPaneDisabled': 'Kein Platz für ein weiteres Panel',
  'dock.splitPaneNarrow': 'Dieses Panel ist zum Teilen zu schmal',
  'dock.closeTab': 'Panel-Registerkarte schließen',
  'dock.addTab': 'Panel hinzufügen',
  'dock.dockFloat': 'Panel andocken',
  'dock.closeFloat': 'Panel schließen',
  'dock.dropZone.center': 'Mitte andocken',
  'dock.dropZone.top': 'Oben andocken',
  'dock.dropZone.right': 'Rechts andocken',
  'dock.dropZone.bottom': 'Unten andocken',
  'dock.dropZone.left': 'Links andocken',
} satisfies Record<WorkbenchKey, string>

/** Russian dictionary, checked against the Chinese key set. */
export const ru = {
  'page.label': 'Рабочий стол отладки',
  'panels.label': 'Панели отладки',
  'region.files': 'Файлы',
  'region.editor': 'Редактор',
  'region.terminal': 'Терминал',
  'config.picker.label': 'Конфигурация отладки',
  'config.debugCurrentFile': 'Отладить текущий файл',
  'config.addConfiguration': 'Добавить конфигурацию',
  'config.invalid': 'Недопустимая конфигурация отладки: {message}',
  'stop.announce': 'Остановлено: {reason}, позиция {location}',
  'narrow.hint':
    'Боковые панели свернуты во вкладки; откройте настольное приложение для полной компоновки.',
  'dock.emptyPane': 'Нет открытых панелей.',
  'dock.splitPane': 'Разделить панель',
  'dock.splitPaneDisabled': 'Нет места для ещё одной панели',
  'dock.splitPaneNarrow': 'Эта панель слишком узка для разделения',
  'dock.closeTab': 'Закрыть вкладку панели',
  'dock.addTab': 'Добавить панель',
  'dock.dockFloat': 'Прикрепить панель',
  'dock.closeFloat': 'Закрыть панель',
  'dock.dropZone.center': 'Прикрепить в центр',
  'dock.dropZone.top': 'Прикрепить сверху',
  'dock.dropZone.right': 'Прикрепить справа',
  'dock.dropZone.bottom': 'Прикрепить снизу',
  'dock.dropZone.left': 'Прикрепить слева',
} satisfies Record<WorkbenchKey, string>

/** Portuguese dictionary, checked against the Chinese key set. */
export const pt = {
  'page.label': 'Bancada de depuração',
  'panels.label': 'Painéis de depuração',
  'region.files': 'Arquivos',
  'region.editor': 'Editor',
  'region.terminal': 'Terminal',
  'config.picker.label': 'Configuração de depuração',
  'config.debugCurrentFile': 'Depurar arquivo atual',
  'config.addConfiguration': 'Adicionar configuração',
  'config.invalid': 'Configuração de depuração inválida: {message}',
  'stop.announce': 'Parado: {reason} em {location}',
  'narrow.hint': 'Os painéis laterais estão recolhidos em guias; abra o aplicativo de desktop para o layout completo.',
  'dock.emptyPane': 'Nenhum painel aberto.',
  'dock.splitPane': 'Dividir painel',
  'dock.splitPaneDisabled': 'Sem espaço para outro painel',
  'dock.splitPaneNarrow': 'Este painel é estreito demais para dividir',
  'dock.closeTab': 'Fechar guia do painel',
  'dock.addTab': 'Adicionar painel',
  'dock.dockFloat': 'Ancorar painel',
  'dock.closeFloat': 'Fechar painel',
  'dock.dropZone.center': 'Ancorar no centro',
  'dock.dropZone.top': 'Ancorar acima',
  'dock.dropZone.right': 'Ancorar à direita',
  'dock.dropZone.bottom': 'Ancorar abaixo',
  'dock.dropZone.left': 'Ancorar à esquerda',
} satisfies Record<WorkbenchKey, string>
