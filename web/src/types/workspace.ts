import type { DocumentIdentity, StorageKind } from '@guitardsl/document';
import type { PwaUpdateSnapshot } from '../pwa/registerPwa';

export type WorkspaceViewMode = 'source' | 'split' | 'score';
export type WorkspaceLocale = 'en' | 'ja';
export type WorkspaceTheme = 'system' | 'light' | 'dark';

export interface WorkspaceTabSnapshot {
  key: string;
  identity: Readonly<DocumentIdentity>;
  accountId?: string;
  name: string;
  source: string;
  revision: number;
  saveStatus: 'local-saved' | 'drive-saved' | 'saving' | 'draft' | 'error';
}

export interface WorkspaceFileSnapshot {
  identity: Readonly<DocumentIdentity>;
  accountId?: string;
  name: string;
  revision: number;
  selected: boolean;
  updatedAt?: number;
  localDraft?: boolean;
}

export interface WorkspaceDiagnosticSnapshot {
  severity: 'error' | 'warning' | 'info';
  message: string;
  file: string;
  line: number;
  column: number;
  from: number;
  to: number;
}

export interface WorkspaceMenuItemSnapshot {
  id: string;
  label?: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
}

export interface WorkspaceMenuSnapshot {
  id: string;
  label: string;
  items: readonly WorkspaceMenuItemSnapshot[];
  invokerId?: string;
  position?: { left: number; top: number };
}

export interface WorkspaceContextMenuRequest {
  target: HTMLElement;
  clientX: number;
  clientY: number;
  keyboard: boolean;
}

export interface WorkspaceViewSnapshot {
  ready: boolean;
  tabs: readonly WorkspaceTabSnapshot[];
  activeKey: string | null;
  activeStorage: StorageKind;
  locale: WorkspaceLocale;
  theme: WorkspaceTheme;
  viewMode: WorkspaceViewMode;
  explorerOpen: boolean;
  inspectorOpen: boolean;
  problemsOpen: boolean;
  explorerAutoHidden: boolean;
  inspectorAutoHidden: boolean;
  localExpanded: boolean;
  driveExpanded: boolean;
  explorerWidth: number;
  inspectorWidth: number;
  problemsHeight: number;
  splitRatio: number;
  localFiles: readonly WorkspaceFileSnapshot[];
  driveFiles: readonly WorkspaceFileSnapshot[];
  diagnostics: readonly WorkspaceDiagnosticSnapshot[];
  menu?: Readonly<WorkspaceMenuSnapshot>;
  online: boolean;
  driveStatus: 'connected' | 'connecting' | 'reauth' | 'offline' | 'disconnected';
  driveGeneration: number;
  driveAccountLabel?: string;
  driveFolderName?: string;
  driveFolderId?: string;
  driveScopeNote?: string;
  driveOverwriteWarning?: string;
  storageStatus?: string;
  cursorPosition?: string;
  previewStatus?: string;
  driveBusy: boolean;
  saveDisabled: boolean;
  pwa: Readonly<PwaUpdateSnapshot>;
  message?: { text: string; kind: 'info' | 'error' };
}

export type WorkspaceCommand =
  | { type: 'lifecycle.pagehide'; persisted: boolean }
  | { type: 'lifecycle.pageshow'; persisted: boolean }
  | { type: 'document.create' }
  | { type: 'document.open-local'; identity: Readonly<DocumentIdentity> }
  | { type: 'document.open-drive'; identity: Readonly<DocumentIdentity>; accountId: string; driveGeneration: number }
  | { type: 'document.activate'; key: string }
  | { type: 'document.close'; key: string }
  | { type: 'document.save' }
  | { type: 'document.export-pdf' }
  | { type: 'document.import-local' }
  | { type: 'storage.set-active'; storage: StorageKind }
  | { type: 'view.set-mode'; mode: WorkspaceViewMode }
  | { type: 'panel.toggle'; panel: 'explorer' | 'inspector' | 'problems' }
  | { type: 'panel.set-open'; panel: 'explorer' | 'inspector' | 'problems'; open: boolean }
  | { type: 'layout.reset' }
  | { type: 'drive.connect' }
  | { type: 'drive.open-picker' }
  | { type: 'drive.choose-folder' }
  | { type: 'drive.create-folder' }
  | { type: 'settings.set-locale'; locale: WorkspaceLocale }
  | { type: 'settings.set-theme'; theme: WorkspaceTheme }
  | { type: 'pwa.update' }
  | { type: 'pwa.later' }
  | { type: 'menu.open'; menu: 'file' | 'edit' | 'view' | 'drive' | 'drive-root' | 'settings' | 'explorer' | 'inspector' }
  | { type: 'menu.close' }
  | { type: 'menu.activate'; itemId: string }
  | { type: 'help.open' }
  | { type: 'diagnostic.activate'; index: number }
  | { type: 'message.dismiss' }
  | { type: 'explorer.toggle-expanded'; storage: 'local' | 'drive' }
  | { type: 'splitter.event'; splitter: 'explorer' | 'center' | 'inspector' | 'problems'; phase: 'start' | 'move' | 'end' | 'cancel' | 'reset' | 'keyboard'; pointerId?: number; clientX?: number; clientY?: number; key?: string; shiftKey?: boolean };

export interface WebWorkspaceController {
  snapshot(): Readonly<WorkspaceViewSnapshot>;
  subscribe(callback: (snapshot: Readonly<WorkspaceViewSnapshot>) => void): () => void;
  dispatch(command: WorkspaceCommand): void | Promise<void>;
  start(): Promise<void>;
  prepareForReload(): Promise<{ ok: true } | { ok: false; reason: string }>;
  dispose(): void;
}

export interface WorkspaceHostBindings {
  mountSourceEditor(container: HTMLElement): void;
  mountScoreFrame(frame: HTMLIFrameElement): void;
  mountInspectorHosts(hosts: { content: HTMLElement; tabs: HTMLElement; settings: HTMLElement; settingsLabels: HTMLElement }): void;
  requestContextMenu(request: WorkspaceContextMenuRequest): void;
}
