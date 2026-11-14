import { ChordDefinition, ChordVoicing, splitChordKey } from '../chordDefinition';
import { resolveChordVoicing } from '../chordVoicingResolver';
import { createInstrumentModel, InstrumentModel, MAX_CAPO, Tuning } from '../instrumentModel';

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
export function resolveChordDiagram(
  key: string,
  definitions: ChordDefinition[],
  instrument: InstrumentModel = createInstrumentModel()
): ResolvedChordDiagram {
  const resolved = resolveChordVoicing(key, definitions, instrument);
  if (resolved) return resolved;
  const { name, label } = splitChordKey(key);
  return { key, name, label, voicing: FALLBACK_VOICING, source: 'fallback' };
}

export function resolveScoreDiagrams(score: {
  usedChords: string[];
  chordDefinitions: ChordDefinition[];
  tuning?: Tuning;
  capo?: string;
}): ResolvedChordDiagram[] {
  const rawCapo = score.capo ?? '0';
  const capo = /^[0-9]+$/.test(rawCapo) && Number(rawCapo) <= MAX_CAPO ? Number(rawCapo) : 0;
  const instrument = createInstrumentModel(score.tuning, capo);
  return score.usedChords.map(key => resolveChordDiagram(key, score.chordDefinitions, instrument));
}
