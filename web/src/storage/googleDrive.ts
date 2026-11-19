import type { DocumentIdentity } from '@guitardsl/document';
import { GoogleOAuth, loadGooglePicker } from '../auth/googleOAuth';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const VITE_ENV = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const APP_ID = VITE_ENV.VITE_GOOGLE_APP_ID;
const API_KEY = VITE_ENV.VITE_GOOGLE_API_KEY;

export interface DriveFile {
  id: string;
  name: string;
  version: string;
  modifiedTime: string;
  headRevisionId?: string;
  parents?: string[];
  mimeType?: string;
  trashed?: boolean;
  etag?: string;
  appProperties?: Record<string, string>;
  webViewLink?: string;
  capabilities?: { canCopy?: boolean; canRename?: boolean; canMoveItemWithinDrive?: boolean; canTrash?: boolean };
}

export type DriveSaveResult =
  | { kind: 'saved'; file: DriveFile; readback?: { file: DriveFile; source: string; etag?: string } }
  | { kind: 'conflict'; latest: DriveFile }
  | { kind: 'unknown'; status?: number; latest?: { file: DriveFile; source: string; etag?: string } }
  | { kind: 'unavailable'; message: string };

export class DriveApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'DriveApiError'; }
}

export interface DrivePickerSelection { id: string; name: string; mimeType?: string }

interface PickerApi {
  ViewId: { FOLDERS: string; DOCS: string };
  DocsView: new (view?: string) => { setIncludeFolders(value: boolean): unknown; setSelectFolderEnabled(value: boolean): unknown; setMimeTypes(value: string): unknown };
  Feature: { NAV_HIDDEN: string; MULTISELECT_ENABLED: string };
  Action: { PICKED: string; CANCEL: string };
  Response: { ACTION: string; DOCUMENTS: string };
  PickerBuilder: new () => {
    addView(view: unknown): unknown; setDeveloperKey(key: string): unknown; setAppId(id: string): unknown;
    setOAuthToken(token: string): unknown; setOrigin(origin: string): unknown;
    enableFeature(feature: string): unknown; setCallback(callback: (data: Record<string, unknown>) => void): unknown;
    build(): { setVisible(value: boolean): void };
  };
}

function pickerApi(): PickerApi | undefined {
  return (window as Window & { google?: { picker?: PickerApi } }).google?.picker;
}

function isGuitarDslName(name: string): boolean { return /\.(guitardsl|gdsl)$/i.test(name); }

export class GoogleDriveApi {
  constructor(private readonly auth: GoogleOAuth) {}

  private async request<T>(path: string, init: RequestInit = {}, token = this.auth.tokenForRequest()): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (!headers.has('Content-Type') && init.body && !(init.body instanceof Blob)) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${DRIVE_API}${path}`, { ...init, headers });
    if (!response.ok) throw new DriveApiError(response.status, `Google Drive request failed (${response.status}).`);
    return response.status === 204 ? undefined as T : await response.json() as T;
  }

  async getFolder(folderId: string): Promise<DriveFile> {
    return this.request<DriveFile>(`/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,trashed,parents,appProperties,webViewLink,version,modifiedTime`);
  }

  async getMyDriveRootId(): Promise<string> {
    const root = await this.request<{ id?: string }>('/files/root?fields=id');
    if (!root.id) throw new Error('Google Drive did not return the My Drive root ID.');
    return root.id;
  }

  async isWithinFolder(file: DriveFile, ancestorFolderId: string): Promise<boolean> {
    let parentId = file.parents?.[0];
    const visited = new Set<string>();
    for (let depth = 0; parentId && depth < 100; depth += 1) {
      if (parentId === ancestorFolderId) return true;
      if (visited.has(parentId)) return false;
      visited.add(parentId);
      const parent = await this.getFolder(parentId);
      if (parent.trashed || parent.mimeType !== 'application/vnd.google-apps.folder') return false;
      parentId = parent.parents?.[0];
    }
    return false;
  }

  private async listAllByQuery(query: string, fileFields: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: query, pageSize: '100', fields: `nextPageToken,files(${fileFields})`
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await this.request<{ files?: DriveFile[]; nextPageToken?: string }>(`/files?${params}`);
      files.push(...(page.files ?? []));
      if (page.nextPageToken && seen.has(page.nextPageToken)) throw new Error('Drive returned a repeated pagination token.');
      if (page.nextPageToken) seen.add(page.nextPageToken);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }

  async createLibraryRoot(): Promise<DriveFile> {
    const created = await this.request<DriveFile>('/files?fields=id,name,mimeType,parents,trashed,appProperties,webViewLink,version,modifiedTime', {
      method: 'POST', body: JSON.stringify({
        name: 'GuitarDSL', mimeType: 'application/vnd.google-apps.folder', parents: ['root'],
        appProperties: { guitardslLibraryRoot: '1' }
      })
    });
    const readback = await this.getFolder(created.id);
    const rootId = await this.getMyDriveRootId();
    if (readback.name !== 'GuitarDSL' || readback.mimeType !== 'application/vnd.google-apps.folder'
      || readback.trashed || !readback.parents?.includes(rootId)
      || readback.appProperties?.guitardslLibraryRoot !== '1') {
      throw new Error('Google Drive did not confirm the new GuitarDSL library root.');
    }
    return readback;
  }

  async markLibraryRoot(folder: DriveFile): Promise<DriveFile> {
    const rootId = await this.getMyDriveRootId();
    if (folder.mimeType !== 'application/vnd.google-apps.folder' || folder.name !== 'GuitarDSL'
      || !folder.parents?.includes(rootId) || folder.trashed) {
      throw new Error('Only the top-level My Drive GuitarDSL folder can be used as the library root.');
    }
    if (folder.appProperties?.guitardslLibraryRoot === '1') {
      const readback = await this.getFolder(folder.id);
      if (readback.id !== folder.id || readback.name !== 'GuitarDSL'
        || readback.mimeType !== 'application/vnd.google-apps.folder' || readback.trashed
        || !readback.parents?.includes(rootId) || readback.appProperties?.guitardslLibraryRoot !== '1') {
        throw new Error('Google Drive did not confirm the GuitarDSL library marker.');
      }
      return readback;
    }
    const marked = await this.request<DriveFile>(`/files/${encodeURIComponent(folder.id)}?fields=id,name,mimeType,trashed,parents,appProperties,webViewLink,version,modifiedTime`, {
      method: 'PATCH', body: JSON.stringify({
        appProperties: { ...folder.appProperties, guitardslLibraryRoot: '1' }
      })
    });
    const readback = await this.getFolder(folder.id);
    if (marked.id !== folder.id || readback.id !== folder.id || readback.name !== 'GuitarDSL'
      || readback.mimeType !== 'application/vnd.google-apps.folder' || readback.trashed
      || !readback.parents?.includes(rootId) || readback.appProperties?.guitardslLibraryRoot !== '1') {
      throw new Error('Google Drive did not confirm the GuitarDSL library marker.');
    }
    return readback;
  }

  async listFiles(folderId: string): Promise<DriveFile[]> {
    return (await this.listChildren(folderId)).filter(file => file.mimeType !== 'application/vnd.google-apps.folder');
  }

  async listChildren(folderId: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    const seen = new Set<string>();
    do {
      const params = new URLSearchParams({
        q: `'${folderId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' in parents and trashed=false`,
        pageSize: '100', orderBy: 'name_natural',
        fields: 'nextPageToken,files(id,name,mimeType,version,modifiedTime,headRevisionId,parents,trashed,appProperties,webViewLink,capabilities(canCopy,canRename,canMoveItemWithinDrive,canTrash))'
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await this.request<{ files?: DriveFile[]; nextPageToken?: string }>(`/files?${params}`);
      files.push(...(page.files ?? []).filter(file => !file.trashed
        && (file.mimeType === 'application/vnd.google-apps.folder'
          || (isGuitarDslName(file.name) && (file.mimeType === 'text/plain' || file.mimeType === 'application/octet-stream')))));
      if (page.nextPageToken && seen.has(page.nextPageToken)) throw new Error('Drive returned a repeated pagination token.');
      if (page.nextPageToken) seen.add(page.nextPageToken);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }

  async findAccessibleFolders(name = 'GuitarDSL'): Promise<DriveFile[]> {
    const rootId = await this.getMyDriveRootId();
    const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const query = `name='${escape(name)}' and mimeType='application/vnd.google-apps.folder' and '${escape(rootId)}' in parents and trashed=false`;
    return (await this.listAllByQuery(query, 'id,name,mimeType,version,modifiedTime,parents,trashed,appProperties,webViewLink'))
      .filter(file => file.name === name && file.mimeType === 'application/vnd.google-apps.folder'
        && file.parents?.includes(rootId) && !file.trashed);
  }

  async isCanonicalLibraryRoot(folder: DriveFile): Promise<boolean> {
    const rootId = await this.getMyDriveRootId();
    return folder.name === 'GuitarDSL' && folder.mimeType === 'application/vnd.google-apps.folder'
      && !folder.trashed && folder.parents?.includes(rootId) === true;
  }

  async createChildFolder(parentId: string, name: string, operationId?: string): Promise<DriveFile> {
    return this.request<DriveFile>('/files?fields=id,name,mimeType,parents,trashed,appProperties,webViewLink,version,modifiedTime', {
      method: 'POST', body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId],
        ...(operationId ? { appProperties: { guitardslFolderOperation: operationId } } : {}) })
    });
  }

  async findFolderByOperation(parentId: string, operationId: string): Promise<DriveFile | undefined> {
    const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const query = `'${escape(parentId)}' in parents and trashed=false and appProperties has { key='guitardslFolderOperation' and value='${escape(operationId)}' }`;
    const files = await this.listAllByQuery(query, 'id,name,mimeType,parents,trashed,appProperties,webViewLink,version,modifiedTime');
    return files.find(file => file.parents?.includes(parentId)
      && file.mimeType === 'application/vnd.google-apps.folder' && !file.trashed
      && file.appProperties?.guitardslFolderOperation === operationId);
  }

  async renameItem(file: DriveFile, name: string): Promise<DriveFile> {
    const updated = await this.request<DriveFile>(`/files/${encodeURIComponent(file.id)}?fields=id,name,mimeType,parents,trashed,appProperties,webViewLink,version,modifiedTime`, {
      method: 'PATCH', body: JSON.stringify({ name })
    });
    const readback = await this.request<DriveFile>(`/files/${encodeURIComponent(file.id)}?fields=id,name,mimeType,parents,trashed,appProperties,webViewLink,version,modifiedTime`);
    if (updated.id !== file.id || readback.id !== file.id || readback.name !== name || readback.mimeType !== file.mimeType
      || (file.parents ?? []).some(parent => !readback.parents?.includes(parent))) {
      throw new Error('Google Drive did not confirm the item rename.');
    }
    return readback;
  }

  async copyFile(fileId: string, targetFolderId: string, name: string, operationId?: string): Promise<DriveFile> {
    return this.request<DriveFile>(`/files/${encodeURIComponent(fileId)}/copy?fields=id,name,mimeType,parents,trashed,appProperties,webViewLink,version,modifiedTime,headRevisionId`, {
      method: 'POST', body: JSON.stringify({
        name, parents: [targetFolderId], ...(operationId ? { appProperties: { guitardslImportOperation: operationId } } : {})
      })
    });
  }

  async findImportByOperation(folderId: string, operationId: string): Promise<DriveFile | undefined> {
    const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const query = `'${escape(folderId)}' in parents and trashed=false and appProperties has { key='guitardslImportOperation' and value='${escape(operationId)}' }`;
    const files = await this.listAllByQuery(query, 'id,name,mimeType,parents,trashed,appProperties,webViewLink,version,modifiedTime,headRevisionId');
    return files.find(file => file.parents?.includes(folderId) && file.appProperties?.guitardslImportOperation === operationId);
  }

  async moveFile(file: DriveFile, targetFolderId: string, sourceParentId: string): Promise<DriveFile> {
    const params = new URLSearchParams({ addParents: targetFolderId, removeParents: sourceParentId,
      fields: 'id,name,mimeType,parents,trashed,appProperties,webViewLink,version,modifiedTime,headRevisionId' });
    const updated = await this.request<DriveFile>(`/files/${encodeURIComponent(file.id)}?${params}`, { method: 'PATCH' });
    const readback = await this.getMetadata(file.id);
    if (updated.id !== file.id || readback.id !== file.id || !readback.parents?.includes(targetFolderId)
      || readback.parents.includes(sourceParentId)) throw new Error('Google Drive did not confirm the file move.');
    return readback;
  }

  async trashFile(file: DriveFile): Promise<DriveFile> {
    const updated = await this.request<DriveFile>(`/files/${encodeURIComponent(file.id)}?fields=id,name,mimeType,parents,trashed,appProperties,webViewLink,version,modifiedTime`, {
      method: 'PATCH', body: JSON.stringify({ trashed: true })
    });
    const readback = await this.getMetadata(file.id);
    if (updated.id !== file.id || readback.id !== file.id || !readback.trashed) {
      throw new Error('Google Drive did not confirm moving the score to trash.');
    }
    return readback;
  }

  async getMetadata(fileId: string): Promise<DriveFile> {
    return this.request<DriveFile>(`/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,version,modifiedTime,headRevisionId,parents,trashed,appProperties,webViewLink,capabilities(canCopy,canRename,canMoveItemWithinDrive,canTrash)`);
  }

  async getFile(fileId: string): Promise<{ file: DriveFile; source: string; etag?: string }> {
    const token = this.auth.tokenForRequest();
    const metadata = await this.request<DriveFile>(`/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,version,modifiedTime,headRevisionId,parents,trashed,appProperties,webViewLink,capabilities(canCopy,canRename,canMoveItemWithinDrive,canTrash)`, {}, token);
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, { headers });
    if (!response.ok) throw new DriveApiError(response.status, `Google Drive download failed (${response.status}).`);
    return { file: metadata, source: await response.text(), etag: response.headers.get('ETag') ?? undefined };
  }

  async findMoveUpload(folderId: string, localFileId: string): Promise<DriveFile | undefined> {
    const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const query = `'${escape(folderId)}' in parents and trashed=false and appProperties has { key='guitardslLocalId' and value='${escape(localFileId)}' }`;
    const files = await this.listAllByQuery(query, 'id,name,mimeType,version,modifiedTime,headRevisionId,parents,appProperties');
    return files.find(file => file.parents?.includes(folderId) && isGuitarDslName(file.name));
  }

  async createFile(folderId: string, name: string, source: string, localFileId?: string): Promise<DriveFile> {
    const token = this.auth.tokenForRequest();
    const boundary = `guitardsl-${crypto.randomUUID()}`;
    const metadata = {
      name, mimeType: 'text/plain', parents: [folderId],
      ...(localFileId ? { appProperties: { guitardslLocalId: localFileId } } : {})
    };
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n`, source,
      `\r\n--${boundary}--`
    ]);
    const response = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,version,modifiedTime,parents,appProperties`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body
    });
    if (!response.ok) throw new DriveApiError(response.status, `Google Drive upload failed (${response.status}).`);
    return await response.json() as DriveFile;
  }

  async updateFile(file: DriveFile, source: string, expectedEtag?: string): Promise<DriveSaveResult> {
    const metadataPath = `/files/${encodeURIComponent(file.id)}?fields=id,name,mimeType,version,modifiedTime,headRevisionId,parents,appProperties`;
    const current = await this.request<DriveFile>(metadataPath);
    if (current.version !== file.version || current.modifiedTime !== file.modifiedTime
      || current.headRevisionId !== file.headRevisionId) return { kind: 'conflict', latest: current };

    const token = this.auth.tokenForRequest();
    let response: Response;
    try {
      response = await fetch(`${UPLOAD_API}/files/${encodeURIComponent(file.id)}?uploadType=media&fields=id,name,mimeType,version,modifiedTime,parents,appProperties`, {
        method: 'PATCH', headers: {
          Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain; charset=UTF-8',
          // Best-effort only. The preflight comparison is the app's observable conflict check.
          ...(expectedEtag ? { 'If-Match': expectedEtag } : {})
        }, body: source
      });
    } catch {
      const readback = await this.readAfterUncertainWrite(file.id);
      if (readback?.source === source) return { kind: 'saved', file: readback.file, readback };
      return { kind: 'unknown', ...(readback ? { latest: readback } : {}) };
    }

    if (response.status === 412) return { kind: 'conflict', latest: await this.request<DriveFile>(metadataPath) };
    if ([401, 403, 429].includes(response.status) || response.status >= 500) {
      // These responses may not reveal whether Drive applied the media update. Observe once;
      // callers retain the draft and must never retry this PATCH automatically.
      const latest = await this.readAfterUncertainWrite(file.id);
      return { kind: 'unknown', status: response.status, ...(latest ? { latest } : {}) };
    }
    if (!response.ok) throw new DriveApiError(response.status, `Google Drive save failed (${response.status}).`);

    try { return { kind: 'saved', file: await response.json() as DriveFile }; }
    catch {
      const readback = await this.readAfterUncertainWrite(file.id);
      if (readback?.source === source) return { kind: 'saved', file: readback.file, readback };
      return { kind: 'unknown', ...(readback ? { latest: readback } : {}) };
    }
  }

  private async readAfterUncertainWrite(fileId: string): Promise<{ file: DriveFile; source: string; etag?: string } | undefined> {
    try { return await this.getFile(fileId); }
    catch { return undefined; }
  }

  async pickFile(): Promise<DrivePickerSelection | undefined> {
    const token = this.auth.tokenForRequest();
    if (!APP_ID || !API_KEY) throw new Error('Google Drive Picker is not configured for this deployment.');
    await loadGooglePicker();
    const picker = pickerApi();
    if (!picker) throw new Error('Google Picker is unavailable.');
    const view = new picker.DocsView(picker.ViewId.DOCS);
    view.setMimeTypes('text/plain,application/octet-stream');
    return new Promise((resolve, reject) => {
      try {
        const builder = new picker.PickerBuilder();
        builder.addView(view);
        builder.setDeveloperKey(API_KEY);
        builder.setAppId(APP_ID);
        builder.setOAuthToken(token);
        builder.setOrigin(window.location.origin);
        builder.enableFeature(picker.Feature.NAV_HIDDEN);
        builder.setCallback(data => {
          const action = data[picker.Response.ACTION];
          if (action === picker.Action.CANCEL) resolve(undefined);
          else if (action === picker.Action.PICKED) {
            const item = (data[picker.Response.DOCUMENTS] as DrivePickerSelection[] | undefined)?.[0];
            resolve(item);
          }
        });
        builder.build().setVisible(true);
      } catch (error) { reject(error); }
    });
  }

  async pickFiles(): Promise<DrivePickerSelection[] | undefined> {
    const token = this.auth.tokenForRequest();
    if (!APP_ID || !API_KEY) throw new Error('Google Drive Picker is not configured for this deployment.');
    await loadGooglePicker();
    const picker = pickerApi();
    if (!picker) throw new Error('Google Picker is unavailable.');
    const view = new picker.DocsView(picker.ViewId.DOCS);
    view.setIncludeFolders(false);
    view.setSelectFolderEnabled(false);
    view.setMimeTypes('text/plain,application/octet-stream');
    return new Promise((resolve, reject) => {
      try {
        const builder = new picker.PickerBuilder();
        builder.addView(view);
        builder.setDeveloperKey(API_KEY);
        builder.setAppId(APP_ID);
        builder.setOAuthToken(token);
        builder.setOrigin(window.location.origin);
        builder.enableFeature(picker.Feature.NAV_HIDDEN);
        builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
        builder.setCallback(data => {
          const action = data[picker.Response.ACTION];
          if (action === picker.Action.CANCEL) resolve(undefined);
          else if (action === picker.Action.PICKED) {
            const items = data[picker.Response.DOCUMENTS] as DrivePickerSelection[] | undefined;
            resolve(items ?? []);
          }
        });
        builder.build().setVisible(true);
      } catch (error) { reject(error); }
    });
  }
}

export function driveIdentity(fileId: string): DocumentIdentity { return { storage: 'drive', fileId }; }
export function isSupportedDriveFile(name: string): boolean { return isGuitarDslName(name); }
