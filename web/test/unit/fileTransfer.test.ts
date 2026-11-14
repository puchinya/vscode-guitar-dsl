import assert from 'node:assert/strict';
import test from 'node:test';
import type { DocumentIdentity, DocumentSnapshot } from '@guitardsl/document';
import type { DriveFile } from '../../src/storage/googleDrive';
import { moveLocalDocumentToDrive, type LocalTransferStore, type TransferDrivePort } from '../../src/storage/fileTransfer';
import type { StoredDocument } from '../../src/storage/indexedDb';

const identity: DocumentIdentity = { storage: 'local', fileId: 'local-1' };
const sourceSnapshot: DocumentSnapshot = { identity, revision: 3, source: 'title: Song\n| C | G |\n' };

function setup() {
  let local: StoredDocument | undefined = {
    identity, name: 'Song.guitardsl', source: 'old', revision: 1, createdAt: 10, updatedAt: 10
  };
  const remote = new Map<string, { file: DriveFile; source: string }>();
  const store: LocalTransferStore = {
    async commitLocal(snapshot, name) {
      if (!local || snapshot.revision < local.revision) return undefined;
      local = { ...local, name: name ?? local.name, source: snapshot.source, revision: snapshot.revision };
      return { ...local };
    },
    async setPendingDriveFile(_identity, driveFileId, folderId) {
      if (!local) throw new Error('missing local');
      local = { ...local, pendingDriveFileId: driveFileId, pendingDriveFolderId: folderId };
    },
    async completeLocalMove(snapshot, expectedName) {
      if (!local || local.name !== expectedName || local.revision !== snapshot.revision || local.source !== snapshot.source) return false;
      local = undefined;
      return true;
    }
  };
  let createCount = 0;
  const drive: TransferDrivePort = {
    async getFile(fileId) {
      const found = remote.get(fileId);
      if (!found) throw Object.assign(new Error('not found'), { status: 404 });
      return { ...found, etag: 'etag-1' };
    },
    async findMoveUpload(_folderId, localFileId) {
      return [...remote.values()].find(item => item.file.appProperties?.guitardslLocalId === localFileId)?.file;
    },
    async createFile(folderId, name, source, localFileId) {
      createCount += 1;
      const file: DriveFile = {
        id: `drive-${createCount}`, name, version: '1', modifiedTime: '2026-11-13T00:00:00Z',
        parents: [folderId], appProperties: { ...(localFileId ? { guitardslLocalId: localFileId } : {}) }
      };
      remote.set(file.id, { file, source });
      return file;
    }
  };
  return {
    store, drive, remote,
    get local() { return local; },
    get createCount() { return createCount; },
    removeLocal() { local = undefined; },
    changeLocal(snapshot: DocumentSnapshot) {
      if (!local) throw new Error('missing local');
      local = { ...local, revision: snapshot.revision, source: snapshot.source };
    }
  };
}

test('a failed upload keeps the committed local source', async () => {
  const context = setup();
  context.drive.createFile = async () => { throw new Error('offline'); };
  await assert.rejects(moveLocalDocumentToDrive(sourceSnapshot, 'Song.guitardsl', 'folder-1', 'account-1', context.drive, context.store), /offline/);
  assert.equal(context.local?.source, sourceSnapshot.source);
  assert.equal(context.local?.pendingDriveFileId, undefined);
});

test('a response lost after upload is recovered by the local ID without a duplicate', async () => {
  const context = setup();
  let loseResponse = true;
  const create = context.drive.createFile.bind(context.drive);
  context.drive.createFile = async (...args) => {
    const file = await create(...args);
    if (loseResponse) { loseResponse = false; throw new Error('connection lost after upload'); }
    return file;
  };
  await assert.rejects(moveLocalDocumentToDrive(sourceSnapshot, 'Song.guitardsl', 'folder-1', 'account-1', context.drive, context.store), /connection lost/);
  const moved = await moveLocalDocumentToDrive(sourceSnapshot, 'Song.guitardsl', 'folder-1', 'account-1', context.drive, context.store);
  assert.equal(context.createCount, 1);
  assert.equal(context.local, undefined);
  assert.equal(moved.identity.fileId, 'drive-1');
});

test('deduplicates concurrent move requests for the same document snapshot', async () => {
  const context = setup();
  const first = moveLocalDocumentToDrive(sourceSnapshot, 'Song.guitardsl', 'folder-1', 'account-1', context.drive, context.store);
  const second = moveLocalDocumentToDrive(sourceSnapshot, 'Song.guitardsl', 'folder-1', 'account-1', context.drive, context.store);

  assert.equal(second, first);
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.identity.fileId, secondResult.identity.fileId);
  assert.equal(context.createCount, 1);
  assert.equal(context.local, undefined);
});

test('rejects a conflicting concurrent move snapshot before a second upload starts', async () => {
  const context = setup();
  const first = moveLocalDocumentToDrive(sourceSnapshot, 'Song.guitardsl', 'folder-1', 'account-1', context.drive, context.store);
  const newer = { ...sourceSnapshot, revision: sourceSnapshot.revision + 1, source: `${sourceSnapshot.source}lyr: | newer |\n` };

  await assert.rejects(moveLocalDocumentToDrive(newer, 'Song.guitardsl', 'folder-1', 'account-1', context.drive, context.store), /already in progress/);
  await first;
  assert.equal(context.createCount, 1);
  assert.equal(context.local, undefined);
});

test('readback mismatch keeps the local source and transfer marker', async () => {
  const context = setup();
  const read = context.drive.getFile.bind(context.drive);
  context.drive.getFile = async id => ({ ...(await read(id)), source: 'wrong' });
  await assert.rejects(moveLocalDocumentToDrive(sourceSnapshot, 'Song.guitardsl', 'folder-1', 'account-1', context.drive, context.store), /did not match/);
  assert.equal(context.local?.source, sourceSnapshot.source);
  assert.equal(context.local?.pendingDriveFileId, 'drive-1');
});

test('keeps a newer cross-tab draft when the verified upload finishes', async () => {
  const context = setup();
  const complete = context.store.completeLocalMove.bind(context.store);
  context.store.completeLocalMove = async (snapshot, expectedName, remote) => {
    context.changeLocal({ ...snapshot, revision: snapshot.revision + 1, source: `${snapshot.source}lyr: | newer draft |\n` });
    return complete(snapshot, expectedName, remote);
  };

  await assert.rejects(
    moveLocalDocumentToDrive(sourceSnapshot, 'Song.guitardsl', 'folder-1', 'account-1', context.drive, context.store),
    /changed during transfer and was kept/
  );
  assert.equal(context.local?.revision, sourceSnapshot.revision + 1);
  assert.equal(context.local?.source, `${sourceSnapshot.source}lyr: | newer draft |\n`);
  assert.equal(context.local?.pendingDriveFileId, 'drive-1');
  assert.equal(context.createCount, 1);
});

test('a local finalization failure can be retried against the same Drive file', async () => {
  const context = setup();
  let failFinalization = true;
  const complete = context.store.completeLocalMove.bind(context.store);
  context.store.completeLocalMove = async (snapshot, expectedName, remote) => {
    if (failFinalization) throw new Error('local store unavailable');
    return complete(snapshot, expectedName, remote);
  };
  await assert.rejects(moveLocalDocumentToDrive(sourceSnapshot, 'Song.guitardsl', 'folder-1', 'account-1', context.drive, context.store), /Drive copy is verified/);
  assert.equal(context.local?.pendingDriveFileId, 'drive-1');
  failFinalization = false;
  const moved = await moveLocalDocumentToDrive(sourceSnapshot, 'Song.guitardsl', 'folder-1', 'account-1', context.drive, context.store);
  assert.equal(context.createCount, 1);
  assert.equal(context.local, undefined);
  assert.equal(moved.identity.fileId, 'drive-1');
});
