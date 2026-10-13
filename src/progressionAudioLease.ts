import type { ProgressionAuditionPlaybackData } from './render/previewHtml';

export interface ProgressionAudioStartRequest {
  readonly requestId: string;
  readonly generation: number;
  readonly sessionUri: string;
  readonly sessionVersion: number;
  readonly sessionGeneration: number;
  readonly candidateId: string;
  readonly side: 'A' | 'B';
  readonly mode: 'chord' | 'bars' | 'melody' | 'song';
  readonly speed: 50 | 75 | 100 | 125 | 150;
}

export interface ProgressionAudioStartMessage extends ProgressionAudioStartRequest {
  readonly command: 'progressionAudioStart';
  readonly leaseId: string;
  readonly playback: ProgressionAuditionPlaybackData;
}

export type ProgressionAudioAcknowledgement = {
  readonly command: 'progressionAudioStarted' | 'progressionAudioStopped' | 'progressionAudioFailed';
  readonly leaseId: string;
  readonly requestId: string;
};

export interface ProgressionAudioLeasePort {
  hasPreview(): boolean;
  lockPreview(leaseId: string): Promise<boolean>;
  unlockPreview(leaseId: string): void;
  startInspector(message: ProgressionAudioStartMessage): Promise<boolean>;
  stopInspector(leaseId: string, requestId: string): Promise<boolean>;
  reportStartError(requestId: string, message: string): void;
}

type LeaseState = 'lockingPreview' | 'startingInspector' | 'playing' | 'stopping';

interface ActiveLease {
  readonly leaseId: string;
  readonly request: ProgressionAudioStartRequest;
  readonly previewStopped: Deferred<boolean>;
  readonly started: Deferred<boolean>;
  readonly stopped: Deferred<boolean>;
  state: LeaseState;
  cancelled: boolean;
  unlockPreview: boolean;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

/** Serializes Inspector audition against the singleton Preview Webview transport. */
export class ProgressionAudioLeaseCoordinator {
  private active: ActiveLease | undefined;

  constructor(
    private readonly port: ProgressionAudioLeasePort,
    private readonly timeoutMs = 2000,
    private readonly createLeaseId: () => string = () => `progression-audio-${Date.now()}-${Math.random().toString(36).slice(2)}`
  ) {}

  get activeLeaseId(): string | undefined {
    return this.active?.leaseId;
  }

  async start(
    request: ProgressionAudioStartRequest,
    playback: ProgressionAuditionPlaybackData,
    isCurrent: () => boolean,
    unavailableMessage: string
  ): Promise<boolean> {
    if (this.active) {
      this.port.reportStartError(request.requestId, unavailableMessage);
      return false;
    }
    if (!isCurrent()) {
      this.port.reportStartError(request.requestId, unavailableMessage);
      return false;
    }

    const lease: ActiveLease = {
      leaseId: this.createLeaseId(),
      request,
      previewStopped: deferred<boolean>(),
      started: deferred<boolean>(),
      stopped: deferred<boolean>(),
      state: 'lockingPreview',
      cancelled: false,
      unlockPreview: false
    };
    this.active = lease;

    if (this.port.hasPreview()) {
      const posted = await this.port.lockPreview(lease.leaseId);
      lease.unlockPreview = posted;
      const previewStopped = posted && await this.wait(lease.previewStopped.promise);
      if (!previewStopped || lease.cancelled || this.active !== lease || !isCurrent()) {
        this.finish(lease);
        this.port.reportStartError(request.requestId, unavailableMessage);
        return false;
      }
    }

    if (lease.cancelled || this.active !== lease || !isCurrent()) {
      this.finish(lease);
      this.port.reportStartError(request.requestId, unavailableMessage);
      return false;
    }

    lease.state = 'startingInspector';
    const posted = await this.port.startInspector({
      command: 'progressionAudioStart',
      leaseId: lease.leaseId,
      ...request,
      playback
    });
    if (!posted) {
      this.finish(lease);
      return false;
    }

    const started = await this.wait(lease.started.promise);
    if (started === true && this.active === lease) {
      lease.state = 'playing';
      return true;
    }
    if (started === false) {
      this.finish(lease);
      return false;
    }

    // A timeout is uncertain: request a local stop and keep Preview locked until
    // the Inspector confirms silence or the view is disposed.
    await this.stop();
    return false;
  }

  acknowledgePreviewStopped(leaseId: string): void {
    const lease = this.active;
    if (!lease || lease.leaseId !== leaseId || lease.state !== 'lockingPreview') return;
    lease.previewStopped.resolve(true);
  }

  acknowledge(message: ProgressionAudioAcknowledgement): void {
    const lease = this.active;
    if (!lease || lease.leaseId !== message.leaseId || lease.request.requestId !== message.requestId) return;
    if (message.command === 'progressionAudioStarted') {
      if (lease.state === 'startingInspector') lease.started.resolve(true);
      return;
    }
    lease.started.resolve(false);
    if (message.command === 'progressionAudioStopped') lease.stopped.resolve(true);
    this.finish(lease);
  }

  async stop(): Promise<void> {
    const lease = this.active;
    if (!lease) return;
    if (lease.state === 'lockingPreview') {
      lease.cancelled = true;
      return;
    }
    if (lease.state === 'stopping') {
      await this.wait(lease.stopped.promise);
      return;
    }

    lease.state = 'stopping';
    const posted = await this.port.stopInspector(lease.leaseId, lease.request.requestId);
    if (!posted) {
      this.finish(lease);
      return;
    }
    const stopped = await this.wait(lease.stopped.promise);
    if (stopped === true && this.active === lease) this.finish(lease);
    // On timeout keep the lease and the Preview lock. Unlocking without a local
    // stop acknowledgement could allow two Webviews to produce sound together.
  }

  inspectorDisposed(): void {
    const lease = this.active;
    if (lease) this.finish(lease);
  }

  previewDisposed(): void {
    void this.stop();
  }

  dispose(): void {
    void this.stop();
  }

  private async wait<T>(promise: Promise<T>): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>(resolve => {
      timer = setTimeout(() => resolve(undefined), this.timeoutMs);
    });
    const result = await Promise.race([promise, timeout]);
    if (timer !== undefined) clearTimeout(timer);
    return result;
  }

  private finish(lease: ActiveLease): void {
    if (this.active !== lease) return;
    this.active = undefined;
    lease.started.resolve(false);
    lease.stopped.resolve(true);
    lease.previewStopped.resolve(false);
    if (lease.unlockPreview) this.port.unlockPreview(lease.leaseId);
  }
}
