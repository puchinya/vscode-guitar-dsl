import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { createInstrumentModel } from '../../src/instrumentModel';
import { parseGuitarDsl } from '../../src/compiler';
import { appendLoss, emptyLossReport, guitarDslToInterchange, hasBlockingLoss, interchangeToGuitarDsl, validateInterchangeScore } from '../../src/interchange';
import { interchangeSemanticMismatch } from '../../src/interchange/semanticProjection';

function assertInterchangeRoundTrip(source: string) {
  const before = parseGuitarDsl(source);
  assert.deepStrictEqual(before.diagnostics.filter(item => item.severity === 'error'), []);
  const first = guitarDslToInterchange(source);
  assert.strictEqual(first.ok, true, JSON.stringify(first));
  if (!first.ok) throw new Error(JSON.stringify(first));
  const output = interchangeToGuitarDsl(first.value, first.loss);
  assert.strictEqual(output.ok, true, JSON.stringify(output));
  if (!output.ok) throw new Error(JSON.stringify(output));
  const after = parseGuitarDsl(output.value);
  assert.deepStrictEqual(after.diagnostics.filter(item => item.severity === 'error'), []);
  const second = guitarDslToInterchange(output.value);
  assert.strictEqual(second.ok, true, JSON.stringify(second));
  if (!second.ok) throw new Error(JSON.stringify(second));
  assert.deepStrictEqual(second.value, first.value);
  assert.deepStrictEqual(
    after.playOrder.occurrences.map(({ occurrenceIndex, measureIndex, lyricVerse }) => ({ occurrenceIndex, measureIndex, lyricVerse })),
    before.playOrder.occurrences.map(({ occurrenceIndex, measureIndex, lyricVerse }) => ({ occurrenceIndex, measureIndex, lyricVerse }))
  );
  return { before, after, first: first.value, output: output.value, second: second.value, warnings: first.warnings };
}

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

  it('preserves TAB lyric group presence, verse slots, sections, ties, and play order', () => {
    const groupedSources = [
      fs.readFileSync(path.resolve(__dirname, '../fixtures/interchange-tab-lyric-groups.guitardsl'), 'utf8'),
      fs.readFileSync(path.resolve(__dirname, '../fixtures/interchange-tab-lyric-sections.guitardsl'), 'utf8'),
      [
        '| C | 1.d |',
        '| D | 1.d |',
        'tab: | 5f0/2 6f0~/2 | 6f0/2 5f2/2 |',
        'lyr: か き く'
      ].join('\n'),
      [
        '| C | 1.d |',
        '| D | 1.d |',
        'tab: | 5f0/2 6f0~/2 |',
        'tab: | 6f0/2 5f2/2 |',
        'lyr: か き'
      ].join('\n')
    ];
    for (const source of groupedSources) {
      const original = guitarDslToInterchange(source);
      assert.strictEqual(original.ok, true, JSON.stringify(original));
      if (!original.ok) continue;
      const emitted = interchangeToGuitarDsl(original.value);
      assert.strictEqual(emitted.ok, true, JSON.stringify(emitted));
      if (!emitted.ok) continue;
      const reparsed = guitarDslToInterchange(emitted.value);
      assert.strictEqual(reparsed.ok, true, JSON.stringify(reparsed));
      if (!reparsed.ok) continue;
      assert.deepStrictEqual(
        reparsed.value.measures.map(measure => measure.tabVoices?.[0]?.beats.map(beat => beat.syllables) ?? null),
        original.value.measures.map(measure => measure.tabVoices?.[0]?.beats.map(beat => beat.syllables) ?? null)
      );
      const beforePlan = parseGuitarDsl(source).playOrder.occurrences.map(({ occurrenceIndex, measureIndex, lyricVerse }) => ({ occurrenceIndex, measureIndex, lyricVerse }));
      const afterPlan = parseGuitarDsl(emitted.value).playOrder.occurrences.map(({ occurrenceIndex, measureIndex, lyricVerse }) => ({ occurrenceIndex, measureIndex, lyricVerse }));
      assert.deepStrictEqual(afterPlan, beforePlan);
    }
    const grouped = fs.readFileSync(path.resolve(__dirname, '../fixtures/interchange-tab-lyric-groups.guitardsl'), 'utf8');
    const converted = guitarDslToInterchange(grouped);
    assert.ok(converted.ok);
    if (converted.ok) {
      const emitted = interchangeToGuitarDsl(converted.value);
      assert.ok(emitted.ok);
      if (emitted.ok) assert.match(emitted.value, /tab: \| 6f0\/1 \|\s*tab: \| 6f2\/1 \|\s*lyr: \(か\)/);
    }
    const sections = fs.readFileSync(path.resolve(__dirname, '../fixtures/interchange-tab-lyric-sections.guitardsl'), 'utf8');
    const sectionResult = guitarDslToInterchange(sections);
    assert.ok(sectionResult.ok);
    if (sectionResult.ok) {
      assert.deepStrictEqual(sectionResult.value.measures.map(measure => measure.tabVoices![0].beats[0].syllables), [
        [],
        [null],
        [{ text: 'ぜ', hyphenToNext: false, extend: false }]
      ]);
    }
  });

  it('rejects ambiguous melody pitch fields and incoherent ties as invalid IR', () => {
    const oneMeasure = guitarDslToInterchange('| C | 1.d |\nmel: | c4/1 |');
    const twoMeasures = guitarDslToInterchange('| C | 1.d |\n| D | 1.d |\nmel: | c4/1~ | d4/1 |');
    assert.ok(oneMeasure.ok && twoMeasures.ok);
    if (!oneMeasure.ok || !twoMeasures.ok) return;
    const clone = (value: unknown): any => JSON.parse(JSON.stringify(value));
    const ambiguousPitch = clone(oneMeasure.value);
    ambiguousPitch.measures[0].melody[0].pitches = [
      { step: 'e', alter: 0, octave: 4 },
      { step: 'g', alter: 0, octave: 4 }
    ];
    const orphanContinuation = clone(oneMeasure.value);
    orphanContinuation.measures[0].melody[0].tiedFromPrev = true;
    const missingContinuation = clone(twoMeasures.value);
    missingContinuation.measures[1].melody[0].tiedFromPrev = false;
    const incompatibleTarget = clone(twoMeasures.value);
    incompatibleTarget.measures[1].melody[0].pitch = undefined;
    incompatibleTarget.measures[1].melody[0].pitches = [
      { step: 'd', alter: 0, octave: 4 },
      { step: 'f', alter: 0, octave: 4 }
    ];
    incompatibleTarget.measures[1].melody[0].tiedFromPrev = false;
    const groupTie = clone(oneMeasure.value);
    groupTie.measures[0].melody[0].pitch = undefined;
    groupTie.measures[0].melody[0].pitches = [
      { step: 'e', alter: 0, octave: 4 },
      { step: 'g', alter: 0, octave: 4 }
    ];
    groupTie.measures[0].melody[0].tieToNext = true;
    const groupTechnique = clone(oneMeasure.value);
    groupTechnique.measures[0].melody[0].pitch = undefined;
    groupTechnique.measures[0].melody[0].pitches = [
      { step: 'e', alter: 0, octave: 4 },
      { step: 'g', alter: 0, octave: 4 }
    ];
    groupTechnique.measures[0].melody[0].techniques = { connection: 'hammer' };
    for (const [score, code] of [
      [ambiguousPitch, 'ambiguousPitch'],
      [orphanContinuation, 'orphanTieContinuation'],
      [missingContinuation, 'missingTieContinuation'],
      [groupTie, 'unsupportedGroupTie'],
      [groupTechnique, 'unsupportedGroupTechnique'],
      [incompatibleTarget, 'invalidMelodyTieTarget']
    ] as const) {
      const before = JSON.stringify(score);
      assert.ok(validateInterchangeScore(score).some(error => error.code === code), `${code}: ${JSON.stringify(validateInterchangeScore(score))}`);
      const emitted = interchangeToGuitarDsl(score);
      assert.strictEqual(emitted.ok, false);
      if (!emitted.ok) {
        assert.strictEqual(emitted.code, 'invalidIr');
        assert.ok(!('value' in emitted));
      }
      assert.strictEqual(JSON.stringify(score), before);
    }
  });

  it('rejects duplicate explicit-duration chord onsets before serialization', () => {
    const valid = guitarDslToInterchange('| C | 1.d |');
    assert.ok(valid.ok);
    if (!valid.ok) return;
    const duplicate = JSON.parse(JSON.stringify(valid.value));
    duplicate.measures[0].chordPlacementMode = 'explicitDuration';
    const atEnd = JSON.parse(JSON.stringify(valid.value));
    for (const score of [duplicate, atEnd]) {
      score.measures[0].chordPlacementMode = 'explicitDuration';
      score.measures[0].chords = [
        { name: 'C', beatOffset: { n: 0, d: 1 } },
        { name: 'G', beatOffset: score === duplicate ? { n: 0, d: 1 } : { n: 4, d: 1 } }
      ];
      const before = JSON.stringify(score);
      const errors = validateInterchangeScore(score);
      assert.ok(errors.some(error => error.code === 'invalidChordOnset' && error.path === '/measures/0/chords/1/beatOffset'), JSON.stringify(errors));
      const emitted = interchangeToGuitarDsl(score);
      assert.strictEqual(emitted.ok, false);
      if (!emitted.ok) {
        assert.strictEqual(emitted.code, 'invalidIr');
        assert.ok(!('value' in emitted));
      }
      assert.strictEqual(JSON.stringify(score), before);
    }
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

describe('interchange review remediation A-04 through A-07', () => {
  it('A-04 preserves repeated section names without arrangement and rejects them with arrangement', () => {
    const source = ['[Verse]', '| C | 1.d |', '[Verse]', '| G | 1.d |'].join('\n');
    const roundTrip = assertInterchangeRoundTrip(source);
    assert.deepStrictEqual(roundTrip.first.measures.map((measure: any) => measure.sectionStart), ['Verse', 'Verse']);

    const arranged = [
      'arrangement {',
      '  Verse',
      '}',
      '[Verse]', '| C | 1.d |',
      '[Verse]', '| G | 1.d |'
    ].join('\n');
    const invalid = guitarDslToInterchange(arranged);
    assert.strictEqual(invalid.ok, false);
    if (!invalid.ok) {
      assert.ok(['invalidSource', 'invalidPlayOrder'].includes(invalid.code));
      assert.ok(invalid.diagnostics.some(item => item.severity === 'error'));
      assert.ok(!('value' in invalid));
    }
  });

  it('A-05 keeps parser-owned melody group spans and uses the minimum sung group verse count', () => {
    const source = [
      'arrangement {',
      '  Verse x2',
      '}',
      '[Verse]',
      '| C | 1.d |',
      '| G | 1.d |',
      'mel: | c4/1 |',
      'lyr: あ',
      'lyr: か',
      'mel: | d4/1 |',
      'lyr: さ'
    ].join('\n');
    const roundTrip = assertInterchangeRoundTrip(source);
    assert.deepStrictEqual((roundTrip.before as any).melodyGroups, [
      { startMeasure: 0, endMeasureExclusive: 1, verseCount: 2 },
      { startMeasure: 1, endMeasureExclusive: 2, verseCount: 1 }
    ]);
    assert.deepStrictEqual((roundTrip.first as any).melodyGroups, (roundTrip.before as any).melodyGroups);
    assert.deepStrictEqual(roundTrip.before.playOrder.occurrences.map(item => item.lyricVerse), [1, 1, 1, 1]);
    assert.strictEqual((roundTrip.output.match(/^mel:/gm) ?? []).length, 2, 'adjacent authored groups must not be merged');

    const unavailable = source.replace('Verse x2', 'Verse(lyr=2) x2');
    const invalid = guitarDslToInterchange(unavailable);
    assert.strictEqual(invalid.ok, false);
    if (!invalid.ok) {
      assert.ok(invalid.diagnostics.some(item => item.code === 'arrangementLyricVerseUnavailable'));
      assert.ok(!('value' in invalid));
    }
  });

  it('A-05 retains a spanning group verse count across a page boundary and underfilled measure', () => {
    const source = [
      'arrangement {',
      '  Intro',
      '  Verse x2',
      '}',
      '[Intro]',
      '| Am | 1.d |',
      'pagebreak',
      '[Verse]',
      '| C | 1.d |',
      '| G | 1.d |',
      'mel: | c4/1 | d4/1 |',
      'lyr: あ',
      'lyr: か き'
    ].join('\n');
    const roundTrip = assertInterchangeRoundTrip(source);
    assert.deepStrictEqual((roundTrip.first as any).melodyGroups, [
      { startMeasure: 1, endMeasureExclusive: 3, verseCount: 2 }
    ]);
    const notes = roundTrip.first.measures.slice(1).flatMap((measure: any) => measure.melody);
    assert.strictEqual(notes[0].syllables[0].text, 'あ');
    assert.deepStrictEqual(notes[1].syllables[0], { kind: 'omitted' });
    assert.strictEqual(notes[1].syllables[1].text, 'き');
  });

  it('A-06 emits melody lyric prefixes without padding omissions as skips', () => {
    const short = assertInterchangeRoundTrip('| C | 1.d |\nmel: | c4/2 d4/2 |\nlyr: あ');
    assert.ok(short.warnings.some(item => item.code === 'syllableCountMismatch'));
    assert.deepStrictEqual(short.first.measures[0].melody?.map(note => note.syllables), [
      [{ text: 'あ', hyphenToNext: false, extend: false }],
      []
    ]);
    assert.match(short.output, /^lyr: \(あ\)$/m);
    assert.doesNotMatch(short.output, /^lyr:.*\*/m);

    const longerVerse = [
      '| C | 1.d |',
      'mel: | c4/4 d4/4 e4/4 f4/4 |',
      'lyr: あ *',
      'lyr: か き く'
    ].join('\n');
    const roundTrip = assertInterchangeRoundTrip(longerVerse);
    const noteSlots = roundTrip.first.measures[0].melody!.map(note => note.syllables);
    assert.strictEqual(noteSlots[1][0], null, 'authored * remains an explicit null');
    assert.deepStrictEqual(noteSlots[2][0], { kind: 'omitted' });
    assert.strictEqual((noteSlots[2][1] as any).text, 'く');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(roundTrip.first)), roundTrip.first);
    assert.match(roundTrip.output, /^lyr: \(あ\) \*$/m);
    assert.match(roundTrip.output, /^lyr: \(か\) \(き\) \(く\)$/m);
  });

  it('A-07 preserves underfilled TAB lyric prefixes, explicit skips, ties and dead-note attacks', () => {
    const short = assertInterchangeRoundTrip('| C | 1.d |\ntab: | 6f0/2 6f2/2 |\nlyr: か');
    assert.ok(short.warnings.some(item => item.code === 'syllableCountMismatch'));
    assert.deepStrictEqual(short.first.measures[0].tabVoices![0].beats.map((beat: any) => beat.syllables), [
      [{ text: 'か', hyphenToNext: false, extend: false }],
      []
    ]);
    assert.match(short.output, /^lyr: \(か\)$/m);
    assert.doesNotMatch(short.output, /^lyr:.*\*/m);

    const skipped = assertInterchangeRoundTrip('| C | 1.d |\ntab: | 6f0/2 6f2/2 |\nlyr: *');
    assert.deepStrictEqual(skipped.first.measures[0].tabVoices![0].beats.map((beat: any) => beat.syllables), [[null], []]);
    assert.match(skipped.output, /^lyr: \*$/m);

    const tied = [
      '| C | 1.d |',
      '| G | 1.d |',
      'tab: | 5f0/2 5f0~/2 | 5f0/2 6x/2 |',
      'lyr: か',
      'lyr: き く け'
    ].join('\n');
    const roundTrip = assertInterchangeRoundTrip(tied);
    const beats = roundTrip.first.measures.flatMap((measure: any) => measure.tabVoices![0].beats);
    assert.strictEqual(beats[1].notes[0].tieToNext, true);
    assert.strictEqual(beats[2].notes[0].string, 5);
    assert.strictEqual(beats[3].notes[0].dead, true);
    assert.deepStrictEqual(beats[2].syllables, []);
    assert.deepStrictEqual(beats[3].syllables[0], { kind: 'omitted' });
    assert.strictEqual((beats[3].syllables[1] as any).text, 'け');
  });

  it('T-NEG-1 rejects invalid melody group ranges and JSON lyric-slot shapes atomically', () => {
    const base = guitarDslToInterchange('| C | 1.d |\nmel: | c4/2 d4/2 |\nlyr: あ');
    assert.ok(base.ok);
    if (!base.ok) return;
    const clone = (value: unknown): any => JSON.parse(JSON.stringify(value));
    const cases: Array<{ score: any; code: string; path: string }> = [];
    const badRange = clone(base.value);
    badRange.melodyGroups[0].startMeasure = -1;
    cases.push({ score: badRange, code: 'invalidMelodyGroupRange', path: '/melodyGroups/0/startMeasure' });
    const missingCoverage = clone(base.value);
    missingCoverage.melodyGroups = [];
    cases.push({ score: missingCoverage, code: 'melodyGroupCoverage', path: '/melodyGroups' });
    const overlappingGroup = clone(base.value);
    overlappingGroup.melodyGroups.push({ ...overlappingGroup.melodyGroups[0] });
    cases.push({ score: overlappingGroup, code: 'overlappingMelodyGroups', path: '/melodyGroups/1/startMeasure' });
    const badVerseCount = clone(base.value);
    badVerseCount.melodyGroups[0].verseCount = -1;
    cases.push({ score: badVerseCount, code: 'invalidMelodyGroupVerseCount', path: '/melodyGroups/0/verseCount' });
    const impossibleVerse = clone(base.value);
    impossibleVerse.melodyGroups[0].verseCount = 0;
    cases.push({ score: impossibleVerse, code: 'melodyGroupSlotCount', path: '/measures/0/melody/0/syllables' });
    const invalidOmission = clone(base.value);
    invalidOmission.measures[0].melody[0].syllables[0] = {};
    cases.push({ score: invalidOmission, code: 'invalidLyricSlot', path: '/measures/0/melody/0/syllables/0' });
    const undefinedSlot = clone(base.value);
    undefinedSlot.measures[0].melody[1].syllables = [undefined];
    cases.push({ score: undefinedSlot, code: 'invalidLyricSlot', path: '/measures/0/melody/1/syllables/0' });
    const sparseSlot = clone(base.value);
    sparseSlot.measures[0].melody[1].syllables.length = 2;
    sparseSlot.measures[0].melody[1].syllables[1] = { kind: 'omitted' };
    cases.push({ score: sparseSlot, code: 'sparseLyricSlots', path: '/measures/0/melody/1/syllables/0' });

    for (const item of cases) {
      const before = JSON.stringify(item.score);
      assert.ok(validateInterchangeScore(item.score).some(error => error.code === item.code && error.path === item.path), `${item.code}: ${JSON.stringify(validateInterchangeScore(item.score))}`);
      const output = interchangeToGuitarDsl(item.score);
      assert.strictEqual(output.ok, false, item.code);
      if (!output.ok) {
        assert.strictEqual(output.code, 'invalidIr', item.code);
        assert.ok(!('value' in output), item.code);
      }
      assert.strictEqual(JSON.stringify(item.score), before, `${item.code}: caller IR mutated`);
    }
  });
});
