import { ChordDefinition, ChordVoicing, chordKey, splitChordKey } from './chordDefinition';
import { getDefaultVoicing } from './chordPresets';
import { createInstrumentModel, InstrumentModel } from './instrumentModel';

/**
 * Semantic chord-voicing resolution shared by the renderer, capo playability and Beginner Mode
 * (docs/specs/guitardsl-syntax §7.3). The renderer's visual fallback shape is not part of it.
 */
export interface ResolvedChordVoicing {
  /** `name` or `name@label`. */
  key: string;
  name: string;
  label?: string;
  voicing: ChordVoicing;
  source: 'definition' | 'library';
}

/** The file's definition of a key; a labeled key without its own definition uses the unlabeled one. */
export function resolveApplicableChordDefinition(
  key: string,
  definitions: readonly ChordDefinition[]
): ChordDefinition | undefined {
  const { name, label } = splitChordKey(key);
  const find = (k: string) => definitions.find(d => chordKey(d.name, d.label) === k);
  return find(key) ?? (label !== undefined ? find(name) : undefined);
}

/** Preset default for the name, else the upper chord's default for a slash chord without a preset. */
export function resolveDefaultChordVoicing(
  name: string,
  instrument: InstrumentModel = createInstrumentModel()
): ChordVoicing | undefined {
  const direct = getDefaultVoicing(name, instrument);
  if (direct) return direct;
  const slash = name.indexOf('/');
  return slash > 0 ? getDefaultVoicing(name.slice(0, slash), instrument) : undefined;
}

/** Applicable definition, then the default voicing; undefined when neither is known. */
export function resolveChordVoicing(
  key: string,
  definitions: readonly ChordDefinition[],
  instrument: InstrumentModel = createInstrumentModel()
): ResolvedChordVoicing | undefined {
  const { name, label } = splitChordKey(key);
  const own = resolveApplicableChordDefinition(key, definitions);
  if (own) return { key, name, label, voicing: own, source: 'definition' };
  const library = resolveDefaultChordVoicing(name, instrument);
  return library ? { key, name, label, voicing: library, source: 'library' } : undefined;
}
