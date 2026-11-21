import type { GoogleOAuth } from '../auth/googleOAuth';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
export const DRIVE_APPDATA_FILE_NAME = 'guitardsl-state-v1.json';
export const DRIVE_APPDATA_MIME_TYPE = 'application/json';

export type FolderPromptState = 'unasked' | 'deferred' | 'completed';

export interface DriveAppDataState {
  schemaVersion: 1;
  selectedFolderId: string | null;
  folderPrompt: FolderPromptState;
  openDriveFileIds: string[];
  activeDriveFileId: string | null;
  recentDriveFileIds: string[];
}

export interface DriveAppDataFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  version: string;
  modifiedTime: string;
}

export interface DriveAppDataSnapshot {
  file: DriveAppDataFile;
  state: DriveAppDataState;
  duplicateCount: number;
}

export interface PendingDriveAppData {
  schemaVersion: 1;
  accountId: string;
  state: DriveAppDataState;
  updatedAt: number;
}

export type DriveAppDataErrorCode =
  | 'http' | 'permission' | 'network' | 'invalid-json' | 'invalid-state'
  | 'unsupported-version' | 'conflict' | 'unknown-outcome';

export class DriveAppDataError extends Error {
  constructor(readonly code: DriveAppDataErrorCode, message: string, readonly status?: number) {
    super(message);
    this.name = 'DriveAppDataError';
  }
}

export type DriveAppDataSaveResult =
  | { kind: 'saved'; snapshot: DriveAppDataSnapshot }
  | { kind: 'conflict'; latest: DriveAppDataSnapshot };

export interface DriveAppDataUpdateOptions {
  shouldContinue?: () => boolean;
  onPatchStart?: () => void;
  onPatchSettled?: () => void;
}

function assertCanContinue(shouldContinue: () => boolean): void {
  if (!shouldContinue()) throw new DOMException('Drive app state operation was cancelled.', 'AbortError');
}

const STATE_KEYS = [
  'schemaVersion', 'selectedFolderId', 'folderPrompt', 'openDriveFileIds', 'activeDriveFileId', 'recentDriveFileIds'
] as const;

export const DEFAULT_DRIVE_APPDATA_STATE: DriveAppDataState = {
  schemaVersion: 1,
  selectedFolderId: null,
  folderPrompt: 'unasked',
  openDriveFileIds: [],
  activeDriveFileId: null,
  recentDriveFileIds: []
};

function uniqueIds(value: unknown, limit: number, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new DriveAppDataError('invalid-state', `Drive app state field ${field} is invalid.`);
  }
  return [...new Set(value as string[])].slice(0, limit);
}

export function validateDriveAppDataState(value: unknown): DriveAppDataState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DriveAppDataError('invalid-state', 'Drive app state must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new DriveAppDataError('unsupported-version', 'This Drive app state version is not supported.');
  }
  if (Object.keys(record).length !== STATE_KEYS.length || STATE_KEYS.some(key => !Object.hasOwn(record, key))) {
    throw new DriveAppDataError('invalid-state', 'Drive app state contains missing or unknown fields.');
  }
  if (record.selectedFolderId !== null && (typeof record.selectedFolderId !== 'string' || !record.selectedFolderId)) {
    throw new DriveAppDataError('invalid-state', 'Drive app state selectedFolderId is invalid.');
  }
  if (record.activeDriveFileId !== null && (typeof record.activeDriveFileId !== 'string' || !record.activeDriveFileId)) {
    throw new DriveAppDataError('invalid-state', 'Drive app state activeDriveFileId is invalid.');
  }
  if (record.folderPrompt !== 'unasked' && record.folderPrompt !== 'deferred' && record.folderPrompt !== 'completed') {
    throw new DriveAppDataError('invalid-state', 'Drive app state folderPrompt is invalid.');
  }
  return {
    schemaVersion: 1,
    selectedFolderId: record.selectedFolderId as string | null,
    folderPrompt: record.folderPrompt,
    openDriveFileIds: uniqueIds(record.openDriveFileIds, 30, 'openDriveFileIds'),
    activeDriveFileId: record.activeDriveFileId as string | null,
    recentDriveFileIds: uniqueIds(record.recentDriveFileIds, 50, 'recentDriveFileIds')
  };
}

export function validatePendingDriveAppData(value: unknown, expectedAccountId: string): PendingDriveAppData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DriveAppDataError('invalid-state', 'Pending Drive metadata must be an object.');
  }
  const record = value as Record<string, unknown>;
  const keys = ['schemaVersion', 'accountId', 'state', 'updatedAt'];
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))
    || record.schemaVersion !== 1 || record.accountId !== expectedAccountId
    || typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt) || record.updatedAt < 0) {
    throw new DriveAppDataError('invalid-state', 'Pending Drive metadata is invalid or belongs to another account.');
  }
  return {
    schemaVersion: 1,
    accountId: expectedAccountId,
    state: validateDriveAppDataState(record.state),
    updatedAt: record.updatedAt
  };
}

function serializedState(state: DriveAppDataState): string {
  return JSON.stringify(validateDriveAppDataState(state));
}

function canonicalFile(files: DriveAppDataFile[]): DriveAppDataFile | undefined {
  return [...files].sort((a, b) => a.createdTime.localeCompare(b.createdTime) || a.id.localeCompare(b.id))[0];
}

function sameFileVersion(left: DriveAppDataFile, right: DriveAppDataFile): boolean {
  return left.id === right.id && left.name === right.name && left.mimeType === right.mimeType
    && left.createdTime === right.createdTime && left.version === right.version && left.modifiedTime === right.modifiedTime;
}

export class DriveAppDataStore {
  constructor(
    private readonly auth: Pick<GoogleOAuth, 'tokenForRequest'>,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args)
  ) {}

  async load(shouldContinue: () => boolean = () => true): Promise<DriveAppDataSnapshot | undefined> {
    assertCanContinue(shouldContinue);
    const token = this.auth.tokenForRequest();
    const files = await this.listStateFiles(token, shouldContinue);
    assertCanContinue(shouldContinue);
    const selected = canonicalFile(files);
    if (!selected) return undefined;
    const snapshot = await this.readFile(selected.id, token, files.length, shouldContinue);
    assertCanContinue(shouldContinue);
    return snapshot;
  }

  async loadOrCreate(
    initial: DriveAppDataState, knownMissing = false, shouldContinue: () => boolean = () => true
  ): Promise<DriveAppDataSnapshot> {
    assertCanContinue(shouldContinue);
    const normalized = validateDriveAppDataState(initial);
    const existing = knownMissing ? undefined : await this.load(shouldContinue);
    if (existing) return existing;
    assertCanContinue(shouldContinue);
    return this.createInitial(normalized, shouldContinue);
  }

  async readFile(
    fileId: string, token = this.auth.tokenForRequest(), duplicateCount = 1,
    shouldContinue: () => boolean = () => true
  ): Promise<DriveAppDataSnapshot> {
    assertCanContinue(shouldContinue);
    const before = await this.getMetadata(fileId, token, shouldContinue);
    this.assertStateFile(before);
    const response = await this.fetchRequest(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` }
    }, shouldContinue);
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? 'permission' : 'http';
      throw new DriveAppDataError(code, `Google Drive app state content request failed (${response.status}).`, response.status);
    }
    const source = await response.text();
    let value: unknown;
    try { value = JSON.parse(source); }
    catch { throw new DriveAppDataError('invalid-json', 'The Drive app state file is not valid JSON.'); }
    const state = validateDriveAppDataState(value);
    const after = await this.getMetadata(fileId, token, shouldContinue);
    this.assertStateFile(after);
    if (!sameFileVersion(before, after)) {
      throw new DriveAppDataError('unknown-outcome', 'Drive app state changed while it was being read; the version could not be verified.');
    }
    return { file: after, state, duplicateCount };
  }

  async update(
    snapshot: DriveAppDataSnapshot, nextState: DriveAppDataState, options: DriveAppDataUpdateOptions = {}
  ): Promise<DriveAppDataSaveResult> {
    const normalized = validateDriveAppDataState(nextState);
    const shouldContinue = options.shouldContinue ?? (() => true);
    assertCanContinue(shouldContinue);
    const token = this.auth.tokenForRequest();
    const latestMetadata = await this.getMetadata(snapshot.file.id, token, shouldContinue);
    assertCanContinue(shouldContinue);
    this.assertStateFile(latestMetadata);
    if (latestMetadata.id !== snapshot.file.id) {
      throw new DriveAppDataError('invalid-state', 'The selected Drive app state file identity changed.');
    }
    let updateSnapshot = snapshot;
    if (!sameFileVersion(latestMetadata, snapshot.file)) {
      let latest = await this.readFile(snapshot.file.id, token, snapshot.duplicateCount, shouldContinue);
      if (serializedState(latest.state) === serializedState(normalized)) return { kind: 'saved', snapshot: latest };
      if (serializedState(latest.state) !== serializedState(snapshot.state)) return { kind: 'conflict', latest };

      // A metadata-only change can be rebased, but the version used for PATCH must
      // still be the one whose content was just compared with the baseline.
      let confirmed = await this.getMetadata(snapshot.file.id, token, shouldContinue);
      this.assertStateFile(confirmed);
      if (confirmed.id !== snapshot.file.id) throw new DriveAppDataError('invalid-state', 'The selected Drive app state file identity changed.');
      if (!sameFileVersion(confirmed, latest.file)) {
        latest = await this.readFile(snapshot.file.id, token, snapshot.duplicateCount, shouldContinue);
        if (serializedState(latest.state) === serializedState(normalized)) return { kind: 'saved', snapshot: latest };
        if (serializedState(latest.state) !== serializedState(snapshot.state)) return { kind: 'conflict', latest };
        confirmed = await this.getMetadata(snapshot.file.id, token, shouldContinue);
        this.assertStateFile(confirmed);
        if (confirmed.id !== snapshot.file.id) throw new DriveAppDataError('invalid-state', 'The selected Drive app state file identity changed.');
        if (!sameFileVersion(confirmed, latest.file)) {
          throw new DriveAppDataError('unknown-outcome', 'Drive app state kept changing during revalidation; it was not updated.');
        }
      }
      updateSnapshot = latest;
    }

    let response: Response;
    assertCanContinue(shouldContinue);
    options.onPatchStart?.();
    try {
      response = await this.fetcher(`${UPLOAD_API}/files/${encodeURIComponent(snapshot.file.id)}?uploadType=media&fields=id,name,mimeType,createdTime,version,modifiedTime`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': `${DRIVE_APPDATA_MIME_TYPE}; charset=UTF-8` },
        body: serializedState(normalized)
      });
    } catch {
      return this.reconcileUncertainUpdate(snapshot, normalized, token, shouldContinue);
    }
    if (response.status === 412 || response.status === 401 || response.status === 403
      || !response.ok && response.status < 500 && response.status !== 429) options.onPatchSettled?.();
    assertCanContinue(shouldContinue);
    if (response.status === 412) {
      const latest = await this.readFile(snapshot.file.id, token, snapshot.duplicateCount, shouldContinue);
      return serializedState(latest.state) === serializedState(normalized)
        ? { kind: 'saved', snapshot: latest }
        : { kind: 'conflict', latest };
    }
    if (response.status === 401 || response.status === 403) {
      throw new DriveAppDataError('permission', `Google Drive denied app state access (${response.status}).`, response.status);
    }
    if (response.status === 429 || response.status >= 500) {
      return this.reconcileUncertainUpdate(updateSnapshot, normalized, token, shouldContinue);
    }
    if (!response.ok) throw new DriveAppDataError('http', `Google Drive app state update failed (${response.status}).`, response.status);
    try { await response.json(); }
    catch { return this.reconcileUncertainUpdate(updateSnapshot, normalized, token, shouldContinue); }

    let readback: DriveAppDataSnapshot;
    try { readback = await this.readFile(updateSnapshot.file.id, token, updateSnapshot.duplicateCount, shouldContinue); }
    catch { throw new DriveAppDataError('unknown-outcome', 'Drive app state update could not be verified; it was not retried.'); }
    if (serializedState(readback.state) !== serializedState(normalized)) {
      throw new DriveAppDataError('unknown-outcome', 'Drive app state readback did not match; the update was not retried.');
    }
    return { kind: 'saved', snapshot: readback };
  }

  private async reconcileUncertainUpdate(
    baseline: DriveAppDataSnapshot, desired: DriveAppDataState, token: string, shouldContinue: () => boolean
  ): Promise<DriveAppDataSaveResult> {
    try {
      const latest = await this.readFile(baseline.file.id, token, baseline.duplicateCount, shouldContinue);
      if (serializedState(latest.state) === serializedState(desired)) return { kind: 'saved', snapshot: latest };
      throw new DriveAppDataError('unknown-outcome', 'Drive app state was not confirmed after the update; the pending state was kept and no retry was sent.');
    } catch {
      throw new DriveAppDataError('unknown-outcome', 'Drive app state update is unconfirmed; it was not retried.');
    }
  }

  private async createInitial(initial: DriveAppDataState, shouldContinue: () => boolean): Promise<DriveAppDataSnapshot> {
    assertCanContinue(shouldContinue);
    const token = this.auth.tokenForRequest();
    const boundary = `guitardsl-appdata-${crypto.randomUUID()}`;
    const metadata = { name: DRIVE_APPDATA_FILE_NAME, mimeType: DRIVE_APPDATA_MIME_TYPE, parents: ['appDataFolder'] };
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: ${DRIVE_APPDATA_MIME_TYPE}; charset=UTF-8\r\n\r\n`, serializedState(initial),
      `\r\n--${boundary}--`
    ]);
    let response: Response;
    try {
      response = await this.fetcher(`${UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,createdTime,version,modifiedTime`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body
      });
    } catch {
      if (!shouldContinue()) throw new DOMException('Drive app state creation was cancelled.', 'AbortError');
      return this.reconcileUncertainCreate(initial, shouldContinue);
    }
    assertCanContinue(shouldContinue);
    if (response.status === 401 || response.status === 403) {
      throw new DriveAppDataError('permission', `Google Drive denied app state creation (${response.status}).`, response.status);
    }
    if (response.status === 429 || response.status >= 500) return this.reconcileUncertainCreate(initial, shouldContinue);
    if (!response.ok) throw new DriveAppDataError('http', `Google Drive app state creation failed (${response.status}).`, response.status);
    let created: { id?: string };
    try { created = await response.json() as { id?: string }; }
    catch { return this.reconcileUncertainCreate(initial, shouldContinue); }
    if (!created.id) return this.reconcileUncertainCreate(initial, shouldContinue);
    let readback: DriveAppDataSnapshot;
    try { readback = await this.readFile(created.id, token, 1, shouldContinue); }
    catch { throw new DriveAppDataError('unknown-outcome', 'The initial Drive app state file was created but could not be verified.'); }
    if (serializedState(readback.state) !== serializedState(initial)) {
      throw new DriveAppDataError('unknown-outcome', 'The initial Drive app state readback did not match.');
    }
    return readback;
  }

  private async reconcileUncertainCreate(
    initial: DriveAppDataState, shouldContinue: () => boolean = () => true
  ): Promise<DriveAppDataSnapshot> {
    try {
      const found = await this.load(shouldContinue);
      if (!found) throw new Error('missing');
      if (serializedState(found.state) !== serializedState(initial)) {
        throw new DriveAppDataError('conflict', 'A Drive app state file appeared during initial creation.');
      }
      return found;
    } catch (error) {
      if (error instanceof DriveAppDataError && error.code === 'conflict') throw error;
      throw new DriveAppDataError('unknown-outcome', 'The initial Drive app state creation is unconfirmed; it was not retried.');
    }
  }

  private async listStateFiles(token: string, shouldContinue: () => boolean = () => true): Promise<DriveAppDataFile[]> {
    const files: DriveAppDataFile[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        spaces: 'appDataFolder',
        q: `name='${DRIVE_APPDATA_FILE_NAME}' and trashed=false`,
        pageSize: '100',
        fields: 'nextPageToken,files(id,name,mimeType,createdTime,version,modifiedTime)'
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await this.jsonRequest<{ files?: DriveAppDataFile[]; nextPageToken?: string }>(
        `${DRIVE_API}/files?${params}`, token, shouldContinue
      );
      files.push(...(page.files ?? []).filter(file => file.name === DRIVE_APPDATA_FILE_NAME && file.mimeType === DRIVE_APPDATA_MIME_TYPE));
      if (page.nextPageToken && seen.has(page.nextPageToken)) throw new DriveAppDataError('http', 'Google Drive repeated an app state pagination token.');
      if (page.nextPageToken) seen.add(page.nextPageToken);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }

  private async getMetadata(fileId: string, token: string, shouldContinue: () => boolean = () => true): Promise<DriveAppDataFile> {
    return this.jsonRequest<DriveAppDataFile>(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,createdTime,version,modifiedTime`, token, shouldContinue
    );
  }

  private assertStateFile(file: DriveAppDataFile): void {
    if (file.name !== DRIVE_APPDATA_FILE_NAME || file.mimeType !== DRIVE_APPDATA_MIME_TYPE) {
      throw new DriveAppDataError('invalid-state', 'The selected Drive app state file has unexpected metadata.');
    }
  }

  private async jsonRequest<T>(url: string, token: string, shouldContinue: () => boolean = () => true): Promise<T> {
    const response = await this.fetchRequest(url, { headers: { Authorization: `Bearer ${token}` } }, shouldContinue);
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? 'permission' : 'http';
      throw new DriveAppDataError(code, `Google Drive app state request failed (${response.status}).`, response.status);
    }
    try { return await response.json() as T; }
    catch { throw new DriveAppDataError('invalid-json', 'Google Drive returned invalid app state metadata.'); }
  }

  private async fetchRequest(url: string, init: RequestInit, shouldContinue: () => boolean = () => true): Promise<Response> {
    assertCanContinue(shouldContinue);
    try {
      const response = await this.fetcher(url, init);
      assertCanContinue(shouldContinue);
      return response;
    }
    catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new DriveAppDataError('network', 'Google Drive app state is unavailable.');
    }
  }
}
