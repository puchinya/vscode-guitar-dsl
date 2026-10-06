import * as assert from 'assert';
import { parseGuitarDsl } from '../../src/compiler';
import { createInstrumentModel, parseTuningValue } from '../../src/instrumentModel';
import {
  parseTabCell,
  parseTabLinePrefix,
  resolveTabBeatDurations,
  scoreHasTab,
  splitTabCells,
  tokenizeTabItems,
  resolveTabLinkTarget
} from '../../src/tab';

describe('TAB domain and compiler', () => {
  it('splits balanced bar cells and effect arguments without breaking nested groups', () => {
    const row = 'tab: | [6f3{pm},5f2]/4!{let-ring} 2f5{bend(amount=1.5)}/8 | % |';
    const prefix = parseTabLinePrefix(row);
    assert.ok(prefix);
    assert.strictEqual(prefix.voice, 1);
    const cells = splitTabCells(row, prefix.bodyStart);
    assert.deepStrictEqual(cells.map(cell => cell.text), ['[6f3{pm},5f2]/4!{let-ring} 2f5{bend(amount=1.5)}/8', '%']);
    const tokens = tokenizeTabItems(cells[0].text);
    assert.strictEqual(tokens.length, 2);
    const parsed = parseTabCell({ text: tokens[0].text, startCol: 0, endCol: tokens[0].end });
    assert.strictEqual(parsed.issues.length, 0);
    assert.strictEqual(parsed.beats[0].notes.length, 2);
    assert.strictEqual(parsed.beats[0].notes[0].effects[0].name, 'pm');
    assert.strictEqual(parsed.beats[0].effects[0].name, 'let-ring');
  });

  it('uses shared NoteValue durations and inherits them within a source line', () => {
    const cell = parseTabCell({ text: '2f5/8 2f7 [3f9,2f10] r', startCol: 0, endCol: 30 });
    const resolved = resolveTabBeatDurations(cell.beats);
    assert.strictEqual(resolved.beats.length, 4);
    assert.deepStrictEqual(resolved.beats.map(beat => beat.duration.beats), [
      { n: 1, d: 2 }, { n: 1, d: 2 }, { n: 1, d: 2 }, { n: 1, d: 2 }
    ]);
    assert.strictEqual(resolved.issues.length, 0);
  });

  it('compiles explicit positions through InstrumentModel and keeps authored string choices', () => {
    const score = parseGuitarDsl('tuning: Standard\n| C |\ntab: | 2f5/4 2f7 2f8 2f10 |');
    assert.deepStrictEqual(score.diagnostics.filter(d => d.code.startsWith('invalidTab') || d.code === 'missingInitialOctaveOrLength'), []);
    assert.strictEqual(score.measures.length, 1);
    const voice = score.measures[0].tabVoices?.[0];
    assert.ok(voice);
    assert.strictEqual(voice.voice, 1);
    assert.strictEqual(voice.beats.length, 4);
    const tuning = parseTuningValue('Standard');
    assert.ok(tuning.ok);
    const model = createInstrumentModel(tuning.tuning, 0);
    assert.deepStrictEqual(voice.beats.map(beat => beat.notes[0].soundingPitch), [5, 7, 8, 10].map(fret => model.pitchAt(2, fret)));
    assert.deepStrictEqual(voice.beats.map(beat => beat.notes[0].string), [2, 2, 2, 2]);
    assert.strictEqual(scoreHasTab(score), true);
  });

  it('preserves different authored strings that sound at the same pitch', () => {
    const score = parseGuitarDsl('| C |\ntab: | [1f0,2f5]/1 |');
    const notes = score.measures[0].tabVoices?.[0].beats[0].notes;
    assert.ok(notes);
    assert.deepStrictEqual(notes.map(note => note.string), [1, 2]);
    assert.strictEqual(notes[0].soundingPitch, notes[1].soundingPitch);
  });

  it('resolves Drop D capo positions without changing the displayed frets', () => {
    const score = parseGuitarDsl('tuning: Drop D\ncapo: 2\n| D |\ntab: | 6f0/2 6f2/2 |');
    const voice = score.measures[0].tabVoices?.[0];
    assert.ok(voice);
    assert.deepStrictEqual(voice.beats.map(beat => beat.notes[0].fret), [0, 2]);
    assert.deepStrictEqual(voice.beats.map(beat => beat.notes[0].soundingPitch), [40, 42]);
  });

  it('omits invalid positions and reports source diagnostics without throwing', () => {
    const score = parseGuitarDsl('capo: 12\n| C |\ntab: | [2f12,7f3,1f13]/1 |');
    assert.ok(score.diagnostics.some(d => d.code === 'invalidTabString'));
    assert.ok(score.diagnostics.some(d => d.code === 'invalidTabFret'));
    assert.ok(score.diagnostics.some(d => d.code === 'duplicateTabString') === false);
    const notes = score.measures[0].tabVoices?.[0].beats[0].notes ?? [];
    assert.deepStrictEqual(notes.map(note => note.string), [2]);
  });

  it('accepts the physical fret boundary and distinguishes dead notes from unplayed strings', () => {
    const openCapo = parseGuitarDsl('| C |\ntab: | 1f24/1 |');
    const overFret = parseGuitarDsl('| C |\ntab: | 1f25/1 |');
    const capo = parseGuitarDsl('capo: 12\n| C |\ntab: | 6f12/1 |');
    const capoOverFret = parseGuitarDsl('capo: 12\n| C |\ntab: | 6f13/1 |');
    assert.ok(!openCapo.diagnostics.some(d => d.code === 'invalidTabFret'));
    assert.ok(overFret.diagnostics.some(d => d.code === 'invalidTabFret'));
    assert.ok(!capo.diagnostics.some(d => d.code === 'invalidTabFret'));
    assert.ok(capoOverFret.diagnostics.some(d => d.code === 'invalidTabFret'));
    const chord = parseGuitarDsl('| C |\ntab: | [6f3,5x,4f5]/1 |').measures[0].tabVoices?.[0].beats[0].notes;
    assert.deepStrictEqual(chord?.map(note => [note.string, note.dead, note.soundingPitch]), [[6, false, 43], [5, true, undefined], [4, false, 55]]);
  });

  it('rejects duplicate strings and unsupported voices explicitly', () => {
    const duplicate = parseGuitarDsl('| C |\ntab: | [2f5,2f7]/1 |');
    assert.ok(duplicate.diagnostics.some(d => d.code === 'duplicateTabString'));
    assert.deepStrictEqual(duplicate.measures[0].tabVoices?.[0].beats[0].notes, []);
    const unsupported = parseGuitarDsl('| C |\ntab[2]: | 2f5/1 |');
    assert.ok(unsupported.diagnostics.some(d => d.code === 'unsupportedTabVoice'));
    assert.strictEqual(scoreHasTab(unsupported), false);
  });

  it('deep-copies a prior TAB measure for %', () => {
    const score = parseGuitarDsl('| C | C |\ntab: | 6f0/1 | % |');
    const first = score.measures[0].tabVoices?.[0];
    const second = score.measures[1].tabVoices?.[0];
    assert.ok(first && second);
    assert.deepStrictEqual(second, first);
    assert.notStrictEqual(second, first);
    assert.notStrictEqual(second.beats, first.beats);
    assert.notStrictEqual(second.beats[0], first.beats[0]);
  });

  it('expands TAB let fragments with their own duration state', () => {
    const score = parseGuitarDsl([
      'let riff = 6f0/8 6f3 5f0 6f3',
      '| C |',
      'tab: | $riff $riff |'
    ].join('\n'));
    assert.deepStrictEqual(score.diagnostics.filter(d => d.code === 'invalidVariableValue' || d.code === 'variableContextMismatch'), []);
    const voice = score.measures[0].tabVoices?.[0];
    assert.ok(voice);
    assert.strictEqual(voice.beats.length, 8);
    assert.deepStrictEqual(voice.beats.map(beat => beat.duration.beats), Array(8).fill({ n: 1, d: 2 }));
  });

  it('keeps r/8 fragments usable in both melody and TAB contexts', () => {
    const score = parseGuitarDsl([
      'let rest = r/8',
      '| C |',
      'mel: | c4/8 $rest d e f g a b |',
      'tab: | 6f0/8 $rest 6f1 6f2 6f3 6f4 6f5 6f6 |'
    ].join('\n'));
    assert.ok(!score.diagnostics.some(d => d.code === 'variableContextMismatch'));
    assert.strictEqual(score.measures[0].melody?.[1].isRest, true);
    assert.strictEqual(score.measures[0].tabVoices?.[0].beats[1].isRest, true);
  });

  it('rejects TAB-only fragments in melody and unfinished TAB links at their definitions', () => {
    const wrongContext = parseGuitarDsl('let riff = 6f0/1\n| C |\nmel: | $riff |');
    assert.ok(wrongContext.diagnostics.some(d => d.code === 'variableContextMismatch'));
    for (const definition of ['let bad = 3f5{hammer}/1', 'let bad = 3f5{slide}/1', 'let bad = 3f5{gliss}/1', 'let bad = 3f5~/1']) {
      const score = parseGuitarDsl(`${definition}\n| C |\ntab: | $bad |`);
      const diagnostic = score.diagnostics.find(d => d.code === 'invalidVariableValue');
      assert.ok(diagnostic);
      assert.strictEqual(diagnostic.line, 0);
    }
  });

  it('does not let TAB fragment links escape to caller beats', () => {
    const tie = parseGuitarDsl([
      'let tied = 3f5~/4 2f0/4',
      '| C |',
      'tab: | $tied 3f5/2 |'
    ].join('\n'));
    const tieDiagnostic = tie.diagnostics.find(d => d.code === 'invalidVariableValue');
    assert.ok(tieDiagnostic);
    assert.strictEqual(tieDiagnostic.line, 0);
    assert.strictEqual(tieDiagnostic.args?.reason, 'tieTarget');

    const connection = parseGuitarDsl([
      'let linked = 3f5{hammer}/4 2f0/4',
      '| C |',
      'tab: | $linked 3f7/2 |'
    ].join('\n'));
    const connectionDiagnostic = connection.diagnostics.find(d => d.code === 'invalidVariableValue');
    assert.ok(connectionDiagnostic);
    assert.strictEqual(connectionDiagnostic.line, 0);
    assert.strictEqual(connectionDiagnostic.args?.reason, 'danglingConnection');
  });

  it('reports invalid effect names and effect-scope mismatches', () => {
    const score = parseGuitarDsl('| C |\ntab: | 2f5{harmonic}/1 2f6/1!{bend(amount=1)} |');
    assert.ok(score.diagnostics.some(d => d.code === 'invalidTabEffect'));
    assert.ok(score.diagnostics.some(d => d.code === 'invalidTabEffectScope'));
  });

  it('reports leading TAB repeat and excess TAB cells', () => {
    const leading = parseGuitarDsl('| C |\ntab: | % |');
    assert.ok(leading.diagnostics.some(d => d.code === 'tabRepeatWithoutPrevious'));
    const excess = parseGuitarDsl('| C |\ntab: | 6f0/1 | 5f2/1 |');
    assert.ok(excess.diagnostics.some(d => d.code === 'tooManyTabMeasures'));
  });

  it('uses the existing missing-initial-duration diagnostic for a first TAB beat', () => {
    const score = parseGuitarDsl('| C |\ntab: | 2f5 2f7/4 |');
    assert.ok(score.diagnostics.some(d => d.code === 'missingInitialOctaveOrLength'));
  });

  it('keeps note and beat effects in their written scopes across inherited durations', () => {
    const score = parseGuitarDsl('| C |\ntab: | [6f3{pm},5f2]/2!{let-ring} [6f3,5f2] |');
    const beats = score.measures[0].tabVoices?.[0].beats;
    assert.ok(beats);
    assert.deepStrictEqual(beats[0].notes[0].effects.map(effect => effect.name), ['pm']);
    assert.deepStrictEqual(beats[0].effects.map(effect => effect.name), ['let-ring']);
    assert.deepStrictEqual(beats[1].effects, []);
    assert.deepStrictEqual(beats[1].duration.beats, beats[0].duration.beats);
  });

  it('treats tab[1]: as tab: and rejects every reserved higher voice', () => {
    const plain = parseGuitarDsl('| C |\ntab: | 2f5/1 |');
    const numbered = parseGuitarDsl('| C |\ntab[1]: | 2f5/1 |');
    assert.deepStrictEqual(numbered.measures[0].tabVoices, plain.measures[0].tabVoices);
    for (const voice of [2, 3, 4]) {
      const unsupported = parseGuitarDsl(`| C |\ntab[${voice}]: | 2f5/1 |`);
      assert.ok(unsupported.diagnostics.some(d => d.code === 'unsupportedTabVoice'));
      assert.strictEqual(scoreHasTab(unsupported), false);
    }
  });

  it('attaches TAB lyrics once per attacked beat and skips tied-only continuations', () => {
    const score = parseGuitarDsl([
      '| C |',
      'tab: | [6f3~,5f2]/2 [6f3,5f3]/2 |',
      'lyr: | あ さ |'
    ].join('\n'));
    const beats = score.measures[0].tabVoices?.[0].beats;
    assert.ok(beats);
    assert.deepStrictEqual(beats[0].syllables, [{ text: 'あ', hyphenToNext: false, extend: false }]);
    assert.deepStrictEqual(beats[1].syllables, [{ text: 'さ', hyphenToNext: false, extend: false }]);
    assert.ok(!score.diagnostics.some(d => d.code === 'syllableCountMismatch'));
  });

  it('keeps melody and TAB lyrics attached to their independent source groups', () => {
    const score = parseGuitarDsl([
      '| C | G |',
      'mel: | c4/1 | d4/1 |',
      'lyr: | あ | い |',
      'tab: | 2f5/1 | 2f7/1 |',
      'lyr: | さ | の |'
    ].join('\n'));
    assert.strictEqual(score.measures[0].melody?.[0].syllables[0]?.text, 'あ');
    assert.strictEqual(score.measures[0].tabVoices?.[0].beats[0].syllables[0]?.text, 'さ');
    assert.strictEqual(score.measures[1].melody?.[0].syllables[0]?.text, 'い');
    assert.strictEqual(score.measures[1].tabVoices?.[0].beats[0].syllables[0]?.text, 'の');
    assert.ok(!score.diagnostics.some(d => d.code === 'syllableCountMismatch' || d.code === 'lyricsWithoutMelody'));
  });

  it('diagnoses mismatched ties and missing same-string connection targets', () => {
    const score = parseGuitarDsl('| C |\ntab: | 3f5{hammer}/2 2f7/2 |');
    assert.ok(score.diagnostics.some(d => d.code === 'danglingTabConnection'));
    const tied = parseGuitarDsl('| C |\ntab: | 3f5~/2 3f6/2 |');
    assert.ok(tied.diagnostics.some(d => d.code === 'invalidTabTie'));
    const danglingTie = parseGuitarDsl('| C |\ntab: | 3f5~/1 |');
    assert.ok(danglingTie.diagnostics.some(d => d.code === 'invalidTabTie'));
  });

  it('uses the next same-string beat for connections in source and let fragments', () => {
    const source = parseGuitarDsl('| C |\ntab: | 3f5{hammer}/4 2f0/4 3f7/2 |');
    assert.ok(!source.diagnostics.some(d => d.code === 'invalidTabConnection' || d.code === 'danglingTabConnection'));

    const fragment = parseGuitarDsl([
      'let lick = 3f5{hammer}/4 2f0/4 3f7/2',
      '| C |',
      'tab: | $lick |'
    ].join('\n'));
    assert.ok(!fragment.diagnostics.some(d => d.code === 'invalidVariableValue'));
    assert.ok(!fragment.diagnostics.some(d => d.code === 'invalidTabConnection' || d.code === 'danglingTabConnection'));
  });

  it('reports a dead same-string connection candidate as invalid', () => {
    const score = parseGuitarDsl('| C |\ntab: | 3f5{slide}/2 3x/2 |');
    assert.ok(score.diagnostics.some(d => d.code === 'invalidTabConnection'));
    assert.ok(!score.diagnostics.some(d => d.code === 'danglingTabConnection'));
  });

  it('preserves structured TAB lyric syllables, melismas and skips', () => {
    const score = parseGuitarDsl([
      '| C |',
      'tab: | 2f1/4 2f3 1f0 1f1 |',
      'lyr: | sun- rise _ * |'
    ].join('\n'));
    const syllables = score.measures[0].tabVoices?.[0].beats.map(beat => beat.syllables[0]);
    assert.deepStrictEqual(syllables, [
      { text: 'sun', hyphenToNext: true, extend: false },
      { text: 'rise', hyphenToNext: false, extend: false },
      { text: '', hyphenToNext: false, extend: true },
      null
    ]);
  });

  it('checks optional TAB lyric bars against each measure cell', () => {
    const matching = parseGuitarDsl([
      '| C | G |',
      'tab: | 2f1/1 | 2f2/1 |',
      'lyr: | sun | rise |'
    ].join('\n'));
    const mismatched = parseGuitarDsl([
      '| C | G |',
      'tab: | 2f1/1 | 2f2/1 |',
      'lyr: | sun rise |'
    ].join('\n'));
    assert.ok(!matching.diagnostics.some(d => d.code === 'lyricBarMismatch'));
    assert.ok(mismatched.diagnostics.some(d => d.code === 'lyricBarMismatch'));
    assert.ok(!mismatched.diagnostics.some(d => d.code === 'syllableCountMismatch'));
  });

  it('shares tie and connection target traversal across parsed and compiled TAB beats', () => {
    const parsed = parseTabCell({ text: '3f5{hammer}/4 2f0/4 3f7/2', startCol: 0, endCol: 30 }).beats;
    const connection = resolveTabLinkTarget(parsed, 0, parsed[0].notes[0], 'connection');
    assert.strictEqual(connection.status, 'valid');
    if (connection.status === 'valid') {
      assert.strictEqual(connection.targetIndex, 2);
      assert.strictEqual(connection.note.fret, 7);
    }

    const tied = parseTabCell({ text: '3f5~/4 2f0/4 3f5/2', startCol: 0, endCol: 30 }).beats;
    assert.strictEqual(resolveTabLinkTarget(tied, 0, tied[0].notes[0], 'tie').status, 'invalid');
    const noConnectionTarget = parseTabCell({ text: '3f5{hammer}/4 2f0/2', startCol: 0, endCol: 30 }).beats;
    assert.strictEqual(resolveTabLinkTarget(noConnectionTarget, 0, noConnectionTarget[0].notes[0], 'connection').status, 'dangling');
    const deadConnectionTarget = parseTabCell({ text: '3f5{hammer}/4 3x/2', startCol: 0, endCol: 30 }).beats;
    assert.strictEqual(resolveTabLinkTarget(deadConnectionTarget, 0, deadConnectionTarget[0].notes[0], 'connection').status, 'invalid');
    const compiled = parseGuitarDsl('| C |\ntab: | 3f5{hammer}/4 2f0/4 3f7/2 |').measures[0].tabVoices?.[0].beats;
    assert.ok(compiled);
    assert.strictEqual(resolveTabLinkTarget(compiled, 0, compiled[0].notes[0], 'connection').status, 'valid');
  });
});
