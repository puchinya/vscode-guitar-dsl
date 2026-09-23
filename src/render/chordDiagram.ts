// Chord diagram (fretboard box) SVG, shared by the score header and the chord editor.
// Drawn in diagram units; callers scale it (DIAGRAM_SCALE in the score).

import { ChordVoicing, DIAGRAM_FRET_WINDOW, STRING_COUNT, resolveBaseFret } from '../chordDefinition';

// Local copy of notation.fmt: importing notation here would create a cycle through layout.ts.
function fmt(n: number): string {
  return String(Number(n.toFixed(2)));
}

export const DIAGRAM_UNIT_WIDTH = 56;
/** Height without the finger row. */
export const DIAGRAM_UNIT_HEIGHT = 61;
export const DIAGRAM_FINGER_UNIT_HEIGHT = 9;

const STRING_X0 = 11;
const STRING_GAP = 8;
const TOP_Y = 14;
const FRET_GAP = 9;
const BOTTOM_Y = TOP_Y + DIAGRAM_FRET_WINDOW * FRET_GAP;

export function diagramStringX(stringIndex: number): number {
  return STRING_X0 + stringIndex * STRING_GAP;
}

export function hasFingers(voicing: ChordVoicing): boolean {
  return !!voicing.fingers && voicing.fingers.some(f => f !== null);
}

export function renderChordDiagramSvg(voicing: ChordVoicing): string {
  const base = resolveBaseFret(voicing);
  const lastX = diagramStringX(STRING_COUNT - 1);
  const fretCenterY = (fret: number) => TOP_Y + (fret - base) * FRET_GAP + FRET_GAP / 2;
  let out = '';

  voicing.frets.forEach((f, s) => {
    const x = diagramStringX(s);
    if (f === 'x') {
      out += `<text x="${x}" y="9" font-size="8" text-anchor="middle" fill="#000">×</text>`;
    } else if (f === 0) {
      out += `<circle cx="${x}" cy="7" r="2" fill="none" stroke="#000" stroke-width="0.8"/>`;
    }
  });

  if (base === 1) {
    out += `<line x1="${STRING_X0}" y1="${TOP_Y}" x2="${lastX}" y2="${TOP_Y}" stroke="#000" stroke-width="2.2"/>`;
  } else {
    out += `<line x1="${STRING_X0}" y1="${TOP_Y}" x2="${lastX}" y2="${TOP_Y}" stroke="#000" stroke-width="0.7"/>`;
    out += `<text x="${STRING_X0 - 3}" y="${fmt(TOP_Y + FRET_GAP / 2 + 2.5)}" font-size="7" text-anchor="end" fill="#000">${base}</text>`;
  }
  for (let k = 1; k <= DIAGRAM_FRET_WINDOW; k++) {
    const y = TOP_Y + k * FRET_GAP;
    out += `<line x1="${STRING_X0}" y1="${y}" x2="${lastX}" y2="${y}" stroke="#888" stroke-width="0.7"/>`;
  }
  for (let s = 0; s < STRING_COUNT; s++) {
    const x = diagramStringX(s);
    out += `<line x1="${x}" y1="${TOP_Y}" x2="${x}" y2="${BOTTOM_Y}" stroke="#000" stroke-width="0.7"/>`;
  }

  for (const b of voicing.barres) {
    const x1 = diagramStringX(b.from) - 3;
    const x2 = diagramStringX(b.to) + 3;
    out += `<rect x="${fmt(x1)}" y="${fmt(fretCenterY(b.fret) - 2.5)}" width="${fmt(x2 - x1)}" height="5" rx="2.5" fill="#000"/>`;
  }
  voicing.frets.forEach((f, s) => {
    if (typeof f !== 'number' || f <= 0) return;
    const underBarre = voicing.barres.some(b => b.fret === f && s >= b.from && s <= b.to);
    if (!underBarre) {
      out += `<circle cx="${diagramStringX(s)}" cy="${fmt(fretCenterY(f))}" r="3" fill="#000"/>`;
    }
  });

  if (hasFingers(voicing)) {
    voicing.fingers!.forEach((finger, s) => {
      if (finger) {
        out += `<text x="${diagramStringX(s)}" y="${BOTTOM_Y + 7.5}" font-size="6.5" text-anchor="middle" fill="#333">${finger}</text>`;
      }
    });
  }
  return out;
}
