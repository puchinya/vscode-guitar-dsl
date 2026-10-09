import { appendLoss, emptyLossReport, parseInterchangeTimeSignature, validateInterchangeScore } from '../interchange';
import type {
  InterchangeChord,
  InterchangeChordDefinition,
  InterchangeEvent,
  InterchangeFraction,
  InterchangeLyricSlot,
  InterchangeMelodyGroup,
  InterchangeMeasure,
  InterchangeNote,
  InterchangeNoteValue,
  InterchangePitch,
  InterchangeScore,
  InterchangeTabBeat,
  InterchangeTimeSignature,
  InterchangeTuning,
} from '../interchange';
import { createInstrumentModel, parseTuningValue, type GuitarString } from '../instrumentModel';
import { Gp78AdapterError } from './model';
import type { Gp78TrackSummary } from './model';
import type { Gp78TrackNotation } from './partConfiguration';
import { indexGpifIds, parseGpifId, parseGpifIdList, resolveGpifRef } from './references';
import { decodeXmlText, xmlAttr, xmlChild, xmlChildren, xmlText } from './xml';

type Node = Record<string, unknown>;

interface TrackDescriptor extends Gp78TrackSummary {
  readonly raw: Node;
  readonly staff: Node;
  readonly tuning: InterchangeTuning;
  readonly capo: number;
}

interface ParsedBeat {
  readonly beatId: number;
  readonly tabBeat: InterchangeTabBeat;
  readonly tabMarkers: readonly TabNoteMarkers[];
  readonly duration: InterchangeNoteValue;
  readonly melodyNotes: readonly InterchangeNote[];
  readonly hasTabNotes: boolean;
  readonly hasTabRest: boolean;
  readonly normalizedDoubleSharp: boolean;
  readonly lyrics: readonly string[];
  readonly chordId?: number;
}

interface TabNoteMarkers {
  readonly hopoOrigin: boolean;
  readonly hopoDestination: boolean;
  readonly tieOrigin: boolean;
  readonly tieDestination: boolean;
}

const TUNING_PRESETS: readonly NonNullable<InterchangeTuning['preset']>[] = ['Standard', 'Drop D', 'DADGAD', 'Open G', 'Open D'];
const NOTE_BASES: Readonly<Record<string, InterchangeNoteValue['parts'][number]['base']>> = {
  Whole: 1,
  Half: 2,
  Quarter: 4,
  Eighth: 8,
  Sixteenth: 16,
};

function normalizedFraction(n: number, d: number): InterchangeFraction {
  const gcd = (left: number, right: number): number => right === 0 ? Math.abs(left) : gcd(right, left % right);
  const divisor = gcd(n, d) || 1;
  return { n: n / divisor, d: d / divisor };
}

function record(value: unknown, path: string): Node {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Gp78AdapterError('invalidGpif', path, 'Expected a GPIF element.');
  return value as Node;
}

function integer(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = xmlText(value);
  if (!/^-?(0|[1-9][0-9]*)$/.test(raw)) throw new Gp78AdapterError('invalidGpif', path, 'Expected a decimal integer.');
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Gp78AdapterError('invalidGpif', path, `Integer must be in ${min}..${max}.`);
  return number;
}

function property(staff: Node, name: string): Node | undefined {
  const properties = xmlChild(staff, 'Properties');
  return xmlChildren(properties, 'Property').map(value => record(value, 'GPIF/Tracks/Track/Staves/Staff/Properties/Property'))
    .find(value => xmlAttr(value, 'name') === name);
}

function parseTuning(staff: Node, path: string): InterchangeTuning {
  const tuningProperty = property(staff, 'Tuning');
  const rawPitches = xmlText(xmlChild(tuningProperty, 'Pitches'));
  const tokens = rawPitches.split(/\s+/).filter(Boolean);
  if (tokens.length !== 6 || tokens.some(token => !/^(0|[1-9][0-9]*)$/.test(token))) {
    throw new Gp78AdapterError('unsupportedSemantics', `${path}/Tuning`, 'Track must have a six-string guitar tuning with integer MIDI pitches.');
  }
  const openMidi = tokens.map(Number);
  if (openMidi.some(value => !Number.isSafeInteger(value) || value < 0 || value > 127)) {
    throw new Gp78AdapterError('invalidGpif', `${path}/Tuning`, 'Tuning MIDI pitch is out of range.');
  }
  const canonical = TUNING_PRESETS.find(preset => {
    const parsed = parseTuningValue(preset);
    return parsed.ok && parsed.tuning.openMidi.every((pitch, index) => pitch === openMidi[index]);
  });
  return { openMidi: openMidi as unknown as InterchangeTuning['openMidi'], ...(canonical ? { preset: canonical } : {}) };
}

function parseCapo(staff: Node, path: string): number {
  const capoProperty = property(staff, 'CapoFret');
  const fret = xmlChild(capoProperty, 'Fret');
  return fret === undefined ? 0 : integer(fret, `${path}/CapoFret`, 0, 12);
}

function getTrackDescriptors(root: Node): TrackDescriptor[] {
  const tracks = indexGpifIds(xmlChild(xmlChild(root, 'Tracks'), 'Track'), 'GPIF/Tracks/Track');
  return [...tracks.entries()].map(([id, raw], order) => {
    const track = record(raw, `GPIF/Tracks/Track[id=${id}]`);
    const path = `GPIF/Tracks/Track[id=${id}]`;
    const name = xmlText(xmlChild(track, 'Name')) || `Track ${order + 1}`;
    const staves = xmlChildren(xmlChild(track, 'Staves'), 'Staff').map(value => record(value, `${path}/Staves/Staff`));
    let reasonCode: string | undefined;
    let staff: Node | undefined = staves[0];
    if (staves.length !== 1) reasonCode = 'staffCount';
    const instrumentType = xmlText(xmlChild(xmlChild(track, 'InstrumentSet'), 'Type'));
    if (!reasonCode && (!/guitar/i.test(instrumentType) || /bass|banjo|ukulele/i.test(instrumentType))) reasonCode = 'notSixStringGuitar';
    let tuning: InterchangeTuning | undefined;
    let stringCount: number | null = null;
    let capo = 0;
    if (staff) {
    try {
      tuning = parseTuning(staff, path);
      stringCount = tuning.openMidi.length;
      capo = parseCapo(staff, path);
      if (!reasonCode && stringCount !== 6) reasonCode = 'stringCount';
    } catch (error) {
      if (!reasonCode) reasonCode = error instanceof Gp78AdapterError ? error.gpCode === 'unsupportedSemantics' ? 'tuning' : 'invalidTuning' : 'invalidTuning';
      stringCount = null;
    }
    }
    if (!staff) staff = {};
    if (!tuning) tuning = { openMidi: [40, 45, 50, 55, 59, 64] };
    return Object.freeze({ id, order, name, stringCount, staffCount: staves.length, eligible: reasonCode === undefined, ...(reasonCode ? { reasonCode } : {}), raw: track, staff, tuning, capo });
  });
}

function parseTimeSignature(value: unknown, path: string): InterchangeTimeSignature {
  const raw = xmlText(value);
  const match = /^(\d{1,2})\/(1|2|4|8|16)$/.exec(raw);
  if (!match) throw new Gp78AdapterError('unsupportedSemantics', path, `Unsupported time signature ${raw || '(missing)'}.`);
  const parsed = parseInterchangeTimeSignature(raw);
  if (!parsed.ok) throw new Gp78AdapterError('unsupportedSemantics', path, `Time signature ${raw} is not accepted by the shared score-event model.`);
  return parsed.value;
}

function keyName(keyValue: unknown, path: string): string {
  const key = record(keyValue, path);
  const count = integer(xmlChild(key, 'AccidentalCount'), `${path}/AccidentalCount`, -7, 7);
  const mode = xmlText(xmlChild(key, 'Mode'));
  const majorSharp = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
  const majorFlat = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
  const minorSharp = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m'];
  const minorFlat = ['Am', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm'];
  const index = Math.abs(count);
  if (mode === 'Major') return count < 0 ? majorFlat[index] : majorSharp[index];
  if (mode === 'Minor') return count < 0 ? minorFlat[index] : minorSharp[index];
  throw new Gp78AdapterError('unsupportedSemantics', `${path}/Mode`, `Unsupported key mode ${mode || '(missing)'}.`);
}

function readRepeat(masterBar: Node, path: string): {
  readonly repeatStart: boolean;
  readonly repeatEnd: boolean;
  readonly bracket?: string;
  readonly specialMark?: 'segno' | 'coda' | 'fine' | 'to_coda' | 'dc' | 'ds';
} {
  const repeat = xmlChild(masterBar, 'Repeat');
  const start = repeat ? xmlAttr(repeat, 'start') === 'true' : false;
  const end = repeat ? xmlAttr(repeat, 'end') === 'true' : false;
  const countRaw = repeat ? xmlAttr(repeat, 'count') : undefined;
  const count = countRaw === undefined ? undefined : integer(countRaw, `${path}/Repeat/@count`, 0, 99);
  if (end && count !== undefined && count !== 2) {
    throw new Gp78AdapterError('unsupportedSemantics', `${path}/Repeat/@count`, 'Only the standard two-pass repeat is representable.');
  }
  if (!end && count !== undefined && count !== 0 && count !== 2) {
    throw new Gp78AdapterError('unsupportedSemantics', `${path}/Repeat/@count`, 'Repeat pass count is not representable.');
  }

  let bracket: string | undefined;
  const endings = xmlChild(masterBar, 'AlternateEndings');
  if (endings) {
    const raw = xmlText(endings).trim();
    const values = raw.split(/\s+/).filter(Boolean);
    if (values.length !== 1) {
      throw new Gp78AdapterError('unsupportedSemantics', `${path}/AlternateEndings`, 'Only one alternate ending pass per measure is representable.');
    }
    const pass = integer(values[0], `${path}/AlternateEndings`, 1, 8);
    bracket = `${pass}.`;
  }

  let specialMark: 'segno' | 'coda' | 'fine' | 'to_coda' | 'dc' | 'ds' | undefined;
  const directions = xmlChild(masterBar, 'Directions');
  if (directions) {
    const entries = ['Target', 'Jump'].flatMap(tag => xmlChildren(directions, tag).map(node => ({ tag, value: xmlText(node).trim() })));
    if (entries.length !== 1) {
      throw new Gp78AdapterError('unsupportedSemantics', `${path}/Directions`, 'Only one navigation direction per measure is representable.');
    }
    const [direction] = entries;
    const targets: Readonly<Record<string, 'segno' | 'coda' | 'fine'>> = { Segno: 'segno', Coda: 'coda', Fine: 'fine' };
    const jumps: Readonly<Record<string, 'to_coda' | 'dc' | 'ds'>> = { DaCoda: 'to_coda', DaCapo: 'dc', DaSegno: 'ds' };
    specialMark = direction.tag === 'Target' ? targets[direction.value] : jumps[direction.value];
    if (!specialMark) {
      throw new Gp78AdapterError('unsupportedSemantics', `${path}/Directions/${direction.tag}`, `Navigation direction ${direction.value || '(empty)'} is not representable.`);
    }
  }
  return { repeatStart: start, repeatEnd: end, ...(bracket ? { bracket } : {}), ...(specialMark ? { specialMark } : {}) };
}

function noteValueFromRhythm(rhythm: Node, path: string): InterchangeNoteValue {
  const value = xmlText(xmlChild(rhythm, 'NoteValue'));
  const base = NOTE_BASES[value];
  if (!base) throw new Gp78AdapterError('unsupportedSemantics', `${path}/NoteValue`, `Unsupported GPIF rhythm value ${value || '(missing)'}.`);
  const extraTags = Object.keys(rhythm).filter(key => !['@_id', '#text', 'NoteValue', 'PrimaryTuplet'].includes(key));
  if (extraTags.length > 0) throw new Gp78AdapterError('unsupportedSemantics', path, `Dotted or extended rhythm properties are not yet mapped: ${extraTags.join(', ')}.`);
  const tuplets = xmlChildren(rhythm, 'PrimaryTuplet').map(value => record(value, `${path}/PrimaryTuplet`));
  if (tuplets.length > 1) throw new Gp78AdapterError('unsupportedSemantics', `${path}/PrimaryTuplet`, 'Nested or multiple tuplets are not representable.');
  if (tuplets.length === 0) return { beats: normalizedFraction(4, base), parts: [{ base, dotted: false }] };
  const actual = integer(xmlAttr(tuplets[0], 'num'), `${path}/PrimaryTuplet/@num`, 2, 9);
  const normal = integer(xmlAttr(tuplets[0], 'den'), `${path}/PrimaryTuplet/@den`, 1, 8);
  if (actual === normal) throw new Gp78AdapterError('invalidGpif', `${path}/PrimaryTuplet`, 'A tuplet must change the written note value.');
  return {
    beats: normalizedFraction(4 * normal, base * actual),
    parts: [{ base, dotted: false, tuplet: { actual, normal } }],
  };
}

function getChordDefinitions(staff: Node, path: string): { readonly byId: ReadonlyMap<number, Node>; readonly definitions: readonly InterchangeChordDefinition[] } {
  const diagramProperty = property(staff, 'DiagramCollection');
  const items = xmlChildren(xmlChild(diagramProperty, 'Items'), 'Item').map(value => record(value, `${path}/DiagramCollection/Item`));
  const byId = indexGpifIds<Node>(items, `${path}/DiagramCollection/Items/Item`);
  const definitions = items.map((item, index): InterchangeChordDefinition => {
    const name = xmlAttr(item, 'name');
    if (!name) throw new Gp78AdapterError('invalidGpif', `${path}/DiagramCollection/Item[${index}]`, 'Chord diagram name is missing.');
    const diagram = xmlChild(item, 'Diagram');
    if (!diagram) throw new Gp78AdapterError('unsupportedSemantics', `${path}/DiagramCollection/Item[${index}]`, 'Chord label has no Guitar Pro diagram.');
    const baseFretRaw = xmlAttr(diagram, 'baseFret');
    const baseFret = baseFretRaw === undefined ? 0 : Number(baseFretRaw);
    if (!Number.isInteger(baseFret) || baseFret < 0 || baseFret > 1) throw new Gp78AdapterError('unsupportedSemantics', `${path}/DiagramCollection/Item[${index}]/Diagram`, 'Only first-position chord diagrams are currently mapped.');
    const frets: Array<number | 'x'> = ['x', 'x', 'x', 'x', 'x', 'x'];
    const seen = new Set<number>();
    for (const fretNode of xmlChildren(diagram, 'Fret')) {
      const string = Number(xmlAttr(fretNode, 'string'));
      const fret = Number(xmlAttr(fretNode, 'fret'));
      if (!Number.isInteger(string) || string < 0 || string > 5 || !Number.isInteger(fret) || fret < 0 || fret > 24 || seen.has(string)) {
        throw new Gp78AdapterError('invalidGpif', `${path}/DiagramCollection/Item[${index}]/Diagram/Fret`, 'Chord diagram contains an invalid or duplicate string position.');
      }
      seen.add(string);
      frets[string] = fret;
    }
    const fingerNames: Readonly<Record<string, 'T' | '1' | '2' | '3' | '4'>> = { Thumb: 'T', Index: '1', Middle: '2', Ring: '3', Pinky: '4' };
    const fingerPositions = xmlChildren(xmlChild(diagram, 'Fingering'), 'Position');
    const fingers: Array<'T' | '1' | '2' | '3' | '4' | null> = Array(6).fill(null);
    let hasFinger = false;
    for (const position of fingerPositions) {
      const string = Number(xmlAttr(position, 'string'));
      const finger = xmlAttr(position, 'finger') ?? '';
      if (!Number.isInteger(string) || string < 0 || string > 5) throw new Gp78AdapterError('invalidGpif', `${path}/DiagramCollection/Item[${index}]/Diagram/Fingering`, 'Fingering string index is invalid.');
      if (finger === 'None') continue;
      if (!fingerNames[finger]) throw new Gp78AdapterError('unsupportedSemantics', `${path}/DiagramCollection/Item[${index}]/Diagram/Fingering`, `Unsupported finger ${finger}.`);
      fingers[string] = fingerNames[finger];
      hasFinger = true;
    }
    const chord = xmlChild(item, 'Chord');
    if (!chord) throw new Gp78AdapterError('unsupportedSemantics', `${path}/DiagramCollection/Item[${index}]`, 'Chord diagram lacks its harmonic definition.');
    return {
      name,
      frets,
      ...(baseFret === 1 ? { baseFret: 1 } : {}),
      ...(hasFinger ? { fingers } : {}),
      barres: [],
    };
  });
  return { byId, definitions };
}

type ParsedNote =
  | { readonly kind: 'tab'; readonly note: NonNullable<InterchangeTabBeat['notes']>[number]; readonly markers: TabNoteMarkers }
  | { readonly kind: 'melody'; readonly pitch: InterchangePitch; readonly tieOrigin: boolean; readonly tieDestination: boolean; readonly normalizedDoubleSharp: boolean };

function effect(name: string, args: Readonly<Record<string, string | number>> = {}) {
  return { name, args };
}

function enabledProperty(value: Node | undefined, path: string): boolean {
  if (value === undefined) return false;
  if (xmlChild(value, 'Enable') === undefined) throw new Gp78AdapterError('unsupportedSemantics', path, 'Only enabled GPIF effect markers are mapped.');
  return true;
}

function bendAmount(values: ReadonlyMap<string, Node>, path: string): number | undefined {
  const bendProperty = values.get('Bended');
  const bendKeys = ['BendOriginOffset', 'BendOriginValue', 'BendMiddleOffset1', 'BendMiddleOffset2', 'BendMiddleValue', 'BendDestinationOffset', 'BendDestinationValue'];
  const present = bendKeys.filter(name => values.has(name));
  if (!bendProperty && present.length === 0) return undefined;
  if (!enabledProperty(bendProperty, `${path}/Properties/Bended`) || present.length !== bendKeys.length) {
    throw new Gp78AdapterError('unsupportedSemantics', `${path}/Properties`, 'A bend requires one complete, enabled GPIF bend curve.');
  }
  const number = (name: string): number => {
    const raw = xmlText(xmlChild(values.get(name)!, 'Float'));
    if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(raw)) throw new Gp78AdapterError('invalidGpif', `${path}/Properties/${name}`, 'Bend curve value must be a decimal number.');
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) throw new Gp78AdapterError('invalidGpif', `${path}/Properties/${name}`, 'Bend curve value is not finite.');
    return parsed;
  };
  const originOffset = number('BendOriginOffset');
  const originValue = number('BendOriginValue');
  const middleOffset1 = number('BendMiddleOffset1');
  const middleOffset2 = number('BendMiddleOffset2');
  const middleValue = number('BendMiddleValue');
  const destinationOffset = number('BendDestinationOffset');
  const destinationValue = number('BendDestinationValue');
  const amount = destinationValue / 50;
  const allowedAmount = amount >= 0.5 && amount <= 4 && Number.isInteger(amount * 2);
  if (originOffset !== 0 || originValue !== 0 || middleOffset1 !== middleOffset2 || middleOffset1 <= 0 ||
      destinationOffset < middleOffset1 || middleValue !== destinationValue / 2 || !allowedAmount) {
    throw new Gp78AdapterError('unsupportedSemantics', `${path}/Properties`, 'Only a simple half-step bend with a symmetric single midpoint is representable.');
  }
  return amount;
}

function booleanAttribute(node: Node | undefined, attribute: string, path: string): boolean {
  if (node === undefined) return false;
  const value = xmlAttr(node, attribute);
  if (value !== 'true' && value !== 'false') throw new Gp78AdapterError('invalidGpif', `${path}/@${attribute}`, 'Expected a boolean GPIF attribute.');
  return value === 'true';
}

function melodyPitch(property: Node, path: string): InterchangePitch {
  const pitch = record(xmlChild(property, 'Pitch'), `${path}/Pitch`);
  const step = xmlText(xmlChild(pitch, 'Step'));
  const accidental = xmlText(xmlChild(pitch, 'Accidental'));
  const alter: Readonly<Record<string, -1 | 0 | 1 | 2>> = { '': 0, Natural: 0, '#': 1, Sharp: 1, b: -1, Flat: -1, x: 2 };
  if (!/^[A-G]$/.test(step) || alter[accidental] === undefined) {
    throw new Gp78AdapterError('unsupportedSemantics', path, 'Standard-staff pitch uses an unsupported step or accidental.');
  }
  const octave = integer(xmlChild(pitch, 'Octave'), `${path}/Pitch/Octave`, 0, 9);
  if (accidental !== 'x') return { step: step.toLowerCase() as InterchangePitch['step'], alter: alter[accidental] as -1 | 0 | 1, octave };

  const stepSemitones: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const absolute = octave * 12 + stepSemitones[step] + alter[accidental];
  const normalizedOctave = Math.floor(absolute / 12);
  if (normalizedOctave < 0 || normalizedOctave > 9) {
    throw new Gp78AdapterError('unsupportedSemantics', path, 'Enharmonic spelling normalization exceeds the supported octave range.');
  }
  const normalized = [
    { step: 'c', alter: 0 }, { step: 'c', alter: 1 },
    { step: 'd', alter: 0 }, { step: 'd', alter: 1 },
    { step: 'e', alter: 0 }, { step: 'f', alter: 0 }, { step: 'f', alter: 1 },
    { step: 'g', alter: 0 }, { step: 'g', alter: 1 },
    { step: 'a', alter: 0 }, { step: 'a', alter: 1 }, { step: 'b', alter: 0 },
  ][((absolute % 12) + 12) % 12];
  return { ...normalized, octave: normalizedOctave } as InterchangePitch;
}

function hasDoubleSharp(property: Node): boolean {
  return xmlText(xmlChild(xmlChild(property, 'Pitch'), 'Accidental')) === 'x';
}

function readNote(note: Node, model: ReturnType<typeof createInstrumentModel>, path: string, showTablature?: boolean): ParsedNote {
  const unsupportedElements = Object.keys(note).filter(key => !['@_id', '#text', 'InstrumentArticulation', 'Properties', 'Tie', 'LetRing'].includes(key));
  if (unsupportedElements.length > 0) throw new Gp78AdapterError('unsupportedSemantics', path, `Unsupported note elements: ${unsupportedElements.join(', ')}.`);
  const properties = xmlChildren(xmlChild(note, 'Properties'), 'Property').map(value => record(value, `${path}/Properties/Property`));
  if (new Set(properties.map(value => xmlAttr(value, 'name') ?? '')).size !== properties.length) {
    throw new Gp78AdapterError('invalidGpif', `${path}/Properties`, 'Duplicate note property names are ambiguous.');
  }
  const values = new Map(properties.map(value => [xmlAttr(value, 'name') ?? '', value]));
  const known = new Set([
    'ConcertPitch', 'Fret', 'Midi', 'String', 'TransposedPitch', 'HopoOrigin', 'HopoDestination', 'Slide', 'PalmMuted', 'Bended',
    'BendOriginOffset', 'BendOriginValue', 'BendMiddleOffset1', 'BendMiddleOffset2', 'BendMiddleValue', 'BendDestinationOffset', 'BendDestinationValue',
  ]);
  const unexpected = [...values.keys()].filter(name => !known.has(name));
  if (unexpected.length > 0) throw new Gp78AdapterError('unsupportedSemantics', `${path}/Properties`, `Unsupported note properties: ${unexpected.join(', ')}.`);
  const articulation = xmlText(xmlChild(note, 'InstrumentArticulation'));
  if (articulation !== '' && articulation !== '0') throw new Gp78AdapterError('unsupportedSemantics', `${path}/InstrumentArticulation`, 'Non-default instrument articulation is not mapped.');
  const tieRaw = xmlChild(note, 'Tie');
  const tieNode = tieRaw === undefined ? undefined : record(tieRaw, `${path}/Tie`);
  const tieOrigin = booleanAttribute(tieNode, 'origin', `${path}/Tie`);
  const tieDestination = booleanAttribute(tieNode, 'destination', `${path}/Tie`);
  const tabFields = ['Fret', 'Midi', 'String'].filter(name => values.has(name));
  // GP8 writes these two's-complement sentinels when saving standard-only notes.
  // They mean that the score has no TAB position, not that the fret/string values are invalid.
  const gp8NoTabPosition = tabFields.length === 3 &&
    xmlText(xmlChild(values.get('Fret')!, 'Fret')) === '-2147483648' &&
    xmlText(xmlChild(values.get('Midi')!, 'Number')) === '2147483648' &&
    xmlText(xmlChild(values.get('String')!, 'String')) === '0';
  if (tabFields.length === 0 || showTablature === false || gp8NoTabPosition) {
    const concertPitch = values.get('ConcertPitch');
    if (!concertPitch) throw new Gp78AdapterError('unsupportedSemantics', `${path}/Properties`, 'A standard-staff note has no concert pitch.');
    if (['HopoOrigin', 'HopoDestination', 'Slide', 'PalmMuted', 'Bended', 'BendOriginOffset', 'BendOriginValue', 'BendMiddleOffset1', 'BendMiddleOffset2', 'BendMiddleValue', 'BendDestinationOffset', 'BendDestinationValue'].some(name => values.has(name)) ||
        xmlChild(note, 'LetRing') !== undefined) {
      throw new Gp78AdapterError('unsupportedSemantics', path, 'TAB-only effects on standard-staff notes are not mapped.');
    }
    if (values.has('TransposedPitch')) {
      const transposed = melodyPitch(values.get('TransposedPitch')!, `${path}/Properties/TransposedPitch`);
      const concert = melodyPitch(concertPitch, `${path}/Properties/ConcertPitch`);
      if (transposed.step !== concert.step || transposed.alter !== concert.alter || transposed.octave !== concert.octave + 1) {
        throw new Gp78AdapterError('unsupportedSemantics', `${path}/Properties/TransposedPitch`, 'Guitar transposition is not the supported octave-only mapping.');
      }
    }
    return {
      kind: 'melody',
      pitch: melodyPitch(concertPitch, `${path}/Properties/ConcertPitch`),
      tieOrigin,
      tieDestination,
      normalizedDoubleSharp: hasDoubleSharp(concertPitch),
    };
  }
  if (tabFields.length !== 3) throw new Gp78AdapterError('invalidGpif', `${path}/Properties`, 'TAB position properties must be present together.');
  const gpString = integer(xmlChild(values.get('String') ?? {}, 'String'), `${path}/String`, 0, 5);
  const fret = integer(xmlChild(values.get('Fret') ?? {}, 'Fret'), `${path}/Fret`, 0, 24);
  const midi = integer(xmlChild(values.get('Midi') ?? {}, 'Number'), `${path}/Midi`, 0, 127);
  const string = (6 - gpString) as GuitarString;
  let expectedPitch: number;
  try {
    expectedPitch = model.pitchAt(string, fret);
  } catch {
    throw new Gp78AdapterError('invalidGpif', path, 'Note string or fret is outside the configured guitar range.');
  }
  if (expectedPitch !== midi) throw new Gp78AdapterError('invalidGpif', `${path}/Midi`, `Stored MIDI pitch ${midi} does not match tuning/capo/fret pitch ${expectedPitch}.`);
  const hopoOrigin = enabledProperty(values.get('HopoOrigin'), `${path}/Properties/HopoOrigin`);
  const hopoDestination = enabledProperty(values.get('HopoDestination'), `${path}/Properties/HopoDestination`);
  const noteEffects = [];
  const slide = values.get('Slide');
  if (slide) {
    const flags = integer(xmlChild(slide, 'Flags'), `${path}/Properties/Slide/Flags`, 1, 2);
    if (flags !== 2) throw new Gp78AdapterError('unsupportedSemantics', `${path}/Properties/Slide/Flags`, 'Only the observed legato slide mapping is supported.');
    noteEffects.push(effect('slide'));
  }
  if (enabledProperty(values.get('PalmMuted'), `${path}/Properties/PalmMuted`)) noteEffects.push(effect('pm'));
  if (xmlChild(note, 'LetRing') !== undefined) noteEffects.push(effect('let-ring'));
  const amount = bendAmount(values, path);
  if (amount !== undefined) noteEffects.push(effect('bend', { amount }));
  return {
    kind: 'tab',
    note: { string, fret, dead: false, tieToNext: tieOrigin, effects: noteEffects },
    markers: { hopoOrigin, hopoDestination, tieOrigin, tieDestination },
  };
}

function readBeatLyrics(beat: Node, path: string): string[] {
  const value = xmlChild(beat, 'Lyrics');
  if (value === undefined) return [];
  const lyrics = record(value, `${path}/Lyrics`);
  const unsupported = Object.keys(lyrics).filter(key => !['#text', 'Line'].includes(key));
  if (unsupported.length > 0) throw new Gp78AdapterError('unsupportedSemantics', `${path}/Lyrics`, `Unsupported lyric elements: ${unsupported.join(', ')}.`);
  const containerText = xmlChild(lyrics, '#text');
  if (typeof containerText === 'string' && containerText.trim() !== '') {
    throw new Gp78AdapterError('unsupportedSemantics', `${path}/Lyrics`, 'Lyrics contains text outside its Line elements.');
  }
  return xmlChildren(lyrics, 'Line').map((line, index) => {
    const linePath = `${path}/Lyrics/Line[${index}]`;
    if (typeof line === 'string') return decodeXmlText(line);
    const lineNode = record(line, linePath);
    const unsupportedLineFields = Object.keys(lineNode).filter(key => key !== '#text');
    if (unsupportedLineFields.length > 0) {
      throw new Gp78AdapterError('unsupportedSemantics', linePath, `Unsupported lyric line fields: ${unsupportedLineFields.join(', ')}.`);
    }
    return decodeXmlText(xmlChild(lineNode, '#text'));
  });
}

function applyBeatLyrics(
  measures: InterchangeMeasure[],
  parsedByMeasure: readonly (readonly ParsedBeat[])[],
  markersByMeasure: readonly (readonly (readonly TabNoteMarkers[])[])[],
): void {
  interface Target {
    readonly measureIndex: number;
    readonly beatIndex: number;
    readonly beatId: number;
    readonly lines: readonly string[];
    readonly kind: 'tab' | 'melody' | null;
    readonly takesSlot: boolean;
    readonly melodyStart: number;
    readonly melodyCount: number;
  }
  const targets: Target[] = [];
  let verseCount = 0;
  let lyricKind: 'tab' | 'melody' | undefined;
  for (const [measureIndex, parsedBeats] of parsedByMeasure.entries()) {
    let melodyStart = 0;
    const measure = measures[measureIndex];
    for (const [beatIndex, parsed] of parsedBeats.entries()) {
      const hasLyrics = parsed.lyrics.some(text => text.trim().length > 0);
      const kind = parsed.hasTabNotes ? 'tab' : parsed.melodyNotes.length > 0 ? 'melody' : null;
      const tabBeat = measure.tabVoices?.[0]?.beats[beatIndex];
      const tabMarkers = markersByMeasure[measureIndex]?.[beatIndex] ?? [];
      const takesTabSlot = !!tabBeat && !tabBeat.isRest && tabBeat.notes.some((note, noteIndex) =>
        note.dead || tabMarkers[noteIndex]?.tieDestination !== true);
      const melody = measure.melody ?? [];
      const melodyNotes = melody.slice(melodyStart, melodyStart + parsed.melodyNotes.length);
      const takesMelodySlot = melodyNotes.some(note => !note.isRest && !note.techniques?.grace);
      const takesSlot = kind === 'tab' ? takesTabSlot : kind === 'melody' ? takesMelodySlot : false;
      const authoredLines = parsed.lyrics.flatMap((text, verse) => text.trim().length > 0 ? [verse] : []);
      if (authoredLines.length > 0) {
        const line = authoredLines[0];
        if (!takesSlot || kind === null) {
          throw new Gp78AdapterError('unsupportedSemantics', `GPIF/Beats/Beat[id=${parsed.beatId}]/Lyrics/Line[${line}]`, 'Lyrics are attached to a beat without a lyric attack slot.');
        }
        if (lyricKind !== undefined && lyricKind !== kind) {
          throw new Gp78AdapterError('unsupportedSemantics', `GPIF/Beats/Beat[id=${parsed.beatId}]/Lyrics`, 'Lyrics mix TAB and standard-staff notation in one selected track.');
        }
        lyricKind = kind;
        verseCount = Math.max(verseCount, ...authoredLines.map(verse => verse + 1));
      }
      targets.push({ measureIndex, beatIndex, beatId: parsed.beatId, lines: parsed.lyrics, kind, takesSlot, melodyStart, melodyCount: parsed.melodyNotes.length });
      melodyStart += parsed.melodyNotes.length;
    }
  }
  if (verseCount === 0) return;
  if (lyricKind === 'melody' && targets.some(target => target.kind === 'melody' && target.melodyCount > 1)) {
    const target = targets.find(value => value.kind === 'melody' && value.melodyCount > 1)!;
    throw new Gp78AdapterError('unsupportedSemantics', `GPIF/Beats/Beat[id=${target.beatId}]/Notes`, 'Lyrics cannot be aligned to a multi-note standard-staff beat.');
  }

  const slots = targets.filter(target => target.takesSlot);
  const lastLyricSlot = Array.from({ length: verseCount }, () => -1);
  slots.forEach((target, slotIndex) => target.lines.forEach((text, verse) => {
    if (text.trim().length > 0) lastLyricSlot[verse] = slotIndex;
  }));
  slots.forEach((target, slotIndex) => {
    let lastActiveVerse = -1;
    lastLyricSlot.forEach((lastSlot, verse) => { if (lastSlot >= slotIndex) lastActiveVerse = verse; });
    const syllables: InterchangeLyricSlot[] = [];
    for (let verse = 0; verse <= lastActiveVerse; verse++) {
      const text = target.lines[verse] ?? '';
      if (text.trim().length > 0) syllables.push({ text, hyphenToNext: false, extend: false });
      else if (lastLyricSlot[verse] >= slotIndex) syllables.push(null);
      else syllables.push({ kind: 'omitted' });
    }
    const measure = measures[target.measureIndex];
    if (target.kind === 'tab') {
      const voice = measure.tabVoices?.[0];
      if (!voice) throw new Gp78AdapterError('invalidIr', `/measures/${target.measureIndex}/tabVoices`, 'TAB lyric target is missing its voice.');
      const beats = [...voice.beats];
      beats[target.beatIndex] = { ...beats[target.beatIndex], syllables };
      measures[target.measureIndex] = { ...measure, tabVoices: [{ ...voice, beats }] };
    } else if (target.kind === 'melody') {
      if (target.melodyCount !== 1) throw new Gp78AdapterError('unsupportedSemantics', `GPIF/Beats/Beat[id=${target.beatId}]/Notes`, 'Lyrics require one standard-staff note per beat.');
      const melody = [...(measure.melody ?? [])];
      melody[target.melodyStart] = { ...melody[target.melodyStart], syllables };
      measures[target.measureIndex] = { ...measure, melody };
    }
  });
}

function readBeat(
  beat: Node,
  beatId: number,
  noteMap: ReadonlyMap<number, Node>,
  rhythmMap: ReadonlyMap<number, Node>,
  chordMap: ReadonlyMap<number, Node>,
  model: ReturnType<typeof createInstrumentModel>,
  showTablature?: boolean,
): ParsedBeat {
  const path = `GPIF/Beats/Beat[id=${beatId}]`;
  const unsupported = Object.keys(beat).filter(key => !['@_id', '#text', 'Dynamic', 'Rhythm', 'TransposedPitchStemOrientation', 'ConcertPitchStemOrientation', 'Chord', 'Notes', 'Rest', 'Properties', 'Lyrics'].includes(key));
  if (unsupported.length > 0) throw new Gp78AdapterError('unsupportedSemantics', path, `Unsupported beat elements: ${unsupported.join(', ')}.`);
  const lyrics = readBeatLyrics(beat, path);
  const dynamic = xmlText(xmlChild(beat, 'Dynamic'));
  if (dynamic && dynamic !== 'MF') throw new Gp78AdapterError('unsupportedSemantics', `${path}/Dynamic`, `Dynamic ${dynamic} is not mapped at its exact beat position.`);
  const rhythmReference = xmlChild(beat, 'Rhythm');
  const rhythm = resolveGpifRef(rhythmReference, rhythmMap, `${path}/Rhythm`);
  const duration = noteValueFromRhythm(record(rhythm, `${path}/Rhythm`), `${path}/Rhythm`);
  const noteIds = parseGpifIdList(xmlChild(beat, 'Notes'), `${path}/Notes`, true);
  const parsedNotes = noteIds.map((id, index) => {
    if (id === null) throw new Gp78AdapterError('invalidGpif', `${path}/Notes[${index}]`, 'Null note references are not valid.');
    return readNote(record(resolveGpifRef(String(id), noteMap, `${path}/Notes[${index}]`, 'ref'), `${path}/Notes[${index}]`), model, `${path}/Notes[${index}]`, showTablature);
  });
  const tabNotes = parsedNotes.filter((value): value is Extract<ParsedNote, { kind: 'tab' }> => value.kind === 'tab').map(value => value.note);
  const tabMarkers = parsedNotes.filter((value): value is Extract<ParsedNote, { kind: 'tab' }> => value.kind === 'tab').map(value => value.markers);
  const standardNotes = parsedNotes.filter((value): value is Extract<ParsedNote, { kind: 'melody' }> => value.kind === 'melody');
  if (tabNotes.length > 0 && standardNotes.length > 0) {
    throw new Gp78AdapterError('unsupportedSemantics', `${path}/Notes`, 'A beat cannot mix TAB-positioned and standard-staff-only notes in GPIF v1.');
  }
  const chordText = xmlText(xmlChild(beat, 'Chord'));
  let chordId: number | undefined;
  if (chordText) {
    chordId = parseGpifId(chordText, `${path}/Chord`);
    if (!chordMap.has(chordId)) throw new Gp78AdapterError('invalidGpif', `${path}/Chord`, `Chord diagram reference ${chordId} is unresolved.`);
  }
  const explicitRest = xmlChild(beat, 'Rest') !== undefined;
  const hasTabRest = explicitRest || (parsedNotes.length === 0 && chordId === undefined);
  const properties = xmlChildren(xmlChild(beat, 'Properties'), 'Property').map(value => record(value, `${path}/Properties/Property`));
  const unexpectedProperties = properties.map(value => xmlAttr(value, 'name') ?? '').filter(name => !['PrimaryPickupVolume', 'PrimaryPickupTone'].includes(name));
  if (unexpectedProperties.length > 0) throw new Gp78AdapterError('unsupportedSemantics', `${path}/Properties`, `Unsupported beat properties: ${unexpectedProperties.join(', ')}.`);
  const tabBeat: InterchangeTabBeat = {
    isRest: parsedNotes.length === 0,
    notes: tabNotes,
    duration,
    effects: [],
    syllables: [],
  };
  const melodyNotes: InterchangeNote[] = [];
  if (standardNotes.length > 0) {
    const tieOrigin = standardNotes[0].tieOrigin;
    const tieDestination = standardNotes[0].tieDestination;
    if (standardNotes.some(note => note.tieOrigin !== tieOrigin || note.tieDestination !== tieDestination)) {
      throw new Gp78AdapterError('unsupportedSemantics', `${path}/Notes`, 'Notes in one standard-staff pitch group have inconsistent tie flags.');
    }
    const pitches = standardNotes.map(note => note.pitch);
    melodyNotes.push({
      isRest: false,
      ...(pitches.length === 1 ? { pitch: pitches[0] } : { pitches }),
      duration,
      tieToNext: tieOrigin,
      tiedFromPrev: tieDestination,
      syllables: [],
    });
  } else if (parsedNotes.length === 0 && chordId === undefined && showTablature === false) {
    melodyNotes.push({
      isRest: true,
      duration,
      tieToNext: false,
      tiedFromPrev: false,
      syllables: [],
    });
  }
  return {
    beatId,
    tabBeat,
    tabMarkers,
    duration,
    melodyNotes,
    hasTabNotes: tabNotes.length > 0,
    hasTabRest,
    normalizedDoubleSharp: parsedNotes.some(value => value.kind === 'melody' && value.normalizedDoubleSharp),
    lyrics,
    ...(chordId === undefined ? {} : { chordId }),
  };
}

function parseTempoAutomations(root: Node): ReadonlyMap<number, number> {
  const automations = xmlChildren(xmlChild(xmlChild(root, 'MasterTrack'), 'Automations'), 'Automation');
  const result = new Map<number, number>();
  for (const raw of automations) {
    const automation = record(raw, 'GPIF/MasterTrack/Automations/Automation');
    if (xmlText(xmlChild(automation, 'Type')) !== 'Tempo') continue;
    const bar = integer(xmlChild(automation, 'Bar'), 'GPIF/MasterTrack/Automations/Automation/Bar', 0, 1_000_000);
    const positionRaw = xmlText(xmlChild(automation, 'Position'));
    if (positionRaw && Number(positionRaw) !== 0) throw new Gp78AdapterError('unsupportedSemantics', 'GPIF/MasterTrack/Automations/Automation/Position', 'Mid-measure tempo changes are not representable by the current interchange model.');
    const value = xmlText(xmlChild(automation, 'Value')).split(/\s+/)[0];
    const bpm = Number(value);
    if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 1000) throw new Gp78AdapterError('invalidGpif', 'GPIF/MasterTrack/Automations/Automation/Value', 'Tempo value is invalid.');
    if (result.has(bar)) throw new Gp78AdapterError('invalidGpif', `GPIF/MasterTrack/Automations/Automation[Bar=${bar}]`, 'Duplicate tempo automation at the same bar.');
    result.set(bar, bpm);
  }
  return result;
}

function addNonMusicLoss(loss: ReturnType<typeof emptyLossReport>): ReturnType<typeof emptyLossReport> {
  return appendLoss(appendLoss(loss, {
    category: 'droppedByPolicy', code: 'omittedRseSettings', path: '/GPIF/Tracks/*/RSE',
    detail: 'GP instrument sound and effect-chain settings are outside the interchange score model.', policyId: 'gp78.omit-rse-settings.v1',
  }), {
    category: 'droppedByPolicy', code: 'omittedDisplayLayout', path: '/GPIF/ScoreViews',
    detail: 'Page layout and view-only score settings are outside the interchange score model.', policyId: 'gp78.omit-display-layout.v1',
  });
}

export function summarizeGp78Tracks(root: Node): readonly Gp78TrackSummary[] {
  const descriptors = getTrackDescriptors(root);
  const barMap = indexGpifIds<Node>(xmlChild(root, 'Bar') ?? xmlChild(xmlChild(root, 'Bars'), 'Bar'), 'GPIF/Bars/Bar');
  const masterBars = xmlChildren(xmlChild(root, 'MasterBars'), 'MasterBar');
  const summaries = descriptors.map(descriptor => {
    let reasonCode = descriptor.reasonCode;
    if (!reasonCode) {
      for (let index = 0; index < masterBars.length; index++) {
        const masterBar = record(masterBars[index], `GPIF/MasterBars/MasterBar[${index}]`);
        const refs = parseGpifIdList(xmlChild(masterBar, 'Bars'), `GPIF/MasterBars/MasterBar[${index}]/Bars`, true);
        const barId = refs[descriptor.order];
        if (barId === undefined || barId === null) {
          reasonCode = 'missingTrackBar';
          break;
        }
        const bar = record(resolveGpifRef(String(barId), barMap, `GPIF/MasterBars/MasterBar[${index}]/Bars[${descriptor.order}]`, 'ref'), `GPIF/Bars/Bar[id=${barId}]`);
        const voices = parseGpifIdList(xmlChild(bar, 'Voices'), `GPIF/Bars/Bar[id=${barId}]/Voices`, true);
        if (voices.length !== 4) { reasonCode = 'voiceCount'; break; }
        if (voices.slice(1).some(id => id !== null)) { reasonCode = 'multipleVoices'; break; }
      }
    }
    return Object.freeze({
      id: descriptor.id, order: descriptor.order, name: descriptor.name, stringCount: descriptor.stringCount,
      staffCount: descriptor.staffCount, eligible: reasonCode === undefined, ...(reasonCode ? { reasonCode } : {}),
    });
  });
  return Object.freeze(summaries);
}

export function gpifToInterchange(root: Node, selectedTrackId: number, trackNotations?: readonly Gp78TrackNotation[], audioTrackPresent = false): { readonly score: InterchangeScore; readonly loss: ReturnType<typeof emptyLossReport> } {
  const descriptors = getTrackDescriptors(root);
  const descriptor = descriptors.find(track => track.id === selectedTrackId);
  if (!descriptor) throw new Gp78AdapterError('unsupportedSemantics', 'selectedTrackId', `Track ID ${selectedTrackId} does not exist.`);
  if (!descriptor.eligible) throw new Gp78AdapterError('unsupportedSemantics', `GPIF/Tracks/Track[id=${selectedTrackId}]`, `Selected track is not eligible: ${descriptor.reasonCode}.`);
  const showTablature = trackNotations?.[descriptor.order]?.tablature;

  const barMap = indexGpifIds<Node>(xmlChild(xmlChild(root, 'Bars'), 'Bar'), 'GPIF/Bars/Bar');
  const voiceMap = indexGpifIds<Node>(xmlChild(xmlChild(root, 'Voices'), 'Voice'), 'GPIF/Voices/Voice');
  const beatMap = indexGpifIds<Node>(xmlChild(xmlChild(root, 'Beats'), 'Beat'), 'GPIF/Beats/Beat');
  const noteMap = indexGpifIds<Node>(xmlChild(xmlChild(root, 'Notes'), 'Note'), 'GPIF/Notes/Note');
  const rhythmMap = indexGpifIds<Node>(xmlChild(xmlChild(root, 'Rhythms'), 'Rhythm'), 'GPIF/Rhythms/Rhythm');
  const { byId: chordMap, definitions: chordDefinitions } = getChordDefinitions(descriptor.staff, `GPIF/Tracks/Track[id=${selectedTrackId}]/Staves/Staff`);
  const masterBars = xmlChildren(xmlChild(root, 'MasterBars'), 'MasterBar').map((value, index) => record(value, `GPIF/MasterBars/MasterBar[${index}]`));
  if (masterBars.length === 0) throw new Gp78AdapterError('invalidGpif', 'GPIF/MasterBars', 'Score has no written measures.');
  const tempos = parseTempoAutomations(root);
  const initialTempo = tempos.get(0) ?? 120;
  let loss = addNonMusicLoss(emptyLossReport());
  if (audioTrackPresent) {
    loss = appendLoss(loss, {
      category: 'droppedByPolicy', code: 'unselectedTrack', path: '/GP8/AudioTrack',
      detail: 'The embedded audio track and its SyncPoints were omitted after the user selected a score track.', policyId: 'gp78.user-selected-single-track.v1',
    });
  }
  for (const track of descriptors) {
    if (track.id !== selectedTrackId) {
      loss = appendLoss(loss, {
        category: 'droppedByPolicy', code: 'unselectedTrack', path: `/GPIF/Tracks/Track[id=${track.id}]`,
        detail: `Track "${track.name}" was omitted after the selected track was chosen.`, policyId: 'gp78.user-selected-single-track.v1',
      });
    }
  }
  if (!tempos.has(0)) {
    loss = appendLoss(loss, {
      category: 'inferred', code: 'defaultTempo', path: '/GPIF/MasterTrack/Automations',
      detail: 'No initial tempo automation was present; the GuitarDSL default of 120 BPM was used.', policyId: 'gp78.default-tempo-120.v1',
    });
  }

  let previousKey = '';
  let previousTime: InterchangeTimeSignature | undefined;
  let previousTempo = initialTempo;
  const hasAnacrusis = xmlChild(xmlChild(root, 'MasterTrack'), 'Anacrusis') !== undefined;
  const measures: InterchangeMeasure[] = [];
  const parsedTabMarkersByMeasure: Array<readonly (readonly TabNoteMarkers[])[]> = [];
  const parsedBeatsByMeasure: ParsedBeat[][] = [];
  const model = createInstrumentModel({ openMidi: descriptor.tuning.openMidi }, descriptor.capo);
  for (let measureIndex = 0; measureIndex < masterBars.length; measureIndex++) {
    const masterBar = masterBars[measureIndex];
    const path = `GPIF/MasterBars/MasterBar[${measureIndex}]`;
    const barRefs = parseGpifIdList(xmlChild(masterBar, 'Bars'), `${path}/Bars`, true);
    const barId = barRefs[descriptor.order];
    if (barId === undefined || barId === null) throw new Gp78AdapterError('invalidGpif', `${path}/Bars`, 'Master bar has no bar for the selected track order.');
    const bar = record(resolveGpifRef(String(barId), barMap, `${path}/Bars[${descriptor.order}]`, 'ref'), `GPIF/Bars/Bar[id=${barId}]`);
    const voiceRefs = parseGpifIdList(xmlChild(bar, 'Voices'), `GPIF/Bars/Bar[id=${barId}]/Voices`, true);
    if (voiceRefs.length !== 4) throw new Gp78AdapterError('invalidGpif', `GPIF/Bars/Bar[id=${barId}]/Voices`, 'A GPIF bar must contain four voice slots.');
    if (voiceRefs.slice(1).some(id => id !== null)) throw new Gp78AdapterError('unsupportedSemantics', `GPIF/Bars/Bar[id=${barId}]/Voices`, 'Selected track uses voice 2, 3, or 4; only voice 1 is supported.');
    const voiceId = voiceRefs[0];
    const beatRecords: ParsedBeat[] = [];
    if (voiceId !== null) {
      const voice = record(resolveGpifRef(String(voiceId), voiceMap, `GPIF/Bars/Bar[id=${barId}]/Voices[0]`, 'ref'), `GPIF/Voices/Voice[id=${voiceId}]`);
      const beatIds = parseGpifIdList(xmlChild(voice, 'Beats'), `GPIF/Voices/Voice[id=${voiceId}]/Beats`, true);
      for (let beatIndex = 0; beatIndex < beatIds.length; beatIndex++) {
        const beatId = beatIds[beatIndex];
        if (beatId === null) throw new Gp78AdapterError('invalidGpif', `GPIF/Voices/Voice[id=${voiceId}]/Beats[${beatIndex}]`, 'Null beat references are invalid.');
        const beat = record(resolveGpifRef(String(beatId), beatMap, `GPIF/Voices/Voice[id=${voiceId}]/Beats[${beatIndex}]`, 'ref'), `GPIF/Beats/Beat[id=${beatId}]`);
        beatRecords.push(readBeat(beat, beatId, noteMap, rhythmMap, chordMap, model, showTablature));
      }
    }
    parsedTabMarkersByMeasure.push(beatRecords.map(beat => beat.tabMarkers));
    parsedBeatsByMeasure.push(beatRecords);
    const timeSignature = parseTimeSignature(xmlChild(masterBar, 'Time'), `${path}/Time`);
    const key = keyName(xmlChild(masterBar, 'Key'), `${path}/Key`);
    const eventsBefore: InterchangeEvent[] = [];
    if (measureIndex > 0 && key !== previousKey) eventsBefore.push({ kind: 'keyChange', key });
    if (measureIndex > 0 && previousTime && (timeSignature.numerator !== previousTime.numerator || timeSignature.denominator !== previousTime.denominator)) {
      eventsBefore.push({ kind: 'timeSignatureChange', timeSignature });
    }
    const bpm = tempos.get(measureIndex);
    if (measureIndex > 0 && bpm !== undefined && bpm !== previousTempo) eventsBefore.push({ kind: 'tempoChange', bpm });
    if (bpm !== undefined) previousTempo = bpm;
    const nominalBeats = normalizedFraction(timeSignature.numerator * 4, timeSignature.denominator);
    let expectedBeats = nominalBeats;
    if (measureIndex === 0 && hasAnacrusis) {
      let pickupBeats = { n: 0, d: 1 };
      for (const beat of beatRecords) pickupBeats = addFractions(pickupBeats, beat.duration.beats, `${path}/Anacrusis`);
      if (pickupBeats.n <= 0 || compareFractions(pickupBeats, nominalBeats) >= 0) {
        throw new Gp78AdapterError('unsupportedSemantics', 'GPIF/MasterTrack/Anacrusis', 'Anacrusis must contain a non-empty first measure shorter than its written time signature.');
      }
      expectedBeats = pickupBeats;
    }
    let beatOffset = { n: 0, d: 1 };
    const chords: InterchangeChord[] = [];
    const measureHasTabNotes = beatRecords.some(beat => beat.hasTabNotes);
    const measureHasTabRests = showTablature !== false && beatRecords.some(beat => beat.hasTabRest);
    const melody = beatRecords.flatMap(beat => beat.melodyNotes);
    if (measureHasTabNotes && melody.length > 0) throw new Gp78AdapterError('unsupportedSemantics', `${path}/Beats`, 'A measure cannot mix TAB-positioned and standard-staff-only notes in GPIF v1.');
    for (const beat of beatRecords) {
      if (beat.chordId !== undefined) {
        const definition = chordMap.get(beat.chordId)!;
        const name = xmlAttr(definition, 'name');
        if (!name) throw new Gp78AdapterError('invalidGpif', `${path}/Beat/Chord`, 'Chord diagram name is missing.');
        chords.push({ name, beatOffset: { ...beatOffset } });
      }
      beatOffset = addFractions(beatOffset, beat.duration.beats, `${path}/Beats`);
    }
    const repeat = readRepeat(masterBar, path);
    const measure: InterchangeMeasure = {
      index: measureIndex,
      ...(measureIndex === 0 && hasAnacrusis ? { isPickup: true } : {}),
      expectedBeats,
      barline: {
        repeatStart: repeat.repeatStart,
        repeatEnd: repeat.repeatEnd,
        doubleEnd: false,
        finalEnd: false,
        ...(repeat.bracket ? { bracket: repeat.bracket } : {}),
        ...(repeat.specialMark ? { specialMark: repeat.specialMark } : {}),
      },
      eventsBefore,
      chords,
      chordPlacementMode: 'explicitDuration',
      rhythm: { origin: 'implicit', events: [] },
      ...(melody.length > 0 ? { melody } : {}),
      ...(measureHasTabNotes || measureHasTabRests
        ? { tabVoices: [{ voice: 1, beats: beatRecords.map(beat => beat.tabBeat) }] }
        : {}),
    };
    measures.push(measure);
    previousKey = key;
    previousTime = timeSignature;
  }

  resolveTabNoteLinks(measures, parsedTabMarkersByMeasure);
  resolveMelodyNoteLinks(parsedBeatsByMeasure);
  applyBeatLyrics(measures, parsedBeatsByMeasure, parsedTabMarkersByMeasure);
  if (parsedBeatsByMeasure.some(beats => beats.some(beat => beat.normalizedDoubleSharp))) {
    loss = appendLoss(loss, {
      category: 'droppedByPolicy',
      code: 'normalizedDoubleSharpSpelling',
      path: '/GPIF/Notes/*/Properties/ConcertPitch',
      detail: 'Double-sharp spelling was normalized enharmonically because GuitarDSL supports single accidentals; sounding pitch was preserved.',
      policyId: 'gp78.normalize-double-accidental.v1',
    });
  }

  const firstMasterBar = masterBars[0];
  const firstTime = parseTimeSignature(xmlChild(firstMasterBar, 'Time'), 'GPIF/MasterBars/MasterBar[0]/Time');
  const firstKey = keyName(xmlChild(firstMasterBar, 'Key'), 'GPIF/MasterBars/MasterBar[0]/Key');
  const melodyGroups: InterchangeMelodyGroup[] = [];
  let melodyStart: number | undefined;
  for (let index = 0; index <= measures.length; index++) {
    const hasMelody = index < measures.length && (measures[index].melody?.length ?? 0) > 0;
    if (hasMelody && melodyStart === undefined) melodyStart = index;
    if (!hasMelody && melodyStart !== undefined) {
      const verseCount = Math.max(0, ...measures.slice(melodyStart, index).flatMap(measure => measure.melody ?? []).map(note => note.syllables.length));
      melodyGroups.push({ startMeasure: melodyStart, endMeasureExclusive: index, verseCount });
      melodyStart = undefined;
    }
  }
  const score: InterchangeScore = {
    schemaVersion: 1,
    metadata: {
      title: xmlText(xmlChild(xmlChild(root, 'Score'), 'Title')),
      artist: xmlText(xmlChild(xmlChild(root, 'Score'), 'Artist')),
      memo: xmlText(xmlChild(xmlChild(root, 'Score'), 'Instructions')),
      key: firstKey,
      bpm: initialTempo,
      capo: descriptor.capo,
      tuning: descriptor.tuning,
      timeSignature: firstTime,
      feel: 'straight',
      ...(hasAnacrusis ? { pickup: measures[0].expectedBeats } : {}),
      showRhythm: true,
      measuresPerRow: 4,
      style: {},
      expandPageBreakRepeats: true,
    },
    chordDefinitions,
    melodyGroups,
    measures,
  };
  const validation = validateInterchangeScore(score);
  if (validation.length > 0) throw new Gp78AdapterError('invalidIr', validation[0].path, validation[0].detail);
  return { score, loss };
}

function resolveMelodyNoteLinks(parsedByMeasure: readonly (readonly ParsedBeat[])[]): void {
  interface Position {
    readonly beatId: number;
    readonly note?: InterchangeNote;
  }
  const positions: Position[] = [];
  for (const parsedBeats of parsedByMeasure) {
    if (parsedBeats.length === 0) positions.push({ beatId: -1 });
    for (const beat of parsedBeats) {
      if (beat.melodyNotes.length > 1) throw new Gp78AdapterError('invalidIr', `GPIF/Beats/Beat[id=${beat.beatId}]`, 'A beat produced more than one standard-staff event.');
      positions.push({ beatId: beat.beatId, ...(beat.melodyNotes[0] ? { note: beat.melodyNotes[0] } : {}) });
    }
  }
  const linkedDestinations = new Set<number>();
  const pitchKey = (note: InterchangeNote): string => (note.pitches ?? (note.pitch ? [note.pitch] : []))
    .map(pitch => `${pitch.step}:${pitch.alter}:${pitch.octave}`).sort().join('|');
  for (const [index, position] of positions.entries()) {
    const note = position.note;
    if (!note?.tieToNext) continue;
    const destination = positions[index + 1];
    if (!destination?.note || !destination.note.tiedFromPrev || pitchKey(note) !== pitchKey(destination.note)) {
      throw new Gp78AdapterError('unsupportedSemantics', `GPIF/Beats/Beat[id=${position.beatId}]/Notes`, 'A standard-staff tie origin must resolve to the next pitch group with matching pitches and a tie destination.');
    }
    linkedDestinations.add(index + 1);
  }
  for (const [index, position] of positions.entries()) {
    if (position.note?.tiedFromPrev && !linkedDestinations.has(index)) {
      throw new Gp78AdapterError('unsupportedSemantics', `GPIF/Beats/Beat[id=${position.beatId}]/Notes`, 'A standard-staff tie destination has no preceding matching origin.');
    }
  }
}

function resolveTabNoteLinks(measures: InterchangeMeasure[], markersByMeasure: readonly (readonly (readonly TabNoteMarkers[])[])[]): void {
  interface Position {
    readonly beatOrder: number;
    readonly measureIndex: number;
    readonly beatIndex: number;
    readonly noteIndex: number;
    readonly note: NonNullable<InterchangeTabBeat['notes']>[number];
    readonly markers: TabNoteMarkers;
  }
  const positions: Position[] = [];
  let beatOrder = 0;
  for (const [measureIndex, measure] of measures.entries()) {
    const voice = measure.tabVoices?.[0];
    if (!voice) continue;
    for (const [beatIndex, beat] of voice.beats.entries()) {
      const parsedMarkers = markersByMeasure[measureIndex]?.[beatIndex] ?? [];
      const beatPositions: Position[] = [];
      for (const [noteIndex, note] of beat.notes.entries()) {
        beatPositions.push({ beatOrder, measureIndex, beatIndex, noteIndex, note, markers: parsedMarkers[noteIndex] ?? { hopoOrigin: false, hopoDestination: false, tieOrigin: note.tieToNext, tieDestination: false } });
      }
      positions.push(...beatPositions);
      beatOrder++;
    }
  }
  const linkedHopoDestinations = new Set<Position>();
  const linkedTieDestinations = new Set<Position>();
  const effectAdditions = new Map<Position, string>();
  for (const source of positions) {
    const nextBeat = positions.filter(position => position.beatOrder > source.beatOrder && position.note.string === source.note.string);
    const target = nextBeat[0];
    if (source.markers.hopoOrigin) {
      if (!target || target.markers.hopoDestination !== true) {
        throw new Gp78AdapterError('unsupportedSemantics', `GPIF/Notes/${source.measureIndex}/${source.beatIndex}/${source.noteIndex}`, 'HopoOrigin must resolve to a matching HopoDestination on the next same-string note.');
      }
      if (source.note.fret === undefined || target.note.fret === undefined || source.note.fret === target.note.fret) {
        throw new Gp78AdapterError('unsupportedSemantics', `GPIF/Notes/${source.measureIndex}/${source.beatIndex}/${source.noteIndex}`, 'Hammer-on/pull-off destination must change the fret on the same string.');
      }
      effectAdditions.set(source, target.note.fret > source.note.fret ? 'hammer' : 'pull');
      linkedHopoDestinations.add(target);
    }
    if (source.markers.tieOrigin) {
      if (!target || target.markers.tieDestination !== true || target.note.fret !== source.note.fret) {
        throw new Gp78AdapterError('unsupportedSemantics', `GPIF/Notes/${source.measureIndex}/${source.beatIndex}/${source.noteIndex}`, 'Tie origin must resolve to a matching tie destination at the same string and fret.');
      }
      linkedTieDestinations.add(target);
    }
  }
  for (const position of positions) {
    if (position.markers.hopoDestination && !linkedHopoDestinations.has(position)) {
      throw new Gp78AdapterError('unsupportedSemantics', `GPIF/Notes/${position.measureIndex}/${position.beatIndex}/${position.noteIndex}`, 'HopoDestination has no preceding HopoOrigin.');
    }
    if (position.markers.tieDestination && !linkedTieDestinations.has(position)) {
      throw new Gp78AdapterError('unsupportedSemantics', `GPIF/Notes/${position.measureIndex}/${position.beatIndex}/${position.noteIndex}`, 'Tie destination has no matching preceding tie origin.');
    }
  }
  for (const [position, name] of effectAdditions) {
    const voice = measures[position.measureIndex].tabVoices![0];
    const beats = [...voice.beats];
    const beat = beats[position.beatIndex];
    const notes = [...beat.notes];
    notes[position.noteIndex] = { ...position.note, effects: [...position.note.effects, effect(name)] };
    beats[position.beatIndex] = { ...beat, notes };
    measures[position.measureIndex] = {
      ...measures[position.measureIndex],
      tabVoices: [{ ...voice, beats }],
    };
  }
}

function addFractions(a: InterchangeFraction, b: InterchangeFraction, path: string): InterchangeFraction {
  const n = a.n * b.d + b.n * a.d;
  const d = a.d * b.d;
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d)) throw new Gp78AdapterError('resourceLimit', path, 'Rhythm fraction exceeds the safe integer range.');
  const gcd = (left: number, right: number): number => right === 0 ? Math.abs(left) : gcd(right, left % right);
  const divisor = gcd(n, d) || 1;
  return { n: n / divisor, d: d / divisor };
}

function compareFractions(a: InterchangeFraction, b: InterchangeFraction): number {
  const left = BigInt(a.n) * BigInt(b.d);
  const right = BigInt(b.n) * BigInt(a.d);
  return left < right ? -1 : left > right ? 1 : 0;
}
