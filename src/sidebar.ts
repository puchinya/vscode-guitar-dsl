// GuitarDSL sidebar: the Activity Bar "Start Here" Tree View (onboarding and navigation only, not an editor).
// Every leaf runs an extension command by ID; `Current File` follows the active editor only.
// Command IDs are literals so the view does not load the command modules.
import * as vscode from 'vscode';
import { Messages } from './i18n';

export const SIDEBAR_VIEW_ID = 'guitardsl.sidebar';

export type SidebarSectionId = 'getStarted' | 'currentFile' | 'tools';

export type GuitarDslSidebarItem =
  | { kind: 'section'; section: SidebarSectionId; label: string }
  | { kind: 'command'; section: SidebarSectionId; label: string; command: string; args: unknown[]; icon: string }
  | { kind: 'hint'; section: SidebarSectionId; label: string };

const SECTIONS: readonly SidebarSectionId[] = ['getStarted', 'currentFile', 'tools'];

export class GuitarDslSidebarProvider implements vscode.TreeDataProvider<GuitarDslSidebarItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<GuitarDslSidebarItem | undefined | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  /** `activeGuitarDslDocument` returns the active editor's document only when it is a GuitarDSL document. */
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
      return SECTIONS.map(section => ({ kind: 'section', section, label: this.sectionLabel(section) }));
    }
    if (element.kind !== 'section') {
      return [];
    }
    const m = this.msgs;
    const cmd = (label: string, command: string, icon: string, args: unknown[] = []): GuitarDslSidebarItem =>
      ({ kind: 'command', section: element.section, label, command, args, icon });
    switch (element.section) {
      case 'getStarted':
        return [
          cmd(m.sidebarNewFromTemplate, 'guitardsl.newDocumentFromTemplate', 'new-file'),
          cmd(m.sidebarOpenSample, 'guitardsl.openSample', 'files'),
          cmd(m.sidebarOpenPreview, 'guitardsl.showPreview', 'open-preview'),
          cmd(m.sidebarOpenHelp, 'guitardsl.openHelp', 'question')
        ];
      case 'currentFile': {
        const doc = this.activeGuitarDslDocument();
        if (!doc) {
          return [{ kind: 'hint', section: 'currentFile', label: m.sidebarNoActiveFile }];
        }
        const target = [doc.uri];
        return [
          cmd(m.sidebarOpenPreview, 'guitardsl.showPreview', 'open-preview', target),
          cmd(m.sidebarEditChordDiagram, 'guitardsl.editChordDiagram', 'edit', target),
          cmd(m.sidebarEditScoreSettings, 'guitardsl.editScoreSettings', 'settings-gear', target),
          cmd(m.sidebarEditCapo, 'guitardsl.editCapo', 'symbol-ruler', target),
          cmd(m.sidebarChangeAccompaniment, 'guitardsl.applyStrummingPattern', 'pulse', target),
          cmd(m.sidebarExportPdf, 'guitardsl.exportPdf', 'file-pdf', target)
        ];
      }
      case 'tools':
        return [
          cmd(m.sidebarTranscribeYouTube, 'guitardsl.transcribeYouTube', 'play-circle'),
          cmd(m.sidebarTranscribeAudio, 'guitardsl.transcribeAudio', 'unmute')
        ];
    }
  }

  getTreeItem(element: GuitarDslSidebarItem): vscode.TreeItem {
    const { TreeItemCollapsibleState: State } = vscode;
    if (element.kind === 'section') {
      const item = new vscode.TreeItem(
        element.label,
        element.section === 'tools' ? State.Collapsed : State.Expanded
      );
      item.id = `section:${element.section}`;
      return item;
    }
    const item = new vscode.TreeItem(element.label, State.None);
    item.tooltip = element.label;
    if (element.kind === 'hint') {
      item.id = `${element.section}:hint`;
      item.iconPath = new vscode.ThemeIcon('info');
      return item;
    }
    item.id = `${element.section}:${element.command}`;
    item.iconPath = new vscode.ThemeIcon(element.icon);
    item.command = { command: element.command, title: element.label, arguments: element.args };
    return item;
  }

  private sectionLabel(section: SidebarSectionId): string {
    switch (section) {
      case 'getStarted': return this.msgs.sidebarGetStarted;
      case 'currentFile': return this.msgs.sidebarCurrentFile;
      case 'tools': return this.msgs.sidebarTools;
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
