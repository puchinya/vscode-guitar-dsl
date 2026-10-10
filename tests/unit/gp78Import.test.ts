import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { exportGp78, importGp78, inspectGp78 } from '../../src/gp78';
import { extractGpif } from '../../src/gp78/archive';
import { guitarDslToInterchange, hasBlockingLoss, interchangeToGuitarDsl } from '../../src/interchange';
import type { InterchangeMeasure } from '../../src/interchange';
import { parseGuitarDsl } from '../../src/compiler';
import { resolvePlayOrder } from '../../src/playOrder';
import { buildGpifMelodyGroups, resolveTabNoteLinks } from '../../src/gp78/tracks';

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

function replaceGpif(source: Uint8Array, gpif: string): Uint8Array {
  const entries = unzipSync(source);
  entries['Content/score.gpif'] = strToU8(gpif);
  return zipSync(entries);
}

function replacePartConfiguration(source: Uint8Array, partConfiguration: Uint8Array): Uint8Array {
  const entries = unzipSync(source);
  entries['Content/PartConfiguration'] = partConfiguration;
  return zipSync(entries);
}

function encodePartConfiguration(views: readonly (readonly number[])[], activeView: number): Uint8Array {
  const bytes: number[] = [];
  const pushUInt32 = (value: number) => bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  pushUInt32(views.length);
  for (const flags of views) {
    bytes.push(0);
    pushUInt32(flags.length);
    bytes.push(...flags);
  }
  pushUInt32(activeView);
  return Uint8Array.from(bytes);
}

function addFirstMasterBarChild(gpif: string, child: string): string {
  const openingTag = /<MasterBar(?:\s[^>]*)?>/.exec(gpif);
  assert.ok(openingTag, 'the fixture has a master bar');
  if (!openingTag) return gpif;
  const close = gpif.indexOf('</MasterBar>', openingTag.index + openingTag[0].length);
  assert.notStrictEqual(close, -1, 'the fixture master bar is closed');
  return gpif.slice(0, close) + child + gpif.slice(close);
}

function addBeatLyrics(gpif: string, beatId: number, lines: readonly string[]): string {
  const marker = `<Beat id="${beatId}">`;
  assert.ok(gpif.includes(marker), `Beat ${beatId} is present in the fixture`);
  const lyrics = `<Lyrics>${lines.map(text => `<Line>${text}</Line>`).join('')}</Lyrics>`;
  return gpif.replace(marker, `${marker}${lyrics}`);
}

function removeBeatNotes(gpif: string, beatId: number): string {
  const marker = `<Beat id="${beatId}">`;
  const start = gpif.indexOf(marker);
  assert.notStrictEqual(start, -1, `Beat ${beatId} is present in the fixture`);
  const end = gpif.indexOf('</Beat>', start);
  assert.notStrictEqual(end, -1, `Beat ${beatId} is closed in the fixture`);
  const beat = gpif.slice(start, end + '</Beat>'.length);
  assert.match(beat, /<Notes>[^<]*<\/Notes>/);
  return gpif.slice(0, start) + beat.replace(/<Notes>[^<]*<\/Notes>/, '') + gpif.slice(end + '</Beat>'.length);
}

function emptyFirstVoiceBeatList(gpif: string): string {
  const voiceStart = gpif.indexOf('<Voice id=');
  assert.notStrictEqual(voiceStart, -1, 'the fixture has a voice definition');
  const beatsStart = gpif.indexOf('<Beats>', voiceStart);
  const beatsEnd = gpif.indexOf('</Beats>', beatsStart);
  assert.ok(beatsStart > voiceStart && beatsEnd > beatsStart, 'the fixture voice has a beat list');
  return gpif.slice(0, beatsStart) + '<Beats></Beats>' + gpif.slice(beatsEnd + '</Beats>'.length);
}

describe('GP7/8 GPIF import', () => {
  it('splits melody groups at imported section boundaries', () => {
    const note = { syllables: [{ text: 'la', hyphenToNext: false, extend: false }] };
    assert.deepStrictEqual(buildGpifMelodyGroups([
      { sectionStart: 'Intro', melody: [note] },
      { melody: [note] },
      { sectionStart: 'Verse', melody: [note] },
      {},
    ]), [
      { startMeasure: 0, endMeasureExclusive: 2, verseCount: 1 },
      { startMeasure: 2, endMeasureExclusive: 3, verseCount: 1 },
    ]);
  });

  it('resolves same-string TAB links in a 20,000-position score', () => {
    const positionCount = 20_000;
    const measure: InterchangeMeasure = {
      index: 0,
      expectedBeats: { n: 1, d: 1 },
      barline: { repeatStart: false, repeatEnd: false, doubleEnd: false, finalEnd: false },
      eventsBefore: [],
      chords: [],
      chordPlacementMode: 'equalSplit',
      rhythm: { origin: 'implicit', events: [] },
      tabVoices: [{
        voice: 1,
        beats: Array.from({ length: positionCount }, (_, index) => ({
          isRest: false,
          notes: [{ string: 2, fret: index === 0 ? 2 : index === 1 ? 3 : 0, dead: false, tieToNext: false, effects: [] }],
          duration: { beats: { n: 1, d: 1 }, parts: [{ base: 4, dotted: false }] },
          effects: [],
          syllables: [],
        })),
      }],
    };
    const markers = Array.from({ length: positionCount }, (_, index) => [{
      hopoOrigin: index === 0,
      hopoDestination: index === 1,
      tieOrigin: false,
      tieDestination: false,
    }]);
    const measures = [measure];

    resolveTabNoteLinks(measures, [markers]);

    assert.deepStrictEqual(measures[0].tabVoices?.[0].beats[0].notes[0].effects, [{ name: 'hammer', args: {} }]);
    assert.deepStrictEqual(measures[0].tabVoices?.[0].beats[1].notes[0].effects, []);
    assert.strictEqual(measures[0].tabVoices?.[0].beats.length, positionCount);
  });

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

  it('preserves supported master-bar section and double-bar data and blocks unsupported markers', () => {
    const source = fixture('F01-standard-4-4.gp');
    const sourceGpif = new TextDecoder().decode(extractGpif(source).gpif);
    const withSection = replaceGpif(source, addFirstMasterBarChild(sourceGpif,
      '<Section><Letter><![CDATA[A]]></Letter><Text><![CDATA[Intro]]></Text></Section>'));
    const section = importFirstTrack(withSection);
    assert.strictEqual(section.ok, true, JSON.stringify(section));
    if (section.ok) {
      assert.strictEqual(section.value.measures[0].sectionStart, 'Intro');
      assert.deepStrictEqual(section.loss.entries.filter(entry => entry.code === 'omittedSectionLetter').map(entry => ({
        category: entry.category,
        policyId: entry.policyId,
      })), [{ category: 'droppedByPolicy', policyId: 'gp78.omit-section-letter.v1' }]);
      const exported = exportGp78(section.value);
      assert.strictEqual(exported.ok, true, JSON.stringify(exported));
      if (exported.ok) {
        const exportedGpif = new TextDecoder().decode(extractGpif(exported.value).gpif);
        assert.ok(exportedGpif.includes('<Section><Letter>A</Letter><Text>Intro</Text></Section>'));
        const reimported = importFirstTrack(exported.value);
        assert.strictEqual(reimported.ok, true, JSON.stringify(reimported));
        if (reimported.ok) assert.strictEqual(reimported.value.measures[0].sectionStart, 'Intro');
      }
    }

    const withDoubleBar = replaceGpif(source, addFirstMasterBarChild(sourceGpif, '<DoubleBar />'));
    const doubleBar = importFirstTrack(withDoubleBar);
    assert.strictEqual(doubleBar.ok, true, JSON.stringify(doubleBar));
    if (doubleBar.ok) {
      assert.strictEqual(doubleBar.value.measures[0].barline.doubleEnd, true);
      const exported = exportGp78(doubleBar.value);
      assert.strictEqual(exported.ok, true, JSON.stringify(exported));
      if (exported.ok) {
        const exportedGpif = new TextDecoder().decode(extractGpif(exported.value).gpif);
        assert.ok(exportedGpif.includes('<DoubleBar />'));
        const reimported = importFirstTrack(exported.value);
        assert.strictEqual(reimported.ok, true, JSON.stringify(reimported));
        if (reimported.ok) assert.strictEqual(reimported.value.measures[0].barline.doubleEnd, true);
      }
    }

    for (const [tag, markup] of [
      ['FreeTime', '<FreeTime />'],
      ['Fermatas', '<Fermatas><Fermata /></Fermatas>'],
    ] as const) {
      const unsupported = importFirstTrack(replaceGpif(source, addFirstMasterBarChild(sourceGpif, markup)));
      assert.strictEqual(unsupported.ok, false, `${tag} must not import with silent loss`);
      if (!unsupported.ok) {
        assert.strictEqual(unsupported.code, 'unsupportedSemantics');
        assert.match(unsupported.errors[0].path, new RegExp(`/MasterBar\\[0\\]/${tag}$`));
        assert.strictEqual(unsupported.loss.entries[0]?.category, 'unsupported');
      }
    }
  });

  it('rejects score views with conflicting notation flags regardless of active view index', () => {
    const source = fixture('F01-standard-4-4.gp');
    for (const activeView of [0, 1]) {
      const bytes = replacePartConfiguration(source, encodePartConfiguration([[0x01], [0x02]], activeView));
      const result = importGp78(bytes, 0);
      assert.strictEqual(result.ok, false, `active view ${activeView} must not select an unverified notation view`);
      if (!result.ok) {
        assert.strictEqual(result.code, 'unsupportedSemantics');
        assert.strictEqual(result.errors[0].path, 'Content/PartConfiguration');
      }
    }

    const equivalentViews = replacePartConfiguration(source, encodePartConfiguration([[0x03], [0x03]], 1));
    const result = importGp78(equivalentViews, 0);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (result.ok) assert.strictEqual(result.value.measures[0].tabVoices?.[0].beats[0].notes[0].string, 2);
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

  it('keeps a GPIF bar with no voice beats through GuitarDSL and GP7 roundtrip without attacks or lyrics', () => {
    const source = fixture('F01-standard-4-4.gp');
    const gpif = emptyFirstVoiceBeatList(new TextDecoder().decode(extractGpif(source).gpif));
    const imported = importFirstTrack(replaceGpif(source, gpif));
    assert.strictEqual(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;
    assert.strictEqual(imported.value.measures.length, 1);
    const emptyMeasure = imported.value.measures[0];
    assert.deepStrictEqual(emptyMeasure.chords, []);
    assert.strictEqual(emptyMeasure.melody, undefined);
    assert.strictEqual(emptyMeasure.tabVoices, undefined);

    const serialized = interchangeToGuitarDsl(imported.value);
    assert.strictEqual(serialized.ok, true, JSON.stringify(serialized));
    if (!serialized.ok) return;
    assert.match(serialized.value, /\| N\.C\. \|/);
    const parsed = parseGuitarDsl(serialized.value);
    assert.deepStrictEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);
    assert.strictEqual(parsed.measures.length, 1);
    assert.deepStrictEqual(parsed.measures[0].rhythms, []);
    const restored = guitarDslToInterchange(serialized.value);
    assert.strictEqual(restored.ok, true, JSON.stringify(restored));
    if (!restored.ok) return;
    assert.strictEqual(restored.value.measures.length, 1);
    assert.deepStrictEqual(restored.value.measures[0].chords, []);
    assert.deepStrictEqual(restored.value.measures[0].rhythm.events, []);

    const exported = exportGp78(restored.value);
    assert.strictEqual(exported.ok, true, JSON.stringify(exported));
    if (!exported.ok) return;
    const reimported = importFirstTrack(exported.value);
    assert.strictEqual(reimported.ok, true, JSON.stringify(reimported));
    if (!reimported.ok) return;
    assert.strictEqual(reimported.value.measures.length, 1);
    assert.deepStrictEqual(reimported.value.measures[0].chords, []);
    assert.strictEqual(reimported.value.measures[0].melody, undefined);
    assert.strictEqual(reimported.value.measures[0].tabVoices, undefined);
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

  it('maps rhythm-bearing empty beats to duration-preserving rests without lyric slots', () => {
    const tabSource = fixture('F01-standard-4-4.gp');
    const tabGpif = removeBeatNotes(new TextDecoder().decode(extractGpif(tabSource).gpif), 0);
    const tab = importFirstTrack(replaceGpif(tabSource, tabGpif));
    assert.strictEqual(tab.ok, true, JSON.stringify(tab));
    if (!tab.ok) return;
    const tabRest = tab.value.measures[0].tabVoices?.[0].beats[0];
    assert.strictEqual(tabRest?.isRest, true);
    assert.deepStrictEqual(tabRest?.syllables, []);
    assert.strictEqual(tab.value.measures[0].melody, undefined);

    const melodySource = fixture('F10-melody-only.gp');
    const melodyGpif = removeBeatNotes(new TextDecoder().decode(extractGpif(melodySource).gpif), 0);
    const melody = importFirstTrack(replaceGpif(melodySource, melodyGpif));
    assert.strictEqual(melody.ok, true, JSON.stringify(melody));
    if (!melody.ok) return;
    assert.strictEqual(melody.value.measures[0].tabVoices, undefined);
    assert.strictEqual(melody.value.measures[0].melody?.[0].isRest, true);
    assert.deepStrictEqual(melody.value.measures[0].melody?.[0].syllables, []);
    const scoreWithTestAnchor = {
      ...melody.value,
      measures: melody.value.measures.map(measure => ({
        ...measure,
        chords: [{ name: 'C', beatOffset: { n: 0, d: 1 } }],
        chordPlacementMode: 'equalSplit' as const,
      })),
    };
    const serialized = interchangeToGuitarDsl(scoreWithTestAnchor);
    assert.strictEqual(serialized.ok, true, JSON.stringify(serialized));
    if (serialized.ok) assert.deepStrictEqual(parseGuitarDsl(serialized.value).diagnostics.filter(item => item.severity === 'error'), []);
  });

  it('preserves GPIF TAB lyrics, verse order, internal skips, and ignores trailing blank lines', () => {
    const source = fixture('F05-techniques.gp');
    let gpif = new TextDecoder().decode(extractGpif(source).gpif);
    gpif = addBeatLyrics(gpif, 0, ['あいう', 'かきく', '', '', '']);
    gpif = addBeatLyrics(gpif, 2, ['さしす', 'せそ', '', '', '']);
    const result = importFirstTrack(replaceGpif(source, gpif));
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    const beats = result.value.measures.flatMap(measure => measure.tabVoices?.[0].beats ?? []);
    const slots = beats.slice(0, 4).map(beat => beat.syllables.map(value =>
      value === null ? null : 'kind' in value ? 'omitted' : value.text));
    assert.deepStrictEqual(slots, [
      ['あいう', 'かきく'],
      [null, null],
      ['さしす', 'せそ'],
      [],
    ]);

    const scoreWithTestAnchors = {
      ...result.value,
      measures: result.value.measures.map(measure => ({
        ...measure,
        chords: [{ name: 'C', beatOffset: { n: 0, d: 1 } }],
        chordPlacementMode: 'equalSplit' as const,
      })),
    };
    const serialized = interchangeToGuitarDsl(scoreWithTestAnchors);
    assert.strictEqual(serialized.ok, true, JSON.stringify(serialized));
    if (!serialized.ok) return;
    const parsed = parseGuitarDsl(serialized.value);
    assert.deepStrictEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);
    assert.deepStrictEqual(serialized.value.split('\n').filter(line => line.startsWith('lyr:')), [
      'lyr: (あいう) * (さしす)',
      'lyr: (かきく) * (せそ)',
    ]);

    const restored = guitarDslToInterchange(serialized.value);
    assert.strictEqual(restored.ok, true, JSON.stringify(restored));
    if (!restored.ok) return;
    const restoredBeats = restored.value.measures.flatMap(measure => measure.tabVoices?.[0].beats ?? []);
    assert.deepStrictEqual(restoredBeats.slice(0, 4).map(beat => beat.syllables.map(value =>
      value === null ? null : 'kind' in value ? 'omitted' : value.text)), slots);
  });

  it('maps GPIF lyrics to standard-staff melody notes and rejects lyrics on a tied continuation', () => {
    const melodySource = fixture('F10-melody-only.gp');
    const melodyGpif = addBeatLyrics(new TextDecoder().decode(extractGpif(melodySource).gpif), 0, ['あいう', '', '', '', '']);
    const melody = importFirstTrack(replaceGpif(melodySource, melodyGpif));
    assert.strictEqual(melody.ok, true, JSON.stringify(melody));
    if (!melody.ok) return;
    assert.deepStrictEqual(melody.value.measures[0].melody?.[0].syllables.map(value =>
      value === null ? null : 'kind' in value ? 'omitted' : value.text), ['あいう']);
    assert.strictEqual(melody.value.melodyGroups[0].verseCount, 1);

    const tiedSource = fixture('F05-techniques.gp');
    const tiedGpif = addBeatLyrics(new TextDecoder().decode(extractGpif(tiedSource).gpif), 6, ['あいう', '', '', '', '']);
    const tied = importFirstTrack(replaceGpif(tiedSource, tiedGpif));
    assert.strictEqual(tied.ok, false);
    if (!tied.ok) {
      assert.strictEqual(tied.code, 'unsupportedSemantics');
      assert.strictEqual(tied.errors[0].path, 'GPIF/Beats/Beat[id=6]/Lyrics/Line[0]');
    }
  });

  it('imports GP8 standard-only sentinel values after native re-save without inventing TAB positions', () => {
    const sourceGpif = new TextDecoder().decode(extractGpif(fixture('F10-melody-only.gp')).gpif);
    const gp8ResavedGpif = sourceGpif
      .replace('<Fret>1</Fret>', '<Fret>-2147483648</Fret>')
      .replace('<Number>65</Number>', '<Number>2147483648</Number>')
      .replace('<String>5</String>', '<String>0</String>');
    assert.notStrictEqual(gp8ResavedGpif, sourceGpif);
    const result = importFirstTrack(replaceGpif(fixture('F10-melody-only.gp'), gp8ResavedGpif));
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
