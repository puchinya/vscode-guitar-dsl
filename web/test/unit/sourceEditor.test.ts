import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveLineEndings, tokenizeGuitarDslRanges } from '../../src/editor/sourceEditor';

test('tokenizes GuitarDSL headers, sections, chord cells, comments and directives into source ranges', () => {
  const source = 'title: Song <script>\n[Verse]\nC | G | Am | F | # comment\nmel: | c4/4 d4/4 |\ntab: | 6f3/4 5f2/4 |';
  const ranges = tokenizeGuitarDslRanges(source);
  const at = (text: string, kind: string) => {
    const from = source.indexOf(text);
    assert.ok(ranges.some(range => range.from === from && range.to === from + text.length && range.kind === kind), text + ' should be ' + kind);
  };
  at('title', 'key');
  at('[Verse]', 'section');
  at('Am', 'chord');
  at('# comment', 'comment');
  at('mel', 'keyword');
  at('c4/4', 'note');
  at('6f3', 'tab-note');
  assert.ok(!ranges.some(range => range.kind === 'comment' && source.slice(range.from, range.to).includes('<script>')));
});

test('preserves original mixed line endings when an edit changes text on one line', () => {
  const source = 'title: Song\r\n[Verse]\nC | G |\r\n';
  const previousText = source.replace(/\r\n?/gu, '\n');
  const nextText = previousText.replace('Song', 'Track');
  assert.equal(preserveLineEndings(source, previousText, nextText), 'title: Track\r\n[Verse]\nC | G |\r\n');
});

test('uses the surrounding source line ending for a newly inserted line', () => {
  const source = 'title: Song\r\n[Verse]\r\nC | G |\r\n';
  const previousText = source.replace(/\r\n?/gu, '\n');
  const nextText = previousText + 'lyr: | hello |\n';
  assert.equal(preserveLineEndings(source, previousText, nextText), source + 'lyr: | hello |\r\n');
});
