import * as assert from 'assert';
import { compileGuitarDslToHtml, type ProgressionAssistantHtmlModel } from '../../src/render/previewHtml';
import { createFakePlaybackWebview } from './helpers/fakePlaybackWebview';

const originalDsl = [
  'bpm: 120',
  'time: 4/4',
  '| C | 4.d 4.d 4.d 4.d |',
  'mel: | c4/4 d4/4 e4/4 f4/4 |'
].join('\n');

const candidateDsl = originalDsl.replace('| C |', '| G |');

const assistant: ProgressionAssistantHtmlModel = {
  originalDsl,
  candidates: [{ id: 'candidate-g', chords: ['G'], rationale: 'G major candidate', score: 3 }],
  activeCandidateId: 'candidate-g',
  targetStartMeasure: 0,
  bars: 1,
  operation: 'replace'
};

async function flushAsyncWork(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

function startedFrequencies(runtime: ReturnType<typeof createFakePlaybackWebview>, from: number): number[] {
  return runtime.scheduledOscillators().slice(from)
    .filter(node => node.startAt !== undefined)
    .map(node => Math.round(node.frequency.value * 100) / 100)
    .sort((a, b) => a - b);
}

function melodyTimeline(data: Record<string, any>): unknown[] {
  return data.events.filter((event: any) => event.kind === 'pitched' && event.source === 'melody')
    .map((event: any) => ({
      timeSeconds: event.timeSeconds,
      durationSeconds: event.durationSeconds,
      midiNotes: event.midiNotes
    }));
}

describe('progression audition runtime', () => {
  it('does not autoplay and auditions the original A and candidate B through the shared Preview transport', async () => {
    const html = compileGuitarDslToHtml(candidateDsl, { progressionAssistant: assistant });
    const runtime = createFakePlaybackWebview(html);
    assert.strictEqual(runtime.audioContextCount, 0, 'opening candidate suggestions does not start audio');
    assert.strictEqual(runtime.progressionData?.activeCandidateId, 'candidate-g');
    assert.ok(runtime.progressionData?.originalPlayback.available);
    assert.deepStrictEqual(melodyTimeline(runtime.playbackData), melodyTimeline(runtime.progressionData!.originalPlayback),
      'A and B retain identical melody pitches, onsets, and durations');
    const originalChordPitches = runtime.progressionData!.originalPlayback.events
      .filter((event: any) => event.kind === 'rhythmAttack').map((event: any) => event.midiNotes);
    const candidateChordPitches = runtime.playbackData.events
      .filter((event: any) => event.kind === 'rhythmAttack').map((event: any) => event.midiNotes);
    assert.notDeepStrictEqual(candidateChordPitches, originalChordPitches, 'A and B carry different chord pitches');

    await runtime.click('progression-side-a');
    assert.strictEqual(runtime.audioContextCount, 0, 'switching to A does not autoplay');
    await runtime.click('progression-audition-song');
    await flushAsyncWork();
    const originalFrequencies = startedFrequencies(runtime, 0);
    assert.ok(originalFrequencies.length > 0, 'A schedules the original score');

    await runtime.click('progression-side-b');
    assert.strictEqual(runtime.intervalCount, 0, 'switching sides stops the current audition');
    const candidateStart = runtime.scheduledOscillators().length;
    await runtime.click('progression-audition-song');
    await flushAsyncWork();
    const candidateFrequencies = startedFrequencies(runtime, candidateStart);
    assert.ok(candidateFrequencies.length > 0, 'B schedules the in-memory candidate');
    assert.notDeepStrictEqual(candidateFrequencies, originalFrequencies, 'A and B use their own chord playback data');

    await runtime.fireWindowEvent('pagehide');
    assert.strictEqual(runtime.intervalCount, 0);
    assert.strictEqual(runtime.audioContextCloseCount, 1, 'closing the Preview cleans up the shared audio context');
    assert.strictEqual(runtime.activeOscillators().length, 0);
  });

  it('sends only the selected candidate ID for apply and never writes candidate source from the Webview', async () => {
    const runtime = createFakePlaybackWebview(compileGuitarDslToHtml(candidateDsl, { progressionAssistant: assistant }));
    await runtime.click('progression-apply');
    assert.strictEqual(runtime.postedMessages.length, 1);
    assert.strictEqual(runtime.postedMessages[0].command, 'progressionApply');
    assert.strictEqual(runtime.postedMessages[0].candidateId, 'candidate-g');
    assert.deepStrictEqual(Object.keys(runtime.postedMessages[0]).sort(), ['candidateId', 'command']);
  });

  it('auditions one chord, adds melody only in the with-melody mode, and stops through the shared transport', async () => {
    const source = [
      'bpm: 120',
      'time: 4/4',
      '| C 4.d 4.d 4.d 4.d |',
      'mel: | c4/4 d4/4 e4/4 f4/4 |'
    ].join('\n');
    const candidate = source.replace('| C ', '| G ');
    const html = compileGuitarDslToHtml(candidate, {
      progressionAssistant: { ...assistant, originalDsl: source, bars: 1 }
    });
    const runtime = createFakePlaybackWebview(html);
    await runtime.click('progression-audition-chord');
    await flushAsyncWork();
    assert.ok(runtime.scheduledOscillators().some(node => node.startAt !== undefined), 'single-chord mode schedules chord audio');
    await runtime.click('btn-stop');
    assert.strictEqual(runtime.intervalCount, 0, 'the shared Stop control clears the scheduler');

    await runtime.click('progression-audition-bars');
    await flushAsyncWork();
    for (let index = 0; index < 100; index++) {
      runtime.advanceAudioTime(0.025);
      runtime.runSchedulerTicks();
    }
    const barsCount = runtime.scheduledOscillators().filter(node => node.startAt !== undefined).length;
    await runtime.click('progression-audition-melody');
    await flushAsyncWork();
    for (let index = 0; index < 100; index++) {
      runtime.advanceAudioTime(0.025);
      runtime.runSchedulerTicks();
    }
    const withMelodyCount = runtime.scheduledOscillators().filter(node => node.startAt !== undefined).length - barsCount;
    assert.ok(withMelodyCount > 0, 'with-melody mode schedules the pitched melody alongside chord playback');
    await runtime.click('btn-stop');
    assert.strictEqual(runtime.intervalCount, 0);
    assert.strictEqual(runtime.activeOscillators().length, 0, 'stopping releases all scheduled audio nodes');
  });

  it('maps 75 percent audition speed to longer audio intervals without changing the score timeline', async () => {
    const source = [
      'bpm: 120',
      'time: 4/4',
      '| C 4.d 4.d 4.d 4.d |',
      'mel: | c4/4 d4/4 e4/4 f4/4 |'
    ].join('\n');
    const candidate = source.replace('| C ', '| G ');
    const html = compileGuitarDslToHtml(candidate, {
      progressionAssistant: { ...assistant, originalDsl: source, bars: 1 }
    });
    const firstTimeline = createFakePlaybackWebview(html);
    const secondTimeline = createFakePlaybackWebview(html);

    async function melodyOnsets(runtime: ReturnType<typeof createFakePlaybackWebview>, speed: number): Promise<number[]> {
      const speedSelect = runtime.element('progression-speed');
      speedSelect.value = String(speed);
      await runtime.change('progression-speed');
      const melody = runtime.playbackData.events.filter((event: any) => event.kind === 'pitched' && event.source === 'melody');
      await runtime.click('progression-audition-melody');
      await flushAsyncWork();
      for (let index = 0; index < 100; index++) {
        runtime.advanceAudioTime(0.025);
        runtime.runSchedulerTicks();
      }
      const audioStarts = runtime.scheduledOscillators().filter(node => node.startAt !== undefined);
      return melody.slice(0, 2).map((event: any) => {
        const midi = event.midiNotes[0];
        const frequency = 440 * Math.pow(2, (midi - 69) / 12);
        const expected = event.timeSeconds / (speed / 100);
        const match = audioStarts.find(node => Math.abs(node.frequency.value - frequency) < 0.02
          && Math.abs((node.startAt ?? Number.POSITIVE_INFINITY) - expected) < 0.03);
        assert.ok(match, `melody pitch ${midi} is scheduled at ${expected}s for ${speed}%`);
        return match!.startAt!;
      });
    }

    assert.deepStrictEqual(melodyTimeline(firstTimeline.playbackData), melodyTimeline(secondTimeline.playbackData));
    const at100 = await melodyOnsets(firstTimeline, 100);
    const at75 = await melodyOnsets(secondTimeline, 75);
    const normalInterval = at100[1] - at100[0];
    const slowInterval = at75[1] - at75[0];
    assert.ok(Math.abs(slowInterval / normalInterval - (100 / 75)) < 0.03,
      `75% speed lengthens audio timing (${slowInterval}s vs ${normalInterval}s)`);
  });

  it('plays a capo-relative candidate chord in the sounding key while melody pitches stay untransposed', async () => {
    const source = [
      'capo: 2',
      'key: D',
      'bpm: 120',
      'time: 4/4',
      '| D 4.d 4.d 4.d 4.d |',
      'mel: | d4/1 |'
    ].join('\n');
    const candidate = source.replace('| D ', '| C ');
    const runtime = createFakePlaybackWebview(compileGuitarDslToHtml(candidate, {
      progressionAssistant: { ...assistant, originalDsl: source, bars: 1 }
    }));
    const chordEvent = runtime.playbackData.events.find((event: any) => event.kind === 'rhythmAttack');
    const melodyEvent = runtime.playbackData.events.find((event: any) => event.kind === 'pitched' && event.source === 'melody');
    assert.ok(chordEvent?.midiNotes.some((midi: number) => midi % 12 === 2), 'C shape with capo 2 has a sounding D root');
    assert.ok(melodyEvent?.midiNotes.includes(62), 'written D4 remains sounding D4 and is not capo-transposed');

    await runtime.click('progression-audition-melody');
    await flushAsyncWork();
    const started = startedFrequencies(runtime, 0);
    const expectedMelodyFrequency = 440 * Math.pow(2, (62 - 69) / 12);
    assert.ok(started.some(frequency => Math.abs(frequency - expectedMelodyFrequency) < 0.02),
      'the shared Preview scheduler emits the melody at sounding D4');
    const chordMidi = chordEvent!.midiNotes.find((midi: number) => midi % 12 === 2)!;
    const expectedChordFrequency = 440 * Math.pow(2, (chordMidi - 69) / 12);
    assert.ok(started.some(frequency => Math.abs(frequency - expectedChordFrequency) < 0.02),
      'the shared Preview scheduler emits the capo-adjusted chord root');
  });

  it('keeps the full-song audition available when a written target repeats noncontiguously in play order', async () => {
    const repeatedOriginal = ['bpm: 120', 'arrangement {', 'Verse x2', '}', '[Verse]', '| C |'].join('\n');
    const repeatedCandidate = repeatedOriginal.replace('| C |', '| G |');
    const repeatedAssistant: ProgressionAssistantHtmlModel = {
      ...assistant,
      originalDsl: repeatedOriginal
    };
    const runtime = createFakePlaybackWebview(compileGuitarDslToHtml(repeatedCandidate, {
      progressionAssistant: repeatedAssistant
    }));
    assert.strictEqual(runtime.playbackData.occurrences.filter((item: any) => item.measureIndex === 0).length, 2);
    await runtime.click('progression-audition-bars');
    await flushAsyncWork();
    assert.strictEqual(runtime.audioContextCount, 0, 'a noncontiguous target range is not partially auditioned');
    assert.strictEqual(runtime.element('progression-status').textContent,
      runtime.progressionData?.labels.fullSongOnly);
    await runtime.click('progression-audition-song');
    await flushAsyncWork();
    assert.ok(runtime.audioContextCount > 0, 'full-song audition remains available');
  });
});
