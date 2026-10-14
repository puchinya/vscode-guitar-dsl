import * as assert from 'assert';
import {
  ProgressionAudioLeaseCoordinator,
  type ProgressionAudioStartMessage,
  type ProgressionAudioLeasePort
} from '../../src/progressionAudioLease';
import type { ProgressionAuditionPlaybackData } from '../../src/render/previewHtml';

const request = {
  requestId: 'request-1',
  generation: 7,
  sessionUri: 'file:///score.guitardsl',
  sessionVersion: 3,
  sessionGeneration: 2,
  candidateId: 'candidate-1',
  side: 'B' as const,
  mode: 'melody' as const,
  speed: 100 as const
};

const playback: ProgressionAuditionPlaybackData = {
  durationSeconds: 1,
  events: [{ kind: 'pitched', source: 'melody', timeSeconds: 0, durationSeconds: 0.5, midiNotes: [60] }]
};

class FakeLeasePort implements ProgressionAudioLeasePort {
  readonly events: string[] = [];
  startMessage: ProgressionAudioStartMessage | undefined;
  stopPosted = false;
  report: string | undefined;

  constructor(public previewOpen = true) {}

  hasPreview(): boolean { return this.previewOpen; }
  async lockPreview(leaseId: string): Promise<boolean> { this.events.push(`lock:${leaseId}`); return true; }
  unlockPreview(leaseId: string): void { this.events.push(`unlock:${leaseId}`); }
  async startInspector(message: ProgressionAudioStartMessage): Promise<boolean> {
    this.startMessage = message;
    this.events.push(`start:${message.leaseId}`);
    return true;
  }
  async stopInspector(leaseId: string, requestId: string): Promise<boolean> {
    this.stopPosted = true;
    this.events.push(`stop:${leaseId}:${requestId}`);
    return true;
  }
  reportStartError(_requestId: string, message: string): void { this.report = message; }
}

async function flush(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

describe('ProgressionAudioLeaseCoordinator', () => {
  it('waits for Preview silence before granting Inspector audio and unlocks after stop acknowledgement', async () => {
    const port = new FakeLeasePort();
    const coordinator = new ProgressionAudioLeaseCoordinator(port, 200, () => 'lease-1');
    const started = coordinator.start(request, playback, () => true, 'unavailable');
    assert.deepStrictEqual(port.events, ['lock:lease-1']);

    coordinator.acknowledgePreviewStopped('stale-lease');
    assert.strictEqual(port.startMessage, undefined);
    coordinator.acknowledgePreviewStopped('lease-1');
    await flush();
    assert.strictEqual(port.startMessage?.leaseId, 'lease-1');
    coordinator.acknowledge({ command: 'progressionAudioStarted', leaseId: 'lease-1', requestId: 'request-1' });
    assert.strictEqual(await started, true);
    assert.strictEqual(coordinator.activeLeaseId, 'lease-1');
    assert.strictEqual(coordinator.activeSessionUri, request.sessionUri);

    const stopping = coordinator.stop();
    await flush();
    assert.strictEqual(port.stopPosted, true);
    assert.strictEqual(coordinator.activeLeaseId, 'lease-1', 'the lease remains until local silence is confirmed');
    coordinator.acknowledge({ command: 'progressionAudioStopped', leaseId: 'lease-1', requestId: 'request-1' });
    await stopping;
    assert.strictEqual(coordinator.activeLeaseId, undefined);
    assert.strictEqual(coordinator.activeSessionUri, undefined);
    assert.deepStrictEqual(port.events, ['lock:lease-1', 'start:lease-1', 'stop:lease-1:request-1', 'unlock:lease-1']);
  });

  it('stops a granted Inspector lease while its local audio start is still pending', async () => {
    const port = new FakeLeasePort();
    const coordinator = new ProgressionAudioLeaseCoordinator(port, 200, () => 'lease-pending-start');
    const started = coordinator.start(request, playback, () => true, 'unavailable');
    coordinator.acknowledgePreviewStopped('lease-pending-start');
    await flush();

    assert.strictEqual(port.startMessage?.leaseId, 'lease-pending-start');
    assert.strictEqual(coordinator.activeSessionUri, request.sessionUri);
    const stopping = coordinator.stop();
    await flush();
    assert.ok(port.events.includes('stop:lease-pending-start:request-1'));
    assert.strictEqual(coordinator.activeSessionUri, request.sessionUri,
      'the Host keeps the lease while it waits for the Inspector silence acknowledgement');

    coordinator.acknowledge({ command: 'progressionAudioStopped', leaseId: 'lease-pending-start', requestId: 'request-1' });
    await Promise.all([started, stopping]);
    assert.strictEqual(coordinator.activeLeaseId, undefined);
    assert.strictEqual(coordinator.activeSessionUri, undefined);
    assert.ok(port.events.includes('unlock:lease-pending-start'), 'Preview unlocks only after the stop acknowledgement');
  });

  it('ignores stale old-session stop and audio-failure signals while a newer lease is active', async () => {
    const port = new FakeLeasePort();
    const newerRequest = { ...request, requestId: 'request-new', sessionUri: 'file:///new-score.guitardsl' };
    const coordinator = new ProgressionAudioLeaseCoordinator(port, 200, () => 'lease-new');
    const started = coordinator.start(newerRequest, playback, () => true, 'unavailable');
    coordinator.acknowledgePreviewStopped('lease-new');
    await flush();
    assert.strictEqual(port.startMessage?.leaseId, 'lease-new');
    coordinator.acknowledge({ command: 'progressionAudioStarted', leaseId: 'lease-new', requestId: 'request-new' });
    assert.strictEqual(await started, true);

    const eventsBeforeStaleSignals = [...port.events];
    await coordinator.stopForSession(request.sessionUri);
    coordinator.acknowledge({ command: 'progressionAudioFailed', leaseId: 'stale-lease', requestId: request.requestId });
    assert.deepStrictEqual(port.events, eventsBeforeStaleSignals,
      'late cleanup and a stale start failure from the old session do not stop or unlock the newer lease');
    assert.strictEqual(coordinator.activeLeaseId, 'lease-new');
    assert.strictEqual(coordinator.activeSessionUri, newerRequest.sessionUri);

    const stopping = coordinator.stopForSession(newerRequest.sessionUri);
    await flush();
    assert.ok(port.events.includes('stop:lease-new:request-new'));
    coordinator.acknowledge({ command: 'progressionAudioStopped', leaseId: 'lease-new', requestId: 'request-new' });
    await stopping;
    assert.strictEqual(coordinator.activeLeaseId, undefined);
    assert.ok(port.events.includes('unlock:lease-new'));
  });

  it('does not grant audio when the request becomes stale while Preview is stopping', async () => {
    const port = new FakeLeasePort();
    const coordinator = new ProgressionAudioLeaseCoordinator(port, 100, () => 'lease-2');
    let current = true;
    const started = coordinator.start(request, playback, () => current, 'unavailable');
    current = false;
    coordinator.acknowledgePreviewStopped('lease-2');

    assert.strictEqual(await started, false);
    assert.strictEqual(port.startMessage, undefined);
    assert.strictEqual(coordinator.activeLeaseId, undefined);
    assert.strictEqual(port.report, 'unavailable');
    assert.ok(port.events.includes('unlock:lease-2'));
  });

  it('does not wait for or unlock a nonexistent Preview panel', async () => {
    const port = new FakeLeasePort(false);
    const coordinator = new ProgressionAudioLeaseCoordinator(port, 100, () => 'lease-3');
    const started = coordinator.start(request, playback, () => true, 'unavailable');
    await flush();
    assert.strictEqual(port.events[0], 'start:lease-3');
    coordinator.acknowledge({ command: 'progressionAudioFailed', leaseId: 'lease-3', requestId: 'request-1' });
    assert.strictEqual(await started, false);
    assert.strictEqual(coordinator.activeLeaseId, undefined);
    assert.deepStrictEqual(port.events, ['start:lease-3']);
  });
});
