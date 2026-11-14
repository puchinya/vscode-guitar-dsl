export type StorageKind = 'local' | 'drive';

export interface DocumentIdentity {
  storage: StorageKind;
  fileId: string;
}

export interface DocumentSnapshot {
  identity: DocumentIdentity;
  revision: number;
  source: string;
}

export interface SourceOffsetEdit {
  start: number;
  end: number;
  replacement: string;
}

export interface DocumentChangeSet {
  documentId: DocumentIdentity;
  expectedRevision: number;
  edits: readonly SourceOffsetEdit[];
}

export interface SaveRequest {
  documentId: DocumentIdentity;
  expectedRevision: number;
  source: string;
}

export type ChangeApplyResult =
  | { applied: true; revision: number; source: string }
  | { applied: false; reason: 'document-mismatch' | 'stale-revision' | 'invalid-edits' };

export function sameDocumentIdentity(a: DocumentIdentity, b: DocumentIdentity): boolean {
  return a.storage === b.storage && a.fileId === b.fileId;
}

export function documentIdentityKey(identity: DocumentIdentity, accountId?: string): string {
  return `${identity.storage}:${identity.storage === 'drive' ? accountId ?? '' : ''}:${identity.fileId}`;
}

export function documentTabKey(identity: DocumentIdentity, accountId?: string): string {
  return `${documentIdentityKey(identity)}:${identity.storage === 'drive' ? accountId ?? '' : ''}`;
}

/** Apply a sorted set of non-overlapping edits only to the requested document revision. */
export function applyChangeSet(snapshot: DocumentSnapshot, change: DocumentChangeSet): ChangeApplyResult {
  if (!sameDocumentIdentity(snapshot.identity, change.documentId)) {
    return { applied: false, reason: 'document-mismatch' };
  }
  if (snapshot.revision !== change.expectedRevision) {
    return { applied: false, reason: 'stale-revision' };
  }

  const edits = [...change.edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let previousEnd = 0;
  let previousStart = -1;
  for (const edit of edits) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) ||
        edit.start < previousEnd || edit.start === previousStart || edit.start < 0 || edit.end < edit.start ||
        edit.end > snapshot.source.length || typeof edit.replacement !== 'string') {
      return { applied: false, reason: 'invalid-edits' };
    }
    previousEnd = edit.end;
    previousStart = edit.start;
  }

  let source = snapshot.source;
  for (const edit of edits.reverse()) {
    source = source.slice(0, edit.start) + edit.replacement + source.slice(edit.end);
  }
  return { applied: true, revision: snapshot.revision + 1, source };
}
