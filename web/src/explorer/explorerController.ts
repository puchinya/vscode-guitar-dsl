import type { DocumentIdentity, StorageKind } from '@guitardsl/document';
import type { DriveFile, GoogleDriveApi } from '../storage/googleDrive';
import type { StoredDocument } from '../storage/indexedDb';

export interface ExplorerLabels {
  files: string;
  local: string;
  drive: string;
  addFile: string;
  chooseFolder: string;
  createFolder: string;
  openDrive: string;
  createFirst: string;
  connectHint: string;
  noFolder: string;
  driveAccess: string;
  loading: string;
}

export interface ExplorerSnapshot {
  storage: StorageKind;
  locale: string;
  account?: { accountId: string };
  drive?: Pick<GoogleDriveApi, 'listFiles'>;
  folderId?: string;
  activeDocumentStorage?: StorageKind;
}

export interface ExplorerDependencies {
  root: HTMLElement;
  getSnapshot(): ExplorerSnapshot;
  getLabels(): ExplorerLabels;
  listLocalDocuments(): Promise<StoredDocument[]>;
  getLocalDocument(identity: DocumentIdentity): Promise<StoredDocument | undefined>;
  onStorageChange(storage: StorageKind): void;
  onImport(): void;
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
  private readonly driveScopeNote: HTMLElement;
  private readonly moveButton: HTMLButtonElement;

  constructor(private readonly dependencies: ExplorerDependencies) {
    const { root, onStorageChange } = dependencies;
    this.fileActions = root.querySelector<HTMLElement>('#file-actions')!;
    this.fileItems = root.querySelector<HTMLElement>('#file-items')!;
    this.driveScopeNote = root.querySelector<HTMLElement>('#drive-scope-note')!;
    this.moveButton = root.querySelector<HTMLButtonElement>('#move-drive')!;
    root.querySelector<HTMLButtonElement>('#storage-local')!.addEventListener('click', () => onStorageChange('local'));
    root.querySelector<HTMLButtonElement>('#storage-drive')!.addEventListener('click', () => onStorageChange('drive'));
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
    this.driveScopeNote.hidden = state.storage !== 'drive' || !state.account;
    this.driveScopeNote.textContent = labels.driveAccess;
    this.fileActions.replaceChildren();
    this.fileItems.replaceChildren();

    if (state.storage === 'local') {
      this.fileActions.append(this.actionButton(labels.addFile, () => this.dependencies.onImport()));
      void this.renderLocalFiles(generation, state.locale, labels);
      this.moveButton.hidden = state.activeDocumentStorage !== 'local' || !state.account || !state.folderId;
      return Promise.resolve();
    }

    this.moveButton.hidden = true;
    if (!state.account || !state.drive) {
      this.appendHint(labels.connectHint);
      return Promise.resolve();
    }
    this.fileActions.append(
      this.actionButton(labels.chooseFolder, () => this.dependencies.onChooseFolder()),
      this.actionButton(labels.createFolder, () => this.dependencies.onCreateFolder()),
      this.actionButton(labels.openDrive, () => this.dependencies.onOpenDrivePicker())
    );
    if (!state.folderId) {
      this.appendHint(labels.noFolder);
      return Promise.resolve();
    }
    this.appendHint(labels.loading);
    return this.renderDriveFiles(generation, state, labels);
  }

  private async renderLocalFiles(generation: number, locale: string, labels: ExplorerLabels): Promise<void> {
    try {
      const documents = await this.dependencies.listLocalDocuments();
      if (!this.isCurrent(generation, 'local')) return;
      if (documents.length === 0) { this.appendHint(labels.createFirst); return; }
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
      this.fileItems.replaceChildren();
      if (files.length === 0) this.appendHint(labels.createFirst);
      for (const file of files) this.appendDriveFile(file, state.locale);
    } catch (error) {
      if (!this.isCurrent(generation, 'drive')) return;
      this.fileItems.replaceChildren();
      this.appendHint(error instanceof Error ? error.message : 'Google Drive is unavailable.');
      this.dependencies.onDriveError(error);
    }
  }

  private isCurrent(generation: number, storage: StorageKind): boolean {
    return generation === this.renderGeneration && this.dependencies.getSnapshot().storage === storage;
  }

  private appendHint(text: string): void {
    const hint = document.createElement('div');
    hint.className = 'empty-state';
    hint.textContent = text;
    this.fileItems.append(hint);
  }

  private actionButton(label: string, callback: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quiet-button file-action';
    button.textContent = label;
    button.addEventListener('click', callback);
    return button;
  }

  private appendFileRow(documentRow: StoredDocument, locale: string, onOpen: () => void): void {
    const wrapper = document.createElement('div');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file-item';
    button.textContent = documentRow.name;
    button.addEventListener('click', onOpen);
    const subtitle = document.createElement('span');
    subtitle.className = 'file-subtitle';
    subtitle.textContent = documentRow.updatedAt ? new Date(documentRow.updatedAt).toLocaleDateString(locale) : '';
    wrapper.append(button, subtitle);
    this.fileItems.append(wrapper);
  }

  private appendDriveFile(file: DriveFile, locale: string): void {
    const wrapper = document.createElement('div');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file-item';
    button.textContent = file.name;
    button.addEventListener('click', () => this.dependencies.onOpenDrive(file));
    const subtitle = document.createElement('span');
    subtitle.className = 'file-subtitle';
    subtitle.textContent = new Date(file.modifiedTime).toLocaleString(locale);
    wrapper.append(button, subtitle);
    this.fileItems.append(wrapper);
  }
}
