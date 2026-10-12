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
  candidateDsl,
  side: 'B',
  auditionSpeed: 100,
  targetStartMeasure: 0,
  bars: 1
};

async function flushAsyncWork(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

function startedFrequencies(runtime: ReturnType<typeof createFakePlaybackWebview>, from = 0): number[] {
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

function scoreSvgs(html: string): string[] {
  return Array.from(html.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/g), match => match[0]);
}

describe('progression audition runtime', () => {
  it('keeps progression editing out of Preview and renders A/B through the shared audio data', () => {
    const candidateHtml = compileGuitarDslToHtml(candidateDsl, { progressionAssistant: assistant });
    const originalHtml = compileGuitarDslToHtml(originalDsl, {
      progressionAssistant: { ...assistant, side: 'A' }
    });
    assert.deepStrictEqual(scoreSvgs(originalHtml), scoreSvgs(compileGuitarDslToHtml(originalDsl)),
      'A renders the original source SVGs');
    assert.deepStrictEqual(scoreSvgs(candidateHtml), scoreSvgs(compileGuitarDslToHtml(candidateDsl)),
      'B renders the selected candidate source SVGs');
    assert.notDeepStrictEqual(scoreSvgs(originalHtml), scoreSvgs(candidateHtml), 'A and B show their different chord sheets');
    assert.doesNotMatch(candidateHtml, /id="progression-candidate"|id="progression-apply"|progression-assistant-controls/,
      'Preview contains no duplicate progression editing controls');

    const runtime = createFakePlaybackWebview(candidateHtml);
    assert.strictEqual(runtime.audioContextCount, 0, 'rendering a candidate never autoplays');
    assert.strictEqual(runtime.progressionData?.side, 'B');
    assert.strictEqual(runtime.progressionData?.auditionSpeed, 100);
    assert.ok(runtime.progressionData?.originalPlayback.available);
    assert.deepStrictEqual(melodyTimeline(runtime.playbackData), melodyTimeline(runtime.progressionData!.originalPlayback),
      'A and B retain identical melody pitches, onsets, and durations');
    const originalChordPitches = runtime.progressionData!.originalPlayback.events
      .filter((event: any) => event.kind === 'rhythmAttack').map((event: any) => event.midiNotes);
    const candidateChordPitches = runtime.playbackData.events
      .filter((event: any) => event.kind === 'rhythmAttack').map((event: any) => event.midiNotes);
    assert.notDeepStrictEqual(candidateChordPitches, originalChordPitches, 'A and B carry different chord pitches');
  });

  it('starts the shared Preview transport only for an explicit Inspector Play request', async () => {
    const html = compileGuitarDslToHtml(candidateDsl, {
      progressionAssistant: { ...assistant, startPlayback: 'melody' }
    });
    const runtime = createFakePlaybackWebview(html);
    await flushAsyncWork();
    assert.strictEqual(runtime.audioContextCount, 1, 'an explicit Play request opens the shared Preview audio context');
    assert.ok(runtime.intervalCount > 0, 'the requested melody audition uses the shared scheduler');
    assert.ok(startedFrequencies(runtime).length > 0, 'the explicit Play request schedules playback events');
    await runtime.click('btn-stop');
    assert.strictEqual(runtime.intervalCount, 0, 'the shared Preview Stop control cancels host-requested playback');
    assert.ok(runtime.activeOscillators().every(node => node.stopAt !== undefined), 'Stop schedules a short fade and cancels every active audio node');
  });

  it('preserves single-chord, bars, melody, and full-song audition modes', async () => {
    const source = [
      'bpm: 120',
      'time: 4/4',
      '| C 4.d 4.d 4.d 4.d | G 4.d 4.d 4.d 4.d |',
      'mel: | c6/4 d6/4 e6/4 f6/4 | g6/4 a6/4 b6/4 c7/4 |'
    ].join('\n');
    const candidate = source.replace('| C ', '| Dm ');
    const playMode = async (mode: NonNullable<ProgressionAssistantHtmlModel['startPlayback']>) => {
      const runtime = createFakePlaybackWebview(compileGuitarDslToHtml(candidate, {
        progressionAssistant: {
          ...assistant,
          originalDsl: source,
          candidateDsl: candidate,
          targetStartMeasure: 0,
          bars: 1,
          startPlayback: mode
        }
      }));
      await flushAsyncWork();
      for (let tick = 0; tick < 220; tick++) {
        runtime.advanceAudioTime(0.025);
        runtime.runSchedulerTicks();
      }
      return startedFrequencies(runtime);
    };
    const frequencyForMidi = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
    const hasPitch = (frequencies: number[], midi: number) => frequencies.some(frequency =>
      Math.abs(frequency - frequencyForMidi(midi)) < 0.02
    );

    const chord = await playMode('chord');
    const bars = await playMode('bars');
    const melody = await playMode('melody');
    const song = await playMode('song');

    assert.ok(chord.length > 0, 'single-chord mode plays the selected chord');
    assert.ok(!hasPitch(chord, 84) && !hasPitch(chord, 91), 'single-chord mode excludes the score melody');
    assert.ok(bars.length > 0, 'bars mode plays the selected progression');
    assert.ok(!hasPitch(bars, 84) && !hasPitch(bars, 91), 'bars mode excludes melody notes');
    assert.ok(hasPitch(melody, 84), 'melody mode includes the selected target measure melody');
    assert.ok(!hasPitch(melody, 91), 'melody mode stays within the selected target range');
    assert.ok(hasPitch(song, 84) && hasPitch(song, 91), 'song mode plays melody across the full score');
  });

  it('maps host-selected 75 percent speed to longer audio intervals without changing the score timeline', async () => {
    const source = [
      'bpm: 120',
      'time: 4/4',
      '| C 4.d 4.d 4.d 4.d |',
      'mel: | c4/4 d4/4 e4/4 f4/4 |'
    ].join('\n');
    const candidate = source.replace('| C ', '| G ');
    const makeRuntime = (speed: 50 | 75 | 100 | 125 | 150) => createFakePlaybackWebview(compileGuitarDslToHtml(candidate, {
      progressionAssistant: {
        ...assistant,
        originalDsl: source,
        candidateDsl: candidate,
        auditionSpeed: speed,
        startPlayback: 'melody',
        bars: 1
      }
    }));
    const normal = makeRuntime(100);
    const slower = makeRuntime(75);
    await flushAsyncWork();
    for (let index = 0; index < 100; index++) {
      normal.advanceAudioTime(0.025);
      normal.runSchedulerTicks();
      slower.advanceAudioTime(0.025);
      slower.runSchedulerTicks();
    }
    const timeline = melodyTimeline(normal.playbackData);
    assert.deepStrictEqual(melodyTimeline(slower.playbackData), timeline, 'speed does not alter score event times');
    const expectedOnsets = (speed: number) => {
      const events = (speed === 100 ? normal : slower).playbackData.events
        .filter((event: any) => event.kind === 'pitched' && event.source === 'melody');
      const frequencies = startedFrequencies(speed === 100 ? normal : slower);
      return events.slice(0, 2).map((event: any) => {
        const midi = event.midiNotes[0];
        const frequency = 440 * Math.pow(2, (midi - 69) / 12);
        const expected = event.timeSeconds / (speed / 100);
        const matchingNode = (speed === 100 ? normal : slower).scheduledOscillators()
          .find(node => node.startAt !== undefined && Math.abs(node.frequency.value - frequency) < 0.02
            && Math.abs(node.startAt - expected) < 0.03);
        assert.ok(frequencies.includes(Math.round(frequency * 100) / 100) && matchingNode,
          `melody pitch ${midi} is scheduled at ${expected}s for ${speed}%`);
        return matchingNode!.startAt!;
      });
    };
    const at100 = expectedOnsets(100);
    const at75 = expectedOnsets(75);
    assert.ok(Math.abs((at75[1] - at75[0]) / (at100[1] - at100[0]) - (100 / 75)) < 0.03,
      '75% speed lengthens audio timing');
  });

  it('keeps the host-selected A/B side and speed on each Preview rebuild', () => {
    const source = ['bpm: 120', 'time: 4/4', '| C 4.d 4.d 4.d 4.d |', 'mel: | c4/4 d4/4 e4/4 f4/4 |'].join('\n');
    const candidate = source.replace('| C ', '| G ');
    const sideA = createFakePlaybackWebview(compileGuitarDslToHtml(source, {
      progressionAssistant: { ...assistant, originalDsl: source, candidateDsl: candidate, side: 'A', auditionSpeed: 75 }
    }));
    const sideB = createFakePlaybackWebview(compileGuitarDslToHtml(candidate, {
      progressionAssistant: { ...assistant, originalDsl: source, candidateDsl: candidate, side: 'B', auditionSpeed: 75 }
    }));
    assert.strictEqual(sideA.progressionData?.side, 'A');
    assert.strictEqual(sideB.progressionData?.side, 'B');
    assert.strictEqual(sideA.progressionData?.auditionSpeed, 75);
    assert.strictEqual(sideB.progressionData?.auditionSpeed, 75);
    assert.strictEqual(sideA.audioContextCount, 0);
    assert.strictEqual(sideB.audioContextCount, 0);
  });

  it('plays capo-relative candidate chords in the sounding key while melody pitches stay untransposed', async () => {
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
      progressionAssistant: { ...assistant, originalDsl: source, candidateDsl: candidate, bars: 1, startPlayback: 'melody' }
    }));
    const chordEvent = runtime.playbackData.events.find((event: any) => event.kind === 'rhythmAttack');
    const melodyEvent = runtime.playbackData.events.find((event: any) => event.kind === 'pitched' && event.source === 'melody');
    assert.ok(chordEvent?.midiNotes.some((midi: number) => midi % 12 === 2), 'C shape with capo 2 has a sounding D root');
    assert.ok(melodyEvent?.midiNotes.includes(62), 'written D4 remains sounding D4 and is not capo-transposed');
    await flushAsyncWork();
    const started = startedFrequencies(runtime);
    const expectedMelodyFrequency = 440 * Math.pow(2, (62 - 69) / 12);
    assert.ok(started.some(frequency => Math.abs(frequency - expectedMelodyFrequency) < 0.02),
      'the shared Preview scheduler emits the melody at sounding D4');
    const chordMidi = chordEvent!.midiNotes.find((midi: number) => midi % 12 === 2)!;
    const expectedChordFrequency = 440 * Math.pow(2, (chordMidi - 69) / 12);
    assert.ok(started.some(frequency => Math.abs(frequency - expectedChordFrequency) < 0.02),
      'the shared Preview scheduler emits the capo-adjusted chord root');
  });

  it('uses full-song audition when the target range repeats noncontiguously in play order', async () => {
    const repeatedOriginal = ['bpm: 120', 'arrangement {', 'Verse x2', '}', '[Verse]', '| C |'].join('\n');
    const repeatedCandidate = repeatedOriginal.replace('| C |', '| G |');
    const runtime = createFakePlaybackWebview(compileGuitarDslToHtml(repeatedCandidate, {
      progressionAssistant: { ...assistant, originalDsl: repeatedOriginal, candidateDsl: repeatedCandidate, bars: 1, startPlayback: 'melody' }
    }));
    assert.strictEqual(runtime.playbackData.occurrences.filter((item: any) => item.measureIndex === 0).length, 2);
    await flushAsyncWork();
    assert.ok(runtime.audioContextCount > 0, 'the noncontiguous target does not partially audition; it starts the whole score');
  });
});
