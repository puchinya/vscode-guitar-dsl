// SVG fragments for guitar techniques and articulations (docs/specs/guitardsl-syntax.md §8.4, §12.2.1),
// shared by the melody staff, the rhythm staff and the annotation lanes. Vector primitives only (no music font).
// Every fragment carries a `technique-*` class so tests and styles can tell the marks apart.

import { estimateTextWidth } from './layout';
import { escapeXml, fmt } from './notation';

export function renderStaccato(x: number, y: number): string {
  return `<circle class="technique-staccato" cx="${fmt(x)}" cy="${fmt(y)}" r="1.5" fill="#000"/>`;
}

export function renderTenuto(x: number, y: number): string {
  return `<line class="technique-tenuto" x1="${fmt(x - 4)}" y1="${fmt(y)}" x2="${fmt(x + 4)}" y2="${fmt(y)}" stroke="#000" stroke-width="1.4"/>`;
}

/**
 * Fermata above a point: arc (opening downwards) with a dot; `y` is the bottom of the arc.
 * `inverted` draws the form used below a note (`y` is then the top of the arc).
 */
export function renderFermata(x: number, y: number, inverted = false): string {
  if (inverted) return `<g transform="translate(0, ${fmt(2 * y)}) scale(1, -1)">${renderFermata(x, y)}</g>`;
  return `<g class="technique-fermata"><path d="M ${fmt(x - 6)},${fmt(y)} C ${fmt(x - 6)},${fmt(y - 8)} ${fmt(x + 6)},${fmt(y - 8)} ${fmt(x + 6)},${fmt(y)} `
    + `C ${fmt(x + 5)},${fmt(y - 6.2)} ${fmt(x - 5)},${fmt(y - 6.2)} ${fmt(x - 6)},${fmt(y)} Z" fill="#000"/>`
    + `<circle cx="${fmt(x)}" cy="${fmt(y - 1.6)}" r="1.3" fill="#000"/></g>`;
}

/** Breath mark (comma) with its top at `y`. */
export function renderBreath(x: number, y: number): string {
  return `<path class="technique-breath" d="M ${fmt(x)},${fmt(y + 2)} m -1.8,0 a 1.8,1.8 0 1 0 3.6,0 a 1.8,1.8 0 1 0 -3.6,0 `
    + `M ${fmt(x + 1.7)},${fmt(y + 2.4)} C ${fmt(x + 1.9)},${fmt(y + 5)} ${fmt(x + 0.8)},${fmt(y + 6.6)} ${fmt(x - 1.2)},${fmt(y + 7.4)}" fill="#000" stroke="#000" stroke-width="0.9"/>`;
}

/** Horizontal wavy line from x1 to x2 centred on y (vibrato). */
export function renderVibrato(x1: number, x2: number, y: number): string {
  const step = 4;
  let d = `M ${fmt(x1)},${fmt(y)}`;
  let up = true;
  for (let x = x1; x + step <= x2 + 0.01; x += step) {
    d += ` Q ${fmt(x + step / 2)},${fmt(y + (up ? -2.4 : 2.4))} ${fmt(x + step)},${fmt(y)}`;
    up = !up;
  }
  return `<path class="technique-vibrato" d="${d}" fill="none" stroke="#000" stroke-width="1.2" stroke-linecap="round"/>`;
}

/** Bend label: semitones as steps (1 = ½, 2 = full, 3 = 1½, 4 = 2). */
export function bendLabel(semitones: number): string {
  if (semitones === 2) return 'full';
  const whole = Math.floor(semitones / 2);
  const half = semitones - whole * 2;
  const halfText = half === 1 ? '½' : half === 0.5 ? '¼' : half === 1.5 ? '¾' : '';
  return `${whole > 0 ? whole : ''}${halfText}` || '0';
}

/** Minimum rise of a bend arrow above its notehead. */
const MIN_BEND_RISE = 10;

/** Upward curved arrow from the right of a notehead at (x, y) to `topY`, with the bend amount above. */
export function renderBend(x: number, y: number, topY: number, semitones: number): string {
  // A caller's requested top can fall below a high notehead; the arrow must still point upward.
  const endY = Math.min(topY, y - MIN_BEND_RISE);
  const sx = x + 6;
  const ex = x + 14;
  return `<g class="technique-bend"><path d="M ${fmt(sx)},${fmt(y)} Q ${fmt(ex)},${fmt(y)} ${fmt(ex)},${fmt(endY + 4)}" fill="none" stroke="#000" stroke-width="1.1"/>`
    + `<path d="M ${fmt(ex - 2.6)},${fmt(endY + 5)} L ${fmt(ex)},${fmt(endY)} L ${fmt(ex + 2.6)},${fmt(endY + 5)} Z" fill="#000"/>`
    + `<text x="${fmt(ex)}" y="${fmt(endY - 2)}" font-size="7" text-anchor="middle" fill="#000">${escapeXml(bendLabel(semitones))}</text></g>`;
}

/**
 * Slur-like arc between two x positions at y; `below` bends downwards. `openStart` / `openEnd` mark a
 * segment that continues from / to another system (drawn as a half arc).
 */
export function renderArc(x1: number, x2: number, y: number, below: boolean, cls: string): string {
  const depth = Math.min(9, Math.max(4, (x2 - x1) * 0.18));
  const bend = below ? depth : -depth;
  const thick = below ? 1.4 : -1.4;
  const mid = (x1 + x2) / 2;
  return `<path class="${cls}" d="M ${fmt(x1)},${fmt(y)} Q ${fmt(mid)},${fmt(y + bend * 2)} ${fmt(x2)},${fmt(y)} Q ${fmt(mid)},${fmt(y + bend * 2 - thick)} ${fmt(x1)},${fmt(y)} Z" fill="#000"/>`;
}

/** Hammer-on / pull-off: arc plus H / P letter over its middle. */
export function renderHammerPull(kind: 'hammer' | 'pull', x1: number, x2: number, y: number, below: boolean): string {
  const letter = kind === 'hammer' ? 'H' : 'P';
  const depth = Math.min(9, Math.max(4, (x2 - x1) * 0.18));
  const ly = below ? y + depth * 2 + 8 : y - depth * 2 - 2;
  return `<g class="technique-${kind}">${renderArc(x1, x2, y, below, 'technique-arc')}`
    + `<text x="${fmt((x1 + x2) / 2)}" y="${fmt(ly)}" font-size="7.5" font-weight="bold" text-anchor="middle" fill="#000">${letter}</text></g>`;
}

/** Slide: straight diagonal line between two noteheads. */
export function renderSlide(x1: number, y1: number, x2: number, y2: number): string {
  return `<line class="technique-slide" x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="#000" stroke-width="1.3" stroke-linecap="round"/>`;
}

/** Glissando: wavy diagonal line plus `gliss.` when there is room. */
export function renderGliss(x1: number, y1: number, x2: number, y2: number): string {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const wave = renderVibrato(0, Math.max(4, len), 0).replace('technique-vibrato', 'technique-gliss-wave');
  const label = len >= 34
    ? `<text x="${fmt(len / 2)}" y="-4" font-size="6.5" font-style="italic" text-anchor="middle" fill="#000">gliss.</text>`
    : '';
  return `<g class="technique-gliss" transform="translate(${fmt(x1)}, ${fmt(y1)}) rotate(${fmt(angle)})">${wave}${label}</g>`;
}

/** Plain slur between two x positions. */
export function renderSlur(x1: number, x2: number, y: number, below: boolean): string {
  return `<g class="technique-slur">${renderArc(x1, x2, y, below, 'technique-arc')}</g>`;
}

/**
 * Span in a lane (P.M. / let ring / 8va): label, dashed line to x2 and an end hook unless the span
 * continues on the next system. A continuation from the previous system puts the label in parentheses.
 */
export function renderSpan(
  cls: string,
  label: string,
  x1: number,
  x2: number,
  y: number,
  opts: { continuedFrom: boolean; continuesTo: boolean; hookDown: boolean }
): string {
  const text = opts.continuedFrom ? `(${label})` : label;
  const size = 8;
  const textWidth = estimateTextWidth(text, size, true);
  let out = `<g class="${cls}"><text x="${fmt(x1)}" y="${fmt(y + 3)}" font-size="${size}" font-weight="bold" font-style="italic" fill="#000">${escapeXml(text)}</text>`;
  const lineStart = x1 + textWidth + 2;
  if (x2 > lineStart + 2) {
    out += `<line x1="${fmt(lineStart)}" y1="${fmt(y)}" x2="${fmt(x2)}" y2="${fmt(y)}" stroke="#000" stroke-width="0.9" stroke-dasharray="3 2"/>`;
  }
  if (!opts.continuesTo) {
    const hook = opts.hookDown ? 4 : -4;
    out += `<line x1="${fmt(Math.max(x2, lineStart))}" y1="${fmt(y)}" x2="${fmt(Math.max(x2, lineStart))}" y2="${fmt(y + hook)}" stroke="#000" stroke-width="0.9"/>`;
  }
  return out + '</g>';
}
