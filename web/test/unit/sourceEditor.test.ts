import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveLineEndings, renderGuitarDslHighlight } from '../../src/editor/sourceEditor';

test('highlights GuitarDSL headers, sections, chords, bars, and comments without executing source markup', () => {
  const source = 'title: Song <script>\n[Verse]\nC | G | Am | F | # comment\n';
  const html = renderGuitarDslHighlight(source);

  assert.match(html, /<span class="gds-key">title<\/span>/);
  assert.match(html, /<span class="gds-section">\[Verse\]<\/span>/);
  assert.match(html, /<span class="gds-chord">Am<\/span>/);
  assert.match(html, /<span class="gds-bar">\|<\/span>/);
  assert.match(html, /<span class="gds-comment"># comment<\/span>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
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
  const nextText = `${previousText}lyr: | hello |\n`;

  assert.equal(preserveLineEndings(source, previousText, nextText), `${source}lyr: | hello |\r\n`);
});
