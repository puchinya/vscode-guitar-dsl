import { ChordDefinition, ChordVoicing, chordKey, splitChordKey } from '../chordDefinition';
import { getDefaultVoicing } from '../chordPresets';

export interface ResolvedChordDiagram {
  /** `name` or `name@label`. */
  key: string;
  name: string;
  label?: string;
  voicing: ChordVoicing;
  source: 'definition' | 'library' | 'fallback';
}

const FALLBACK_VOICING: ChordVoicing = { frets: ['x', 'x', 0, 2, 3, 2], barres: [] };

/**
 * Diagram for a key (spec §7.4): the file's definition of that key; for an unlabeled name or an
 * undefined label, the unlabeled definition, then the preset library, then the fallback shape.
 */
export function resolveChordDiagram(key: string, definitions: ChordDefinition[]): ResolvedChordDiagram {
  const { name, label } = splitChordKey(key);
  const find = (k: string) => definitions.find(d => chordKey(d.name, d.label) === k);
  const own = find(key) ?? (label !== undefined ? find(name) : undefined);
  if (own) {
    return { key, name, label, voicing: own, source: 'definition' };
  }
  const library = getDefaultVoicing(name);
  if (library) {
    return { key, name, label, voicing: library, source: 'library' };
  }
  return { key, name, label, voicing: FALLBACK_VOICING, source: 'fallback' };
}

export function resolveScoreDiagrams(score: { usedChords: string[]; chordDefinitions: ChordDefinition[] }): ResolvedChordDiagram[] {
  return score.usedChords.map(key => resolveChordDiagram(key, score.chordDefinitions));
}
