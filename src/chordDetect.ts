// Chord name detection from a fingering (standard tuning EADGBE) and chord name helpers.

import { StringFret } from './chordDefinition';

/** MIDI numbers of the open strings, 6th string first. */
export const OPEN_STRING_MIDI = [40, 45, 50, 55, 59, 64];

/** Root / bass spelling used for generated names. */
export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const NATURAL_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function noteNameToPitchClass(note: string): number | null {
  const m = note.match(/^([A-G])([b#]?)$/);
  if (!m) return null;
  const shift = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (NATURAL_PC[m[1]] + shift + 12) % 12;
}

export interface ChordQuality {
  /** Name suffix, e.g. '' (major), 'm', 'maj7'. */
  suffix: string;
  /** Intervals from the root in semitones (root first). */
  intervals: number[];
  /** Lower = simpler / more common name. */
  rank: number;
}

export const CHORD_QUALITIES: ChordQuality[] = [
  { suffix: '', intervals: [0, 4, 7], rank: 0 },
  { suffix: 'm', intervals: [0, 3, 7], rank: 0 },
  { suffix: '7', intervals: [0, 4, 7, 10], rank: 1 },
  { suffix: 'maj7', intervals: [0, 4, 7, 11], rank: 1 },
  { suffix: 'm7', intervals: [0, 3, 7, 10], rank: 1 },
  { suffix: 'sus4', intervals: [0, 5, 7], rank: 2 },
  { suffix: 'sus2', intervals: [0, 2, 7], rank: 2 },
  { suffix: 'add9', intervals: [0, 4, 7, 2], rank: 2 },
  { suffix: '6', intervals: [0, 4, 7, 9], rank: 2 },
  { suffix: 'm6', intervals: [0, 3, 7, 9], rank: 2 },
  { suffix: 'dim', intervals: [0, 3, 6], rank: 2 },
  { suffix: 'aug', intervals: [0, 4, 8], rank: 2 },
  { suffix: '7sus4', intervals: [0, 5, 7, 10], rank: 3 },
  { suffix: '9', intervals: [0, 4, 7, 10, 2], rank: 3 },
  { suffix: 'm9', intervals: [0, 3, 7, 10, 2], rank: 3 },
  { suffix: 'maj9', intervals: [0, 4, 7, 11, 2], rank: 3 },
  { suffix: 'dim7', intervals: [0, 3, 6, 9], rank: 3 },
  { suffix: '5', intervals: [0, 7], rank: 4 }
];

const SUFFIX_ALIASES: Record<string, string> = { min: 'm', maj: '' };

export interface ParsedChordName {
  root: string;
  rootPc: number;
  /** Quality suffix normalized to CHORD_QUALITIES (e.g. 'min' -> 'm'). */
  suffix: string;
  quality?: ChordQuality;
  bass?: string;
  bassPc?: number;
}

export function parseChordName(name: string): ParsedChordName | null {
  const m = name.match(/^([A-G][b#]?)([^/]*)(?:\/([A-G][b#]?))?$/);
  if (!m) return null;
  const rootPc = noteNameToPitchClass(m[1]);
  if (rootPc === null) return null;
  const suffix = SUFFIX_ALIASES[m[2]] ?? m[2];
  const quality = CHORD_QUALITIES.find(q => q.suffix === suffix);
  const bassPc = m[3] ? noteNameToPitchClass(m[3]) ?? undefined : undefined;
  return { root: m[1], rootPc, suffix, quality, bass: m[3], bassPc };
}

export interface ChordCandidate {
  name: string;
  /** Lower is better. */
  score: number;
}

/** MIDI pitches of the sounding strings (low to high); muted strings are skipped. */
export function soundingPitches(frets: StringFret[]): number[] {
  const pitches: number[] = [];
  frets.forEach((f, i) => {
    if (f !== 'x') pitches.push(OPEN_STRING_MIDI[i] + f);
  });
  return pitches;
}

/**
 * Ranked chord names for a fingering. Each candidate's pitch-class set equals a quality's
 * intervals (7th/9th chords may omit the 5th); a bass other than the root gives a slash chord.
 */
export function detectChordNames(frets: StringFret[], limit = 8): ChordCandidate[] {
  const pitches = soundingPitches(frets);
  if (pitches.length < 2) return [];
  const bassPc = Math.min(...pitches) % 12;
  const pcs = new Set(pitches.map(p => p % 12));

  const found = new Map<string, number>();
  for (const rootPc of pcs) {
    const rel = new Set([...pcs].map(p => (p - rootPc + 12) % 12));
    for (const q of CHORD_QUALITIES) {
      const full = new Set(q.intervals);
      let omitFifth = false;
      if (!sameSet(rel, full)) {
        const canOmitFifth = q.intervals.length >= 4 && full.has(7) && !rel.has(7);
        const withoutFifth = new Set(q.intervals.filter(i => i !== 7));
        if (!(canOmitFifth && sameSet(rel, withoutFifth))) continue;
        omitFifth = true;
      }
      let name = NOTE_NAMES[rootPc] + q.suffix;
      let score = q.rank + (omitFifth ? 1 : 0);
      if (bassPc !== rootPc) {
        name += '/' + NOTE_NAMES[bassPc];
        score += 5;
      }
      if (!found.has(name) || found.get(name)! > score) found.set(name, score);
    }
  }
  return [...found.entries()]
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function sameSet(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
