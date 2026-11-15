import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkspaceScoreCache } from '../../src/controllers/workspaceScoreCache';

test('workspace score cache reuses parses and line offsets for selection-only snapshots', () => {
  let parseCount = 0;
  let lineIndexCount = 0;
  const cache = createWorkspaceScoreCache(
    (source: string, expand: boolean) => { parseCount += 1; return { source, expand }; },
    source => {
      lineIndexCount += 1;
      const offsets = [0];
      for (let index = 0; index < source.length; index += 1) if (source[index] === '\n') offsets.push(index + 1);
      return offsets;
    }
  );
  const source = 'title: Cache\nAm | F | C | G |\n';

  for (let selection = 0; selection < 100; selection += 1) {
    const result = cache.get('local:score-1', 7, source, 'en', false);
    assert.equal(result.score?.source, source);
    assert.equal(result.offsetFor(1, 5), source.indexOf('Am') + 5);
  }
  assert.equal(parseCount, 1);
  assert.equal(lineIndexCount, 1);

  cache.get('local:score-1', 8, `${source}C | G |\n`, 'en', false);
  assert.equal(parseCount, 2);
  assert.equal(lineIndexCount, 2);
});

test('workspace score cache invalidates on document, locale, and parser-option changes', () => {
  let parseCount = 0;
  const cache = createWorkspaceScoreCache((source: string) => { parseCount += 1; return source; });
  cache.get('local:one', 1, 'Am', 'en', false);
  cache.get('local:one', 1, 'Am', 'ja', false);
  cache.get('local:one', 1, 'Am', 'ja', true);
  cache.get('local:two', 1, 'Am', 'ja', true);
  assert.equal(parseCount, 4);
});

test('workspace score cache releases entries for closed documents', () => {
  let parseCount = 0;
  const cache = createWorkspaceScoreCache((source: string) => { parseCount += 1; return source; });
  cache.get('local:closed', 1, 'Am', 'en', false);
  cache.clear('local:closed');
  cache.get('local:closed', 1, 'Am', 'en', false);
  assert.equal(parseCount, 2);
  cache.clear();
});
