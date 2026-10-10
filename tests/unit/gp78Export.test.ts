import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { importGp78, exportGp78, inspectGp78 } from '../../src/gp78';
import { extractGpif } from '../../src/gp78/archive';
import { gp78RoundTripMismatch } from '../../src/gp78/export';
import { parsePartConfiguration } from '../../src/gp78/partConfiguration';
import { publishGp78Exclusive } from '../../src/gp78Commands';
import { guitarDslToInterchange } from '../../src/interchange';

const ROOT = path.resolve(__dirname, '../..');
const fixture = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/gp78/F01-standard-4-4.gp')));

describe('GP7 writer', () => {
  it('exports and re-imports every representable Issue #97 contract fixture', () => {
    const fixtures = [
      'F01-standard-4-4.gp',
      'F02-drop-d-capo2.gp',
      'F03-time-meter-key-pickup.gp',
      'F04-chord-onsets.gp',
      'F05-techniques.gp',
      'F06-repeat.gp',
      'F06-navigation.gp',
      'F07-multitrack-voice2.gp',
      'F08-audio-syncpoint.gp',
      'F09-chord-only.gp',
      'F10-melody-only.gp',
    ];

    for (const name of fixtures) {
      const source = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/gp78', name)));
      const inspection = inspectGp78(source);
      assert.strictEqual(inspection.ok, true, `${name}: ${JSON.stringify(inspection)}`);
      if (!inspection.ok) continue;
      const selectedTrack = inspection.value.tracks.find(track => track.eligible);
      assert.ok(selectedTrack, `${name}: expected an eligible selected guitar track`);
      if (!selectedTrack) continue;
      const imported = importGp78(source, selectedTrack.id);
      assert.strictEqual(imported.ok, true, `${name}: ${JSON.stringify(imported)}`);
      if (!imported.ok) continue;
      const exported = exportGp78(imported.value);
      assert.strictEqual(exported.ok, true, `${name}: ${JSON.stringify(exported)}`);
      if (!exported.ok) continue;
      const reimported = importGp78(exported.value, 0);
      assert.strictEqual(reimported.ok, true, `${name} writer output: ${JSON.stringify(reimported)}`);
    }
  });

  it('writes deterministic GP7 containers with a successful semantic self-roundtrip', () => {
    const inspection = inspectGp78(fixture);
    assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
    if (!inspection.ok) return;
    const imported = importGp78(fixture, inspection.value.tracks[0].id);
    assert.strictEqual(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;
    const first = exportGp78(imported.value);
    const second = exportGp78(imported.value);
    assert.strictEqual(first.ok, true, JSON.stringify(first));
    assert.strictEqual(second.ok, true, JSON.stringify(second));
    if (!first.ok || !second.ok) return;
    assert.deepStrictEqual(first.value, second.value);
    const output = inspectGp78(first.value);
    assert.strictEqual(output.ok, true, JSON.stringify(output));
    if (output.ok) assert.deepStrictEqual({ family: output.value.family, gpVersion: output.value.gpVersion }, { family: 'gp7', gpVersion: '7.0' });
    const gpif = new TextDecoder().decode(extractGpif(first.value).gpif);
    assert.ok(gpif.includes('<Transpose><Chromatic>0</Chromatic><Octave>-1</Octave></Transpose>'));
    assert.ok(gpif.includes('<Property name="ConcertPitch"><Pitch><Step>B</Step><Accidental></Accidental><Octave>4</Octave></Pitch></Property>'));
    assert.ok(gpif.includes('<Property name="TransposedPitch"><Pitch><Step>B</Step><Accidental></Accidental><Octave>5</Octave></Pitch></Property>'));
  });

  it('exports Section and DoubleBar together for GP8.1.5 native acceptance', () => {
    const inspection = inspectGp78(fixture);
    assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
    if (!inspection.ok) return;
    const track = inspection.value.tracks.find(candidate => candidate.eligible);
    assert.ok(track, JSON.stringify(inspection));
    if (!track) return;
    const imported = importGp78(fixture, track.id);
    assert.strictEqual(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;

    const score = {
      ...imported.value,
      measures: imported.value.measures.map((measure, index) => index === 0 ? {
        ...measure,
        sectionStart: 'Intro',
        barline: { ...measure.barline, doubleEnd: true },
      } : measure),
    };
    const output = exportGp78(score);
    assert.strictEqual(output.ok, true, JSON.stringify(output));
    if (!output.ok) return;

    const gpif = new TextDecoder().decode(extractGpif(output.value).gpif);
    const firstMasterBar = /<MasterBar\b[^>]*>[\s\S]*?<\/MasterBar>/.exec(gpif)?.[0];
    assert.ok(firstMasterBar, 'the output has a first MasterBar');
    assert.match(firstMasterBar ?? '', /<Section><Letter><!\[CDATA\[\]\]><\/Letter><Text><!\[CDATA\[Intro\]\]><\/Text><\/Section>/);
    assert.match(firstMasterBar ?? '', /<DoubleBar\s*\/>/);

    const reimported = importGp78(output.value, 0);
    assert.strictEqual(reimported.ok, true, JSON.stringify(reimported));
    if (reimported.ok) {
      assert.strictEqual(reimported.value.measures[0].sectionStart, 'Intro');
      assert.strictEqual(reimported.value.measures[0].barline.doubleEnd, true);
    }
  });

  it('attaches chord diagrams to standard melody beat onsets during GP7 export', () => {
    const melody = guitarDslToInterchange('| C |\nmel: | c4/2 e4/2 |');
    assert.strictEqual(melody.ok, true, JSON.stringify(melody));
    if (!melody.ok) return;
    const chordSource = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/gp78/F04-chord-onsets.gp')));
    const chordInspection = inspectGp78(chordSource);
    assert.strictEqual(chordInspection.ok, true, JSON.stringify(chordInspection));
    if (!chordInspection.ok) return;
    const chordTrack = chordInspection.value.tracks.find(track => track.eligible);
    assert.ok(chordTrack);
    if (!chordTrack) return;
    const chordScore = importGp78(chordSource, chordTrack.id);
    assert.strictEqual(chordScore.ok, true, JSON.stringify(chordScore));
    if (!chordScore.ok) return;

    const score = {
      ...melody.value,
      chordDefinitions: chordScore.value.chordDefinitions,
      measures: melody.value.measures.map(measure => ({
        ...measure,
        chords: [
          { name: 'C', beatOffset: { n: 0, d: 1 } },
          { name: 'G/B', beatOffset: { n: 2, d: 1 } },
        ],
        chordPlacementMode: 'explicitDuration' as const,
      })),
    };
    const output = exportGp78(score);
    assert.strictEqual(output.ok, true, JSON.stringify(output));
    if (!output.ok) return;
    const roundtrip = importGp78(output.value, 0);
    assert.strictEqual(roundtrip.ok, true, JSON.stringify(roundtrip));
    if (!roundtrip.ok) return;
    assert.deepStrictEqual(roundtrip.value.measures[0].chords.map(chord => ({ name: chord.name, beatOffset: chord.beatOffset })), [
      { name: 'C', beatOffset: { n: 0, d: 1 } },
      { name: 'G/B', beatOffset: { n: 2, d: 1 } },
    ]);
    assert.deepStrictEqual(roundtrip.value.measures[0].melody?.map(note => note.pitch), [
      { step: 'c', alter: 0, octave: 4 },
      { step: 'e', alter: 0, octave: 4 },
    ]);
  });

  it('writes melody syllables as ordered GPIF lyric lines on their beats', () => {
    const score = guitarDslToInterchange('| N.C. |\nmel: | c4/2 e4/2 |\nlyr: | la li |');
    assert.strictEqual(score.ok, true, JSON.stringify(score));
    if (!score.ok) return;
    const output = exportGp78(score.value);
    assert.strictEqual(output.ok, true, JSON.stringify(output));
    if (!output.ok) return;
    const gpif = new TextDecoder().decode(extractGpif(output.value).gpif);
    assert.ok(gpif.includes('<Lyrics><Line>la</Line></Lyrics>'));
    assert.ok(gpif.includes('<Lyrics><Line>li</Line></Lyrics>'));
    const roundtrip = importGp78(output.value, 0);
    assert.strictEqual(roundtrip.ok, true, JSON.stringify(roundtrip));
    if (!roundtrip.ok) return;
    assert.deepStrictEqual(roundtrip.value.measures[0].melody?.map(note => note.syllables), [
      [{ text: 'la', hyphenToNext: false, extend: false }],
      [{ text: 'li', hyphenToNext: false, extend: false }],
    ]);
  });

  it('writes melody group ties to every pitch in the GPIF note group', () => {
    const score = guitarDslToInterchange('| N.C. |\nmel: | [c4,e4]/2~ [c4,e4]/2 |');
    assert.strictEqual(score.ok, true, JSON.stringify(score));
    if (!score.ok) return;
    const output = exportGp78(score.value);
    assert.strictEqual(output.ok, true, JSON.stringify(output));
    if (!output.ok) return;
    const gpif = new TextDecoder().decode(extractGpif(output.value).gpif);
    assert.strictEqual((gpif.match(/<Tie origin="true" destination="false" \/>/g) ?? []).length, 2);
    assert.strictEqual((gpif.match(/<Tie origin="false" destination="true" \/>/g) ?? []).length, 2);
    const roundtrip = importGp78(output.value, 0);
    assert.strictEqual(roundtrip.ok, true, JSON.stringify(roundtrip));
    if (!roundtrip.ok) return;
    assert.deepStrictEqual(roundtrip.value.measures[0].melody?.map(note => ({
      pitches: note.pitches,
      tieToNext: note.tieToNext,
      tiedFromPrev: note.tiedFromPrev,
    })), [
      { pitches: [{ step: 'c', alter: 0, octave: 4 }, { step: 'e', alter: 0, octave: 4 }], tieToNext: true, tiedFromPrev: false },
      { pitches: [{ step: 'c', alter: 0, octave: 4 }, { step: 'e', alter: 0, octave: 4 }], tieToNext: false, tiedFromPrev: true },
    ]);
  });

  it('round-trips pickup, meter/key changes, and tempo automation to GP7', () => {
    const source = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/gp78/F03-time-meter-key-pickup.gp')));
    const inspection = inspectGp78(source);
    assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
    if (!inspection.ok) return;
    const track = inspection.value.tracks.find(candidate => candidate.eligible);
    assert.ok(track);
    const imported = importGp78(source, track.id);
    assert.strictEqual(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;
    const output = exportGp78(imported.value);
    assert.strictEqual(output.ok, true, JSON.stringify(output));
    if (!output.ok) return;
    const gpif = new TextDecoder().decode(extractGpif(output.value).gpif);
    assert.ok(gpif.includes('<Anacrusis />'));
    assert.ok(gpif.includes('<Time>7/8</Time>'));
    assert.ok(gpif.includes('<AccidentalCount>3</AccidentalCount>'));
    assert.ok(gpif.includes('<Bar>1</Bar><Position>0</Position><Visible>true</Visible><Value>90 2</Value>'));
  });

  it('writes and semantically re-imports GP7-compatible TAB techniques, ties, and tuplets', () => {
    const source = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/gp78/F05-techniques.gp')));
    const inspection = inspectGp78(source);
    assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
    if (!inspection.ok) return;
    const track = inspection.value.tracks.find(candidate => candidate.eligible);
    assert.ok(track);
    const imported = importGp78(source, track.id);
    assert.strictEqual(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;
    const result = exportGp78(imported.value);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    const gpif = new TextDecoder().decode(extractGpif(result.value).gpif);
    assert.ok(gpif.includes('<PrimaryTuplet num="3" den="2" />'));
    assert.ok(gpif.includes('<Property name="HopoOrigin"><Enable /></Property>'));
    assert.ok(gpif.includes('<Property name="HopoDestination"><Enable /></Property>'));
    assert.ok(gpif.includes('<Property name="Slide"><Flags>2</Flags></Property>'));
    assert.ok(gpif.includes('<Property name="PalmMuted"><Enable /></Property>'));
    assert.ok(gpif.includes('<LetRing />'));
    assert.ok(gpif.includes('<Tie origin="true" destination="false" />'));
    assert.ok(gpif.includes('<Tie origin="false" destination="true" />'));
    assert.ok(gpif.includes('<Property name="Bended"><Enable /></Property>'));
    const roundTrip = importGp78(result.value, 0);
    assert.strictEqual(roundTrip.ok, true, JSON.stringify(roundTrip));
  });

  it('publishes exclusively and keeps existing destinations unchanged', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gp78-publish-'));
    try {
      const target = path.join(directory, 'score.gp');
      const source = { version: 1 } as unknown as import('vscode').TextDocument;
      await publishGp78Exclusive(target, new Uint8Array([1, 2, 3]), source, 1);
      assert.deepStrictEqual(await fs.promises.readFile(target), Buffer.from([1, 2, 3]));
      await assert.rejects(publishGp78Exclusive(target, new Uint8Array([9]), source, 1));
      assert.deepStrictEqual(await fs.promises.readFile(target), Buffer.from([1, 2, 3]));
      (source as unknown as { version: number }).version = 2;
      await assert.rejects(publishGp78Exclusive(path.join(directory, 'stale.gp'), new Uint8Array([4]), source, 1));
      assert.strictEqual(fs.existsSync(path.join(directory, 'stale.gp')), false);
    } finally {
      await fs.promises.rm(directory, { recursive: true, force: true });
    }
  });

  it('encodes chord diagrams in both GPIF diagram collections and beat references', () => {
    const chordFixture = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/gp78/F04-chord-onsets.gp')));
    const inspection = inspectGp78(chordFixture);
    assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
    if (!inspection.ok) return;
    const imported = importGp78(chordFixture, inspection.value.tracks[0].id);
    assert.strictEqual(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;
    assert.deepStrictEqual(imported.value.measures[0].chords, [
      { name: 'C', beatOffset: { n: 0, d: 1 } },
      { name: 'G/B', beatOffset: { n: 1, d: 1 } },
    ]);
    const result = exportGp78(imported.value);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    const gpif = new TextDecoder().decode(extractGpif(result.value).gpif);
    assert.ok(gpif.includes('<Property name="DiagramWorkingSet"><Items><Item name="C"><Diagram'));
    assert.ok(gpif.includes('<Fingering><Position finger="None" fret="0" string="3" /><Position finger="None" fret="0" string="5" /><Position finger="Index" fret="1" string="4" /><Position finger="Middle" fret="2" string="2" /><Position finger="Ring" fret="3" string="1" /><Position finger="None" fret="4294967295" string="0" /></Fingering>'));
    assert.ok(gpif.includes('<Property name="ShowFingering" type="bool" value="false"/>'));
    assert.ok(gpif.includes('<Chord><![CDATA[0]]></Chord><Notes>0</Notes><Properties><Property name="PrimaryPickupVolume"><Float>0.500000</Float></Property><Property name="PrimaryPickupTone"><Float>0.500000</Float></Property></Properties>'));
    assert.ok(gpif.includes('<Chord><![CDATA[1]]></Chord>'));
    const secondChordBeat = gpif.match(/<Beat id="1">[\s\S]*?<\/Beat>/)?.[0] ?? '';
    assert.doesNotMatch(secondChordBeat, /<Rest\s*\/>/);
    assert.doesNotMatch(secondChordBeat, /<Notes\s*\/>/);
  });

  it('omits the empty note list for chord-only beats', () => {
    const chordFixture = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/gp78/F09-chord-only.gp')));
    const inspection = inspectGp78(chordFixture);
    assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
    if (!inspection.ok) return;
    const imported = importGp78(chordFixture, inspection.value.tracks[0].id);
    assert.strictEqual(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;
    const result = exportGp78(imported.value);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    const gpif = new TextDecoder().decode(extractGpif(result.value).gpif);
    const beat = gpif.match(/<Beat\b[^>]*>[\s\S]*?<Chord><!\[CDATA\[0\]\]><\/Chord>[\s\S]*?<\/Beat>/)?.[0];
    assert.ok(beat, 'expected a chord-bearing beat');
    assert.ok(!/<Notes\s*\/>/.test(beat), 'chord-only beats must not contain an empty note list');
    assert.ok(!/<Rest\s*\/>/.test(beat), 'chord-only beats must not be serialized as rests');
    assert.ok(!/name="ChordWorkingSet"/.test(gpif), 'writer should match the observed GPIF chord collection properties');
  });

  it('exports standard-only melody without TAB positions and preserves that view on reimport', () => {
    const melodyFixture = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/gp78/F10-melody-only.gp')));
    const inspection = inspectGp78(melodyFixture);
    assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
    if (!inspection.ok) return;
    const imported = importGp78(melodyFixture, inspection.value.tracks[0].id);
    assert.strictEqual(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;
    const exported = exportGp78(imported.value);
    assert.strictEqual(exported.ok, true, JSON.stringify(exported));
    if (!exported.ok) return;
    const archive = extractGpif(exported.value);
    const notation = parsePartConfiguration(archive.partConfiguration)?.views[0]?.[0];
    assert.deepStrictEqual(notation && { standard: notation.standard, tablature: notation.tablature }, { standard: true, tablature: false });
    const gpif = new TextDecoder().decode(archive.gpif);
    const noteXml = gpif.match(/<Note id="[^"]+">[\s\S]*?<\/Note>/)?.[0] ?? '';
    assert.match(noteXml, /<Property name="ConcertPitch">/);
    assert.doesNotMatch(noteXml, /<Property name="(Fret|String)">/);
    const reimported = importGp78(exported.value, 0);
    assert.strictEqual(reimported.ok, true, JSON.stringify(reimported));
    if (reimported.ok) {
      assert.strictEqual(reimported.value.measures[0].tabVoices, undefined);
      assert.deepStrictEqual(reimported.value.measures[0].melody?.map(note => note.pitch), imported.value.measures[0].melody?.map(note => note.pitch));
    }
  });

  it('exports repeat endings and D.S. al Coda as GPIF master-bar navigation', () => {
    const navigationFixture = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/gp78/F06-navigation.gp')));
    const inspection = inspectGp78(navigationFixture);
    assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
    if (!inspection.ok) return;
    const imported = importGp78(navigationFixture, inspection.value.tracks[0].id);
    assert.strictEqual(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;
    const result = exportGp78(imported.value);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    const gpif = new TextDecoder().decode(extractGpif(result.value).gpif);
    assert.ok(gpif.includes('<Repeat start="true" end="false" count="2"/>'));
    assert.ok(gpif.includes('<Repeat start="false" end="true" count="2"/>'));
    assert.ok(gpif.includes('<AlternateEndings>1</AlternateEndings>'));
    assert.ok(gpif.includes('<AlternateEndings>2</AlternateEndings>'));
    assert.ok(gpif.includes('<Directions><Target>Segno</Target></Directions>'));
    assert.ok(gpif.includes('<Directions><Jump>DaSegno</Jump></Directions>'));
    assert.ok(gpif.includes('<Directions><Jump>DaCoda</Jump></Directions>'));
    assert.ok(gpif.includes('<Directions><Target>Coda</Target></Directions>'));

    const reopened = inspectGp78(result.value);
    assert.strictEqual(reopened.ok, true, JSON.stringify(reopened));
    if (!reopened.ok) return;
    const reimported = importGp78(result.value, reopened.value.tracks[0].id);
    assert.strictEqual(reimported.ok, true, JSON.stringify(reimported));
    if (!reimported.ok) return;
    assert.deepStrictEqual(reimported.value.measures.map(measure => ({
      repeatStart: measure.barline.repeatStart,
      repeatEnd: measure.barline.repeatEnd,
      bracket: measure.barline.bracket,
      specialMark: measure.barline.specialMark,
    })), imported.value.measures.map(measure => ({
      repeatStart: measure.barline.repeatStart,
      repeatEnd: measure.barline.repeatEnd,
      bracket: measure.barline.bracket,
      specialMark: measure.barline.specialMark,
    })));
  });

  it('fails the semantic equality gate when a volta, D.S., or Coda mark changes', () => {
    const navigationFixture = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/gp78/F06-navigation.gp')));
    const inspection = inspectGp78(navigationFixture);
    assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
    if (!inspection.ok) return;
    const imported = importGp78(navigationFixture, inspection.value.tracks[0].id);
    assert.strictEqual(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;

    const alterBarline = (index: number, field: 'bracket' | 'specialMark', value: string | undefined) => ({
      ...imported.value,
      measures: imported.value.measures.map((measure, measureIndex) => measureIndex === index
        ? { ...measure, barline: { ...measure.barline, [field]: value } }
        : measure),
    });
    const cases = [
      { score: alterBarline(1, 'bracket', undefined), path: '/measures/1/barline/bracket' },
      { score: alterBarline(3, 'specialMark', undefined), path: '/measures/3/barline/specialMark' },
      { score: alterBarline(4, 'specialMark', 'ds'), path: '/measures/4/barline/specialMark' },
    ];
    for (const testCase of cases) {
      assert.strictEqual(gp78RoundTripMismatch(imported.value, testCase.score), testCase.path);
    }
  });

  it('exports the explicitly selected F07 guitar as a single-track GP file', () => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/gp78/F07-multitrack-voice2.gp')));
    const inspection = inspectGp78(bytes);
    assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
    if (!inspection.ok) return;
    const selected = inspection.value.tracks.find(track => track.eligible);
    assert.ok(selected);
    if (!selected) return;
    const imported = importGp78(bytes, selected.id);
    assert.strictEqual(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;
    const output = exportGp78(imported.value);
    assert.strictEqual(output.ok, true, JSON.stringify(output));
    if (!output.ok) return;
    const reopened = inspectGp78(output.value);
    assert.strictEqual(reopened.ok, true, JSON.stringify(reopened));
    if (!reopened.ok) return;
    assert.strictEqual(reopened.value.tracks.length, 1);
    const reimported = importGp78(output.value, reopened.value.tracks[0].id);
    assert.strictEqual(reimported.ok, true, JSON.stringify(reimported));
    if (reimported.ok) assert.deepStrictEqual(reimported.value.measures.map(measure => measure.tabVoices), imported.value.measures.map(measure => measure.tabVoices));
  });
});
