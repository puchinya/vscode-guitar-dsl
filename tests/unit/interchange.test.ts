import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { createInstrumentModel } from '../../src/instrumentModel';
import { appendLoss, emptyLossReport, guitarDslToInterchange, hasBlockingLoss, interchangeToGuitarDsl, validateInterchangeScore } from '../../src/interchange';
import { interchangeSemanticMismatch } from '../../src/interchange/semanticProjection';

describe('canonical interchange conversion', () => {
  it('T01 round-trips every checked-in GuitarDSL sample through the complete semantic gate', () => {
    const sampleDir = path.resolve(__dirname, '../../samples');
    const files = fs.readdirSync(sampleDir).filter(file => file.endsWith('.guitardsl')).sort();
    assert.ok(files.length > 0);
    for (const file of files) {
      const source = fs.readFileSync(path.join(sampleDir, file), 'utf8');
      const first = guitarDslToInterchange(source);
      assert.strictEqual(first.ok, true, `${file}: source conversion ${JSON.stringify(first)}`);
      if (!first.ok) continue;
      const serialized = interchangeToGuitarDsl(first.value, first.loss);
      assert.strictEqual(serialized.ok, true, `${file}: serialization ${JSON.stringify(serialized)}`);
      if (!serialized.ok) continue;
      const second = guitarDslToInterchange(serialized.value);
      assert.strictEqual(second.ok, true, `${file}: reparse ${JSON.stringify(second)}`);
      if (second.ok) assert.deepStrictEqual(second.value, first.value, `${file}: normalized IR`);
    }
  });

  it('keeps melody, Standard tuning TAB, note and beat effects, ties, dead notes and TAB lyrics independent', () => {
    const source = [
      'tuning: Standard',
      '| C | 4.d 4 4.d 4 |',
      'mel: | e4/4 d4/4 c4/4 b3/4 |',
      'lyr: あ さ の う',
      'tab: | [6f0{pm},5x]/4!{pm} 6f0~/4 6f0/4 5x/4 |',
      'lyr: か ぜ う'
    ].join('\n');
    const result = guitarDslToInterchange(source);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    const output = interchangeToGuitarDsl(result.value);
    assert.strictEqual(output.ok, true, JSON.stringify(output));
    if (!output.ok) return;
    const reparsed = guitarDslToInterchange(output.value);
    assert.strictEqual(reparsed.ok, true, JSON.stringify(reparsed));
    if (!reparsed.ok) return;
    const measure = reparsed.value.measures[0];
    assert.strictEqual(measure.melody?.[0].pitch?.step, 'e');
    assert.strictEqual(measure.tabVoices?.[0].beats[0].notes[0].string, 6);
    assert.strictEqual(measure.tabVoices?.[0].beats[0].notes[0].effects[0].name, 'pm');
    assert.strictEqual(measure.tabVoices?.[0].beats[0].effects[0].name, 'pm');
    assert.strictEqual(measure.tabVoices?.[0].beats[1].notes[0].tieToNext, true);
    assert.strictEqual(measure.tabVoices?.[0].beats[3].notes[0].dead, true);
    assert.deepStrictEqual(reparsed.value.measures, result.value.measures);
  });

  it('retains authored Drop D string and fret positions under capo 2 when pitches duplicate', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../fixtures/interchange-tab-drop-d-capo.guitardsl'), 'utf8');
    const result = guitarDslToInterchange(source);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    const written = result.value.measures[0].tabVoices![0].beats[0].notes;
    assert.deepStrictEqual(written.map(note => [note.string, note.fret]), [[6, 12], [4, 0]]);
    const instrument = createInstrumentModel({ openMidi: result.value.metadata.tuning.openMidi }, result.value.metadata.capo);
    assert.strictEqual(instrument.pitchAt(written[0].string, written[0].fret!), instrument.pitchAt(written[1].string, written[1].fret!));
    const output = interchangeToGuitarDsl(result.value);
    assert.strictEqual(output.ok, true, JSON.stringify(output));
    if (output.ok) assert.match(output.value, /\[6f12,4f0\]/);
  });

  it('preserves arrangement references, explicit lyric verses, counts, and resolved occurrences', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../fixtures/interchange-arrangement.guitardsl'), 'utf8');
    const result = guitarDslToInterchange(source);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.deepStrictEqual(result.value.arrangement, [
      { name: 'Verse', lyricVerse: 2, count: 2 },
      { name: 'Chorus', count: 1 }
    ]);
    const output = interchangeToGuitarDsl(result.value);
    assert.strictEqual(output.ok, true, JSON.stringify(output));
    if (!output.ok) return;
    const reparsed = guitarDslToInterchange(output.value);
    assert.strictEqual(reparsed.ok, true, JSON.stringify(reparsed));
    assert.match(output.value, /Verse\(lyr=2\) x2/);
    if (reparsed.ok) assert.deepStrictEqual(reparsed.value.arrangement, result.value.arrangement);
  });

  it('round-trips pickup, grouped 7/8, tuplets, event contexts, and exact chord onsets', () => {
    const source = [
      'time: 4/4',
      'pickup: 8',
      'bpm: 90',
      '| C | 8.d |',
      '@time: 7/8(2+2+3)',
      '@tempo: 120',
      '@feel: shuffle',
      '| C G D | 8t.d 8t 8t 8.d 8 8 8 |',
      '@tempo: tempo primo',
      '| Am | 8.d 8 8 8.d 8 8 8 |'
    ].join('\n');
    const first = guitarDslToInterchange(source);
    assert.strictEqual(first.ok, true, JSON.stringify(first));
    if (!first.ok) return;
    assert.deepStrictEqual(first.value.measures[0].expectedBeats, { n: 1, d: 2 });
    assert.deepStrictEqual(first.value.measures[1].chords.map(chord => chord.beatOffset), [
      { n: 0, d: 1 }, { n: 7, d: 6 }, { n: 7, d: 3 }
    ]);
    const output = interchangeToGuitarDsl(first.value);
    assert.strictEqual(output.ok, true, JSON.stringify(output));
    if (output.ok) {
      const second = guitarDslToInterchange(output.value);
      assert.strictEqual(second.ok, true, JSON.stringify(second));
      if (second.ok) assert.deepStrictEqual(second.value.measures, first.value.measures);
    }
  });

  it('keeps Standard TAB fixture positions and scoped effects', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../fixtures/interchange-tab-standard.guitardsl'), 'utf8');
    const first = guitarDslToInterchange(source);
    assert.strictEqual(first.ok, true, JSON.stringify(first));
    if (!first.ok) return;
    const tab = first.value.measures[0].tabVoices![0].beats;
    assert.strictEqual(tab[0].notes[0].effects[0].name, 'pm');
    assert.strictEqual(tab[0].effects[0].name, 'pm');
    assert.strictEqual(tab[1].notes[0].tieToNext, true);
    assert.strictEqual(tab[3].notes[0].dead, true);
    const output = interchangeToGuitarDsl(first.value);
    assert.strictEqual(output.ok, true, JSON.stringify(output));
  });

  it('returns atomic deterministic failures for malformed source and invalid IR', () => {
    const source = '| C | unknown |';
    assert.deepStrictEqual(guitarDslToInterchange(source), guitarDslToInterchange(source));
    const good = guitarDslToInterchange('| C | 4.d 4 4.d 4 |');
    assert.strictEqual(good.ok, true);
    if (!good.ok) return;
    const invalid = { ...good.value, schemaVersion: 9 } as unknown as typeof good.value;
    assert.deepStrictEqual(validateInterchangeScore(invalid)[0]?.code, 'unsupportedSchemaVersion');
    const output = interchangeToGuitarDsl(invalid);
    assert.strictEqual(output.ok, false);
    if (!output.ok) {
      assert.strictEqual(output.code, 'invalidIr');
      assert.ok(!('value' in output));
    }
  });

  it('T11 rejects malformed fractions, ranges, references, effects, ties, and voice schemas without mutation', () => {
    const baseResult = guitarDslToInterchange('| C | 4.d 4 4.d 4 |');
    const standardResult = guitarDslToInterchange(fs.readFileSync(path.resolve(__dirname, '../fixtures/interchange-tab-standard.guitardsl'), 'utf8'));
    const dropDResult = guitarDslToInterchange(fs.readFileSync(path.resolve(__dirname, '../fixtures/interchange-tab-drop-d-capo.guitardsl'), 'utf8'));
    const arrangementResult = guitarDslToInterchange(fs.readFileSync(path.resolve(__dirname, '../fixtures/interchange-arrangement.guitardsl'), 'utf8'));
    assert.ok(baseResult.ok && standardResult.ok && dropDResult.ok && arrangementResult.ok);
    if (!baseResult.ok || !standardResult.ok || !dropDResult.ok || !arrangementResult.ok) return;
    const clone = (value: unknown): any => JSON.parse(JSON.stringify(value));
    const cases: Array<{ label: string; score: any; code: string }> = [];
    const version = clone(baseResult.value); version.schemaVersion = 9; cases.push({ label: 'version', score: version, code: 'unsupportedSchemaVersion' });
    const nan = clone(baseResult.value); nan.metadata.bpm = Number.NaN; cases.push({ label: 'NaN BPM', score: nan, code: 'invalidBpm' });
    const denominator = clone(baseResult.value); denominator.metadata.pickup = { n: 1, d: 0 }; cases.push({ label: 'zero denominator', score: denominator, code: 'invalidFraction' });
    const capo = clone(baseResult.value); capo.metadata.capo = 13; cases.push({ label: 'capo range', score: capo, code: 'invalidCapo' });
    const unknownPreset = clone(baseResult.value); unknownPreset.metadata.tuning.preset = 'Unknown'; cases.push({ label: 'unknown tuning preset', score: unknownPreset, code: 'invalidTuningPreset' });
    const mismatchedPreset = clone(baseResult.value); mismatchedPreset.metadata.tuning.preset = 'Drop D'; cases.push({ label: 'tuning preset and open pitches disagree', score: mismatchedPreset, code: 'invalidTuningPreset' });
    const unknownField = clone(baseResult.value); unknownField.metadata.foreignPayload = { effect: 'future' }; cases.push({ label: 'unknown interchange field', score: unknownField, code: 'unknownField' });
    const duplicate = clone(standardResult.value); duplicate.measures[0].tabVoices[0].beats[0].notes.push({ ...duplicate.measures[0].tabVoices[0].beats[0].notes[0] }); cases.push({ label: 'same string', score: duplicate, code: 'duplicateTabString' });
    const fret = clone(dropDResult.value); fret.measures[0].tabVoices[0].beats[0].notes[0].fret = 23; cases.push({ label: 'physical fret range', score: fret, code: 'fretOutsideInstrumentRange' });
    const effect = clone(standardResult.value); effect.measures[0].tabVoices[0].beats[0].notes[0].effects[0].name = 'unknown-effect'; cases.push({ label: 'unknown effect', score: effect, code: 'invalidEffectSchema' });
    const voice = clone(standardResult.value); voice.measures[0].tabVoices[0].voice = 2; cases.push({ label: 'unsupported voice', score: voice, code: 'invalidTabVoice' });
    const tie = clone(standardResult.value); tie.measures[0].tabVoices[0].beats[2].notes[0].fret = 1; cases.push({ label: 'invalid tie', score: tie, code: 'invalidTabTie' });
    const arrangement = clone(arrangementResult.value); arrangement.arrangement[0].name = 'Missing'; cases.push({ label: 'arrangement reference', score: arrangement, code: 'invalidArrangementReference' });
    const duration = clone(baseResult.value); duration.measures[0].rhythm.events[0].duration.parts[0].base = 32; cases.push({ label: 'unsupported duration', score: duration, code: 'invalidDurationPart' });
    for (const testCase of cases) {
      const before = JSON.stringify(testCase.score);
      const errors = validateInterchangeScore(testCase.score);
      assert.ok(errors.some(error => error.code === testCase.code), `${testCase.label}: ${JSON.stringify(errors)}`);
      const output = interchangeToGuitarDsl(testCase.score);
      assert.strictEqual(output.ok, false, testCase.label);
      if (!output.ok) {
        assert.strictEqual(output.code, 'invalidIr', testCase.label);
        assert.ok(!('value' in output), testCase.label);
      }
      assert.strictEqual(JSON.stringify(testCase.score), before, `${testCase.label}: caller data mutated`);
    }

    const closeOnsets = clone(baseResult.value);
    const safe = Number.MAX_SAFE_INTEGER;
    const smaller = { n: safe, d: safe - 1 };
    const larger = { n: safe - 1, d: safe - 2 };
    assert.strictEqual(smaller.n / smaller.d, larger.n / larger.d, 'fixture must collapse under floating-point division');
    closeOnsets.measures[0].chordPlacementMode = 'explicitDuration';
    closeOnsets.measures[0].chords = [
      { name: 'C', beatOffset: larger },
      { name: 'G', beatOffset: smaller }
    ];
    assert.ok(validateInterchangeScore(closeOnsets).some(error => error.code === 'invalidChordOnset'), 'exact rational order must be checked even when doubles compare equal');
  });

  it('blocks unsupported prior loss, preserves approved loss records, and detects a changed TAB fret in projection comparison', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../fixtures/interchange-tab-standard.guitardsl'), 'utf8');
    const converted = guitarDslToInterchange(source);
    assert.ok(converted.ok);
    if (!converted.ok) return;
    let report = emptyLossReport();
    report = appendLoss(report, { category: 'unsupported', code: 'foreignEffect', path: '/measures/0/tabVoices/0/beats/0', detail: 'Unknown external effect.' });
    report = appendLoss(report, { category: 'approximated', code: 'roundedDisplay', path: '/measures/0', detail: 'Display-only mapping approved.', policyId: 'adapter.display-rounding.v1' });
    report = appendLoss(report, { category: 'droppedByPolicy', code: 'unselectedPart', path: '/parts/1', detail: 'Part was omitted by explicit selection.', policyId: 'adapter.part-selection.v1' });
    report = appendLoss(report, { category: 'inferred', code: 'keySpelling', path: '/metadata/key', detail: 'Spelling inferred from adapter source.', policyId: 'adapter.key-spelling.v1' });
    assert.strictEqual(hasBlockingLoss(report), true);
    const blocked = interchangeToGuitarDsl(converted.value, report);
    assert.strictEqual(blocked.ok, false);
    if (!blocked.ok) assert.strictEqual(blocked.code, 'unrepresentableValue');
    report = { schemaVersion: 1, entries: report.entries.slice(1) };
    const output = interchangeToGuitarDsl(converted.value, report);
    assert.strictEqual(output.ok, true, JSON.stringify(output));
    if (output.ok) assert.deepStrictEqual(output.loss, report);

    const changed = JSON.parse(JSON.stringify(converted.value));
    changed.measures[0].tabVoices[0].beats[0].notes[0].fret += 1;
    const mismatch = interchangeSemanticMismatch(converted.value, changed);
    assert.strictEqual(mismatch?.code, 'semanticMismatch');
    assert.strictEqual(mismatch?.path, '/measures/0/tabVoices/0/beats/0/notes/0/fret');
  });

  it('returns stable source and play-order failures with positions and no partial score', () => {
    const invalidSources = [
      '| C | unknown |',
      '| C [2.] |',
      'tuning: NotATuning\n| C | 4.d 4 4.d 4 |',
      '| C | 4.d 4 4.d 4 |\ntab: | 6f0~/1 |'
    ];
    for (const source of invalidSources) {
      const first = guitarDslToInterchange(source);
      const second = guitarDslToInterchange(source);
      assert.deepStrictEqual(second, first);
      assert.strictEqual(first.ok, false);
      if (!first.ok) {
        assert.ok(['invalidSource', 'invalidPlayOrder'].includes(first.code));
        assert.ok(!('value' in first));
      }
    }
    const invalidPlan = guitarDslToInterchange('| C [2.] |');
    assert.strictEqual(invalidPlan.ok, false);
    if (!invalidPlan.ok) assert.strictEqual(invalidPlan.code, 'invalidPlayOrder');
  });
});
