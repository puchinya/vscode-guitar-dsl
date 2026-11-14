import type { DocumentIdentity, StorageKind } from '@guitardsl/document';
import type { DriveFile, GoogleDriveApi } from '../storage/googleDrive';
import type { StoredDocument } from '../storage/indexedDb';
import { createWebIcon } from '../icons';

export interface ExplorerLabels {
  files: string;
  project: string;
  local: string;
  drive: string;
  folder: string;
  connectInline: string;
  connectDrive: string;
  reconnectDrive: string;
  connecting: string;
  chooseFolder: string;
  createFolder: string;
  openDrive: string;
  createFirst: string;
  connectHint: string;
  noFolder: string;
  driveAccess: string;
  driveOverwriteWarning: string;
  driveAuthStatus: string;
  loading: string;
  expand: string;
  collapse: string;
}

export interface ExplorerSnapshot {
  storage: StorageKind;
  locale: string;
  account?: { accountId: string; emailAddress?: string };
  drive?: Pick<GoogleDriveApi, 'listFiles'>;
  folderId?: string;
  folderName?: string;
  activeDocument?: { identity: DocumentIdentity; accountId?: string };
  authExpired?: boolean;
  connecting?: boolean;
}

export interface ExplorerDependencies {
  root: HTMLElement;
  getSnapshot(): ExplorerSnapshot;
  getLabels(): ExplorerLabels;
  listLocalDocuments(): Promise<StoredDocument[]>;
  getLocalDocument(identity: DocumentIdentity): Promise<StoredDocument | undefined>;
  onStorageChange(storage: StorageKind): void;
  onNewScore(): void;
  onConnectDrive(): void;
  onChooseFolder(): void;
  onCreateFolder(): void;
  onOpenDrivePicker(): void;
  onOpenLocal(identity: DocumentIdentity): void;
  onOpenDrive(file: DriveFile): void;
  onLocalError(error: unknown): void;
  onDriveError(error: unknown): void;
}

export class ExplorerController {
  private renderGeneration = 0;
  private readonly fileActions: HTMLElement;
  private readonly fileItems: HTMLElement;
  private readonly driveActions: HTMLElement;
  private readonly driveItems: HTMLElement;
  private readonly driveScopeNote: HTMLElement;
  private readonly driveOverwriteNote: HTMLElement;
  private readonly driveStatus: HTMLElement;
  private readonly driveConnect: HTMLButtonElement;
  private localExpanded = true;
  private driveExpanded = true;

  constructor(private readonly dependencies: ExplorerDependencies) {
    const { root, onStorageChange } = dependencies;
    this.fileActions = root.querySelector<HTMLElement>('#file-actions')!;
    this.fileItems = root.querySelector<HTMLElement>('#file-items')!;
    this.driveActions = root.querySelector<HTMLElement>('#drive-file-actions')!;
    this.driveItems = root.querySelector<HTMLElement>('#drive-file-items')!;
    this.driveScopeNote = root.querySelector<HTMLElement>('#drive-scope-note')!;
    this.driveOverwriteNote = root.querySelector<HTMLElement>('#drive-overwrite-note')!;
    this.driveStatus = root.querySelector<HTMLElement>('#drive-status')!;
    this.driveConnect = root.querySelector<HTMLButtonElement>('#drive-connect-inline')!;
    this.driveConnect.addEventListener('click', () => this.dependencies.onConnectDrive());
    root.querySelector<HTMLButtonElement>('#storage-local')!.addEventListener('click', () => onStorageChange('local'));
    root.querySelector<HTMLButtonElement>('#storage-drive')!.addEventListener('click', () => onStorageChange('drive'));
    root.querySelector<HTMLButtonElement>('[data-storage-expander="local"]')!.addEventListener('click', event => {
      this.localExpanded = !this.localExpanded;
      this.setExpanded(event.currentTarget as HTMLButtonElement, 'local-storage-content', this.localExpanded);
    });
    root.querySelector<HTMLButtonElement>('[data-storage-expander="drive"]')!.addEventListener('click', event => {
      this.driveExpanded = !this.driveExpanded;
      this.setExpanded(event.currentTarget as HTMLButtonElement, 'drive-storage-content', this.driveExpanded);
    });
  }

  render(): Promise<void> {
    const generation = ++this.renderGeneration;
    const state = this.dependencies.getSnapshot();
    const labels = this.dependencies.getLabels();
    const localButton = this.dependencies.root.querySelector<HTMLButtonElement>('#storage-local')!;
    const driveButton = this.dependencies.root.querySelector<HTMLButtonElement>('#storage-drive')!;
    localButton.textContent = labels.local;
    driveButton.textContent = labels.drive;
    this.dependencies.root.querySelector('#files-heading')!.textContent = labels.project;
    localButton.removeAttribute('aria-pressed');
    driveButton.removeAttribute('aria-pressed');
    this.dependencies.root.querySelector<HTMLElement>('#local-storage-content')!.hidden = !this.localExpanded;
    this.dependencies.root.querySelector<HTMLElement>('#drive-storage-content')!.hidden = !this.driveExpanded;
    const localExpander = this.dependencies.root.querySelector<HTMLButtonElement>('[data-storage-expander="local"]')!;
    localExpander.setAttribute('aria-expanded', String(this.localExpanded));
    localExpander.setAttribute('aria-label', `${this.localExpanded ? labels.collapse : labels.expand} ${labels.local}`);
    localExpander.replaceChildren(createWebIcon(this.localExpanded ? 'down' : 'right'));
    const driveExpander = this.dependencies.root.querySelector<HTMLButtonElement>('[data-storage-expander="drive"]')!;
    driveExpander.setAttribute('aria-expanded', String(this.driveExpanded));
    driveExpander.setAttribute('aria-label', `${this.driveExpanded ? labels.collapse : labels.expand} ${labels.drive}`);
    driveExpander.replaceChildren(createWebIcon(this.driveExpanded ? 'down' : 'right'));
    this.driveScopeNote.hidden = true;
    this.driveScopeNote.textContent = labels.driveAccess;
    this.driveOverwriteNote.hidden = true;
    this.driveOverwriteNote.textContent = labels.driveOverwriteWarning;
    this.fileActions.replaceChildren();
    this.fileItems.replaceChildren();
    this.driveActions.replaceChildren();
    this.driveItems.replaceChildren();

    const connected = Boolean(state.account && state.drive && !state.authExpired);
    this.driveStatus.hidden = !connected;
    this.driveStatus.title = connected ? `${labels.drive} ${state.account?.emailAddress ?? state.account?.accountId}` : '';
    this.driveStatus.setAttribute('aria-label', this.driveStatus.title);
    this.driveConnect.hidden = connected;
    this.driveConnect.disabled = Boolean(state.connecting);
    const connectLabel = state.connecting ? labels.connecting : state.authExpired ? labels.reconnectDrive : labels.connectInline;
    this.driveConnect.replaceChildren(createWebIcon('cloud'), document.createTextNode(connectLabel));
    this.driveConnect.title = state.authExpired ? labels.driveAuthStatus : connectLabel;
    this.driveConnect.setAttribute('aria-label', connectLabel);

    const localRender = this.localExpanded
      ? this.renderLocalFiles(generation, state, labels) : Promise.resolve();

    if (!state.account || !state.drive || state.authExpired) {
      return localRender;
    }

    if (!this.driveExpanded) return localRender;
    if (!state.folderId) {
      this.appendHint(this.driveItems, labels.noFolder);
      return localRender;
    }
    this.appendHint(this.driveItems, labels.loading);
    return Promise.all([
      localRender,
      this.renderDriveFiles(generation, state, labels)
    ]).then(() => undefined);
  }

  private async renderLocalFiles(generation: number, state: ExplorerSnapshot, labels: ExplorerLabels): Promise<void> {
    try {
      const documents = await this.dependencies.listLocalDocuments();
      if (!this.isCurrent(generation, 'local')) return;
      if (documents.length === 0) { this.appendHint(this.fileItems, labels.createFirst); return; }
      for (const documentRow of documents) {
        const current = await this.dependencies.getLocalDocument(documentRow.identity);
        if (!this.isCurrent(generation, 'local')) return;
        this.appendFileRow(current ?? documentRow, state, () => this.dependencies.onOpenLocal(documentRow.identity));
      }
    } catch (error) {
      if (!this.isCurrent(generation, 'local')) return;
      this.fileItems.textContent = error instanceof Error ? error.message : 'Local storage is unavailable.';
      this.dependencies.onLocalError(error);
    }
  }

  private async renderDriveFiles(generation: number, state: ExplorerSnapshot, labels: ExplorerLabels): Promise<void> {
    try {
      const files = await state.drive!.listFiles(state.folderId!);
      if (!this.isCurrent(generation, 'drive')) return;
      this.driveItems.replaceChildren();
      this.appendFolderRow(state.folderName || labels.folder);
      if (files.length === 0) this.appendHint(this.driveItems, labels.createFirst);
      for (const file of files) this.appendDriveFile(file, state);
    } catch (error) {
      if (!this.isCurrent(generation, 'drive')) return;
      this.driveItems.replaceChildren();
      this.appendFolderRow(state.folderName || labels.folder);
      this.appendHint(this.driveItems, error instanceof Error ? error.message : 'Google Drive is unavailable.');
      this.dependencies.onDriveError(error);
    }
  }

  private isCurrent(generation: number, storage: StorageKind): boolean {
    const current = this.dependencies.getSnapshot();
    return generation === this.renderGeneration && (storage === 'local' || Boolean(current.account && current.drive));
  }

  private appendHint(container: HTMLElement, text: string): void {
    const hint = document.createElement('div');
    hint.className = 'empty-state';
    hint.textContent = text;
    container.append(hint);
  }

  private setExpanded(button: HTMLButtonElement, contentId: string, expanded: boolean): void {
    button.setAttribute('aria-expanded', String(expanded));
    const labels = this.dependencies.getLabels();
    const rootLabel = button.dataset.storageExpander === 'local' ? labels.local : labels.drive;
    button.setAttribute('aria-label', `${expanded ? labels.collapse : labels.expand} ${rootLabel}`);
    button.replaceChildren(createWebIcon(expanded ? 'down' : 'right'));
    this.dependencies.root.querySelector<HTMLElement>('#' + contentId)!.hidden = !expanded;
    void this.render();
  }

  private appendFileRow(documentRow: StoredDocument, state: ExplorerSnapshot, onOpen: () => void): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file-item';
    button.append(createWebIcon('file'));
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = documentRow.name;
    button.append(name);
    button.dataset.storage = 'local';
    button.dataset.fileId = documentRow.identity.fileId;
    button.dataset.revision = String(documentRow.revision);
    const updatedAt = documentRow.updatedAt ? new Date(documentRow.updatedAt).toLocaleString(state.locale) : '';
    if (updatedAt) button.title = updatedAt;
    const selected = state.activeDocument?.identity.storage === 'local'
      && state.activeDocument.identity.fileId === documentRow.identity.fileId;
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
    button.addEventListener('click', onOpen);
    this.fileItems.append(button);
  }

  private appendFolderRow(name: string): void {
    const folder = document.createElement('div');
    folder.className = 'drive-folder-row';
    folder.append(createWebIcon('folder'));
    const label = document.createElement('span');
    label.textContent = name;
    folder.append(label);
    this.driveItems.append(folder);
  }

  private appendDriveFile(file: DriveFile, state: ExplorerSnapshot): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file-item';
    button.append(createWebIcon('file'));
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = file.name;
    button.append(name);
    button.dataset.storage = 'drive';
    button.dataset.fileId = file.id;
    if (state.account?.accountId) button.dataset.accountId = state.account.accountId;
    if (file.modifiedTime) button.title = new Date(file.modifiedTime).toLocaleString(state.locale);
    const selected = state.activeDocument?.identity.storage === 'drive'
      && state.activeDocument.identity.fileId === file.id
      && state.activeDocument.accountId === state.account?.accountId;
    if (selected) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => this.dependencies.onOpenDrive(file));
    this.driveItems.append(button);
  }
}
