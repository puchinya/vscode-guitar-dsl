import * as assert from 'assert';
import { DiagnosticCode, eventPitches, parseGuitarDsl, rhythmItemBeats } from '../../src/compiler';
import { fnum } from '../../src/duration';

// `let` fragments (spec §17) and simultaneous note groups (spec §18).

function codes(dsl: string): DiagnosticCode[] {
  return parseGuitarDsl(dsl).diagnostics.map(d => d.code);
}

function diag(dsl: string, code: DiagnosticCode) {
  return parseGuitarDsl(dsl).diagnostics.filter(d => d.code === code);
}

const pitchText = (e: { pitch?: { step: string; alter: number; octave: number }; pitches?: { step: string; alter: number; octave: number }[] }) =>
  eventPitches(e).map(p => `${p.step}${p.alter === 1 ? '#' : p.alter === -1 ? 'b' : ''}${p.octave}`).join(',');

describe('let fragments - definitions and references', () => {
  it('resolves a forward reference to the same rhythm AST as the inlined form (1, 15)', () => {
    const score = parseGuitarDsl(['| C | $groove |', 'let groove = 8.d 8.u 4.d 8.d 8.u 4.d'].join('\n'));
    const inline = parseGuitarDsl('| C | 8.d 8.u 4.d 8.d 8.u 4.d |');
    assert.deepStrictEqual(score.diagnostics, []);
    assert.strictEqual(score.measures.length, 1);
    assert.deepStrictEqual(score.measures[0].rhythms, inline.measures[0].rhythms);
    assert.deepStrictEqual(score.measures[0].chords, inline.measures[0].chords);
  });

  it('expands nested references in order with the right beat positions (2)', () => {
    const score = parseGuitarDsl([
      'let downUp = 8.d 8.u',
      'let motif = e4/8 g a g',
      'let verse = $downUp $motif $downUp',
      '| C | $verse |'
    ].join('\n'));
    assert.deepStrictEqual(score.diagnostics.map(d => d.code), []);
    const rhythms = score.measures[0].rhythms;
    assert.deepStrictEqual(rhythms.map(r => pitchText(r) || (r.down ? 'd' : r.up ? 'u' : '?')), ['d', 'u', 'e4', 'g4', 'a4', 'g4', 'd', 'u']);
    let beat = 0;
    const starts = rhythms.map(r => {
      const at = beat;
      beat += fnum(rhythmItemBeats(r));
      return at;
    });
    assert.deepStrictEqual(starts, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  });

  it('clones the events of every use (3)', () => {
    const score = parseGuitarDsl(['let riff = e4/8 g a g 2.d', '| C | $riff |', '| G | $riff |'].join('\n'));
    const [a, b] = score.measures;
    assert.deepStrictEqual(a.rhythms, b.rhythms);
    assert.notStrictEqual(a.rhythms[0], b.rhythms[0]);
    a.rhythms[0].pitch!.octave = 7;
    a.rhythms[4].down = false;
    assert.strictEqual(b.rhythms[0].pitch!.octave, 4);
    assert.strictEqual(b.rhythms[4].down, true);
    const again = parseGuitarDsl(['let riff = e4/8 g a g 2.d', '| C | $riff |'].join('\n'));
    assert.strictEqual(again.measures[0].rhythms[0].pitch!.octave, 4);
  });

  it('uses a note-only fragment in both measure and mel: cells (4)', () => {
    const score = parseGuitarDsl(['let riff = e4/8 g a g', '| C | $riff 2.d |', 'mel: | $riff r/2 |'].join('\n'));
    assert.deepStrictEqual(score.diagnostics, []);
    assert.deepStrictEqual(score.measures[0].rhythms.slice(0, 4).map(pitchText), ['e4', 'g4', 'a4', 'g4']);
    assert.deepStrictEqual(score.measures[0].melody!.map(pitchText), ['e4', 'g4', 'a4', 'g4', '']);
  });

  it('accepts a rhythm + note fragment in a measure (5)', () => {
    const score = parseGuitarDsl(['let picking = 8.d c4/8 e g 8.u', '| C | $picking 4.d 4.d 4.d |'].join('\n'));
    assert.deepStrictEqual(score.diagnostics.map(d => d.code), ['beatCountMismatch']);
    const ok = parseGuitarDsl(['let picking = 8.d c4/8 e g 8.u', '| C | $picking 4.d 8.d |'].join('\n'));
    assert.deepStrictEqual(ok.diagnostics, []);
    assert.deepStrictEqual(ok.measures[0].rhythms.map(r => pitchText(r) || 'slash'), ['slash', 'c4', 'e4', 'g4', 'slash', 'slash', 'slash']);
  });

  it('rejects a rhythm fragment in a mel: cell at the reference (6)', () => {
    const dsl = ['let picking = 8.d c4/8 e g 8.u', '| C |', 'mel: | $picking |'].join('\n');
    const d = diag(dsl, 'variableContextMismatch');
    assert.strictEqual(d.length, 1);
    assert.deepStrictEqual([d[0].line, d[0].startCol, d[0].endCol], [2, 7, 15]);
    assert.deepStrictEqual(codes(dsl), ['variableContextMismatch']);
  });

  it('rejects a melody-rest fragment in a measure cell (7)', () => {
    const dsl = ['let breath = r/4 e4/4', '| C | $breath 2.d |'].join('\n');
    const d = diag(dsl, 'variableContextMismatch');
    assert.strictEqual(d.length, 1);
    assert.deepStrictEqual([d[0].line, d[0].startCol], [1, 6]);
    assert.strictEqual(d[0].args!.context, 'measure');
  });

  it('reports a duplicate on the later definition and keeps the first (8)', () => {
    const score = parseGuitarDsl(['let g = 4.d 4.d 4.d 4.d', 'let g = 2.d 2.d', '| C | $g |'].join('\n'));
    assert.deepStrictEqual(score.diagnostics.map(d => [d.code, d.line, d.startCol]), [['duplicateVariable', 1, 4]]);
    assert.strictEqual(score.measures[0].rhythms.length, 4);
  });

  it('reports unknown references at the $name (9)', () => {
    const inDef = diag(['let a = 4.d $missing', '| C | $a 2.d 4.d |'].join('\n'), 'unknownVariable');
    assert.deepStrictEqual(inDef.map(d => [d.line, d.startCol, d.endCol]), [[0, 12, 20]]);
    const inMeasure = diag('| C 4.d $nope 2.d |', 'unknownVariable');
    assert.deepStrictEqual(inMeasure.map(d => [d.line, d.startCol, d.endCol]), [[0, 8, 13]]);
    const inMel = diag('| C |\nmel: | c4/2 $nope |', 'unknownVariable');
    assert.deepStrictEqual(inMel.map(d => [d.line, d.startCol, d.endCol]), [[1, 12, 17]]);
    // An invalid definition is not expanded and its uses add no cascading diagnostic.
    assert.deepStrictEqual(codes(['let a = 4.d $missing', '| C | $a |', '| C | $a |'].join('\n')), ['unknownVariable']);
  });

  it('terminates on direct and indirect cycles (10)', () => {
    assert.deepStrictEqual(diag('let a = $a 4.d\n| C | $a |', 'cyclicVariableReference').map(d => [d.line, d.startCol]), [[0, 8]]);
    const indirect = parseGuitarDsl(['let a = 4.d $b', 'let b = $c', 'let c = $a', '| C | $a |'].join('\n'));
    assert.deepStrictEqual(indirect.diagnostics.map(d => [d.code, d.line]), [['cyclicVariableReference', 2]]);
    assert.deepStrictEqual(parseGuitarDsl(['let a = 4.d $b', 'let b = $c', 'let c = $a', '| C | $a |'].join('\n')).diagnostics, indirect.diagnostics);
  });

  it('rejects % in a definition and keeps % as the contextual repeat (11)', () => {
    assert.deepStrictEqual(diag('let r = %', 'invalidVariableValue').map(d => d.args!.reason), ['percent']);
    assert.deepStrictEqual(diag('let r = 4.d %', 'invalidVariableValue').length, 1);
    const score = parseGuitarDsl(['let g = 4.d 4.u 4.d 4.u', '| C | $g |', '| G | % |'].join('\n'));
    assert.deepStrictEqual(score.diagnostics, []);
    assert.strictEqual(score.measures[1].isMeasureRepeat, true);
  });

  it('requires the first note of a definition to set octave and length (12)', () => {
    assert.ok(codes('let bad = e g').includes('missingInitialOctaveOrLength'));
    assert.ok(codes('let bad = e/8 g').includes('missingInitialOctaveOrLength'));
    assert.ok(codes('let bad = e4 g').includes('missingInitialOctaveOrLength'));
    assert.deepStrictEqual(codes('let ok = e4/8 g'), []);
  });

  it('isolates the fragment from the caller inheritance (13)', () => {
    const score = parseGuitarDsl(['let riff = e4/8 g a g', '| C |', 'mel: | c5/4 $riff b |'].join('\n'));
    assert.deepStrictEqual(score.diagnostics, []);
    const mel = score.measures[0].melody!;
    assert.deepStrictEqual(mel.map(n => `${pitchText(n)}/${n.parts[0].base}`), ['c5/4', 'e4/8', 'g4/8', 'a4/8', 'g4/8', 'b5/4']);
    // In a measure the bar's own inline state (default octave 4) is not changed by the fragment either.
    const inline = parseGuitarDsl(['let hi = c6/4', '| C c5/8 $hi d 2.d |'].join('\n'));
    assert.deepStrictEqual(inline.measures[0].rhythms.map(pitchText).slice(0, 3), ['c5', 'c6', 'd5']);
  });

  it('strips an inline comment only after whitespace (14)', () => {
    const score = parseGuitarDsl(['let riff = f#4/8 g a b  # intro phrase', '| C |', 'mel: | $riff r/2 |'].join('\n'));
    assert.deepStrictEqual(score.diagnostics, []);
    assert.deepStrictEqual(score.measures[0].melody!.map(pitchText), ['f#4', 'g4', 'a4', 'b4', '']);
    assert.deepStrictEqual(codes('let x = 4.d#comment'), ['invalidVariableValue']);
  });

  it('checks beats at the consuming cell, not the definition (16)', () => {
    assert.deepStrictEqual(codes('let half = 4.d 4.u'), []);
    const d = diag(['let half = 4.d 4.u', '| C | $half |'].join('\n'), 'beatCountMismatch');
    assert.deepStrictEqual(d.map(x => [x.line, x.args!.beats]), [[1, '2']]);
    assert.deepStrictEqual(codes(['let half = e4/4 g', '| C |', 'mel: | $half |'].join('\n')), ['beatCountMismatch']);
  });

  it('never changes measures, sections or the melody cursor', () => {
    const score = parseGuitarDsl(['[A]', '| C |', 'let x = 4.d 4.d 4.d 4.d', '| G |', 'mel: | c4/1 | d4/1 |'].join('\n'));
    assert.deepStrictEqual(score.diagnostics, []);
    assert.strictEqual(score.measures.length, 2);
    assert.strictEqual(score.measures[1].sectionName, '');
    assert.strictEqual(score.firstBodyLine, 0);
    assert.strictEqual(parseGuitarDsl('let x = 4.d\n| C |').firstBodyLine, 1);
  });

  it('rejects malformed declarations without other parsing', () => {
    for (const line of ['let basic8: rhythm = 4.d', 'let riff: melody = e4/8', 'let = 4.d', 'let x =', 'let 1x = 4.d', 'let x 4.d']) {
      const score = parseGuitarDsl(line);
      assert.deepStrictEqual(score.diagnostics.map(d => d.code), ['invalidLetDefinition'], line);
      assert.strictEqual(score.measures.length, 0, line);
    }
  });

  it('keeps fragments self-contained (spec §17.5)', () => {
    const reasons = (dsl: string) => diag(dsl, 'invalidVariableValue').map(d => d.args!.reason);
    assert.deepStrictEqual(reasons('let t = e4/4~'), ['openTie']);
    assert.deepStrictEqual(reasons('let h = e4/4{hammer}'), ['danglingConnection']);
    assert.deepStrictEqual(reasons('let g = e4/8 d4/8{grace}'), ['danglingGrace']);
    assert.deepStrictEqual(reasons('let s = e4/4{slur-start} f'), ['openSlur']);
    assert.deepStrictEqual(reasons('let s = e4/4 f{slur-end}'), ['unmatchedSlurEnd']);
    assert.deepStrictEqual(codes('let ok = e4/4{hammer} f4/4{slur-start} g4/8{grace} a4/4{slur-end} b4/4~ b4/4'), []);
    // A caller connection may target the first note of the fragment.
    assert.deepStrictEqual(codes(['let f = e4/4 f g a', '| C |', 'mel: | $f |', '| C |', 'mel: | d4/2{hammer} $x |'].join('\n')), ['unknownVariable', 'danglingTechnique']);
    assert.deepStrictEqual(codes(['let f = e4/4 f g', '| C |', 'mel: | d4/4{hammer} $f |'].join('\n')), []);
  });

  it('scopes definitions to one parse call', () => {
    parseGuitarDsl('let only = 4.d 4.d 4.d 4.d');
    assert.deepStrictEqual(codes('| C | $only |'), ['unknownVariable']);
  });
});

describe('note groups', () => {
  it('parses a triad as one event of one beat (17)', () => {
    const score = parseGuitarDsl('| C |\nmel: | [c4,e4,g4]/4 r/2. |');
    const note = score.measures[0].melody![0];
    assert.deepStrictEqual(score.diagnostics, []);
    assert.strictEqual(score.measures[0].melody!.length, 2);
    assert.strictEqual(note.pitch, undefined);
    assert.strictEqual(pitchText(note), 'c4,e4,g4');
    assert.strictEqual(fnum(note.beats), 1);
  });

  it('works in mel: and as an inline measure note (18)', () => {
    const score = parseGuitarDsl(['| C [c4,e4,g4]/2 [d4,f4,a4]/2 |', 'mel: | [c4,e4,g4]/2 [d4,f4,a4]/2 |'].join('\n'));
    assert.deepStrictEqual(score.diagnostics, []);
    const [a, b] = score.measures[0].rhythms;
    assert.deepStrictEqual([pitchText(a), a.duration, a.pitch], ['c4,e4,g4', '2', undefined]);
    assert.strictEqual(pitchText(b), 'd4,f4,a4');
    assert.deepStrictEqual(score.measures[0].melody!.map(pitchText), ['c4,e4,g4', 'd4,f4,a4']);
    // Groups do not take part in the single-note inheritance.
    const inherit = parseGuitarDsl('| C |\nmel: | e5/8 [c4,e4]/2 f g a |');
    assert.deepStrictEqual(inherit.measures[0].melody!.map(pitchText), ['e5', 'c4,e4', 'f5', 'g5', 'a5']);
  });

  it('rejects malformed groups (19)', () => {
    const cases: [string, DiagnosticCode][] = [
      ['[c4,e]/4', 'invalidNoteGroup'],
      ['[c4,e4]', 'invalidNoteGroup'],
      ['[c4]/4', 'invalidNoteGroup'],
      ['[c4,c4]/4', 'invalidNoteGroup'],
      ['[c4,E4]/4', 'upperCaseNoteName'],
      ['[c4,e4/4', 'invalidNoteGroup'],
      ['[c4,e4]]/4', 'invalidNoteGroup'],
      ['[c4,e4]/5', 'invalidLength']
    ];
    for (const [tok, code] of cases) {
      assert.deepStrictEqual(codes(`| C |\nmel: | ${tok} r/2. |`).filter(c => c !== 'beatCountMismatch'), [code], `mel ${tok}`);
      assert.deepStrictEqual(codes(`| C ${tok} 2.d 4.d |`).filter(c => c !== 'beatCountMismatch'), [code], `inline ${tok}`);
    }
    assert.ok(codes('| C |\nmel: | [c4, e4]/4 r/2. |').includes('invalidNoteGroup'));
  });

  it('allows group-level techniques only (20)', () => {
    for (const t of ['vibrato', 'staccato', 'tenuto', 'fermata', 'breath', 'pm', 'let-ring', 'staccato,tenuto']) {
      const score = parseGuitarDsl(`| C |\nmel: | [c4,e4]/4{${t}} r/2. |`);
      assert.deepStrictEqual(score.diagnostics, [], t);
    }
    for (const t of ['hammer', 'pull', 'slide', 'gliss', 'bend:1', 'slur-start', 'slur-end']) {
      assert.deepStrictEqual(codes(`| C |\nmel: | [c4,e4]/4{${t}} r/2. |`).filter(c => c !== 'beatCountMismatch'), ['unsupportedNoteGroupTechnique'], t);
    }
    assert.deepStrictEqual(codes('| C |\nmel: | [c4,e4]/2~ [c4,e4]/2 |').filter(c => c !== 'beatCountMismatch'), ['unsupportedNoteGroupTechnique']);
  });

  it('uses the exact rational length of tuplets and compound lengths (21)', () => {
    const score = parseGuitarDsl('| C |\nmel: | [c4,e4]/8{5:4} [c4,e4]/4+16 [c4,e4]/8. |');
    const [a, b, c] = score.measures[0].melody!;
    assert.deepStrictEqual([a.beats, b.beats, c.beats], [{ n: 2, d: 5 }, { n: 5, d: 4 }, { n: 3, d: 4 }]);
    const inline = parseGuitarDsl('| C [c4,e4]/4+16 [c4,e4]/8{3:2} |');
    assert.deepStrictEqual(inline.measures[0].rhythms.map(r => r.duration), ['4+16', '8t']);
  });

  it('takes one syllable per group (22)', () => {
    const score = parseGuitarDsl('| C |\nmel: | [c4,e4,g4]/2 [d4,f4]/4 e4/4 |\nlyr: あ い う');
    assert.deepStrictEqual(score.diagnostics, []);
    assert.deepStrictEqual(score.measures[0].melody!.map(n => n.syllables[0]?.text), ['あ', 'い', 'う']);
  });

  it('gives a grace group zero beats (23)', () => {
    const score = parseGuitarDsl('| C [c4,e4]/8{grace} c4/1 |\nmel: | [d4,f4]/16{grace} e4/1 |');
    assert.deepStrictEqual(score.diagnostics, []);
    assert.strictEqual(fnum(score.measures[0].melody![0].beats), 0);
    assert.strictEqual(fnum(rhythmItemBeats(score.measures[0].rhythms[0])), 0);
  });

  it('never connects a single note to a group member (24)', () => {
    for (const t of ['hammer', 'pull', 'slide', 'gliss']) {
      assert.deepStrictEqual(codes(`| C |\nmel: | c4/2{${t}} [d4,f4]/2 |`), ['danglingTechnique'], `mel ${t}`);
      assert.deepStrictEqual(codes(`| C c4/2{${t}} [d4,f4]/2 |`), ['danglingTechnique'], `inline ${t}`);
    }
    assert.deepStrictEqual(codes('| C |\nmel: | c4/2~ [c4,e4]/2 |'), ['unsupportedNoteGroupTechnique']);
    assert.deepStrictEqual(codes('| C c4/2~ [c4,e4]/2 |'), ['unsupportedNoteGroupTechnique']);
    assert.deepStrictEqual(codes('let t = c4/2~ [c4,e4]/2'), ['unsupportedNoteGroupTechnique']);
    const tied = parseGuitarDsl('| C |\nmel: | c4/2~ [c4,e4]/2 |\nlyr: あ い');
    assert.strictEqual(tied.measures[0].melody![1].tiedFromPrev, false);
  });

  it('keeps [Intro] and volta brackets out of note groups', () => {
    const score = parseGuitarDsl(['[Intro]', '|: C | G |', '|[1] C :|'].join('\n'));
    assert.deepStrictEqual(score.diagnostics, []);
    assert.strictEqual(score.measures[0].sectionName, 'Intro');
  });

  it('can be reused through let and matches the inlined group', () => {
    const viaLet = parseGuitarDsl(['let hit = [c4,e4,g4]/4', '| C | $hit $hit 2.d |', 'mel: | $hit $hit r/2 |'].join('\n'));
    const inline = parseGuitarDsl(['| C | [c4,e4,g4]/4 [c4,e4,g4]/4 2.d |', 'mel: | [c4,e4,g4]/4 [c4,e4,g4]/4 r/2 |'].join('\n'));
    assert.deepStrictEqual(viaLet.diagnostics, []);
    assert.deepStrictEqual(viaLet.measures.map(m => [m.rhythms, m.melody]), inline.measures.map(m => [m.rhythms, m.melody]));
  });
});

describe('let fragments - source spans (25)', () => {
  it('lists definition pitches once and expands every use', () => {
    const score = parseGuitarDsl(['let riff = e4/8 g a [c4,e4]/8', '| C | $riff 2.d |', '| C | $riff 2.d |', '| C | $riff 2.d |'].join('\n'));
    assert.deepStrictEqual(score.diagnostics, []);
    assert.deepStrictEqual(score.pitchTokens!.map(t => [t.line, t.startCol, t.endCol, t.kind]), [
      [0, 11, 13, 'fragment'],
      [0, 16, 17, 'fragment'],
      [0, 18, 19, 'fragment'],
      [0, 21, 23, 'group'],
      [0, 24, 26, 'group']
    ]);
    assert.strictEqual(score.measures.filter(m => m.rhythms.length === 5).length, 3);
  });
});

describe('samples/sample_variables.guitardsl', () => {
  it('parses without diagnostics and uses every fragment kind', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const score = parseGuitarDsl(fs.readFileSync(path.join(__dirname, '../../samples/sample_variables.guitardsl'), 'utf8'));
    assert.deepStrictEqual(score.diagnostics, []);
    assert.strictEqual(score.measures.length, 8);
    assert.ok(score.measures.some(m => m.rhythms.some(r => r.pitches)));
    assert.ok(score.measures.some(m => m.melody?.some(n => n.pitches)));
  });
});

describe('PR #73 review fixes', () => {
  it('A-1: a tie inside a fragment needs a single pitched note right after it', () => {
    const bad = diag('let bad = e4/4~ r/4', 'invalidVariableValue');
    assert.deepStrictEqual(bad.map(d => [d.args!.reason, d.startCol]), [['tieTarget', 10]]);
    assert.deepStrictEqual(codes('let bad = e4/4~ [e4,g4]/4'), ['unsupportedNoteGroupTechnique']);
    assert.deepStrictEqual(codes('let ok = e4/4~ e4/4'), []);
    // An invalid definition is not expanded.
    assert.deepStrictEqual(codes(['let bad = e4/4~ r/4', '| C |', 'mel: | $bad r/2 |'].join('\n')), ['invalidVariableValue']);
  });

  it('A-3: the first pitched single note sets its own octave and length even after a rest or a group', () => {
    assert.deepStrictEqual(codes('let bad = r/4 e4'), ['missingInitialOctaveOrLength']);
    assert.deepStrictEqual(codes('let bad = r/4 e/8'), ['missingInitialOctaveOrLength']);
    assert.deepStrictEqual(codes('let bad = [c4,e4]/4 g4'), ['missingInitialOctaveOrLength']);
    assert.deepStrictEqual(codes('let ok = r/4 e4/4'), []);
    assert.deepStrictEqual(codes('let ok = r/4 e4/4 g a'), []);
    // A leading grace note is the first pitched single note: it writes its own octave and length too.
    assert.deepStrictEqual(codes('let bad = d4{grace} e4/4'), ['missingInitialOctaveOrLength']);
    assert.deepStrictEqual(codes('let ok = d4/8{grace} e4/4'), []);
  });
});
