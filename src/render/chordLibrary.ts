import { ChordDefinition, ChordVoicing, splitChordKey } from '../chordDefinition';
import { resolveChordVoicing } from '../chordVoicingResolver';

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
 * Diagram for a key (spec §7.3): the shared semantic resolution (definition, preset, slash upper
 * chord), then the renderer-only fallback shape.
 */
export function resolveChordDiagram(key: string, definitions: ChordDefinition[]): ResolvedChordDiagram {
  const resolved = resolveChordVoicing(key, definitions);
  if (resolved) return resolved;
  const { name, label } = splitChordKey(key);
  return { key, name, label, voicing: FALLBACK_VOICING, source: 'fallback' };
}

export function resolveScoreDiagrams(score: { usedChords: string[]; chordDefinitions: ChordDefinition[] }): ResolvedChordDiagram[] {
  return score.usedChords.map(key => resolveChordDiagram(key, score.chordDefinitions));
}
