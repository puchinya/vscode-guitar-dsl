import * as assert from 'assert';
import { parseGuitarDsl } from '../../src/compiler';
import { buildPlaybackTimeline } from '../../src/playbackTimeline';

const diagnosticsOf = (source: string) => parseGuitarDsl(source).diagnostics;
const hasCode = (source: string, code: string) => diagnosticsOf(source).some(d => d.code === code);

function validScore(source: string) {
  const score = parseGuitarDsl(source);
  assert.strictEqual(score.playOrder.valid, true, JSON.stringify(score.diagnostics));
  assert.deepStrictEqual(score.diagnostics.filter(d => d.severity === 'error'), []);
  return score;
}

describe('section arrangement (Issue #88)', () => {
  it('T01 lowers named sections to source-measure occurrences and carries lyric verses into the timeline', () => {
    const source = [
      'title: Example',
      'arrangement {',
      '  Intro',
      '  Verse',
      '  Chorus',
      '  Verse',
      '  Chorus',
      '  Verse(lyr=3)',
      '  Chorus x2',
      '  Outro',
      '}',
      '[Intro]',
      '| C |',
      '[Verse]',
      '| Am | F |',
      'mel: | a4/4 b4/4 c5/4 d5/4 | e5/4 f5/4 g5/4 a5/4 |',
      'lyr: one two three four five six seven eight',
      'lyr: red blue gold green rain wind sun snow',
      'lyr: la la la la do re mi fa',
      '[Chorus]',
      '| G |',
      'mel: | g4/4 a4/4 b4/4 c5/4 |',
      'lyr: hey sing our song',
      '[Outro]',
      '| C |'
    ].join('\n');

    const score = validScore(source);
    assert.strictEqual(score.measures.length, 5);
    assert.strictEqual(score.pages.reduce((sum, page) => sum + page.measures.length, 0), 5);
    assert.strictEqual(score.measures[1].melody?.[0].syllables.length, 3);
    assert.deepStrictEqual(score.playOrder.occurrences.map(o => o.measureIndex), [0, 1, 2, 3, 1, 2, 3, 1, 2, 3, 3, 4]);
    assert.deepStrictEqual(score.playOrder.occurrences.map(o => o.occurrenceIndex), Array.from({ length: 12 }, (_, i) => i));
    assert.deepStrictEqual(score.playOrder.occurrences.map(o => o.lyricVerse), [undefined, 1, 1, 1, 2, 2, 1, 3, 3, 1, 1, undefined]);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(score.playOrder.occurrences[0], 'lyricVerse'), false);

    const timeline = buildPlaybackTimeline(score);
    assert.ok(timeline.ok);
    if (!timeline.ok) return;
    assert.deepStrictEqual(timeline.timeline.occurrences.map(o => [o.occurrenceIndex, o.measureIndex, o.lyricVerse]),
      score.playOrder.occurrences.map(o => [o.occurrenceIndex, o.measureIndex, o.lyricVerse]));
  });

  it('T02 advances automatic counters per expanded section occurrence and lets explicit verses override one call', () => {
    const base = (entries: string[]) => [
      'arrangement {', ...entries, '}',
      '[Verse]', '| C | D |',
      'mel: | c4/1 | d4/1 |',
      'lyr: a b', 'lyr: c d', 'lyr: e f',
      '[Chorus]', '| G |',
      'mel: | g4/4 a4/4 b4/4 c5/4 |',
      'lyr: one two three four'
    ].join('\n');

    const verseX4 = validScore(base(['Verse x4']));
    assert.deepStrictEqual(verseX4.playOrder.occurrences.filter(o => o.measureIndex < 2).map(o => o.lyricVerse), [1, 1, 2, 2, 3, 3, 1, 1]);

    const explicit = validScore(base(['Verse', 'Verse(lyr=2)', 'Verse', 'Chorus x2']));
    assert.deepStrictEqual(explicit.playOrder.occurrences.filter(o => o.measureIndex < 2).map(o => o.lyricVerse), [1, 1, 2, 2, 3, 3]);
    assert.deepStrictEqual(explicit.playOrder.occurrences.filter(o => o.measureIndex === 2).map(o => o.lyricVerse), [1, 1]);

    const explicitDoesNotResetCounter = validScore(base(['Verse(lyr=3)', 'Verse']));
    assert.deepStrictEqual(explicitDoesNotResetCounter.playOrder.occurrences.map(o => o.lyricVerse), [3, 3, 2, 2]);

    const explicitRepeat = validScore(base(['Verse(lyr=2) x2']));
    assert.deepStrictEqual(explicitRepeat.playOrder.occurrences.map(o => o.lyricVerse), [2, 2, 2, 2]);
  });

  it('T03 rejects unavailable explicit verses at their value span and uses the minimum sung-group verse count', () => {
    const source = [
      'arrangement {', 'Verse(lyr=3)', '}',
      '[Verse]', '| C | D | E | F |',
      'mel: | c4/1 | d4/1 |',
      'lyr: a b', 'lyr: c d', 'lyr: e f',
      'mel: | g4/1 | a4/1 |',
      'lyr: g h', 'lyr: i j'
    ].join('\n');
    const score = parseGuitarDsl(source);
    const unavailable = score.diagnostics.find(d => d.code === 'arrangementLyricVerseUnavailable');
    assert.ok(unavailable);
    assert.strictEqual(unavailable.line, 1);
    assert.strictEqual(source.split('\n')[unavailable.line].slice(unavailable.startCol, unavailable.endCol), '3');
    assert.deepStrictEqual(score.playOrder, { valid: false, occurrences: [], diagnostics: [] });

    for (const entry of ['Intro(lyr=1)', 'Verse(lyr=0)', 'Verse(lyr=abc)']) {
      const invalid = parseGuitarDsl(`arrangement {\n${entry}\n}\n[Intro]\n| C l:"fixed lyric" |`);
      assert.strictEqual(invalid.playOrder.valid, false, entry);
      assert.deepStrictEqual(invalid.playOrder.occurrences, [], entry);
      assert.ok(invalid.diagnostics.some(d => d.code === (entry.startsWith('Intro') ? 'arrangementLyricVerseUnavailable' : 'arrangementInvalidSyntax')), entry);
    }

    const autoWithoutSungLyrics = validScore('arrangement {\nIntro\n}\n[Intro]\n| C l:"fixed lyric" |');
    assert.strictEqual(autoWithoutSungLyrics.playOrder.occurrences[0].lyricVerse, undefined);
    assert.strictEqual(autoWithoutSungLyrics.measures[0].lyric, 'fixed lyric');
  });

  it('T04 resolves exact Unicode and bracketed labels, and diagnoses unknown, duplicate, empty, and unassigned sections', () => {
    const bracketed = validScore([
      'arrangement {', '[Verse A]', 'Aメロ', '}',
      '[Verse A]', '| C |',
      '[Aメロ]', '| G |'
    ].join('\n'));
    assert.deepStrictEqual(bracketed.playOrder.occurrences.map(o => o.measureIndex), [0, 1]);

    const arrangementNames = validScore([
      'arrangement {', 'arrangement', 'arrangement-1', '[arrangement]', '[arrangement-1]', '}',
      '[arrangement]', '| C |',
      '[arrangement-1]', '| G |'
    ].join('\n'));
    assert.deepStrictEqual(arrangementNames.playOrder.occurrences.map(o => o.measureIndex), [0, 1, 0, 1]);

    const hashLabelAndComment = validScore([
      'arrangement {', '[Verse #2] # exact label comment', 'Verse # ordinary trailing comment', '}',
      '[Verse #2]', '| C |',
      '[Verse]', '| G |'
    ].join('\n'));
    assert.deepStrictEqual(hashLabelAndComment.playOrder.occurrences.map(o => o.measureIndex), [0, 1]);

    const unknown = parseGuitarDsl('arrangement {\nverse\n}\n[Verse]\n| C |');
    assert.ok(unknown.diagnostics.some(d => d.code === 'arrangementUnknownReference'));
    assert.deepStrictEqual(unknown.playOrder.occurrences, []);

    const duplicate = parseGuitarDsl('arrangement {\nVerse\n}\n[Verse]\n| C |\n[Verse]\n| G |');
    assert.ok(duplicate.diagnostics.some(d => d.code === 'arrangementDuplicateSection'));
    assert.ok(duplicate.diagnostics.some(d => d.code === 'arrangementAmbiguousReference'));
    assert.deepStrictEqual(duplicate.playOrder.occurrences, []);

    const empty = parseGuitarDsl('arrangement {\nVerse\n}\n[Empty]\n[Verse]\n| C |');
    assert.ok(empty.diagnostics.some(d => d.code === 'arrangementEmptySection'));

    const unassigned = parseGuitarDsl('arrangement {\nVerse\n}\n| C |\n[Verse]\n| G |');
    assert.ok(unassigned.diagnostics.some(d => d.code === 'arrangementUnassignedMeasures'));

    const legacy = parseGuitarDsl('[Verse]\n| C |\n[Verse]\n| G |');
    assert.strictEqual(legacy.playOrder.valid, true);
    assert.ok(!legacy.diagnostics.some(d => d.code === 'arrangementDuplicateSection'));
  });

  it('T05 masks malformed, nested, repeated, misplaced, and unterminated blocks instead of parsing their contents as score', () => {
    const legacyStyle = parseGuitarDsl('arrangement:\n[Fake]\n| C |\nend_arrangement');
    assert.ok(legacyStyle.diagnostics.some(d => d.code === 'arrangementInvalidSyntax'));
    assert.strictEqual(legacyStyle.measures.length, 0);
    assert.deepStrictEqual(legacyStyle.playOrder.occurrences, []);

    const uppercaseKeyword = parseGuitarDsl('Arrangement {\n[Fake]\n| C |\n}\n[Verse]\n| G |');
    assert.ok(uppercaseKeyword.diagnostics.some(d => d.code === 'arrangementInvalidSyntax'));
    assert.deepStrictEqual(uppercaseKeyword.measures.map(m => m.chord), ['G']);
    assert.deepStrictEqual(uppercaseKeyword.playOrder.occurrences, []);

    const unterminated = parseGuitarDsl('arrangement {\nVerse\n[Fake]\n| C |');
    assert.ok(unterminated.diagnostics.some(d => d.code === 'arrangementUnterminatedBlock'));
    assert.strictEqual(unterminated.measures.length, 0);

    const malformed = parseGuitarDsl('arrangement { trailing\n[Fake]\n| C |\n}\n[Verse]\n| G |');
    assert.ok(malformed.diagnostics.some(d => d.code === 'arrangementInvalidSyntax'));
    assert.deepStrictEqual(malformed.measures.map(m => m.chord), ['G']);

    const nested = parseGuitarDsl('arrangement {\nVerse\narrangement {\nFake\n}\n| G |\n}\n[Verse]\n| C |');
    assert.ok(nested.diagnostics.some(d => d.code === 'arrangementDuplicateBlock'));
    assert.deepStrictEqual(nested.measures.map(m => m.chord), ['C']);

    const multiple = parseGuitarDsl('arrangement {\nVerse\n}\narrangement {\nVerse\n}\n[Verse]\n| C |');
    assert.ok(multiple.diagnostics.some(d => d.code === 'arrangementDuplicateBlock'));
    assert.deepStrictEqual(multiple.playOrder.occurrences, []);

    const misplaced = parseGuitarDsl('[Verse]\n| C |\narrangement {\nVerse\n}');
    assert.ok(misplaced.diagnostics.some(d => d.code === 'arrangementOutsideHeader'));
    assert.deepStrictEqual(misplaced.playOrder.occurrences, []);

    const empty = parseGuitarDsl('arrangement {\n# only a comment\n}');
    assert.ok(empty.diagnostics.some(d => d.code === 'arrangementEmpty'));

    for (const entry of ['Verse x0', 'Verse x-1', 'Verse x1.5', 'Verse x1e3', 'Verse x9007199254740992', 'Verse x2(lyr=1)']) {
      const invalid = parseGuitarDsl(`arrangement {\n${entry}\n}\n[Verse]\n| C |`);
      assert.ok(invalid.diagnostics.some(d => d.code === 'arrangementInvalidSyntax'), entry);
      assert.deepStrictEqual(invalid.playOrder.occurrences, [], entry);
    }

    const unmatched = parseGuitarDsl('}\n[Verse]\n| C |');
    assert.ok(unmatched.diagnostics.some(d => d.code === 'arrangementUnexpectedEnd'));
    assert.deepStrictEqual(unmatched.playOrder.occurrences, []);
  });

  it('T06 conflicts with all written navigation marks and permits %, barlines, and page breaks', () => {
    for (const writtenSection of [
      '|: C | G :|',
      '| C [1.] |',
      '| C | D.C. |',
      '| C | D.S. |',
      '| C | Segno |',
      '| C | Coda |',
      '| C | to Coda |',
      '| C | Fine |'
    ]) {
      const source = `arrangement {\nVerse\n}\n[Verse]\n| G |\n[Unused]\n${writtenSection}`;
      const score = parseGuitarDsl(source);
      assert.ok(score.diagnostics.some(d => d.code === 'arrangementNavigationConflict'), writtenSection);
      assert.deepStrictEqual(score.playOrder.occurrences, [], writtenSection);
    }

    const permitted = validScore('arrangement {\nVerse\n}\n[Verse]\n| C |\n| % ||\npagebreak\n| G |]');
    assert.deepStrictEqual(permitted.playOrder.occurrences.map(o => o.measureIndex), [0, 1, 2]);
  });

  it('T07 checks the 100,000 occurrence limit before allocation and stays isolated after failure', () => {
    const maximum = validScore('arrangement {\nVerse x100000\n}\n[Verse]\n| C |');
    assert.strictEqual(maximum.playOrder.occurrences.length, 100_000);
    assert.strictEqual(maximum.playOrder.occurrences[99_999].occurrenceIndex, 99_999);

    const tooMany = parseGuitarDsl('arrangement {\nVerse x100001\n}\n[Verse]\n| C |');
    assert.ok(tooMany.diagnostics.some(d => d.code === 'playOrderLimitExceeded'));
    assert.deepStrictEqual(tooMany.playOrder, { valid: false, occurrences: [], diagnostics: [] });

    const overflow = parseGuitarDsl('arrangement {\nVerse x9007199254740991\n}\n[Verse]\n| C | D |');
    assert.ok(overflow.diagnostics.some(d => d.code === 'playOrderLimitExceeded'));
    assert.deepStrictEqual(overflow.playOrder.occurrences, []);

    const afterFailure = validScore('arrangement {\nVerse\n}\n[Verse]\n| C |');
    assert.deepStrictEqual(afterFailure.playOrder.occurrences.map(o => o.measureIndex), [0]);
  });

  it('T08 preserves legacy occurrence object shapes when no arrangement is present', () => {
    const legacy = validScore('|: C | [1.] G :| [2.] Am | D.C. | D Fine |');
    assert.ok(legacy.playOrder.occurrences.length > 0);
    assert.ok(legacy.playOrder.occurrences.every(o => !Object.prototype.hasOwnProperty.call(o, 'lyricVerse')));

    const repeated = validScore('arrangement {\nVerse x2\n}\n[Verse]\n| C |');
    assert.deepStrictEqual(repeated.playOrder.occurrences.map(o => o.lyricVerse), [undefined, undefined]);
    assert.ok(repeated.playOrder.occurrences.every(o => !Object.prototype.hasOwnProperty.call(o, 'lyricVerse')));
  });

  it('T09 preserves CRLF, Japanese names, comments, page breaks, directives, and raw-source section consumers', () => {
    const source = [
      'title: Song',
      'arrangement {',
      '# no fake section below',
      ' [Aメロ]',
      '}',
      '[Aメロ]',
      '@tempo: 100',
      '| C |',
      'mel: | c4/1 |',
      'lyr: あ',
      'pagebreak',
      '| % |'
    ].join('\r\n');
    const score = validScore(source);
    assert.deepStrictEqual(score.measures.map(m => m.chord), ['C', 'C']);
    assert.deepStrictEqual(score.playOrder.occurrences.map(o => o.measureIndex), [0, 1]);
    assert.strictEqual(score.events[0].directive, '@tempo');
    assert.strictEqual(score.measures[0].sectionName, 'Aメロ');
    assert.strictEqual(score.pages.length, 2);

    const sections = require('../../src/accompaniment').accompanimentSections(score, source) as { name: string | null }[];
    assert.deepStrictEqual(sections.map(s => s.name), ['Aメロ']);

    const invalid = parseGuitarDsl('arrangement {\nMissing\n}\n[Verse]\n| C |');
    const timeline = buildPlaybackTimeline(invalid);
    assert.deepStrictEqual(timeline, { ok: false, code: 'invalidPlayOrder' });
  });
});
