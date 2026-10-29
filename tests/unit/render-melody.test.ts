import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseGuitarDsl } from '../../src/compiler';
import { MELODY_STAVE_BOTTOM, MELODY_STAVE_TOP, STAFF_LEFT_EDGE, SYSTEM_UNIT_HEIGHT, getSystemGeometry, layoutScore, splitIntoRows } from '../../src/render/layout';
import { fmt, getRenderContext, measureBounds } from '../../src/render/notation';
import { renderContinuousSvg, renderScoreSheets } from '../../src/render/svg';

// Unique fragments of the vector accidental glyphs (src/render/notation.ts).
const SHARP = 'x1="-1.6" y1="-7"';
const FLAT = 'x1="-2.2" y1="-10"';
const NATURAL = 'x1="-2" y1="-8"';

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function svgOf(dsl: string): string {
  return renderContinuousSvg(parseGuitarDsl(dsl));
}

function staffGroupConnectors(svg: string): string[] {
  return [...svg.matchAll(/<g class="staff-group-connector" pointer-events="none">([\s\S]*?)<\/g>/g)]
    .map(match => match[1]);
}

type Point = [number, number];
type CubicSegment = { start: Point; control1: Point; control2: Point; end: Point };

function parseCubicPath(pathData: string): { start: Point; segments: CubicSegment[] } {
  const tokens = pathData.match(/[MCZ]|-?(?:\d+(?:\.\d*)?|\.\d+)/g) ?? [];
  let index = 0;
  let current: Point | undefined;
  let start: Point | undefined;
  const segments: CubicSegment[] = [];

  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M') {
      current = [Number(tokens[index++]), Number(tokens[index++])];
      start = current;
    } else if (command === 'C' && current) {
      const control1: Point = [Number(tokens[index++]), Number(tokens[index++])];
      const control2: Point = [Number(tokens[index++]), Number(tokens[index++])];
      const end: Point = [Number(tokens[index++]), Number(tokens[index++])];
      segments.push({ start: current, control1, control2, end });
      current = end;
    } else if (command === 'Z') {
      break;
    } else {
      throw new Error(`Unsupported brace path command: ${command}`);
    }
  }

  assert.ok(start, 'brace path has a move-to point');
  assert.ok(segments.length > 0, 'brace path has cubic segments');
  assert.deepStrictEqual(segments[segments.length - 1].end, start, 'cubic contour closes at its start point');
  return { start, segments };
}

function cubicPoint(segment: CubicSegment, t: number): Point {
  const u = 1 - t;
  return [
    u ** 3 * segment.start[0] + 3 * u ** 2 * t * segment.control1[0] + 3 * u * t ** 2 * segment.control2[0] + t ** 3 * segment.end[0],
    u ** 3 * segment.start[1] + 3 * u ** 2 * t * segment.control1[1] + 3 * u * t ** 2 * segment.control2[1] + t ** 3 * segment.end[1]
  ];
}

function horizontalContourIntersections(segments: CubicSegment[], y: number): number[] {
  const xs: number[] = [];
  for (const segment of segments) {
    const samples = 64;
    let previousT = 0;
    let previous = cubicPoint(segment, previousT);
    if (Math.abs(previous[1] - y) < 1e-7) xs.push(previous[0]);

    for (let step = 1; step <= samples; step++) {
      const currentT = step / samples;
      const current = cubicPoint(segment, currentT);
      const crosses = (previous[1] < y && current[1] > y) || (previous[1] > y && current[1] < y);
      if (crosses) {
        let low = previousT;
        let high = currentT;
        for (let iteration = 0; iteration < 32; iteration++) {
          const middle = (low + high) / 2;
          const middleY = cubicPoint(segment, middle)[1];
          if ((previous[1] < y && middleY < y) || (previous[1] > y && middleY > y)) low = middle;
          else high = middle;
        }
        xs.push(cubicPoint(segment, (low + high) / 2)[0]);
      }
      if (Math.abs(current[1] - y) < 1e-7) xs.push(current[0]);
      previousT = currentT;
      previous = current;
    }
  }

  return xs
    .sort((a, b) => a - b)
    .filter((x, index, sorted) => index === 0 || Math.abs(x - sorted[index - 1]) > 1e-3);
}

function braceSmoothJoinAngles(segments: CubicSegment[]): number[] {
  const angles: number[] = [];
  for (let index = 0; index < segments.length; index++) {
    const previous = segments[index];
    const next = segments[(index + 1) % segments.length];
    const [x, y] = previous.end;
    // The tips and center waist are intentionally pointed; test continuity on the remaining joins.
    if ([0, 100, 200].some(pointY => Math.abs(y - pointY) < 1e-7)) continue;

    const outgoing: Point = [x - previous.control2[0], y - previous.control2[1]];
    const incoming: Point = [next.control1[0] - next.start[0], next.control1[1] - next.start[1]];
    const dot = outgoing[0] * incoming[0] + outgoing[1] * incoming[1];
    const magnitude = Math.hypot(...outgoing) * Math.hypot(...incoming);
    assert.ok(magnitude > 0, `non-cusp join at (${x}, ${y}) has non-zero tangents`);
    angles.push(Math.acos(Math.max(-1, Math.min(1, dot / magnitude))) * 180 / Math.PI);
  }
  return angles;
}

function lineSegmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const orientation = (p: Point, q: Point, r: Point): number =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const onSegment = (p: Point, q: Point, r: Point): boolean =>
    q[0] >= Math.min(p[0], r[0]) - 1e-7 && q[0] <= Math.max(p[0], r[0]) + 1e-7 &&
    q[1] >= Math.min(p[1], r[1]) - 1e-7 && q[1] <= Math.max(p[1], r[1]) + 1e-7;
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (((o1 > 1e-7 && o2 < -1e-7) || (o1 < -1e-7 && o2 > 1e-7)) &&
      ((o3 > 1e-7 && o4 < -1e-7) || (o3 < -1e-7 && o4 > 1e-7))) return true;
  return (Math.abs(o1) <= 1e-7 && onSegment(a, c, b)) ||
    (Math.abs(o2) <= 1e-7 && onSegment(a, d, b)) ||
    (Math.abs(o3) <= 1e-7 && onSegment(c, a, d)) ||
    (Math.abs(o4) <= 1e-7 && onSegment(c, b, d));
}

function bracePathHasSelfIntersection(start: Point, segments: CubicSegment[]): boolean {
  const points: Point[] = [start];
  const subdivisions = 48;
  for (const segment of segments) {
    for (let step = 1; step <= subdivisions; step++) points.push(cubicPoint(segment, step / subdivisions));
  }
  const lines = points.slice(1).map((point, index) => [points[index], point] as const);
  for (let first = 0; first < lines.length; first++) {
    for (let second = first + 2; second < lines.length; second++) {
      if (first === 0 && second === lines.length - 1) continue;
      if (lineSegmentsIntersect(lines[first][0], lines[first][1], lines[second][0], lines[second][1])) return true;
    }
  }
  return false;
}

describe('render - melody systems', () => {
  it('renders spaced and space-free variants of the exact #76 lyrics identically', () => {
    const spaced = [
      'key: C',
      '| C  | 8.d 8.u 4.d 8.d 8.u 4.d |',
      '| G  | % |',
      'mel: | r/8 e4/8 e g a g e d | d4/8 d e d c/4 r/4 |',
      'lyr: | あさの ひかりを      | あびなが ら         |'
    ].join('\n');
    const spaceFree = spaced.replace(
      'lyr: | あさの ひかりを      | あびなが ら         |',
      'lyr: | あさのひかりを | あびながら |'
    );

    assert.strictEqual(svgOf(spaced), svgOf(spaceFree));
  });

  it('keeps rhythm-only systems at the original height', () => {
    const score = parseGuitarDsl('| C | 4.d 4.d 4.d 4.d |');
    assert.strictEqual(getSystemGeometry(score.measures, score).unitHeight, SYSTEM_UNIT_HEIGHT);
    assert.strictEqual(getSystemGeometry(score.measures, score).kind, 'rhythm');
  });

  it('draws a smooth geometric reference brace only around guitar TAB/rhythm staves', () => {
    const score = parseGuitarDsl([
      'measures_per_row: 1',
      'show_rhythm: true',
      '| C 4 4 4 4 | D 4 4 4 4 |',
      'tab: | 6f0/1 | 6f1/1 |'
    ].join('\n'));
    const continuous = renderContinuousSvg(score);
    const groups = staffGroupConnectors(continuous);
    const rows = splitIntoRows(score).flat();
    assert.strictEqual(groups.length, rows.length);

    const reference = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'specs', 'gui_design', 'proposals', 'issue-160', 'standard-brace-reference.svg'), 'utf8');
    const referencePath = reference.match(/<path class="staff-brace" d="([^"]+)"/)?.[1];
    assert.ok(referencePath, 'reference SVG contains the approved brace path');
    assert.ok((referencePath.match(/\bC\b/g) ?? []).length >= 10, 'brace contour uses smooth cubic Bézier curves');
    assert.strictEqual((referencePath.match(/\bL\b/g) ?? []).length, 0, 'brace contour avoids polygonal line segments');
    const braceGeometry = parseCubicPath(referencePath);
    const waistXs = horizontalContourIntersections(braceGeometry.segments, 100);
    assert.ok(waistXs.length >= 2, 'brace contour intersects the waist on both sides');
    assert.ok(waistXs[waistXs.length - 1] - waistXs[0] <= 1.5, 'center pinch is at most 1.5 units wide at 200-unit reference height');
    const tangentAngles = braceSmoothJoinAngles(braceGeometry.segments);
    assert.ok(Math.max(...tangentAngles) <= 15, 'non-pointed cubic joins preserve tangent continuity within 15 degrees');
    assert.strictEqual(bracePathHasSelfIntersection(braceGeometry.start, braceGeometry.segments), false, 'flattened cubic contour does not cross or touch itself');
    const context = getRenderContext(score);

    groups.forEach((group, index) => {
      const geometry = rows[index].geometry;
      const bodyShift = geometry.annotationTop - geometry.lift;
      assert.strictEqual((group.match(/class="staff-brace"/g) ?? []).length, 1);
      assert.strictEqual((group.match(/class="staff-bracket"/g) ?? []).length, 0);
      assert.strictEqual((group.match(/class="staff-group-left-connector"/g) ?? []).length, 1);
      assert.strictEqual((group.match(/class="staff-group-barline-connector"/g) ?? []).length, 1);
      assert.ok(group.includes(`d="${referencePath}"`), 'uses the exact filled brace silhouette from the reference');
      const brace = group.match(/<path class="staff-brace"[^>]*\/>/)?.[0];
      assert.ok(brace?.includes('fill="#000"') && !brace.includes('stroke='), 'brace is a black filled path');
      assert.ok(brace?.includes('transform="translate(0 ' + fmt(bodyShift + geometry.tabOffset)), 'brace starts at the TAB staff and stays inside the left margin');

      const left = group.match(/<line class="staff-group-left-connector" x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/);
      assert.ok(left);
      const rhythmOffset = geometry.finalRhythmOffset;
      assert.deepStrictEqual(left.slice(1).map(Number), [
        STAFF_LEFT_EDGE,
        Number(fmt(bodyShift + geometry.tabOffset)),
        STAFF_LEFT_EDGE,
        Number(fmt(bodyShift + rhythmOffset + MELODY_STAVE_BOTTOM))
      ]);

      const connector = group.match(/<line class="staff-group-barline-connector" x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/);
      assert.ok(connector);
      const { bx, width } = measureBounds(context, 1, 0);
      assert.deepStrictEqual([Number(connector[1]), Number(connector[3])], [Number(fmt(bx + width)), Number(fmt(bx + width))]);
    });

    const pages = renderScoreSheets(score, 'A4', 'portrait').join('');
    assert.strictEqual(staffGroupConnectors(pages).length, rows.length);
    assert.strictEqual((pages.match(/class="playback-measure-anchor"/g) ?? []).length, score.measures.length);
  });

  it('uses a font-free, original SVG bracket with mirrored fixed-shape terminals', () => {
    const reference = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'specs', 'gui_design', 'proposals', 'issue-160', 'staff-bracket-reference.svg'), 'utf8');
    const cap = reference.match(/<path class="staff-bracket" d="([^"]+)"/)?.[1];
    const mirroredCap = reference.match(/<path class="staff-bracket-bottom" d="([^"]+)"/)?.[1];
    assert.ok(cap && mirroredCap, 'design reference defines two inline Bézier caps');
    assert.strictEqual(cap, mirroredCap, 'bottom cap mirrors the exact same authored SVG path');
    assert.ok(cap.startsWith('M 0 0 L 3.5 0 C 7.2 -0.2'), 'new bracket has the authored gentle curved flare');
    assert.ok(!cap.includes('125 0 C 285 30'), 'do not reuse an extracted music font glyph');
    assert.ok(reference.includes('class="staff-bracket-stem"'), 'design reference has an independent stem');

    const score = parseGuitarDsl('| C |\nmel: | c4/1 |');
    const [group] = staffGroupConnectors(renderContinuousSvg(score));
    assert.ok(group);
    const top = group.match(/<path class="staff-bracket"[^>]*\/>/)?.[0];
    const bottom = group.match(/<path class="staff-bracket-bottom"[^>]*\/>/)?.[0];
    const stem = group.match(/<rect class="staff-bracket-stem"[^>]*\/>/)?.[0];
    assert.ok(top && bottom && stem, 'bracket has exactly two original SVG caps and one stem');
    assert.doesNotMatch(group, /<text\b|<use\b|<font\b|<foreignObject\b|font-family|@font-face|\bhref=|\bsrc=/i,
      'bracket must have no font, glyph, symbol reference or external resource dependency');
    assert.ok(top.includes('d="' + cap + '"') && bottom.includes('d="' + mirroredCap + '"'));
    assert.ok(top.includes('transform="translate(6 ') && !top.includes('scale('), 'top cap has no distortive scale');
    assert.ok(bottom.includes('scale(1 -1)'), 'bottom cap is reflected without stretching');
    assert.ok(stem.includes('x="6"') && stem.includes('width="3.5"') && stem.includes('fill="#000"'), 'original slim stem geometry is fixed');
    assert.strictEqual((group.match(/class="staff-bracket-bottom"/g) ?? []).length, 1);
    assert.strictEqual((group.match(/class="staff-bracket-stem"/g) ?? []).length, 1);
    assert.strictEqual((group.match(/class="staff-brace"/g) ?? []).length, 0);
  });

  it('keeps one vocal bracket on each page-broken vocal-plus-guitar system', () => {
    const score = parseGuitarDsl([
      'measures_per_row: 1',
      '|: C | D :|',
      'mel: | c4/1 | d4/1 |',
      'pagebreak',
      '| E | F |',
      'mel: | e4/1 | f4/1 |'
    ].join('\n'));
    const rows = splitIntoRows(score).flat();
    const pages = renderScoreSheets(score, 'A4', 'portrait');
    assert.strictEqual(pages.length, 2, 'manual pagebreak starts a second page');
    assert.strictEqual(pages.reduce((count, page) => count + staffGroupConnectors(page).length, 0), rows.length);
    assert.ok(pages.every(page => staffGroupConnectors(page).every(group =>
      (group.match(/class="staff-bracket"/g) ?? []).length === 1 &&
      (group.match(/class="staff-brace"/g) ?? []).length === 0
    )));
  });

  it('grows melody systems with the number of verses', () => {
    const one = parseGuitarDsl(['| C | % |', 'mel: | c5/1 |', 'lyr: あ'].join('\n'));
    const two = parseGuitarDsl(['| C | % |', 'mel: | c5/1 |', 'lyr: あ', 'lyr: い'].join('\n'));
    const g1 = getSystemGeometry(one.measures, one);
    const g2 = getSystemGeometry(two.measures, two);
    assert.strictEqual(g1.kind, 'melody');
    assert.ok(g1.unitHeight > SYSTEM_UNIT_HEIGHT);
    assert.strictEqual(g2.unitHeight - g1.unitHeight, g1.lyricLineHeight);
    assert.strictEqual(g2.rhythmOffset - g1.rhythmOffset, g1.lyricLineHeight);
  });

  it('shifts lyric baseline down dynamically for low melody notes to prevent collisions', () => {
    const high = parseGuitarDsl(['| C | % |', 'mel: | g4/1 |', 'lyr: あ'].join('\n'));
    const low = parseGuitarDsl(['| C | % |', 'mel: | g3/1 |', 'lyr: あ'].join('\n'));
    const gHigh = getSystemGeometry(high.measures, high);
    const gLow = getSystemGeometry(low.measures, low);
    assert.strictEqual(gHigh.lyricBaseline, 128);
    assert.ok(gLow.lyricBaseline > gHigh.lyricBaseline, 'lyricBaseline should shift down for G3');
  });

  it('draws one notehead per melody head and the syllables', () => {
    const svg = svgOf(['| C | % |', 'mel: | c5/4 d e/2 |', 'lyr: ドレミ'].join('\n'));
    assert.strictEqual(count(svg, 'class="notehead"'), 3);
    for (const syl of ['ド', 'レ', 'ミ']) {
      assert.ok(svg.includes(`>${syl}</text>`), syl);
    }
  });

  it('splits added note values into tied heads', () => {
    const svg = svgOf(['| C | % |', 'mel: | c5/2+8 r/8 d/4 |'].join('\n'));
    assert.strictEqual(count(svg, 'class="notehead"'), 3);
  });

  it('draws key signatures and only the accidentals that differ from the key', () => {
    // D major: f# and c# need no accidental, f natural does.
    const svg = svgOf(['key: D', '| D | % |', 'mel: | f#4/4 c#5 f4 a |'].join('\n'));
    assert.strictEqual(count(svg, SHARP), 2, 'two sharps of the key signature only');
    assert.strictEqual(count(svg, NATURAL), 1);
  });

  it('keeps accidentals for the rest of the measure and resets at the barline', () => {
    const svg = svgOf(['| C | % |', '| C | % |', 'mel: | f#4/4 f# f f# | f#4/1 |'].join('\n'));
    // m1: sharp, (held), natural, sharp again; m2: sharp again after the barline.
    assert.strictEqual(count(svg, SHARP), 3);
    assert.strictEqual(count(svg, NATURAL), 1);
  });

  it('handles flat keys, minor keys and tied notes', () => {
    // F major: bb needs no accidental, b natural does.
    const f = svgOf(['key: F', '| F | % |', 'mel: | bb4/2 b4/2 |'].join('\n'));
    assert.strictEqual(count(f, FLAT), 1, 'only the key signature flat');
    assert.strictEqual(count(f, NATURAL), 1);
    // D minor has one flat as well.
    assert.strictEqual(count(svgOf(['key: Dm', '| Dm | % |', 'mel: | d4/1 |'].join('\n')), FLAT), 1);
    // A tied f# carried into the next measure is not marked again.
    const tie = svgOf(['| C | % |', '| C | % |', 'mel: | c5/2. f#4/4~ | f#4/1 |'].join('\n'));
    assert.strictEqual(count(tie, SHARP), 1);
  });

  it('draws a bracket for unbeamed triplets', () => {
    const svg = svgOf(['| C | % |', 'mel: | c5/4t d e f/2 |'].join('\n'));
    assert.strictEqual(count(svg, '>3</text>'), 1);
    assert.ok(svg.includes('stroke-width="0.8"/><text'), 'bracket path precedes the number');
  });

  it('draws beat slashes for melody-less measures in a lead-sheet system', () => {
    const mixed = renderContinuousSvg(parseGuitarDsl([
      'show_rhythm: false',
      'measures_per_row: 2',
      '[A]',
      '| C | 4.d 4.d 4.d 4.d l:"らら" |',
      '[B]',
      '| G | 4.d 4.d 4.d 4.d |',
      'mel: | c5/1 |'
    ].join('\n')));
    // 4 beat slashes (no stems, no stroke marks) for the melody-less measure, plus its l:"..." lyric.
    assert.strictEqual(count(mixed, 'stroke-linejoin="round" opacity="1.0"/>'), 0);
    assert.strictEqual(count(mixed, '<polygon'), 4);
    assert.ok(mixed.includes('らら'));
  });

  it('draws quarter rests with the zigzag glyph inside the staff', () => {
    const svg = svgOf(['| C | % |', 'mel: | c5/2 d/4 r/4 |'].join('\n'));
    // Glyph spans y = -12..12 around the middle line (y = 86), i.e. within the staff lines 70..102.
    assert.strictEqual(count(svg, '<path d="M -1.6,-12 L 3.6,-5.4'), 1);
    assert.ok(svg.includes('translate(') && !svg.includes('M 1.2,-14.5'));
  });

  it('draws one flag for an unbeamed 8th and two separated flags for an unbeamed 16th', () => {
    const flag8 = 'M -0.6,0 L 0.7,0 C 1.2,3.6';
    const flag16 = 'M -0.6,0 L 0.7,0 C 1.2,2.6';
    const svg = svgOf(['| C | % |', 'mel: | c5/8 r/8 d/16 r/16 r/8 r/2 |'].join('\n'));
    assert.strictEqual(count(svg, flag8), 1);
    assert.strictEqual(count(svg, flag16), 2);
    assert.ok(svg.includes('transform="translate(0, 7.5)"'));
    // B4 and above have downward stems, so their flags are mirrored.
    assert.ok(svg.includes('scale(0.85, -1)'));

    const rhythm = svgOf('| C | 8.d r8 16.d r16 r8 r2 |');
    assert.strictEqual(count(rhythm, flag8), 1);
    assert.strictEqual(count(rhythm, flag16), 2);
    assert.ok(rhythm.includes('scale(0.85, 1)'));
  });

  it('extends the stem of an unbeamed 16th so both flags clear the notehead', () => {
    // c5 (pos 5, y = 82) has a downward stem: 26 + 4 = 30 below the head centre.
    const svg = svgOf(['| C | % |', 'mel: | c5/16 r/16 r/8 r/4 r/2 |'].join('\n'));
    assert.ok(/translate\([\d.]+, 112\) scale\(0\.85, -1\)/.test(svg));
  });

  it('draws flats with vector paths', () => {
    const svg = svgOf(['| C | % |', 'mel: | bb4/1 |'].join('\n'));
    assert.strictEqual(count(svg, FLAT), 1);
  });

  it('marks triplets on the melody and the rhythm staff', () => {
    const svg = svgOf(['| C | 8t.d 8t.u 8t.d 4.d 2.d |', 'mel: | b4/8t a g f/4 e/2 |'].join('\n'));
    assert.strictEqual(count(svg, 'font-style="italic" text-anchor="middle" fill="#000">3</text>'), 2);
  });

  it('suppresses l:"..." in measures that have a melody', () => {
    const svg = svgOf(['| C | 1.d l:"MEASURELYRIC" |', '| G | 1.d l:"KEPT" |', 'mel: | c5/1 |'].join('\n'));
    assert.ok(!svg.includes('MEASURELYRIC'));
    assert.ok(svg.includes('KEPT'));
  });

  it('omits the rhythm staff in lead-sheet mode but falls back for systems without melody', () => {
    const score = parseGuitarDsl([
      'show_rhythm: false',
      'measures_per_row: 1',
      '| C | 4.d 4.d 4.d 4.d |',
      'mel: | c5/1 |',
      '| G | 4.d 4.d 4.d 4.d |'
    ].join('\n'));
    const rows = splitIntoRows(score)[0];
    assert.deepStrictEqual(rows.map(r => r.geometry.kind), ['leadSheet', 'rhythm']);
    assert.ok(rows[0].geometry.unitHeight < SYSTEM_UNIT_HEIGHT + rows[0].geometry.rhythmOffset + 1);
    const svg = renderContinuousSvg(score);
    // Stroke marks (down-stroke path) only come from the rhythm staff of the second system.
    assert.strictEqual(count(svg, 'stroke-linejoin="round" opacity="1.0"/>'), 4);
  });

  it('applies measures_per_row and paginates variable-height systems', () => {
    const lines = ['measures_per_row: 2'];
    for (let i = 0; i < 40; i++) {
      lines.push('| C | % |', 'mel: | c5/2 d |', 'lyr: あい', 'lyr: うえ');
    }
    const score = parseGuitarDsl(lines.join('\n'));
    assert.strictEqual(splitIntoRows(score)[0].length, 20);
    const layout = layoutScore(score, 'A4', 'portrait');
    const rows = layout.pages.reduce((acc, p) => acc + p.rows.length, 0);
    assert.strictEqual(rows, 20);
    for (const page of layout.pages) {
      const used = page.rows.reduce((acc, r) => acc + r.geometry.unitHeight * layout.systemScale + layout.systemGap, 0);
      assert.ok(page.rows.length === 1 || used <= layout.columnHeight, `page ${page.pageNumber} overflows`);
    }
    assert.ok(layout.pages.length > 1);
  });

  it('renders the bundled melody samples as sheets', () => {
    for (const name of ['sample_melody.guitardsl', 'sample_leadsheet.guitardsl']) {
      const dsl = fs.readFileSync(path.join(__dirname, '..', '..', 'samples', name), 'utf8');
      const sheets = renderScoreSheets(parseGuitarDsl(dsl), 'A4', 'portrait');
      assert.ok(sheets.length >= 1, name);
      assert.ok(sheets.every(s => s.includes('class="notehead"')), name);
    }
  });
});
