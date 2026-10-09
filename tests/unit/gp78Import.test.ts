import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { strToU8, zipSync } from 'fflate';
import { importGp78, inspectGp78 } from '../../src/gp78';
import { extractGpif } from '../../src/gp78/archive';
import { hasBlockingLoss } from '../../src/interchange';
import { resolvePlayOrder } from '../../src/playOrder';

const ROOT = path.resolve(__dirname, '../..');
function fixture(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/gp78', name)));
}
function importFirstTrack(bytes: Uint8Array) {
  const inspection = inspectGp78(bytes);
  assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
  if (!inspection.ok) throw new Error(JSON.stringify(inspection));
  const track = inspection.value.tracks.find(candidate => candidate.eligible);
  assert.ok(track);
  return importGp78(bytes, track.id);
}

describe('GP7/8 GPIF import', () => {
  it('imports GP8 Standard TAB with validated tuning, fret, string, and pitch', () => {
    const result = importFirstTrack(fixture('F01-standard-4-4.gp'));
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.strictEqual(result.value.metadata.tuning.preset, 'Standard');
    assert.strictEqual(result.value.metadata.capo, 0);
    const note = result.value.measures[0].tabVoices?.[0].beats[0].notes[0];
    assert.deepStrictEqual(note && { string: note.string, fret: note.fret }, { string: 2, fret: 0 });
  });

  it('imports Drop D and capo 2 without changing the authored string position', () => {
    const result = importFirstTrack(fixture('F02-drop-d-capo2.gp'));
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.deepStrictEqual(result.value.metadata.tuning.openMidi, [38, 45, 50, 55, 59, 64]);
    assert.strictEqual(result.value.metadata.capo, 2);
    const note = result.value.measures[0].tabVoices?.[0].beats[0].notes[0];
    assert.deepStrictEqual(note && { string: note.string, fret: note.fret }, { string: 2, fret: 0 });
  });

  it('imports pickup length, changing meter/key, and a later tempo automation', () => {
    const result = importFirstTrack(fixture('F03-time-meter-key-pickup.gp'));
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.deepStrictEqual(result.value.metadata.pickup, { n: 1, d: 1 });
    assert.deepStrictEqual({ pickup: result.value.measures[0].isPickup, beats: result.value.measures[0].expectedBeats }, {
      pickup: true, beats: { n: 1, d: 1 },
    });
    assert.deepStrictEqual(result.value.measures[1].eventsBefore, [
      { kind: 'keyChange', key: 'A' },
      { kind: 'timeSignatureChange', timeSignature: { numerator: 7, denominator: 8, groups: [2, 2, 3] } },
      { kind: 'tempoChange', bpm: 90 },
    ]);
  });

  it('imports TAB ties, simple GP8 techniques, and 3:2 tuplets without flattening them', () => {
    const result = importFirstTrack(fixture('F05-techniques.gp'));
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    const measures = result.value.measures;
    const beats = measures.map(measure => measure.tabVoices?.[0].beats ?? []);
    assert.deepStrictEqual(beats[0][1].notes[0].effects, [{ name: 'hammer', args: {} }]);
    assert.deepStrictEqual(beats[0][2].notes[0].effects, [{ name: 'slide', args: {} }]);
    assert.deepStrictEqual(beats[0][3].notes[0].effects, [{ name: 'bend', args: { amount: 2 } }]);
    assert.deepStrictEqual(beats[1][0].notes[0].effects, [{ name: 'let-ring', args: {} }]);
    assert.deepStrictEqual(beats[1][1].notes[0].effects, [{ name: 'pm', args: {} }]);
    assert.strictEqual(beats[1][1].notes[0].tieToNext, true);
    assert.strictEqual(beats[1][2].notes[0].tieToNext, false);
    assert.deepStrictEqual(beats[2].map(beat => beat.duration), [0, 1, 2].map(() => ({
      beats: { n: 2, d: 3 }, parts: [{ base: 4, dotted: false, tuplet: { actual: 3, normal: 2 } }],
    })));
  });

  it('preserves chord diagram references, beat onset, and repeats', () => {
    const chord = importFirstTrack(fixture('F04-chord-onsets.gp'));
    assert.strictEqual(chord.ok, true, JSON.stringify(chord));
    if (!chord.ok) return;
    assert.deepStrictEqual(chord.value.measures[0].chords, [
      { name: 'C', beatOffset: { n: 0, d: 1 } },
      { name: 'G/B', beatOffset: { n: 1, d: 1 } },
    ]);
    assert.deepStrictEqual(chord.value.chordDefinitions.map(definition => definition.name), ['C', 'G/B']);

    const repeated = importFirstTrack(fixture('F06-repeat.gp'));
    assert.strictEqual(repeated.ok, true, JSON.stringify(repeated));
    if (repeated.ok) assert.deepStrictEqual(
      { start: repeated.value.measures[0].barline.repeatStart, end: repeated.value.measures[0].barline.repeatEnd },
      { start: true, end: true },
    );
  });

  it('imports GP8 repeat endings and D.S. al Coda into the shared play order', () => {
    const result = importFirstTrack(fixture('F06-navigation.gp'));
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.deepStrictEqual(result.value.measures.map(measure => ({
      repeatStart: measure.barline.repeatStart,
      repeatEnd: measure.barline.repeatEnd,
      ...(measure.barline.bracket ? { bracket: measure.barline.bracket } : {}),
      ...(measure.barline.specialMark ? { specialMark: measure.barline.specialMark } : {}),
    })), [
      { repeatStart: true, repeatEnd: false, specialMark: 'segno' },
      { repeatStart: false, repeatEnd: true, bracket: '1.' },
      { repeatStart: false, repeatEnd: false, bracket: '2.' },
      { repeatStart: false, repeatEnd: false, specialMark: 'ds' },
      { repeatStart: false, repeatEnd: false, specialMark: 'to_coda' },
      { repeatStart: false, repeatEnd: false, specialMark: 'coda' },
    ]);
    const playOrder = resolvePlayOrder(result.value.measures.map(measure => ({
      measureIndex: measure.index,
      repeatStart: measure.barline.repeatStart,
      repeatEnd: measure.barline.repeatEnd,
      bracket: measure.barline.bracket,
      specialMark: measure.barline.specialMark,
    })));
    assert.strictEqual(playOrder.valid, true, JSON.stringify(playOrder.diagnostics));
    assert.deepStrictEqual(playOrder.occurrences.map(occurrence => occurrence.measureIndex), [0, 1, 0, 2, 3, 0, 2, 3, 4, 5]);
  });

  it('lists F07 guitar, bass, and drums while blocking a guitar with voice 2', () => {
    const bytes = fixture('F07-multitrack-voice2.gp');
    const inspection = inspectGp78(bytes);
    assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
    if (!inspection.ok) return;
    assert.deepStrictEqual(inspection.value.tracks.map(track => ({ name: track.name, eligible: track.eligible, reasonCode: track.reasonCode })), [
      { name: 'Overdriven Guitar', eligible: false, reasonCode: 'multipleVoices' },
      { name: 'Overdriven Guitar', eligible: true, reasonCode: undefined },
      { name: 'Acoustic Bass', eligible: false, reasonCode: 'notSixStringGuitar' },
      { name: 'Drumkit', eligible: false, reasonCode: 'notSixStringGuitar' },
    ]);
    const voice2 = importGp78(bytes, inspection.value.tracks[0].id);
    assert.strictEqual(voice2.ok, false);
    if (!voice2.ok) assert.strictEqual(voice2.code, 'unsupportedSemantics');
    const guitar = importGp78(bytes, inspection.value.tracks[1].id);
    assert.strictEqual(guitar.ok, true, JSON.stringify(guitar));
    if (guitar.ok) assert.strictEqual(guitar.value.measures[0].tabVoices, undefined);
  });

  it('imports a chord-only score without inventing TAB notes', () => {
    const result = importFirstTrack(fixture('F09-chord-only.gp'));
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.strictEqual(result.value.measures[0].tabVoices, undefined);
    assert.strictEqual(result.value.measures[0].chords[0].name, 'C');
  });

  it('imports a GP8 standard-only guitar track as melody without inventing string positions', () => {
    const bytes = fixture('F10-melody-only.gp');
    const inspection = inspectGp78(bytes);
    assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
    if (!inspection.ok) return;
    const track = inspection.value.tracks.find(candidate => candidate.eligible);
    assert.ok(track);
    const result = importGp78(bytes, track!.id);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    const measure = result.value.measures[0];
    assert.strictEqual(measure.tabVoices, undefined);
    assert.deepStrictEqual(measure.melody?.map(note => note.pitch), [{ step: 'f', alter: 0, octave: 5 }]);
    assert.ok(!('string' in measure.melody![0]) && !('fret' in measure.melody![0]));
  });

  it('imports GP8 standard-only sentinel values after native re-save without inventing TAB positions', () => {
    const sourceGpif = new TextDecoder().decode(extractGpif(fixture('F10-melody-only.gp')).gpif);
    const gp8ResavedGpif = sourceGpif
      .replace('<Fret>1</Fret>', '<Fret>-2147483648</Fret>')
      .replace('<Number>65</Number>', '<Number>2147483648</Number>')
      .replace('<String>5</String>', '<String>0</String>');
    assert.notStrictEqual(gp8ResavedGpif, sourceGpif);
    const result = importFirstTrack(zipSync({ 'Content/score.gpif': strToU8(gp8ResavedGpif) }));
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    const measure = result.value.measures[0];
    assert.strictEqual(measure.tabVoices, undefined);
    assert.deepStrictEqual(measure.melody?.map(note => note.pitch), [{ step: 'f', alter: 0, octave: 5 }]);
    assert.ok(!('string' in measure.melody![0]) && !('fret' in measure.melody![0]));
  });

  it('blocks an unsupported GP8 trill with a blocking unsupported loss', () => {
    const bytes = fixture('F08-advanced-technique.gp');
    const inspection = inspectGp78(bytes);
    assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
    if (!inspection.ok) return;
    const track = inspection.value.tracks.find(candidate => candidate.eligible);
    assert.ok(track);
    if (!track) return;
    const result = importGp78(bytes, track.id);
    assert.strictEqual(result.ok, false);
    if (result.ok) return;
    assert.strictEqual(result.code, 'unsupportedSemantics');
    assert.strictEqual(hasBlockingLoss(result.loss), true);
    assert.deepStrictEqual(result.loss.entries.map(entry => ({
      category: entry.category,
      code: entry.code,
      path: entry.path,
      detail: entry.detail,
    })), [{
      category: 'unsupported',
      code: 'unsupportedSemantics',
      path: result.errors[0].path,
      detail: result.errors[0].detail,
    }]);
    assert.match(result.errors[0].detail, /Trill/);
  });

  it('rejects GP9+ and unresolved IDs with typed errors', () => {
    const source = fixture('F01-standard-4-4.gp');
    const sourceGpif = new TextDecoder().decode(extractGpif(source).gpif);
    const newer = zipSync({ 'Content/score.gpif': strToU8(sourceGpif.replace('<GPVersion>8.1.5</GPVersion>', '<GPVersion>9.0</GPVersion>')) });
    const unsupported = inspectGp78(newer);
    assert.strictEqual(unsupported.ok, false);
    if (!unsupported.ok) assert.strictEqual(unsupported.code, 'unsupportedVersion');

    const broken = zipSync({ 'Content/score.gpif': strToU8(sourceGpif.replace('<Notes>0</Notes>', '<Notes>999</Notes>')) });
    const result = importFirstTrack(broken);
    assert.strictEqual(result.ok, false);
    if (!result.ok) assert.strictEqual(result.code, 'invalidGpif');
  });

  it('blocks unknown selected-track note semantics instead of dropping them', () => {
    const sourceGpif = new TextDecoder().decode(extractGpif(fixture('F01-standard-4-4.gp')).gpif);
    const withBend = zipSync({ 'Content/score.gpif': strToU8(sourceGpif.replace('</Note>', '<Bend /> </Note>')) });
    const result = importFirstTrack(withBend);
    assert.strictEqual(result.ok, false);
    if (!result.ok) assert.strictEqual(result.code, 'unsupportedSemantics');
  });
});
