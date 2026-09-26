import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseGuitarDsl } from '../../src/compiler';
import { MELODY_STAVE_BOTTOM, SYSTEM_UNIT_HEIGHT, estimateTextWidth, getSystemGeometry, layoutScore, splitIntoRows } from '../../src/render/layout';
import { getRenderContext, staffPosition, writtenStaffPosition } from '../../src/render/notation';
import { renderContinuousSvg, renderScoreSheets } from '../../src/render/svg';
import { renderBend } from '../../src/render/technique';

// Unique fragment of the vector natural glyph (src/render/notation.ts).
const NATURAL = 'x1="-2" y1="-8"';

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function svgOf(dsl: string): string {
  return renderContinuousSvg(parseGuitarDsl(dsl));
}

/** The `<g class="system" ...>` groups of a continuous SVG. */
function systems(svg: string): string[] {
  return svg.split('<g class="system"').slice(1);
}

const bar = '| C | 4 4 4 4 |';

describe('render - structural system breaks (T012)', () => {
  const rowsOf = (dsl: string) => splitIntoRows(parseGuitarDsl(dsl))[0].map(r => r.measures.length);

  it('starts a new system at a key or time change', () => {
    assert.deepStrictEqual(rowsOf(`measures_per_row: 4\n${bar}\n${bar}\n@key: D\n${bar}\n${bar}\n${bar}`), [2, 3]);
    assert.deepStrictEqual(rowsOf(`measures_per_row: 4\n${bar}\n${bar}\n@time: 3/4\n| C | 4 4 4 |\n| C | 4 4 4 |`), [2, 2]);
    // Already at a system start: no extra break.
    assert.deepStrictEqual(rowsOf(`measures_per_row: 2\n${bar}\n${bar}\n@key: D\n${bar}\n${bar}`), [2, 2]);
  });

  it('does not break for tempo, feel, dynamics, text or an unchanged key', () => {
    assert.deepStrictEqual(rowsOf(`${bar}\n@tempo: 140\n@feel: swing\n@dynamic: f\n@text: x\n@mark: B\n${bar}\n@key: C\n${bar}\n${bar}\n${bar}`), [4, 1]);
  });

  it('never loses or duplicates measures and is not a page break', () => {
    const lines = [bar];
    for (let i = 0; i < 20; i++) lines.push(i % 3 === 0 ? `@key: ${['D', 'E', 'C'][i % 3 === 0 ? (i / 3) % 3 : 0]}\n${bar}` : bar);
    const score = parseGuitarDsl(lines.join('\n'));
    const rows = splitIntoRows(score);
    assert.strictEqual(rows.length, 1, 'one manual page');
    const flat = rows[0].flatMap(r => r.measures);
    assert.deepStrictEqual(flat, score.measures);
  });
});

describe('render - system prefix (T013, T014, T015, T016)', () => {
  it('keeps the first barline x identical on every system (T013)', () => {
    const dsl = 'key: C\nmeasures_per_row: 2\n| C | 4 4 4 4 |\nmel: | c5/1 |\n@key: F#\n| F# | 4 4 4 4 |\nmel: | f#5/1 |\n@key: Bb\n| Bb | 4 4 4 4 |\nmel: | bb4/1 |\n@time: 12/8\n| Bb | 4. 4. 4. 4. |\nmel: | bb4/1+2 |';
    const score = parseGuitarDsl(dsl);
    assert.deepStrictEqual(score.diagnostics, []);
    const ctx = getRenderContext(score);
    // Widest prefix: F# -> Bb = 6 naturals + 2 flats.
    assert.strictEqual(ctx.startX, 54 + (8 * 7 + 6) + 24);
    const svg = renderContinuousSvg(score);
    const sys = systems(svg);
    assert.strictEqual(sys.length, 4);
    // The end barline of the only measure of each system is at the same x.
    const endBar = (s: string) => s.match(/<line x1="([0-9.]+)" y1="70" x2="\1" y2="102" stroke="#000" stroke-width="1.2"\/>/)?.[1];
    const xs = sys.map(endBar);
    assert.ok(xs[0]);
    assert.ok(xs.every(x => x === xs[0]), xs.join(','));
  });

  it('draws cancellation naturals and the new key signature at a modulation (T014)', () => {
    const score = parseGuitarDsl('key: A\nmeasures_per_row: 4\n| A | 4 4 4 4 |\nmel: | c#5/1 |\n@key: F\n| F | 4 4 4 4 |\nmel: | c5/2 b4/2 |');
    const [first, second] = systems(renderContinuousSvg(score));
    assert.strictEqual(count(first, 'class="key-cancel"'), 0);
    assert.strictEqual(count(second, 'class="key-cancel"'), 3, 'A major (3 sharps) cancelled before F major');
    // In F major the b4 takes the key-signature flat: B natural needs a natural sign in the measure.
    assert.strictEqual(count(second, NATURAL), 3 + 1);
    // Going to a key with fewer sharps cancels only the dropped ones.
    const fewer = systems(svgOf('key: A\n| A |\nmel: | a4/1 |\n@key: G\n| G |\nmel: | g4/1 |'))[1];
    assert.strictEqual(count(fewer, 'class="key-cancel"'), 2);
  });

  it('resets accidentals at a modulation (contract §5.7)', () => {
    // f#5 in C needs a sharp; after @key: D the same f#5 does not; the tied continuation never gets one.
    const svg = svgOf('measures_per_row: 4\n| C | 4 4 4 4 |\nmel: | f#5/1 |\n@key: D\n| D | 4 4 4 4 |\nmel: | f#5/1 |');
    const [c, d] = systems(svg);
    assert.strictEqual(count(c, 'x1="-1.6" y1="-7"'), 1);
    assert.strictEqual(count(d, 'x1="-1.6" y1="-7"'), 2, 'only the two key-signature sharps');
  });

  it('shows Key: text on rhythm-only systems instead of a key signature (T015)', () => {
    const sys = systems(svgOf(`key: C\n${bar}\n@key: D\n| D | 4 4 4 4 |`));
    assert.strictEqual(count(sys[0], 'annotation-key'), 0);
    assert.ok(sys[1].includes('>Key: D</text>'));
    assert.strictEqual(count(sys[1], 'x1="-1.6" y1="-7"'), 0, 'no pitched key signature');
  });

  it('draws time signatures on the first system and meter-change systems only (T016)', () => {
    const dsl = `measures_per_row: 1\n${bar}\n${bar}\n@time: 6/8\n| C | 8 8 8 8 8 8 |\n| C | 8 8 8 8 8 8 |`;
    const sys = systems(svgOf(dsl));
    const ts = (s: string) => Array.from(s.matchAll(/class="time-signature"[^>]*>([0-9]+)</g)).map(m => m[1]).join('/');
    assert.deepStrictEqual(sys.map(ts), ['4/4', '', '6/8', '']);
    const wide = svgOf('time: 12/8\n| C | 4. 4. 4. 4. |');
    assert.ok(wide.includes('text-anchor="middle">12</text>'));
  });
});

describe('render - annotation lanes (T017, T049, T050)', () => {
  const dsl = `${bar}\n@mark: B\n@tempo: 132\n@feel: swing\n@text: Palm mute\n@dynamic: mf\n@ottava: 8va\n| C | 4 4 4 4 |\nmel: | c5/1 |`;

  it('reserves lanes in the system geometry and draws every event class', () => {
    const score = parseGuitarDsl(dsl);
    const rows = splitIntoRows(score)[0];
    const g = rows[0].geometry;
    assert.deepStrictEqual(Array.from(g.lanes.keys()), ['mark', 'tempo', 'text', 'ottava']);
    assert.ok(g.annotationTop > 0 && g.dynamicsBaseline > 0);
    assert.strictEqual(g.unitHeight, g.contentHeight + g.annotationTop + g.annotationBottom);
    const svg = renderContinuousSvg(score);
    for (const cls of ['annotation-mark', 'annotation-tempo', 'annotation-tempo-text', 'annotation-text', 'annotation-dynamic', 'annotation-ottava']) {
      assert.ok(svg.includes(`class="${cls}`), cls);
    }
    assert.ok(svg.includes('>= 132</text>'));
    assert.ok(svg.includes('>Swing</text>'));
    // Lanes come in the documented order: rehearsal mark above tempo above text above ottava.
    const pos = (s: string) => svg.indexOf(s);
    assert.ok(pos('annotation-mark') < pos('annotation-tempo') && pos('annotation-tempo') < pos('annotation-text'));
    // The notation is shifted below the lanes.
    assert.ok(svg.includes(`<g transform="translate(0, ${g.annotationTop})">`));
  });

  it('keeps rhythm-only systems without events at the original height', () => {
    assert.strictEqual(getSystemGeometry(parseGuitarDsl(bar).measures, parseGuitarDsl(bar)).unitHeight, SYSTEM_UNIT_HEIGHT);
  });

  it('shows Straight only when leaving another feel', () => {
    assert.ok(!svgOf(`${bar}\n@feel: straight\n${bar}`).includes('>Straight<'));
    assert.ok(svgOf(`feel: shuffle\n${bar}\n@feel: straight\n${bar}`).includes('>Straight<'));
    assert.ok(svgOf(`feel: shuffle\n${bar}`).includes('>Shuffle<'));
  });

  it('paginates annotated systems without overlap, loss or duplication (T049)', () => {
    const lines: string[] = [];
    for (let i = 0; i < 40; i++) lines.push(`@mark: M${i}\n@tempo: ${100 + i}\n@text: t${i}\n@dynamic: p\n| C | 4.pm 4.pm 4.lr 4.fermata |\nmel: | c5/4{bend:2} d{vibrato} e{staccato} f{fermata} |`);
    const score = parseGuitarDsl(`measures_per_row: 1\n${lines.join('\n')}`);
    assert.deepStrictEqual(score.diagnostics, []);
    const layout = layoutScore(score, 'A4', 'portrait');
    const placed = layout.pages.flatMap(p => p.rows.flatMap(r => r.measures));
    assert.deepStrictEqual(placed, score.measures);
    assert.ok(layout.pages.length > 1);
    layout.pages.forEach(page => {
      const top = page.hasScoreHeader ? layout.header.height + layout.diagrams.height : 24;
      const used = page.rows.reduce((acc, r) => acc + r.geometry.unitHeight * layout.systemScale + layout.systemGap, 0);
      assert.ok(page.rows.length === 1 || top + used - layout.systemGap <= layout.columnHeight - 18 + 1e-6, `page ${page.pageNumber} overflows`);
    });
    const sheets = renderScoreSheets(score, 'A4', 'portrait');
    assert.strictEqual(count(sheets.join(''), 'class="annotation-mark"'), 40);
  });

  it('escapes user text in marks, text and key annotations (T050)', () => {
    const svg = svgOf(`${bar}\n@mark: <A&"'>\n@text: a<b>&c "q"\n${bar}`);
    assert.ok(svg.includes('&lt;A&amp;&quot;&#39;&gt;'));
    assert.ok(svg.includes('a&lt;b&gt;&amp;c &quot;q&quot;'));
    assert.ok(!svg.includes('<A&'));
  });
});

describe('render - ottava (T020)', () => {
  it('draws sounding c5 at c4 under 8va and at c6 under 8vb, keeping the pitch', () => {
    const score = parseGuitarDsl('@ottava: 8va\n| C |\nmel: | c5/4 c c c |\n@ottava: 8vb\n| C |\nmel: | c5/4 c c c |\n@ottava: off\n| C |\nmel: | c5/4 c c c |');
    const pitch = score.measures[0].melody![0].pitch!;
    assert.deepStrictEqual(pitch, { step: 'c', alter: 0, octave: 5 });
    assert.strictEqual(writtenStaffPosition(pitch, '8va'), staffPosition({ step: 'c', alter: 0, octave: 4 }));
    assert.strictEqual(writtenStaffPosition(pitch, '8vb'), staffPosition({ step: 'c', alter: 0, octave: 6 }));
    const svg = renderContinuousSvg(score);
    // c4 (pos -2) at y = 110, c6 (pos 12) at y = 54, c5 (pos 5) at y = 82.
    assert.ok(svg.includes('cy="110"') && svg.includes('cy="54"') && svg.includes('cy="82"'));
  });

  it('splits an ottava span at system boundaries', () => {
    const svg = svgOf('measures_per_row: 1\n@ottava: 8va\n| C |\nmel: | c5/1 |\n| C |\nmel: | c5/1 |\n@ottava: off\n| C |\nmel: | c5/1 |');
    const sys = systems(svg);
    assert.ok(sys[0].includes('>8va</text>'));
    assert.ok(sys[1].includes('>(8va)</text>'), 'continuation label on the next system');
    assert.ok(!sys[2].includes('annotation-ottava'));
  });
});

describe('render - techniques (T028, T029, T030, T031, T032)', () => {
  it('draws hammer, pull, slide, gliss, bend and vibrato distinctly (T028)', () => {
    const svg = svgOf('| C |\nmel: | c5/8{hammer} d{pull} c{slide} e{gliss} c5/4{bend:2,vibrato} g/4 |');
    for (const cls of ['technique-hammer', 'technique-pull', 'technique-slide', 'technique-gliss', 'technique-bend', 'technique-vibrato']) {
      assert.strictEqual(count(svg, `class="${cls}"`), 1, cls);
    }
    assert.ok(svg.includes('>H</text>') && svg.includes('>P</text>'));
    assert.ok(svg.includes('>full</text>'), 'bend amount label');
    const long = svgOf('| C |\nmel: | c5/2{gliss} c6/2 |');
    assert.ok(long.includes('>gliss.</text>'));
  });

  it('draws staccato, tenuto, fermata and breath on notes, rests and slashes (T029)', () => {
    const svg = svgOf('| C | 4.stacc 4.ten 4.fermata 4.breath |\nmel: | c5/4{staccato} d{tenuto} e{fermata} r/4{breath} |');
    assert.strictEqual(count(svg, 'class="technique-staccato"'), 2);
    assert.strictEqual(count(svg, 'class="technique-tenuto"'), 2);
    assert.strictEqual(count(svg, 'class="technique-fermata"'), 2);
    assert.strictEqual(count(svg, 'class="technique-breath"'), 2);
    // The slash fermata sits in the technique lane of the system.
    assert.ok(splitIntoRows(parseGuitarDsl('| C | 4 4 4 4.fermata |'))[0][0].geometry.lanes.has('techniqueMarks'));
  });

  it('draws grace notes small before the next timed note', () => {
    const svg = svgOf('| C |\nmel: | c5/16{grace} d5/4 e f g |');
    assert.strictEqual(count(svg, 'class="technique-grace"'), 1);
    assert.ok(svg.includes('scale(0.62)'));
  });

  it('draws slurs and splits cross-system connections (T030)', () => {
    const one = svgOf('| C |\nmel: | c5/4{slur-start} d e f{slur-end} |');
    assert.strictEqual(count(one, 'class="technique-slur"'), 1);
    const split = svgOf('measures_per_row: 1\n| C |\nmel: | c5/2 d5/2{slur-start} |\n| C |\nmel: | e5/2 f5/2{slur-end} |\n| C |\nmel: | g5/2{hammer} a5/2 |');
    const sys = systems(split);
    assert.strictEqual(count(sys[0], 'class="technique-slur"'), 1, 'outgoing piece');
    assert.strictEqual(count(sys[1], 'class="technique-slur"'), 1, 'incoming piece');
    const hammer = systems(svgOf('measures_per_row: 1\n| C |\nmel: | c5/2 d5/2{hammer} |\n| C |\nmel: | e5/1 |'));
    assert.strictEqual(count(hammer[0], 'class="technique-hammer"'), 1);
    assert.strictEqual(count(hammer[1], 'class="technique-hammer"'), 1);
    // Every piece stays inside its own system group.
    for (const s of sys) assert.ok(!s.includes('NaN'));
  });

  it('coalesces palm mute / let ring into spans and splits them at systems (T031)', () => {
    const svg = svgOf('| C | 8.pm 8.pm 8.pm 8.pm 4 4.lr |');
    assert.strictEqual(count(svg, 'class="technique-pm"'), 1);
    assert.strictEqual(count(svg, '>P.M.</text>'), 1);
    assert.strictEqual(count(svg, 'class="technique-let-ring"'), 1);
    const two = svgOf('| C | 4.pm 4.pm 4 4.pm |');
    assert.strictEqual(count(two, '>P.M.</text>'), 2);
    const sys = systems(svgOf('measures_per_row: 1\n| C | 4 4 4.pm 4.pm |\n| C | 4.pm 4.pm 4 4 |'));
    assert.ok(sys[0].includes('>P.M.</text>'));
    assert.ok(sys[1].includes('>(P.M.)</text>'));
    // Melody and rhythm spans over the same notes merge into one span.
    const merged = svgOf('| C | 4.pm 4.pm 4 4 |\nmel: | c5/4{pm} d{pm} e f |');
    assert.strictEqual(count(merged, '>P.M.</text>'), 1);
  });

  it('keeps the existing arpeggiato rendering (T032)', () => {
    const svg = svgOf('| C | 1.d.arp |\n| C | 4.arpeggio 4 4 4 |');
    assert.strictEqual(count(svg, 'stroke-width="1.3" stroke-linecap="round"/><path d="M'), 2);
  });

  it('draws inline-note techniques on the rhythm staff', () => {
    const svg = svgOf('| C | c4/8{hammer} d4/8 e4/4{bend:1} c4/8{grace} g4/4 f4/4{staccato} |');
    assert.strictEqual(count(svg, 'class="technique-hammer"'), 1);
    assert.strictEqual(count(svg, 'class="technique-bend"'), 1);
    assert.strictEqual(count(svg, 'class="technique-grace"'), 1);
    assert.strictEqual(count(svg, 'class="technique-staccato"'), 1);
  });

  it('draws the actual number for general tuplets', () => {
    const svg = svgOf('| C | 8{5:4} 8{5:4} 8{5:4} 8{5:4} 8{5:4} 4 4 |\nmel: | c5/8{6:4} d e f g a b/2 |');
    assert.strictEqual(count(svg, 'class="tuplet-number"'), 2);
    assert.ok(svg.includes('>5</text>') && svg.includes('>6</text>'));
    assert.deepStrictEqual(parseGuitarDsl('| C | 8t 8t 4 4 4 8t |').diagnostics.map(d => d.code), ['incompleteTupletGroup']);
  });
});

describe('render - advanced sample (T048)', () => {
  it('parses without errors and renders continuous and paged SVG', () => {
    const text = fs.readFileSync(path.join(__dirname, '../../samples/sample_advanced_notation.guitardsl'), 'utf8');
    const score = parseGuitarDsl(text);
    assert.deepStrictEqual(score.diagnostics.filter(d => d.severity === 'error'), []);
    assert.ok(renderContinuousSvg(score).startsWith('<svg'));
    const sheets = renderScoreSheets(score, 'A4', 'portrait');
    assert.ok(sheets.length >= 1);
    assert.ok(renderScoreSheets(score, 'A4', 'landscape').length >= 1);
  });
});

describe('render - legacy regression (T002)', () => {
  // The only serialization change for legacy scores is the class attribute on time signature digits and
  // tuplet numbers; every coordinate must stay byte-identical to the renders before score events existed.
  const normalize = (svg: string) => svg.replace(/ class="(time-signature|tuplet-number)"/g, '');
  const sha = (s: string) => require('crypto').createHash('sha256').update(s).digest('hex');
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/legacy-render-hashes.json'), 'utf8')).hashes as Record<string, string>;

  for (const [name, hash] of Object.entries(fixture)) {
    it(`renders ${name} exactly as before`, () => {
      const [file, mode] = name.replace(/\.svg$/, '').split(/\.(?=cont$|a4$|land$)/);
      const score = parseGuitarDsl(fs.readFileSync(path.join(__dirname, '../../samples', file), 'utf8'));
      const svg = mode === 'cont'
        ? renderContinuousSvg(score)
        : renderScoreSheets(score, 'A4', mode === 'a4' ? 'portrait' : 'landscape').join('\n');
      assert.strictEqual(sha(normalize(svg)), hash);
    });
  }
});

describe('render - PR #69 review delta (dynamics collision, bend direction)', () => {
  /** [startY, curveEndY, arrowTipY] of each technique-bend group. */
  const bends = (svg: string) =>
    [...svg.matchAll(/class="technique-bend"><path d="M [\d.-]+,([\d.-]+) Q [\d.-]+,[\d.-]+ [\d.-]+,([\d.-]+)"[^>]*\/><path d="M [\d.-]+,[\d.-]+ L [\d.-]+,([\d.-]+)/g)]
      .map(m => [Number(m[1]), Number(m[2]), Number(m[3])]);

  it('places several dynamics before one measure left to right without overlap (D004, D005)', () => {
    const score = parseGuitarDsl(`@dynamic: p\n@dynamic: sfz\n${bar}`);
    const g = splitIntoRows(score)[0][0].geometry;
    // Both share one baseline in the free space under the staff; the system does not grow for them.
    assert.strictEqual(g.annotationBottom, 0);
    const dyn = [...renderContinuousSvg(score).matchAll(/class="annotation-dynamic" x="([\d.-]+)"[^>]*>([^<]*)</g)];
    assert.deepStrictEqual(dyn.map(m => m[2]), ['p', 'sfz']);
    const [x1, x2] = dyn.map(m => Number(m[1]));
    assert.ok(x2 >= x1 + estimateTextWidth('p', 12, true) + 8 - 0.01, `sfz at ${x2} overlaps p at ${x1}`);
  });

  it('keeps the bend arrow above a high melody note (D006)', () => {
    const svg = svgOf('| C | 4 4 4 4 |\nmel: | f6/4{bend:2} g6/4 a6/2 |');
    const b = bends(svg);
    assert.strictEqual(b.length, 1);
    const [startY, curveEnd, tip] = b[0];
    assert.ok(curveEnd < startY && tip < startY, `bend points down: start ${startY}, end ${curveEnd}, tip ${tip}`);
    assert.ok(svg.includes('>full</text>'));
  });

  it('keeps the bend arrow above a high inline note (D008)', () => {
    const b = bends(svgOf('| C | f6/4{bend:2} 4 4 4 |'));
    assert.strictEqual(b.length, 1);
    assert.ok(b[0][1] < b[0][0] && b[0][2] < b[0][0]);
  });

  it('enforces a minimum rise in the shared helper and keeps valid endpoints (D007, D008)', () => {
    const [[, , clampedTip]] = bends(renderBend(0, 50, 80, 2));
    assert.ok(clampedTip <= 40);
    const [[, , tip]] = bends(renderBend(0, 50, 20, 2));
    assert.strictEqual(tip, 20);
  });
});

describe('render - annotation lanes close to the staff', () => {
  const geometry = (dsl: string) => splitIntoRows(parseGuitarDsl(dsl))[0][0].geometry;
  const staffBottom = (g: ReturnType<typeof geometry>) => g.annotationTop + g.rhythmOffset + MELODY_STAVE_BOTTOM;

  it('puts dynamics right under the rhythm staff without growing the system', () => {
    const g = geometry(`@dynamic: mf\n${bar}`);
    assert.strictEqual(g.annotationBottom, 0);
    assert.strictEqual(g.unitHeight, SYSTEM_UNIT_HEIGHT);
    const gap = g.dynamicsBaseline - staffBottom(g);
    assert.ok(gap >= 12 && gap <= 18, `baseline ${gap} below the staff`);
    const svg = svgOf(`@dynamic: mf\n${bar}`);
    assert.ok(svg.includes(`class="annotation-dynamic" x="`) && svg.includes(`y="${g.dynamicsBaseline}"`));
  });

  it('puts dynamics under the rhythm staff of a melody system', () => {
    const g = geometry(`@dynamic: mf\n${bar}\nmel: | c5/1 |\nlyr: | la |`);
    assert.strictEqual(g.kind, 'melody');
    const gap = g.dynamicsBaseline - staffBottom(g);
    assert.ok(gap >= 12 && gap <= 18);
    assert.ok(g.dynamicsBaseline + 4 <= g.unitHeight);
  });

  it('keeps dynamics below a measure lyric and low inline notes, growing the system only as needed', () => {
    const lyric = geometry(`@dynamic: mf\n| C | 4 4 4 4 l:"words" |`);
    assert.ok(lyric.dynamicsBaseline - staffBottom(lyric) >= 18 + 12, 'below the lyric line (staff + 18)');
    assert.strictEqual(lyric.unitHeight, SYSTEM_UNIT_HEIGHT + lyric.annotationBottom);
    const low = geometry(`@dynamic: mf\n| C | e3/8{hammer} f3/8 g3/4 a3/4 b3/4 |`);
    const e3 = MELODY_STAVE_BOTTOM + 6 * 4;
    assert.ok(low.dynamicsBaseline - low.annotationTop > e3 + 34, 'below the hammer-on arc of e3');
    assert.ok(low.annotationBottom > 0);
  });

  it('overlaps the top lanes with the free space above the chord names only', () => {
    const free = geometry(`@text: x\n${bar}`);
    assert.ok(free.annotationTop < 14 && free.annotationTop >= 0, `annotationTop ${free.annotationTop}`);
    assert.strictEqual(free.lanes.get('text'), 0);
    const section = geometry(`[Verse]\n@text: x\n${bar}`);
    assert.strictEqual(section.annotationTop, 14);
    const high = geometry(`@text: x\n${bar}\nmel: | a7/1 |`);
    assert.ok(high.annotationTop > free.annotationTop, 'a note above the chord names limits the overlap');
  });
});
