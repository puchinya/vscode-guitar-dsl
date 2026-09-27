import * as assert from 'assert';
import { parseGuitarDsl } from '../../src/compiler';
import { getSystemGeometry } from '../../src/render/layout';
import { GROUP_HEAD_SHIFT, accidentalColumns, groupHeadOffsets, groupStemUp, ledgerLinePositions } from '../../src/render/notation';
import { renderContinuousSvg } from '../../src/render/svg';

// Note groups on the melody staff and the rhythm staff (spec §18.3, Issue #72).

const SHARP = 'x1="-1.6" y1="-7"';
const FLAT = 'x1="-2.2" y1="-10"';
const BEAM = 'stroke-width="3.6"';
const STEM = 'stroke-width="1.35"';

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function svgOf(dsl: string): string {
  return renderContinuousSvg(parseGuitarDsl(dsl));
}

/** Filled noteheads (quarter and shorter) as [cx, cy]. */
function heads(svg: string): [number, number][] {
  return [...svg.matchAll(/<ellipse class="notehead" cx="([\d.-]+)" cy="([\d.-]+)"/g)].map(m => [Number(m[1]), Number(m[2])]);
}

/** Positions of the sharp glyphs. */
function sharps(svg: string): [number, number][] {
  return [...svg.matchAll(/<g transform="translate\(([\d.-]+), ([\d.-]+)\)" stroke="#000" fill="none"><line x1="-1.6" y1="-7"/g)].map(m => [Number(m[1]), Number(m[2])]);
}

/** Tie arcs (renderTieArc: two quadratic curves closing a filled crescent). */
function ties(svg: string): number {
  return (svg.match(/<path d="M [\d.-]+,[\d.-]+ Q [\d.-]+,[\d.-]+ [\d.-]+,[\d.-]+ Q [\d.-]+,[\d.-]+ [\d.-]+,[\d.-]+ Z" fill="#000"\/>/g) ?? []).length;
}

describe('render - note group helpers', () => {
  it('chooses the stem from the member farthest from the middle line, down on a tie', () => {
    assert.strictEqual(groupStemUp([-2, 0, 2]), true);
    assert.strictEqual(groupStemUp([6, 8, 10]), false);
    assert.strictEqual(groupStemUp([2, 6]), false);
    assert.strictEqual(groupStemUp([-3, 10]), true);
  });

  it('alternates seconds to the other side of the stem', () => {
    assert.deepStrictEqual(groupHeadOffsets([-2, -1, 2], true), [0, GROUP_HEAD_SHIFT, 0]);
    assert.deepStrictEqual(groupHeadOffsets([-2, -1, 0], true), [0, GROUP_HEAD_SHIFT, 0]);
    assert.deepStrictEqual(groupHeadOffsets([7, 8], false), [-GROUP_HEAD_SHIFT, 0]);
    assert.deepStrictEqual(groupHeadOffsets([0, 2, 4], true), [0, 0, 0]);
  });

  it('stacks overlapping accidentals into leftward columns and ledger lines once', () => {
    // Top to bottom: the highest accidental stays nearest the heads.
    assert.deepStrictEqual(accidentalColumns([{ y: 110, alter: 1 }, { y: 106, alter: 1 }, { y: 94, alter: 0 }]), [2, 1, 0]);
    assert.deepStrictEqual(accidentalColumns([{ y: 70, alter: 1 }, { y: 102, alter: -1 }]), [0, 0]);
    assert.deepStrictEqual(ledgerLinePositions([-4, -3, -2]), [-2, -4]);
    assert.deepStrictEqual(ledgerLinePositions([-2, 12]), [-2, 10, 12]);
  });
});

describe('render - note groups', () => {
  it('draws a triad as three heads on one stem (30)', () => {
    const group = svgOf('| C |\nmel: | [c4,e4,g4]/4 r/2. |');
    const single = svgOf('| C |\nmel: | c4/4 r/2. |');
    assert.strictEqual(heads(group).length - heads(single).length, 2);
    assert.strictEqual(count(group, STEM), count(single, STEM));
    // Thirds need no displacement: all three heads share the x of the single note.
    assert.deepStrictEqual([...new Set(heads(group).map(([x]) => x))], [heads(single)[0][0]]);
  });

  it('moves the second of an adjacent pair beside the stem (31)', () => {
    for (const dsl of ['| C |\nmel: | [c4,d4,g4]/4 r/2. |', '| C [c4,d4,g4]/4 2.d 4.d |']) {
      const h = heads(svgOf(dsl));
      const keys = h.map(([x, y]) => `${x},${y}`);
      assert.strictEqual(new Set(keys).size, keys.length, dsl);
      const [c4, d4] = [...h].sort((a, b) => b[1] - a[1]);
      assert.strictEqual(d4[1], c4[1] - 4, dsl);
      assert.ok(Math.abs(d4[0] - c4[0] - GROUP_HEAD_SHIFT) < 0.05, dsl);
    }
  });

  it('keeps simultaneous accidentals apart (32)', () => {
    for (const dsl of ['| C |\nmel: | [c#4,d#4,g4]/4 r/2. |', '| C [c#4,d#4,g4]/4 2.d 4.d |']) {
      const s = sharps(svgOf(dsl));
      assert.strictEqual(s.length, 2, dsl);
      // Two sharps a second apart would overlap in one column.
      assert.notStrictEqual(s[0][0], s[1][0], dsl);
    }
    const flats = svgOf('| C |\nmel: | [eb4,gb4,bb4]/2 r/2 |');
    assert.strictEqual(count(flats, FLAT), 3);
  });

  it('draws ledger lines once for all members', () => {
    const svg = svgOf('| C |\nmel: | [a3,c4]/2 r/2 |');
    const ledgers = [...svg.matchAll(/<line x1="[\d.-]+" y1="([\d.-]+)" x2="[\d.-]+" y2="\1" stroke="#000" stroke-width="1"\/>/g)].map(m => m[1]);
    assert.strictEqual(ledgers.filter(y => y === '110').length, 1);
  });

  it('lets every member count for the layout ink (33)', () => {
    const lift = (mel: string) => {
      const score = parseGuitarDsl(`| C |\nmel: | ${mel} |`);
      return getSystemGeometry(score.measures, score).lift;
    };
    assert.ok(lift('[c4,e6]/1') < lift('[c4,e4]/1'));
    assert.strictEqual(lift('[c4,e6]/1'), lift('e6/1'));
    assert.strictEqual(lift('[c#4,e4]/1'), lift('c#4/1'));
    const baseline = (mel: string) => {
      const score = parseGuitarDsl(`| C |\nmel: | ${mel} |\nlyr: あ`);
      return getSystemGeometry(score.measures, score).lyricBaseline;
    };
    assert.ok(baseline('[f3,e5]/1') > baseline('e5/1'));
    // Rhythm staff: the dynamics sit under the lowest member; the top lanes stay above the highest.
    const dyn = (bar: string) => {
      const score = parseGuitarDsl(`@dynamic: f\n| C ${bar} |`);
      return getSystemGeometry(score.measures, score).dynamicsBaseline;
    };
    assert.ok(dyn('[f3,c5]/1') > dyn('[c5,e5]/1'));
    assert.strictEqual(dyn('[f3,c4]/1'), dyn('f3/1'));
    const annotationTop = (bar: string) => {
      const score = parseGuitarDsl(`@text: rit\n| C ${bar} |`);
      return getSystemGeometry(score.measures, score).annotationTop;
    };
    assert.ok(annotationTop('[c4,c6]/1') >= annotationTop('c4/1'));
    assert.strictEqual(annotationTop('[c4,c7]/1'), annotationTop('c7/1'));
  });

  it('keeps the header lift clear of a high group (Issue #70)', () => {
    const score = parseGuitarDsl('| C |\nmel: | [c5,a5,e6]/4 r/2. |');
    const g = getSystemGeometry(score.measures, score);
    const svg = renderContinuousSvg(score);
    const topHead = Math.min(...heads(svg).map(([, y]) => y));
    // Chord names sit on y = 33 before the lift; the highest head stays below them.
    assert.ok(33 + g.lift + 4 < topHead - 5, `lift ${g.lift}, top head ${topHead}`);
  });

  it('ties every member across a compound length (34)', () => {
    assert.strictEqual(ties(svgOf('| C |\nmel: | [c4,e4,g4]/4+16 r/16 r/2 |')), 3);
    assert.strictEqual(ties(svgOf('| C |\nmel: | [c4,e4,g4]/4 r/16 r/16 r/2 |')), 0);
    assert.strictEqual(ties(svgOf('| C [c4,e4]/2+4 4.d |')), 2);
    // Inline single notes keep their existing rendering (no tie between parts).
    assert.strictEqual(ties(svgOf('| C c4/2+4 4.d |')), 0);
  });

  it('renders a let-based score exactly like the inlined score (35)', () => {
    const viaLet = svgOf(['let hit = [c4,e4,g4]/4', 'let pick = 8.d [c4,e4]/8 e4/8 g 8.u 8.d 4.d', '| C | $hit $hit 2.d |', 'mel: | $hit $hit r/2 |', '| G | $pick |'].join('\n'));
    const inline = svgOf(['| C | [c4,e4,g4]/4 [c4,e4,g4]/4 2.d |', 'mel: | [c4,e4,g4]/4 [c4,e4,g4]/4 r/2 |', '| G | 8.d [c4,e4]/8 e4/8 g 8.u 8.d 4.d |'].join('\n'));
    assert.strictEqual(viaLet, inline);
  });

  it('draws group techniques at the outer heads', () => {
    const svg = svgOf('| C |\nmel: | [c4,e4,g4]/4{staccato} [c4,e4,g4]/4{fermata} r/2 |');
    const dot = [...svg.matchAll(/<circle class="technique-staccato" cx="([\d.-]+)" cy="([\d.-]+)"/g)].map(m => Number(m[2]));
    const lowest = Math.max(...heads(svg).map(([, y]) => y));
    assert.ok(dot.length === 1 && dot[0] > lowest, `staccato below the lowest head: ${dot} / ${lowest}`);
    // The fermata goes above the highest head.
    const fermata = [...svg.matchAll(/<circle cx="[\d.-]+" cy="([\d.-]+)" r="1.3"/g)].map(m => Number(m[1]));
    const highest = Math.min(...heads(svg).map(([, y]) => y));
    assert.ok(fermata.length === 1 && fermata[0] < highest, `fermata above the highest head: ${fermata} / ${highest}`);
  });
});

describe('render - melody beams keep note-group stems (PR #73 review A-2)', () => {
  /** Melody stems (x1 == x2) as { x, top, bottom }. */
  const stems = (svg: string) => [...svg.matchAll(/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="\1" y2="([\d.-]+)" stroke="#000" stroke-width="1.35"\/>/g)]
    .map(m => ({ x: Number(m[1]), y1: Number(m[2]), y2: Number(m[3]) }));

  it('keeps [g4,d5] (equal distance) stem-down next to a low group in the same beat', () => {
    const svg = svgOf('| C |\nmel: | [g4,d5]/8 [c4,e4]/8 r/4 r/2 |');
    const [first, second] = stems(svg);
    assert.ok(first.y2 > first.y1, `[g4,d5] stem goes down: ${JSON.stringify(first)}`);
    assert.ok(second.y2 < second.y1, `[c4,e4] stem goes up: ${JSON.stringify(second)}`);
    // The two directions cannot share one beam: each is flagged instead.
    assert.strictEqual(count(svg, BEAM), 0);
  });

  it('beams single notes in the direction of the note group of their run', () => {
    const svg = svgOf('| C |\nmel: | [g4,d5]/8 c4/8 r/4 r/2 |');
    const [group, single] = stems(svg);
    assert.strictEqual(count(svg, BEAM), 1);
    assert.ok(group.y2 > group.y1 && single.y2 > single.y1, 'both stems down under one beam');
    // Without a note group the mean position rule is unchanged (c4 e4 -> up).
    const plain = stems(svgOf('| C |\nmel: | c4/8 e4/8 r/4 r/2 |'));
    assert.ok(plain.every(st => st.y2 < st.y1));
  });

  it('estimates the same beam directions for the header lift', () => {
    const lift = (mel: string) => {
      const score = parseGuitarDsl(`| C |\nmel: | ${mel} |`);
      return getSystemGeometry(score.measures, score).lift;
    };
    // Stem-up beams from the average would reach far above; the kept stem-down group does not.
    assert.strictEqual(lift('[g4,d5]/8 [c4,e4]/8 r/4 r/2'), lift('[g4,d5]/4 [c4,e4]/8 r/8 r/2'));
  });
});

describe('render - inline note groups (Issue #72 supplement)', () => {
  it('beams stem-up groups with the slashes and draws stem-down groups unbeamed with down flags', () => {
    assert.strictEqual(count(svgOf('| C [c4,e4]/8 [c4,e4]/8 4.d 2.d |'), BEAM), 1);
    const down = svgOf('| C [f5,a5]/8 [f5,a5]/8 4.d 2.d |');
    assert.strictEqual(count(down, BEAM), 0);
    assert.strictEqual(count(down, 'scale(0.85, -1)'), 2);
    // The stem-down group splits its beat group: 8.d | group | 8.d 8.u -> one beam instead of two.
    assert.strictEqual(count(svgOf('| C 8.d [f5,a5]/8 8.d 8.u 2.d |'), BEAM), 1);
    assert.strictEqual(count(svgOf('| C 8.d 8.d 8.d 8.u 2.d |'), BEAM), 2);
  });

  it('shows inline accidentals by alteration and mel: accidentals by the key', () => {
    const base = count(svgOf('key: D\n| D a4/1 |'), SHARP);
    assert.strictEqual(count(svgOf('key: D\n| D [f#4,a4]/1 |'), SHARP), base + 1);
    const melBase = count(svgOf('key: D\n| D |\nmel: | a4/1 |'), SHARP);
    assert.strictEqual(count(svgOf('key: D\n| D |\nmel: | [f#4,a4]/1 |'), SHARP), melBase);
  });

  it('keeps single inline notes and slashes unchanged', () => {
    const dsl = '| C c4/8 e4/8 8.d 8.u 4.d 2.d |';
    assert.strictEqual(svgOf(dsl), svgOf(dsl));
    assert.strictEqual(count(svgOf(dsl), BEAM), 2);
  });
});
