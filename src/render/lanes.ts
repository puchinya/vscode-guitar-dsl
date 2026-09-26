// Draws the annotation lanes of a system row (score events above, dynamics below; spec §11, §16)
// in system unit coordinates (y = 0 is the top of the system including its lanes).

import { SystemRow } from './layout';
import { LANE_HEIGHT, RowSpanCollector, StaffSpans, rowAnnotations } from './annotations';
import { RenderContext, escapeXml, fmt, measureBounds } from './notation';
import { estimateTextWidth } from './layout';
import { renderFermata, renderSpan, renderVibrato } from './technique';

/** Quarter-note glyph + `= N` (vector note, no music font). */
function renderTempoBpm(x: number, baseline: number, bpm: number): { svg: string; width: number } {
  const text = `= ${bpm}`;
  const svg = `<g class="annotation-tempo"><ellipse cx="${fmt(x + 3.2)}" cy="${fmt(baseline - 2.4)}" rx="3.2" ry="2.3" transform="rotate(-20 ${fmt(x + 3.2)} ${fmt(baseline - 2.4)})" fill="#000"/>`
    + `<line x1="${fmt(x + 6.1)}" y1="${fmt(baseline - 2.8)}" x2="${fmt(x + 6.1)}" y2="${fmt(baseline - 13)}" stroke="#000" stroke-width="1"/>`
    + `<text x="${fmt(x + 9)}" y="${fmt(baseline)}" font-size="10" font-weight="bold" fill="#000">${escapeXml(text)}</text></g>`;
  return { svg, width: 9 + estimateTextWidth(text, 10, true) };
}

interface Interval {
  x1: number;
  x2: number;
  continuedFrom: boolean;
  continuesTo: boolean;
}

/** Runs of flagged entries per staff, merged across staffs when they overlap. */
function spanIntervals(staffs: StaffSpans[], flag: 'palmMute' | 'letRing', rowEnd: number): Interval[] {
  const intervals: Interval[] = [];
  for (const staff of staffs) {
    let start = -1;
    staff.entries.forEach((e, i) => {
      if (e[flag] && start < 0) start = i;
      const endsHere = e[flag] && (i === staff.entries.length - 1 || !staff.entries[i + 1][flag]);
      if (endsHere) {
        const continuedFrom = start === 0 && staff.before[flag];
        const continuesTo = i === staff.entries.length - 1 && staff.after[flag];
        intervals.push({
          x1: staff.entries[start].x - 6,
          x2: continuesTo ? rowEnd : e.x + 8,
          continuedFrom,
          continuesTo
        });
        start = -1;
      }
    });
  }
  intervals.sort((a, b) => a.x1 - b.x1);
  const merged: Interval[] = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv.x1 <= last.x2 + 4) {
      last.x2 = Math.max(last.x2, iv.x2);
      last.continuesTo = last.continuesTo || iv.continuesTo;
      last.continuedFrom = last.continuedFrom || iv.continuedFrom;
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

/** Annotation lanes of `row` (above the content) and its dynamics lane (below). */
export function renderRowLanes(row: SystemRow, ctx: RenderContext, spans: RowSpanCollector): string {
  const geometry = row.geometry;
  if (geometry.annotationTop === 0 && geometry.annotationBottom === 0) return '';
  const measures = row.measures;
  const annotations = rowAnnotations(measures, ctx.score, geometry.kind === 'rhythm', geometry.kind !== 'leadSheet');
  const rowEnd = ctx.totalWidth - 5;
  let out = '';

  // Text-like lanes: each entry at its measure start, pushed right past the previous entry of the lane.
  const lastRight = new Map<string, number>();
  for (const a of annotations.top) {
    const laneY = geometry.lanes.get(a.lane);
    if (laneY === undefined) continue;
    const { bx } = measureBounds(ctx, measures.length, a.measure);
    const x = Math.max(bx + 4, (lastRight.get(a.lane) ?? -Infinity) + 8);
    const baseline = laneY + LANE_HEIGHT[a.lane] - 4;
    let width: number;
    if (a.lane === 'mark') {
      const size = 11;
      width = estimateTextWidth(a.text, size, true) + 8;
      out += `<g class="annotation-mark"><rect x="${fmt(x)}" y="${fmt(laneY + 2)}" width="${fmt(width)}" height="${size + 4}" fill="#fff" stroke="#000" stroke-width="1.3"/>`
        + `<text x="${fmt(x + 4)}" y="${fmt(laneY + size + 2)}" font-size="${size}" font-weight="900" fill="#000">${escapeXml(a.text)}</text></g>`;
    } else if (a.lane === 'tempo' && a.kind === 'bpm') {
      const tempo = renderTempoBpm(x, baseline, a.bpm);
      out += tempo.svg;
      width = tempo.width;
    } else if (a.lane === 'tempo') {
      width = estimateTextWidth(a.text, 10, true);
      out += `<text class="annotation-tempo-text" x="${fmt(x)}" y="${fmt(baseline)}" font-size="10" font-weight="bold" font-style="italic" fill="#000">${escapeXml(a.text)}</text>`;
    } else {
      width = estimateTextWidth(a.text, 9);
      const cls = a.isKey ? 'annotation-key' : 'annotation-text';
      out += `<text class="${cls}" x="${fmt(x)}" y="${fmt(baseline)}" font-size="9" ${a.isKey ? 'font-weight="bold"' : 'font-style="italic"'} fill="#000">${escapeXml(a.text)}</text>`;
    }
    lastRight.set(a.lane, x + width);
  }

  // Ottava: runs of measures with the same ottava; split at the system edges.
  const ottavaY = geometry.lanes.get('ottava');
  if (ottavaY !== undefined) {
    let i = 0;
    while (i < measures.length) {
      const o = measures[i].context.ottava;
      if (o === 'none') {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < measures.length && measures[j + 1].context.ottava === o) j++;
      const first = measures[i];
      const last = measures[j];
      const prev = ctx.score.measures[first.measureIndex - 1];
      const next = ctx.score.measures[last.measureIndex + 1];
      const continuedFrom = i === 0 && prev?.context.ottava === o;
      const continuesTo = j === measures.length - 1 && next?.context.ottava === o;
      const { bx } = measureBounds(ctx, measures.length, i);
      const end = measureBounds(ctx, measures.length, j);
      const x2 = continuesTo ? rowEnd : end.bx + end.width - 4;
      out += renderSpan(`annotation-ottava ottava-${o}`, o, bx + 4, x2, ottavaY + 7, { continuedFrom, continuesTo, hookDown: o === '8va' });
      i = j + 1;
    }
  }

  for (const [lane, flag, label, cls] of [['palmMute', 'palmMute', 'P.M.', 'technique-pm'], ['letRing', 'letRing', 'let ring', 'technique-let-ring']] as const) {
    const laneY = geometry.lanes.get(lane);
    if (laneY === undefined) continue;
    for (const iv of spanIntervals(spans.staffs, flag, rowEnd)) {
      out += renderSpan(cls, label, iv.x1, iv.x2, laneY + 6, { continuedFrom: iv.continuedFrom, continuesTo: iv.continuesTo, hookDown: true });
    }
  }

  const marksY = geometry.lanes.get('techniqueMarks');
  if (marksY !== undefined) {
    for (const mark of spans.laneMarks) {
      if (mark.fermata) out += renderFermata(mark.x, marksY + 12);
      if (mark.vibrato) out += renderVibrato(mark.x - 6, mark.x + 10, marksY + (mark.fermata ? 3 : 7));
    }
  }

  if (geometry.annotationBottom > 0) {
    const y = geometry.annotationTop + geometry.contentHeight;
    let dynamicRight = -Infinity;
    for (const d of annotations.dynamics) {
      const { bx } = measureBounds(ctx, measures.length, d.measure);
      const x = Math.max(bx + 8, dynamicRight + 8);
      out += `<text class="annotation-dynamic" x="${fmt(x)}" y="${fmt(y + 13)}" font-size="12" font-weight="bold" font-style="italic" fill="#000">${escapeXml(d.text)}</text>`;
      dynamicRight = x + estimateTextWidth(d.text, 12, true);
    }
  }
  return out;
}
