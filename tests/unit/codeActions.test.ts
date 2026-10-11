import * as assert from 'assert';
import { computeCodeActionHints, planMusicCodeAction } from '../../src/codeActions';
import { analyzeRepeatedFragmentTokens, MAX_REPEATED_FRAGMENT_TOKENS } from '../../src/codeActions/analysis';
import { SelectedToken } from '../../src/codeActions/sourceIndex';
import { parseGuitarDsl } from '../../src/compiler';
import { SourceOffsetEdit, spliceSourceOffsets } from '../../src/sourceEdits';

function score(source: string) {
  const parsed = parseGuitarDsl(source);
  assert.deepStrictEqual(parsed.diagnostics.filter(diagnostic => diagnostic.severity === 'error'), []);
  return parsed;
}

function plan(source: string, kind: Parameters<typeof planMusicCodeAction>[2]['kind'], start: number, end: number, extra: Record<string, unknown> = {}) {
  return planMusicCodeAction(source, score(source), { kind, selection: { start, end }, ...extra } as Parameters<typeof planMusicCodeAction>[2]);
}

describe('source edits shared by music transforms', () => {
  it('preserves CRLF and untouched comments and whitespace', () => {
    const source = 'key: C\r\n|  C   G  | # keep\r\n';
    const start = source.indexOf('C   G');
    const edits: SourceOffsetEdit[] = [{ start, end: start + 1, expected: 'C', text: 'D' }];
    const result = spliceSourceOffsets(source, edits);
    assert.ok(result.ok);
    assert.strictEqual(result.text, 'key: C\r\n|  D   G  | # keep\r\n');
  });

  it('rejects stale, overlapping, and same-start edits without partial output', () => {
    const stale = spliceSourceOffsets('C G', [{ start: 0, end: 1, expected: 'D', text: 'E' }]);
    assert.strictEqual(stale.ok, false);
    const overlap = spliceSourceOffsets('C G', [
      { start: 0, end: 2, expected: 'C ', text: 'D ' },
      { start: 1, end: 3, expected: ' G', text: ' A' }
    ]);
    assert.strictEqual(overlap.ok, false);
    const sameStart = spliceSourceOffsets('C', [
      { start: 0, end: 0, expected: '', text: 'x' },
      { start: 0, end: 1, expected: 'C', text: 'D' }
    ]);
    assert.strictEqual(sameStart.ok, false);
  });
});

describe('music-aware Code Action planners', () => {
  it('extracts two complete authored tokens to a unique let and can inline one reference', () => {
    const source = '# guitar 🎸\r\nkey: C\r\n| C 4.d 4.d 8.u |\r\n# keep\r\n';
    const start = source.indexOf('4.d');
    const end = source.lastIndexOf('4.d') + '4.d'.length;
    const extracted = plan(source, 'extractLet', start, end);
    assert.ok(extracted.ok, extracted.ok ? '' : extracted.code);
    assert.match(extracted.text, /let fragment1 = 4\.d 4\.d/);
    assert.match(extracted.text, /\$fragment1/);
    assert.ok(extracted.text.includes('# guitar 🎸\r\n'));
    assert.ok(extracted.text.endsWith('|\r\n# keep\r\n'));

    const withReference = 'let riff = 4.d 4.d\nkey: C\n| C $riff |\n| G $riff |\n';
    const refStart = withReference.indexOf('$riff');
    const inlined = plan(withReference, 'inlineLet', refStart, refStart + '$riff'.length);
    assert.ok(inlined.ok, inlined.ok ? '' : inlined.code);
    assert.match(inlined.text, /\| C 4\.d 4\.d \|/);
    assert.match(inlined.text, /\| G \$riff \|/);
    assert.ok(inlined.text.startsWith('let riff = 4.d 4.d\n'), 'the definition remains available to other uses');

    const splitCells = 'key: C\n| C | 4.d 4.d |\n';
    const splitStart = splitCells.indexOf('4.d');
    const splitEnd = splitCells.lastIndexOf('4.d') + 3;
    const mergedMeasure = plan(splitCells, 'extractLet', splitStart, splitEnd);
    assert.ok(mergedMeasure.ok, mergedMeasure.ok ? '' : mergedMeasure.code);
    assert.match(mergedMeasure.text, /\| C \| \$fragment1 \|/);
  });

  it('rejects partial tokens, fragment boundaries, and implicit or repeated rhythm sources', () => {
    const source = 'key: C\n| C 4.d 4.d |\n';
    const tokenStart = source.indexOf('4.d');
    const partial = plan(source, 'extractLet', tokenStart + 1, source.lastIndexOf('4.d') + 3);
    assert.strictEqual(partial.ok, false);

    const repeated = 'key: C\n| C % |\n';
    const repeatedScore = parseGuitarDsl(repeated);
    const repeatedToken = (repeatedScore.codeActionTokens ?? []).find(token => token.kind === 'rhythm');
    assert.strictEqual(repeatedToken, undefined);

    const acrossCells = 'key: C\n| C 4.d | 4.d 8.u |\n';
    const first = acrossCells.indexOf('4.d');
    const last = acrossCells.lastIndexOf('4.d') + 3;
    assert.strictEqual(plan(acrossCells, 'extractLet', first, last).ok, false, 'selection cannot cross measure cells');

    const definition = 'let riff = 4.d 4.d\nkey: C\n| C 4.d 4.d 8.u |\n';
    const definitionStart = definition.indexOf('4.d');
    assert.strictEqual(plan(definition, 'extractLet', definitionStart, definition.lastIndexOf('4.d') + 3).ok, false,
      'a fragment definition is not an extractable use site');

    const inline = 'let riff = 4.d 4.d\nkey: C\n| C 4.d $riff |\n';
    const referenceStart = inline.indexOf('$riff');
    assert.strictEqual(plan(inline, 'inlineLet', referenceStart + 1, referenceStart + 5).ok, false, 'partial references are rejected');
    assert.strictEqual(plan(inline, 'inlineLet', referenceStart, referenceStart + 5).ok, false, 'inline requires its own cell');

    const unique = 'let fragment1 = 8.d 8.d\nkey: C\n| C 4.d 4.d 8.u |\n';
    const uniqueStart = unique.indexOf('4.d');
    const uniqueResult = plan(unique, 'extractLet', uniqueStart, unique.lastIndexOf('4.d') + 3);
    assert.ok(uniqueResult.ok && uniqueResult.text.includes('let fragment2 = 4.d 4.d'), 'generated names skip existing definitions');
  });

  it('transposes only selected chord and pitch names, rejecting custom collisions and TAB scores', () => {
    const source = '| C G |\n';
    const start = source.indexOf('C');
    const end = source.indexOf('G') + 1;
    const moved = plan(source, 'transpose', start, end, { semitones: 2 });
    assert.ok(moved.ok, moved.ok ? '' : moved.code);
    assert.strictEqual(moved.text, '| D A |\n');

    const melody = '| C |\nmel: | c4/4 |\n';
    const pitchStart = melody.indexOf('c4');
    const pitchEnd = pitchStart + 2;
    const pitchMoved = plan(melody, 'transpose', pitchStart, pitchEnd, { semitones: 2 });
    assert.ok(pitchMoved.ok, pitchMoved.ok ? '' : pitchMoved.code);
    assert.ok(pitchMoved.text.includes('d4/4'));

    const group = '| C |\nmel: | [c4,e4,g4]/4 |\n';
    const groupStart = group.indexOf('[c4,e4,g4]/4');
    const groupMoved = plan(group, 'transpose', groupStart, groupStart + '[c4,e4,g4]/4'.length, { semitones: 1 });
    assert.ok(groupMoved.ok, groupMoved.ok ? '' : groupMoved.code);
    assert.ok(groupMoved.text.includes('[c#4,f4,ab4]/4'));

    const chordLength = '| C/4 |\n';
    const chordTokenStart = chordLength.indexOf('C/4');
    const chordMoved = plan(chordLength, 'transpose', chordTokenStart, chordTokenStart + 3, { semitones: 2 });
    assert.ok(chordMoved.ok, chordMoved.ok ? '' : chordMoved.code);
    assert.strictEqual(chordMoved.text, '| D/4 |\n');

    const collision = 'chord F# = 244322\n| E |\n';
    const collisionStart = collision.lastIndexOf('E');
    assert.strictEqual(plan(collision, 'transpose', collisionStart, collisionStart + 1, { semitones: 2 }).ok, false,
      'a custom definition at the target name is not overwritten');

    const customSource = 'chord C# = 244322\n| C# |\n';
    const customSourceStart = customSource.lastIndexOf('C#');
    assert.strictEqual(plan(customSource, 'enharmonic', customSourceStart, customSourceStart + 2).ok, false,
      'a custom source chord cannot be respelled away from its voicing definition');
    assert.strictEqual(plan(customSource, 'normalizePitchNames', customSourceStart, customSourceStart + 2).ok, false,
      'normalization cannot change a custom chord lookup key');
    const customScore = score(customSource);
    assert.strictEqual(customScore.usedChords.includes('C#'), true);
    assert.deepStrictEqual(customScore.chordDefinitions[0].frets, [2, 4, 4, 3, 2, 2], 'the resolved source voicing remains available unchanged');

    const normalizingCustomSource = 'chord Cmin = 244322\n| Cmin |\n';
    const customUseStart = normalizingCustomSource.lastIndexOf('Cmin');
    const normalizedCustom = plan(normalizingCustomSource, 'normalizePitchNames', customUseStart, customUseStart + 'Cmin'.length);
    assert.strictEqual(normalizedCustom.ok, false, 'a normalized spelling cannot detach a use from its source custom voicing');
    const normalizedCustomScore = score(normalizingCustomSource);
    assert.strictEqual(normalizedCustomScore.usedChords.includes('Cmin'), true);
    assert.deepStrictEqual(normalizedCustomScore.chordDefinitions[0].frets, [2, 4, 4, 3, 2, 2]);

    const labeled = 'chord C@open = x32010\n| C@open |\n';
    const labeledStart = labeled.lastIndexOf('C@open');
    assert.strictEqual(plan(labeled, 'transpose', labeledStart, labeledStart + 'C@open'.length, { semitones: 1 }).ok, false,
      'labeled chord variants are unsupported');

    const inherited = '| C |\nmel: | c3/4 b/4 g/4 |\n';
    const inheritedPitch = inherited.indexOf('b/4');
    assert.strictEqual(plan(inherited, 'transpose', inheritedPitch, inheritedPitch + 1, { semitones: 1 }).ok, false,
      'an implicit octave that would cross an inheritance boundary is rejected');
  });

  it('toggles black-key chord spelling and normalizes only canonical pitch and chord aliases', () => {
    const chord = '| C# |\n';
    const chordStart = chord.indexOf('C#');
    const toggled = plan(chord, 'enharmonic', chordStart, chordStart + 2);
    assert.ok(toggled.ok, toggled.ok ? '' : toggled.code);
    assert.strictEqual(toggled.text, '| Db |\n');

    const melody = '| C |\nmel: | d#4/4 |\n';
    const pitchStart = melody.indexOf('d#4');
    const normalized = plan(melody, 'normalizePitchNames', pitchStart, pitchStart + 3);
    assert.ok(normalized.ok, normalized.ok ? '' : normalized.code);
    assert.strictEqual(normalized.text, '| C |\nmel: | eb4/4 |\n');

    const alias = '| Cmin/A# |\n';
    const aliasStart = alias.indexOf('Cmin/A#');
    const canonical = plan(alias, 'normalizePitchNames', aliasStart, aliasStart + 'Cmin/A#'.length);
    assert.ok(canonical.ok, canonical.ok ? '' : canonical.code);
    assert.strictEqual(canonical.text, '| Cm/Bb |\n');

    const major = '| Cmaj |\n';
    const majorStart = major.indexOf('Cmaj');
    const majorResult = plan(major, 'normalizePitchNames', majorStart, majorStart + 'Cmaj'.length);
    assert.ok(majorResult.ok, majorResult.ok ? '' : majorResult.code);
    assert.strictEqual(majorResult.text, '| C |\n');

    const natural = '| C |\n';
    const naturalStart = natural.indexOf('C');
    assert.strictEqual(plan(natural, 'enharmonic', naturalStart, naturalStart + 1).ok, false, 'natural spellings have no black-key toggle');

    const qualified = '| Cmaj7 |\n';
    const qualifiedStart = qualified.indexOf('Cmaj7');
    assert.strictEqual(plan(qualified, 'normalizePitchNames', qualifiedStart, qualifiedStart + 'Cmaj7'.length).ok, false,
      'maj is normalized only as a standalone alias');
  });

  it('doubles and halves explicit durations while preserving stroke modifiers and exact beat notation', () => {
    const source = '# 🎵 preserve\r\n| C 4.d 8.u |\r\n# keep\r\n';
    const start = source.indexOf('4.d');
    const end = source.indexOf('8.u') + '8.u'.length;
    const doubled = plan(source, 'doubleDuration', start, end);
    assert.ok(doubled.ok, doubled.ok ? '' : doubled.code);
    assert.strictEqual(doubled.text, '# 🎵 preserve\r\n| C 2.d 4.u |\r\n# keep\r\n');
    const halved = plan(source, 'halveDuration', start, end);
    assert.ok(halved.ok, halved.ok ? '' : halved.code);
    assert.strictEqual(halved.text, '# 🎵 preserve\r\n| C 8.d 16.u |\r\n# keep\r\n');

    const additive = '| C 4+8 |\n';
    const additiveStart = additive.indexOf('4+8');
    const additiveDoubled = plan(additive, 'doubleDuration', additiveStart, additiveStart + 3);
    assert.ok(additiveDoubled.ok, additiveDoubled.ok ? '' : additiveDoubled.code);
    assert.strictEqual(additiveDoubled.text, '| C 2+4 |\n');
    const additiveHalved = plan(additive, 'halveDuration', additiveStart, additiveStart + 3);
    assert.ok(additiveHalved.ok, additiveHalved.ok ? '' : additiveHalved.code);
    assert.strictEqual(additiveHalved.text, '| C 8+16 |\n');

    const dotted = '| C/4. |\n';
    const dottedStart = dotted.indexOf('C/4.');
    const doubledDotted = plan(dotted, 'doubleDuration', dottedStart, dottedStart + 4);
    assert.ok(doubledDotted.ok, doubledDotted.ok ? '' : doubledDotted.code);
    assert.strictEqual(doubledDotted.text, '| C/2. |\n');

    const beats = '| C:0.5 |\n';
    const beatsStart = beats.indexOf('C:0.5');
    const doubledBeats = plan(beats, 'doubleDuration', beatsStart, beatsStart + 'C:0.5'.length);
    assert.ok(doubledBeats.ok, doubledBeats.ok ? '' : doubledBeats.code);
    assert.strictEqual(doubledBeats.text, '| C:1 |\n');
  });

  it('skips tuplets, smallest and largest supported values, and let references', () => {
    const triplet = '| C 8t 8t 8t |\n';
    const tripletStart = triplet.indexOf('8t');
    const tripletEnd = triplet.lastIndexOf('8t') + 2;
    const tuplets = plan(triplet, 'doubleDuration', tripletStart, tripletEnd);
    assert.strictEqual(tuplets.ok, false);

    const largest = '| C 1.d |\n';
    const largestStart = largest.indexOf('1.d');
    assert.strictEqual(plan(largest, 'doubleDuration', largestStart, largestStart + 3).ok, false);
    const smallest = '| C 16.d |\n';
    const smallestStart = smallest.indexOf('16.d');
    assert.strictEqual(plan(smallest, 'halveDuration', smallestStart, smallestStart + 4).ok, false);

    const reference = 'let phrase = 4.d 4.d\n| C $phrase |\n';
    const refStart = reference.indexOf('$phrase');
    assert.strictEqual(plan(reference, 'doubleDuration', refStart, refStart + '$phrase'.length).ok, false);

    const inherited = '| C |\nmel: | c4/4 d |\n';
    const inheritedStart = inherited.indexOf('d |');
    assert.strictEqual(plan(inherited, 'doubleDuration', inheritedStart, inheritedStart + 1).ok, false,
      'duration changes require an authored duration');
  });

  it('preserves parsed beats for unselected inherited melody notes', () => {
    const beatSummary = (source: string) => (parseGuitarDsl(source).measures[0].melody ?? [])
      .map(note => `${note.beats.n}/${note.beats.d}`);
    const source = '| C |\nmel: | c4/4 d e f |\n';
    assert.deepStrictEqual(beatSummary(source), ['1/1', '1/1', '1/1', '1/1']);
    const start = source.indexOf('c4/4');
    const rejected = plan(source, 'doubleDuration', start, start + 'c4/4'.length);
    assert.strictEqual(rejected.ok, false, 'the inherited d/e/f notes would otherwise double too');
    assert.deepStrictEqual(beatSummary(source), ['1/1', '1/1', '1/1', '1/1'], 'rejected plans leave parsed source semantics unchanged');

    const explicit = '| C |\nmel: | c4/4 d/4 e/4 f/4 |\n';
    const explicitStart = explicit.indexOf('c4/4');
    const accepted = plan(explicit, 'doubleDuration', explicitStart, explicitStart + 'c4/4'.length);
    assert.ok(accepted.ok, accepted.ok ? '' : accepted.code);
    assert.deepStrictEqual(beatSummary(explicit), ['1/1', '1/1', '1/1', '1/1']);
    assert.deepStrictEqual(beatSummary(accepted.text), ['2/1', '1/1', '1/1', '1/1'], 'only the selected note duration changes');
  });

  it('offers bounded hints and only removes an unused definition without a trailing comment', () => {
    const source = 'chord C@unused = x32010\n| G 4.d 8.u 4.d 8.u |\n| D 4.d 8.u 4.d 8.u |\n';
    const parsed = score(source);
    const hints = computeCodeActionHints(source, parsed);
    assert.ok(hints.some(hint => hint.kind === 'unusedChordDefinition'));
    assert.ok(hints.some(hint => hint.kind === 'repeatedFragmentCandidate'));
    assert.ok(hints.length <= 40);
    const line = hints.find(hint => hint.kind === 'unusedChordDefinition')!.line;
    const removed = planMusicCodeAction(source, parsed, { kind: 'removeUnusedChordDefinition', line });
    assert.ok(removed.ok, removed.ok ? '' : removed.code);
    assert.ok(!removed.text.includes('chord C@unused'));

    const commented = 'chord C@unused = x32010 # keep\n| G |\n';
    const commentedScore = score(commented);
    const commentedHint = computeCodeActionHints(commented, commentedScore).find(hint => hint.kind === 'unusedChordDefinition');
    assert.ok(commentedHint);
    const noFix = planMusicCodeAction(commented, commentedScore, { kind: 'removeUnusedChordDefinition', line: commentedHint!.line });
    assert.strictEqual(noFix.ok, false);

    const used = 'chord C@used = x32010\n| C@used 4.d 8.u 16.d 8.u |\n';
    const usedParsed = score(used);
    const usedHints = computeCodeActionHints(used, usedParsed);
    assert.ok(!usedHints.some(hint => hint.kind === 'unusedChordDefinition'), 'active definitions do not get a removal hint');
    assert.ok(!usedHints.some(hint => hint.kind === 'repeatedFragmentCandidate'), 'a non-repeated cell gets no extraction hint');
    const activeDefinition = usedParsed.sourceDefinitions?.find(definition => definition.kind === 'chord');
    assert.ok(activeDefinition);
    assert.strictEqual(planMusicCodeAction(used, usedParsed, { kind: 'removeUnusedChordDefinition', line: activeDefinition!.line }).ok, false,
      'active chord definitions cannot be removed');

    const duplicate = 'chord C@unused = x32010\nchord C@unused = x32010\n| G |\n';
    const duplicateScore = score(duplicate);
    assert.ok(duplicateScore.diagnostics.some(diagnostic => diagnostic.code === 'duplicateChordDefinition'));
    assert.ok(!computeCodeActionHints(duplicate, duplicateScore).some(hint => hint.kind === 'unusedChordDefinition'),
      'the first definition participating in a duplicate warning receives no unused hint');
    const firstDefinition = duplicateScore.sourceDefinitions?.find(definition => definition.kind === 'chord');
    assert.ok(firstDefinition);
    assert.strictEqual(planMusicCodeAction(duplicate, duplicateScore, { kind: 'removeUnusedChordDefinition', line: firstDefinition!.line }).ok, false,
      'a duplicate chord key cannot be deleted automatically');

    const invalid = '| not-a-chord |\n';
    assert.deepStrictEqual(computeCodeActionHints(invalid, parseGuitarDsl(invalid)), [], 'parser errors suppress both Hints');

    const manyUnused = `${Array.from({ length: 41 }, (_, index) => `chord C@unused${index} = x32010`).join('\n')}\n| C |\n`;
    assert.strictEqual(computeCodeActionHints(manyUnused, score(manyUnused)).length, 40, 'diagnostics remain capped at 40');
  });

  it('bounds repeated-fragment analysis to 3,000 tokens with many distinct windows', () => {
    const build = (texts: string[]): { source: string; tokens: SelectedToken[] } => {
      let source = '';
      const tokens: SelectedToken[] = [];
      for (const [index, text] of texts.entries()) {
        if (index > 0) source += ' ';
        const start = source.length;
        source += text;
        tokens.push({
          token: { line: 0, startCol: start, endCol: source.length, text, kind: 'rhythm', cellId: 'cell' },
          span: { start, end: source.length }
        });
      }
      return { source, tokens };
    };
    const distinct = build(Array.from({ length: MAX_REPEATED_FRAGMENT_TOKENS }, (_, index) => `token${index}`));
    assert.deepStrictEqual(analyzeRepeatedFragmentTokens(distinct.source, distinct.tokens), [],
      'many distinct windows are indexed without finding a false repetition');

    const tail = build([
      ...Array.from({ length: MAX_REPEATED_FRAGMENT_TOKENS }, (_, index) => `unique${index}`),
      'late-a', 'late-b', 'late-c', 'late-d', 'late-a', 'late-b', 'late-c', 'late-d'
    ]);
    assert.deepStrictEqual(analyzeRepeatedFragmentTokens(tail.source, tail.tokens), [],
      'repetitions beyond the document token cap are not analyzed');
  });
});
