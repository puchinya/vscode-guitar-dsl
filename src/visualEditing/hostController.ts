export type VisualEditingSessionKind = 'preview' | 'variables';

export interface VisualEditingSessionIdentity {
  readonly kind: VisualEditingSessionKind;
  readonly uri: string;
  readonly documentVersion: number;
  readonly renderGeneration: number;
  readonly sessionGeneration: number;
  readonly revision: number;
}

interface MutableSession {
  kind: VisualEditingSessionKind;
  uri: string;
  documentVersion: number;
  renderGeneration: number;
  sessionGeneration: number;
  revision: number;
}

/** VS Code independent lifecycle guard for Preview edits and Inspector variable drafts. */
export class VisualEditingHostController {
  private readonly sessions = new Map<VisualEditingSessionKind, MutableSession>();
  private readonly applyingUris = new Set<string>();
  private nextGeneration = 1;
  private disposed = false;

  begin(kind: VisualEditingSessionKind, uri: string, documentVersion: number, renderGeneration: number): VisualEditingSessionIdentity | undefined {
    if (this.disposed || !uri || !Number.isSafeInteger(documentVersion) || documentVersion < 0
      || !Number.isSafeInteger(renderGeneration) || renderGeneration < 0) return undefined;
    const session: MutableSession = {
      kind, uri, documentVersion, renderGeneration,
      sessionGeneration: this.nextGeneration++, revision: 0
    };
    this.sessions.set(kind, session);
    return this.snapshot(session);
  }

  current(kind: VisualEditingSessionKind): VisualEditingSessionIdentity | undefined {
    const session = this.sessions.get(kind);
    return session ? this.snapshot(session) : undefined;
  }

  advanceRevision(identity: VisualEditingSessionIdentity): VisualEditingSessionIdentity | undefined {
    const session = this.sessions.get(identity.kind);
    if (!session || !this.matches(session, identity)) return undefined;
    session.revision++;
    return this.snapshot(session);
  }

  matchesCurrent(identity: VisualEditingSessionIdentity, current: { uri: string; documentVersion: number; renderGeneration: number }): boolean {
    const session = this.sessions.get(identity.kind);
    return !!session && this.matches(session, identity)
      && session.uri === current.uri
      && session.documentVersion === current.documentVersion
      && session.renderGeneration === current.renderGeneration;
  }

  async applyOnce<T>(identity: VisualEditingSessionIdentity, current: () => { uri: string; documentVersion: number; renderGeneration: number } | undefined,
    apply: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: 'stale' | 'busy' | 'disposed' }> {
    if (this.disposed) return { ok: false, code: 'disposed' };
    const target = current();
    if (!target || !this.matchesCurrent(identity, target)) return { ok: false, code: 'stale' };
    if (this.applyingUris.has(identity.uri)) return { ok: false, code: 'busy' };
    this.applyingUris.add(identity.uri);
    try {
      const latest = current();
      if (!latest || !this.matchesCurrent(identity, latest)) return { ok: false, code: 'stale' };
      return { ok: true, value: await apply() };
    } finally {
      this.applyingUris.delete(identity.uri);
    }
  }

  cancel(kind: VisualEditingSessionKind): void {
    this.sessions.delete(kind);
  }

  invalidateUri(uri: string): void {
    for (const [kind, session] of this.sessions) if (session.uri === uri) this.sessions.delete(kind);
  }

  dispose(): void {
    this.disposed = true;
    this.sessions.clear();
    this.applyingUris.clear();
  }

  private matches(session: MutableSession, identity: VisualEditingSessionIdentity): boolean {
    return session.kind === identity.kind && session.uri === identity.uri
      && session.documentVersion === identity.documentVersion
      && session.renderGeneration === identity.renderGeneration
      && session.sessionGeneration === identity.sessionGeneration
      && session.revision === identity.revision;
  }

  private snapshot(session: MutableSession): VisualEditingSessionIdentity {
    return Object.freeze({ ...session });
  }
}
