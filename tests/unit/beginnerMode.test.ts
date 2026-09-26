import * as assert from 'assert';
import {
  BEGINNER_BARRE_FALLBACK_RULES,
  BEGINNER_SUBSTITUTION_RULES,
  BarrePolicy,
  BeginnerTransformPlan,
  buildBeginnerPreviewUiModel,
  inferBeginnerModeForDsl,
  planBeginnerTransform
} from '../../src/beginnerMode';
import { inferCapoForDsl, planCapoTransform } from '../../src/capo';
import { parseChordName } from '../../src/chordDetect';
import { getDefaultVoicing } from '../../src/chordPresets';
import { parseGuitarDsl } from '../../src/compiler';
import { MESSAGES_EN, MESSAGES_JA, getScoreSettingsEditorMessages } from '../../src/i18n';
import { resolveChordDiagram } from '../../src/render/chordLibrary';
import { compileGuitarDslToHtml } from '../../src/render/previewHtml';

type OkPlan = Extract<BeginnerTransformPlan, { ok: true }>;

function plan(dsl: string, barrePolicy: BarrePolicy, targetCapo?: number): OkPlan {
  const p = planBeginnerTransform(dsl, { barrePolicy, targetCapo });
  assert.ok(p.ok, `expected beginner transform to succeed: ${JSON.stringify(p)}`);
  return p;
}

function finalChords(text: string): string[] {
  return parseGuitarDsl(text).measures.flatMap(m => m.chords.map(c => (c.label ? `${c.name}@${c.label}` : c.name)));
}

/** Every diagram the final score draws (renderer resolution). */
function drawnDiagrams(text: string) {
  const score = parseGuitarDsl(text);
  return score.usedChords.map(key => resolveChordDiagram(key, score.chordDefinitions));
}

/** Allowed (source suffix -> target suffix) pairs, including the barre fallback. */
const ALLOWED = new Set([...BEGINNER_SUBSTITUTION_RULES, ...BEGINNER_BARRE_FALLBACK_RULES].map(r => `${r.from}>${r.to}`));

function assertWhitelisted(from: string, to: string): void {
  if (from === to) return;
  const a = parseChordName(from)!;
  const b = parseChordName(to)!;
  assert.strictEqual(b.rootPc, a.rootPc, `root changed: ${from} -> ${to}`);
  assert.ok(b.bass === undefined || b.bass === a.bass, `bass changed: ${from} -> ${to}`);
  if (a.suffix !== b.suffix) assert.ok(ALLOWED.has(`${a.suffix}>${b.suffix}`), `not whitelisted: ${from} -> ${to}`);
}

describe('beginnerMode - barre hard constraint', () => {
  const dsl = 'capo: 0\n| F | C | G | Am |\n';

  it('BEG-01 allow keeps the exact F (its default voicing is a barre)', () => {
    assert.ok(getDefaultVoicing('F')!.barres.length > 0);
    const p = plan(dsl, 'allow', 0);
    assert.deepStrictEqual(finalChords(p.text), ['F', 'C', 'G', 'Am']);
    assert.strictEqual(p.text, dsl);
  });

  it('BEG-02 forbid never draws a barre: F falls back to Fmaj7', () => {
    const p = plan(dsl, 'forbid', 0);
    assert.deepStrictEqual(finalChords(p.text), ['Fmaj7', 'C', 'G', 'Am']);
    assert.ok(drawnDiagrams(p.text).every(d => d.voicing.barres.length === 0));
    const f = p.candidate.choices.find(c => c.capoChord === 'F')!;
    assert.strictEqual(f.target, 'Fmaj7');
    assert.strictEqual(f.penalty, 2);
    assert.ok(f.substituted);
  });

  it('BEG-03 the major/minor fallback is used only with forbid and a barre exact chord', () => {
    // C has a bar-free default voicing: no Cmaj7 fallback even with forbid.
    assert.deepStrictEqual(finalChords(plan('| C |\n', 'forbid', 0).text), ['C']);
    // allow never adds an extension.
    assert.deepStrictEqual(finalChords(plan('| F |\n', 'allow', 0).text), ['F']);
  });

  it('BEG-04 every supported forbid candidate at every capo draws no barre', () => {
    const src = 'capo: 0\n| F | Bb | C | Dm | Gm7 |\n';
    const inference = inferBeginnerModeForDsl(src, 'forbid');
    for (const c of inference.candidates.filter(c => c.supported)) {
      const p = plan(src, 'forbid', c.capo);
      assert.ok(drawnDiagrams(p.text).every(d => d.voicing.barres.length === 0), `capo ${c.capo}`);
    }
  });
});

describe('beginnerMode - capo + substitution', () => {
  const src = 'capo: 0\n| B | E | F#m7 | C#m |\n| B | E | F# | B |\n';

  it('BEG-05 evaluates capo 0..12 through planCapoTransform and recommends deterministically', () => {
    const a = inferBeginnerModeForDsl(src, 'forbid');
    const b = inferBeginnerModeForDsl(src, 'forbid');
    assert.deepStrictEqual(a.candidates.map(c => c.capo), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.deepStrictEqual(a, b);
    assert.ok(a.recommendedCapo !== undefined);
    const rec = a.candidates[a.recommendedCapo!];
    for (const c of a.candidates.filter(c => c.supported && c.optimizationCost !== undefined)) {
      assert.ok(rec.optimizationCost! <= c.optimizationCost! + 1e-9, `capo ${c.capo} is cheaper than the recommendation`);
    }
  });

  it('BEG-06 the final mapping is built on the target capo sounding harmony', () => {
    const inference = inferBeginnerModeForDsl(src, 'forbid');
    const p = plan(src, 'forbid');
    assert.strictEqual(p.targetCapo, inference.recommendedCapo);
    assert.ok(p.autoCapo);
    const capoPlan = planCapoTransform(src, p.targetCapo);
    assert.ok(capoPlan.ok);
    for (const m of p.candidate.mapping) {
      assert.strictEqual(m.capoChord, capoPlan.chordMap.get(m.source));
      assertWhitelisted(m.capoChord, m.target);
    }
    assert.strictEqual(parseGuitarDsl(p.text).capo, String(p.targetCapo));
  });

  it('BEG-07 does not change the normal capo inference', () => {
    const before = JSON.stringify(inferCapoForDsl(src), (_k, v) => (v instanceof Map ? Array.from(v) : v));
    inferBeginnerModeForDsl(src, 'forbid');
    planBeginnerTransform(src, { barrePolicy: 'allow' });
    const after = JSON.stringify(inferCapoForDsl(src), (_k, v) => (v instanceof Map ? Array.from(v) : v));
    assert.strictEqual(after, before);
  });

  it('BEG-08 the UI score is physical playability; the penalty only affects the recommendation', () => {
    const inference = inferBeginnerModeForDsl('| F | C |\n', 'forbid');
    const c0 = inference.candidates[0];
    assert.ok(c0.optimizationCost! > c0.physicalSongCost!);
    assert.strictEqual(c0.playability!.score, Math.round(Math.min(100, Math.max(0, 100 - 10 * c0.physicalSongCost!))));
  });
});

describe('beginnerMode - extension simplification whitelist', () => {
  it('BEG-09 simplifies extensions within the whitelist only', () => {
    // D9 -> D7 (cheaper than the exact barre-less D9 and than D).
    assert.deepStrictEqual(finalChords(plan('| D9 |\n', 'allow', 0).text), ['D7']);
    const names = ['Cmaj7', 'Am7', 'D9', 'Em9', 'Gmaj9', 'A7sus4', 'Bdim7', 'Fadd9', 'C6', 'Am6', 'E7', 'Bm', 'Bb', 'Fm', 'Esus2', 'Caug', 'Bdim'];
    for (const policy of ['allow', 'forbid'] as const) {
      for (const n of names) {
        const inference = inferBeginnerModeForDsl(`| ${n} |\n`, policy);
        for (const c of inference.candidates.filter(c => c.supported)) {
          for (const choice of c.choices) assertWhitelisted(choice.capoChord, choice.target);
        }
      }
    }
  });

  it('BEG-10 never turns sus / dim / aug into major or minor', () => {
    for (const n of ['Esus4', 'Asus2', 'Bdim', 'Caug']) {
      const inference = inferBeginnerModeForDsl(`| ${n} |\n`, 'forbid');
      for (const c of inference.candidates.filter(c => c.supported)) {
        const q = parseChordName(c.choices[0].target)!.suffix;
        assert.strictEqual(q, parseChordName(c.choices[0].capoChord)!.suffix);
      }
    }
  });

  it('BEG-11 maj9 / dim7 without presets are simplified instead of being left unchanged', () => {
    assert.deepStrictEqual(finalChords(plan('| Cmaj9 | Bdim7 |\n', 'allow', 0).text), ['Cmaj7', 'Bdim']);
  });
});

describe('beginnerMode - slash chords', () => {
  it('BEG-12 evaluates the exact slash chord and the bass-drop alternative with its penalty', () => {
    // C/E: exact uses the C voicing + slash cost; dropping the bass costs penalty 1.
    const p = plan('| C/E |\n', 'allow', 0);
    const choice = p.candidate.choices[0];
    // Exact: cost(C) + 1 (slash), dropped: cost(C) + penalty 1 -> tie on choice cost -> lower penalty (exact).
    assert.strictEqual(choice.target, 'C/E');
    assert.strictEqual(choice.penalty, 0);
    // F/A with forbid: the upper F is a barre, so only the fallback remains (Fmaj7/A penalty 2 beats Fmaj7 penalty 3).
    const f = plan('| F/A |\n', 'forbid', 0).candidate.choices[0];
    assert.strictEqual(f.target, 'Fmaj7/A');
    assert.strictEqual(f.penalty, 2);
  });

  it('BEG-13 drops the bass when that is cheaper overall and records penalty 1', () => {
    // Cmaj7/G (upper Cmaj7) vs C (quality 1 + bass drop 1 = 2) vs Cmaj7 (bass drop 1).
    const choice = plan('| Cmaj7/G |\n', 'allow', 0).candidate.choices[0];
    assert.ok(['Cmaj7/G', 'Cmaj7'].includes(choice.target));
    if (choice.target === 'Cmaj7') assert.strictEqual(choice.penalty, 1);
  });
});

describe('beginnerMode - no solution', () => {
  it('BEG-14 explicit capo + forbid without a playable alternative is unsupported (no implicit allow)', () => {
    // Bm and its fallback Bm7 both draw a barre.
    const p = planBeginnerTransform('| Bm |\n', { barrePolicy: 'forbid', targetCapo: 0 });
    assert.ok(!p.ok);
    assert.strictEqual(p.code, 'noPlayableAlternative');
    assert.strictEqual(p.detail, 'Bm');
    const inference = inferBeginnerModeForDsl('| Bm |\n', 'forbid');
    assert.ok(!inference.candidates[0].supported);
    assert.strictEqual(inference.candidates[0].reason, 'noPlayableAlternative');
    assert.ok(plan('| Bm |\n', 'allow', 0));
  });

  it('BEG-15 auto without any supported capo fails with noRecommendation', () => {
    const p = planBeginnerTransform('chord C@x = x35553 barre:3\n| C@x |\n', { barrePolicy: 'forbid' });
    assert.ok(!p.ok);
    assert.strictEqual(p.code, 'noRecommendation');
  });

  it('BEG-16 an unknown chord quality is unsupported rather than silently kept', () => {
    const p = planBeginnerTransform('| C13 |\n', { barrePolicy: 'allow', targetCapo: 0 });
    assert.ok(!p.ok);
    assert.strictEqual(p.code, 'noPlayableAlternative');
  });

  it('BEG-17 propagates capo transform failures', () => {
    const p = planBeginnerTransform('capo: 13\n| C |\n', { barrePolicy: 'allow', targetCapo: 2 });
    assert.ok(!p.ok);
    assert.strictEqual(p.code, 'invalidSourceCapo');
    assert.strictEqual(inferBeginnerModeForDsl('capo: 13\n| C |\n', 'allow').recommendedCapo, undefined);
    const bad = planBeginnerTransform('| C |\n', { barrePolicy: 'allow', targetCapo: 13 });
    assert.ok(!bad.ok);
    assert.strictEqual(bad.code, 'invalidTargetCapo');
  });
});

describe('beginnerMode - custom definitions', () => {
  it('BEG-18 excludes a substitution whose target collides with an unlabeled definition', () => {
    const src = 'chord D7 = xx0212\n| D9 |\n';
    const p = plan(src, 'allow', 0);
    assert.deepStrictEqual(finalChords(p.text), ['D']);
    assert.ok(p.text.startsWith('chord D7 = xx0212\n'));
  });

  it('BEG-19 F with forbid and a colliding Fmaj7 definition has no alternative', () => {
    const src = 'chord Fmaj7 = 133211\n| F |\n';
    const p = planBeginnerTransform(src, { barrePolicy: 'forbid', targetCapo: 0 });
    assert.ok(!p.ok);
    assert.strictEqual(p.code, 'noPlayableAlternative');
  });

  it('BEG-20 uses the file definition of the exact chord and never rewrites definitions', () => {
    // A bar-free custom F keeps F even with forbid.
    const src = 'chord F = xx3211\n| F | C |\n';
    const p = plan(src, 'forbid', 0);
    assert.strictEqual(p.text, src);
    // A barre custom C makes the exact C unusable with forbid, so the fallback Cmaj7 is used;
    // the definition line itself is kept byte-identical.
    const barreC = 'chord C = x35553 barre:3\n| C |\n';
    const q = plan(barreC, 'forbid', 0);
    assert.strictEqual(q.text, 'chord C = x35553 barre:3\n| Cmaj7 |\n');
    assert.deepStrictEqual(q.unusedDefinitions, ['C']);
    assert.deepStrictEqual(q.warnings, ['unusedChordDefinitions']);
  });

  it('BEG-21 warns about definitions that become unused (never deleted)', () => {
    const src = 'chord Cmaj9 = x32000\n| Cmaj9 | G |\n';
    const p = plan(src, 'allow', 0);
    assert.strictEqual(p.text, src, 'the custom Cmaj9 voicing is used as the exact chord');
    const src2 = 'chord Dm9 = xx0210\n| D9 | Dm9 |\n';
    const p2 = plan(src2, 'allow', 0);
    assert.ok(p2.text.includes('chord Dm9 = xx0210'));
  });
});

describe('beginnerMode - labeled chords', () => {
  const src = 'chord C@x = x35553\n| C@x | Am7 |\n';

  it('BEG-22 keeps the exact label at the source capo and never substitutes it', () => {
    const p = plan(src, 'allow', 0);
    assert.deepStrictEqual(finalChords(p.text), ['C@x', 'Am7']);
    const labeled = p.candidate.choices.find(c => c.capoChord === 'C@x')!;
    assert.ok(!labeled.substituted);
  });

  it('BEG-23 keeps the existing labeled capo-change failure', () => {
    const inference = inferBeginnerModeForDsl(src, 'allow');
    assert.ok(inference.candidates.slice(1).every(c => !c.supported && c.reason === 'labeledChordVariant'));
    const p = planBeginnerTransform(src, { barrePolicy: 'allow', targetCapo: 3 });
    assert.ok(!p.ok);
    assert.strictEqual(p.code, 'labeledChordVariant');
  });

  it('BEG-24 does not rename a labeled token sharing the name of a substituted chord', () => {
    const p = plan('chord F@x = xx3211\n| F@x | F |\n', 'forbid', 0);
    assert.deepStrictEqual(finalChords(p.text), ['F@x', 'Fmaj7']);
  });
});

describe('beginnerMode - source preservation and reparse', () => {
  it('BEG-25 changes only chord names (and capo) and keeps comments, CRLF, lengths, melody, lyrics, key', () => {
    const source = [
      '# comment: F C',
      'title: Sample  ',
      'key: C',
      'bpm: 100',
      '',
      '[Intro]',
      '|  F  | Cmaj9:2   D9:2 |',
      '|: F 4.d 4.u 4.d 4.u l:"F la" | % :|',
      'mel: | c4/4 d4 e4 f4 | g4/1 |',
      'lyr: あ い う え | お',
      '---',
      '| C/2 F/2 |]',
      ''
    ].join('\r\n');
    const expected = source.replace('|  F  | Cmaj9:2   D9:2 |', '|  Fmaj7  | Cmaj7:2   D7:2 |')
      .replace('|: F 4.d', '|: Fmaj7 4.d')
      .replace('| C/2 F/2 |]', '| C/2 Fmaj7/2 |]');
    assert.strictEqual(parseGuitarDsl(source).diagnostics.filter(d => d.severity === 'error').length, 0);
    const p = plan(source, 'forbid', 0);
    assert.strictEqual(p.text, expected);
    assert.ok(p.text.includes('l:"F la"'), 'text inside lyrics is not a chord token');
  });

  it('BEG-26 inserts the capo header exactly like the capo transform and keeps durations', () => {
    const src = '| G:1.5 C/4. |\n';
    const p = plan(src, 'allow', 2);
    const capoText = planCapoTransform(src, 2);
    assert.ok(capoText.ok);
    // Only chord names may differ from the capo transform.
    assert.strictEqual(p.text.replace(/[A-G][b#]?[^\s:/|]*/g, 'X'), capoText.text.replace(/[A-G][b#]?[^\s:/|]*/g, 'X'));
    assert.ok(p.text.startsWith('capo: 2\n'));
  });

  it('BEG-27 final DSL reparses without errors, with the target capo and the expected sequence', () => {
    const src = 'capo: 0\n| B | E | F#m7 | C#m |\n';
    for (const policy of ['allow', 'forbid'] as const) {
      const inference = inferBeginnerModeForDsl(src, policy);
      for (const c of inference.candidates.filter(c => c.supported)) {
        const p = plan(src, policy, c.capo);
        const final = parseGuitarDsl(p.text);
        assert.strictEqual(final.diagnostics.filter(d => d.severity === 'error').length, 0);
        assert.strictEqual(final.capo, String(c.capo));
        const bySource = new Map(p.candidate.mapping.map(m => [m.source, m.target]));
        assert.deepStrictEqual(finalChords(p.text), finalChords(src).map(k => bySource.get(k)));
      }
    }
  });

  it('BEG-28 is computed from the given source every time (no accumulation)', () => {
    const src = 'capo: 0\n| F | Cmaj9 |\n';
    const a = plan(src, 'forbid', 0).text;
    plan(src, 'forbid', 3);
    plan(src, 'allow', 5);
    assert.strictEqual(plan(src, 'forbid', 0).text, a);
  });
});

describe('beginnerMode - preview model, HTML and i18n', () => {
  const src = 'capo: 0\n| F | C | G | Am |\n';

  it('BEG-29 renders the beginner controls in the existing capo bar only', () => {
    const inference = inferBeginnerModeForDsl(src, 'forbid');
    const p = plan(src, 'forbid');
    const models = buildBeginnerPreviewUiModel(src, p, inference);
    assert.deepStrictEqual(models.beginner.substitutions, [['F', 'Fmaj7']]);
    assert.ok(models.capo.canApply);
    for (const locale of ['ja', 'en'] as const) {
      const m = locale === 'ja' ? MESSAGES_JA : MESSAGES_EN;
      const html = compileGuitarDslToHtml(p.text, { locale, capo: models.capo, beginner: models.beginner });
      assert.ok(html.includes('id="btn-beginner" aria-pressed="true"'));
      assert.ok(html.includes(`${m.uiBeginnerMode}: ${m.uiBeginnerOn}`));
      assert.ok(html.includes(`<option value="forbid" selected>${m.uiBarreForbid}</option>`));
      assert.ok(html.includes(`<option value="allow">${m.uiBarreAllow}</option>`));
      assert.ok(html.includes('F → Fmaj7'));
      assert.strictEqual((html.match(/class="capo-bar"/g) ?? []).length, 1);
      const svgPart = html.slice(html.indexOf('<div class="sheet-pages-wrapper">'));
      assert.ok(!svgPart.includes('id="btn-beginner"'));
    }
    const off = compileGuitarDslToHtml(src, { locale: 'ja', capo: models.capo });
    assert.ok(off.includes('id="btn-beginner" aria-pressed="false"'));
    assert.ok(!off.includes('id="select-barre"'));
  });

  it('BEG-30 JA/EN messages cover the beginner labels and failures', () => {
    assert.strictEqual(MESSAGES_JA.uiBarreAllow, '許可する');
    assert.strictEqual(MESSAGES_JA.uiBarreForbid, '使用しない');
    assert.strictEqual(MESSAGES_JA.uiBeginnerMode, '初心者モード');
    for (const m of [MESSAGES_JA, MESSAGES_EN]) {
      for (const code of ['noPlayableAlternative', 'noRecommendation', 'labeledChordVariant', 'sourceParseError'] as const) {
        assert.ok(m.beginnerFailure(code, 'X').length > 0);
      }
    }
    assert.strictEqual(getScoreSettingsEditorMessages('ja').sectionBeginner, '初心者モード');
    assert.strictEqual(getScoreSettingsEditorMessages('en').sectionBeginner, 'Beginner Mode');
  });
});
