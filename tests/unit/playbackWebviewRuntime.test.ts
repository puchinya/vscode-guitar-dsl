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

const IRREGULAR_RHYTHM_SCORE = [
  'bpm: 120',
  'time: 4/4',
  '| C | 4.d 8 4 8 4 |'
].join('\n');

const IRREGULAR_MELODY_SCORE = [
  'bpm: 120',
  'time: 4/4',
  '| C |',
  'mel: | c4/4 d4/8 e4/8 f4/2 |'
].join('\n');

const LEAD_SHEET_RHYTHM_SCORE = [
  'bpm: 120',
  'time: 4/4',
  'show_rhythm: false',
  '| C | 4.d 8 4 8 4 |'
].join('\n');

const SECTION_SCORE = [
  'bpm: 120',
  'time: 4/4',
  '[Verse]',
  '| C | D |',
  '[Chorus]',
  '| Em | G |',
  '[Verse]',
  '| Am |'
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

async function assertPlayheadAlignsWithOnsets(runtime: FakePlaybackWebview): Promise<void> {
  const occurrence = runtime.playbackData.occurrences[0];
  assert.ok(occurrence);
  const anchor = runtime.playbackAnchor(occurrence!.measureIndex);
  assert.ok(anchor);

  const durationBeats = Number(anchor!.getAttribute('data-playback-duration-beats'));
  const columns = (anchor!.getAttribute('data-playback-columns') ?? '').split(';').map(value => {
    const [beat, x] = value.split(':').map(Number);
    return { beat, x };
  });
  const onsetColumns = columns.filter(column => column.beat > 0);
  assert.ok(onsetColumns.length > 1, 'the renderer exports multiple notation onset columns');

  await runtime.click('btn-play');
  for (const column of onsetColumns) {
    const onsetSeconds = occurrence!.startSeconds + occurrence!.durationSeconds * column.beat / durationBeats;
    runtime.setRange('playback-seek', onsetSeconds);
    await runtime.change('playback-seek');
    runtime.runAnimationFrames();
    closeEnough(runtime.playbackPlayheadX() ?? NaN, column.x, 0.001);
  }

  const [left, right] = columns;
  const betweenBeat = (left.beat + right.beat) / 2;
  const betweenSeconds = occurrence!.startSeconds + occurrence!.durationSeconds * betweenBeat / durationBeats;
  runtime.setRange('playback-seek', betweenSeconds);
  await runtime.change('playback-seek');
  runtime.runAnimationFrames();
  closeEnough(runtime.playbackPlayheadX() ?? NaN, (left.x + right.x) / 2, 0.001);
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

  it('T04a aligns the playhead with rendered rhythm columns at each onset', async () => {
    await assertPlayheadAlignsWithOnsets(createRuntime(IRREGULAR_RHYTHM_SCORE));
  });

  it('T04b aligns the playhead with rendered melody columns at each onset', async () => {
    await assertPlayheadAlignsWithOnsets(createRuntime(IRREGULAR_MELODY_SCORE));
  });

  it('T04c aligns the playhead with lead-sheet beat slashes', async () => {
    await assertPlayheadAlignsWithOnsets(createRuntime(LEAD_SHEET_RHYTHM_SCORE));
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

  it('T09 Practice speed is clamped, persisted, and host commands use the same controls', async () => {
    const runtime = createRuntime();
    await runtime.click('practice-toggle');
    assert.strictEqual(runtime.element('practice-speed').disabled, false);
    assert.strictEqual(runtime.element('practice-speed').value, '100');
    runtime.element('practice-speed').value = '75';
    await runtime.change('practice-speed');
    assert.strictEqual(runtime.element('practice-speed').value, '75');
    assert.strictEqual((runtime.savedWebviewState as { practiceSpeed: number }).practiceSpeed, 75);

    await runtime.click('btn-play');
    runtime.advanceAudioTime(0.525);
    runtime.runSchedulerTicks();
    closeEnough(Number(runtime.element('playback-seek').value), 0.375, 0.02);
    await runtime.sendPlaybackAction('practiceFaster');
    assert.strictEqual((runtime.savedWebviewState as { practiceSpeed: number }).practiceSpeed, 80);
    assert.strictEqual(runtime.intervalCount, 1, 'speed changes keep one scheduler');

    const restored = createRuntime(PLAYABLE_SCORE, runtime.savedWebviewState);
    assert.strictEqual(restored.element('practice-toggle').getAttribute('aria-pressed'), 'true');
    assert.strictEqual(restored.element('practice-speed').value, '80');
  });

  it('T10 A/B loop uses a half-open interval, rejects B at or before A, and wraps playback', async () => {
    const runtime = createRuntime();
    await runtime.click('practice-toggle');
    runtime.setRange('playback-seek', 0.5);
    await runtime.change('playback-seek');
    await runtime.click('practice-set-a');
    runtime.setRange('playback-seek', 0.25);
    await runtime.change('playback-seek');
    await runtime.click('practice-set-b');
    assert.match(runtime.element('playback-error').textContent, /after A|later than A/i);

    runtime.setRange('playback-seek', 0.75);
    await runtime.change('playback-seek');
    await runtime.click('practice-set-b');
    closeEnough(Number(runtime.element('playback-seek').value), 0.5);
    await runtime.click('btn-play');

    for (let elapsed = 0; elapsed < 0.35; elapsed += 0.025) {
      runtime.advanceAudioTime(0.025);
      runtime.runSchedulerTicks();
    }
    const clipped = runtime.scheduledOscillators().find((node) => {
      const duration = (node.stopAt ?? 0) - (node.startAt ?? 0);
      return Math.abs(duration - 0.252) < 0.01;
    });
    assert.ok(clipped, 'a note crossing B is clipped at the exclusive loop end');

    for (let elapsed = 0; elapsed < 0.75; elapsed += 0.025) {
      runtime.advanceAudioTime(0.025);
      runtime.runSchedulerTicks();
    }
    const wrappedPosition = Number(runtime.element('playback-seek').value);
    assert.ok(wrappedPosition >= 0.5 && wrappedPosition < 0.75, `wrapped position ${wrappedPosition} stays in [A, B)`);
    assert.strictEqual(runtime.intervalCount, 1);
  });

  it('T11 named Section loop follows contiguous labels and loop points keep occurrence identity', async () => {
    const runtime = createRuntime(SECTION_SCORE);
    assert.deepStrictEqual(runtime.playbackData.occurrences.map((occurrence: any) => occurrence.sectionName),
      ['Verse', undefined, 'Chorus', undefined, 'Verse']);
    await runtime.click('practice-toggle');
    runtime.element('practice-loop').value = 'section';
    await runtime.change('practice-loop');
    assert.strictEqual(runtime.element('practice-loop').value, 'section');
    runtime.setRange('playback-seek', 2.1);
    await runtime.change('playback-seek');
    assert.strictEqual(Number(runtime.element('playback-seek').value), 0, 'seeking outside the selected section returns to its start');

    const unnamed = createRuntime();
    await unnamed.click('practice-toggle');
    unnamed.element('practice-loop').value = 'section';
    await unnamed.change('practice-loop');
    assert.strictEqual(unnamed.element('practice-loop').value, 'off');
    assert.ok(unnamed.element('playback-error').textContent.length > 0, 'unnamed Section reports a localized status');
  });

  it('T12 playback highlight, playhead, Follow scrolling, and manual navigation stay in the Preview', async () => {
    const runtime = createRuntime();
    await runtime.click('practice-toggle');
    runtime.setAnchorRectTop(900);
    await runtime.click('btn-play');
    assert.ok(runtime.scoreOverlayElementCount() >= 2, 'playback adds a highlight and playhead to the score SVG');
    assert.ok(runtime.scrollY > 0, 'Follow keeps the active measure in the safe viewport band');

    await runtime.fireWindowEvent('wheel');
    assert.strictEqual(runtime.element('practice-follow').getAttribute('aria-pressed'), 'false');
    assert.strictEqual((runtime.savedWebviewState as { followEnabled: boolean }).followEnabled, false);
    await runtime.click('practice-follow');
    assert.strictEqual(runtime.element('practice-follow').getAttribute('aria-pressed'), 'true');

    await runtime.click('btn-stop');
    assert.strictEqual(runtime.scoreOverlayElementCount(), 0, 'Stop removes transient SVG overlay nodes');
  });

  it('T13 Practice count-in runs after a non-zero seek and holds the selected score position', async () => {
    const runtime = createRuntime(PICKUP_SCORE);
    await runtime.click('practice-toggle');
    runtime.setChecked('count-in-toggle', true);
    await runtime.change('count-in-toggle');
    runtime.setRange('playback-seek', 0.25);
    await runtime.change('playback-seek');
    await runtime.click('btn-play');

    assert.strictEqual(countCountInFrequencies(runtime), runtime.playbackData.occurrences[0].countInClicks.length);
    runtime.advanceAudioTime(0.4);
    runtime.runSchedulerTicks();
    closeEnough(Number(runtime.element('playback-seek').value), 0.25);
  });

  it('T14 playback-ineligible scores disable Practice and report a localized reason for host actions', async () => {
    const runtime = createRuntime('|: C |');
    assert.strictEqual(runtime.playbackData.available, false);
    assert.strictEqual(runtime.element('practice-toggle').disabled, true);
    await runtime.sendPlaybackAction('practiceFaster');
    assert.ok(runtime.element('playback-error').textContent.length > 0);
    assert.strictEqual(runtime.audioContextCount, 0);
  });

  it('T15 Practice OFF clears A/B, uses normal speed, and rebuild restores preferences without transient loop state', async () => {
    const runtime = createRuntime();
    await runtime.click('practice-toggle');
    runtime.element('practice-speed').value = '75';
    await runtime.change('practice-speed');
    runtime.setRange('playback-seek', 0.25);
    await runtime.change('playback-seek');
    await runtime.click('practice-set-a');
    runtime.setRange('playback-seek', 0.75);
    await runtime.change('playback-seek');
    await runtime.click('practice-set-b');
    assert.strictEqual(runtime.element('practice-loop').value, 'ab');

    const rebuilt = createRuntime(PLAYABLE_SCORE, runtime.savedWebviewState);
    assert.strictEqual(rebuilt.element('practice-toggle').getAttribute('aria-pressed'), 'true');
    assert.strictEqual(rebuilt.element('practice-speed').value, '75');
    assert.strictEqual(rebuilt.element('practice-loop').value, 'off');
    assert.strictEqual(Number(rebuilt.element('playback-seek').value), 0);
    assert.strictEqual(rebuilt.scoreOverlayElementCount(), 0);
    assert.strictEqual(rebuilt.intervalCount, 0);

    await runtime.click('practice-toggle');
    assert.strictEqual(runtime.element('practice-toggle').getAttribute('aria-pressed'), 'false');
    assert.strictEqual(runtime.element('practice-loop').value, 'off');
    const savedState = runtime.savedWebviewState as { practiceEnabled: boolean; practiceSpeed: number };
    assert.strictEqual(savedState.practiceEnabled, false);
    assert.strictEqual(savedState.practiceSpeed, 75);

    runtime.setRange('playback-seek', 0);
    await runtime.change('playback-seek');
    await runtime.click('btn-play');
    runtime.advanceAudioTime(0.2);
    runtime.runSchedulerTicks();
    closeEnough(Number(runtime.element('playback-seek').value), 0.2, 0.03);
    assert.strictEqual(runtime.intervalCount, 1);
  });
});
