// GuitarDSL sidebar: a Tree View for document-independent navigation and active-document actions.
// The target row is informational; command wrappers resolve the active document when invoked.
import * as vscode from 'vscode';
import { Messages } from './i18n';

export const SIDEBAR_VIEW_ID = 'guitardsl.sidebar';

export type SidebarSectionId = 'create' | 'openImport' | 'editAssist' | 'export' | 'help';

export type GuitarDslSidebarItem =
  | { kind: 'target'; label: string }
  | { kind: 'section'; section: SidebarSectionId; label: string }
  | { kind: 'command'; section: SidebarSectionId; label: string; command: string; icon: string };

const SECTIONS: readonly SidebarSectionId[] = ['create', 'openImport', 'editAssist', 'export', 'help'];

export class GuitarDslSidebarProvider implements vscode.TreeDataProvider<GuitarDslSidebarItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<GuitarDslSidebarItem | undefined | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  /** Returns the active editor's document only when it is a GuitarDSL document. */
  constructor(
    private readonly msgs: Messages,
    private readonly activeGuitarDslDocument: () => vscode.TextDocument | undefined
  ) {}

  refresh(): void {
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  getChildren(element?: GuitarDslSidebarItem): GuitarDslSidebarItem[] {
    if (!element) {
      const doc = this.activeGuitarDslDocument();
      const fileName = doc
        ? doc.uri.scheme === 'untitled'
          ? this.msgs.sidebarUntitledTarget
          : (doc.uri.path || doc.fileName).split(/[\\/]/).pop()
        : undefined;
      const target = fileName
        ? `${this.msgs.sidebarTargetPrefix} ${fileName}`
        : `${this.msgs.sidebarTargetPrefix} ${this.msgs.sidebarNoActiveTarget}`;
      return [
        { kind: 'target', label: target },
        ...SECTIONS.map(section => ({ kind: 'section' as const, section, label: this.sectionLabel(section) }))
      ];
    }
    if (element.kind !== 'section') {
      return [];
    }

    const m = this.msgs;
    const cmd = (label: string, command: string, icon: string): GuitarDslSidebarItem =>
      ({ kind: 'command', section: element.section, label, command, icon });
    switch (element.section) {
      case 'create':
        return [
          cmd(m.sidebarNewFromTemplate, 'guitardsl.newDocumentFromTemplate', 'new-file'),
          cmd(m.sidebarOpenSample, 'guitardsl.openSample', 'files')
        ];
      case 'openImport':
        return [
          cmd(m.sidebarOpenGuitarDslFile, 'guitardsl.navigation.openGuitarDslFile', 'folder-opened'),
          cmd(m.sidebarImportGuitarPro, 'guitardsl.importGuitarPro', 'music'),
          cmd(m.sidebarChooseTranscriptionSource, 'guitardsl.navigation.chooseTranscriptionSource', 'play-circle')
        ];
      case 'editAssist':
        return [
          cmd(m.sidebarOpenPreview, 'guitardsl.navigation.showPreviewActive', 'open-preview'),
          cmd(m.sidebarOpenInspector, 'guitardsl.openInspector', 'search')
        ];
      case 'export':
        return [
          cmd(m.sidebarExportPdf, 'guitardsl.navigation.exportPdfActive', 'file-pdf'),
          cmd(m.sidebarExportGuitarPro, 'guitardsl.navigation.exportGuitarProActive', 'music')
        ];
      case 'help':
        return [cmd(m.sidebarOpenGuitarDslHelp, 'guitardsl.openHelp', 'question')];
    }
  }

  getTreeItem(element: GuitarDslSidebarItem): vscode.TreeItem {
    const { TreeItemCollapsibleState: State } = vscode;
    if (element.kind === 'section') {
      const initiallyExpanded = element.section === 'create' || element.section === 'openImport';
      const item = new vscode.TreeItem(element.label, initiallyExpanded ? State.Expanded : State.Collapsed);
      item.id = `section:${element.section}`;
      return item;
    }

    const item = new vscode.TreeItem(element.label, State.None);
    item.tooltip = element.label;
    if (element.kind === 'target') {
      item.id = 'target';
      return item;
    }

    item.id = `${element.section}:${element.command}`;
    item.iconPath = new vscode.ThemeIcon(element.icon);
    item.command = { command: element.command, title: element.label, arguments: [] };
    return item;
  }

  private sectionLabel(section: SidebarSectionId): string {
    switch (section) {
      case 'create': return this.msgs.sidebarCreate;
      case 'openImport': return this.msgs.sidebarOpenImport;
      case 'editAssist': return this.msgs.sidebarEditAssist;
      case 'export': return this.msgs.sidebarExport;
      case 'help': return this.msgs.sidebarHelp;
    }
  }
}

/** Registers the provider for the `guitardsl.sidebar` view. Push both returned disposables. */
export function registerGuitarDslSidebar(
  msgs: Messages,
  activeGuitarDslDocument: () => vscode.TextDocument | undefined
): { provider: GuitarDslSidebarProvider; disposables: vscode.Disposable[] } {
  const provider = new GuitarDslSidebarProvider(msgs, activeGuitarDslDocument);
  return { provider, disposables: [provider, vscode.window.registerTreeDataProvider(SIDEBAR_VIEW_ID, provider)] };
}
