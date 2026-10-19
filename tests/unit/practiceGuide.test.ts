import * as assert from 'assert';
import { parseGuitarDsl } from '../../src/compiler';
import { automaticPracticeGuideGrid } from '../../src/practiceGuide';

describe('practice guide grid', () => {
  it('uses the densest explicit rhythm subdivision across the written song', () => {
    assert.strictEqual(automaticPracticeGuideGrid(parseGuitarDsl('| C | 4 4 4 4 |\n| G | 8 8 4 8 8 |')), 8);
    assert.strictEqual(automaticPracticeGuideGrid(parseGuitarDsl('| C | 4 4 4 4 |\n| G | 16 16 16 16 16 16 16 16 |')), 16);
  });

  it('excludes implicit rhythm, melody and unused let definitions', () => {
    const score = parseGuitarDsl([
      'let unused = 16 16 16 16 16 16 16 16',
      '| C |',
      'mel: | c4/16 c d e f g a b c |'
    ].join('\n'));
    assert.strictEqual(automaticPracticeGuideGrid(score), 4);
  });

  it('uses TAB-only note values and does not double count TAB beside explicit rhythm', () => {
    const tabOnly = parseGuitarDsl('| C |\ntab: | 6f0/16 6f1/16 6f2/16 6f3/16 6f4/16 6f5/16 6f6/16 6f7/16 |');
    assert.strictEqual(automaticPracticeGuideGrid(tabOnly), 16);

    const explicitWins = parseGuitarDsl('| C | 4 4 4 4 |\ntab: | 6f0/16 6f1/16 6f2/16 6f3/16 6f4/16 6f5/16 6f6/16 6f7/16 |');
    assert.strictEqual(automaticPracticeGuideGrid(explicitWins), 4);
  });
});
