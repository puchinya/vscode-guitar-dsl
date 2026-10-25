import * as assert from 'assert';
import { parseGuitarDsl } from '../../src/compiler';
import { renderContinuousSvg } from '../../src/render/svg';
import { compileGuitarDslToHtml } from '../../src/render/previewHtml';
import { applyAfterStopAcknowledgement, VisualEditingHostController, waitForStopAcknowledgement } from '../../src/visualEditing/hostController';
import { planLetOperation, planVisualEdit } from '../../src/visualEditing/planners';

function parsed(source: string) {
  const score = parseGuitarDsl(source);
  assert.deepStrictEqual(score.diagnostics.filter(item => item.severity === 'error'), []);
  return score;
}

describe('parser-owned visual editing sources', () => {
  it('exposes exact authored token spans and nested let references', () => {
    const source = 'let inner = 4.d 4.d\nlet riff = $inner\nkey: C\n| C $riff |\n';
    const score = parsed(source);
    const binding = score.visualSourceBindings?.find(item => item.expected === '$riff');
    assert.ok(binding);
    assert.strictEqual(source.slice(source.split('\n').slice(0, binding.line).join('\n').length + (binding.line ? 1 : 0) + binding.startCol,
      source.split('\n').slice(0, binding.line).join('\n').length + (binding.line ? 1 : 0) + binding.endCol), '$riff');
    assert.strictEqual(binding.origin, 'let-reference');
    const inner = score.letDefinitions?.find(item => item.name === 'inner');
    assert.ok(inner);
    assert.strictEqual(inner.valid, true);
    assert.ok(inner.directReferences.some(reference => reference.kind === 'definition' && reference.ownerName === 'riff'));
    assert.ok(inner.usageLocations.some(reference => reference.via === 'riff'));
    assert.deepStrictEqual(inner.allowedContexts, ['measure']);
  });

  it('connects parser bindings to chord, rhythm, melody, TAB, and lyric SVG marks', () => {
    const source = '| C 4.d 4.u 4.d 4.u |\nmel: | c4/4 d4/4 e4/4 f4/4 |\nlyr: あ い う え\ntab: | 6f0/4 6f1/4 6f3/4 6f5/4 |\n';
    const score = parsed(source);
    const svg = renderContinuousSvg(score, 'A4', true);
    for (const kind of ['chord', 'rhythm', 'melodyNote', 'tab', 'lyric'] as const) {
      const binding = score.visualSourceBindings?.find(item => item.kind === kind);
      assert.ok(binding, `expected parser binding for ${kind}`);
      assert.ok(svg.includes(`data-visual-binding="${binding.id}"`), `expected rendered target for ${kind}`);
    }
    const withoutBindings = renderContinuousSvg({ ...score, visualSourceBindings: undefined });
    assert.strictEqual(svg.replace(/ data-visual-binding="[^"]*"/g, ''), withoutBindings,
      'Preview targets add only non-visible attributes to existing SVG elements');
  });
});

describe('source-preserving visual and variable planners', () => {
  it('renames nested references and preserves unrelated CRLF comments', () => {
    const source = '# keep 🎸\r\nlet inner = 4.d 4.d\r\nlet riff = $inner # note\r\nkey: C\r\n| C $riff |\r\n# untouched\r\n';
    const score = parsed(source);
    const plan = planLetOperation(source, score, { kind: 'rename', name: 'inner', newName: 'pulse' });
    assert.ok(plan.ok, plan.ok ? '' : plan.code);
    assert.ok(plan.resultingSource.includes('let pulse = 4.d 4.d\r\n'));
    assert.ok(plan.resultingSource.includes('let riff = $pulse # note\r\n'));
    assert.ok(plan.resultingSource.endsWith('| C $riff |\r\n# untouched\r\n'));
  });

  it('distinguishes global definition edits from one explicit local occurrence', () => {
    const source = 'let riff = 4.d 4.d\nkey: C\n| C $riff |\n| G $riff |\n';
    const score = parsed(source);
    const global = planLetOperation(source, score, { kind: 'editGlobal', name: 'riff', value: '8.d 8.d' });
    assert.ok(global.ok, global.ok ? '' : global.code);
    assert.strictEqual((global.resultingSource.match(/let riff = 8\.d 8\.d/g) ?? []).length, 1);
    assert.strictEqual((global.resultingSource.match(/\$riff/g) ?? []).length, 2);

    const first = (score.codeActionTokens ?? []).find(token => token.kind === 'letReference');
    assert.ok(first);
    const local = planLetOperation(source, score, {
      kind: 'detachLocal', name: 'riff', line: first.line,
      startCol: first.startCol, endCol: first.endCol, value: '8.d 8.d'
    });
    assert.ok(local.ok, local.ok ? '' : local.code);
    assert.ok(local.resultingSource.includes('| C 8.d 8.d |'));
    assert.ok(local.resultingSource.includes('| G $riff |'));
  });

  it('only deletes unused definitions and rejects stale parser-issued token spans', () => {
    const unused = 'let spare = 4.d\nkey: C\n| C |\n';
    const removal = planLetOperation(unused, parsed(unused), { kind: 'deleteUnused', name: 'spare' });
    assert.ok(removal.ok, removal.ok ? '' : removal.code);
    assert.ok(!removal.resultingSource.includes('let spare'));

    const used = 'let riff = 4.d 4.d\nkey: C\n| C $riff |\n';
    const usedPlan = planLetOperation(used, parsed(used), { kind: 'deleteUnused', name: 'riff' });
    assert.deepStrictEqual(usedPlan, { ok: false, code: 'definitionInUse' });

    const source = '| C |\n';
    const score = parsed(source);
    const chord = score.visualSourceBindings?.find(binding => binding.kind === 'chord');
    assert.ok(chord);
    assert.deepStrictEqual(planVisualEdit('| D |\n', score, { kind: 'replaceChord', bindingId: chord.id, name: 'G' }),
      { ok: false, code: 'staleSource' });
    const edit = planVisualEdit(source, score, { kind: 'replaceChord', bindingId: chord.id, name: 'G' });
    assert.ok(edit.ok, edit.ok ? '' : edit.code);
    assert.strictEqual(edit.resultingSource, '| G |\n');
  });

  it('binds one Japanese lyric syllable to its authored UTF-16 span', () => {
    const source = '| C |\nmel: | c4/4 |\nlyr: (あさ)\n';
    const score = parsed(source);
    const syllable = score.visualSourceBindings?.find(binding => binding.kind === 'lyric');
    assert.ok(syllable);
    assert.strictEqual(syllable.expected, '(あさ)');
    const plan = planVisualEdit(source, score, { kind: 'replaceLyric', bindingId: syllable.id, text: '(ひかり)' });
    assert.ok(plan.ok, plan.ok ? '' : plan.code);
    assert.ok(plan.resultingSource.includes('lyr: (ひかり)'));
  });

  it('uses a semantic semitone operation for a selected melody note', () => {
    const source = '| C |\nmel: | c4/4 |\n';
    const score = parsed(source);
    const note = score.visualSourceBindings?.find(binding => binding.kind === 'melodyNote');
    assert.ok(note);
    const plan = planVisualEdit(source, score, { kind: 'transposeMelody', bindingId: note.id, semitones: 1 });
    assert.ok(plan.ok, plan.ok ? '' : plan.code);
    assert.ok(plan.resultingSource.includes('c#4/4'));
    const longer = planVisualEdit(source, score, { kind: 'changeDuration', bindingId: note.id, direction: 'longer' });
    assert.ok(longer.ok, longer.ok ? '' : longer.code);
    assert.ok(longer.resultingSource.includes('c4/2'));
    assert.deepStrictEqual(planVisualEdit(source, score, { kind: 'transposeMelody', bindingId: note.id, semitones: 12 }),
      { ok: false, code: 'invalidOperation' });
  });

  it('edits one rhythm technique and one TAB fret while preserving CRLF context', () => {
    const source = '| C 4.d 4.u 4.d 4.u |\r\ntab: | 6f0/4 6f1/4 6f3/4 6f5/4 |\r\n# keep\r\n';
    const score = parsed(source);
    const rhythm = score.visualSourceBindings?.find(binding => binding.kind === 'rhythm');
    const tab = score.visualSourceBindings?.find(binding => binding.kind === 'tab');
    assert.ok(rhythm && tab);
    const rhythmEdit = planVisualEdit(source, score, { kind: 'replaceRhythmToken', bindingId: rhythm.id, text: '4.u' });
    const tabEdit = planVisualEdit(source, score, { kind: 'replaceTabToken', bindingId: tab.id, text: '6f2/4' });
    assert.ok(rhythmEdit.ok, rhythmEdit.ok ? '' : rhythmEdit.code);
    assert.ok(tabEdit.ok, tabEdit.ok ? '' : tabEdit.code);
    assert.ok(rhythmEdit.resultingSource.startsWith('| C 4.u 4.u 4.d 4.u |\r\n'));
    assert.ok(tabEdit.resultingSource.includes('tab: | 6f2/4 6f1/4 6f3/4 6f5/4 |\r\n# keep\r\n'));
  });

  it('inserts and deletes parser-bound chord, melody, rhythm, TAB, and lyric tokens', () => {
    const chordSource = '| C/2 G/2 |\n';
    const chordScore = parsed(chordSource);
    const chord = chordScore.visualSourceBindings?.find(binding => binding.kind === 'chord' && binding.expected === 'C/2');
    assert.ok(chord);
    const chordName = planVisualEdit(chordSource, chordScore, { kind: 'replaceChord', bindingId: chord.id, name: 'Am' });
    assert.ok(chordName.ok, chordName.ok ? '' : chordName.code);
    assert.strictEqual(chordName.resultingSource, '| Am/2 G/2 |\n', 'chord-name editing preserves explicit timing');
    const chordInsert = planVisualEdit(chordSource, chordScore, { kind: 'insertToken', bindingId: chord.id, text: 'F/2' });
    assert.ok(chordInsert.ok, chordInsert.ok ? '' : chordInsert.code);
    assert.strictEqual(chordInsert.resultingSource, '| C/2 F/2 G/2 |\n');
    const lastChord = chordScore.visualSourceBindings?.find(binding => binding.kind === 'chord' && binding.expected === 'G/2');
    assert.ok(lastChord);
    const chordDelete = planVisualEdit(chordSource, chordScore, { kind: 'deleteToken', bindingId: lastChord.id });
    assert.ok(chordDelete.ok, chordDelete.ok ? '' : chordDelete.code);
    assert.strictEqual(chordDelete.resultingSource, '| C/2 |\n');

    const melodySource = '| C |\nmel: | c4/4 d4/4 |\n';
    const melodyScore = parsed(melodySource);
    const melody = melodyScore.visualSourceBindings?.find(binding => binding.kind === 'melodyNote');
    assert.ok(melody);
    const melodyInsert = planVisualEdit(melodySource, melodyScore, { kind: 'insertToken', bindingId: melody.id, text: 'e4/4' });
    assert.ok(melodyInsert.ok, melodyInsert.ok ? '' : melodyInsert.code);
    assert.ok(melodyInsert.resultingSource.includes('mel: | c4/4 e4/4 d4/4 |'));
    const inlineGroupSource = '| C [c4,e4]/4 f4/4 |\n';
    const inlineGroupScore = parsed(inlineGroupSource);
    const group = inlineGroupScore.visualSourceBindings?.find(binding => binding.kind === 'noteGroup');
    assert.ok(group);
    const groupReplace = planVisualEdit(inlineGroupSource, inlineGroupScore, {
      kind: 'replaceMelodyToken', bindingId: group.id, text: '[d4,f4]/4'
    });
    assert.ok(groupReplace.ok, groupReplace.ok ? '' : groupReplace.code);
    assert.ok(groupReplace.resultingSource.includes('[d4,f4]/4'), 'noteGroup Apply uses its melody-token planner');
    const inlineNote = inlineGroupScore.visualSourceBindings?.find(binding => binding.kind === 'inlineNote');
    assert.ok(inlineNote);
    const inlineReplace = planVisualEdit(inlineGroupSource, inlineGroupScore, {
      kind: 'replaceMelodyToken', bindingId: inlineNote.id, text: 'g4/4'
    });
    assert.ok(inlineReplace.ok, inlineReplace.ok ? '' : inlineReplace.code);

    const rhythmSource = '| C 4.d 4.u |\n';
    const rhythmScore = parsed(rhythmSource);
    const rhythm = rhythmScore.visualSourceBindings?.find(binding => binding.kind === 'rhythm');
    assert.ok(rhythm);
    const rhythmInsert = planVisualEdit(rhythmSource, rhythmScore, { kind: 'insertToken', bindingId: rhythm.id, text: '8.d' });
    assert.ok(rhythmInsert.ok, rhythmInsert.ok ? '' : rhythmInsert.code);
    assert.ok(rhythmInsert.resultingSource.includes('4.d 8.d 4.u'));
    const lastRhythm = rhythmScore.visualSourceBindings?.filter(binding => binding.kind === 'rhythm').at(-1);
    assert.ok(lastRhythm);
    const rhythmDelete = planVisualEdit(rhythmSource, rhythmScore, { kind: 'deleteToken', bindingId: lastRhythm.id });
    assert.ok(rhythmDelete.ok, rhythmDelete.ok ? '' : rhythmDelete.code);
    assert.strictEqual(rhythmDelete.resultingSource, '| C 4.d |\n');

    const tabSource = '| C |\ntab: | [6f0,5f2]/1 4f0/4 |\n';
    const tabScore = parsed(tabSource);
    const tabChord = tabScore.visualSourceBindings?.find(binding => binding.kind === 'tab' && binding.expected.startsWith('['));
    assert.ok(tabChord?.subTokens && tabChord.subTokens.length === 2);
    const tabAdd = planVisualEdit(tabSource, tabScore, { kind: 'addTabChordNote', bindingId: tabChord.id, note: '4f4' });
    assert.ok(tabAdd.ok, tabAdd.ok ? '' : tabAdd.code);
    assert.ok(tabAdd.resultingSource.includes('[6f0,5f2,4f4]/1'));
    const tabRemove = planVisualEdit(tabSource, tabScore, { kind: 'deleteTabChordNote', bindingId: tabChord.id, note: '6f0' });
    assert.ok(tabRemove.ok, tabRemove.ok ? '' : tabRemove.code);
    assert.ok(tabRemove.resultingSource.includes('5f2/1'), 'removing one of two notes converts the remainder to a TAB beat');
    assert.deepStrictEqual(planVisualEdit(tabSource, tabScore, { kind: 'addTabChordNote', bindingId: tabChord.id, note: '5f4' }),
      { ok: false, code: 'invalidValue' }, 'one TAB chord cannot contain the same string twice');

    const lyricSource = '| C |\nmel: | c4/4 d4/4 e4/2 |\nlyr: あ い\n';
    const lyricScore = parsed(lyricSource);
    const lyric = lyricScore.visualSourceBindings?.find(binding => binding.kind === 'lyric');
    assert.ok(lyric);
    const lyricInsert = planVisualEdit(lyricSource, lyricScore, { kind: 'insertToken', bindingId: lyric.id, text: 'う' });
    assert.deepStrictEqual(lyricInsert, { ok: false, code: 'diagnosticRegression' },
      'inserting between syllables must not shift existing syllable-to-note assignments');
    const secondLyric = lyricScore.visualSourceBindings?.filter(binding => binding.kind === 'lyric')[1];
    assert.ok(secondLyric);
    const lyricAppend = planVisualEdit(lyricSource, lyricScore, { kind: 'insertToken', bindingId: secondLyric.id, text: 'う' });
    assert.ok(lyricAppend.ok, lyricAppend.ok ? '' : lyricAppend.code);
    assert.ok(lyricAppend.resultingSource.includes('lyr: あ い う'), 'appending into an unused note slot preserves existing assignments');
    const lyricDelete = planVisualEdit(lyricSource, lyricScore, { kind: 'deleteToken', bindingId: secondLyric.id });
    assert.ok(lyricDelete.ok, lyricDelete.ok ? '' : lyricDelete.code);
    assert.strictEqual(lyricDelete.resultingSource, '| C |\nmel: | c4/4 d4/4 e4/2 |\nlyr: あ\n');
  });

  it('uses document offsets for first, middle, and last notes in three- and four-note TAB chords', () => {
    for (const eol of ['\n', '\r\n']) {
      for (const notes of [
        ['6f0', '5f2', '4f2'],
        ['6f0', '5f2', '4f2', '3f0']
      ]) {
        for (let index = 0; index < notes.length; index++) {
          const chord = `[${notes.join(',')}]`;
          const prefix = `title: preserve${eol}| C |${eol}`;
          const source = `${prefix}tab: | ${chord}/1 |${eol}# keep${eol}`;
          const score = parsed(source);
          const binding = score.visualSourceBindings?.find(item => item.kind === 'tab' && item.expected === `${chord}/1`);
          assert.ok(binding?.subTokens);

          const edit = planVisualEdit(source, score, { kind: 'deleteTabChordNote', bindingId: binding.id, note: notes[index] });
          assert.ok(edit.ok, edit.ok ? '' : `${eol === '\r\n' ? 'CRLF' : 'LF'} ${chord} index ${index}: ${edit.code}`);
          const remaining = notes.filter((_note, at) => at !== index);
          const updated = remaining.length === 1 ? remaining[0] : `[${remaining.join(',')}]`;
          assert.strictEqual(edit.resultingSource, `${prefix}tab: | ${updated}/1 |${eol}# keep${eol}`,
            'the exact TAB chord changes while the header, earlier measure, line ending, and trailing comment remain byte-identical');
          assert.strictEqual(source.slice(edit.edits[0].start, edit.edits[0].end), edit.edits[0].expected,
            'the expected bytes are sliced from the document offsets');
          assert.ok(edit.edits[0].start >= prefix.length, 'the edit never points into an earlier document line');
        }
      }
    }
  });

  it('rejects TAB duration edits that alter inherited following events or their onsets (BV-04)', () => {
    const source = '| C |\ntab: | 6f0/4 6f1 6f2 6f3 |\n';
    const score = parsed(source);
    const first = score.visualSourceBindings?.find(binding => binding.kind === 'tab');
    assert.ok(first);
    assert.deepStrictEqual(planVisualEdit(source, score, { kind: 'replaceTabToken', bindingId: first.id, text: '6f0/8' }),
      { ok: false, code: 'diagnosticRegression' }, 'implicit duration inheritance must not change other TAB beats');
  });

  it('rejects inherited melody pitch and TAB duration changes that cross a measure boundary (BV-04)', () => {
    const melodySource = '| C | G |\nmel: | c4/2 d4/2 | e/2 f/2 |\n';
    const melodyScore = parsed(melodySource);
    const inheritedMelody = melodyScore.visualSourceBindings?.find(binding => binding.kind === 'melodyNote' && binding.expected === 'd4/2');
    assert.ok(inheritedMelody);
    assert.deepStrictEqual(planVisualEdit(melodySource, melodyScore, {
      kind: 'replaceMelodyToken', bindingId: inheritedMelody.id, text: 'd5/2'
    }), { ok: false, code: 'diagnosticRegression' }, 'the next cell inherits octave 5 and must remain unchanged');

    const tabSource = '| C | G |\ntab: | 6f0/4 | 6f1 |\n';
    const tabScore = parsed(tabSource);
    const inheritedTab = tabScore.visualSourceBindings?.find(binding => binding.kind === 'tab' && binding.expected === '6f0/4');
    assert.ok(inheritedTab);
    assert.deepStrictEqual(planVisualEdit(tabSource, tabScore, {
      kind: 'replaceTabToken', bindingId: inheritedTab.id, text: '6f0/8'
    }), { ok: false, code: 'diagnosticRegression' }, 'the next measure inherits the changed TAB duration and must remain unchanged');
  });

  it('preserves existing lyric-to-note assignments across verses and measures (BV-04)', () => {
    const source = '| C | G |\nmel: | c4/2 d4/2 | e4/2 f4/2 |\nlyr: あ い う\nlyr: A B C\n';
    const score = parsed(source);
    const verseOne = score.visualSourceBindings?.filter(binding => binding.kind === 'lyric' && binding.visualVerse === 0) ?? [];
    const verseTwo = score.visualSourceBindings?.filter(binding => binding.kind === 'lyric' && binding.visualVerse === 1) ?? [];
    assert.strictEqual(verseOne.length, 3);
    assert.strictEqual(verseTwo.length, 3);
    const assignment = (binding: NonNullable<typeof verseOne[number]>) => [
      binding.expected, binding.measureIndex, binding.eventRange?.collection, binding.eventRange?.start, binding.visualVerse
    ];

    for (const target of verseOne.slice(0, 2)) {
      assert.deepStrictEqual(planVisualEdit(source, score, { kind: 'deleteToken', bindingId: target.id }),
        { ok: false, code: 'diagnosticRegression' }, `deleting ${target.expected} must not move a remaining syllable to another note`);
    }
    const append = planVisualEdit(source, score, { kind: 'insertToken', bindingId: verseOne[2].id, text: 'え' });
    assert.ok(append.ok, append.ok ? '' : append.code);
    const appendedScore = parsed(append.resultingSource);
    const appendedVerseOne = appendedScore.visualSourceBindings?.filter(binding => binding.kind === 'lyric' && binding.visualVerse === 0) ?? [];
    const appendedVerseTwo = appendedScore.visualSourceBindings?.filter(binding => binding.kind === 'lyric' && binding.visualVerse === 1) ?? [];
    assert.deepStrictEqual(appendedVerseOne.slice(0, 3).map(assignment), verseOne.map(assignment));
    assert.deepStrictEqual(appendedVerseTwo.map(assignment), verseTwo.map(assignment));
    assert.deepStrictEqual(assignment(appendedVerseOne[3]), ['え', 1, 'melody', 1, 0], 'the new syllable is assigned to the next available note');

    const deleteLast = planVisualEdit(source, score, { kind: 'deleteToken', bindingId: verseOne[2].id });
    assert.ok(deleteLast.ok, deleteLast.ok ? '' : deleteLast.code);
    const deletedScore = parsed(deleteLast.resultingSource);
    const deletedVerseOne = deletedScore.visualSourceBindings?.filter(binding => binding.kind === 'lyric' && binding.visualVerse === 0) ?? [];
    const deletedVerseTwo = deletedScore.visualSourceBindings?.filter(binding => binding.kind === 'lyric' && binding.visualVerse === 1) ?? [];
    assert.deepStrictEqual(deletedVerseOne.map(assignment), verseOne.slice(0, 2).map(assignment));
    assert.deepStrictEqual(deletedVerseTwo.map(assignment), verseTwo.map(assignment));

    const melismaSource = '| C |\nmel: | c4/4 d4/4 e4/2 |\nlyr: あ _\n';
    const melismaScore = parsed(melismaSource);
    const beforeMelisma = melismaScore.visualSourceBindings?.find(binding => binding.kind === 'lyric');
    assert.ok(beforeMelisma);
    assert.deepStrictEqual(planVisualEdit(melismaSource, melismaScore, {
      kind: 'insertToken', bindingId: beforeMelisma.id, text: 'い'
    }), { ok: false, code: 'diagnosticRegression' }, 'an unbound melisma marker must not move to another note');
  });

  it('keeps repeat and arrangement edits on their authored source token (BV-09)', () => {
    const source = 'arrangement {\nVerse x2\n}\n[Verse]\n| C |\n| % |\n';
    const score = parsed(source);
    const chordBindings = score.visualSourceBindings?.filter(binding => binding.kind === 'chord' && binding.expected === 'C') ?? [];
    assert.strictEqual(chordBindings.length, 1, 'repeat and arrangement occurrences do not mint editable source tokens');
    const edit = planVisualEdit(source, score, { kind: 'replaceChord', bindingId: chordBindings[0].id, name: 'G' });
    assert.ok(edit.ok, edit.ok ? '' : edit.code);
    assert.strictEqual((edit.resultingSource.match(/\| G \|/g) ?? []).length, 1, 'one action changes the authored definition once');
    assert.ok(edit.resultingSource.includes('| % |'), 'repeat source syntax remains intact');
  });

  it('supports melody groups and rests while preserving measure count and tie boundaries', () => {
    const source = '| C |\nmel: | c4/4 [e4,g4]/4 r/2 |\nlyr: あ い\n';
    const score = parsed(source);
    const group = score.visualSourceBindings?.find(binding => binding.kind === 'melodyGroup');
    const rest = score.visualSourceBindings?.find(binding => binding.kind === 'melodyRest');
    assert.ok(group && rest);

    const groupInsert = planVisualEdit(source, score, {
      kind: 'insertToken', bindingId: group.id, text: '[a4,c5]/8'
    });
    assert.ok(groupInsert.ok, groupInsert.ok ? '' : groupInsert.code);
    assert.ok(groupInsert.resultingSource.includes('[e4,g4]/4 [a4,c5]/8 r/2'));
    assert.strictEqual(parsed(groupInsert.resultingSource).measures.length, score.measures.length,
      'adding a melody group stays in its authored measure');

    const groupDelete = planVisualEdit(source, score, { kind: 'deleteToken', bindingId: group.id });
    assert.ok(groupDelete.ok, groupDelete.ok ? '' : groupDelete.code);
    assert.ok(!groupDelete.resultingSource.includes('[e4,g4]/4'));
    const restDelete = planVisualEdit(source, score, { kind: 'deleteToken', bindingId: rest.id });
    assert.ok(restDelete.ok, restDelete.ok ? '' : restDelete.code);
    assert.ok(!restDelete.resultingSource.includes('r/2'));

    const tiedSource = '| C |\nmel: | c4/2~ c4/2 |\n';
    const tiedScore = parsed(tiedSource);
    const tiedNote = tiedScore.visualSourceBindings?.find(binding => binding.kind === 'melodyNote');
    assert.ok(tiedNote);
    assert.deepStrictEqual(planVisualEdit(tiedSource, tiedScore, { kind: 'deleteToken', bindingId: tiedNote.id }),
      { ok: false, code: 'diagnosticRegression' }, 'deleting one side of a tie cannot rewrite the remaining event');
  });

  it('inserts melody rests and rejects an insertion that would remap authored lyrics', () => {
    const source = '| C |\nmel: | c4/4 e4/4 r/2 |\n';
    const score = parsed(source);
    const note = score.visualSourceBindings?.find(binding => binding.kind === 'melodyNote');
    assert.ok(note);
    const insertRest = planVisualEdit(source, score, { kind: 'insertToken', bindingId: note.id, text: 'r/4' });
    assert.ok(insertRest.ok, insertRest.ok ? '' : insertRest.code);
    assert.ok(insertRest.resultingSource.includes('c4/4 r/4 e4/4 r/2'));
    assert.strictEqual(parsed(insertRest.resultingSource).measures.length, score.measures.length);

    const lyricSource = '| C |\nmel: | c4/4 d4/4 e4/2 |\nlyr: あ い う\n';
    const lyricScore = parsed(lyricSource);
    const firstNote = lyricScore.visualSourceBindings?.find(binding => binding.kind === 'melodyNote');
    assert.ok(firstNote);
    assert.deepStrictEqual(planVisualEdit(lyricSource, lyricScore, {
      kind: 'insertToken', bindingId: firstNote.id, text: 'g4/4'
    }), { ok: false, code: 'diagnosticRegression' }, 'inserting before lyrics cannot silently remap existing syllables');
  });

  it('keeps Preview edit controls hidden by default while rendering parser targets', () => {
    const source = '| C 4.d 4.u 4.d 4.u |\n';
    const score = parsed(source);
    const html = compileGuitarDslToHtml(source, {
      documentUri: 'file:///song.guitardsl', documentVersion: 1, previewGeneration: 2,
      previewEditAvailable: true, visualBindings: score.visualSourceBindings
    });
    const editHtml = compileGuitarDslToHtml(source, {
      documentUri: 'file:///song.guitardsl', documentVersion: 1, previewGeneration: 2,
      previewEditMode: true, previewEditAvailable: true, visualBindings: score.visualSourceBindings
    });
    assert.match(html, /id="preview-edit-row"[^>]* hidden/);
    assert.match(html, /data-preview-edit-mode="false"/);
    assert.doesNotMatch(html, /data-visual-binding=/, 'ordinary Preview output contains no editing attributes');
    assert.match(editHtml, /id="preview-edit-row"[^>]*>/);
    assert.match(editHtml, /data-preview-edit-mode="true"/);
    assert.match(editHtml, /data-visual-binding="source-/);
    assert.match(editHtml, /postPreviewVisualEdit\('transposeMelody'/);
    assert.match(editHtml, /document\.addEventListener\('pointerup'/);
    assert.match(editHtml, /document\.addEventListener\('pointercancel'/);
    assert.match(editHtml, /id="preview-edit-open-source"/);
  });

  it('rejects invalid or duplicate definitions without changing source', () => {
    const source = 'let riff = 4.d 4.d\nkey: C\n| C $riff |\n';
    const score = parsed(source);
    const clone = planLetOperation(source, score, { kind: 'clone', name: 'riff', newName: 'riffCopy' });
    assert.ok(clone.ok, clone.ok ? '' : clone.code);
    assert.ok(clone.resultingSource.includes('let riffCopy = 4.d 4.d\n'));
    assert.ok(clone.resultingSource.includes('| C $riff |'), 'cloning leaves existing references unchanged');
    assert.deepStrictEqual(planLetOperation(source, score, { kind: 'rename', name: 'riff', newName: 'bad-name' }),
      { ok: false, code: 'invalidValue' });
    assert.deepStrictEqual(planLetOperation(source, score, { kind: 'clone', name: 'riff', newName: 'riff' }),
      { ok: false, code: 'duplicateName' });
    assert.deepStrictEqual(planLetOperation(source, score, { kind: 'add', name: 'riff', value: '8.d 8.d' }),
      { ok: false, code: 'duplicateName' });
  });
});

describe('visual editing session guards', () => {
  it('rejects stale revisions, invalidates changed documents, and serializes apply', async () => {
    const controller = new VisualEditingHostController();
    const identity = controller.begin('variables', 'file:///score.guitardsl', 3, 0);
    assert.ok(identity);
    const next = controller.advanceRevision(identity);
    assert.ok(next);
    const stale = await controller.applyOnce(identity, () => ({ uri: identity.uri, documentVersion: 3, renderGeneration: 0 }), async () => true);
    assert.deepStrictEqual(stale, { ok: false, code: 'stale' });

    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const active = controller.applyOnce(next, () => ({ uri: next.uri, documentVersion: 3, renderGeneration: 0 }), async () => {
      enter(); await gate; return 'applied';
    });
    await entered;
    const duplicate = await controller.applyOnce(next, () => ({ uri: next.uri, documentVersion: 3, renderGeneration: 0 }), async () => 'duplicate');
    assert.deepStrictEqual(duplicate, { ok: false, code: 'busy' });
    release();
    assert.deepStrictEqual(await active, { ok: true, value: 'applied' });
    controller.invalidateUri(next.uri);
    assert.strictEqual(controller.current('variables'), undefined);
  });

  it('rejects an old variable draft after a delayed Stop ACK and rejects replay after Preview disposal (BV-10/11)', async () => {
    const controller = new VisualEditingHostController();
    const identity = controller.begin('variables', 'file:///score.guitardsl', 1, 0);
    assert.ok(identity);
    let draftRevision = 4;
    let acknowledge!: (stopped: boolean) => void;
    const stop = new Promise<boolean>(resolve => { acknowledge = resolve; });
    let applyCount = 0;
    const pending = applyAfterStopAcknowledgement(() => stop, () => draftRevision === 4, async () => ++applyCount);
    draftRevision = 5;
    acknowledge(true);
    assert.deepStrictEqual(await pending, { ok: false, code: 'stale' }, 'draft N is rejected after draft N+1 arrives');
    assert.strictEqual(applyCount, 0, 'the stale operation never reaches TextDocument apply');

    const preview = controller.begin('preview', 'file:///preview.guitardsl', 2, 1);
    assert.ok(preview);
    let acknowledgeDisposed!: (stopped: boolean) => void;
    const disposedStop = new Promise<boolean>(resolve => { acknowledgeDisposed = resolve; });
    let replayCount = 0;
    const replay = applyAfterStopAcknowledgement(() => disposedStop,
      () => !!controller.current('preview') && controller.matchesCurrent(preview,
        { uri: preview.uri, documentVersion: preview.documentVersion, renderGeneration: preview.renderGeneration }),
      async () => ++replayCount);
    controller.cancel('preview'); // panel disposal invalidates the Preview session
    acknowledgeDisposed(true);
    assert.deepStrictEqual(await replay, { ok: false, code: 'stale' });
    assert.strictEqual(replayCount, 0, 'a delayed Stop ACK cannot replay an intent after panel disposal');
  });

  it('fails closed on false and timed-out Stop ACKs before apply (BV-11)', async () => {
    let applyCount = 0;
    const falseAck = await applyAfterStopAcknowledgement(async () => false, () => true, async () => ++applyCount);
    assert.deepStrictEqual(falseAck, { ok: false, code: 'stopFailed' });
    assert.strictEqual(applyCount, 0);

    const timeoutAck = await waitForStopAcknowledgement(new Promise<boolean>(() => {}), 5);
    assert.strictEqual(timeoutAck, false);
    const timedOutApply = await applyAfterStopAcknowledgement(
      () => waitForStopAcknowledgement(new Promise<boolean>(() => {}), 5),
      () => true,
      async () => ++applyCount
    );
    assert.deepStrictEqual(timedOutApply, { ok: false, code: 'stopFailed' });
    assert.strictEqual(applyCount, 0, 'the edit remains unapplied after timeout');
  });
});
