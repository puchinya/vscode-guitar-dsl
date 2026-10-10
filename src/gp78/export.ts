import { appendLoss, emptyLossReport, parseInterchangeTimeSignature, validateInterchangeScore } from '../interchange';
import type {
  InterchangeChordDefinition,
  InterchangeEvent,
  InterchangeFraction,
  InterchangeLyricSlot,
  InterchangeMeasure,
  InterchangeNoteValue,
  InterchangePitch,
  InterchangeScore,
  InterchangeTabBeat,
  InterchangeTabNote,
  InterchangeTimeSignature,
} from '../interchange';
import { createInstrumentModel } from '../instrumentModel';
import { resolveTabLinkTarget } from '../tab';
import { createGp7Archive } from './archive';
import { createGp7PartConfiguration } from './partConfiguration';
import { Gp78AdapterError, gp78Failure, gp78Success } from './model';
import type { Gp78Result } from './model';
import { importGp78 } from './import';

const ESCAPE_XML: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const NOTE_BASE_NAME: Readonly<Record<number, string>> = { 1: 'Whole', 2: 'Half', 4: 'Quarter', 8: 'Eighth', 16: 'Sixteenth' };
const MAJOR_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
const MAJOR_COUNTS = [0, 1, 2, 3, 4, 5, 6, 7, -1, -2, -3, -4, -5, -6, -7];
const MINOR_KEYS = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm'];

interface WriteBeat {
  readonly duration: InterchangeNoteValue;
  readonly notes: readonly WriteNote[];
  readonly isRest: boolean;
  readonly syllables?: readonly InterchangeLyricSlot[];
  readonly chordId?: number;
}

interface WriteNote {
  readonly tab?: InterchangeTabNote;
  readonly pitch?: InterchangePitch;
  readonly tieToNext?: boolean;
  readonly tiedFromPrev?: boolean;
}

function xml(value: string): string { return value.replace(/[&<>"']/g, character => ESCAPE_XML[character]); }
function cdata(value: string): string { return `<![CDATA[${value.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`; }

function fail(code: 'invalidIr' | 'unrepresentableValue' | 'roundTripMismatch' | 'resourceLimit', path: string, detail: string): Gp78Result<Uint8Array> {
  return gp78Failure(code, path, detail);
}

function error(code: 'unrepresentableValue', path: string, detail: string): never {
  throw new Gp78AdapterError(code, path, detail);
}

function fracEqual(a: InterchangeFraction, b: InterchangeFraction): boolean {
  return BigInt(a.n) * BigInt(b.d) === BigInt(b.n) * BigInt(a.d);
}

function add(a: InterchangeFraction, b: InterchangeFraction): InterchangeFraction {
  const n = a.n * b.d + b.n * a.d;
  const d = a.d * b.d;
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d)) error('unrepresentableValue', 'rhythm', 'Rhythm fraction exceeds the safe integer range.');
  const gcd = (x: number, y: number): number => y === 0 ? Math.abs(x) : gcd(y, x % y);
  const divisor = gcd(n, d) || 1;
  return { n: n / divisor, d: d / divisor };
}

interface RhythmDescriptor {
  readonly base: number;
  readonly tuplet?: { readonly actual: number; readonly normal: number };
}

function rhythmDescriptor(value: InterchangeNoteValue, path: string): RhythmDescriptor {
  if (value.parts.length !== 1 || value.parts[0].dotted) {
    error('unrepresentableValue', path, 'Only undotted single-part note values are supported by the current GP7 writer.');
  }
  const part = value.parts[0];
  const base = part.base;
  const tuplet = part.tuplet;
  if (NOTE_BASE_NAME[base] === undefined) {
    error('unrepresentableValue', path, 'Note value uses an unsupported GPIF rhythm base.');
  }
  const expected = tuplet
    ? { n: 4 * tuplet.normal, d: base * tuplet.actual }
    : { n: 4, d: base };
  if (tuplet && (!Number.isInteger(tuplet.actual) || !Number.isInteger(tuplet.normal) || tuplet.actual < 2 || tuplet.actual > 9 || tuplet.normal < 1 || tuplet.normal > 8 || tuplet.actual === tuplet.normal)) {
    error('unrepresentableValue', path, 'Tuplet ratio must use actual notes 2..9 and normal notes 1..8.');
  }
  if (!fracEqual(value.beats, expected)) {
    error('unrepresentableValue', path, 'Note value is not an exact supported GPIF rhythm.');
  }
  return { base, ...(tuplet ? { tuplet } : {}) };
}

function noteValueBase(value: InterchangeNoteValue, path: string): number {
  return rhythmDescriptor(value, path).base;
}

function noteValueFromFraction(value: InterchangeFraction, path: string): InterchangeNoteValue {
  const base = [1, 2, 4, 8, 16].find(candidate => fracEqual(value, { n: 4, d: candidate }));
  if (base === undefined) error('unrepresentableValue', path, 'Chord-only timing must use a whole through sixteenth-note boundary.');
  return { beats: { ...value }, parts: [{ base: base as InterchangeNoteValue['parts'][number]['base'], dotted: false }] };
}

function timeText(time: InterchangeTimeSignature, path: string): string {
  const text = `${time.numerator}/${time.denominator}`;
  const defaults = parseInterchangeTimeSignature(text);
  if (!defaults.ok || defaults.value.groups.length !== time.groups.length || defaults.value.groups.some((group, index) => group !== time.groups[index])) {
    error('unrepresentableValue', path, 'Non-default meter grouping is not represented by the GPIF time signature field.');
  }
  return text;
}

function keyFields(key: string, path: string): { count: number; mode: 'Major' | 'Minor' } {
  const major = MAJOR_KEYS.indexOf(key);
  if (major >= 0) return { count: MAJOR_COUNTS[major], mode: 'Major' };
  const minor = MINOR_KEYS.indexOf(key);
  if (minor >= 0) return { count: MINOR_COUNTS[minor], mode: 'Minor' };
  error('unrepresentableValue', path, `Key ${key} cannot be encoded as a GPIF key signature.`);
}

const MINOR_COUNTS = [0, 1, 2, 3, 4, 5, 6, 7, -1, -2, -3, -4, -5, -6, -7];

function getEvent(events: readonly InterchangeEvent[], kind: InterchangeEvent['kind']): InterchangeEvent[] {
  return events.filter(event => event.kind === kind);
}

function validateExportScore(score: InterchangeScore): void {
  const validation = validateInterchangeScore(score);
  if (validation.length > 0) throw new Gp78AdapterError('invalidIr', validation[0].path, validation[0].detail);
  if (score.arrangement && score.arrangement.length > 0) error('unrepresentableValue', '/arrangement', 'Arrangement execution order is not flattened or emitted by the GPIF writer.');
  if (score.metadata.pickup !== undefined && !score.measures[0]?.isPickup) throw new Gp78AdapterError('invalidIr', '/metadata/pickup', 'Pickup metadata requires the first measure to be marked as a pickup.');
  if (score.metadata.feel !== 'straight') error('unrepresentableValue', '/metadata/feel', 'Swing and shuffle playback semantics are not emitted.');
  const chordNames = new Set<string>();
  for (const [index, definition] of score.chordDefinitions.entries()) {
    const path = `/chordDefinitions/${index}`;
    if (chordNames.has(definition.name)) error('unrepresentableValue', path, 'Duplicate chord definition names cannot be resolved deterministically.');
    chordNames.add(definition.name);
    if (definition.label !== undefined && definition.label !== definition.name) error('unrepresentableValue', `${path}/label`, 'GPIF diagram names cannot preserve a separate chord label.');
    if ((definition.baseFret ?? 0) > 1 || definition.barres.length > 0) error('unrepresentableValue', path, 'Only first-position chord diagrams without explicit barre spans are supported.');
  }
  for (const [measureIndex, measure] of score.measures.entries()) {
    const path = `/measures/${measureIndex}`;
    if (measure.measureLyric) error('unrepresentableValue', `${path}/measureLyric`, 'Measure lyrics are not emitted.');
    if (measure.isPickup && (measureIndex !== 0 || score.metadata.pickup === undefined)) throw new Gp78AdapterError('invalidIr', `${path}/isPickup`, 'Only the first measure can be marked as a pickup, and it requires pickup metadata.');
    if (measure.barline.finalEnd) {
      error('unrepresentableValue', `${path}/barline/finalEnd`, 'Final barlines are not emitted by the GP writer.');
    }
    if (measure.barline.bracket !== undefined && !/^[1-8]\.$/.test(measure.barline.bracket)) {
      error('unrepresentableValue', `${path}/barline/bracket`, 'Only one numbered alternate ending from 1 through 8 is supported.');
    }
    if (measure.barline.specialMark !== undefined && !['segno', 'coda', 'fine', 'to_coda', 'dc', 'ds'].includes(measure.barline.specialMark)) {
      error('unrepresentableValue', `${path}/barline/specialMark`, 'Navigation mark is outside the GPIF writer mapping.');
    }
    if (measure.rhythm.events.length > 0 || measure.rhythm.origin !== 'implicit') error('unrepresentableValue', `${path}/rhythm`, 'Separate rhythm notation is not emitted by the guitar TAB writer.');
    if ((measure.melody?.length ?? 0) > 0 && (measure.tabVoices?.length ?? 0) > 0) {
      error('unrepresentableValue', `${path}/melody`, 'A single GPIF voice cannot encode both independent melody and TAB streams without an explicit alignment.');
    }
    for (const [noteIndex, note] of (measure.melody ?? []).entries()) {
      const notePath = `${path}/melody/${noteIndex}`;
      noteValueBase(note.duration, `${notePath}/duration`);
      if (note.techniques && Object.values(note.techniques).some(value => value !== false && value !== undefined)) {
        error('unrepresentableValue', `${notePath}/techniques`, 'Melody techniques and ties are not yet mapped to GPIF.');
      }
      if (!note.isRest && note.pitch === undefined && note.pitches === undefined) {
        error('unrepresentableValue', notePath, 'Melody note must contain a pitch or note group.');
      }
    }
    if (measure.tabVoices && measure.tabVoices.length > 1) error('unrepresentableValue', `${path}/tabVoices`, 'Only one TAB voice is supported.');
    if (measure.tabVoices?.some(voice => voice.voice !== 1)) error('unrepresentableValue', `${path}/tabVoices`, 'Only TAB voice 1 is supported.');
    if (getEvent(measure.eventsBefore, 'tempoMark').length > 0 || getEvent(measure.eventsBefore, 'feelChange').length > 0 ||
        getEvent(measure.eventsBefore, 'dynamic').length > 0 || getEvent(measure.eventsBefore, 'rehearsalMark').length > 0 ||
        getEvent(measure.eventsBefore, 'text').length > 0 || getEvent(measure.eventsBefore, 'ottavaChange').length > 0) {
      error('unrepresentableValue', `${path}/eventsBefore`, 'Only measure-start key, time, and numeric tempo changes are supported.');
    }
    for (const [chordIndex, chord] of measure.chords.entries()) {
      if (chord.label !== undefined && chord.label !== chord.name) error('unrepresentableValue', `${path}/chords/${chordIndex}/label`, 'GPIF chord references cannot preserve separate displayed labels.');
      if (!chordNames.has(chord.name)) error('unrepresentableValue', `${path}/chords/${chordIndex}`, `Chord ${chord.name} has no diagram definition.`);
    }
    for (const [voiceIndex, voice] of (measure.tabVoices ?? []).entries()) {
      for (const [beatIndex, beat] of voice.beats.entries()) {
        const beatPath = `${path}/tabVoices/${voiceIndex}/beats/${beatIndex}`;
        noteValueBase(beat.duration, `${beatPath}/duration`);
        if (beat.effects.length > 0) error('unrepresentableValue', `${beatPath}/effects`, 'Beat-scoped TAB effects have no verified GPIF mapping.');
        for (const [noteIndex, note] of beat.notes.entries()) {
          const notePath = `${beatPath}/notes/${noteIndex}`;
          if (note.dead || note.fret === undefined) error('unrepresentableValue', notePath, 'Dead notes and fretless TAB notes are not emitted.');
          validateTabNoteEffects(note, notePath);
        }
      }
    }
  }
}

function xmlKey(key: string, path: string): string {
  const fields = keyFields(key, path);
  return `<Key><AccidentalCount>${fields.count}</AccidentalCount><Mode>${fields.mode}</Mode><TransposeAs>${fields.count < 0 ? 'Flats' : 'Sharps'}</TransposeAs></Key>`;
}

function xmlEventTime(events: readonly InterchangeEvent[], fallback: InterchangeTimeSignature, path: string): string {
  const changes = getEvent(events, 'timeSignatureChange');
  if (changes.length > 1) error('unrepresentableValue', path, 'Multiple time signature changes at one measure boundary are invalid.');
  return timeText(changes[0]?.timeSignature ?? fallback, path);
}

function xmlEventKey(events: readonly InterchangeEvent[], fallback: string, path: string): string {
  const changes = getEvent(events, 'keyChange');
  if (changes.length > 1) error('unrepresentableValue', path, 'Multiple key changes at one measure boundary are invalid.');
  return xmlKey(changes[0]?.key ?? fallback, path);
}

function tempoAt(events: readonly InterchangeEvent[], fallback: number, path: string): number {
  const changes = getEvent(events, 'tempoChange');
  if (changes.length > 1) error('unrepresentableValue', path, 'Multiple tempo changes at one measure boundary are invalid.');
  return changes[0]?.bpm ?? fallback;
}

function validateTabNoteEffects(note: InterchangeTabNote, path: string): void {
  const supported = new Set(['hammer', 'pull', 'slide', 'bend', 'pm', 'let-ring']);
  for (const [index, effectCall] of note.effects.entries()) {
    const effectPath = `${path}/effects/${index}`;
    if (!supported.has(effectCall.name)) error('unrepresentableValue', effectPath, `TAB effect ${effectCall.name} has no verified GPIF mapping.`);
    const keys = Object.keys(effectCall.args);
    if (effectCall.name === 'bend') {
      const amount = effectCall.args.amount;
      if (keys.length !== 1 || typeof amount !== 'number' || amount < 0.5 || amount > 4 || !Number.isInteger(amount * 2)) {
        error('unrepresentableValue', effectPath, 'Bend amount must be one half-step value from 0.5 through 4.');
      }
    } else if (keys.length !== 0) {
      error('unrepresentableValue', effectPath, `${effectCall.name} does not accept GPIF effect arguments.`);
    }
  }
}

function chordDiagramItemXml(definition: InterchangeChordDefinition, id?: number): string {
  const frets = definition.frets.map((fret, string) => fret === 'x' ? '' : `<Fret string="${string}" fret="${fret}" />`).join('');
  const fingerName: Readonly<Record<string, string>> = { T: 'Thumb', '1': 'Index', '2': 'Middle', '3': 'Ring', '4': 'Pinky' };
  const positions = definition.frets.map((fret, string) => {
    const finger = definition.fingers?.[string];
    if (fret === 'x') return { group: 2, fret: Number.MAX_SAFE_INTEGER, string, xml: `<Position finger="None" fret="4294967295" string="${string}" />` };
    if (finger !== null && finger !== undefined) return { group: 1, fret, string, xml: `<Position finger="${fingerName[finger]}" fret="${fret}" string="${string}" />` };
    if (fret === 0) return { group: 0, fret, string, xml: `<Position finger="None" fret="0" string="${string}" />` };
    return undefined;
  }).filter((position): position is NonNullable<typeof position> => position !== undefined)
    .sort((a, b) => a.group - b.group || a.fret - b.fret || a.string - b.string)
    .map(position => position.xml).join('');
  const baseFret = definition.baseFret ?? 0;
  const idAttribute = id === undefined ? '' : ` id="${id}"`;
  return `<Item${idAttribute} name="${xml(definition.name)}"><Diagram stringCount="6" fretCount="5" baseFret="${baseFret}" barsStates="1 1 1 1 1">${frets}<Fingering>${positions}</Fingering><Property name="ShowName" type="bool" value="true"/><Property name="ShowDiagram" type="bool" value="true"/><Property name="ShowFingering" type="bool" value="false"/></Diagram>${chordHarmonyXml(definition.name)}</Item>`;
}

function chordDefinitionsXml(definitions: readonly InterchangeChordDefinition[]): string {
  const items = definitions.map((definition, id) => chordDiagramItemXml(definition, id)).join('');
  const workingSet = definitions.map(definition => chordDiagramItemXml(definition)).join('');
  return `<Property name="ChordCollection"><Items /></Property><Property name="DiagramCollection"><Items>${items}</Items></Property><Property name="DiagramWorkingSet"><Items>${workingSet}</Items></Property>`;
}

function chordHarmonyXml(name: string): string {
  const slashParts = name.split('/');
  if (slashParts.length > 2) error('unrepresentableValue', `/chordDefinitions/${name}`, 'Chord slash bass syntax is not supported by the GPIF writer.');
  const rootMatch = /^([A-G])([#b]?)(.*)$/.exec(slashParts[0]);
  const bassMatch = slashParts.length === 2 ? /^([A-G])([#b]?)$/.exec(slashParts[1]) : rootMatch;
  if (!rootMatch || !bassMatch) error('unrepresentableValue', `/chordDefinitions/${name}`, 'Chord name cannot be encoded as a GPIF harmonic definition.');
  const accidental = (value: string) => value === '#' ? 'Sharp' : value === 'b' ? 'Flat' : 'Natural';
  const root = `<KeyNote step="${rootMatch[1]}" accidental="${accidental(rootMatch[2])}"/>`;
  const bass = `<BassNote step="${bassMatch[1]}" accidental="${accidental(bassMatch[2])}"/>`;
  const quality = rootMatch[3];
  const degrees: string[] = [];
  if (quality === '' || quality === 'maj') {
    degrees.push('<Degree interval="Third" alteration="Major" omitted="false"/>', '<Degree interval="Fifth" alteration="Perfect" omitted="false"/>');
  } else if (quality === 'm' || quality === 'min') {
    degrees.push('<Degree interval="Third" alteration="Minor" omitted="false"/>', '<Degree interval="Fifth" alteration="Perfect" omitted="false"/>');
  } else if (quality === '5') {
    degrees.push('<Degree interval="Third" alteration="Major" omitted="true"/>', '<Degree interval="Fifth" alteration="Perfect" omitted="false"/>');
  } else if (quality === 'dim') {
    degrees.push('<Degree interval="Third" alteration="Minor" omitted="false"/>', '<Degree interval="Fifth" alteration="Diminished" omitted="false"/>');
  } else if (quality === 'aug') {
    degrees.push('<Degree interval="Third" alteration="Major" omitted="false"/>', '<Degree interval="Fifth" alteration="Augmented" omitted="false"/>');
  } else if (quality === 'sus2') {
    degrees.push('<Degree interval="Second" alteration="Major" omitted="false"/>', '<Degree interval="Third" alteration="Major" omitted="true"/>', '<Degree interval="Fifth" alteration="Perfect" omitted="false"/>');
  } else if (quality === 'sus4') {
    degrees.push('<Degree interval="Third" alteration="Major" omitted="true"/>', '<Degree interval="Fourth" alteration="Perfect" omitted="false"/>', '<Degree interval="Fifth" alteration="Perfect" omitted="false"/>');
  } else {
    error('unrepresentableValue', `/chordDefinitions/${name}`, `Chord quality ${quality || '(empty)'} has no verified GPIF mapping.`);
  }
  return `<Chord>${root}${bass}${degrees.join('')}</Chord>`;
}

function trackXml(score: InterchangeScore): string {
  const tuning = score.metadata.tuning.openMidi.join(' ');
  const properties = `<Property name="CapoFret"><Fret>${score.metadata.capo}</Fret></Property><Property name="FretCount"><Number>24</Number></Property><Property name="PartialCapoFret"><Fret>0</Fret></Property><Property name="PartialCapoStringFlags"><Bitset>000000</Bitset></Property><Property name="Tuning"><Pitches>${tuning}</Pitches><Instrument>Guitar</Instrument><Label /><LabelVisible>true</LabelVisible></Property>${chordDefinitionsXml(score.chordDefinitions)}`;
  return `<Track id="0"><Name>GuitarDSL Guitar</Name><ShortName>Guitar</ShortName><InstrumentSet><Name>Electric Guitar</Name><Type>electricGuitar</Type><LineCount>5</LineCount></InstrumentSet><Transpose><Chromatic>0</Chromatic><Octave>-1</Octave></Transpose><Staves><Staff id="0"><Properties>${properties}</Properties></Staff></Staves></Track>`;
}

function pitchPropertyXml(name: 'ConcertPitch' | 'TransposedPitch', midi: number, octaveOffset: number): string {
  const pitch = midi + octaveOffset;
  const noteNames = [
    ['C', ''], ['C', '#'], ['D', ''], ['D', '#'], ['E', ''], ['F', ''],
    ['F', '#'], ['G', ''], ['G', '#'], ['A', ''], ['A', '#'], ['B', ''],
  ] as const;
  const [step, accidental] = noteNames[pitch % 12];
  const octave = Math.floor(pitch / 12) - 1;
  return `<Property name="${name}"><Pitch><Step>${step}</Step><Accidental>${accidental}</Accidental><Octave>${octave}</Octave></Pitch></Property>`;
}

interface TabNoteDestination {
  readonly tie: boolean;
  readonly hopo: boolean;
}

function findTabNoteDestinations(score: InterchangeScore): ReadonlyMap<InterchangeTabNote, TabNoteDestination> {
  const positions = score.measures.flatMap((measure, measureIndex) => (measure.tabVoices?.[0]?.beats ?? []).map((beat, beatIndex) => ({ measureIndex, beatIndex, beat })));
  const beats: readonly InterchangeTabBeat[] = positions.map(position => position.beat);
  const destinations = new Map<InterchangeTabNote, TabNoteDestination>();
  const mark = (note: InterchangeTabNote, kind: keyof TabNoteDestination) => {
    const previous = destinations.get(note) ?? { tie: false, hopo: false };
    destinations.set(note, { ...previous, [kind]: true });
  };
  for (const [beatIndex, position] of positions.entries()) {
    for (const note of position.beat.notes) {
      if (note.tieToNext) {
        const resolved = resolveTabLinkTarget(beats, beatIndex, note, 'tie');
        if (resolved.status !== 'valid') error('unrepresentableValue', `/measures/${position.measureIndex}/tabVoices/0/beats/${position.beatIndex}/notes`, 'TAB tie does not resolve to the next matching same-string fret.');
        mark(resolved.note, 'tie');
      }
      if (note.effects.some(effectCall => effectCall.name === 'hammer' || effectCall.name === 'pull')) {
        const resolved = resolveTabLinkTarget(beats, beatIndex, note, 'connection');
        if (resolved.status !== 'valid') error('unrepresentableValue', `/measures/${position.measureIndex}/tabVoices/0/beats/${position.beatIndex}/notes`, 'Hammer-on/pull-off does not resolve to a later note on the same string.');
        mark(resolved.note, 'hopo');
      }
    }
  }
  return destinations;
}

function bendProperties(amount: number): string {
  const destination = amount * 50;
  return `<Property name="Bended"><Enable /></Property><Property name="BendDestinationOffset"><Float>25.000000</Float></Property><Property name="BendDestinationValue"><Float>${destination.toFixed(6)}</Float></Property><Property name="BendMiddleOffset1"><Float>12.000000</Float></Property><Property name="BendMiddleOffset2"><Float>12.000000</Float></Property><Property name="BendMiddleValue"><Float>${(destination / 2).toFixed(6)}</Float></Property><Property name="BendOriginOffset"><Float>0.000000</Float></Property><Property name="BendOriginValue"><Float>0.000000</Float></Property>`;
}

function tabNoteXml(
  note: InterchangeTabNote,
  model: ReturnType<typeof createInstrumentModel>,
  id: number,
  destination: TabNoteDestination = { tie: false, hopo: false },
): string {
  const fret = note.fret!;
  const string = note.string;
  let midi: number;
  try { midi = model.pitchAt(string, fret); }
  catch { error('unrepresentableValue', `/notes/${id}`, 'TAB note pitch exceeds the physical range of the selected tuning and capo.'); }
  const gpString = 6 - string;
  const names = new Set(note.effects.map(effectCall => effectCall.name));
  const connection = note.effects.find(effectCall => effectCall.name === 'hammer' || effectCall.name === 'pull');
  const bend = note.effects.find(effectCall => effectCall.name === 'bend');
  const tie = note.tieToNext || destination.tie
    ? `<Tie origin="${note.tieToNext}" destination="${destination.tie}" />`
    : '';
  const properties = `${pitchPropertyXml('ConcertPitch', midi!, 12)}<Property name="Fret"><Fret>${fret}</Fret></Property><Property name="Midi"><Number>${midi!}</Number></Property>${connection ? '<Property name="HopoOrigin"><Enable /></Property>' : ''}${destination.hopo ? '<Property name="HopoDestination"><Enable /></Property>' : ''}${names.has('slide') ? '<Property name="Slide"><Flags>2</Flags></Property>' : ''}${names.has('pm') ? '<Property name="PalmMuted"><Enable /></Property>' : ''}${bend ? bendProperties(bend.args.amount as number) : ''}<Property name="String"><String>${gpString}</String></Property>${pitchPropertyXml('TransposedPitch', midi!, 24)}`;
  return `<Note id="${id}">${tie}${names.has('let-ring') ? '<LetRing />' : ''}<InstrumentArticulation>0</InstrumentArticulation><Properties>${properties}</Properties></Note>`;
}

function staffPitchPropertyXml(name: 'ConcertPitch' | 'TransposedPitch', pitch: InterchangePitch, octaveOffset = 0): string {
  const accidental = pitch.alter < 0 ? 'b' : pitch.alter > 0 ? '#' : '';
  return `<Property name="${name}"><Pitch><Step>${pitch.step.toUpperCase()}</Step><Accidental>${accidental}</Accidental><Octave>${pitch.octave + octaveOffset}</Octave></Pitch></Property>`;
}

function melodyNoteXml(pitch: InterchangePitch, id: number, tieToNext = false, tiedFromPrev = false): string {
  const tie = tieToNext || tiedFromPrev ? `<Tie origin="${tieToNext}" destination="${tiedFromPrev}" />` : '';
  return `<Note id="${id}">${tie}<InstrumentArticulation>0</InstrumentArticulation><Properties>${staffPitchPropertyXml('ConcertPitch', pitch)}${staffPitchPropertyXml('TransposedPitch', pitch, 1)}</Properties></Note>`;
}

function durationXml(rhythm: RhythmDescriptor, id: number): string {
  const tuplet = rhythm.tuplet ? `<PrimaryTuplet num="${rhythm.tuplet.actual}" den="${rhythm.tuplet.normal}" />` : '';
  return `<Rhythm id="${id}"><NoteValue>${NOTE_BASE_NAME[rhythm.base]}</NoteValue>${tuplet}</Rhythm>`;
}

function lyricLinesXml(syllables: readonly InterchangeLyricSlot[] | undefined): string {
  if (!syllables?.length) return '';
  const lines = syllables.map(syllable => {
    const text = syllable === null || 'kind' in syllable ? '' : syllable.text;
    return `<Line>${xml(text)}</Line>`;
  }).join('');
  return `<Lyrics>${lines}</Lyrics>`;
}

function beatXml(id: number, rhythmId: number, noteIds: readonly number[], chordId?: number, isRest = false, syllables?: readonly InterchangeLyricSlot[]): string {
  const notes = noteIds.length > 0
    ? `<Notes>${noteIds.join(' ')}</Notes>`
    : chordId !== undefined && !isRest ? '' : '<Notes />';
  const rest = isRest && chordId === undefined ? '<Rest />' : '';
  const noteList = chordId !== undefined && isRest && noteIds.length === 0 ? '' : notes;
  return `<Beat id="${id}"><Dynamic>MF</Dynamic><Rhythm ref="${rhythmId}"/><TransposedPitchStemOrientation>Downward</TransposedPitchStemOrientation><ConcertPitchStemOrientation>Undefined</ConcertPitchStemOrientation>${chordId === undefined ? '' : `<Chord><![CDATA[${chordId}]]></Chord>`}${rest}${noteList}${lyricLinesXml(syllables)}<Properties><Property name="PrimaryPickupVolume"><Float>0.500000</Float></Property><Property name="PrimaryPickupTone"><Float>0.500000</Float></Property></Properties></Beat>`;
}

function fractionPositionForBeat(beat: InterchangeTabBeat): InterchangeFraction { return beat.duration.beats; }

function createWriteBeats(measure: InterchangeMeasure, chordIds: ReadonlyMap<string, number>, path: string): readonly WriteBeat[] {
  const voice = measure.tabVoices?.[0];
  if (voice) {
    const starts: InterchangeFraction[] = [];
    let position: InterchangeFraction = { n: 0, d: 1 };
    for (const beat of voice.beats) {
      starts.push(position);
      position = add(position, fractionPositionForBeat(beat));
    }
    const chordForBeat = new Map<number, number>();
    for (const chord of measure.chords) {
      const index = starts.findIndex(start => fracEqual(start, chord.beatOffset));
      if (index < 0) error('unrepresentableValue', `${path}/chords`, `Chord ${chord.name} does not start on a TAB beat boundary.`);
      if (chordForBeat.has(index)) error('unrepresentableValue', `${path}/chords`, 'More than one chord diagram is attached to a single TAB beat.');
      chordForBeat.set(index, chordIds.get(chord.name)!);
    }
    return voice.beats.map((beat, index) => ({ duration: beat.duration, notes: beat.notes.map(tab => ({ tab })), isRest: beat.isRest, syllables: beat.syllables, ...(chordForBeat.has(index) ? { chordId: chordForBeat.get(index)! } : {}) }));
  }

  if (measure.melody?.length) {
    const starts: InterchangeFraction[] = [];
    let position: InterchangeFraction = { n: 0, d: 1 };
    for (const note of measure.melody) {
      starts.push(position);
      position = add(position, note.duration.beats);
    }
    const chordForBeat = new Map<number, number>();
    for (const [chordIndex, chord] of measure.chords.entries()) {
      const index = starts.findIndex(start => fracEqual(start, chord.beatOffset));
      if (index < 0) error('unrepresentableValue', `${path}/chords/${chordIndex}`, 'Chord onset is not a melody beat boundary.');
      if (chordForBeat.has(index)) error('unrepresentableValue', `${path}/chords/${chordIndex}`, 'More than one chord diagram is attached to a single melody beat.');
      chordForBeat.set(index, chordIds.get(chord.name)!);
    }
    return measure.melody.map((note, index) => ({
      duration: note.duration,
      notes: note.isRest ? [] : (note.pitches ?? (note.pitch ? [note.pitch] : [])).map(pitch => ({ pitch, tieToNext: note.tieToNext, tiedFromPrev: note.tiedFromPrev })),
      isRest: note.isRest,
      syllables: note.syllables,
      ...(chordForBeat.has(index) ? { chordId: chordForBeat.get(index)! } : {})
    }));
  }

  if (measure.chords.length === 0) return [];
  const ordered = [...measure.chords].sort((a, b) => compare(a.beatOffset, b.beatOffset));
  if (ordered[0].beatOffset.n !== 0) error('unrepresentableValue', `${path}/chords`, 'Chord-only measures must begin at the first beat to preserve silent lead-in timing.');
  return ordered.map((chord, index) => {
    const next = ordered[index + 1]?.beatOffset ?? measure.expectedBeats;
    const duration = subtract(next, chord.beatOffset, `${path}/chords/${index}`);
    return { duration: noteValueFromFraction(duration, `${path}/chords/${index}/duration`), notes: [], isRest: false, chordId: chordIds.get(chord.name)! };
  });
}

function compare(a: InterchangeFraction, b: InterchangeFraction): number {
  const left = BigInt(a.n) * BigInt(b.d);
  const right = BigInt(b.n) * BigInt(a.d);
  return left < right ? -1 : left > right ? 1 : 0;
}

function subtract(a: InterchangeFraction, b: InterchangeFraction, path: string): InterchangeFraction {
  const n = a.n * b.d - b.n * a.d;
  const d = a.d * b.d;
  if (n <= 0 || !Number.isSafeInteger(n) || !Number.isSafeInteger(d)) error('unrepresentableValue', path, 'Chord boundaries do not form a positive supported duration.');
  const gcd = (x: number, y: number): number => y === 0 ? Math.abs(x) : gcd(y, x % y);
  const divisor = gcd(n, d) || 1;
  return { n: n / divisor, d: d / divisor };
}

function buildGpif(score: InterchangeScore): Uint8Array {
  const chordIds = new Map(score.chordDefinitions.map((definition, index) => [definition.name, index]));
  const instrument = createInstrumentModel({ openMidi: score.metadata.tuning.openMidi }, score.metadata.capo);
  const noteXml: string[] = [];
  const beatXmls: string[] = [];
  const rhythmXmls: string[] = [];
  const voiceXmls: string[] = [];
  const barXmls: string[] = [];
  const masterBarXmls: string[] = [];
  const tempoRows: string[] = [];
  const rhythmIdByValue = new Map<string, number>();
  const writeBeatsByMeasure = score.measures.map((measure, measureIndex) => createWriteBeats(measure, chordIds, `/measures/${measureIndex}`));
  const tabNoteDestinations = findTabNoteDestinations(score);
  let nextNoteId = 0;
  let nextBeatId = 0;
  let nextVoiceId = 0;
  let currentTempo = score.metadata.bpm;
  let previousKey = score.metadata.key;
  let previousTime = score.metadata.timeSignature;

  for (const [measureIndex, measure] of score.measures.entries()) {
    const path = `/measures/${measureIndex}`;
    const key = getEvent(measure.eventsBefore, 'keyChange')[0]?.key ?? (measureIndex === 0 ? score.metadata.key : previousKey);
    const time = getEvent(measure.eventsBefore, 'timeSignatureChange')[0]?.timeSignature ?? (measureIndex === 0 ? score.metadata.timeSignature : previousTime);
    const tempo = tempoAt(measure.eventsBefore, currentTempo, `${path}/eventsBefore`);
    if (measureIndex === 0 || tempo !== currentTempo) tempoRows.push(`<Automation><Type>Tempo</Type><Linear>false</Linear><Bar>${measureIndex}</Bar><Position>0</Position><Visible>true</Visible><Value>${tempo} 2</Value></Automation>`);
    currentTempo = tempo;
    previousKey = key;
    previousTime = time;
    const barId = measureIndex;
    const writeBeats = writeBeatsByMeasure[measureIndex];
    const beatIds: number[] = [];
    for (const [beatIndex, beat] of writeBeats.entries()) {
      const rhythmValue = rhythmDescriptor(beat.duration, `${path}/beats/${beatIndex}/duration`);
      const rhythmKey = `${rhythmValue.base}:${rhythmValue.tuplet?.actual ?? 0}:${rhythmValue.tuplet?.normal ?? 0}`;
      let rhythmId = rhythmIdByValue.get(rhythmKey);
      if (rhythmId === undefined) {
        rhythmId = rhythmIdByValue.size;
        rhythmIdByValue.set(rhythmKey, rhythmId);
        rhythmXmls.push(durationXml(rhythmValue, rhythmId));
      }
      const noteIds = beat.notes.map((note, noteIndex) => {
        const id = nextNoteId++;
        if (note.tab) noteXml.push(tabNoteXml(note.tab, instrument, id, tabNoteDestinations.get(note.tab)));
        else if (note.pitch) noteXml.push(melodyNoteXml(note.pitch, id, note.tieToNext, note.tiedFromPrev));
        else error('unrepresentableValue', `${path}/beats/${beatIndex}/notes/${noteIndex}`, 'Writer note has no TAB position or standard-staff pitch.');
        return id;
      });
      const id = nextBeatId++;
      beatIds.push(id);
      beatXmls.push(beatXml(id, rhythmId, noteIds, beat.chordId, beat.isRest, beat.syllables));
    }
    if (beatIds.length > 0) {
      const voiceId = nextVoiceId++;
      voiceXmls.push(`<Voice id="${voiceId}"><Beats>${beatIds.join(' ')}</Beats></Voice>`);
      barXmls.push(`<Bar id="${barId}"><Clef>G2</Clef><Voices>${voiceId} -1 -1 -1</Voices></Bar>`);
    } else {
      barXmls.push(`<Bar id="${barId}"><Clef>G2</Clef><Voices>-1 -1 -1 -1</Voices></Bar>`);
    }
    const repeat = measure.barline.repeatStart || measure.barline.repeatEnd
      ? `<Repeat start="${measure.barline.repeatStart}" end="${measure.barline.repeatEnd}" count="2"/>`
      : '';
    const alternateEnding = measure.barline.bracket
      ? `<AlternateEndings>${measure.barline.bracket.slice(0, -1)}</AlternateEndings>`
      : '';
    const section = measure.sectionStart === undefined
      ? ''
      : `<Section><Letter><![CDATA[]]></Letter><Text>${cdata(measure.sectionStart)}</Text></Section>`;
    const doubleBar = measure.barline.doubleEnd ? '<DoubleBar />' : '';
    const targetMap = { segno: 'Segno', coda: 'Coda', fine: 'Fine' } as const;
    const jumpMap = { to_coda: 'DaCoda', dc: 'DaCapo', ds: 'DaSegno' } as const;
    const mark = measure.barline.specialMark;
    const directions = mark
      ? mark in targetMap
        ? `<Directions><Target>${targetMap[mark as keyof typeof targetMap]}</Target></Directions>`
        : `<Directions><Jump>${jumpMap[mark as keyof typeof jumpMap]}</Jump></Directions>`
      : '';
    masterBarXmls.push(`<MasterBar>${xmlKey(key, `${path}/key`)}<Time>${timeText(time, `${path}/timeSignature`)}</Time>${repeat}${alternateEnding}${section}${doubleBar}${directions}<Bars>${barId}</Bars></MasterBar>`);
  }

  const rhythms = rhythmXmls.join('');
  const scoreTitle = xml(score.metadata.title);
  const scoreArtist = xml(score.metadata.artist);
  const scoreMemo = xml(score.metadata.memo);
  const anacrusis = score.metadata.pickup === undefined ? '' : '<Anacrusis />';
  const gpif = `<GPIF><GPVersion>7.0</GPVersion><Score><Title>${scoreTitle}</Title><Artist>${scoreArtist}</Artist><Instructions>${scoreMemo}</Instructions><MultiVoice>0</MultiVoice></Score><MasterTrack><Tracks>0</Tracks>${anacrusis}<Automations>${tempoRows.join('')}</Automations></MasterTrack><Tracks>${trackXml(score)}</Tracks><MasterBars>${masterBarXmls.join('')}</MasterBars><Bars>${barXmls.join('')}</Bars><Voices>${voiceXmls.join('')}</Voices><Beats>${beatXmls.join('')}</Beats><Notes>${noteXml.join('')}</Notes><Rhythms>${rhythms}</Rhythms><ScoreViews /></GPIF>`;
  return new TextEncoder().encode(gpif);
}

function semanticProjection(score: InterchangeScore): unknown {
  const duration = (value: InterchangeNoteValue) => ({ beats: value.beats, parts: value.parts });
  const events = (values: readonly InterchangeEvent[]) => values.map(event => {
    if (event.kind === 'keyChange') return { kind: event.kind, key: event.key };
    if (event.kind === 'timeSignatureChange') return { kind: event.kind, timeSignature: event.timeSignature };
    if (event.kind === 'tempoChange') return { kind: event.kind, bpm: event.bpm };
    return { kind: event.kind };
  });
  return {
    metadata: {
      title: score.metadata.title, artist: score.metadata.artist, memo: score.metadata.memo, key: score.metadata.key,
      bpm: score.metadata.bpm, capo: score.metadata.capo, tuning: score.metadata.tuning, timeSignature: score.metadata.timeSignature,
      pickup: score.metadata.pickup,
    },
    chordDefinitions: score.chordDefinitions.map(definition => ({ name: definition.name, frets: definition.frets, baseFret: definition.baseFret, fingers: definition.fingers ?? Array(6).fill(null), barres: definition.barres })),
    melodyGroups: score.melodyGroups,
    measures: score.measures.map(measure => ({
      sectionStart: measure.sectionStart,
      expectedBeats: measure.expectedBeats,
      isPickup: measure.isPickup ?? false,
      barline: {
        repeatStart: measure.barline.repeatStart,
        repeatEnd: measure.barline.repeatEnd,
        doubleEnd: measure.barline.doubleEnd,
        finalEnd: measure.barline.finalEnd,
        bracket: measure.barline.bracket,
        specialMark: measure.barline.specialMark,
      },
      eventsBefore: events(measure.eventsBefore),
      chords: measure.chords.map(chord => ({ name: chord.name, beatOffset: chord.beatOffset })),
      melody: (measure.melody ?? []).map(note => ({
        isRest: note.isRest,
        pitch: note.pitch,
        pitches: note.pitches,
        duration: duration(note.duration),
        techniques: note.techniques,
        tieToNext: note.tieToNext,
        tiedFromPrev: note.tiedFromPrev,
        syllables: note.syllables,
      })),
      tabVoices: (measure.tabVoices ?? []).map(voice => ({ voice: voice.voice, beats: voice.beats.map(beat => ({
        isRest: beat.isRest, duration: duration(beat.duration), effects: beat.effects, syllables: beat.syllables,
        notes: beat.notes.map(note => ({ string: note.string, fret: note.fret, dead: note.dead, tieToNext: note.tieToNext, effects: note.effects })),
      })) })),
    })),
  };
}

function semanticDifferencePath(left: unknown, right: unknown, path = ''): string | undefined {
  if (Object.is(left, right)) return undefined;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return path || '/';
    if (left.length !== right.length) return `${path}/length`;
    for (let index = 0; index < left.length; index++) {
      const difference = semanticDifferencePath(left[index], right[index], `${path}/${index}`);
      if (difference) return difference;
    }
    return undefined;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter(key => a[key] !== undefined || b[key] !== undefined)
      .sort();
    for (const key of keys) {
      if (!(key in a) || !(key in b)) return `${path}/${key}`;
      const difference = semanticDifferencePath(a[key], b[key], `${path}/${key}`);
      if (difference) return difference;
    }
    return undefined;
  }
  return path || '/';
}

/** @internal Shared by the mandatory writer gate and focused equality regressions. */
export function gp78RoundTripMismatch(expected: InterchangeScore, actual: InterchangeScore): string | undefined {
  return semanticDifferencePath(semanticProjection(expected), semanticProjection(actual));
}

export function exportGp78(score: InterchangeScore): Gp78Result<Uint8Array> {
  try {
    validateExportScore(score);
    const gpif = buildGpif(score);
    const hasTablature = score.measures.some(measure => measure.tabVoices !== undefined);
    const archive = createGp7Archive(gpif, createGp7PartConfiguration(hasTablature));
    const inspected = importGp78(archive, 0);
    if (!inspected.ok) return gp78Failure('roundTripMismatch', inspected.errors[0]?.path ?? 'GPIF', inspected.errors[0]?.detail ?? 'Generated GPIF could not be read back.');
    const mismatch = gp78RoundTripMismatch(score, inspected.value);
    if (mismatch !== undefined) {
      return gp78Failure('roundTripMismatch', `GPIF${mismatch}`, 'Generated GPIF did not preserve the input interchange semantics.');
    }
    let loss = appendLoss(emptyLossReport(), {
      category: 'droppedByPolicy', code: 'omittedRseSettings', path: '/InterchangeScore/metadata',
      detail: 'InterchangeScore v1 does not contain Guitar Pro instrument sound or effect-chain settings.', policyId: 'gp78.omit-rse-settings.v1',
    });
    loss = appendLoss(loss, {
      category: 'droppedByPolicy', code: 'omittedDisplayLayout', path: '/InterchangeScore/metadata/style',
      detail: 'Page layout and view-only settings are not emitted in the GP7 file.', policyId: 'gp78.omit-display-layout.v1',
    });
    return gp78Success(archive, loss);
  } catch (errorValue) {
    if (errorValue instanceof Gp78AdapterError) return gp78Failure(errorValue.gpCode, errorValue.path, errorValue.message);
    return fail('unrepresentableValue', 'GPIF', errorValue instanceof Error ? errorValue.message : 'GPIF output could not be generated.');
  }
}
