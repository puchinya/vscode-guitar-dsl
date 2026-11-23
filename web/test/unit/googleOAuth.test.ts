import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleAuthError, GoogleOAuth } from '../../src/auth/googleOAuth';

type TokenCallback = (response: { access_token?: string; expires_in?: number; scope?: string; error?: string }) => void;
const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata';

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function installQueuedGoogle(callbacks: TokenCallback[], revocations: string[] = []): void {
  const oauth2 = {
    initTokenClient: (options: { scope: string; callback: TokenCallback }) => ({
      requestAccessToken: (request: { prompt?: string }) => {
        assert.equal(request.prompt, 'select_account');
        assert.equal(options.scope, REQUIRED_SCOPE);
        callbacks.push(options.callback);
      }
    }),
    hasGrantedAllScopes: (response: Parameters<TokenCallback>[0], ...scopes: string[]) => {
      const granted = new Set((response.scope ?? '').split(/\s+/u).filter(Boolean));
      return scopes.every(scope => granted.has(scope));
    },
    revoke: (token: string, callback?: () => void) => { revocations.push(token); callback?.(); }
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { google: { accounts: { oauth2 } } }
  });
}

function nextTurn(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

function installGoogle(response: Parameters<TokenCallback>[0], revocations: string[] = []): void {
  const oauth2 = {
    initTokenClient: (options: { scope: string; callback: TokenCallback }) => ({
      requestAccessToken: (request: { prompt?: string }) => {
        assert.equal(request.prompt, 'select_account');
        assert.equal(options.scope, 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata');
        options.callback(response);
      }
    }),
    hasGrantedAllScopes: (response: Parameters<TokenCallback>[0], ...scopes: string[]) => {
      const granted = new Set((response.scope ?? '').split(/\s+/u).filter(Boolean));
      return scopes.every(scope => granted.has(scope));
    },
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

test('rejects partial Google consent before accepting the account or making Drive requests', async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const fetchOriginal = globalThis.fetch;
  let driveRequests = 0;
  installGoogle({ access_token: 'partial-token', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' });
  globalThis.fetch = async () => {
    driveRequests += 1;
    return new Response(JSON.stringify({ user: { permissionId: 'account-partial' } }), { status: 200 });
  };
  try {
    const auth = new GoogleOAuth('public-client-id');
    await assert.rejects(auth.connect(), error => error instanceof GoogleAuthError && error.code === 'insufficient-scope');
    assert.equal(auth.currentAccount, undefined);
    assert.throws(() => auth.tokenForRequest(), error => error instanceof GoogleAuthError && error.code === 'expired');
    assert.equal(driveRequests, 0);
  } finally {
    globalThis.fetch = fetchOriginal;
    restoreGlobal('window', windowDescriptor);
  }
});

test('keeps fully authorized access tokens in memory and clears them on disconnect', async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const fetchOriginal = globalThis.fetch;
  const revocations: string[] = [];
  installGoogle({ access_token: 'memory-only-token', expires_in: 3600, scope: REQUIRED_SCOPE }, revocations);
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

test('uses one OAuth authorization for overlapping connect calls and publishes the matching account after /about', async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const fetchOriginal = globalThis.fetch;
  const callbacks: TokenCallback[] = [];
  const accountLookup = deferred<Response>();
  installQueuedGoogle(callbacks);
  globalThis.fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer candidate-token');
    return accountLookup.promise;
  };
  try {
    const auth = new GoogleOAuth('public-client-id');
    const first = auth.connect();
    await nextTurn();
    const second = auth.connect();
    assert.equal(second, first);
    assert.equal(callbacks.length, 1);
    callbacks[0]!({ access_token: 'candidate-token', expires_in: 3600, scope: REQUIRED_SCOPE });
    await nextTurn();
    assert.equal(auth.currentAccount, undefined);
    accountLookup.resolve(new Response(JSON.stringify({ user: { permissionId: 'candidate-account', emailAddress: 'candidate@example.test' } }), { status: 200 }));
    const account = { accountId: 'candidate-account', emailAddress: 'candidate@example.test' };
    assert.deepEqual(await Promise.all([first, second]), [account, account]);
    assert.deepEqual(auth.currentAccount, account);
    assert.equal(auth.tokenForRequest(), 'candidate-token');
  } finally {
    globalThis.fetch = fetchOriginal;
    restoreGlobal('window', windowDescriptor);
  }
});

test('disconnect invalidates a pending /about result and allows only the newer account to become active', async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const fetchOriginal = globalThis.fetch;
  const callbacks: TokenCallback[] = [];
  const firstLookup = deferred<Response>();
  const firstLookupStarted = deferred<void>();
  installQueuedGoogle(callbacks);
  globalThis.fetch = async (_input, init) => {
    const authorization = new Headers(init?.headers).get('Authorization');
    if (authorization === 'Bearer token-a') {
      firstLookupStarted.resolve();
      return firstLookup.promise;
    }
    assert.equal(authorization, 'Bearer token-b');
    return new Response(JSON.stringify({ user: { permissionId: 'account-b' } }), { status: 200 });
  };
  try {
    const auth = new GoogleOAuth('public-client-id');
    const pendingA = auth.connect();
    await nextTurn();
    callbacks[0]!({ access_token: 'token-a', expires_in: 3600, scope: REQUIRED_SCOPE });
    await firstLookupStarted.promise;

    await auth.disconnect();
    const connectionB = auth.connect();
    await nextTurn();
    assert.equal(callbacks.length, 2);
    callbacks[1]!({ access_token: 'token-b', expires_in: 3600, scope: REQUIRED_SCOPE });
    assert.deepEqual(await connectionB, { accountId: 'account-b' });

    firstLookup.resolve(new Response(JSON.stringify({ user: { permissionId: 'account-a' } }), { status: 200 }));
    await assert.rejects(pendingA, error => error instanceof GoogleAuthError && error.code === 'cancelled');
    assert.deepEqual(auth.currentAccount, { accountId: 'account-b' });
    assert.equal(auth.tokenForRequest(), 'token-b');
  } finally {
    globalThis.fetch = fetchOriginal;
    restoreGlobal('window', windowDescriptor);
  }
});

test('rejects a token that expires before account validation without publishing an account', async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const fetchOriginal = globalThis.fetch;
  installGoogle({ access_token: 'short-lived-token', expires_in: 0, scope: REQUIRED_SCOPE });
  let driveRequests = 0;
  globalThis.fetch = async () => {
    driveRequests += 1;
    return new Response(JSON.stringify({ user: { permissionId: 'account-2' } }), { status: 200 });
  };
  try {
    const auth = new GoogleOAuth('public-client-id');
    await assert.rejects(auth.connect(), error => error instanceof GoogleAuthError && error.code === 'expired');
    assert.equal(auth.currentAccount, undefined);
    assert.equal(driveRequests, 0);
    assert.throws(() => auth.tokenForRequest(), error => error instanceof GoogleAuthError && error.code === 'expired');
  } finally {
    globalThis.fetch = fetchOriginal;
    restoreGlobal('window', windowDescriptor);
  }
});
