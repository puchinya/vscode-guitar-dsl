import type { DocumentIdentity, DocumentSnapshot } from '@guitardsl/document';
import type { DriveFile } from './googleDrive';
import { indexedDb, type StoredDocument } from './indexedDb';

export class MoveVerificationError extends Error {
  constructor(message: string) { super(message); this.name = 'MoveVerificationError'; }
}

export class MoveRecoveryError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'MoveRecoveryError'; }
}

export class LocalMoveConflictError extends MoveRecoveryError {
  constructor(message: string) { super(message); this.name = 'LocalMoveConflictError'; }
}

export interface TransferDrivePort {
  getFile(fileId: string): Promise<{ file: DriveFile; source: string; etag?: string }>;
  findMoveUpload(folderId: string, localFileId: string): Promise<DriveFile | undefined>;
  createFile(folderId: string, name: string, source: string, localFileId?: string): Promise<DriveFile>;
}

export interface LocalTransferStore {
  commitLocal(snapshot: DocumentSnapshot, name?: string): Promise<StoredDocument | undefined>;
  setPendingDriveFile(identity: DocumentIdentity, driveFileId: string, folderId: string): Promise<void>;
  completeLocalMove(snapshot: DocumentSnapshot, expectedName: string, remote: StoredDocument): Promise<boolean>;
}

interface ActiveMove {
  revision: number;
  source: string;
  folderId: string;
  accountId: string;
  promise: Promise<StoredDocument>;
}

const activeMoves = new Map<string, ActiveMove>();

/** Local-to-Drive move is restartable: Drive appProperties identify a prior upload after a crash. */
export function moveLocalDocumentToDrive(
  snapshot: DocumentSnapshot,
  name: string,
  folderId: string,
  accountId: string,
  drive: TransferDrivePort,
  store: LocalTransferStore = indexedDb
): Promise<StoredDocument> {
  if (snapshot.identity.storage !== 'local') return Promise.reject(new TypeError('Only a local document can be moved'));
  const key = snapshot.identity.fileId;
  const active = activeMoves.get(key);
  if (active) {
    if (active.revision === snapshot.revision && active.source === snapshot.source
      && active.folderId === folderId && active.accountId === accountId) return active.promise;
    return Promise.reject(new DOMException('A move for this document is already in progress', 'InvalidStateError'));
  }

  const promise = performLocalDocumentMove(snapshot, name, folderId, accountId, drive, store);
  activeMoves.set(key, { revision: snapshot.revision, source: snapshot.source, folderId, accountId, promise });
  void promise.then(
    () => { if (activeMoves.get(key)?.promise === promise) activeMoves.delete(key); },
    () => { if (activeMoves.get(key)?.promise === promise) activeMoves.delete(key); }
  );
  return promise;
}

async function performLocalDocumentMove(
  snapshot: DocumentSnapshot,
  name: string,
  folderId: string,
  accountId: string,
  drive: TransferDrivePort,
  store: LocalTransferStore
): Promise<StoredDocument> {
  if (snapshot.identity.storage !== 'local') throw new TypeError('Only a local document can be moved');
  const local = await store.commitLocal(snapshot, name);
  if (!local) throw new DOMException('The local document changed before transfer', 'InvalidStateError');

  let file: DriveFile | undefined;
  if (local.pendingDriveFileId) {
    if (local.pendingDriveFolderId !== folderId) {
      throw new Error('A Drive upload is already pending in another folder. Choose that folder and retry to avoid duplicate copies.');
    }
    try {
      file = (await drive.getFile(local.pendingDriveFileId)).file;
    } catch (error) {
      if (!(error instanceof Error && 'status' in error && (error as { status: number }).status === 404)) throw error;
    }
  }
  if (!file) file = await drive.findMoveUpload(folderId, local.identity.fileId);
  if (!file) file = await drive.createFile(folderId, local.name, local.source, local.identity.fileId);
  await store.setPendingDriveFile(local.identity, file.id, folderId);

  const downloaded = await drive.getFile(file.id);
  if (downloaded.source !== local.source || downloaded.file.name !== local.name) {
    throw new MoveVerificationError('The uploaded Drive file did not match the local source. The local document was kept.');
  }
  const remote: StoredDocument = {
    identity: { storage: 'drive', fileId: downloaded.file.id }, accountId,
    name: downloaded.file.name, source: downloaded.source, revision: 0,
    createdAt: local.createdAt, updatedAt: Date.now(), driveVersion: downloaded.file.version,
    driveModifiedTime: downloaded.file.modifiedTime, driveRevisionId: downloaded.file.headRevisionId,
    driveEtag: downloaded.etag, driveFolderId: folderId
  };
  try {
    // Check the source and remove the local row in one IndexedDB transaction. Another tab may
    // have saved a newer draft while the upload and readback were in flight.
    if (!await store.completeLocalMove(snapshot, local.name, remote)) {
      throw new LocalMoveConflictError('The Drive copy is verified, but the local document changed during transfer and was kept.');
    }
  } catch (error) {
    if (error instanceof MoveRecoveryError) throw error;
    throw new MoveRecoveryError('The Drive copy is verified, but the local original remains. Retry the move to finish without creating another copy.', { cause: error });
  }
  return remote;
}

export function downloadSource(name: string, source: string): void {
  const blob = new Blob([source], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = /\.(guitardsl|gdsl)$/i.test(name) ? name : `${name}.guitardsl`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function importLocalFile(file: File): Promise<StoredDocument> {
  if (!/\.(guitardsl|gdsl)$/i.test(file.name)) throw new TypeError('Choose a .guitardsl or .gdsl file.');
  return indexedDb.createLocal(file.name, await file.text());
}
