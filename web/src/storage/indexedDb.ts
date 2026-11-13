import { documentIdentityKey, type DocumentIdentity, type DocumentSnapshot, type StorageKind } from '@guitardsl/document';

const DATABASE_NAME = 'guitardsl-workspace';
const DATABASE_VERSION = 1;
const DOCUMENTS = 'documents';
const DRAFTS = 'drafts';
const SETTINGS = 'settings';
const SESSIONS = 'sessions';

export interface StoredDocument {
  identity: DocumentIdentity;
  /** Stable Drive permission ID; never an access token or email address. */
  accountId?: string;
  name: string;
  source: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  driveVersion?: string;
  driveModifiedTime?: string;
  driveRevisionId?: string;
  driveEtag?: string;
  driveFolderId?: string;
  pendingDriveFileId?: string;
  pendingDriveFolderId?: string;
}

export interface PersistenceBase { revision: number; source: string }
interface DraftRecord extends DocumentSnapshot { key: string; updatedAt: number }
interface KeyValueRecord<T = unknown> { key: string; value: T }

function identityKey(identity: DocumentIdentity, accountId?: string): string {
  return documentIdentityKey(identity, accountId);
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new DOMException('IndexedDB request failed', 'UnknownError'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new DOMException('IndexedDB transaction failed', 'UnknownError'));
  });
}

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) return Promise.reject(new DOMException('IndexedDB is unavailable', 'NotSupportedError'));
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DOCUMENTS)) {
          const documents = db.createObjectStore(DOCUMENTS, { keyPath: 'key' });
          documents.createIndex('storage', 'identity.storage');
          documents.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS, { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => {
        databasePromise = undefined;
        reject(request.error ?? new DOMException('Could not open local storage', 'UnknownError'));
      };
      request.onblocked = () => {
        databasePromise = undefined;
        reject(new DOMException('Local storage upgrade is blocked by another tab', 'InvalidStateError'));
      };
    });
  }
  return databasePromise;
}

function record(document: StoredDocument): StoredDocument & { key: string } {
  return { ...document, key: identityKey(document.identity, document.accountId) };
}

export const indexedDb = {
  async listDocuments(storage: StorageKind, accountId?: string): Promise<StoredDocument[]> {
    const db = await openDatabase();
    const tx = db.transaction(DOCUMENTS, 'readonly');
    const done = transactionDone(tx);
    const rows = await idbRequest<(StoredDocument & { key: string })[]>(tx.objectStore(DOCUMENTS).index('storage').getAll(storage));
    await done;
    return rows.filter(row => storage !== 'drive' || row.accountId === accountId)
      .sort((a, b) => b.updatedAt - a.updatedAt).map(({ key: _key, ...row }) => row);
  },

  async getDocument(identity: DocumentIdentity, accountId?: string): Promise<StoredDocument | undefined> {
    const db = await openDatabase();
    const tx = db.transaction([DOCUMENTS, DRAFTS], 'readonly');
    const done = transactionDone(tx);
    const key = identityKey(identity, accountId);
    const [saved, draft] = await Promise.all([
      idbRequest<StoredDocument & { key: string } | undefined>(tx.objectStore(DOCUMENTS).get(key)),
      idbRequest<DraftRecord | undefined>(tx.objectStore(DRAFTS).get(key))
    ]);
    await done;
    if (!saved) return undefined;
    const { key: _key, ...base } = saved;
    return draft && draft.revision >= base.revision
      ? { ...base, source: draft.source, revision: draft.revision, updatedAt: Math.max(base.updatedAt, draft.updatedAt) }
      : base;
  },

  async getSavedDocument(identity: DocumentIdentity, accountId?: string): Promise<StoredDocument | undefined> {
    const db = await openDatabase();
    const tx = db.transaction(DOCUMENTS, 'readonly');
    const done = transactionDone(tx);
    const row = await idbRequest<StoredDocument & { key: string } | undefined>(tx.objectStore(DOCUMENTS).get(identityKey(identity, accountId)));
    await done;
    if (!row) return undefined;
    const { key: _key, ...document } = row;
    return document;
  },

  async getDraft(identity: DocumentIdentity, accountId?: string): Promise<DocumentSnapshot | undefined> {
    const db = await openDatabase();
    const tx = db.transaction(DRAFTS, 'readonly');
    const done = transactionDone(tx);
    const draft = await idbRequest<DraftRecord | undefined>(tx.objectStore(DRAFTS).get(identityKey(identity, accountId)));
    await done;
    if (!draft) return undefined;
    const { key: _key, updatedAt: _updatedAt, ...snapshot } = draft;
    return snapshot;
  },

  async createLocal(name: string, source: string): Promise<StoredDocument> {
    const now = Date.now();
    const document: StoredDocument = {
      identity: { storage: 'local', fileId: crypto.randomUUID() },
      name: name.trim() || 'Untitled.guitardsl', source, revision: 0, createdAt: now, updatedAt: now
    };
    const db = await openDatabase();
    const tx = db.transaction(DOCUMENTS, 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(DOCUMENTS).add(record(document));
    await done;
    return document;
  },

  async saveDraft(snapshot: DocumentSnapshot, accountId?: string, expected?: PersistenceBase): Promise<boolean> {
    const db = await openDatabase();
    const tx = db.transaction([DOCUMENTS, DRAFTS], 'readwrite');
    const done = transactionDone(tx);
    const key = identityKey(snapshot.identity, accountId);
    const store = tx.objectStore(DOCUMENTS);
    const row = await idbRequest<StoredDocument & { key: string } | undefined>(store.get(key));
    if (!row) {
      tx.abort();
      await done.catch(() => undefined);
      return false;
    }
    const existingDraft = await idbRequest<DraftRecord | undefined>(tx.objectStore(DRAFTS).get(key));
    // CAS against the latest committed document OR draft, not merely its edit revision.
    // Separate browser tabs can independently reach the same (or a larger) edit revision.
    const current = existingDraft && existingDraft.revision >= row.revision ? existingDraft : row;
    if (expected && (current.revision !== expected.revision || current.source !== expected.source)
      || snapshot.revision < current.revision
      || snapshot.revision === current.revision && snapshot.source !== current.source) {
      tx.abort();
      await done.catch(() => undefined);
      return false;
    }
    tx.objectStore(DRAFTS).put({ ...snapshot, key, updatedAt: Date.now() } satisfies DraftRecord);
    await done;
    return true;
  },

  async commitLocal(snapshot: DocumentSnapshot, name?: string, expected?: PersistenceBase): Promise<StoredDocument | undefined> {
    if (snapshot.identity.storage !== 'local') return undefined;
    const db = await openDatabase();
    const tx = db.transaction([DOCUMENTS, DRAFTS], 'readwrite');
    const done = transactionDone(tx);
    const key = identityKey(snapshot.identity);
    const store = tx.objectStore(DOCUMENTS);
    const saved = await idbRequest<StoredDocument & { key: string } | undefined>(store.get(key));
    const draft = await idbRequest<DraftRecord | undefined>(tx.objectStore(DRAFTS).get(key));
    const current = draft && saved && draft.revision >= saved.revision ? draft : saved;
    if (!saved || !current || expected && (current.revision !== expected.revision || current.source !== expected.source)
      || snapshot.revision < current.revision
      || snapshot.revision === current.revision && snapshot.source !== current.source) {
      tx.abort();
      await done.catch(() => undefined);
      return undefined;
    }
    const updated: StoredDocument = {
      ...saved, name: name?.trim() || saved.name, source: snapshot.source,
      revision: snapshot.revision, updatedAt: Date.now()
    };
    store.put(record(updated));
    tx.objectStore(DRAFTS).delete(key);
    await done;
    return updated;
  },

  async upsertDriveDocument(document: StoredDocument): Promise<void> {
    if (document.identity.storage !== 'drive') throw new TypeError('Drive documents must use Drive identity');
    const db = await openDatabase();
    const tx = db.transaction(DOCUMENTS, 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(DOCUMENTS).put(record(document));
    await done;
  },

  async completeLocalMove(snapshot: DocumentSnapshot, expectedName: string, remote: StoredDocument): Promise<boolean> {
    if (snapshot.identity.storage !== 'local' || remote.identity.storage !== 'drive') {
      throw new TypeError('A local document and verified Drive document are required');
    }
    const db = await openDatabase();
    const tx = db.transaction([DOCUMENTS, DRAFTS], 'readwrite');
    const done = transactionDone(tx);
    const localKey = identityKey(snapshot.identity);
    const documents = tx.objectStore(DOCUMENTS);
    const local = await idbRequest<StoredDocument & { key: string } | undefined>(documents.get(localKey));
    const draft = await idbRequest<DraftRecord | undefined>(tx.objectStore(DRAFTS).get(localKey));
    if (!local || local.name !== expectedName || local.revision !== snapshot.revision || local.source !== snapshot.source
      || draft && (draft.revision !== snapshot.revision || draft.source !== snapshot.source)) {
      tx.abort();
      await done.catch(() => undefined);
      return false;
    }
    documents.put(record(remote));
    documents.delete(localKey);
    tx.objectStore(DRAFTS).delete(localKey);
    await done;
    return true;
  },

  async commitDriveDocument(document: StoredDocument, snapshot: DocumentSnapshot, preserveNewerDraft = false): Promise<boolean> {
    if (document.identity.storage !== 'drive' || snapshot.identity.storage !== 'drive'
      || !sameIdentity(document.identity, snapshot.identity)) throw new TypeError('Drive document identities do not match');
    const db = await openDatabase();
    const tx = db.transaction([DOCUMENTS, DRAFTS], 'readwrite');
    const done = transactionDone(tx);
    const key = identityKey(document.identity, document.accountId);
    const current = await idbRequest<StoredDocument & { key: string } | undefined>(tx.objectStore(DOCUMENTS).get(key));
    const draft = await idbRequest<DraftRecord | undefined>(tx.objectStore(DRAFTS).get(key));
    const newerDraft = !!draft && (draft.revision > snapshot.revision
      || draft.revision === snapshot.revision && draft.source !== snapshot.source);
    if ((newerDraft && !preserveNewerDraft) || current && current.revision > snapshot.revision) {
      tx.abort();
      await done.catch(() => undefined);
      return false;
    }
    tx.objectStore(DOCUMENTS).put(record(document));
    if (!newerDraft) tx.objectStore(DRAFTS).delete(key);
    await done;
    return true;
  },

  async deleteDocument(identity: DocumentIdentity, accountId?: string): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction([DOCUMENTS, DRAFTS], 'readwrite');
    const done = transactionDone(tx);
    const key = identityKey(identity, accountId);
    tx.objectStore(DOCUMENTS).delete(key);
    tx.objectStore(DRAFTS).delete(key);
    await done;
  },

  async getValue<T>(storeName: typeof SETTINGS | typeof SESSIONS, key: string): Promise<T | undefined> {
    const db = await openDatabase();
    const tx = db.transaction(storeName, 'readonly');
    const done = transactionDone(tx);
    const row = await idbRequest<KeyValueRecord<T> | undefined>(tx.objectStore(storeName).get(key));
    await done;
    return row?.value;
  },

  async setValue<T>(storeName: typeof SETTINGS | typeof SESSIONS, key: string, value: T): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(storeName, 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(storeName).put({ key, value } satisfies KeyValueRecord<T>);
    await done;
  },

  async renameLocal(identity: DocumentIdentity, name: string): Promise<void> {
    if (identity.storage !== 'local') throw new TypeError('Only local documents can be renamed here');
    const db = await openDatabase();
    const tx = db.transaction(DOCUMENTS, 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore(DOCUMENTS);
    const row = await idbRequest<StoredDocument & { key: string } | undefined>(store.get(identityKey(identity)));
    if (!row) {
      tx.abort();
      await done.catch(() => undefined);
      throw new DOMException('Document was deleted', 'NotFoundError');
    }
    store.put({ ...row, name: name.trim() || row.name, updatedAt: Date.now() });
    await done;
  },

  async setPendingDriveFile(identity: DocumentIdentity, driveFileId: string, folderId: string): Promise<void> {
    if (identity.storage !== 'local') throw new TypeError('Only local documents can be transferred');
    const db = await openDatabase();
    const tx = db.transaction(DOCUMENTS, 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore(DOCUMENTS);
    const key = identityKey(identity);
    const row = await idbRequest<StoredDocument & { key: string } | undefined>(store.get(key));
    if (!row) {
      tx.abort();
      await done.catch(() => undefined);
      throw new DOMException('Document was deleted', 'NotFoundError');
    }
    store.put({ ...row, pendingDriveFileId: driveFileId, pendingDriveFolderId: folderId });
    await done;
  }
};

export function keyForDocument(identity: DocumentIdentity): string {
  return identityKey(identity);
}

function sameIdentity(a: DocumentIdentity, b: DocumentIdentity): boolean {
  return a.storage === b.storage && a.fileId === b.fileId;
}
