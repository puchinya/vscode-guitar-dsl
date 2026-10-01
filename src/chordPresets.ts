// Preset voicing library (the Guitar Pro style chord library): hand-written open chords plus
// movable CAGED shapes transposed to every root. Used for default diagrams and the chord editor.

import { Barre, ChordVoicing, MAX_FRET, StringFret } from './chordDefinition';
import { detectChordNames, NOTE_NAMES, parseChordName } from './chordDetect';
import { createInstrumentModel, InstrumentModel, STANDARD_TUNING } from './instrumentModel';

/** Hand-written voicings. The first voicing of a name is its default diagram. */
export const CHORD_LIBRARY: Record<string, StringFret[]> = {
  'C': ['x', 3, 2, 0, 1, 0],
  'G': [3, 2, 0, 0, 0, 3],
  'D': ['x', 'x', 0, 2, 3, 2],
  'A': ['x', 0, 2, 2, 2, 0],
  'E': [0, 2, 2, 1, 0, 0],
  'Am': ['x', 0, 2, 2, 1, 0],
  'Em': [0, 2, 2, 0, 0, 0],
  'Dm': ['x', 'x', 0, 2, 3, 1],
  'F': [1, 3, 3, 2, 1, 1],
  'B7': ['x', 2, 1, 2, 0, 2],
  'Cadd9': ['x', 3, 2, 0, 3, 3],
  'G/B': ['x', 2, 0, 0, 3, 3],
  'D/F#': [2, 0, 0, 2, 3, 2],
  'Dm7': ['x', 'x', 0, 2, 1, 1],
  'Am7': ['x', 0, 2, 0, 1, 0],
  'Em7': [0, 2, 2, 0, 3, 3],
  'G7': [3, 2, 0, 0, 0, 1],
  'C7': ['x', 3, 2, 3, 1, 0],
  'A7': ['x', 0, 2, 0, 2, 0],
  'E7': [0, 2, 0, 1, 0, 0],
  'Fmaj7': ['x', 'x', 3, 2, 1, 0],
  'Bm7': ['x', 2, 4, 2, 3, 2],
  'Cmaj7': ['x', 3, 2, 0, 0, 0]
};

type Offset = number | 'x';

interface ShapeTemplate {
  /** String index (0 = 6th) that carries the root at offset 0. */
  rootString: number;
  /** Offsets from the root fret, 6th string first. */
  offsets: Offset[];
}

const x = 'x' as const;
const E = (...offsets: Offset[]): ShapeTemplate => ({ rootString: 0, offsets });
const A = (...offsets: Offset[]): ShapeTemplate => ({ rootString: 1, offsets });
const D = (...offsets: Offset[]): ShapeTemplate => ({ rootString: 2, offsets });

/** Movable shapes per quality suffix (E / A / D / C / G shapes of the CAGED system). */
const SHAPES: Record<string, ShapeTemplate[]> = {
  '': [E(0, 2, 2, 1, 0, 0), A(x, 0, 2, 2, 2, 0), D(x, x, 0, 2, 3, 2), A(x, 0, -1, -3, -2, -3), E(0, -1, -3, -3, -3, 0)],
  'm': [E(0, 2, 2, 0, 0, 0), A(x, 0, 2, 2, 1, 0), D(x, x, 0, 2, 3, 1)],
  '7': [E(0, 2, 0, 1, 0, 0), A(x, 0, 2, 0, 2, 0), D(x, x, 0, 2, 1, 2), A(x, 0, -1, 0, -2, -3), E(0, -1, -3, -3, -3, -2)],
  'maj7': [E(0, x, 1, 1, 0, x), A(x, 0, 2, 1, 2, 0), D(x, x, 0, 2, 2, 2), A(x, 0, -1, -3, -3, -3)],
  'm7': [E(0, 2, 0, 0, 0, 0), A(x, 0, 2, 0, 1, 0), D(x, x, 0, 2, 1, 1)],
  'sus2': [A(x, 0, 2, 2, 0, 0), D(x, x, 0, 2, 3, 0)],
  'sus4': [E(0, 2, 2, 2, 0, 0), A(x, 0, 2, 2, 3, 0), D(x, x, 0, 2, 3, 3)],
  'dim': [E(0, 1, 2, 0, x, x), A(x, 0, 1, 2, 1, x)],
  'aug': [E(0, x, 2, 1, 1, 0), A(x, 0, 3, 2, 2, 1), D(x, x, 0, 3, 3, 2)],
  'add9': [E(0, 2, 4, 1, 0, 0), A(x, 0, 2, 4, 2, 0), A(x, 0, -1, -3, 0, -3)],
  '6': [E(0, 2, 2, 1, 2, 0), A(x, 0, 2, 2, 2, 2), D(x, x, 0, 2, 0, 2)],
  'm6': [E(0, 2, 2, 0, 2, 0), A(x, 0, 2, 2, 1, 2), D(x, x, 0, 2, 0, 1)],
  '9': [E(0, 2, 0, 1, 0, 2), A(x, 0, -1, 0, 0, 0)],
  'm9': [E(0, 2, 0, 0, 0, 2), A(x, 0, -2, 0, 0, 0)],
  '7sus4': [E(0, 2, 0, 2, 0, 0), A(x, 0, 2, 0, 3, 0), D(x, x, 0, 2, 1, 3)]
};

/** Qualities offered by the preset browser, in display order (every one has SHAPES). */
export const PRESET_QUALITIES: { suffix: string; label: string }[] = [
  '', 'm', '7', 'maj7', 'm7', 'sus2', 'sus4', '7sus4', '6', 'm6', 'add9', '9', 'm9', 'dim', 'aug'
].map(suffix => ({ suffix, label: suffix === '' ? 'maj' : suffix }));

export const PRESET_ROOTS = NOTE_NAMES;

/** Highest fret a generated preset may use. */
const MAX_PRESET_FRET = 15;
/** Largest fretted span (max - min) a generated preset may use. */
const MAX_PRESET_SPAN = 4;

interface GeneratedVoicing {
  frets: StringFret[];
  /** 0 = uses open strings, 1 = movable E / A / D shape, 2 = C / G shape without open strings (awkward). */
  group: number;
}

function transpose(shape: ShapeTemplate, rootPc: number, tuning: InstrumentModel['tuning']): GeneratedVoicing[] {
  const openPc = tuning.openMidi[shape.rootString] % 12;
  // C and G shapes extend below the root fret; without open strings they are hard to play.
  const extendsBelowRoot = shape.offsets.some(o => o !== 'x' && o < 0);
  const results: GeneratedVoicing[] = [];
  for (let rootFret = (rootPc - openPc + 12) % 12; rootFret <= MAX_PRESET_FRET; rootFret += 12) {
    const frets = shape.offsets.map(o => (o === 'x' ? 'x' : rootFret + o));
    if (frets.some(f => f !== 'x' && (f < 0 || f > MAX_PRESET_FRET))) continue;
    const fretted = frets.filter((f): f is number => f !== 'x' && f > 0);
    if (fretted.length > 0 && Math.max(...fretted) - Math.min(...fretted) > MAX_PRESET_SPAN) continue;
    const group = frets.some(f => f === 0) ? 0 : extendsBelowRoot ? 2 : 1;
    results.push({ frets, group });
  }
  return results;
}

/** Barre on the lowest fret when the shape needs more than four fingers and uses no open string. */
export function inferBarres(frets: StringFret[]): Barre[] {
  const fretted = frets.filter((f): f is number => f !== 'x' && f > 0);
  if (fretted.length <= 4 || frets.some(f => f === 0)) return [];
  const low = Math.min(...fretted);
  const at = frets.map((f, i) => (f === low ? i : -1)).filter(i => i >= 0);
  if (at.length < 2) return [];
  return [{ fret: low, from: at[0], to: at[at.length - 1] }];
}

function voicingOf(frets: StringFret[]): ChordVoicing {
  return { frets, barres: inferBarres(frets) };
}

function lowestFret(frets: StringFret[]): number {
  const fretted = frets.filter((f): f is number => f !== 'x' && f > 0);
  return fretted.length > 0 ? Math.min(...fretted) : 0;
}

/**
 * Preset voicings for a root name (e.g. 'Eb') and quality suffix: hand-written entry, then shapes
 * using open strings, then movable shapes, then C / G shapes without open strings; lower frets first.
 */
function generatedVoicings(root: string, suffix: string, tuning = STANDARD_TUNING): ChordVoicing[] {
  const parsed = parseChordName(root + suffix);
  if (!parsed) return [];
  const byName = CHORD_LIBRARY[root + suffix];
  const generated = (SHAPES[parsed.suffix] ?? []).flatMap(shape => transpose(shape, parsed.rootPc, tuning));
  generated.sort((a, b) => a.group - b.group || lowestFret(a.frets) - lowestFret(b.frets));
  const all = byName ? [byName, ...generated.map(g => g.frets)] : generated.map(g => g.frets);
  const seen = new Set<string>();
  const unique: ChordVoicing[] = [];
  for (const frets of all) {
    const id = frets.join(',');
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(voicingOf(frets));
  }
  return unique;
}

function isStandardInstrument(instrument: InstrumentModel): boolean {
  return instrument.tuning.openMidi.every((pitch, index) => pitch === STANDARD_TUNING.openMidi[index]);
}

function sameChordIdentity(candidate: string, target: string): boolean {
  const actual = parseChordName(candidate);
  const expected = parseChordName(target);
  if (!actual || !expected || actual.quality === undefined || expected.quality === undefined) return false;
  return actual.rootPc === expected.rootPc && actual.suffix === expected.suffix &&
    (actual.bassPc !== undefined) === (expected.bassPc !== undefined) && actual.bassPc === expected.bassPc;
}

function fitsPhysicalFretLimit(voicing: ChordVoicing, instrument: InstrumentModel): boolean {
  const maxRelativeFret = MAX_FRET - instrument.capo;
  return voicing.frets.every(fret => fret === 'x' || fret <= maxRelativeFret) &&
    voicing.barres.every(barre => barre.fret <= maxRelativeFret) &&
    (voicing.baseFret === undefined || voicing.baseFret <= maxRelativeFret);
}

function matchingVoicings(voicings: ChordVoicing[], name: string, instrument: InstrumentModel): ChordVoicing[] {
  const withinPhysicalRange = voicings.filter(voicing => fitsPhysicalFretLimit(voicing, instrument));
  // Preserve every established hand-written/default order for Standard, including legacy slash forms.
  if (isStandardInstrument(instrument)) return withinPhysicalRange;
  const atOpenTuning = createInstrumentModel(instrument.tuning, 0);
  return withinPhysicalRange.filter(voicing =>
    detectChordNames(voicing.frets, Infinity, atOpenTuning).some(candidate => sameChordIdentity(candidate.name, name))
  );
}

/** Presets for a root and quality, filtered to forms that sound as that chord in this tuning. */
export function getPresetVoicings(
  root: string,
  suffix: string,
  instrument: InstrumentModel = createInstrumentModel()
): ChordVoicing[] {
  return matchingVoicings(generatedVoicings(root, suffix, instrument.tuning), root + suffix, instrument);
}

/** Default diagram for a chord name; alternate tunings require an exact sounding-name match. */
export function getDefaultVoicing(name: string, instrument: InstrumentModel = createInstrumentModel()): ChordVoicing | undefined {
  if (isStandardInstrument(instrument)) {
    const parsed = parseChordName(name);
    if (!parsed || !parsed.quality) return undefined;
    if (CHORD_LIBRARY[name]) {
      const direct = matchingVoicings([voicingOf(CHORD_LIBRARY[name])], name, instrument)[0];
      if (direct) return direct;
    }
    if (parsed.bass !== undefined) return undefined;
    return getPresetVoicings(parsed.root, parsed.suffix, instrument)[0];
  }

  const parsed = parseChordName(name);
  if (!parsed || !parsed.quality) return undefined;
  const direct = CHORD_LIBRARY[name] ? [voicingOf(CHORD_LIBRARY[name])] : [];
  const generated = generatedVoicings(parsed.root, parsed.suffix, instrument.tuning);
  const seen = new Set<string>();
  const unique = [...direct, ...generated].filter(voicing => {
    const id = voicing.frets.join(',');
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return matchingVoicings(unique, name, instrument)[0];
}

/** Every (root, suffix) the preset browser offers, for tests and the editor. */
export function listPresetNames(): { root: string; suffix: string }[] {
  return PRESET_ROOTS.flatMap(root => PRESET_QUALITIES.map(q => ({ root, suffix: q.suffix })));
}
