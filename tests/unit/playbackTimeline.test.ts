import * as assert from 'assert';
import { parseGuitarDsl } from '../../src/compiler';
import { fnum } from '../../src/duration';
import {
  buildPlaybackTimeline,
  playbackPositionAtSeconds,
  playbackSecondsAtPosition
} from '../../src/playbackTimeline';
import type { PlaybackEvent, PlaybackTimeline } from '../../src/playbackTimeline';

function validTimeline(source: string): PlaybackTimeline {
  const result = buildPlaybackTimeline(parseGuitarDsl(source));
  if (!result.ok) throw new Error(`Expected a valid timeline, received ${result.code}`);
  return result.timeline;
}

function eventsOf<K extends PlaybackEvent['kind']>(timeline: PlaybackTimeline, kind: K): Extract<PlaybackEvent, { kind: K }>[] {
  return timeline.events.filter((event): event is Extract<PlaybackEvent, { kind: K }> => event.kind === kind);
}

describe('playbackTimeline', () => {
  it('uses quarter-note beats and converts BPM 120 to a two-second 4/4 measure', () => {
    const timeline = validTimeline('bpm: 120\n| C | 4.d 4.d 4.d 4.d |');
    assert.strictEqual(fnum(timeline.occurrences[0].durationBeats), 4);
    assert.strictEqual(timeline.occurrences[0].durationSeconds, 2);
    assert.strictEqual(timeline.durationSeconds, 2);
    assert.deepStrictEqual(eventsOf(timeline, 'rhythmAttack').map(event => event.timeSeconds), [0, 0.5, 1, 1.5]);

    const underfilled = validTimeline('bpm: 120\n| C | 4.d |');
    assert.strictEqual(underfilled.durationSeconds, 2);
    assert.deepStrictEqual(eventsOf(underfilled, 'rhythmAttack').map(event => [event.timeSeconds, event.durationSeconds]), [[0, 0.5]]);
  });

  it('uses resolved numeric tempo, restores tempo primo, and leaves tempo marks and feel display-only', () => {
    const source = [
      'bpm: 120',
      'feel: straight',
      '| C |',
      '@tempo: 60',
      '| G |',
      '@tempo: rit.',
      '| D |',
      '@tempo: accel.',
      '| E |',
      '@tempo: a tempo',
      '| F |',
      '@tempo: tempo primo',
      '| A |',
      '@feel: shuffle',
      '| B |'
    ].join('\n');
    const timeline = validTimeline(source);
    assert.deepStrictEqual(timeline.occurrences.map(item => item.tempoBpm), [120, 60, 60, 60, 60, 120, 120]);
    assert.deepStrictEqual(timeline.occurrences.map(item => item.startSeconds), [0, 2, 6, 10, 14, 18, 20]);
    assert.strictEqual(timeline.durationSeconds, 22);

    const byFeel = (feel: string) => validTimeline(`bpm: 120\nfeel: ${feel}\n| C | 8t 8t 8t 8t 8t 8t |`);
    const straight = byFeel('straight');
    for (const feel of ['swing', 'shuffle']) {
      const other = byFeel(feel);
      assert.strictEqual(other.durationSeconds, straight.durationSeconds, `${feel} duration`);
      assert.deepStrictEqual(other.events.map(event => event.timeSeconds), straight.events.map(event => event.timeSeconds), `${feel} offsets`);
    }
  });

  it('maps every performed occurrence in compiler play order, including repeats, voltas, and navigation', () => {
    const score = parseGuitarDsl('|: C | [1.] G :| [2.] Am | D.C. | D Fine |');
    assert.strictEqual(score.playOrder.valid, true, JSON.stringify(score.diagnostics));
    const result = buildPlaybackTimeline(score);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.deepStrictEqual(
      result.timeline.occurrences.map(({ occurrenceIndex, measureIndex }) => ({ occurrenceIndex, measureIndex })),
      score.playOrder.occurrences.map(({ occurrenceIndex, measureIndex }) => ({ occurrenceIndex, measureIndex }))
    );
    assert.ok(result.timeline.occurrences.some((item, index) =>
      result.timeline.occurrences.slice(0, index).some(previous => previous.measureIndex === item.measureIndex)
    ));
  });

  it('plays the prior rhythm pattern in each performed % measure occurrence', () => {
    const source = [
      'bpm: 120',
      '|: C | 8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u |',
      '| G | % :|',
      'mel: | c4/2 d4/2 | % |'
    ].join('\n');
    const score = parseGuitarDsl(source);
    assert.strictEqual(score.playOrder.valid, true, JSON.stringify(score.diagnostics));
    const result = buildPlaybackTimeline(score);
    assert.ok(result.ok);
    if (!result.ok) return;

    const attacks = eventsOf(result.timeline, 'rhythmAttack');
    const repeatedMeasureAttacks = attacks.filter(event => event.measureIndex === 1);
    const melody = eventsOf(result.timeline, 'pitched').filter(event => event.source === 'melody');
    const repeatedMeasureMelody = melody.filter(event => event.measureIndex === 1);
    assert.deepStrictEqual(result.timeline.occurrences.map(item => item.measureIndex), [0, 1, 0, 1]);
    assert.strictEqual(attacks.length, 32);
    assert.strictEqual(repeatedMeasureAttacks.length, 16);
    assert.strictEqual(melody.length, 8);
    assert.strictEqual(repeatedMeasureMelody.length, 4);
    assert.deepStrictEqual(
      [...new Set(repeatedMeasureAttacks.map(event => event.occurrenceIndex))],
      [1, 3]
    );
    assert.deepStrictEqual(
      [...new Set(repeatedMeasureMelody.map(event => event.occurrenceIndex))],
      [1, 3]
    );
    assert.deepStrictEqual(
      [...new Set(repeatedMeasureAttacks.map(event => event.chord?.name))],
      ['G']
    );
    assert.strictEqual(result.timeline.durationSeconds, 8);
  });

  it('does not repeat melody from the measure-line % unless mel: also contains %', () => {
    const timeline = validTimeline([
      'bpm: 120',
      '|: C | 4.d 4.d 4.d 4.d |',
      '| G | % :|',
      'mel: | c4/1 |'
    ].join('\n'));
    const melody = eventsOf(timeline, 'pitched').filter(event => event.source === 'melody');
    assert.deepStrictEqual(melody.map(event => [event.occurrenceIndex, event.measureIndex]), [[0, 0], [2, 0]]);
  });

  it('keeps pickup length and tuplet offsets exact without accumulated drift', () => {
    const timeline = validTimeline([
      'bpm: 120',
      'time: 6/8',
      'pickup: 8+8+8',
      '| C |',
      'mel: | c4/8t d4/8t e4/8t f4/8t |',
      '| G |'
    ].join('\n'));
    assert.deepStrictEqual(timeline.occurrences.map(item => fnum(item.durationBeats)), [1.5, 3]);
    const notes = eventsOf(timeline, 'pitched');
    assert.deepStrictEqual(notes.map(event => event.beatInMeasure), [
      { n: 0, d: 1 }, { n: 1, d: 3 }, { n: 2, d: 3 }, { n: 1, d: 1 }
    ]);
    assert.deepStrictEqual(notes.map(event => event.timeSeconds), [0, 1 / 6, 1 / 3, 0.5]);
    assert.strictEqual(timeline.durationSeconds, 2.25);
  });

  it('emits melody, inline pitch, rhythm attacks, and rests while selecting only same-measure chords', () => {
    const timeline = validTimeline([
      'bpm: 120',
      '| C:2 G:2 | 4.d r4 4.d 4.d |',
      'mel: | c4/4 r/4 d4/4 r/4 |',
      '| c5/4 4.d e5/4 4.d |'
    ].join('\n'));
    assert.deepStrictEqual(eventsOf(timeline, 'pitched').map(event => event.source), ['melody', 'melody', 'inline', 'inline']);
    assert.deepStrictEqual(eventsOf(timeline, 'rest').map(event => event.source), ['melody', 'rhythm', 'melody']);
    assert.deepStrictEqual(eventsOf(timeline, 'rhythmAttack').slice(0, 3).map(event => event.chord?.name), ['C', 'G', 'G']);
    assert.deepStrictEqual(eventsOf(timeline, 'rhythmAttack').slice(3).map(event => event.chord), [undefined, undefined]);
  });

  it('clips crossing events, omits boundary onsets, and keeps underfilled measure time silent', () => {
    const timeline = validTimeline([
      'bpm: 120',
      'time: 3/4',
      '| C |',
      'mel: | c4/1 |',
      '| G |',
      'mel: | d4/1 |'
    ].join('\n'));
    const notes = eventsOf(timeline, 'pitched');
    assert.deepStrictEqual(notes.map(event => [fnum(event.durationBeats), event.durationSeconds]), [[3, 1.5], [3, 1.5]]);
    assert.strictEqual(timeline.durationSeconds, 3);
    assert.strictEqual(eventsOf(timeline, 'pitched').some(event => fnum(event.beatInMeasure) === 3), false);
  });

  it('groups and accents meter clicks using beamGroupStarts', () => {
    const six = eventsOf(validTimeline('bpm: 120\ntime: 6/8\n| C |'), 'metronome');
    assert.deepStrictEqual(six.map(event => [fnum(event.beatInMeasure), event.accent]), [[0, true], [1.5, false]]);
    const seven = eventsOf(validTimeline('bpm: 120\ntime: 7/8(2+2+3)\n| C |'), 'metronome');
    assert.deepStrictEqual(seven.map(event => [fnum(event.beatInMeasure), event.accent]), [[0, true], [1, false], [2, false]]);
  });

  it('round-trips positions at repeated-measure boundaries and at the score end', () => {
    const timeline = validTimeline('bpm: 120\n|: C | D :| E |');
    const boundary = playbackPositionAtSeconds(timeline, 4);
    assert.strictEqual(boundary.occurrenceIndex, 2);
    assert.strictEqual(boundary.measureIndex, 0);
    assert.strictEqual(fnum(boundary.beatInMeasure), 0);
    assert.strictEqual(playbackSecondsAtPosition(timeline, boundary.occurrenceIndex!, boundary.beatInMeasure), 4);

    const end = playbackPositionAtSeconds(timeline, timeline.durationSeconds);
    assert.strictEqual(end.occurrenceIndex, 4);
    assert.strictEqual(end.measureIndex, 2);
    assert.strictEqual(fnum(end.beatInMeasure), 4);
    assert.strictEqual(end.timeSeconds, timeline.durationSeconds);
  });

  it('returns no partial timeline for invalid play order or unresolved tempo', () => {
    const invalidOrder = buildPlaybackTimeline(parseGuitarDsl('|: C |'));
    assert.deepStrictEqual(invalidOrder, { ok: false, code: 'invalidPlayOrder' });

    const unresolved = parseGuitarDsl('| C |');
    unresolved.measures[0].context.tempoBpm = null;
    assert.deepStrictEqual(buildPlaybackTimeline(unresolved), { ok: false, code: 'unresolvedTempo' });
  });
});
