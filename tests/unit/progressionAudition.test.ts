import * as assert from 'assert';
import {
  buildProgressionAuditionPlaybackData,
  compileGuitarDslToHtml
} from '../../src/render/previewHtml';
import { renderInspectorHtml } from '../../src/render/inspectorHtml';

const source = [
  'bpm: 120',
  'time: 4/4',
  '| C 4.d 4.d 4.d 4.d | G 4.d 4.d 4.d 4.d |',
  'mel: | c6/4 d6/4 e6/4 f6/4 | g6/4 a6/4 b6/4 c7/4 |'
].join('\n');

describe('Inspector progression audition', () => {
  it('builds chord, bars, melody, and full-song events from the canonical timeline', () => {
    const run = (mode: 'chord' | 'bars' | 'melody' | 'song') => {
      const result = buildProgressionAuditionPlaybackData(source, {
        startMeasure: 0, bars: 1, mode, locale: 'en'
      });
      assert.strictEqual(result.ok, true);
      return result.ok ? result.data : undefined;
    };

    const chord = run('chord')!;
    const bars = run('bars')!;
    const melody = run('melody')!;
    const song = run('song')!;

    assert.ok(chord.events.length > 0 && chord.events.every(event => event.kind === 'rhythmAttack'));
    assert.ok(bars.events.length > 0 && bars.events.every(event => event.source !== 'melody'));
    assert.ok(melody.events.some(event => event.source === 'melody' && event.timeSeconds < melody.durationSeconds));
    assert.ok(song.events.some(event => event.source === 'melody' && event.timeSeconds > melody.durationSeconds));
    assert.ok(song.durationSeconds > melody.durationSeconds);
  });

  it('reports an unavailable partial range instead of silently falling back to a song', () => {
    const repeated = ['bpm: 120', 'arrangement {', 'Verse x2', '}', '[Verse]', '| C |'].join('\n');
    const result = buildProgressionAuditionPlaybackData(repeated, {
      startMeasure: 0, bars: 1, mode: 'bars', locale: 'en'
    });
    assert.deepStrictEqual(result.ok, false);
    if (!result.ok) assert.strictEqual(result.code, 'fullSongOnly');
  });

  it('re-attacks a tied rhythm when an Inspector audition starts at its continuation bar', () => {
    const tied = [
      'bpm: 120',
      '| G | 4 4 4 8 8.t |',
      '| G | 4 4 4 4 |'
    ].join('\n');
    const bars = buildProgressionAuditionPlaybackData(tied, {
      startMeasure: 1, bars: 1, mode: 'bars', locale: 'en'
    });
    assert.strictEqual(bars.ok, true);
    if (bars.ok) assert.deepStrictEqual([bars.data.events[0].kind, bars.data.events[0].timeSeconds, bars.data.events[0].durationSeconds], ['rhythmAttack', 0, 0.5]);

    const chord = buildProgressionAuditionPlaybackData(tied, {
      startMeasure: 1, bars: 1, mode: 'chord', locale: 'en'
    });
    assert.strictEqual(chord.ok, true);
    if (chord.ok) assert.deepStrictEqual([chord.data.events[0].kind, chord.data.events[0].timeSeconds], ['rhythmAttack', 0]);
  });

  it('starts chord and melody auditions with the earliest tied continuation attack', () => {
    const tied = [
      'bpm: 120',
      '| G | 4 4 4 8 8.t |',
      '| G 4 C 4.d 4.d 4.d |',
      'mel: | c6/4 d6/4 e6/4 f6/4 | g6/4 a6/4 b6/4 c7/4 |'
    ].join('\n');
    const baseline = buildProgressionAuditionPlaybackData([
      'bpm: 120',
      '| G | 4 4 4 4 |'
    ].join('\n'), { startMeasure: 0, bars: 1, mode: 'chord', locale: 'en' });
    const bars = buildProgressionAuditionPlaybackData(tied, {
      startMeasure: 1, bars: 1, mode: 'bars', locale: 'en'
    });
    const chord = buildProgressionAuditionPlaybackData(tied, {
      startMeasure: 1, bars: 1, mode: 'chord', locale: 'en'
    });
    const melody = buildProgressionAuditionPlaybackData(tied, {
      startMeasure: 1, bars: 1, mode: 'melody', locale: 'en'
    });

    assert.ok(baseline.ok && bars.ok && chord.ok && melody.ok);
    if (!baseline.ok || !bars.ok || !chord.ok || !melody.ok) return;

    const expectedG = { midiNotes: [43, 55, 59, 62], timeSeconds: 0, durationSeconds: 0.5 };
    assert.deepStrictEqual(baseline.data.events[0].midiNotes, expectedG.midiNotes);
    assert.deepStrictEqual(bars.data.events.filter(event => event.kind === 'rhythmAttack' && event.timeSeconds === 0).map(event => ({
      midiNotes: event.midiNotes, timeSeconds: event.timeSeconds, durationSeconds: event.durationSeconds
    })), [expectedG]);
    assert.deepStrictEqual(chord.data.events.map(event => ({
      midiNotes: event.midiNotes, timeSeconds: event.timeSeconds, durationSeconds: event.durationSeconds
    })), [expectedG]);
    assert.deepStrictEqual(melody.data.events.filter(event => event.kind === 'rhythmAttack' && event.timeSeconds === 0).map(event => ({
      midiNotes: event.midiNotes, timeSeconds: event.timeSeconds, durationSeconds: event.durationSeconds
    })), [expectedG]);
    assert.ok(melody.data.events.some(event => event.source === 'melody' && event.timeSeconds === 0));
  });

  it('resumes Web Audio in the Play click handler before sending the Host request', () => {
    const html = renderInspectorHtml('en', { kind: 'empty' }, 'vscode-webview://test', 'nonce', 1);
    const resume = html.indexOf('pendingResume = prepareAudioFromGesture()');
    const request = html.indexOf('post("progressionPlay", { requestId, userGesture: true');
    assert.ok(resume >= 0 && request > resume);
    assert.ok(html.includes('audioContext.resume()'));
    assert.ok(html.includes('data-audio-state="idle"'));
    assert.ok(html.includes('progressionAudioStarted'));
    assert.ok(html.includes('progressionAudioStopped'));
  });

  it('keeps Preview playback locked when a lease is present and omits progression controls', () => {
    const html = compileGuitarDslToHtml(source, { progressionAudioLeaseId: 'lease-1' });
    assert.ok(html.includes('"progressionAudioLeaseId":"lease-1"'));
    assert.ok(html.includes("message.command === 'progressionAudioLock'"));
    assert.ok(html.includes("message.command === 'progressionAudioUnlock'"));
    assert.doesNotMatch(html, /id="progression-candidate"|id="progression-apply"|progression-assistant-controls/);
    assert.doesNotMatch(html, /void auditionProgression\(/);
  });
});
