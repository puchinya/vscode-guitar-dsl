import * as assert from 'assert';
import { formatMeasureSummary } from '../../src/symbols';

describe('symbols - formatMeasureSummary', () => {
  it('should extract chord names from measure line', () => {
    const line = '| C G | Am Em |';
    const summary = formatMeasureSummary(line);
    assert.strictEqual(summary, '| C G | Am Em |');
  });

  it('should strip lyrics when formatting summary', () => {
    const line = '| C G | Am Em | l:"思い出すメロディ"';
    const summary = formatMeasureSummary(line);
    assert.strictEqual(summary, '| C G | Am Em |');
  });

  it('should handle measure repeat % symbols', () => {
    const line = '| C | % | % | G |';
    const summary = formatMeasureSummary(line);
    assert.strictEqual(summary, '| C | % | % | G |');
  });

  it('should strip repeat colons |: and :| from chord tokens', () => {
    const line = '|: C G | Am Em :|';
    const summary = formatMeasureSummary(line);
    assert.strictEqual(summary, '| C G | Am Em |');
  });

  it('should handle chord extensions and slashed chords', () => {
    const line = '| Cadd9 D/F# | Em7 Bm7 |';
    const summary = formatMeasureSummary(line);
    assert.strictEqual(summary, '| Cadd9 D/F# | Em7 Bm7 |');
  });

  it('should fallback to tokens when no recognized chords are present', () => {
    const line = '| foo bar baz |';
    const summary = formatMeasureSummary(line);
    assert.strictEqual(summary, '| foo bar baz |');
  });

  it('should format line even without barlines', () => {
    const line = 'No bars here';
    const summary = formatMeasureSummary(line);
    assert.strictEqual(summary, '| No bars here |');
  });
});
