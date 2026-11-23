const TOKEN_SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

interface GoogleIdentityApi {
  oauth2: {
    initTokenClient(options: {
      client_id: string;
      scope: string;
      callback: (response: GoogleTokenResponse) => void;
      error_callback?: (error: { type?: string; message?: string }) => void;
    }): GoogleTokenClient;
    hasGrantedAllScopes?(tokenResponse: GoogleTokenResponse, ...scopes: string[]): boolean;
    revoke(token: string, callback?: () => void): void;
  };
}

declare global {
  interface Window { google?: { accounts?: GoogleIdentityApi } }
}

export interface GoogleAccount {
  accountId: string;
  displayName?: string;
  emailAddress?: string;
}

const VITE_ENV = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

export class GoogleAuthError extends Error {
  constructor(readonly code: 'not-configured' | 'cancelled' | 'expired' | 'insufficient-scope' | 'unavailable', message: string) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

let gisPromise: Promise<void> | undefined;
let pickerPromise: Promise<void> | undefined;

async function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  if (!gisPromise) {
    gisPromise = new Promise<void>((resolve, reject) => {
      if (window.google?.accounts?.oauth2) return resolve();
      const script = document.createElement('script');
      script.src = GIS_SCRIPT;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new GoogleAuthError('unavailable', 'Google sign-in could not be loaded.'));
      document.head.append(script);
    });
  }
  try { await gisPromise; }
  catch (error) { gisPromise = undefined; throw error; }
  const api = window.google?.accounts;
  if (!api?.oauth2) {
    gisPromise = undefined;
    throw new GoogleAuthError('unavailable', 'Google sign-in is unavailable.');
  }
  return api;
}

export class GoogleOAuth {
  private accessToken: string | undefined;
  private expiresAt = 0;
  private account: GoogleAccount | undefined;
  private generation = 0;
  private connectPromise: Promise<GoogleAccount> | undefined;

  constructor(private readonly clientId = VITE_ENV.VITE_GOOGLE_CLIENT_ID) {}

  get currentAccount(): GoogleAccount | undefined { return this.account; }

  connect(): Promise<GoogleAccount> {
    if (!this.clientId) return Promise.reject(new GoogleAuthError('not-configured', 'Google Drive is not configured for this deployment.'));
    if (this.connectPromise) return this.connectPromise;
    const generation = ++this.generation;
    const pending = this.connectCandidate(generation);
    let shared: Promise<GoogleAccount>;
    shared = pending.finally(() => {
      if (this.connectPromise === shared) this.connectPromise = undefined;
    });
    this.connectPromise = shared;
    return shared;
  }

  private async connectCandidate(generation: number): Promise<GoogleAccount> {
    const assertCurrent = (): void => {
      if (this.generation !== generation) {
        throw new GoogleAuthError('cancelled', 'Google Drive connection was cancelled.');
      }
    };
    const api = await loadGoogleIdentity();
    assertCurrent();
    const token = await new Promise<{ token: string; expiresAt: number }>((resolve, reject) => {
      const client = api.oauth2.initTokenClient({
        client_id: this.clientId!, scope: TOKEN_SCOPE,
        callback: response => {
          if (response.error || !response.access_token) {
            reject(new GoogleAuthError(response.error === 'access_denied' ? 'cancelled' : 'unavailable',
              response.error_description || 'Google Drive authorization did not complete.'));
            return;
          }
          const requiredScopes = TOKEN_SCOPE.split(' ');
          const grantedScopes = new Set((response.scope ?? '').split(/\s+/u).filter(Boolean));
          const grantedByToken = requiredScopes.every(scope => grantedScopes.has(scope));
          const grantedByIdentity = api.oauth2.hasGrantedAllScopes?.(response, ...requiredScopes) ?? true;
          if (!grantedByToken || !grantedByIdentity) {
            reject(new GoogleAuthError('insufficient-scope', 'Both Google Drive permissions are required. Connect again and grant access to both requested permissions.'));
            return;
          }
          const expiresIn = Math.max(0, Number(response.expires_in) || 0);
          resolve({ token: response.access_token, expiresAt: Date.now() + expiresIn * 1000 });
        },
        error_callback: error => reject(new GoogleAuthError('unavailable', error.message || 'Google sign-in failed.'))
      });
      // Requiring account selection keeps a reconnect from silently changing the active Drive identity.
      client.requestAccessToken({ prompt: 'select_account' });
    });
    assertCurrent();
    if (Date.now() + 15_000 >= token.expiresAt) throw new GoogleAuthError('expired', 'Reconnect Google Drive to continue.');
    const response = await fetch(`${DRIVE_API}/about?fields=user(permissionId,displayName,emailAddress)`, {
      headers: { Authorization: `Bearer ${token.token}` }
    });
    assertCurrent();
    if (!response.ok) throw new Error(`Drive account lookup failed (${response.status}).`);
    const data = await response.json() as { user?: { permissionId?: string; displayName?: string; emailAddress?: string } };
    assertCurrent();
    if (!data.user?.permissionId) throw new Error('Google did not return a stable Drive account identifier.');
    if (Date.now() + 15_000 >= token.expiresAt) throw new GoogleAuthError('expired', 'Reconnect Google Drive to continue.');
    const account: GoogleAccount = {
      accountId: data.user.permissionId,
      ...(data.user.displayName ? { displayName: data.user.displayName } : {}),
      ...(data.user.emailAddress ? { emailAddress: data.user.emailAddress } : {})
    };
    // Publish the token and the account together only after this generation's /about result is valid.
    this.accessToken = token.token;
    this.expiresAt = token.expiresAt;
    this.account = account;
    return account;
  }

  tokenForRequest(): string {
    if (!this.accessToken || Date.now() + 15_000 >= this.expiresAt) {
      this.accessToken = undefined;
      this.expiresAt = 0;
      this.account = undefined;
      throw new GoogleAuthError('expired', 'Reconnect Google Drive to continue.');
    }
    return this.accessToken;
  }

  async disconnect(): Promise<void> {
    const token = this.accessToken;
    this.generation += 1;
    this.connectPromise = undefined;
    this.accessToken = undefined;
    this.expiresAt = 0;
    this.account = undefined;
    if (token && window.google?.accounts?.oauth2) {
      await new Promise<void>(resolve => window.google!.accounts!.oauth2.revoke(token, resolve));
    }
  }
}

export async function loadGooglePicker(): Promise<void> {
  if (!pickerPromise) {
    pickerPromise = new Promise<void>((resolve, reject) => {
      const gapi = (window as Window & { gapi?: { load: (name: string, options: { callback: () => void; onerror: () => void }) => void } }).gapi;
      if (gapi?.load) return gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Google Picker could not be loaded.')) });
      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.async = true;
      script.onload = () => {
        const loaded = (window as Window & { gapi?: { load: (name: string, options: { callback: () => void; onerror: () => void }) => void } }).gapi;
        if (!loaded) return reject(new Error('Google Picker is unavailable.'));
        loaded.load('picker', { callback: resolve, onerror: () => reject(new Error('Google Picker could not be loaded.')) });
      };
      script.onerror = () => reject(new Error('Google Picker could not be loaded.'));
      document.head.append(script);
    });
  }
  try { await pickerPromise; }
  catch (error) { pickerPromise = undefined; throw error; }
}
