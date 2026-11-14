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
  etag?: string;
  appProperties?: Record<string, string>;
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
    return this.request<DriveFile>(`/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,trashed`);
  }

  async createFolder(name = 'GuitarDSL'): Promise<DriveFile> {
    return this.request<DriveFile>('/files?fields=id,name,mimeType,parents', {
      method: 'POST', body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' })
    });
  }

  async listFiles(folderId: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    const seen = new Set<string>();
    do {
      const params = new URLSearchParams({
        q: `'${folderId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' in parents and trashed=false`,
        pageSize: '100', orderBy: 'name_natural',
        fields: 'nextPageToken,files(id,name,mimeType,version,modifiedTime,headRevisionId,parents,appProperties)'
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await this.request<{ files?: DriveFile[]; nextPageToken?: string }>(`/files?${params}`);
      files.push(...(page.files ?? []).filter(file => file.mimeType !== 'application/vnd.google-apps.folder' && isGuitarDslName(file.name)));
      if (page.nextPageToken && seen.has(page.nextPageToken)) throw new Error('Drive returned a repeated pagination token.');
      if (page.nextPageToken) seen.add(page.nextPageToken);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }

  async getFile(fileId: string): Promise<{ file: DriveFile; source: string; etag?: string }> {
    const token = this.auth.tokenForRequest();
    const metadata = await this.request<DriveFile>(`/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,version,modifiedTime,headRevisionId,parents,appProperties`, {}, token);
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, { headers });
    if (!response.ok) throw new DriveApiError(response.status, `Google Drive download failed (${response.status}).`);
    return { file: metadata, source: await response.text(), etag: response.headers.get('ETag') ?? undefined };
  }

  async findMoveUpload(folderId: string, localFileId: string): Promise<DriveFile | undefined> {
    const params = new URLSearchParams({
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed=false and appProperties has { key='guitardslLocalId' and value='${localFileId.replace(/'/g, "\\'")}' }`,
      pageSize: '100', fields: 'files(id,name,mimeType,version,modifiedTime,headRevisionId,parents,appProperties)'
    });
    const result = await this.request<{ files?: DriveFile[] }>(`/files?${params}`);
    return result.files?.find(file => isGuitarDslName(file.name));
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

  async pickFolder(): Promise<DrivePickerSelection | undefined> {
    const token = this.auth.tokenForRequest();
    if (!APP_ID || !API_KEY) throw new Error('Google Drive Picker is not configured for this deployment.');
    await loadGooglePicker();
    const picker = pickerApi();
    if (!picker) throw new Error('Google Picker is unavailable.');
    const view = new picker.DocsView(picker.ViewId.FOLDERS);
    view.setIncludeFolders(true);
    view.setSelectFolderEnabled(true);
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
}

export function driveIdentity(fileId: string): DocumentIdentity { return { storage: 'drive', fileId }; }
export function isSupportedDriveFile(name: string): boolean { return isGuitarDslName(name); }
