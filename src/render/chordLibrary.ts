export type Fret = number | 'x' | 'o';

export interface ChordDiagram {
  name: string;
  strings: Fret[]; // 6th string to 1st string
  baseFret?: number;
}

export const CHORD_LIBRARY: Record<string, Fret[]> = {
  'C': ['x', 3, 2, 'o', 1, 'o'],
  'G': [3, 2, 'o', 'o', 'o', 3],
  'D': ['x', 'x', 'o', 2, 3, 2],
  'A': ['x', 'o', 2, 2, 2, 'o'],
  'E': ['o', 2, 2, 1, 'o', 'o'],
  'Am': ['x', 'o', 2, 2, 1, 'o'],
  'Em': ['o', 2, 2, 'o', 'o', 'o'],
  'Dm': ['x', 'x', 'o', 2, 3, 1],
  'F': [1, 3, 3, 2, 1, 1],
  'B7': ['x', 2, 1, 2, 'o', 2],
  'Cadd9': ['x', 3, 2, 'o', 3, 3],
  'G/B': ['x', 2, 'o', 'o', 3, 3],
  'D/F#': [2, 'o', 'o', 2, 3, 2],
  'Dm7': ['x', 'x', 'o', 2, 1, 1],
  'Am7': ['x', 'o', 2, 'o', 1, 'o'],
  'Em7': ['o', 2, 2, 'o', 3, 3],
  'G7': [3, 2, 'o', 'o', 'o', 1],
  'C7': ['x', 3, 2, 3, 1, 'o'],
  'A7': ['x', 'o', 2, 'o', 2, 'o'],
  'E7': ['o', 2, 'o', 1, 'o', 'o'],
  'Fmaj7': ['x', 'x', 3, 2, 1, 'o'],
  'Bm7': ['x', 2, 4, 2, 3, 2],
  'Cmaj7': ['x', 3, 2, 'o', 'o', 'o']
};

const FALLBACK_FRETS: Fret[] = ['x', 'x', 'o', 2, 3, 2];

export function getChordFrets(name: string): Fret[] {
  return CHORD_LIBRARY[name] || FALLBACK_FRETS;
}
