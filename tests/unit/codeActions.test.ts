import * as assert from 'assert';
import { computeCodeActionHints, planMusicCodeAction } from '../../src/codeActions';
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
    const source = 'key: C\n| C 4.d 4.d 8.u |\n';
    const start = source.indexOf('4.d');
    const end = source.lastIndexOf('4.d') + '4.d'.length;
    const extracted = plan(source, 'extractLet', start, end);
    assert.ok(extracted.ok, extracted.ok ? '' : extracted.code);
    assert.match(extracted.text, /let fragment1 = 4\.d 4\.d/);
    assert.match(extracted.text, /\$fragment1/);

    const withReference = 'let riff = 4.d 4.d\nkey: C\n| C $riff |\n';
    const refStart = withReference.indexOf('$riff');
    const inlined = plan(withReference, 'inlineLet', refStart, refStart + '$riff'.length);
    assert.ok(inlined.ok, inlined.ok ? '' : inlined.code);
    assert.match(inlined.text, /\| C 4\.d 4\.d \|/);
    assert.ok(!inlined.text.includes('$riff'));

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
  });

  it('doubles and halves explicit durations while preserving stroke modifiers and exact beat notation', () => {
    const source = '| C 4.d 8.u |\n';
    const start = source.indexOf('4.d');
    const end = source.indexOf('8.u') + '8.u'.length;
    const doubled = plan(source, 'doubleDuration', start, end);
    assert.ok(doubled.ok, doubled.ok ? '' : doubled.code);
    assert.strictEqual(doubled.text, '| C 2.d 4.u |\n');
    const halved = plan(source, 'halveDuration', start, end);
    assert.ok(halved.ok, halved.ok ? '' : halved.code);
    assert.strictEqual(halved.text, '| C 8.d 16.u |\n');

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
  });
});
