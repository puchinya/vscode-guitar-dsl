import * as assert from 'assert';
import { parseGuitarDsl } from '../../src/compiler';
import { suggestProgressions } from '../../src/progressionSuggestions';
import { planProgressionEdit } from '../../src/progressionSourceEdits';

function candidate(source: string, startMeasure: number, bars: 4 | 8 | 16) {
  const result = suggestProgressions(parseGuitarDsl(source), { startMeasure }, bars);
  if (!result.ok) throw new Error(`Expected suggestions, received ${result.code}`);
  return result.candidates[0];
}

describe('progression source edits', () => {
  it('replaces only chord names and preserves CRLF, rhythm, lyrics, comments, and whitespace', () => {
    const source = 'key: C\r\n# keep me\r\n|  C   4.d 4.d 4.d 4.d  l:"keep words" |\r\n| Am | G | F |\r\n';
    const score = parseGuitarDsl(source);
    const selected = candidate(source, 0, 4);
    const plan = planProgressionEdit(source, score, { startMeasure: 0, bars: 4, operation: 'replace' }, selected);
    assert.ok(plan.ok, plan.ok ? '' : plan.reason);
    if (!plan.ok) return;
    assert.ok(plan.previewSource.startsWith('key: C\r\n# keep me\r\n|  C   4.d 4.d 4.d 4.d  l:"keep words" |\r\n'));
    assert.strictEqual(plan.edits.length, 4);
    assert.strictEqual(plan.previewSource.match(/# keep me/g)?.length, 1);
  });

  it('appends one chord-only progression at the body end without normalizing existing text', () => {
    const source = 'key: C\r\n# keep\r\n| C |\r\n';
    const score = parseGuitarDsl(source);
    const selected = candidate(source, score.measures.length, 4);
    const plan = planProgressionEdit(source, score, { startMeasure: score.measures.length, bars: 4, operation: 'append' }, selected);
    assert.ok(plan.ok, plan.ok ? '' : plan.reason);
    if (!plan.ok) return;
    assert.ok(plan.previewSource.startsWith(source));
    assert.ok(plan.previewSource.includes(`| ${selected.chords.join(' | ')} |`));
    assert.ok(plan.previewSource.endsWith('\r\n'));
  });

  it('allows replacement starting on a declared @key while rejecting a range that crosses another key', () => {
    const source = 'key: C\n| C |\n@key: Am\n| Am | F | G | C |';
    const score = parseGuitarDsl(source);
    const selected = candidate(source, 1, 4);
    const plan = planProgressionEdit(source, score, { startMeasure: 1, bars: 4, operation: 'replace' }, selected);
    assert.ok(plan.ok, plan.ok ? '' : plan.reason);
    if (!plan.ok) return;
    assert.ok(plan.previewSource.includes('@key: Am\n| Am | Dm | E | Am |'));
    assert.strictEqual(plan.previewSource.split('@key: Am').length - 1, 1);
  });

  it('rejects same-key @key events inside a replacement and allows starting at the event', () => {
    const crossingSource = 'key: C\n| C |\n| F |\n@key: C\n| G |\n| Am |\n| F |\n| C |';
    const validCandidate = candidate('key: C\n| C |\n| F |\n| G |\n| Am |', 0, 4);
    const crossing = planProgressionEdit(crossingSource, parseGuitarDsl(crossingSource),
      { startMeasure: 0, bars: 4, operation: 'replace' }, validCandidate);
    assert.ok(!crossing.ok && crossing.reason === 'keyBoundary');

    const startingSource = 'key: C\n| C |\n| F |\n@key: C\n| G |\n| Am |\n| F |\n| C |';
    const startingScore = parseGuitarDsl(startingSource);
    const startingCandidate = candidate(startingSource, 2, 4);
    const starting = planProgressionEdit(startingSource, startingScore,
      { startMeasure: 2, bars: 4, operation: 'replace' }, startingCandidate);
    assert.ok(starting.ok, starting.ok ? '' : starting.reason);
  });

  it('rejects ambiguous thirdless harmony independently in the source edit planner', () => {
    const valid = 'key: C\n| C |\n| Am |\n| G |\n| F |';
    const selected = candidate(valid, 0, 4);
    const ambiguous = 'key: C\n| Csus4 |\n| Am |\n| G |\n| F |';
    const plan = planProgressionEdit(ambiguous, parseGuitarDsl(ambiguous),
      { startMeasure: 0, bars: 4, operation: 'replace' }, selected);
    assert.ok(!plan.ok && plan.reason === 'ambiguousHarmony');
  });

  it('rejects repeated, multi-chord, duration, labeled, TAB, invalid, and key-crossing targets', () => {
    const unsupported = [
      { source: 'key: C\n| C |\n| % |', start: 1 },
      { source: 'key: C\n| C G |\n| Am |\n| F |', start: 0 },
      { source: 'key: C\n| C:2 |\n| Am |\n| F |', start: 0 },
      { source: 'key: C\nchord C@barre: x32010\n| C@barre |\n| Am |\n| F |', start: 0 },
      { source: 'key: C\n| C |\ntab: 6:0/4 5:2/4\n| Am |\n| F |', start: 0 },
      { source: 'key: C\n| C |\n@key: D\n| D |\n| G |', start: 0 }
    ];
    for (const fixture of unsupported) {
      const score = parseGuitarDsl(fixture.source);
      const result = suggestProgressions(score, { startMeasure: fixture.start }, 4);
      if (!result.ok) continue;
      const plan = planProgressionEdit(fixture.source, score,
        { startMeasure: fixture.start, bars: 4, operation: 'replace' }, result.candidates[0]);
      assert.ok(!plan.ok, fixture.source);
    }
  });

  it('rejects stale source spans and preserves one plan with no partial edits', () => {
    const source = 'key: C\n| C | Am | G | F |';
    const score = parseGuitarDsl(source);
    const selected = candidate(source, 0, 4);
    const stale = source.replace('| C |', '| D |');
    const plan = planProgressionEdit(stale, score, { startMeasure: 0, bars: 4, operation: 'replace' }, selected);
    assert.ok(!plan.ok && plan.reason === 'sourceSpanMismatch');
  });
});
