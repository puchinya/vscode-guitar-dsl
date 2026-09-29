import * as assert from 'assert';
import { compileGuitarDslToHtml } from '../../src/render/previewHtml';
import { createFakePlaybackWebview, FakePlaybackWebview } from './helpers/fakePlaybackWebview';

const PLAYABLE_SCORE = [
  'bpm: 120',
  'time: 4/4',
  '| C | 4.d 4.d 4.d 4.d |',
  'mel: | c4/4 d4/4 e4/4 f4/4 |'
].join('\n');

const PICKUP_SCORE = [
  'bpm: 120',
  'time: 6/8',
  'pickup: 8+8',
  '| C |',
  'mel: | c4/8 d4/8 |'
].join('\n');

function createRuntime(score = PLAYABLE_SCORE, state?: unknown): FakePlaybackWebview {
  return createFakePlaybackWebview(compileGuitarDslToHtml(score), state);
}

function totalStopCalls(runtime: FakePlaybackWebview): number {
  return runtime.scheduledOscillators().reduce((sum, oscillator) => sum + oscillator.stopCalls.length, 0);
}

function closeEnough(actual: number, expected: number, tolerance = 0.01): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

function countCountInFrequencies(runtime: FakePlaybackWebview): number {
  return runtime.scheduledOscillators().filter((oscillator) => {
    const frequency = oscillator.frequency.value;
    return Math.abs(frequency - 700) < 0.01 || Math.abs(frequency - 1000) < 0.01;
  }).length;
}

describe('Preview production Webview runtime', () => {
  it('T01 creates one lazy AudioContext and bounds scheduling to the 100 ms horizon', async () => {
    const runtime = createRuntime();
    assert.strictEqual(runtime.playbackData.available, true);
    assert.strictEqual(runtime.audioContextCount, 0, 'AudioContext is lazy until Play');

    const totalScoreVoices = runtime.playbackData.events.reduce((sum: number, event: any) => {
      return sum + (Array.isArray(event.midiNotes) ? event.midiNotes.length : 0);
    }, 0);
    await runtime.click('btn-play');

    assert.strictEqual(runtime.audioContextCount, 1);
    assert.strictEqual(runtime.intervalCount, 1);
    assert.ok(runtime.scheduledOscillators().length < totalScoreVoices, 'the entire score is not scheduled up front');
    assert.ok(runtime.scheduledOscillators().every((node) => (node.startAt ?? Infinity) <= 0.1));

    runtime.advanceAudioTime(0.5);
    runtime.runSchedulerTicks();
    closeEnough(Number(runtime.element('playback-seek').value), 0.475, 0.02);
    assert.strictEqual(runtime.intervalCount, 1, 'scheduler remains singular while playing');
  });

  it('T02 Pause fades active nodes without a click and freezes position; Resume continues without another scheduler', async () => {
    const runtime = createRuntime();
    await runtime.click('btn-play');
    runtime.advanceAudioTime(0.45);
    runtime.runSchedulerTicks();
    await runtime.click('btn-pause');

    const pausedAt = Number(runtime.element('playback-seek').value);
    assert.strictEqual(runtime.intervalCount, 0);
    const pausedNodes = runtime.activeOscillators();
    assert.ok(pausedNodes.length > 0, 'active voices stay connected only for the short fade');
    assert.ok(pausedNodes.every((node) => (node.stopAt ?? Infinity) <= 0.458001), 'all active and future voices stop within 8 ms');
    const fadingNodes = pausedNodes.filter((node) => (node.startAt ?? Infinity) <= 0.45 && (node.stopAt ?? 0) > 0.45);
    assert.ok(fadingNodes.length > 0, 'currently sounding voices use the fade');
    for (const node of fadingNodes) {
      const gainEvents = (node.connectedTo as { gain: { events: Array<{ kind: string; value: number; time: number }> } }).gain.events;
      assert.ok(gainEvents.some((event) => event.kind === 'ramp' && event.value === 0 && event.time === node.stopAt),
        'the gain ramps to zero at the oscillator stop time');
    }
    assert.strictEqual(runtime.element('btn-play').getAttribute('aria-label'), 'Resume');
    runtime.advanceAudioTime(0.7);
    runtime.runSchedulerTicks();
    closeEnough(Number(runtime.element('playback-seek').value), pausedAt);

    await runtime.click('btn-play');
    assert.strictEqual(runtime.intervalCount, 1);
    closeEnough(Number(runtime.element('playback-seek').value), pausedAt);
    assert.strictEqual(runtime.audioContextCount, 1);
  });

  it('T03 Stop clears future audio and resets the seek position without creating another context', async () => {
    const runtime = createRuntime();
    await runtime.click('btn-play');
    runtime.advanceAudioTime(0.55);
    runtime.runSchedulerTicks();
    await runtime.click('btn-stop');

    assert.strictEqual(runtime.intervalCount, 0);
    assert.strictEqual(runtime.activeOscillators().length, 0);
    assert.strictEqual(Number(runtime.element('playback-seek').value), 0);
    assert.strictEqual(runtime.element('btn-play').getAttribute('aria-label'), 'Play');
    assert.strictEqual(runtime.element('btn-stop').disabled, true);
    assert.strictEqual(runtime.audioContextCount, 1);
  });

  it('T04 Seek cancels the previous schedule and anchors once at the target without count-in', async () => {
    const runtime = createRuntime();
    await runtime.click('btn-play');
    runtime.advanceAudioTime(0.45);
    runtime.runSchedulerTicks();
    const previousNodes = [...runtime.scheduledOscillators()];

    runtime.setRange('playback-seek', 1);
    await runtime.change('playback-seek');

    assert.ok(previousNodes.every((node) => (node.stopAt ?? Infinity) <= 0.458001), 'pre-seek nodes are stopped or fading out');
    runtime.advanceAudioTime(0.009);
    assert.ok(previousNodes.every((node) => node.disconnected), 'pre-seek nodes disconnect after the fade');
    assert.strictEqual(runtime.intervalCount, 1, 'seek reuses one scheduler interval');
    closeEnough(Number(runtime.element('playback-seek').value), 1);
    assert.ok(runtime.scheduledOscillators().every((node) => node.disconnected || (node.startAt ?? -Infinity) >= 0.475));
  });

  it('T05 count-in lasts a full first meter, holds score position at zero, and is start-only', async () => {
    const runtime = createRuntime(PICKUP_SCORE);
    closeEnough(runtime.playbackData.countInDurationSeconds, 1.5);
    assert.ok(runtime.playbackData.durationSeconds < runtime.playbackData.countInDurationSeconds,
      'the pickup is shorter than a full 6/8 count-in');
    runtime.setChecked('count-in-toggle', true);
    await runtime.change('count-in-toggle');
    await runtime.click('btn-play');

    const initialClickCount = runtime.playbackData.countInClicks.length;
    assert.strictEqual(runtime.scheduledOscillators().length, initialClickCount);
    runtime.advanceAudioTime(0.2);
    runtime.runSchedulerTicks();
    assert.strictEqual(Number(runtime.element('playback-seek').value), 0, 'score position remains zero during count-in');

    await runtime.click('btn-pause');
    const clicksBeforeResume = countCountInFrequencies(runtime);
    await runtime.click('btn-play');
    assert.strictEqual(countCountInFrequencies(runtime), clicksBeforeResume, 'Resume does not schedule count-in clicks');

    await runtime.click('btn-pause');
    runtime.setRange('playback-seek', 0.25);
    await runtime.change('playback-seek');
    const clicksBeforeNonZeroPlay = countCountInFrequencies(runtime);
    await runtime.click('btn-play');
    assert.strictEqual(countCountInFrequencies(runtime), clicksBeforeNonZeroPlay, 'Play after a non-zero seek skips count-in');
  });

  it('T06 Metronome toggles and cancels clicks during playback; both toggles persist and restore', async () => {
    const runtime = createRuntime();
    assert.strictEqual(runtime.element('count-in-toggle').checked, false);
    assert.strictEqual(runtime.element('metronome-toggle').checked, false);
    await runtime.click('btn-play');
    assert.strictEqual(countCountInFrequencies(runtime), 0, 'Metronome OFF schedules no click');

    runtime.setChecked('count-in-toggle', true);
    await runtime.change('count-in-toggle');
    runtime.setChecked('metronome-toggle', true);
    await runtime.change('metronome-toggle');
    const saved = runtime.savedWebviewState as { currentMode: string; countInEnabled: boolean; metronomeEnabled: boolean };
    assert.strictEqual(saved.currentMode, 'single');
    assert.strictEqual(saved.countInEnabled, true);
    assert.strictEqual(saved.metronomeEnabled, true);

    runtime.advanceAudioTime(0.45);
    runtime.runSchedulerTicks();
    const click = runtime.scheduledOscillators().find((node) => {
      const frequency = node.frequency.value;
      return !node.disconnected && (Math.abs(frequency - 700) < 0.01 || Math.abs(frequency - 1000) < 0.01);
    });
    assert.ok(click, 'Metronome ON schedules a click');

    const restored = createRuntime(PLAYABLE_SCORE, runtime.savedWebviewState);
    assert.strictEqual(restored.element('count-in-toggle').checked, true);
    assert.strictEqual(restored.element('metronome-toggle').checked, true);
    await restored.click('btn-play');
    restored.advanceAudioTime(restored.playbackData.countInDurationSeconds);
    restored.runSchedulerTicks();
    assert.ok(countCountInFrequencies(restored) > restored.playbackData.countInClicks.length,
      'restored Metronome ON schedules score clicks after the restored count-in');

    runtime.setChecked('metronome-toggle', false);
    await runtime.change('metronome-toggle');
    assert.ok(click && (click.stopAt ?? Infinity) <= 0.458001, 'Metronome OFF stops or fades a scheduled click');
    runtime.advanceAudioTime(0.009);
    assert.ok(click?.disconnected, 'the canceled click disconnects after its fade');
    assert.strictEqual(runtime.intervalCount, 1, 'transport continues after the toggle');
    const oscillatorCountAfterDisable = runtime.scheduledOscillators().length;
    runtime.advanceAudioTime(0.65);
    runtime.runSchedulerTicks();
    assert.ok(runtime.scheduledOscillators().slice(oscillatorCountAfterDisable).every((node) => {
      const frequency = node.frequency.value;
      return Math.abs(frequency - 700) >= 0.01 && Math.abs(frequency - 1000) >= 0.01;
    }), 'Metronome OFF schedules no later clicks');
    assert.ok(Number(runtime.element('playback-seek').value) > 0.5, 'transport continues after Metronome OFF');
    assert.strictEqual(runtime.intervalCount, 1);
    assert.strictEqual((runtime.savedWebviewState as { metronomeEnabled: boolean }).metronomeEnabled, false);
  });

  it('T07 pagehide cleanup clears intervals, nodes, and closes AudioContext once', async () => {
    const runtime = createRuntime();
    await runtime.click('btn-play');
    runtime.advanceAudioTime(0.05);
    runtime.runSchedulerTicks();
    await runtime.fireWindowEvent('pagehide');
    const stopsAfterCleanup = totalStopCalls(runtime);

    assert.strictEqual(runtime.intervalCount, 0);
    assert.strictEqual(runtime.activeOscillators().length, 0);
    assert.strictEqual(runtime.audioContextCloseCount, 1);
    await runtime.fireWindowEvent('pagehide');
    assert.strictEqual(totalStopCalls(runtime), stopsAfterCleanup);
    assert.strictEqual(runtime.audioContextCloseCount, 1);
  });

  it('T07 unload cleanup is independently idempotent', async () => {
    const runtime = createRuntime();
    await runtime.click('btn-play');
    await runtime.fireWindowEvent('unload');
    const stopsAfterCleanup = totalStopCalls(runtime);

    assert.strictEqual(runtime.intervalCount, 0);
    assert.strictEqual(runtime.activeOscillators().length, 0);
    assert.strictEqual(runtime.audioContextCloseCount, 1);
    await runtime.fireWindowEvent('unload');
    assert.strictEqual(totalStopCalls(runtime), stopsAfterCleanup);
    assert.strictEqual(runtime.audioContextCloseCount, 1);
  });

  it('T08 ended releases nodes and the next Play starts from score zero', async () => {
    const runtime = createRuntime();
    await runtime.click('btn-play');
    for (let elapsed = 0; elapsed < runtime.playbackData.durationSeconds + 0.1; elapsed += 0.1) {
      runtime.advanceAudioTime(0.1);
      runtime.runSchedulerTicks();
    }

    assert.strictEqual(runtime.intervalCount, 0);
    assert.strictEqual(runtime.activeOscillators().length, 0);
    closeEnough(Number(runtime.element('playback-seek').value), runtime.playbackData.durationSeconds, 0.02);
    assert.strictEqual(runtime.element('btn-play').getAttribute('aria-label'), 'Play');

    await runtime.click('btn-play');
    assert.strictEqual(runtime.intervalCount, 1);
    closeEnough(Number(runtime.element('playback-seek').value), 0);
    assert.strictEqual(runtime.audioContextCount, 1);
  });
});
