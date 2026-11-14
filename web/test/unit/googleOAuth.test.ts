import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleAuthError, GoogleOAuth } from '../../src/auth/googleOAuth';

type TokenCallback = (response: { access_token?: string; expires_in?: number; error?: string }) => void;

function installGoogle(response: Parameters<TokenCallback>[0], revocations: string[] = []): void {
  const oauth2 = {
    initTokenClient: (options: { scope: string; callback: TokenCallback }) => ({
      requestAccessToken: (request: { prompt?: string }) => {
        assert.equal(request.prompt, 'select_account');
        assert.equal(options.scope, 'https://www.googleapis.com/auth/drive.file');
        options.callback(response);
      }
    }),
    revoke: (token: string, callback?: () => void) => { revocations.push(token); callback?.(); }
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { google: { accounts: { oauth2 } } }
  });
}

function restoreGlobal(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

test('reports an unconfigured deployment without trying to load Google scripts', async () => {
  await assert.rejects(new GoogleOAuth(undefined).connect(), error =>
    error instanceof GoogleAuthError && error.code === 'not-configured');
});

test('treats a cancelled GIS consent as cancellation and keeps the account empty', async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  installGoogle({ error: 'access_denied' });
  try {
    const auth = new GoogleOAuth('public-client-id');
    await assert.rejects(auth.connect(), error => error instanceof GoogleAuthError && error.code === 'cancelled');
    assert.equal(auth.currentAccount, undefined);
  } finally { restoreGlobal('window', windowDescriptor); }
});

test('keeps access tokens in the auth instance and clears them on disconnect', async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const fetchOriginal = globalThis.fetch;
  const revocations: string[] = [];
  installGoogle({ access_token: 'memory-only-token', expires_in: 3600 }, revocations);
  globalThis.fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer memory-only-token');
    return new Response(JSON.stringify({ user: { permissionId: 'account-1', displayName: 'Guitarist' } }), { status: 200 });
  };
  try {
    const auth = new GoogleOAuth('public-client-id');
    assert.deepEqual(await auth.connect(), { accountId: 'account-1', displayName: 'Guitarist' });
    assert.equal(auth.tokenForRequest(), 'memory-only-token');
    await auth.disconnect();
    assert.deepEqual(revocations, ['memory-only-token']);
    assert.throws(() => auth.tokenForRequest(), error => error instanceof GoogleAuthError && error.code === 'expired');
  } finally {
    globalThis.fetch = fetchOriginal;
    restoreGlobal('window', windowDescriptor);
  }
});

test('rejects a token that expires before a Drive request', async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const fetchOriginal = globalThis.fetch;
  installGoogle({ access_token: 'short-lived-token', expires_in: 0 });
  globalThis.fetch = async () => new Response(JSON.stringify({ user: { permissionId: 'account-2' } }), { status: 200 });
  try {
    const auth = new GoogleOAuth('public-client-id');
    await auth.connect();
    assert.throws(() => auth.tokenForRequest(), error => error instanceof GoogleAuthError && error.code === 'expired');
  } finally {
    globalThis.fetch = fetchOriginal;
    restoreGlobal('window', windowDescriptor);
  }
});
