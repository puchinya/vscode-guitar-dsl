import type { DocumentIdentity, StorageKind } from '@guitardsl/document';
import type { DriveFile, GoogleDriveApi } from '../storage/googleDrive';
import type { StoredDocument } from '../storage/indexedDb';
import { createWebIcon } from '../icons';

export interface ExplorerLabels {
  files: string;
  local: string;
  drive: string;
  newScore: string;
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
  loading: string;
  expand: string;
  collapse: string;
}

export interface ExplorerSnapshot {
  storage: StorageKind;
  locale: string;
  account?: { accountId: string };
  drive?: Pick<GoogleDriveApi, 'listFiles'>;
  folderId?: string;
  activeDocumentStorage?: StorageKind;
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
    this.dependencies.root.querySelector('#files-heading')!.textContent = labels.files;
    localButton.classList.toggle('selected', state.storage === 'local');
    driveButton.classList.toggle('selected', state.storage === 'drive');
    localButton.setAttribute('aria-pressed', String(state.storage === 'local'));
    driveButton.setAttribute('aria-pressed', String(state.storage === 'drive'));
    this.dependencies.root.querySelector<HTMLElement>('#local-storage-content')!.hidden = !this.localExpanded;
    this.dependencies.root.querySelector<HTMLElement>('#drive-storage-content')!.hidden = !this.driveExpanded;
    const localExpander = this.dependencies.root.querySelector<HTMLButtonElement>('[data-storage-expander="local"]')!;
    localExpander.setAttribute('aria-expanded', String(this.localExpanded));
    localExpander.setAttribute('aria-label', `${this.localExpanded ? labels.collapse : labels.expand} ${labels.local}`);
    const driveExpander = this.dependencies.root.querySelector<HTMLButtonElement>('[data-storage-expander="drive"]')!;
    driveExpander.setAttribute('aria-expanded', String(this.driveExpanded));
    driveExpander.setAttribute('aria-label', `${this.driveExpanded ? labels.collapse : labels.expand} ${labels.drive}`);
    this.driveScopeNote.hidden = !state.account;
    this.driveScopeNote.textContent = labels.driveAccess;
    this.driveOverwriteNote.hidden = !state.account;
    this.driveOverwriteNote.textContent = labels.driveOverwriteWarning;
    this.fileActions.replaceChildren();
    this.fileItems.replaceChildren();
    this.driveActions.replaceChildren();
    this.driveItems.replaceChildren();

    const localRender = this.localExpanded
      ? this.renderLocalFiles(generation, state.locale, labels) : Promise.resolve();
    if (this.localExpanded) {
      this.fileActions.append(this.actionButton(labels.newScore, () => this.dependencies.onNewScore(), 'fileplus'));
    }

    if (!state.account || !state.drive || state.authExpired) {
      if (this.driveExpanded) {
        const label = state.connecting ? labels.connecting : state.authExpired ? labels.reconnectDrive : labels.connectDrive;
        const connect = this.actionButton(label, () => this.dependencies.onConnectDrive(), 'cloud');
        connect.disabled = Boolean(state.connecting);
        this.driveActions.append(connect);
        this.appendHint(this.driveItems, labels.connectHint);
      }
      return localRender;
    }

    if (!this.driveExpanded) return localRender;
    this.driveActions.append(
      this.actionButton(labels.chooseFolder, () => this.dependencies.onChooseFolder()),
      this.actionButton(labels.createFolder, () => this.dependencies.onCreateFolder()),
      this.actionButton(labels.openDrive, () => this.dependencies.onOpenDrivePicker())
    );
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

  private async renderLocalFiles(generation: number, locale: string, labels: ExplorerLabels): Promise<void> {
    try {
      const documents = await this.dependencies.listLocalDocuments();
      if (!this.isCurrent(generation, 'local')) return;
      if (documents.length === 0) { this.appendHint(this.fileItems, labels.createFirst); return; }
      for (const documentRow of documents) {
        const current = await this.dependencies.getLocalDocument(documentRow.identity);
        if (!this.isCurrent(generation, 'local')) return;
        this.appendFileRow(current ?? documentRow, locale, () => this.dependencies.onOpenLocal(documentRow.identity));
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
      if (files.length === 0) this.appendHint(this.driveItems, labels.createFirst);
      for (const file of files) this.appendDriveFile(file, state.locale, state.account?.accountId);
    } catch (error) {
      if (!this.isCurrent(generation, 'drive')) return;
      this.driveItems.replaceChildren();
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
    this.dependencies.root.querySelector<HTMLElement>('#' + contentId)!.hidden = !expanded;
    void this.render();
  }

  private actionButton(label: string, callback: () => void, iconName?: 'fileplus' | 'cloud'): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quiet-button file-action';
    if (iconName) button.append(createWebIcon(iconName));
    const text = document.createElement('span');
    text.textContent = label;
    button.append(text);
    button.addEventListener('click', callback);
    return button;
  }

  private appendFileRow(documentRow: StoredDocument, locale: string, onOpen: () => void): void {
    const wrapper = document.createElement('div');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file-item';
    button.textContent = documentRow.name;
    button.dataset.storage = 'local';
    button.dataset.fileId = documentRow.identity.fileId;
    button.dataset.revision = String(documentRow.revision);
    button.addEventListener('click', onOpen);
    const subtitle = document.createElement('span');
    subtitle.className = 'file-subtitle';
    subtitle.textContent = documentRow.updatedAt ? new Date(documentRow.updatedAt).toLocaleDateString(locale) : '';
    wrapper.append(button, subtitle);
    this.fileItems.append(wrapper);
  }

  private appendDriveFile(file: DriveFile, locale: string, accountId?: string): void {
    const wrapper = document.createElement('div');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file-item';
    button.textContent = file.name;
    button.dataset.storage = 'drive';
    button.dataset.fileId = file.id;
    if (accountId) button.dataset.accountId = accountId;
    button.addEventListener('click', () => this.dependencies.onOpenDrive(file));
    const subtitle = document.createElement('span');
    subtitle.className = 'file-subtitle';
    subtitle.textContent = new Date(file.modifiedTime).toLocaleString(locale);
    wrapper.append(button, subtitle);
    this.driveItems.append(wrapper);
  }
}
