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

const LATER_SECTION_SCORE = [
  'bpm: 120',
  'time: 4/4',
  '[Verse]',
  '| C | D |',
  '[Chorus]',
  '| Em | G |'
].join('\n');

const UNNAMED_SECTION_SCORE = [
  'bpm: 120',
  'time: 4/4',
  '| C | D |'
].join('\n');

const REPEATED_MEASURE_SCORE = [
  'bpm: 120',
  'arrangement {',
  'Verse x2',
  '}',
  '[Verse]',
  '| C |'
].join('\n');

const REPEATED_SECTION_SCORE = [
  'bpm: 120',
  'arrangement {',
  'Verse x2',
  'Chorus',
  '}',
  '[Verse]',
  '| C | D |',
  '[Chorus]',
  '| G |'
].join('\n');

function createRuntime(score = PLAYABLE_SCORE, state?: unknown): FakePlaybackWebview {
  return createFakePlaybackWebview(compileGuitarDslToHtml(score, {
    documentUri: 'file:///fake-preview.guitardsl', documentVersion: 1, previewGeneration: 1
  }), state);
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
  it('Issue #155 keeps the detailed scroll guide and Practice-only SVG diagram geometry in the Preview runtime', async () => {
    const score = [
      'bpm: 120',
      'chord C = x32010',
      '| C | 4 8.m 8.b 8.s5 8 8 8 |',
      'mel: | c4/1 |'
    ].join('\n');
    const html = compileGuitarDslToHtml(score);
    const runtime = createFakePlaybackWebview(html);
    assert.strictEqual(runtime.playbackData.practiceGuide.automaticGrid, 8);
    assert.strictEqual(runtime.playbackData.practiceGuide.measures.length, 1);
    assert.ok(html.includes('id="practice-guide-panel"'));
    assert.ok(html.includes('body.guide-melody-hidden .practice-guide-melody { display: none; }'));
    assert.ok(html.includes('id="practice-guide-timeline"'));
    assert.ok(html.includes('class="practice-guide-lane practice-guide-melody"'));
    assert.ok(html.includes('class="practice-guide-lane practice-guide-technique"'));
    assert.ok(html.includes('class="practice-guide-next-chord" id="practice-guide-next-chord"'));
    assert.ok(html.includes('id="practice-guide-pair-page"'), 'compact mode has a fixed two-bank page');
    assert.ok(html.includes('value="compact"') || html.includes('<option value="compact">'), 'compact mode is the default');
    assert.strictEqual(runtime.playbackData.practiceGuide.measures[0].melody[0].durationBeats.n, 4);
    assert.strictEqual(runtime.playbackData.practiceGuide.measures[0].melody[0].pitches[0].midi, 60);
    assert.strictEqual(runtime.playbackData.practiceGuide.measures[0].lyrics.length, 0);
    assert.ok(html.includes('createBufferSource()'), 'brush attacks use a non-oscillator noise source');
    const diagram = html.match(/<svg class="practice-guide-diagram"[\s\S]*?<\/svg>/)?.[0] ?? '';
    assert.strictEqual((diagram.match(/x1="18" y1="[\d.]+" x2="126" y2="[\d.]+"/g) ?? []).length, 6,
      'the square diagram has six horizontal string lines');
    assert.strictEqual((diagram.match(/x1="[\d.]+" y1="18" x2="[\d.]+" y2="126"/g) ?? []).length, 6,
      'the square diagram has vertical fret marks and keeps the first string above the sixth');
    assert.ok(html.includes('.practice-guide-diagram-event { position: absolute;'));
    assert.ok(html.includes('viewBox="0 0 144 144"'));
    assert.ok(html.includes('width: 144px; height: 144px;'));

    const mute = runtime.playbackData.events.find((event: any) => event.kind === 'rhythmMute');
    const brush = runtime.playbackData.events.find((event: any) => event.kind === 'rhythmBrush');
    const stringAttack = runtime.playbackData.events.find((event: any) => event.kind === 'rhythmAttack' && event.stringAttack === 5);
    assert.ok(mute);
    assert.ok(brush && brush.midiNotes.length === 0);
    assert.deepStrictEqual(stringAttack?.midiNotes, [48]);

    await runtime.click('btn-play');
    const melody = runtime.scheduledOscillators().find(node => Math.abs(node.frequency.value - 261.625565) < 0.1);
    const rhythm = runtime.scheduledOscillators().find(node => node.frequency.value < 200);
    assert.ok(melody && rhythm, 'melody and accompaniment voices are both scheduled');
    runtime.advanceAudioTime(0.45);
    runtime.runSchedulerTicks();
    assert.strictEqual(melody!.stopCalls.length, 1, 'mute does not cancel the melody voice');
    closeEnough(rhythm!.stopAt ?? NaN, Number(mute.timeSeconds) + 0.033, 0.001);
  });

  it('Issue #153 adds a short accompaniment release tail only for new techniques, which mute cancels and rest keeps', async () => {
    const muteRuntime = createRuntime([
      'bpm: 120',
      '| C | 4.d 4.m 8.s5 8 4 |'
    ].join('\n'));
    const muteAttack = muteRuntime.playbackData.events.find((event: any) => event.kind === 'rhythmAttack');
    assert.strictEqual(muteAttack.releaseTailSeconds, 0.08);
    await muteRuntime.click('btn-play');
    muteRuntime.runSchedulerTicks();
    const mutedVoice = muteRuntime.scheduledOscillators().find(node => (node.startAt ?? Infinity) < 0.1 && node.frequency.value < 200);
    assert.ok(mutedVoice);
    const naturalTailEnd = mutedVoice!.startAt! + Number(muteAttack.durationSeconds) + 0.08 + 0.002;
    closeEnough(mutedVoice!.stopAt ?? NaN, naturalTailEnd, 0.001);
    muteRuntime.advanceAudioTime(0.45);
    muteRuntime.runSchedulerTicks();
    assert.ok((mutedVoice!.stopAt ?? Infinity) < naturalTailEnd, 'mute shortens the scheduled tail');
    const muteGain = (mutedVoice!.connectedTo as { gain: { events: Array<{ kind: string; value: number; time: number }> } }).gain;
    assert.ok(muteGain.events.some(event => event.kind === 'cancel'), 'mute cancels the old gain ramp');
    assert.ok(muteGain.events.some(event => event.kind === 'ramp' && event.value === 0), 'mute fades the active voice out');

    const restRuntime = createRuntime([
      'bpm: 120',
      '| C | 4.d r4 8.s5 8 4 |'
    ].join('\n'));
    const restAttack = restRuntime.playbackData.events.find((event: any) => event.kind === 'rhythmAttack');
    assert.strictEqual(restAttack.releaseTailSeconds, 0.08);
    await restRuntime.click('btn-play');
    restRuntime.runSchedulerTicks();
    const restingVoice = restRuntime.scheduledOscillators().find(node => (node.startAt ?? Infinity) < 0.1 && node.frequency.value < 200);
    assert.ok(restingVoice);
    const restTailEnd = restingVoice!.startAt! + Number(restAttack.durationSeconds) + 0.08 + 0.002;
    restRuntime.advanceAudioTime(0.45);
    restRuntime.runSchedulerTicks();
    closeEnough(restingVoice!.stopAt ?? NaN, restTailEnd, 0.001);
    const restGain = (restingVoice!.connectedTo as { gain: { events: Array<{ kind: string; value: number; time: number }> } }).gain;
    assert.ok(!restGain.events.some(event => event.kind === 'cancel'), 'a rest leaves the preceding note tail alone');

    const legacyRuntime = createRuntime('| C | 4.d 4 4 4 |');
    const legacyAttack = legacyRuntime.playbackData.events.find((event: any) => event.kind === 'rhythmAttack');
    assert.strictEqual(legacyAttack.releaseTailSeconds, undefined, 'scores without new techniques keep the legacy envelope');

    const brushRuntime = createRuntime('| C | 4.d.b 4 4 4 |');
    const brushScoreAttack = brushRuntime.playbackData.events.find((event: any) => event.kind === 'rhythmAttack');
    assert.strictEqual(brushScoreAttack.releaseTailSeconds, 0.08, 'the new .b spelling opts into the new-technique accompaniment envelope');
    const legacyGhostRuntime = createRuntime('| C | 4.d.g 4 4 4 |');
    const legacyGhostAttack = legacyGhostRuntime.playbackData.events.find((event: any) => event.kind === 'rhythmAttack');
    assert.strictEqual(legacyGhostAttack.releaseTailSeconds, undefined, 'the legacy .g spelling keeps its existing envelope');
  });

  it('Issue #155 preserves timed chord placements in the detailed guide and compact measure templates', () => {
    const score = '| C 4.d G 4.d C 4.d C 4.d |';
    const html = compileGuitarDslToHtml(score);
    const runtime = createFakePlaybackWebview(html);
    const chords = runtime.playbackData.practiceGuide.measures[0].chords;
    assert.deepStrictEqual(chords.map((chord: any) => [chord.name, chord.beat]), [
      ['C', 0], ['G', 1], ['C', 2], ['C', 3]
    ]);
    assert.strictEqual((html.match(/class="practice-guide-chord-name"/g) ?? []).length, 4);
    assert.strictEqual((html.match(/class="practice-guide-diagram-event"/g) ?? []).length, 4);
    assert.strictEqual((html.match(/class="practice-guide-compact-chord-name"/g) ?? []).length, 4);
    assert.strictEqual((html.match(/class="practice-guide-compact-diagram-event"/g) ?? []).length, 4);
  });

  it('Issue #155 keeps one vector wave per sustained event and selects its duration grid', async () => {
    const html = compileGuitarDslToHtml('| C | 4.d 4.d 4.d 16.d 16.d 16.d 16.d |');
    const runtime = createFakePlaybackWebview(html);
    assert.strictEqual(runtime.playbackData.practiceGuide.automaticGrid, 16);
    const compact = html.match(/<article class="practice-guide-compact-measure"[\s\S]*?<\/article>/)?.[0] ?? '';
    const markers = [...compact.matchAll(/<span class="practice-guide-compact-symbol"[^>]*data-guide-event="(\d+)"[^>]*>([\s\S]*?)<\/span>/g)];
    const waveCounts = markers.map(marker => (marker[2].match(/data-guide-wave-grid=/g) ?? []).length);
    assert.ok(waveCounts.some(count => count > 0), 'long attacks have a duration wave');
    assert.ok(waveCounts.every(count => count <= 2), 'a sustained event stores only its available grid-specific single wave');
    assert.ok(compact.includes('d="M2 9Q6 3 10 9T18 9"'), 'waves use the specified SVG path');
    assert.doesNotMatch(compact, /<text[^>]*>[↓↑〜]/, 'compact direction and wave marks do not use visible Unicode glyphs');

    for (const grid of ['4', '8', '16']) {
      runtime.element('practice-guide-grid').value = grid;
      await runtime.change('practice-guide-grid');
      assert.strictEqual(runtime.element('practice-guide-panel').getAttribute('data-guide-grid'), grid);
    }
  });

  it('Issue #153 draws rest symbols with SVG shapes instead of platform-dependent music fonts', () => {
    const html = compileGuitarDslToHtml('| C | r4 r8 r16 r2 r16 |');
    const symbols = [...html.matchAll(/<svg class="practice-guide-rest-symbol"[^>]*data-guide-rest-base="(\d+)"[^>]*>[\s\S]*?<\/svg>/g)];
    const bases = symbols.map(match => match[1]);
    assert.deepStrictEqual(bases.slice(0, 5), ['4', '8', '16', '2', '16'], 'the detailed timeline keeps each duration-specific rest');
    assert.deepStrictEqual(bases.slice(5), ['4', '8', '16', '2', '16'], 'the compact templates preserve the same duration-specific rests');
    assert.ok(symbols.every(match => /<(?:path|rect|circle)\b/.test(match[0])), 'every rest contains a vector path or shape');
    assert.ok(symbols.every(match => !/<text\b/.test(match[0])), 'rest rendering does not depend on installed music fonts');
  });

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
    assert.strictEqual(runtime.element('btn-play').getAttribute('aria-label'), 'Play');
    assert.strictEqual(runtime.element('btn-play').title, 'Play');
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
    assert.strictEqual(runtime.element('btn-play').title, 'Resume');
    runtime.advanceAudioTime(0.7);
    runtime.runSchedulerTicks();
    closeEnough(Number(runtime.element('playback-seek').value), pausedAt);

    await runtime.click('btn-play');
    assert.strictEqual(runtime.element('btn-play').getAttribute('aria-label'), 'Play');
    assert.strictEqual(runtime.element('btn-play').title, 'Play');
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
    assert.strictEqual(runtime.element('btn-play').title, 'Play');
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
    await runtime.click('preview-mode-practice');
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
    assert.strictEqual(restored.element('preview-mode-practice').getAttribute('aria-pressed'), 'false',
      'the transient UI mode returns to Normal when a new Preview Webview is built');
    assert.strictEqual(restored.element('practice-speed').value, '80');
  });

  it('uses one exclusive, transient mode selector for all six mode transitions', async () => {
    const runtime = createRuntime();
    const transitions = [
      ['preview-mode-edit', 'edit'],
      ['preview-mode-practice', 'practice'],
      ['preview-mode-normal', 'normal'],
      ['preview-mode-practice', 'practice'],
      ['preview-mode-edit', 'edit'],
      ['preview-mode-normal', 'normal']
    ] as const;
    for (const [control, expected] of transitions) {
      await runtime.click(control);
      assert.strictEqual(runtime.body.dataset.previewUiMode, expected, `${control} selects ${expected}`);
      assert.deepStrictEqual(
        ['normal', 'edit', 'practice'].map(mode => runtime.element(`preview-mode-${mode}`).getAttribute('aria-pressed')),
        ['normal', 'edit', 'practice'].map(mode => String(mode === expected)),
        `${expected} is the only selected mode`
      );
      assert.strictEqual(runtime.body.classList.contains('has-practice-row'), expected === 'practice');
      assert.strictEqual(runtime.element('preview-edit-row').hidden, expected !== 'edit');
    }
    assert.strictEqual(runtime.postedMessages.filter(message => message.command === 'previewUiModeRequest').length, 6,
      'each user transition is routed through the Host mode authority');
  });

  it('T09a Practice speed scales score time and note duration at 50%, 100%, and 150%', async () => {
    const firstEvent = createRuntime().playbackData.events.find((event: any) =>
      event.timeSeconds === 0 && Array.isArray(event.midiNotes) && event.midiNotes.length > 0
    );
    assert.ok(firstEvent, 'fixture has a note at the score start');

    for (const speed of [50, 100, 150]) {
      const runtime = createRuntime();
      await runtime.click('preview-mode-practice');
      runtime.element('practice-speed').value = String(speed);
      await runtime.change('practice-speed');
      await runtime.click('btn-play');
      runtime.advanceAudioTime(0.525);
      runtime.runSchedulerTicks();

      closeEnough(Number(runtime.element('playback-seek').value), 0.5 * speed / 100, 0.015);
      assert.strictEqual(runtime.intervalCount, 1, 'speed keeps one scheduler');
      const scoredNote = runtime.scheduledOscillators().find(node => Math.abs((node.startAt ?? Infinity) - 0.025) < 0.001);
      assert.ok(scoredNote, `score note scheduled at ${speed}%`);
      const actualDuration = (scoredNote!.stopAt ?? 0) - (scoredNote!.startAt ?? 0) - 0.002;
      closeEnough(actualDuration, Number(firstEvent!.durationSeconds) / (speed / 100), 0.01);
    }
  });

  it('T10 A/B loop uses a half-open interval, rejects B at or before A, and wraps playback', async () => {
    const runtime = createRuntime();
    await runtime.click('preview-mode-practice');
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
    closeEnough((clipped!.stopAt ?? 0) - (clipped!.startAt ?? 0), 0.25, 0.002,
      'the oscillator stops at B without the normal post-envelope safety padding');

    for (let elapsed = 0; elapsed < 0.75; elapsed += 0.025) {
      runtime.advanceAudioTime(0.025);
      runtime.runSchedulerTicks();
    }
    const wrappedPosition = Number(runtime.element('playback-seek').value);
    assert.ok(wrappedPosition >= 0.5 && wrappedPosition < 0.75, `wrapped position ${wrappedPosition} stays in [A, B)`);
    assert.strictEqual(runtime.intervalCount, 1);
  });

  it('T13 release tails stop at Measure and A/B loop boundaries across speeds and mute locations', async () => {
    const fixtures = [
      {
        name: '.m outside the loop',
        score: [
          'bpm: 120',
          'time: 4/4',
          '| C | 4.d 4.d 4.d 4.d |',
          '| G | 4.m 4.d 4.d 4.d |'
        ].join('\n')
      },
      {
        name: '.m inside the loop',
        score: [
          'bpm: 120',
          'time: 4/4',
          '| C | 4.d 4.m 4.d 4.d |',
          '| G | 4.d 4.d 4.d 4.d |'
        ].join('\n')
      }
    ];

    for (const fixture of fixtures) {
      for (const loopMode of ['measure', 'ab'] as const) {
        for (const speed of [50, 100, 200]) {
          const runtime = createRuntime(fixture.score);
          await runtime.click('preview-mode-practice');

          if (loopMode === 'measure') {
            runtime.setRange('playback-seek', 0);
            await runtime.change('playback-seek');
            runtime.element('practice-loop').value = 'measure';
            await runtime.change('practice-loop');
          } else {
            runtime.setRange('playback-seek', 0);
            await runtime.change('playback-seek');
            await runtime.click('practice-set-a');
            runtime.setRange('playback-seek', 2);
            await runtime.change('playback-seek');
            await runtime.click('practice-set-b');
            assert.strictEqual(runtime.element('practice-loop').value, 'ab');
          }

          runtime.element('practice-speed').value = String(speed);
          await runtime.change('practice-speed');
          const events = runtime.playbackData.events as Array<any>;
          const firstAttackEvent = events.find(event => event.kind === 'rhythmAttack' && Math.abs(event.timeSeconds) < 0.000001);
          const lastAttackEvent = events
            .filter(event => event.kind === 'rhythmAttack' && Math.abs(event.timeSeconds + event.durationSeconds - 2) < 0.000001)
            .sort((left, right) => right.timeSeconds - left.timeSeconds)[0];
          assert.ok(firstAttackEvent, `${fixture.name}/${loopMode}/${speed}% has an attack at A`);
          assert.ok(lastAttackEvent, `${fixture.name}/${loopMode}/${speed}% has an attack ending exactly at B`);
          assert.strictEqual(lastAttackEvent.releaseTailSeconds, 0.08);

          await runtime.click('btn-play');
          const chordVoices = () => runtime.scheduledOscillators().filter(node => node.type === 'triangle');
          const firstAttackStart = Math.min(...chordVoices().map(node => node.startAt ?? Number.POSITIVE_INFINITY));
          const speedRatio = speed / 100;
          const boundaryAudioTime = firstAttackStart + 2 / speedRatio;
          const lastAttackAudioTime = firstAttackStart + lastAttackEvent.timeSeconds / speedRatio;
          let audioNow = 0;
          while (audioNow < lastAttackAudioTime - 0.05) {
            runtime.advanceAudioTime(0.025);
            runtime.runSchedulerTicks();
            audioNow += 0.025;
          }
          const lastAttackVoices = chordVoices().filter(node => Math.abs((node.startAt ?? Infinity) - lastAttackAudioTime) < 0.002);
          assert.strictEqual(lastAttackVoices.length, lastAttackEvent.midiNotes.length,
            `${fixture.name}/${loopMode}/${speed}% schedules every voice for the final attack`);
          for (const voice of lastAttackVoices) {
            assert.ok((voice.stopAt ?? Infinity) <= boundaryAudioTime + 0.001,
              `${fixture.name}/${loopMode}/${speed}% stops the old voice by the exclusive B boundary`);
            const gain = (voice.connectedTo as { gain: { events: Array<{ kind: string; value: number; time: number }> } }).gain;
            assert.ok(gain.events.some(event => event.kind === 'ramp' && event.value === 0 && Math.abs(event.time - boundaryAudioTime) < 0.001),
              `${fixture.name}/${loopMode}/${speed}% ramps the old voice to silence by B`);
          }

          while (audioNow < boundaryAudioTime - 0.05) {
            runtime.advanceAudioTime(0.025);
            runtime.runSchedulerTicks();
            audioNow += 0.025;
          }
          const nextIterationVoices = chordVoices().filter(node => Math.abs((node.startAt ?? Infinity) - boundaryAudioTime) < 0.002);
          assert.strictEqual(nextIterationVoices.length, firstAttackEvent.midiNotes.length,
            `${fixture.name}/${loopMode}/${speed}% schedules the next iteration's attack at B`);
        }
      }
    }
  });

  it('re-attacks a tied rhythm once when a Practice measure loop starts at its continuation bar', async () => {
    const tied = [
      'bpm: 120',
      '| G | 4 4 4 8 8.t |',
      '| G | 4 4 4 4 |'
    ].join('\n');
    const runtime = createRuntime(tied);
    await runtime.click('preview-mode-practice');
    runtime.setRange('playback-seek', 2);
    await runtime.change('playback-seek');
    runtime.element('practice-loop').value = 'measure';
    await runtime.change('practice-loop');

    assert.strictEqual(runtime.element('practice-loop').value, 'measure');
    assert.strictEqual(Number(runtime.element('playback-seek').value), 2);
    const restart = runtime.playbackData.rhythmTieRestartEvents.find((event: any) => event.timeSeconds === 2);
    assert.ok(restart, 'timeline exposes a continuation restart at the loop boundary');

    await runtime.click('btn-play');
    const scheduledAtLoopStart = runtime.scheduledOscillators().filter(node =>
      Math.abs((node.startAt ?? Infinity) - 0.025) < 0.002
    );
    assert.strictEqual(scheduledAtLoopStart.length, restart.midiNotes.length,
      'the continuation chord is attacked exactly once at loop start');
    assert.ok(scheduledAtLoopStart.length > 0);
  });

  it('T10a A/B points stay separate from Measure and Section loops, and invalid Section selection preserves the current loop', async () => {
    for (const selection of [
      { score: SECTION_SCORE, mode: 'measure', outside: 2.5 },
      { score: SECTION_SCORE, mode: 'section', outside: 4.1 }
    ]) {
      const runtime = createRuntime(selection.score);
      await runtime.click('preview-mode-practice');
      runtime.setRange('playback-seek', 0.25);
      await runtime.change('playback-seek');
      await runtime.click('practice-set-a');
      runtime.setRange('playback-seek', 0.75);
      await runtime.change('playback-seek');
      await runtime.click('practice-set-b');
      assert.strictEqual(runtime.element('practice-loop').value, 'ab');

      runtime.element('practice-loop').value = selection.mode;
      await runtime.change('practice-loop');
      assert.strictEqual(runtime.element('practice-loop').value, selection.mode, 'valid named loop selection succeeds');
      runtime.element('practice-loop').value = 'ab';
      await runtime.change('practice-loop');
      runtime.setRange('playback-seek', selection.outside);
      await runtime.change('playback-seek');
      closeEnough(Number(runtime.element('playback-seek').value), selection.outside, 0.01,
        `A/B mode must not inherit the prior ${selection.mode} range`);
    }

    const invalidSection = createRuntime(UNNAMED_SECTION_SCORE);
    await invalidSection.click('preview-mode-practice');
    invalidSection.setRange('playback-seek', 2.1);
    await invalidSection.change('playback-seek');
    invalidSection.element('practice-loop').value = 'measure';
    await invalidSection.change('practice-loop');
    assert.strictEqual(invalidSection.element('practice-loop').value, 'measure');
    invalidSection.element('practice-loop').value = 'section';
    await invalidSection.change('practice-loop');
    assert.strictEqual(invalidSection.element('practice-loop').value, 'measure', 'unnamed Section failure restores the prior mode');
    invalidSection.setRange('playback-seek', 0.5);
    await invalidSection.change('playback-seek');
    closeEnough(Number(invalidSection.element('playback-seek').value), 2, 0.01, 'the existing Measure range is unchanged');
  });

  it('T10c Off, Clear, and Practice OFF clear all transient A/B points', async () => {
    for (const clearAction of ['off', 'clear', 'practice-off'] as const) {
      const runtime = createRuntime(SECTION_SCORE);
      await runtime.click('preview-mode-practice');
      runtime.setRange('playback-seek', 0.25);
      await runtime.change('playback-seek');
      await runtime.click('practice-set-a');
      runtime.setRange('playback-seek', 0.75);
      await runtime.change('playback-seek');
      await runtime.click('practice-set-b');
      assert.strictEqual(runtime.element('practice-loop').value, 'ab');

      if (clearAction === 'off') {
        runtime.element('practice-loop').value = 'off';
        await runtime.change('practice-loop');
      } else if (clearAction === 'clear') {
        await runtime.click('practice-clear-loop');
      } else {
        await runtime.click('preview-mode-normal');
      }
      runtime.element('practice-loop').value = 'ab';
      await runtime.change('practice-loop');
      runtime.setRange('playback-seek', 4.1);
      await runtime.change('playback-seek');
      closeEnough(Number(runtime.element('playback-seek').value), 4.1, 0.01,
        `${clearAction} must not leave an A/B range available to restore`);
    }
  });

  it('T10b Measure loop keeps the selected occurrence of a repeated source measure', async () => {
    const runtime = createRuntime(REPEATED_MEASURE_SCORE);
    const repeated = runtime.playbackData.occurrences.filter((occurrence: any) => occurrence.measureIndex === 0);
    assert.strictEqual(repeated.length, 2);
    assert.deepStrictEqual(repeated.map((occurrence: any) => occurrence.occurrenceIndex), [0, 1]);

    await runtime.click('preview-mode-practice');
    runtime.setRange('playback-seek', repeated[1].startSeconds + 0.25);
    await runtime.change('playback-seek');
    runtime.element('practice-loop').value = 'measure';
    await runtime.change('practice-loop');
    await runtime.click('btn-stop');
    closeEnough(Number(runtime.element('playback-seek').value), repeated[1].startSeconds, 0.01,
      'Stop returns to the second occurrence, not the source measure’s first occurrence');
  });

  it('S121-02 selecting Section from its later measure spans the full written section', async () => {
    const runtime = createRuntime(LATER_SECTION_SCORE);
    await runtime.click('preview-mode-practice');
    runtime.setRange('playback-seek', 2.1);
    await runtime.change('playback-seek');
    runtime.element('practice-loop').value = 'section';
    await runtime.change('practice-loop');
    assert.strictEqual(runtime.element('practice-loop').value, 'section');
    closeEnough(Number(runtime.element('playback-seek').value), 2.1, 0.01, 'selecting from D keeps the current position');

    runtime.setRange('playback-seek', 0.5);
    await runtime.change('playback-seek');
    closeEnough(Number(runtime.element('playback-seek').value), 0.5, 0.01, 'C belongs to the same Verse range');
    runtime.setRange('playback-seek', 4.1);
    await runtime.change('playback-seek');
    closeEnough(Number(runtime.element('playback-seek').value), 0, 0.01, 'Chorus is outside the Verse range');
    await runtime.click('btn-stop');
    closeEnough(Number(runtime.element('playback-seek').value), 0, 0.01, 'Stop returns to the Verse start');
  });

  it('S121-03 Section loop spans four measures in Verse x2 and stops before Chorus', async () => {
    const runtime = createRuntime(REPEATED_SECTION_SCORE);
    assert.deepStrictEqual(runtime.playbackData.occurrences.map((occurrence: any) => occurrence.sectionName),
      ['Verse', 'Verse', 'Verse', 'Verse', 'Chorus']);
    assert.deepStrictEqual(runtime.playbackData.occurrences.map((occurrence: any) => occurrence.startSeconds),
      [0, 2, 4, 6, 8]);
    await runtime.click('preview-mode-practice');
    runtime.setRange('playback-seek', 6.1);
    await runtime.change('playback-seek');
    runtime.element('practice-loop').value = 'section';
    await runtime.change('practice-loop');
    runtime.setRange('playback-seek', 6.1);
    await runtime.change('playback-seek');
    closeEnough(Number(runtime.element('playback-seek').value), 6.1, 0.01, 'second measure of the second repetition remains in the loop');
    runtime.setRange('playback-seek', 8.1);
    await runtime.change('playback-seek');
    closeEnough(Number(runtime.element('playback-seek').value), 0, 0.01, 'Chorus is outside the four-occurrence Verse loop');
    await runtime.click('btn-stop');
    closeEnough(Number(runtime.element('playback-seek').value), 0, 0.01, 'Stop returns to the first Verse occurrence');
  });

  it('S121-04 a later Verse separated by Chorus does not loop back to the earlier Verse', async () => {
    const runtime = createRuntime(SECTION_SCORE);
    assert.deepStrictEqual(runtime.playbackData.occurrences.map((occurrence: any) => occurrence.sectionName),
      ['Verse', 'Verse', 'Chorus', 'Chorus', 'Verse']);
    await runtime.click('preview-mode-practice');
    runtime.setRange('playback-seek', 8.1);
    await runtime.change('playback-seek');
    runtime.element('practice-loop').value = 'section';
    await runtime.change('practice-loop');
    runtime.setRange('playback-seek', 0.1);
    await runtime.change('playback-seek');
    closeEnough(Number(runtime.element('playback-seek').value), 8, 0.01, 'the later Verse range excludes the earlier same-name Verse');
    await runtime.click('btn-stop');
    closeEnough(Number(runtime.element('playback-seek').value), 8, 0.01, 'Stop returns to the later Verse start');
  });

  it('T11 named Section loop follows contiguous labels and loop points keep occurrence identity', async () => {
    const runtime = createRuntime(SECTION_SCORE);
    assert.deepStrictEqual(runtime.playbackData.occurrences.map((occurrence: any) => occurrence.sectionName),
      ['Verse', 'Verse', 'Chorus', 'Chorus', 'Verse']);
    await runtime.click('preview-mode-practice');
    runtime.element('practice-loop').value = 'section';
    await runtime.change('practice-loop');
    assert.strictEqual(runtime.element('practice-loop').value, 'section');
    runtime.setRange('playback-seek', 2.1);
    await runtime.change('playback-seek');
    assert.strictEqual(Number(runtime.element('playback-seek').value), 2.1, 'the second Verse measure remains in the selected section');
    runtime.setRange('playback-seek', 4.1);
    await runtime.change('playback-seek');
    assert.strictEqual(Number(runtime.element('playback-seek').value), 0, 'seeking into Chorus returns to the first Verse start');

    const unnamed = createRuntime();
    await unnamed.click('preview-mode-practice');
    unnamed.element('practice-loop').value = 'section';
    await unnamed.change('practice-loop');
    assert.strictEqual(unnamed.element('practice-loop').value, 'off');
    assert.ok(unnamed.element('playback-error').textContent.length > 0, 'unnamed Section reports a localized status');
  });

  it('T12 playback highlight, playhead, Follow scrolling, and manual navigation stay in the Preview', async () => {
    const runtime = createRuntime();
    await runtime.click('preview-mode-practice');
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

  it('T12a paused and ended score overlays move synchronously when display mode changes', async () => {
    for (const transportState of ['paused', 'ended'] as const) {
      const runtime = createRuntime();
      await runtime.click('btn-play');
      if (transportState === 'paused') {
        runtime.advanceAudioTime(0.45);
        runtime.runSchedulerTicks();
        await runtime.click('btn-pause');
      } else {
        runtime.advanceAudioTime(runtime.playbackData.durationSeconds + 0.1);
        runtime.runSchedulerTicks();
      }
      const heldPosition = Number(runtime.element('playback-seek').value);
      const audioContextCount = runtime.audioContextCount;
      assert.ok(runtime.scoreOverlayElementCount('page') >= 2, `${transportState} overlay starts in page SVG`);
      assert.strictEqual(runtime.intervalCount, 0, `${transportState} transport has no scheduler`);
      const pendingFrames = runtime.pendingAnimationFrameCount;

      await runtime.clickDisplayMode('web');

      assert.strictEqual(runtime.scoreOverlayElementCount('page'), 0, `${transportState} old page overlay is removed synchronously`);
      assert.ok(runtime.scoreOverlayElementCount('web') >= 2, `${transportState} overlay is attached to Web SVG immediately`);
      closeEnough(Number(runtime.element('playback-seek').value), heldPosition, 0.001, 'view change leaves playback position untouched');
      assert.strictEqual(runtime.audioContextCount, audioContextCount, 'view change creates no audio context');
      assert.strictEqual(runtime.intervalCount, 0, 'view change does not restart transport');
      assert.strictEqual(runtime.pendingAnimationFrameCount, pendingFrames, 'overlay relocation does not wait for or schedule an animation frame');
    }
  });

  it('T12b Follow stores the bottom-clamped target and manual scrolling still disables it', async () => {
    const runtime = createRuntime();
    await runtime.click('preview-mode-practice');
    runtime.setScrollHeight(1000);
    runtime.setAnchorRectTop(900);
    await runtime.click('btn-play');

    assert.strictEqual(runtime.scrollY, 200, 'scroll is clamped to scrollHeight - innerHeight');
    assert.strictEqual(runtime.element('practice-follow').getAttribute('aria-pressed'), 'true',
      'browser clamping is recognized as a programmatic Follow scroll');
    assert.strictEqual((runtime.savedWebviewState as { followEnabled: boolean }).followEnabled, true);

    runtime.manualScrollTo(150);
    assert.strictEqual(runtime.element('practice-follow').getAttribute('aria-pressed'), 'false');
    assert.strictEqual((runtime.savedWebviewState as { followEnabled: boolean }).followEnabled, false);
  });

  it('T13 Practice count-in runs after a non-zero seek and holds the selected score position', async () => {
    const runtime = createRuntime(PICKUP_SCORE);
    await runtime.click('preview-mode-practice');
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
    assert.strictEqual(runtime.element('preview-mode-practice').disabled, true);
    await runtime.sendPlaybackAction('practiceFaster');
    assert.ok(runtime.element('playback-error').textContent.length > 0);
    assert.strictEqual(runtime.audioContextCount, 0);
  });

  it('T15 Normal mode clears A/B, uses normal speed, and rebuild restores preferences without transient mode state', async () => {
    const runtime = createRuntime();
    await runtime.click('preview-mode-practice');
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
    assert.strictEqual(rebuilt.element('preview-mode-practice').getAttribute('aria-pressed'), 'false');
    assert.strictEqual(rebuilt.element('preview-mode-normal').getAttribute('aria-pressed'), 'true');
    assert.strictEqual(rebuilt.element('practice-speed').value, '75');
    assert.strictEqual(rebuilt.element('practice-loop').value, 'off');
    assert.strictEqual(Number(rebuilt.element('playback-seek').value), 0);
    assert.strictEqual(rebuilt.scoreOverlayElementCount(), 0);
    assert.strictEqual(rebuilt.intervalCount, 0);

    await runtime.click('preview-mode-normal');
    assert.strictEqual(runtime.element('preview-mode-practice').getAttribute('aria-pressed'), 'false');
    assert.strictEqual(runtime.element('practice-loop').value, 'off');
    const savedState = runtime.savedWebviewState as { practiceSpeed: number };
    assert.ok(!('practiceEnabled' in (runtime.savedWebviewState as Record<string, unknown>)), 'mode is not persisted');
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
