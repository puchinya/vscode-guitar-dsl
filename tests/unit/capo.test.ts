import * as assert from 'assert';
import { NOTE_NAMES } from '../../src/chordDetect';
import { getDefaultVoicing } from '../../src/chordPresets';
import { parseGuitarDsl } from '../../src/compiler';
import { compileGuitarDslToHtml } from '../../src/render/previewHtml';
import {
  UNKNOWN_CHORD_COST,
  buildCapoPreviewUiModel,
  inferCapoForDsl,
  chordCost,
  easeScore,
  evaluatePlayability,
  inferCapo,
  inferCapoFromDsl,
  levelForScore,
  parseCapoValue,
  planCapoTransform,
  resolveEffectiveDsl,
  transposeChordName
} from '../../src/capo';

function planText(dsl: string, target: number): string {
  const plan = planCapoTransform(dsl, target);
  assert.ok(plan.ok, `expected transform to succeed: ${JSON.stringify(plan)}`);
  return plan.text;
}

describe('capo - generic inference (standalone API)', () => {
  it('INF-01 evaluates capo 0..12 from structured chords and recommends deterministically', () => {
    const input = { sourceCapo: 0, chords: [{ name: 'B', count: 8 }, { name: 'E', count: 8 }, { name: 'F#', count: 4 }] };
    const a = inferCapo(input);
    const b = inferCapo(input);
    assert.deepStrictEqual(a.candidates.map(c => c.capo), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.ok(a.candidates.every(c => c.supported && c.playability));
    assert.strictEqual(a.recommendedCapo, b.recommendedCapo);
    const best = Math.max(...a.candidates.map(c => c.playability!.score));
    const firstBest = a.candidates.find(c => c.playability!.score === best)!.capo;
    assert.strictEqual(a.recommendedCapo, firstBest);
    // Capo 4 turns B / E / F# into G / C / D (all open shapes), which beats capo 0 (barre chords).
    assert.ok(a.candidates[4].playability!.score > a.candidates[0].playability!.score);
    assert.strictEqual(a.candidates[2].chordMap.get('B'), 'A');
    assert.strictEqual(a.candidates[4].chordMap.get('F#'), 'D');
  });

  it('INF-02 weights chord cost by occurrence count', () => {
    const mostlyOpen = evaluatePlayability({ sourceCapo: 0, chords: [{ name: 'C', count: 10 }, { name: 'F', count: 1 }] }, 0)!;
    const mostlyBarre = evaluatePlayability({ sourceCapo: 0, chords: [{ name: 'C', count: 1 }, { name: 'F', count: 10 }] }, 0)!;
    assert.ok(mostlyOpen.score > mostlyBarre.score, `${mostlyOpen.score} > ${mostlyBarre.score}`);
  });

  it('INF-03 recommends the lower capo on an exact tie', () => {
    // C13 has no known voicing at any transposition: every candidate scores 0.
    const r = inferCapo({ sourceCapo: 0, chords: [{ name: 'C13' }] });
    assert.ok(r.candidates.every(c => c.playability?.score === 0));
    assert.strictEqual(r.recommendedCapo, 0);
  });

  it('rejects an invalid source capo instead of normalizing it', () => {
    assert.throws(() => inferCapo({ sourceCapo: 13, chords: [{ name: 'C' }] }), RangeError);
    assert.throws(() => inferCapo({ sourceCapo: 1.5, chords: [{ name: 'C' }] }), RangeError);
    assert.throws(() => evaluatePlayability({ sourceCapo: 0, chords: [{ name: 'C' }] }, -1), RangeError);
  });

  it('marks labeled variants unsupported away from the source capo', () => {
    const r = inferCapo({ sourceCapo: 0, chords: [{ name: 'C@barre' }, { name: 'G' }] });
    assert.ok(r.candidates[0].supported);
    assert.ok(r.candidates.slice(1).every(c => !c.supported && c.reason === 'labeledChordVariant'));
    assert.strictEqual(r.recommendedCapo, 0);
  });
});

describe('capo - chord transposition', () => {
  it('CAPO-01 root: B -2 -> A', () => assert.strictEqual(transposeChordName('B', -2), 'A'));
  it('CAPO-02 suffix: F#m7 -2 -> Em7', () => assert.strictEqual(transposeChordName('F#m7', -2), 'Em7'));
  it('CAPO-03 slash: E/G# -2 -> D/F#', () => assert.strictEqual(transposeChordName('E/G#', -2), 'D/F#'));

  it('CAPO-04 spells every generated pitch class with NOTE_NAMES', () => {
    for (let pc = 0; pc < 12; pc++) {
      for (let shift = 1; shift < 12; shift++) {
        const out = transposeChordName(`${NOTE_NAMES[pc]}m7/${NOTE_NAMES[pc]}`, shift)!;
        const m = out.match(/^([A-G][b#]?)m7\/([A-G][b#]?)$/)!;
        assert.strictEqual(m[1], NOTE_NAMES[(pc + shift) % 12]);
        assert.strictEqual(m[2], NOTE_NAMES[(pc + shift) % 12]);
      }
    }
    assert.strictEqual(transposeChordName('Db', 2), 'Eb');
    assert.strictEqual(transposeChordName('A#', 1), 'B');
    assert.strictEqual(transposeChordName('Cmaj7', 0), 'Cmaj7');
    assert.strictEqual(transposeChordName('N.C.', 2), null);
  });
});

describe('capo - playability formula', () => {
  it('PLAY-01 exact chord costs', () => {
    assert.strictEqual(chordCost(getDefaultVoicing('C'), false), 1.5); // open: 3 fretted
    assert.strictEqual(chordCost(getDefaultVoicing('F'), false), 7); // 6 fretted + barre + no open
    assert.strictEqual(chordCost({ frets: ['x', 7, 9, 9, 9, 7], barres: [] }, false), 5); // high closed
    assert.strictEqual(chordCost({ frets: [5, 'x', 'x', 9, 'x', 'x'], barres: [] }, false), 4.5); // wide span
    assert.strictEqual(chordCost(getDefaultVoicing('D/F#'), true), 3); // slash
    assert.strictEqual(chordCost(undefined, false), UNKNOWN_CHORD_COST);
    assert.strictEqual(UNKNOWN_CHORD_COST, 10);
  });

  it('PLAY-01 song cost adds vocabulary and capo penalties; slash falls back to the upper chord', () => {
    // C (1.5) at capo 0 -> 85
    assert.strictEqual(evaluatePlayability({ sourceCapo: 0, chords: [{ name: 'C' }] }, 0)!.score, 85);
    // Capo 2 keeps C sounding with Bb (5-string barre, cost 6.5) -> 100 - 10 * (6.5 + 0.3) = 32
    const bb = evaluatePlayability({ sourceCapo: 0, chords: [{ name: 'C' }] }, 2)!;
    assert.strictEqual(bb.score, 32);
    // Slash chord without a library entry uses the upper chord shape (Am: 1.5) + slash (1) -> 75
    assert.strictEqual(evaluatePlayability({ sourceCapo: 0, chords: [{ name: 'Am/G' }] }, 0)!.score, 75);
    // Unknown voicing -> 0 and reported
    const unknown = evaluatePlayability({ sourceCapo: 0, chords: [{ name: 'C13' }] }, 0)!;
    assert.strictEqual(unknown.score, 0);
    assert.deepStrictEqual(unknown.unresolvedChords, ['C13']);
    // Vocabulary: 6 unique chords -> mean cost + 0.25 * (6 - 4)
    const names = ['C', 'G', 'D', 'A', 'E', 'F'];
    const mean = names.reduce((sum, n) => sum + chordCost(getDefaultVoicing(n), false), 0) / names.length;
    const vocab = evaluatePlayability({ sourceCapo: 0, chords: names.map(name => ({ name })) }, 0)!;
    assert.strictEqual(vocab.score, easeScore(mean + 0.5));
    assert.strictEqual(vocab.score, 71); // mean (1.5 * 5 + 7) / 6 = 2.4167, + 0.5 -> 70.83

  });

  it('PLAY-02 level thresholds', () => {
    const cases: [number, string][] = [[85, 'veryEasy'], [84, 'easy'], [70, 'easy'], [69, 'moderate'], [50, 'moderate'], [49, 'hard'], [30, 'hard'], [29, 'veryHard'], [100, 'veryEasy'], [0, 'veryHard']];
    for (const [score, level] of cases) assert.strictEqual(levelForScore(score), level, String(score));
    assert.strictEqual(easeScore(1.5), 85);
    assert.strictEqual(easeScore(1.6), 84);
    assert.strictEqual(easeScore(3.0), 70);
    assert.strictEqual(easeScore(3.1), 69);
    assert.strictEqual(easeScore(5.0), 50);
    assert.strictEqual(easeScore(5.1), 49);
    assert.strictEqual(easeScore(7.0), 30);
    assert.strictEqual(easeScore(7.1), 29);
    assert.strictEqual(easeScore(-3), 100);
    assert.strictEqual(easeScore(20), 0);
  });

  it('PLAY-03 no chord occurrences -> playability unavailable', () => {
    assert.strictEqual(evaluatePlayability({ sourceCapo: 0, chords: [] }, 0), null);
    assert.strictEqual(evaluatePlayability({ sourceCapo: 0, chords: [{ name: 'C', count: 0 }] }, 0), null);
    const r = inferCapo({ sourceCapo: 0, chords: [] });
    assert.ok(r.candidates.every(c => c.playability === undefined));
    assert.strictEqual(r.recommendedCapo, undefined);
  });

  it('scores the current capo with custom voicings but other capos with standard shapes', () => {
    const dsl = 'chord C = x35553\n| C | C | C | C |\n';
    const r = inferCapoFromDsl(dsl);
    // Custom closed C at capo 0: 5 fretted (2.5) + span 2 + minFret 3 + no open (1.5) = 4.0 -> 60
    // (the default open C would score 85).
    assert.strictEqual(r.candidates[0].playability!.score, 60);
    assert.strictEqual(r.candidates[5].chordMap.get('C'), 'G');
    assert.strictEqual(r.candidates[5].playability!.score, easeScore(1.5 + 0.75));
  });
});

describe('capo - GuitarDSL source transformation', () => {
  it('CAPO-05 applies the source capo delta and keeps the key', () => {
    const out = planText('capo: 3\nkey: Eb\n| C | Bb |\n', 5);
    assert.strictEqual(out, 'capo: 5\nkey: Eb\n| Bb | Ab |\n');
    assert.strictEqual(planText('capo: 5\nkey: Eb\n| Bb |\n', 3), 'capo: 3\nkey: Eb\n| C |\n');
  });

  it('CAPO-06 inserts a missing capo header before key/bpm and transforms from capo 0', () => {
    assert.strictEqual(planText('title: T\nkey: B\n| B |\n', 2), 'title: T\ncapo: 2\nkey: B\n| A |\n');
    assert.strictEqual(planText('title: T\n\n[A]\n| B |\n', 2), 'title: T\n\ncapo: 2\n[A]\n| A |\n');
    assert.strictEqual(planText('| B |', 2), 'capo: 2\n| A |');
  });

  it('CAPO-07 applying capo 0 writes an explicit header', () => {
    assert.strictEqual(planText('capo: 2\n| A |\n', 0), 'capo: 0\n| B |\n');
    assert.strictEqual(planText('| C |\n', 0), 'capo: 0\n| C |\n');
  });

  it('CAPO-08 preserves every other byte, including CRLF, comments, melody, lyrics and repeats', () => {
    const source = [
      '# comment: B E F#',
      'title: Sample  ',
      'key: B',
      'bpm: 100',
      '',
      '[Intro]',
      '|  B  | F#m7:2   E/G#:2 |',
      '|: B 4.d 4.u 4.d 4.u l:"B la" | % :|',
      'mel: | b4/4 c#5 d#5 e5 | f#5/1 |',
      'lyr: あ い う え | お',
      '---',
      '| E/2 B/2 |]',
      ''
    ].join('\r\n');
    const expected = [
      '# comment: B E F#',
      'title: Sample  ',
      'capo: 2',
      'key: B',
      'bpm: 100',
      '',
      '[Intro]',
      '|  A  | Em7:2   D/F#:2 |',
      '|: A 4.d 4.u 4.d 4.u l:"B la" | % :|',
      'mel: | b4/4 c#5 d#5 e5 | f#5/1 |',
      'lyr: あ い う え | お',
      '---',
      '| D/2 A/2 |]',
      ''
    ].join('\r\n');
    assert.strictEqual(parseGuitarDsl(source).diagnostics.filter(d => d.severity === 'error').length, 0);
    assert.strictEqual(planText(source, 2), expected);
  });

  it('CAPO-09 keeps chord length suffixes byte-identical', () => {
    assert.strictEqual(planText('| C:1.5 G/B/2 Am/4. |\n', 2), 'capo: 2\n| Bb:1.5 F/A/2 Gm/4. |\n');
  });

  it('CAPO-10 rejects labeled variants when the capo changes', () => {
    const dsl = 'chord C@special = x35553\n| C@special | G |\n';
    const plan = planCapoTransform(dsl, 2);
    assert.ok(!plan.ok);
    assert.strictEqual(plan.code, 'labeledChordVariant');
    // Same capo: allowed (only the header is written).
    assert.strictEqual(planText(dsl, 0), 'chord C@special = x35553\ncapo: 0\n| C@special | G |\n');
  });

  it('CAPO-11 rejects a collision with an explicit custom definition and warns about unused ones', () => {
    const collision = planCapoTransform('chord A = x02220\n| B |\n', 2);
    assert.ok(!collision.ok);
    assert.strictEqual(collision.code, 'customDefinitionCollision');
    const plan = planCapoTransform('chord B = x24442\n| B |\n', 2);
    assert.ok(plan.ok);
    assert.deepStrictEqual(plan.warnings, ['unusedChordDefinitions']);
    assert.deepStrictEqual(plan.unusedDefinitions, ['B']);
    assert.ok(plan.text.includes('chord B = x24442'));
  });

  it('transforms each chord when l:"..." precedes chords with the same text (lyric unchanged)', () => {
    assert.strictEqual(planText('| l:"C" C C |\n', 2), 'capo: 2\n| l:"C" Bb Bb |\n');
    assert.strictEqual(planText('| l:"B B" B B |\n', 2), 'capo: 2\n| l:"B B" A A |\n');
  });

  it('CAPO inline comment preservation: only the capo value changes', () => {
    assert.strictEqual(
      planText('capo: 0 # standard position\nkey: B\n| B |\n', 2),
      'capo: 2 # standard position\nkey: B\n| A |\n'
    );
    assert.strictEqual(planText('capo: 0 # 通常位置\r\nkey: B\r\n| B |\r\n', 2), 'capo: 2 # 通常位置\r\nkey: B\r\n| A |\r\n');
    assert.strictEqual(parseGuitarDsl('capo: 3   # comment').capo, '3');
    assert.strictEqual(inferCapoFromDsl('capo: 0 # c\n| B |\n').candidates.length, 13);
    assert.strictEqual(buildCapoPreviewUiModel('capo: 0 # c\n| B |\n', 2).sourceCapo, 0);
  });

  it('CAPO-12 every successful transform reparses without errors', () => {
    const dsl = 'key: G\n| G | Em | C | D7 |\n| Am7 G/B | Cadd9 | Dsus4 | G |\n';
    for (let target = 0; target <= 12; target++) {
      const out = planText(dsl, target);
      const score = parseGuitarDsl(out);
      assert.strictEqual(score.diagnostics.filter(d => d.severity === 'error').length, 0, `capo ${target}`);
      assert.strictEqual(score.capo, String(target));
      assert.strictEqual(score.originalKey, 'G');
    }
  });

  it('rejects invalid source / target capo and source errors', () => {
    const bad = planCapoTransform('capo: 13\n| C |\n', 2);
    assert.ok(!bad.ok && bad.code === 'invalidSourceCapo');
    const badTarget = planCapoTransform('| C |\n', 13);
    assert.ok(!badTarget.ok && badTarget.code === 'invalidTargetCapo');
    const parseError = planCapoTransform('| C |\nmel: | C4/4 |\n', 2);
    assert.ok(!parseError.ok && parseError.code === 'sourceParseError');
    assert.strictEqual(parseCapoValue(' 3 '), 3);
    assert.strictEqual(parseCapoValue('abc'), null);
  });

  it('resolveEffectiveDsl computes each target from the source (no drift)', () => {
    const source = 'key: B\n| B | E | F# | B |\n';
    const steps = [0, 2, 5, 1].map(t => resolveEffectiveDsl(source, t));
    assert.ok(steps.every(s => s.ok));
    assert.strictEqual((steps[0] as { text: string }).text, source);
    assert.strictEqual((steps[3] as { text: string }).text, 'capo: 1\nkey: B\n| Bb | Eb | F | Bb |\n');
    assert.deepStrictEqual(resolveEffectiveDsl(source, undefined), { ok: true, text: source, transformed: false });
  });
});

describe('capo - DSL-backed candidates', () => {
  it('marks candidates that planCapoTransform rejects as unsupported and never recommends them', () => {
    const dsl = 'chord A = x02220\n| B |\n';
    const r = inferCapoForDsl(dsl)!;
    assert.strictEqual(r.candidates[2].supported, false);
    assert.strictEqual(r.candidates[2].reason, 'customDefinitionCollision');
    assert.ok(r.candidates[0].supported, 'the source capo stays supported');
    assert.notStrictEqual(r.recommendedCapo, 2);
    for (const c of r.candidates) {
      assert.strictEqual(c.supported, c.capo === 0 || planCapoTransform(dsl, c.capo).ok, `capo ${c.capo}`);
    }
    const ui = buildCapoPreviewUiModel(dsl, undefined);
    assert.strictEqual(ui.candidates[2].supported, false);
    assert.ok(!compileGuitarDslToHtml(dsl, { capo: ui }).includes('<option value="2">'));
    assert.ok(compileGuitarDslToHtml(dsl, { capo: ui }).includes('<option value="2" disabled>'));
  });

  it('reports labeled variants per candidate and keeps the source capo selectable', () => {
    const r = inferCapoForDsl('chord C@x = x35553\n| C@x |\n')!;
    assert.ok(r.candidates[0].supported);
    assert.ok(r.candidates.slice(1).every(c => !c.supported && c.reason === 'labeledChordVariant'));
    assert.strictEqual(r.recommendedCapo, 0);
    assert.strictEqual(inferCapoForDsl('capo: 13\n| C |\n'), null);
  });
});

describe('compiler - chord token source spans', () => {
  it('records the chord-name span of every written chord token', () => {
    const dsl = '| l:"Am" Am:2 G@x/2 | % |\n|: C/E 4 4 4 4 :|';
    const score = parseGuitarDsl(dsl);
    const lines = dsl.split('\n');
    const spans = score.chordTokens!;
    assert.deepStrictEqual(spans.map(s => s.name), ['Am', 'G', 'C/E']);
    for (const s of spans) assert.strictEqual(lines[s.line].slice(s.startCol, s.endCol), s.name);
    assert.strictEqual(spans[1].label, 'x');
    assert.ok(spans[0].startCol > lines[0].indexOf('Am:2') - 1);
    assert.strictEqual(score.firstBodyLine, 0);
  });

  it('records distinct spans when l:"..." precedes chords with the same text', () => {
    for (const line of ['| l:"C" C C |', '| l:"B B" B B |']) {
      const spans = parseGuitarDsl(line).chordTokens!;
      assert.strictEqual(spans.length, 2, line);
      assert.notStrictEqual(spans[0].startCol, spans[1].startCol, line);
      const lyricEnd = line.indexOf('" ') + 1;
      for (const s of spans) {
        assert.strictEqual(line.slice(s.startCol, s.endCol), s.name);
        assert.ok(s.startCol > lyricEnd, `${line}: span inside the lyric`);
      }
    }
  });

  it('records header value ranges', () => {
    const score = parseGuitarDsl('title: X\n  capo:  3\n| C |');
    const capo = score.headerLines!.find(h => h.key === 'capo')!;
    assert.strictEqual('  capo:  3'.slice(capo.valueStart, capo.valueEnd), '3');
    assert.strictEqual(score.firstBodyLine, 2);
  });
});

describe('capo - preview UI model and capo bar', () => {
  it('builds the model from the source and renders it only in the toolbar', () => {
    const source = 'key: B\n| B | E | F# | B |\n';
    const model = buildCapoPreviewUiModel(source, 2);
    assert.strictEqual(model.sourceCapo, 0);
    assert.strictEqual(model.targetCapo, 2);
    assert.strictEqual(model.candidates.length, 13);
    assert.strictEqual(model.candidates.filter(c => c.recommended).length, 1);
    assert.ok(model.overridden && model.canApply);
    assert.deepStrictEqual(model.currentPlayability, inferCapo({ sourceCapo: 0, chords: [{ name: 'B', count: 2 }, { name: 'E' }, { name: 'F#' }] }).candidates[2].playability);

    const effective = resolveEffectiveDsl(source, 2);
    assert.ok(effective.ok);
    const html = compileGuitarDslToHtml(effective.text, { locale: 'en', capo: model });
    assert.ok(html.includes('id="select-capo"'));
    assert.ok(html.includes('<option value="2" selected>'));
    assert.ok(html.includes('id="btn-apply-capo"') && !/id="btn-apply-capo"[^>]*disabled/.test(html));
    const badge = html.match(/<span class="capo-badge" id="capo-playability"[^>]*>([^<]*)</)!;
    assert.ok(badge[1].endsWith(`${model.currentPlayability!.score}/100`));
    // The badge is toolbar HTML, never part of the rendered score SVG (and so never in the PDF).
    const svgPart = html.slice(html.indexOf('<div class="sheet-pages-wrapper">'));
    assert.ok(!svgPart.includes('capo-badge'));
    // No model -> no capo bar (existing callers unchanged).
    assert.ok(!compileGuitarDslToHtml(source).includes('id="capo-bar"'));
  });

  it('disables the control when the source capo is invalid', () => {
    const model = buildCapoPreviewUiModel('capo: x\n| C |\n', undefined);
    assert.strictEqual(model.sourceCapo, null);
    assert.ok(!model.canApply);
    assert.ok(compileGuitarDslToHtml('capo: x\n| C |\n', { capo: model }).includes('id="select-capo" class="tool-select" title="Show the preview and PDF with another capo position (the DSL is not changed)" disabled'));
  });
});
