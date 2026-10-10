import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { exportGp78, importGp78, inspectGp78, planGp78ChordStrum } from '../../src/gp78';
import { guitarDslToInterchange, interchangeToGuitarDsl, validateInterchangeScore } from '../../src/interchange';
import type {
  InterchangeNoteValue,
  InterchangeMeasure,
  InterchangeScore,
  InterchangeTabBeat,
  InterchangeTabNote,
} from '../../src/interchange';
import type { GuitarString } from '../../src/instrumentModel';
import { parseGuitarDsl } from '../../src/compiler';

const ROOT = path.resolve(__dirname, '../..');
const C_MAJOR = ['x', 3, 2, 0, 1, 0] as const;
const G_OVER_B = ['x', 2, 0, 0, 0, 3] as const;
const C_DIMINISHED_SEVENTH = [8, 'x', 1, 11, 10, 'x'] as const;

function sourceScore(): InterchangeScore {
  const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/gp78/F01-standard-4-4.gp')));
  const inspection = inspectGp78(bytes);
  assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
  if (!inspection.ok) throw new Error(JSON.stringify(inspection));
  const track = inspection.value.tracks.find(candidate => candidate.eligible);
  assert.ok(track);
  if (!track) throw new Error('F01 has no eligible guitar track.');
  const imported = importGp78(bytes, track.id);
  assert.strictEqual(imported.ok, true, JSON.stringify(imported));
  if (!imported.ok) throw new Error(JSON.stringify(imported));
  return imported.value;
}

function noteValue(base: 2 | 4 | 8): InterchangeNoteValue {
  const beats = base === 8 ? { n: 1, d: 2 } : { n: 4 / base, d: 1 };
  return { beats, parts: [{ base, dotted: false }] };
}

function tabNotes(frets: readonly (number | 'x')[]): InterchangeTabNote[] {
  return frets.flatMap((fret, index) => fret === 'x' ? [] : [{
    string: (6 - index) as GuitarString,
    fret,
    dead: false,
    tieToNext: false,
    effects: [],
  }]);
}

function beat(
  frets: readonly (number | 'x')[] | null,
  base: 2 | 4 | 8,
  syllables: InterchangeTabBeat['syllables'] = [],
): InterchangeTabBeat {
  return {
    isRest: frets === null,
    notes: frets === null ? [] : tabNotes(frets),
    duration: noteValue(base),
    effects: [],
    syllables,
  };
}

function strumScore(beats: readonly InterchangeTabBeat[], overrides: Partial<InterchangeScore> = {}): InterchangeScore {
  const source = sourceScore();
  const measures = source.measures.map((measure, index) => index === 0 ? {
    ...measure,
    chords: [],
    rhythm: { origin: 'implicit' as const, events: [] },
    tabVoices: [{ voice: 1 as const, beats }],
  } : measure);
  return {
    ...source,
    ...overrides,
    metadata: { ...source.metadata, showRhythm: false, ...overrides.metadata },
    measures,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

describe('GP7/8 chord-strum optimization', () => {
  it('converts a repeated C strum to exact rhythm events without mutating the source', () => {
    const source = deepFreeze(strumScore([
      beat(C_MAJOR, 4), beat(C_MAJOR, 4), beat(C_MAJOR, 4), beat(C_MAJOR, 4),
    ]));
    const before = JSON.stringify(source);
    const result = planGp78ChordStrum(source);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.strictEqual(JSON.stringify(source), before);
    assert.strictEqual(result.stats.attacks, 4);
    assert.strictEqual(result.stats.inferredChords, 1);
    assert.deepStrictEqual(result.score.measures[0].chords.map(chord => chord.name), ['C']);
    assert.deepStrictEqual(result.score.measures[0].chords.map(chord => chord.beatOffset), [{ n: 0, d: 1 }]);
    assert.deepStrictEqual(result.score.measures[0].rhythm.events.map(event => event.duration.beats), Array(4).fill({ n: 1, d: 1 }));
    assert.strictEqual(result.score.measures[0].tabVoices, undefined);
    assert.strictEqual(result.score.metadata.showRhythm, true);
    assert.ok(result.loss.entries.some(entry => entry.code === 'optimizedTabToRhythm'));
    assert.strictEqual(result.loss.entries.filter(entry => entry.code === 'inferredStrumChord').length, 1);
    assert.ok(result.loss.entries.some(entry => entry.code === 'enabledRhythmDisplay'));

    const converted = interchangeToGuitarDsl(result.score, result.loss);
    assert.strictEqual(converted.ok, true, JSON.stringify(converted));
    if (converted.ok) {
      const parsed = parseGuitarDsl(converted.value);
      assert.deepStrictEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);
    }
    assert.deepStrictEqual(planGp78ChordStrum(source), result, 'planning the same immutable input is deterministic');
  });

  it('preserves exact changing harmony, rest placement, and non-quarter beat lengths in Drop D with capo', () => {
    const source = strumScore([
      beat(C_MAJOR, 2),
      beat(G_OVER_B, 4),
      beat(null, 4),
    ], {
      metadata: {
        ...sourceScore().metadata,
        tuning: { preset: 'Drop D', openMidi: [38, 45, 50, 55, 59, 64] },
        capo: 2,
      },
    });
    assert.deepStrictEqual(validateInterchangeScore(source), []);
    const result = planGp78ChordStrum(source);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.deepStrictEqual(result.score.measures[0].rhythm.events.map(event => [event.duration.beats, event.isRest]), [
      [{ n: 2, d: 1 }, false], [{ n: 1, d: 1 }, false], [{ n: 1, d: 1 }, true],
    ]);
    assert.deepStrictEqual(result.score.measures[0].chords.map(chord => [chord.name, chord.beatOffset]), [
      ['C', { n: 0, d: 1 }], ['G/B', { n: 2, d: 1 }],
    ]);
    assert.strictEqual(result.stats.attacks, 2);
  });

  it('continues a compatible explicit chord name across later strum attacks', () => {
    const source = strumScore([
      beat(C_MAJOR, 4), beat(C_MAJOR, 4), beat(C_MAJOR, 4), beat(C_MAJOR, 4),
    ]);
    const withSourceChord = {
      ...source,
      measures: source.measures.map((measure, index) => index === 0
        ? { ...measure, chords: [{ name: 'C', beatOffset: { n: 0, d: 1 } }] }
        : measure),
    };
    const result = planGp78ChordStrum(withSourceChord);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.deepStrictEqual(result.score.measures[0].chords.map(chord => chord.name), ['C']);
    assert.deepStrictEqual(result.score.measures[0].chords.map(chord => chord.beatOffset), [{ n: 0, d: 1 }]);
    assert.strictEqual(result.stats.inferredChords, 0);
  });

  it('preserves repeated authored chord labels while deduplicating only generated labels', () => {
    const source = strumScore([
      beat(C_MAJOR, 4), beat(C_MAJOR, 4), beat(C_MAJOR, 4), beat(C_MAJOR, 4),
    ]);
    const withAuthoredLabels = {
      ...source,
      measures: source.measures.map((measure, index) => index === 0 ? {
        ...measure,
        chords: [0, 1, 2, 3].map(offset => ({ name: 'C', beatOffset: { n: offset, d: 1 } })),
      } : measure),
    };
    const result = planGp78ChordStrum(withAuthoredLabels);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.deepStrictEqual(result.score.measures[0].chords.map(chord => chord.beatOffset), [
      { n: 0, d: 1 }, { n: 1, d: 1 }, { n: 2, d: 1 }, { n: 3, d: 1 },
    ]);
    assert.deepStrictEqual(result.score.measures[0].chords.map(chord => chord.name), ['C', 'C', 'C', 'C']);
    assert.strictEqual(result.stats.inferredChords, 0);
    assert.strictEqual(result.loss.entries.filter(entry => entry.code === 'inferredStrumChord').length, 0);
  });

  it('rejects multiple exact diminished-seventh names instead of choosing the top rank', () => {
    const source = strumScore([
      beat(C_DIMINISHED_SEVENTH, 2), beat(C_DIMINISHED_SEVENTH, 2),
    ]);
    const result = planGp78ChordStrum(source);
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.reason, 'ambiguousHarmony');
      assert.match(result.detail, /exact chord names/);
    }
  });

  it('requires whole-measure duration equality and rejects extra TAB voices', () => {
    const badDuration = strumScore([beat(C_MAJOR, 4), beat(C_MAJOR, 8), beat(C_MAJOR, 4), beat(C_MAJOR, 4)]);
    const durationResult = planGp78ChordStrum(badDuration);
    assert.strictEqual(durationResult.ok, false);
    if (!durationResult.ok) assert.strictEqual(durationResult.reason, 'unrepresentableRhythm', JSON.stringify(durationResult));

    const extraVoice = strumScore([beat(C_MAJOR, 2), beat(C_MAJOR, 2)]);
    const firstMeasure = extraVoice.measures[0];
    const secondVoice = { voice: 2 as const, beats: firstMeasure.tabVoices![0].beats };
    const withExtraVoice = {
      ...extraVoice,
      measures: extraVoice.measures.map((measure, index) => index === 0
        ? { ...measure, tabVoices: [...measure.tabVoices!, secondVoice] }
        : measure),
    };
    const voiceResult = planGp78ChordStrum(withExtraVoice);
    assert.strictEqual(voiceResult.ok, false);
    if (!voiceResult.ok) assert.strictEqual(voiceResult.reason, 'unsupportedNotes');
  });

  it('rejects melody, arpeggio-like attacks, and TAB details that cannot become chord slashes', () => {
    const beats = [beat(C_MAJOR, 4), beat(C_MAJOR, 4), beat(C_MAJOR, 4), beat(C_MAJOR, 4)];
    const source = strumScore(beats);
    const melodyNote = {
      isRest: false,
      pitch: { step: 'c' as const, alter: 0 as const, octave: 4 },
      duration: noteValue(4),
      tieToNext: false,
      tiedFromPrev: false,
      syllables: [],
    };
    const withMelody = {
      ...source,
      melodyGroups: [{ startMeasure: 0, endMeasureExclusive: 1, verseCount: 0 }],
      measures: source.measures.map((measure, index) => index === 0
        ? { ...measure, melody: Array.from({ length: 4 }, () => melodyNote) }
        : measure),
    };
    assert.deepStrictEqual(validateInterchangeScore(withMelody), []);
    const melodyResult = planGp78ChordStrum(withMelody);
    assert.strictEqual(melodyResult.ok, false);
    if (!melodyResult.ok) {
      assert.strictEqual(melodyResult.reason, 'mixedMelody');
      assert.ok(!('score' in melodyResult), 'a mixed score must never return partial optimized output');
    }

    const alterFirstBeat = (alter: (first: InterchangeTabBeat) => InterchangeTabBeat): InterchangeScore => ({
      ...source,
      measures: source.measures.map((measure, index) => index !== 0 ? measure : {
        ...measure,
        tabVoices: measure.tabVoices!.map(voice => ({
          ...voice,
          beats: voice.beats.map((item, beatIndex) => beatIndex === 0 ? alter(item) : item),
        })),
      }),
    });
    const disallowed: Array<[string, InterchangeScore]> = [
      ['tie', alterFirstBeat(first => ({
        ...first,
        notes: first.notes.map((note, index) => index === 0 ? { ...note, tieToNext: true } : note),
      }))],
      ['dead note', alterFirstBeat(first => ({
        ...first,
        notes: first.notes.map((note, index) => index === 0 ? { ...note, dead: true, fret: undefined } : note),
      }))],
      ['note effect', alterFirstBeat(first => ({
        ...first,
        notes: first.notes.map((note, index) => index === 0 ? { ...note, effects: [{ name: 'pm', args: {} }] } : note),
      }))],
      ['beat effect', alterFirstBeat(first => ({ ...first, effects: [{ name: 'pm', args: {} }] }))],
      ['out-of-range fret', alterFirstBeat(first => ({
        ...first,
        notes: first.notes.map((note, index) => index === 0 ? { ...note, fret: 25 } : note),
      }))],
      ['arpeggio-like single-note attack', alterFirstBeat(first => ({ ...first, notes: tabNotes(['x', 'x', 'x', 'x', 'x', 0]) }))],
    ];
    for (const [name, score] of disallowed) {
      const result = planGp78ChordStrum(score);
      assert.strictEqual(result.ok, false, `${name} must reject the whole score`);
      assert.ok(!('score' in result), `${name} must not return a partial score`);
    }
  });

  it('adapts only one safe first-beat lyric and rejects authored skips', () => {
    const syllable = { text: 'home', hyphenToNext: false, extend: false };
    const safe = strumScore([
      beat(C_MAJOR, 2, [syllable]), beat(C_MAJOR, 2),
    ]);
    const adapted = planGp78ChordStrum(safe);
    assert.strictEqual(adapted.ok, true, JSON.stringify(adapted));
    if (adapted.ok) {
      assert.strictEqual(adapted.score.measures[0].measureLyric, 'home');
      assert.ok(adapted.loss.entries.some(entry => entry.code === 'adaptedMeasureLyric'));
    }

    const skipped = strumScore([
      beat(C_MAJOR, 2, [null]), beat(C_MAJOR, 2),
    ]);
    const rejected = planGp78ChordStrum(skipped);
    assert.strictEqual(rejected.ok, false);
    if (!rejected.ok) assert.strictEqual(rejected.reason, 'unsupportedLyrics');
  });

  it('preserves empty final and chord-only measures without inventing rhythm attacks', () => {
    const base = strumScore([
      beat(C_MAJOR, 4), beat(C_MAJOR, 4), beat(C_MAJOR, 4), beat(C_MAJOR, 4),
    ]);
    const first = base.measures[0];
    const withoutTab = JSON.parse(JSON.stringify(first)) as InterchangeMeasure;
    delete (withoutTab as { tabVoices?: InterchangeMeasure['tabVoices'] }).tabVoices;
    delete (withoutTab as { sectionStart?: string }).sectionStart;
    delete (withoutTab as { pageBreakBefore?: boolean }).pageBreakBefore;
    const notFinal = { ...first.barline, finalEnd: false };
    const chordOnlyBar: InterchangeMeasure = {
      ...withoutTab,
      index: 1,
      barline: { ...notFinal },
      chords: [{ name: 'C', beatOffset: { n: 0, d: 1 } }],
      chordPlacementMode: 'inline',
      rhythm: { origin: 'implicit', events: [] },
    };
    const emptyFinalBar: InterchangeMeasure = {
      ...withoutTab,
      index: 2,
      barline: { ...first.barline, finalEnd: true },
      chords: [],
      rhythm: { origin: 'implicit', events: [] },
    };
    const withEmptyMeasures: InterchangeScore = {
      ...base,
      chordDefinitions: [{ name: 'C', frets: [...C_MAJOR], barres: [] }],
      measures: [{ ...first, index: 0, barline: notFinal }, chordOnlyBar, emptyFinalBar],
    };
    assert.deepStrictEqual(validateInterchangeScore(withEmptyMeasures), []);
    const result = planGp78ChordStrum(withEmptyMeasures);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.deepStrictEqual(result.score.measures[1], chordOnlyBar);
    assert.deepStrictEqual(result.score.measures[2], emptyFinalBar);

    const converted = interchangeToGuitarDsl(result.score, result.loss);
    assert.strictEqual(converted.ok, true, JSON.stringify(converted));
    if (!converted.ok) return;
    const parsed = parseGuitarDsl(converted.value);
    assert.deepStrictEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);
    const restored = guitarDslToInterchange(converted.value);
    assert.strictEqual(restored.ok, true, JSON.stringify(restored));
    if (!restored.ok) return;
    assert.deepStrictEqual(restored.value.measures.map(measure => measure.rhythm.events.length), [4, 0, 0]);
    assert.strictEqual(restored.value.measures[1].rhythm.origin, 'implicit');
    assert.deepStrictEqual(restored.value.measures[1].chords, [{ name: 'C', beatOffset: { n: 0, d: 1 } }]);
    assert.strictEqual(restored.value.measures[2].rhythm.origin, 'implicit');
    assert.deepStrictEqual(restored.value.measures[2].chords, []);
    assert.strictEqual(restored.value.measures[2].barline.finalEnd, true);
    assert.strictEqual(restored.value.measures[1].tabVoices, undefined);
    assert.strictEqual(restored.value.measures[2].tabVoices, undefined);
  });

  it('stops at the documented measure and TAB-beat limits', () => {
    const base = sourceScore();
    const tooManyMeasures = {
      ...base,
      measures: Array.from({ length: 2_001 }, (_, index) => ({ ...base.measures[0], index })),
    } as InterchangeScore;
    const measureResult = planGp78ChordStrum(tooManyMeasures);
    assert.strictEqual(measureResult.ok, false);
    if (!measureResult.ok) assert.strictEqual(measureResult.reason, 'resourceLimit');

    const manyBeats = Array.from({ length: 20_001 }, () => beat(C_MAJOR, 4));
    const beatResult = planGp78ChordStrum(strumScore(manyBeats));
    assert.strictEqual(beatResult.ok, false);
    if (!beatResult.ok) assert.strictEqual(beatResult.reason, 'resourceLimit');
  });

  it('plans a self-authored GP8 chord-strum fixture after native GP8 save', () => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/gp78/F11-chord-strum-gp8.gp')));
    const inspection = inspectGp78(bytes);
    assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
    if (!inspection.ok) return;
    assert.strictEqual(inspection.value.family, 'gp8');
    const track = inspection.value.tracks.find(candidate => candidate.eligible);
    assert.ok(track);
    if (!track) return;
    const imported = importGp78(bytes, track.id);
    assert.strictEqual(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;
    const result = planGp78ChordStrum(imported.value);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.strictEqual(result.stats.attacks, 4);
    assert.deepStrictEqual(result.score.measures[0].chords.map(chord => chord.name), ['C']);
    assert.strictEqual(result.stats.inferredChords, 1);
  });

  it('round-trips a generated GP7-compatible strum fixture through the unchanged writer and planner', () => {
    const source = strumScore([
      beat(C_MAJOR, 4), beat(C_MAJOR, 4), beat(C_MAJOR, 4), beat(C_MAJOR, 4),
    ]);
    const written = exportGp78(source);
    assert.strictEqual(written.ok, true, JSON.stringify(written));
    if (!written.ok) return;
    const inspection = inspectGp78(written.value);
    assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
    if (!inspection.ok) return;
    assert.strictEqual(inspection.value.family, 'gp7');
    const track = inspection.value.tracks.find(candidate => candidate.eligible);
    assert.ok(track);
    if (!track) return;
    const imported = importGp78(written.value, track.id);
    assert.strictEqual(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;
    const result = planGp78ChordStrum(imported.value);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.strictEqual(result.stats.attacks, 4);
    assert.deepStrictEqual(result.score.measures[0].chords.map(chord => chord.name), ['C']);
    assert.strictEqual(result.stats.inferredChords, 1);
  });
});
