import assert from 'node:assert/strict';
import test from 'node:test';
import { applyChangeSet, sameDocumentIdentity, type DocumentSnapshot } from '@guitardsl/document';

test('document identity includes storage and file id', () => {
  assert.equal(sameDocumentIdentity({ storage: 'local', fileId: 'song-1' }, { storage: 'local', fileId: 'song-1' }), true);
  assert.equal(sameDocumentIdentity({ storage: 'local', fileId: 'song-1' }, { storage: 'drive', fileId: 'song-1' }), false);
});

test('stale or overlapping changes are rejected without editing source', () => {
  const snapshot: DocumentSnapshot = { identity: { storage: 'local', fileId: 'song-1' }, revision: 3, source: 'C | G' };
  assert.deepEqual(applyChangeSet(snapshot, { documentId: snapshot.identity, expectedRevision: 2, edits: [{ start: 0, end: 1, replacement: 'D' }] }), { applied: false, reason: 'stale-revision' });
  assert.deepEqual(applyChangeSet(snapshot, { documentId: snapshot.identity, expectedRevision: 3, edits: [{ start: 0, end: 2, replacement: 'D' }, { start: 1, end: 3, replacement: 'A' }] }), { applied: false, reason: 'invalid-edits' });
  assert.equal(snapshot.source, 'C | G');
});

test('same-offset insertions are rejected as ambiguous', () => {
  const snapshot: DocumentSnapshot = { identity: { storage: 'local', fileId: 'song-1' }, revision: 3, source: 'C | G' };
  assert.deepEqual(applyChangeSet(snapshot, {
    documentId: snapshot.identity, expectedRevision: 3,
    edits: [{ start: 1, end: 1, replacement: 'A' }, { start: 1, end: 1, replacement: 'B' }]
  }), { applied: false, reason: 'invalid-edits' });
  assert.equal(snapshot.source, 'C | G');
});

test('applies a source-preserving set in one new revision', () => {
  const snapshot: DocumentSnapshot = { identity: { storage: 'local', fileId: 'song-1' }, revision: 3, source: 'C | G' };
  assert.deepEqual(applyChangeSet(snapshot, { documentId: snapshot.identity, expectedRevision: 3, edits: [{ start: 0, end: 1, replacement: 'D' }] }), { applied: true, revision: 4, source: 'D | G' });
});
