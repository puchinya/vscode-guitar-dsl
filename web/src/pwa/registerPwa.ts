import { registerSW } from 'virtual:pwa-register';

export interface ReloadPreparation {
  prepareForReload(): Promise<{ ok: true } | { ok: false; reason: string }>;
  revalidateForActivation(): { ok: true } | { ok: false; reason: string };
  cancelPreparation(): void;
}

export interface PwaUpdateSnapshot {
  updateAvailable: boolean;
  offlineReady: boolean;
  updating: boolean;
  online: boolean;
  blockedReason?: string;
}

export interface PwaRuntime {
  snapshot(): Readonly<PwaUpdateSnapshot>;
  subscribe(callback: (snapshot: Readonly<PwaUpdateSnapshot>) => void): () => void;
  applyUpdate(): Promise<void>;
  dismissUpdate(): void;
  dispose(): void;
}

const INITIAL_SNAPSHOT: Readonly<PwaUpdateSnapshot> = Object.freeze({
  updateAvailable: false,
  offlineReady: false,
  updating: false,
  online: typeof navigator === 'undefined' || navigator.onLine
});

/** Register the production service worker and expose an explicit, safety-gated update action. */
export function registerPwa(preparation: ReloadPreparation): PwaRuntime {
  let current: Readonly<PwaUpdateSnapshot> = { ...INITIAL_SNAPSHOT };
  let disposed = false;
  let updateCheckTimer: number | undefined;
  const listeners = new Set<(snapshot: Readonly<PwaUpdateSnapshot>) => void>();
  const updateWindow = () => { if (!disposed) publish({ ...current, online: navigator.onLine }); };
  let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined;

  const publish = (next: PwaUpdateSnapshot): void => {
    if (disposed) return;
    current = Object.freeze(next);
    for (const listener of listeners) listener(current);
  };

  if (import.meta.env.PROD) {
    updateServiceWorker = registerSW({
      immediate: true,
      onNeedRefresh() {
        if (disposed) return;
        publish({ ...current, updateAvailable: true, blockedReason: undefined });
      },
      onOfflineReady() {
        if (disposed) return;
        publish({ ...current, offlineReady: true, online: navigator.onLine });
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration || disposed) return;
        if (updateCheckTimer !== undefined) window.clearInterval(updateCheckTimer);
        updateCheckTimer = window.setInterval(() => void registration.update(), 60 * 60 * 1000);
      }
    });
  }

  window.addEventListener('online', updateWindow);
  window.addEventListener('offline', updateWindow);

  return {
    snapshot: () => current,
    subscribe(callback) {
      listeners.add(callback);
      callback(current);
      return () => listeners.delete(callback);
    },
    async applyUpdate() {
      if (disposed) return;
      if (!current.updateAvailable || !updateServiceWorker || current.updating) return;
      publish({ ...current, updating: true, blockedReason: undefined });
      try {
        const prepared = await preparation.prepareForReload();
        if (disposed) return;
        if (!prepared.ok) {
          preparation.cancelPreparation();
          publish({ ...current, updating: false, blockedReason: prepared.reason });
          return;
        }
        const finalCheck = preparation.revalidateForActivation();
        if (!finalCheck.ok) {
          preparation.cancelPreparation();
          publish({ ...current, updating: false, blockedReason: finalCheck.reason });
          return;
        }
        await updateServiceWorker(true);
      } catch (error) {
        preparation.cancelPreparation();
        publish({
          ...current,
          updating: false,
          blockedReason: error instanceof Error ? error.message : 'The update could not be prepared.'
        });
      }
    },
    dismissUpdate() {
      if (disposed) return;
      publish({ ...current, updateAvailable: false, blockedReason: undefined });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      preparation.cancelPreparation();
      if (updateCheckTimer !== undefined) window.clearInterval(updateCheckTimer);
      window.removeEventListener('online', updateWindow);
      window.removeEventListener('offline', updateWindow);
      listeners.clear();
    }
  };
}
