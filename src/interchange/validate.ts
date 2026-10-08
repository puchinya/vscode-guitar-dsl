import { formatNoteValuePart, frac, feq, parseNoteValueDetailed, parseRhythmDurationDetailed } from '../duration';
import { CHORD_LABEL_PATTERN, CHORD_NAME_PATTERN, formatChordDefinition } from '../chordDefinition';
import { createInstrumentModel, MAX_CAPO, MAX_FRET, parseTuningValue } from '../instrumentModel';
import { parseKeySignature, parseTimeSignature, parseFeel, parseDirective, measureBeats } from '../scoreEvents';
import { lowerArrangement } from '../arrangement';
import { resolvePlayOrder } from '../playOrder';
import { parseTechniqueBlock, type NoteTechniques } from '../melody';
import { parseTabCell, resolveTabLinkTarget } from '../tab';
import { sectionLyricVerseCapacity } from './lyricGroups';
import type {
  InterchangeError,
  InterchangeFraction,
  InterchangeMeasure,
  InterchangeLyricSlot,
  InterchangeNoteTechniques,
  InterchangeNoteValue,
  InterchangeScore,
  InterchangeTabEffectCall,
  InterchangeTabNote,
  InterchangeTimeSignature
} from './model';

const CONNECTIONS = ['hammer', 'pull', 'slide', 'gliss'] as const;
const CHORD_NAME_RE = new RegExp(`^${CHORD_NAME_PATTERN}$`);
const CHORD_LABEL_RE = new RegExp(`^${CHORD_LABEL_PATTERN}$`);
const TECHNIQUES: readonly (keyof InterchangeNoteTechniques)[] = [
  'connection', 'bend', 'vibrato', 'staccato', 'tenuto', 'fermata', 'breath', 'grace',
  'slurStart', 'slurEnd', 'palmMute', 'letRing'
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}

function isNormalizedFraction(value: unknown): value is InterchangeFraction {
  return isRecord(value) && Number.isSafeInteger(value.n) && Number.isSafeInteger(value.d) && (value.d as number) > 0 && (value.n as number) >= 0 && gcd(value.n as number, value.d as number) === 1;
}

function compareFractionsExact(a: InterchangeFraction, b: InterchangeFraction): number {
  const left = BigInt(a.n) * BigInt(b.d);
  const right = BigInt(b.n) * BigInt(a.d);
  return left < right ? -1 : left > right ? 1 : 0;
}

function addFractionsExact(a: InterchangeFraction, b: InterchangeFraction): InterchangeFraction | null {
  let numerator = BigInt(a.n) * BigInt(b.d) + BigInt(b.n) * BigInt(a.d);
  let denominator = BigInt(a.d) * BigInt(b.d);
  const gcdBigInt = (x: bigint, y: bigint): bigint => {
    while (y !== 0n) [x, y] = [y, x % y];
    return x || 1n;
  };
  const divisor = gcdBigInt(numerator, denominator);
  numerator /= divisor;
  denominator /= divisor;
  if (numerator > BigInt(Number.MAX_SAFE_INTEGER) || denominator > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { n: Number(numerator), d: Number(denominator) };
}

function add(errors: InterchangeError[], code: string, path: string, detail: string): void {
  errors.push({ code, path, detail });
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: readonly string[], path: string, errors: InterchangeError[]): boolean {
  let valid = true;
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    const pointerKey = key.replace(/~/g, '~0').replace(/\//g, '~1');
    add(errors, 'unknownField', `${path}/${pointerKey}`, 'Field is not part of interchange schema version 1.');
    valid = false;
  }
  return valid;
}

function validFraction(value: unknown, path: string, errors: InterchangeError[], positive = false): value is InterchangeFraction {
  if (!isRecord(value)) {
    add(errors, 'invalidFraction', path, 'Expected a normalized rational with safe integer numerator and positive denominator.');
    return false;
  }
  if (!rejectUnknownFields(value, ['n', 'd'], path, errors) || !Number.isSafeInteger(value.n) || !Number.isSafeInteger(value.d) || (value.d as number) <= 0 ||
      (positive ? (value.n as number) <= 0 : (value.n as number) < 0)) {
    if (!errors.some(error => error.code === 'unknownField' && error.path.startsWith(`${path}/`))) add(errors, 'invalidFraction', path, 'Expected a normalized rational with safe integer numerator and positive denominator.');
    return false;
  }
  if (gcd(value.n as number, value.d as number) !== 1) {
    add(errors, 'nonCanonicalFraction', path, 'Fraction numerator and denominator must be reduced.');
    return false;
  }
  return true;
}

function copyPart(part: unknown, path: string, errors: InterchangeError[]): string | null {
  if (!isRecord(part) || !rejectUnknownFields(part, ['base', 'dotted', 'tuplet'], path, errors) || ![1, 2, 4, 8, 16].includes(part.base as number) || typeof part.dotted !== 'boolean') return null;
  const tuplet = part.tuplet;
  if (tuplet !== undefined && (!isRecord(tuplet) || !rejectUnknownFields(tuplet, ['actual', 'normal'], `${path}/tuplet`, errors) || !Number.isInteger(tuplet.actual) || !Number.isInteger(tuplet.normal))) return null;
  const normalized = {
    base: part.base as 1 | 2 | 4 | 8 | 16,
    dotted: part.dotted,
    ...(tuplet === undefined ? {} : { tuplet: { actual: (tuplet as { actual: number }).actual, normal: (tuplet as { normal: number }).normal } })
  };
  const value = parseNoteValueDetailed(formatNoteValuePart(normalized));
  return typeof value === 'string' ? null : formatNoteValuePart(normalized);
}

function validNoteValue(value: unknown, path: string, errors: InterchangeError[], allowZero = false): value is InterchangeNoteValue {
  if (!isRecord(value) || !rejectUnknownFields(value, ['beats', 'parts'], path, errors) || !Array.isArray(value.parts) || value.parts.length === 0) {
    add(errors, 'invalidDuration', path, 'A note value requires one or more typed duration parts.');
    return false;
  }
  let rendered = '';
  for (let index = 0; index < value.parts.length; index++) {
    const part = copyPart(value.parts[index], `${path}/parts/${index}`, errors);
    if (part === null) {
      add(errors, 'invalidDurationPart', `${path}/parts/${index}`, 'Duration part is outside the shared note-value grammar.');
      return false;
    }
    rendered += `${index ? '+' : ''}${part}`;
  }
  const parsed = parseNoteValueDetailed(rendered);
  if (typeof parsed === 'string' || !validFraction(value.beats, `${path}/beats`, errors, !allowZero) ||
      (!allowZero && typeof parsed !== 'string' && !feq(parsed.beats, frac(value.beats.n as number, value.beats.d as number))) ||
      (allowZero && value.beats.n === 0 && !isRecord(value.beats))) {
    if (!allowZero && typeof parsed !== 'string' && isRecord(value.beats) && Number.isSafeInteger(value.beats.n) && Number.isSafeInteger(value.beats.d) && value.beats.d !== 0 && !feq(parsed.beats, frac(value.beats.n as number, value.beats.d as number))) {
      add(errors, 'durationMismatch', `${path}/beats`, 'Beat fraction does not equal the duration parts.');
    } else if (typeof parsed === 'string') add(errors, 'invalidDuration', path, 'Duration parts are invalid.');
    return false;
  }
  if (allowZero && value.beats.n === 0) return true;
  if (allowZero && typeof parsed !== 'string' && !feq(parsed.beats, frac(value.beats.n as number, value.beats.d as number))) {
    add(errors, 'durationMismatch', `${path}/beats`, 'Beat fraction does not equal the duration parts.');
    return false;
  }
  return true;
}

function validPitch(value: unknown, path: string, errors: InterchangeError[]): boolean {
  if (!isRecord(value) || !rejectUnknownFields(value, ['step', 'alter', 'octave'], path, errors) || !['a', 'b', 'c', 'd', 'e', 'f', 'g'].includes(String(value.step)) ||
      ![-1, 0, 1].includes(value.alter as number) || !Number.isInteger(value.octave) || (value.octave as number) < 0 || (value.octave as number) > 9) {
    add(errors, 'invalidPitch', path, 'Pitch must have a supported step, single accidental, and octave 0 through 9.');
    return false;
  }
  return true;
}

function validSyllables(value: unknown, path: string, errors: InterchangeError[]): value is readonly InterchangeLyricSlot[] {
  if (!Array.isArray(value)) {
    add(errors, 'invalidLyrics', path, 'Syllables must be an array by verse.');
    return false;
  }
  for (let index = 0; index < value.length; index++) {
    const slotPath = `${path}/${index}`;
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      add(errors, 'sparseLyricSlots', slotPath, 'Lyric slot arrays must be dense and use the omitted sentinel for an absent token.');
      continue;
    }
    const syllable = value[index];
    if (syllable === undefined) {
      add(errors, 'invalidLyricSlot', slotPath, 'Undefined is not a JSON-safe lyric slot value.');
      continue;
    }
    if (syllable === null) continue;
    if (isRecord(syllable) && syllable.kind === 'omitted') {
      rejectUnknownFields(syllable, ['kind'], slotPath, errors);
      if (Object.keys(syllable).length !== 1 || syllable.kind !== 'omitted') add(errors, 'invalidLyricSlot', slotPath, 'Omitted lyric slots must contain exactly { kind: omitted }.');
      continue;
    }
    if (!isRecord(syllable) || !Object.prototype.hasOwnProperty.call(syllable, 'text')) {
      add(errors, 'invalidLyricSlot', slotPath, 'Lyric slot must be a syllable, an explicit null skip, or the exact omitted sentinel.');
      continue;
    }
    if (!rejectUnknownFields(syllable, ['text', 'hyphenToNext', 'extend'], slotPath, errors) || typeof syllable.text !== 'string' || typeof syllable.hyphenToNext !== 'boolean' || typeof syllable.extend !== 'boolean' ||
        (syllable.extend && (syllable.text !== '' || syllable.hyphenToNext))) {
      add(errors, 'invalidSyllable', slotPath, 'Syllable must preserve text, hyphen, and melisma semantics.');
    }
  }
  return true;
}

function techniqueText(technique: InterchangeNoteTechniques): string | null {
  if (!isRecord(technique)) return null;
  const keys = Object.keys(technique);
  if (keys.some(key => !TECHNIQUES.includes(key as keyof InterchangeNoteTechniques))) return null;
  const names: string[] = [];
  if (technique.connection !== undefined) {
    if (!(CONNECTIONS as readonly string[]).includes(String(technique.connection))) return null;
    names.push(String(technique.connection));
  }
  if (technique.bend !== undefined) names.push(`bend:${technique.bend}`);
  const flags: Array<[keyof InterchangeNoteTechniques, string]> = [
    ['vibrato', 'vibrato'], ['staccato', 'staccato'], ['tenuto', 'tenuto'], ['fermata', 'fermata'],
    ['breath', 'breath'], ['grace', 'grace'], ['slurStart', 'slur-start'], ['slurEnd', 'slur-end'],
    ['palmMute', 'pm'], ['letRing', 'let-ring']
  ];
  for (const [key, name] of flags) {
    const value = technique[key];
    if (value !== undefined && typeof value !== 'boolean') return null;
    if (value === true) names.push(name);
  }
  return names.join(',');
}

function validTechniques(value: unknown, path: string, errors: InterchangeError[]): value is InterchangeNoteTechniques {
  if (value === undefined) return true;
  if (!isRecord(value)) {
    add(errors, 'invalidTechniqueSchema', path, 'Technique data must be a typed object.');
    return false;
  }
  const text = techniqueText(value as InterchangeNoteTechniques);
  const parsed = text === null || !text ? 'invalidTechnique' : parseTechniqueBlock(text);
  if (parsed === 'invalidTechnique') {
    add(errors, 'invalidTechniqueSchema', path, 'Technique combination is not accepted by the shared GuitarDSL technique grammar.');
    return false;
  }
  return true;
}

function effectValue(value: unknown, path: string, errors: InterchangeError[]): string | null {
  if (typeof value === 'string') {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(value)) return JSON.stringify(value);
    return value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (Array.isArray(value)) {
    const parts = value.map((item, index) => effectValue(item, `${path}/${index}`, errors));
    return parts.some(part => part === null) ? null : `[${parts.join(',')}]`;
  }
  if (isRecord(value) && rejectUnknownFields(value, ['n', 'd'], path, errors) && Number.isSafeInteger(value.n) && Number.isSafeInteger(value.d) && (value.d as number) > 0 && gcd(value.n as number, value.d as number) === 1) return `${value.n}/${value.d}`;
  return null;
}

function effectCallsText(effects: unknown, path: string, errors: InterchangeError[]): string | null {
  if (!Array.isArray(effects)) {
    add(errors, 'invalidEffectSchema', path, 'Effects must be an array.');
    return null;
  }
  const calls: string[] = [];
  for (let index = 0; index < effects.length; index++) {
    const call = effects[index] as InterchangeTabEffectCall;
    if (!isRecord(call) || typeof call.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(call.name) || !isRecord(call.args)) {
      add(errors, 'invalidEffectSchema', `${path}/${index}`, 'Effect call must have a name and typed argument object.');
      return null;
    }
    if (!rejectUnknownFields(call, ['name', 'args'], `${path}/${index}`, errors)) return null;
    const args: string[] = [];
    for (const [key, value] of Object.entries(call.args)) {
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
        add(errors, 'invalidEffectSchema', `${path}/${index}/args/${key}`, 'Effect argument name is invalid.');
        return null;
      }
      const printed = effectValue(value, `${path}/${index}/args/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, errors);
      if (printed === null) {
        add(errors, 'invalidEffectSchema', `${path}/${index}/args/${key}`, 'Effect argument value is not part of the shared typed effect grammar.');
        return null;
      }
      args.push(`${key}=${printed}`);
    }
    calls.push(args.length ? `${call.name}(${args.join(',')})` : call.name);
  }
  return calls.join(',');
}

function validateEffects(effects: unknown, path: string, scope: 'beat' | 'note', errors: InterchangeError[]): void {
  const text = effectCallsText(effects, path, errors);
  if (text === null) return;
  if (!text) return;
  const token = scope === 'beat' ? `r/4!{${text}}` : `1f0{${text}}/4`;
  const parsed = parseTabCell({ text: token, startCol: 0, endCol: token.length });
  if (parsed.issues.length) add(errors, 'invalidEffectSchema', path, 'Effect name, arguments, or scope are not accepted by the shared TAB parser.');
}

function validateTimeSignature(value: unknown, path: string, errors: InterchangeError[]): value is InterchangeTimeSignature {
  if (!isRecord(value) || !rejectUnknownFields(value, ['numerator', 'denominator', 'groups'], path, errors) || !Number.isInteger(value.numerator) || !Number.isInteger(value.denominator) || !Array.isArray(value.groups) ||
      value.groups.some(group => !Number.isInteger(group))) {
    add(errors, 'invalidTimeSignature', path, 'Time signature has an invalid shape.');
    return false;
  }
  const text = `${value.numerator}/${value.denominator}(${(value.groups as number[]).join('+')})`;
  const parsed = parseTimeSignature(text);
  if (!parsed.ok) {
    add(errors, parsed.code, path, 'Time signature is not accepted by the shared score-event model.');
    return false;
  }
  return true;
}

function validateEvent(event: unknown, path: string, errors: InterchangeError[]): void {
  if (!isRecord(event) || typeof event.kind !== 'string') {
    add(errors, 'invalidEvent', path, 'Score event has an invalid shape.');
    return;
  }
  const eventFields: Readonly<Record<string, readonly string[]>> = {
    keyChange: ['kind', 'key'], tempoChange: ['kind', 'bpm'], tempoMark: ['kind', 'mark'],
    timeSignatureChange: ['kind', 'timeSignature'], feelChange: ['kind', 'feel'], dynamic: ['kind', 'dynamic'],
    rehearsalMark: ['kind', 'text'], text: ['kind', 'text'], ottavaChange: ['kind', 'ottava']
  };
  const allowed = eventFields[event.kind];
  if (!allowed) { add(errors, 'invalidEventKind', `${path}/kind`, 'Event kind is unknown.'); return; }
  rejectUnknownFields(event, allowed, path, errors);
  let directive = '';
  let value = '';
  switch (event.kind) {
    case 'keyChange': directive = 'key'; value = String(event.key ?? ''); break;
    case 'tempoChange': directive = 'tempo'; value = String(event.bpm ?? ''); break;
    case 'tempoMark': directive = 'tempo'; value = ({ ritardando: 'rit.', accelerando: 'accel.', aTempo: 'a tempo', tempoPrimo: 'tempo primo' } as Record<string, string>)[String(event.mark)] ?? ''; break;
    case 'timeSignatureChange':
      if (!validateTimeSignature(event.timeSignature, `${path}/timeSignature`, errors)) return;
      directive = 'time'; value = `${event.timeSignature.numerator}/${event.timeSignature.denominator}(${event.timeSignature.groups.join('+')})`; break;
    case 'feelChange': directive = 'feel'; value = String(event.feel ?? ''); break;
    case 'dynamic': directive = 'dynamic'; value = String(event.dynamic ?? ''); break;
    case 'rehearsalMark': directive = 'mark'; value = String(event.text ?? ''); break;
    case 'text': directive = 'text'; value = String(event.text ?? ''); break;
    case 'ottavaChange': directive = 'ottava'; value = String(event.ottava === 'none' ? 'off' : event.ottava ?? ''); break;
    default: add(errors, 'invalidEventKind', `${path}/kind`, 'Event kind is unknown.'); return;
  }
  if (parseDirective(directive, value).ok === false) add(errors, 'invalidEventValue', path, 'Event value is invalid under the shared score-event parser.');
}

function validateNote(note: unknown, path: string, errors: InterchangeError[]): void {
  if (!isRecord(note) || typeof note.isRest !== 'boolean' || typeof note.tieToNext !== 'boolean' || typeof note.tiedFromPrev !== 'boolean') {
    add(errors, 'invalidNote', path, 'Note event has an invalid shape.');
    return;
  }
  rejectUnknownFields(note, ['isRest', 'pitch', 'pitches', 'duration', 'techniques', 'tieToNext', 'tiedFromPrev', 'syllables'], path, errors);
  validNoteValue(note.duration, `${path}/duration`, errors, isRecord(note.techniques) && note.techniques.grace === true);
  validSyllables(note.syllables, `${path}/syllables`, errors);
  if (note.isRest) {
    if (note.pitch !== undefined || note.pitches !== undefined) add(errors, 'restHasPitch', path, 'A rest cannot contain a pitch.');
    if (note.tieToNext || note.tiedFromPrev) add(errors, 'invalidMelodyTieSource', path, 'A rest cannot start or continue a tie.');
  } else if (note.pitch !== undefined && note.pitches !== undefined) {
    add(errors, 'ambiguousPitch', path, 'A note must contain either one pitch or a note group, not both.');
  } else if (note.pitch !== undefined) validPitch(note.pitch, `${path}/pitch`, errors);
  else if (note.pitches !== undefined && Array.isArray(note.pitches)) {
    if (note.pitches.length < 2) add(errors, 'invalidNoteGroup', `${path}/pitches`, 'A note group requires at least two pitches.');
    note.pitches.forEach((pitch, index) => validPitch(pitch, `${path}/pitches/${index}`, errors));
  } else add(errors, 'missingPitch', path, 'A sounding note requires a pitch or note group.');
  validTechniques(note.techniques, `${path}/techniques`, errors);
  if (note.pitches !== undefined && Array.isArray(note.pitches)) {
    if (note.tieToNext || note.tiedFromPrev) add(errors, 'unsupportedGroupTie', path, 'A note group cannot start or continue a tie.');
    if (isRecord(note.techniques) && (note.techniques.connection !== undefined || note.techniques.bend !== undefined || note.techniques.slurStart === true || note.techniques.slurEnd === true)) {
      add(errors, 'unsupportedGroupTechnique', `${path}/techniques`, 'A note group cannot carry a connection, bend, or slur technique.');
    }
  }
  if (Array.isArray(note.syllables) && (note.isRest || isRecord(note.techniques) && note.techniques.grace === true || note.tiedFromPrev) && note.syllables.length > 0) {
    add(errors, 'lyricOnNonSungSlot', `${path}/syllables`, 'Rests, grace notes, and tied continuations do not consume lyric slots.');
  }
}

function validateTabNote(note: unknown, path: string, errors: InterchangeError[]): void {
  if (!isRecord(note) || !Number.isInteger(note.string) || (note.string as number) < 1 || (note.string as number) > 6 || typeof note.dead !== 'boolean' || typeof note.tieToNext !== 'boolean') {
    add(errors, 'invalidTabNote', path, 'TAB note must have a valid string and boolean dead/tie values.');
    return;
  }
  rejectUnknownFields(note, ['string', 'fret', 'dead', 'tieToNext', 'effects'], path, errors);
  if (note.dead) {
    if (note.fret !== undefined) add(errors, 'deadNoteHasFret', `${path}/fret`, 'Dead notes have no pitch or fret.');
  } else if (!Number.isInteger(note.fret) || (note.fret as number) < 0 || (note.fret as number) > MAX_FRET) {
    add(errors, 'invalidFret', `${path}/fret`, 'Fret must be within the physical fret range.');
  }
  validateEffects(note.effects, `${path}/effects`, 'note', errors);
}

/** Validates and derives all semantic constraints in an interchange snapshot without mutating it. */
export function validateInterchangeScore(score: InterchangeScore): readonly InterchangeError[] {
  const errors: InterchangeError[] = [];
  if (!isRecord(score)) return [{ code: 'invalidScore', path: '', detail: 'Score must be an object.' }];
  rejectUnknownFields(score, ['schemaVersion', 'metadata', 'chordDefinitions', 'arrangement', 'melodyGroups', 'measures'], '', errors);
  if (score.schemaVersion !== 1) add(errors, 'unsupportedSchemaVersion', '/schemaVersion', 'Only interchange schema version 1 is supported.');
  const metadata = score.metadata as unknown;
  if (!isRecord(metadata)) return [...errors, { code: 'invalidMetadata', path: '/metadata', detail: 'Metadata must be an object.' }];
  rejectUnknownFields(metadata, ['title', 'artist', 'memo', 'key', 'bpm', 'capo', 'tuning', 'timeSignature', 'feel', 'pickup', 'showRhythm', 'measuresPerRow', 'style', 'expandPageBreakRepeats'], '/metadata', errors);
  for (const key of ['title', 'artist', 'memo', 'key'] as const) if (typeof metadata[key] !== 'string') add(errors, 'invalidMetadataField', `/metadata/${key}`, 'Metadata field must be a string.');
  if (typeof metadata.key === 'string' && parseKeySignature(metadata.key) === null) add(errors, 'invalidKey', '/metadata/key', 'Initial sounding key is not accepted by the shared key parser.');
  if (typeof metadata.bpm !== 'number' || !Number.isFinite(metadata.bpm) || metadata.bpm <= 0) add(errors, 'invalidBpm', '/metadata/bpm', 'Initial BPM must be a finite positive number.');
  if (!Number.isInteger(metadata.capo) || (metadata.capo as number) < 0 || (metadata.capo as number) > MAX_CAPO) add(errors, 'invalidCapo', '/metadata/capo', 'Capo must be an integer from 0 through 12.');
  if (typeof metadata.showRhythm !== 'boolean' || typeof metadata.expandPageBreakRepeats !== 'boolean') add(errors, 'invalidMetadataField', '/metadata', 'Display flags must be boolean.');
  if (!Number.isInteger(metadata.measuresPerRow) || (metadata.measuresPerRow as number) < 1 || (metadata.measuresPerRow as number) > 8) add(errors, 'invalidMeasuresPerRow', '/metadata/measuresPerRow', 'Measures per row must be an integer from 1 through 8.');
  if (!['straight', 'swing', 'shuffle'].includes(String(metadata.feel))) add(errors, 'invalidFeel', '/metadata/feel', 'Feel is invalid.');
  if (!validateTimeSignature(metadata.timeSignature, '/metadata/timeSignature', errors)) { /* detail added */ }
  if (metadata.pickup !== undefined) validFraction(metadata.pickup, '/metadata/pickup', errors, true);
  const tuning = metadata.tuning;
  if (isRecord(tuning)) rejectUnknownFields(tuning, ['openMidi', 'preset'], '/metadata/tuning', errors);
  if (!isRecord(tuning) || !Array.isArray(tuning.openMidi) || tuning.openMidi.length !== 6 || tuning.openMidi.some(p => !Number.isInteger(p) || p < 0 || p > 127)) {
    add(errors, 'invalidTuning', '/metadata/tuning/openMidi', 'Tuning requires six MIDI integers ordered from string 6 to string 1.');
  }
  if (isRecord(tuning) && tuning.preset !== undefined) {
    const parsedPreset = typeof tuning.preset === 'string' ? parseTuningValue(tuning.preset) : null;
    const openMidi = Array.isArray(tuning.openMidi) ? tuning.openMidi : undefined;
    if (!parsedPreset?.ok || !parsedPreset.tuning.preset || parsedPreset.tuning.preset !== tuning.preset ||
        !openMidi || parsedPreset.tuning.openMidi.some((pitch, index) => pitch !== openMidi[index])) {
      add(errors, 'invalidTuningPreset', '/metadata/tuning/preset', 'Tuning preset must be canonical and match its six open MIDI pitches.');
    }
  }
  const style = metadata.style;
  if (!isRecord(style)) add(errors, 'invalidStyle', '/metadata/style', 'Style must be an object.');
  else {
    rejectUnknownFields(style, ['chordSize', 'lyricSize', 'titleSize', 'sectionSize', 'fontSize'], '/metadata/style', errors);
    for (const [key, value] of Object.entries(style)) if (!['chordSize', 'lyricSize', 'titleSize', 'sectionSize', 'fontSize'].includes(key) || typeof value !== 'number' || !Number.isFinite(value) || value <= 0) add(errors, 'invalidStyleField', `/metadata/style/${key}`, 'Style values must be finite positive numbers with documented names.');
  }

  if (!Array.isArray(score.chordDefinitions)) add(errors, 'invalidChordDefinitions', '/chordDefinitions', 'Chord definitions must be an array.');
  else score.chordDefinitions.forEach((definition, index) => {
    const path = `/chordDefinitions/${index}`;
    if (!isRecord(definition) || typeof definition.name !== 'string' || !CHORD_NAME_RE.test(definition.name) || (definition.label !== undefined && (typeof definition.label !== 'string' || !CHORD_LABEL_RE.test(definition.label))) || !Array.isArray(definition.frets) || definition.frets.length !== 6 || !Array.isArray(definition.barres)) {
      add(errors, 'invalidChordDefinition', path, 'Chord definition has an invalid name, label, fretting, or barre list.'); return;
    }
    rejectUnknownFields(definition, ['name', 'label', 'frets', 'baseFret', 'fingers', 'barres'], path, errors);
    const def = definition as Record<string, any>;
    const capo = Number.isInteger(metadata.capo) && (metadata.capo as number) >= 0 && (metadata.capo as number) <= MAX_CAPO ? metadata.capo as number : 0;
    if (def.frets.some((fret: unknown) => fret !== 'x' && (!Number.isInteger(fret) || (fret as number) < 0 || (fret as number) > MAX_FRET || capo + (fret as number) > MAX_FRET))) add(errors, 'invalidChordFret', `${path}/frets`, 'Chord frets must be within the physical 24-fret range after capo.');
    if (def.baseFret !== undefined && (!Number.isInteger(def.baseFret) || def.baseFret < 1 || def.baseFret > MAX_FRET || capo + def.baseFret > MAX_FRET)) add(errors, 'invalidChordBaseFret', `${path}/baseFret`, 'Base fret must be within the physical 24-fret range after capo.');
    if (def.fingers !== undefined && (!Array.isArray(def.fingers) || def.fingers.length !== 6 || def.fingers.some((finger: unknown) => finger !== null && finger !== 'T' && !['1', '2', '3', '4'].includes(String(finger))))) add(errors, 'invalidChordFingers', `${path}/fingers`, 'Fingering must have six null, 1-through-4, or thumb values.');
    def.barres.forEach((rawBarre: unknown, barreIndex: number) => {
      const barre = rawBarre as Record<string, any>;
      if (!isRecord(barre) || !Number.isInteger(barre.fret) || (barre.fret as number) < 1 || (barre.fret as number) > MAX_FRET || capo + (barre.fret as number) > MAX_FRET || !Number.isInteger(barre.from) || !Number.isInteger(barre.to) || (barre.from as number) < 0 || (barre.to as number) < 0 || (barre.from as number) > 5 || (barre.to as number) > 5) add(errors, 'invalidChordBarre', `${path}/barres/${barreIndex}`, 'Barre fret and string endpoints are invalid.');
      else rejectUnknownFields(barre, ['fret', 'from', 'to'], `${path}/barres/${barreIndex}`, errors);
    });
    if (!errors.some(error => error.path.startsWith(path))) {
      const parsed = formatChordDefinition({ name: def.name, ...(def.label ? { label: def.label } : {}), frets: def.frets, ...(def.baseFret !== undefined ? { baseFret: def.baseFret } : {}), ...(def.fingers !== undefined ? { fingers: def.fingers } : {}), barres: def.barres });
      void parsed;
    }
  });

  if (!Array.isArray(score.measures) || score.measures.length === 0) add(errors, 'invalidMeasures', '/measures', 'Score must contain at least one written measure.');
  const sectionStarts: Array<{ name: string; start: number }> = [];
  if (Array.isArray(score.measures)) score.measures.forEach((measure, index) => {
    const path = `/measures/${index}`;
    if (!isRecord(measure)) { add(errors, 'invalidMeasure', path, 'Measure must be an object.'); return; }
    rejectUnknownFields(measure, ['index', 'sectionStart', 'pageBreakBefore', 'expectedBeats', 'isPickup', 'barline', 'eventsBefore', 'chords', 'chordPlacementMode', 'rhythm', 'measureLyric', 'melody', 'tabVoices'], path, errors);
    if (measure.index !== index) add(errors, 'invalidMeasureIndex', `${path}/index`, 'Measure indexes must be contiguous and zero-based.');
    if (measure.sectionStart !== undefined) {
      if (typeof measure.sectionStart !== 'string' || !measure.sectionStart.trim()) add(errors, 'invalidSection', `${path}/sectionStart`, 'Section name must be nonempty text.');
      else sectionStarts.push({ name: measure.sectionStart, start: index });
    }
    if (measure.pageBreakBefore !== undefined && typeof measure.pageBreakBefore !== 'boolean') add(errors, 'invalidPageBreak', `${path}/pageBreakBefore`, 'Page break marker must be boolean.');
    validFraction(measure.expectedBeats, `${path}/expectedBeats`, errors, true);
    if (measure.isPickup !== undefined && typeof measure.isPickup !== 'boolean') add(errors, 'invalidPickupFlag', `${path}/isPickup`, 'Pickup marker must be boolean.');
    const barline = measure.barline as Record<string, any>;
    if (!isRecord(barline) || ['repeatStart', 'repeatEnd', 'doubleEnd', 'finalEnd'].some(key => typeof barline[key] !== 'boolean') || (barline.bracket !== undefined && typeof barline.bracket !== 'string') || (barline.specialMark !== undefined && typeof barline.specialMark !== 'string')) add(errors, 'invalidBarline', `${path}/barline`, 'Barline markers are invalid.');
    else rejectUnknownFields(barline, ['repeatStart', 'repeatEnd', 'doubleEnd', 'finalEnd', 'bracket', 'specialMark'], `${path}/barline`, errors);
    if (!Array.isArray(measure.eventsBefore)) add(errors, 'invalidEvents', `${path}/eventsBefore`, 'Events must be an array.');
    else measure.eventsBefore.forEach((event, i) => validateEvent(event, `${path}/eventsBefore/${i}`, errors));
    if (!Array.isArray(measure.chords) || !['equalSplit', 'explicitDuration', 'inline'].includes(String(measure.chordPlacementMode))) add(errors, 'invalidChords', `${path}/chords`, 'Chord placements or placement mode are invalid.');
    else {
      if (!Array.isArray(measure.chords)) return;
      measure.chords.forEach((chord, i) => {
        const chordPath = `${path}/chords/${i}`;
        if (isRecord(chord)) rejectUnknownFields(chord, ['name', 'label', 'beatOffset'], chordPath, errors);
        if (!isRecord(chord) || typeof chord.name !== 'string' || !CHORD_NAME_RE.test(chord.name) || (chord.label !== undefined && (typeof chord.label !== 'string' || !CHORD_LABEL_RE.test(chord.label))) || !validFraction(chord.beatOffset, `${chordPath}/beatOffset`, errors)) add(errors, 'invalidChordPlacement', chordPath, 'Chord placement requires a valid name, label, and exact onset.');
      });
    }
    if (isRecord(measure) && Array.isArray(measure.chords)) {
      let previous: InterchangeFraction | undefined;
      for (let i = 0; i < measure.chords.length; i++) {
        const chord = measure.chords[i];
        const beatOffset = isRecord(chord) ? chord.beatOffset as Record<string, any> : null;
        const expectedBeats = measure.expectedBeats;
        if (!isNormalizedFraction(beatOffset) || !isNormalizedFraction(expectedBeats)) continue;
        const ordering = previous ? compareFractionsExact(beatOffset, previous) : 1;
        const atOrAfterEnd = compareFractionsExact(beatOffset, expectedBeats) >= 0;
        if (ordering < 0 || (measure.chordPlacementMode === 'explicitDuration' && (ordering === 0 || atOrAfterEnd)) || compareFractionsExact(beatOffset, expectedBeats) > 0) {
          add(errors, 'invalidChordOnset', `${path}/chords/${i}/beatOffset`, 'Chord onsets must be ordered, positive-duration, and within the measure.');
        }
        previous = beatOffset;
      }
    }
    if (!isRecord(measure.rhythm) || !['explicit', 'implicit', 'repeat'].includes(String(measure.rhythm.origin)) || !Array.isArray(measure.rhythm.events)) add(errors, 'invalidRhythm', `${path}/rhythm`, 'Rhythm origin or events are invalid.');
    else {
      rejectUnknownFields(measure.rhythm, ['origin', 'events'], `${path}/rhythm`, errors);
      measure.rhythm.events.forEach((event, i) => {
      const rhythmPath = `${path}/rhythm/events/${i}`;
      if (!isRecord(event) || ['isRest', 'down', 'up', 'ghost', 'accent', 'tie'].some(key => typeof event[key] !== 'boolean')) { add(errors, 'invalidRhythmEvent', rhythmPath, 'Rhythm flags are invalid.'); return; }
      rejectUnknownFields(event, ['duration', 'isRest', 'down', 'up', 'ghost', 'accent', 'tie', 'arpeggio', 'pitch', 'pitches', 'inlineLyric', 'techniques'], rhythmPath, errors);
      if (event.arpeggio !== undefined && typeof event.arpeggio !== 'boolean') add(errors, 'invalidRhythmEvent', `${rhythmPath}/arpeggio`, 'Arpeggio flag must be boolean.');
      validNoteValue(event.duration, `${rhythmPath}/duration`, errors, isRecord(event.techniques) && event.techniques.grace === true);
      if (event.pitch !== undefined) validPitch(event.pitch, `${rhythmPath}/pitch`, errors);
      if (event.pitches !== undefined) {
        if (!Array.isArray(event.pitches) || event.pitches.length < 2) add(errors, 'invalidNoteGroup', `${rhythmPath}/pitches`, 'Inline note group requires two or more pitches.');
        else event.pitches.forEach((pitch, p) => validPitch(pitch, `${rhythmPath}/pitches/${p}`, errors));
      }
      if (event.inlineLyric !== undefined && typeof event.inlineLyric !== 'string') add(errors, 'invalidInlineLyric', `${rhythmPath}/inlineLyric`, 'Inline lyric must be text.');
      validTechniques(event.techniques, `${rhythmPath}/techniques`, errors);
      if (event.isRest && (event.pitch !== undefined || event.pitches !== undefined)) add(errors, 'restHasPitch', rhythmPath, 'A rest cannot contain a pitch.');
      });
    }
    if (measure.measureLyric !== undefined && typeof measure.measureLyric !== 'string') add(errors, 'invalidMeasureLyric', `${path}/measureLyric`, 'Measure lyric must be text.');
    if (measure.melody !== undefined) {
      if (!Array.isArray(measure.melody)) add(errors, 'invalidMelody', `${path}/melody`, 'Melody must be a note array.');
      else measure.melody.forEach((note, i) => validateNote(note, `${path}/melody/${i}`, errors));
    }
    if (measure.tabVoices !== undefined) {
      if (!Array.isArray(measure.tabVoices)) add(errors, 'invalidTabVoices', `${path}/tabVoices`, 'TAB voices must be an array.');
      else measure.tabVoices.forEach((voice, voiceIndex) => {
        const voicePath = `${path}/tabVoices/${voiceIndex}`;
        if (!isRecord(voice) || ![1, 2, 3, 4].includes(voice.voice as number) || voice.voice !== 1 || !Array.isArray(voice.beats)) { add(errors, 'invalidTabVoice', voicePath, 'Only parsed voice 1 with a beat array is supported.'); return; }
        rejectUnknownFields(voice, ['voice', 'beats'], voicePath, errors);
        voice.beats.forEach((beat, beatIndex) => {
          const beatPath = `${voicePath}/beats/${beatIndex}`;
          if (!isRecord(beat) || typeof beat.isRest !== 'boolean' || !Array.isArray(beat.notes) || !Array.isArray(beat.syllables)) { add(errors, 'invalidTabBeat', beatPath, 'TAB beat is invalid.'); return; }
          rejectUnknownFields(beat, ['isRest', 'notes', 'duration', 'effects', 'syllables'], beatPath, errors);
          validSyllables(beat.syllables, `${beatPath}/syllables`, errors);
          if (beat.isRest && beat.notes.length > 0) add(errors, 'restHasTabNotes', `${beatPath}/notes`, 'A TAB rest cannot contain notes.');
          if (beat.isRest && beat.syllables.length > 0) add(errors, 'lyricOnNonSungSlot', `${beatPath}/syllables`, 'TAB rests do not consume lyric slots.');
          if (!beat.isRest && beat.notes.length === 0) add(errors, 'emptyTabAttack', `${beatPath}/notes`, 'A sounding TAB beat requires at least one note.');
          const stringsByBeat = new Set<number>();
          validNoteValue(beat.duration, `${beatPath}/duration`, errors);
          beat.notes.forEach((note, noteIndex) => {
            validateTabNote(note, `${beatPath}/notes/${noteIndex}`, errors);
            if (isRecord(note)) {
              if (stringsByBeat.has(note.string as number)) add(errors, 'duplicateTabString', `${beatPath}/notes/${noteIndex}/string`, 'A TAB chord cannot contain the same string twice.');
              stringsByBeat.add(note.string as number);
            }
          });
          validateEffects(beat.effects, `${beatPath}/effects`, 'beat', errors);
        });
      });
    }
  });

  if (!Array.isArray(score.melodyGroups)) {
    add(errors, 'invalidMelodyGroups', '/melodyGroups', 'Melody group provenance must be an array.');
  } else {
    const measureCount = Array.isArray(score.measures) ? score.measures.length : 0;
    const covered = new Set<number>();
    let previousEnd = 0;
    score.melodyGroups.forEach((rawGroup, groupIndex) => {
      const groupPath = `/melodyGroups/${groupIndex}`;
      if (!isRecord(rawGroup)) {
        add(errors, 'invalidMelodyGroup', groupPath, 'Melody group provenance must be an object.');
        return;
      }
      rejectUnknownFields(rawGroup, ['startMeasure', 'endMeasureExclusive', 'verseCount'], groupPath, errors);
      const start = rawGroup.startMeasure;
      const end = rawGroup.endMeasureExclusive;
      const verseCount = rawGroup.verseCount;
      let validRange = true;
      if (!Number.isSafeInteger(start) || (start as number) < 0 || (start as number) >= measureCount) {
        add(errors, 'invalidMelodyGroupRange', `${groupPath}/startMeasure`, 'Melody group start must identify a written measure.');
        validRange = false;
      }
      if (!Number.isSafeInteger(end) || (end as number) <= (Number.isSafeInteger(start) ? start as number : -1) || (end as number) > measureCount) {
        add(errors, 'invalidMelodyGroupRange', `${groupPath}/endMeasureExclusive`, 'Melody group end must be after its start and within written measures.');
        validRange = false;
      }
      if (!Number.isSafeInteger(verseCount) || (verseCount as number) < 0) add(errors, 'invalidMelodyGroupVerseCount', `${groupPath}/verseCount`, 'Melody group verse count must be a nonnegative safe integer.');
      if (validRange) {
        const first = start as number;
        const exclusive = end as number;
        if (first < previousEnd) add(errors, 'overlappingMelodyGroups', `${groupPath}/startMeasure`, 'Melody groups must be ordered and non-overlapping.');
        previousEnd = Math.max(previousEnd, exclusive);
        for (let measureIndex = first; measureIndex < exclusive; measureIndex++) {
          if (covered.has(measureIndex)) add(errors, 'overlappingMelodyGroups', `${groupPath}/startMeasure`, 'A written melody measure cannot belong to more than one group.');
          covered.add(measureIndex);
          const measure = Array.isArray(score.measures) ? score.measures[measureIndex] : undefined;
          if (!isRecord(measure) || !Array.isArray(measure.melody)) add(errors, 'melodyGroupCoverage', `${groupPath}/startMeasure`, 'Every measure in a melody group must have parser-owned melody events.');
          if (measureIndex > first && isRecord(measure) && measure.sectionStart !== undefined) add(errors, 'melodyGroupCrossesSection', groupPath, 'A melody group cannot cross a named section boundary.');
          if (isRecord(measure) && Array.isArray(measure.melody)) measure.melody.forEach((note, noteIndex) => {
            if (isRecord(note) && Array.isArray(note.syllables) && Number.isSafeInteger(verseCount) && note.syllables.length > (verseCount as number)) {
              add(errors, 'melodyGroupSlotCount', `/measures/${measureIndex}/melody/${noteIndex}/syllables`, 'A melody note cannot contain more lyric slots than its owning group has verses.');
            }
          });
        }
      }
    });
    if (Array.isArray(score.measures)) score.measures.forEach((measure, measureIndex) => {
      if (isRecord(measure) && Array.isArray(measure.melody) && !covered.has(measureIndex)) add(errors, 'melodyGroupCoverage', '/melodyGroups', 'Every written measure with melody must be covered by exactly one melody group.');
    });
  }

  if (Array.isArray(score.measures)) {
    const melody: Array<{ note: Record<string, any>; path: string }> = [];
    score.measures.forEach((measure, measureIndex) => {
      if (!isRecord(measure) || !Array.isArray(measure.melody)) return;
      measure.melody.forEach((note, noteIndex) => {
        if (isRecord(note)) melody.push({ note, path: `/measures/${measureIndex}/melody/${noteIndex}` });
      });
    });
    melody.forEach(({ note, path }, index) => {
      const previous = melody[index - 1]?.note;
      const next = melody[index + 1]?.note;
      if (note.tieToNext) {
        if (note.isRest || note.pitch === undefined || note.pitches !== undefined) add(errors, 'invalidMelodyTieSource', path, 'Only a single pitched note can start a tie.');
        if (!next || next.isRest || next.pitch === undefined || next.pitches !== undefined) add(errors, 'invalidMelodyTieTarget', path, 'A melody tie must continue into the next single pitched note.');
        else if (!next.tiedFromPrev) add(errors, 'missingTieContinuation', `${path}/tieToNext`, 'A melody tie source must be paired with the next note’s tiedFromPrev marker.');
      }
      if (note.tiedFromPrev && (!previous || !previous.tieToNext || previous.isRest || previous.pitch === undefined || previous.pitches !== undefined || note.isRest || note.pitch === undefined || note.pitches !== undefined)) {
        add(errors, 'orphanTieContinuation', `${path}/tiedFromPrev`, 'A tied continuation must follow a compatible single-note tie source.');
      }
    });
  }

  const sectionNames = new Set<string>();
  for (const section of sectionStarts) {
    if (score.arrangement !== undefined && sectionNames.has(section.name)) add(errors, 'duplicateSection', `/measures/${section.start}/sectionStart`, 'Section names must be unique for arrangement references.');
    sectionNames.add(section.name);
  }
  if (score.arrangement !== undefined) {
    if (!Array.isArray(score.arrangement) || !score.arrangement.length) add(errors, 'invalidArrangement', '/arrangement', 'Arrangement must be a nonempty ordered list.');
    else {
      score.arrangement.forEach((entry, index) => {
        const path = `/arrangement/${index}`;
        if (isRecord(entry)) rejectUnknownFields(entry, ['name', 'count', 'lyricVerse'], path, errors);
        if (!isRecord(entry) || typeof entry.name !== 'string' || !Number.isSafeInteger(entry.count) || (entry.count as number) < 1 || (entry.lyricVerse !== undefined && (!Number.isSafeInteger(entry.lyricVerse) || (entry.lyricVerse as number) < 1))) add(errors, 'invalidArrangementEntry', path, 'Arrangement entry name, count, or lyric verse is invalid.');
        else if (!sectionNames.has(entry.name)) add(errors, 'invalidArrangementReference', `${path}/name`, 'Arrangement entry must refer to a written section.');
      });
    if (Array.isArray(score.measures) && score.measures.length && !errors.length) {
        const input = score.measures.map(measure => ({ measureIndex: measure.index, repeatStart: measure.barline.repeatStart, repeatEnd: measure.barline.repeatEnd, bracket: measure.barline.bracket, specialMark: measure.barline.specialMark, sectionName: measure.sectionStart }));
        const sections = sectionStarts.map((section, index) => {
          const end = sectionStarts[index + 1]?.start ?? score.measures.length;
          return { name: section.name, start: section.start, end, labelSpan: { line: 0, startCol: 0, endCol: 0 }, lyricVerseCount: sectionLyricVerseCapacity(score as InterchangeScore, section.start, end) };
        });
        const lowered = lowerArrangement(score.arrangement.map((entry, index) => ({ ...entry, span: { line: 0, startCol: index, endCol: index + 1 }, nameSpan: { line: 0, startCol: index, endCol: index + 1 } })), sections, input);
        if (!lowered.valid) lowered.diagnostics.forEach((diagnostic, index) => add(errors, diagnostic.code, `/arrangement/${index}`, 'Arrangement cannot be resolved against the written sections.'));
      }
    }
  }

  if (Array.isArray(score.measures) && score.measures.length && !errors.length) {
    const typedMeasures = score.measures as readonly InterchangeMeasure[];
    const measures = typedMeasures.map(measure => ({ measureIndex: measure.index, repeatStart: measure.barline.repeatStart, repeatEnd: measure.barline.repeatEnd, bracket: measure.barline.bracket, specialMark: measure.barline.specialMark, sectionName: measure.sectionStart }));
    const resolved = resolvePlayOrder(measures);
    if (!resolved.valid) resolved.diagnostics.forEach((diagnostic, index) => add(errors, diagnostic.code, `/measures/${diagnostic.measureIndex}/barline`, 'Written repeat/navigation structure is invalid.'));
    let currentTimeSignature = metadata.timeSignature as InterchangeTimeSignature;
    typedMeasures.forEach((measure, measureIndex) => {
      for (const event of measure.eventsBefore) if (event.kind === 'timeSignatureChange' && event.timeSignature) currentTimeSignature = event.timeSignature;
      const expected = measureIndex === 0 && metadata.pickup !== undefined ? metadata.pickup as InterchangeFraction : measureBeats({ ...currentTimeSignature, groups: [...currentTimeSignature.groups] });
      if (!isRecord(measure.expectedBeats) || !Number.isSafeInteger(measure.expectedBeats.n) || !Number.isSafeInteger(measure.expectedBeats.d) || !feq(frac(measure.expectedBeats.n as number, measure.expectedBeats.d as number), frac(expected.n, expected.d))) {
        add(errors, 'measureLengthMismatch', `/measures/${measureIndex}/expectedBeats`, 'Expected beats must match the meter and initial pickup context.');
      }
      if (measureIndex === 0 && measure.pageBreakBefore) add(errors, 'pageBreakBeforeFirstMeasure', `/measures/0/pageBreakBefore`, 'A page break cannot precede the first written measure.');
      if (measure.barline.doubleEnd && measure.barline.finalEnd) add(errors, 'conflictingBarline', `/measures/${measureIndex}/barline`, 'Double and final barlines cannot both close one measure.');
      if (measure.barline.specialMark !== undefined && !['segno', 'coda', 'fine', 'to_coda', 'dc', 'ds'].includes(measure.barline.specialMark)) add(errors, 'invalidNavigationMark', `/measures/${measureIndex}/barline/specialMark`, 'Navigation mark is outside the shared play-order vocabulary.');
      if (measure.sectionStart !== undefined && (!/^\[[^\]\r\n]+\]$/.test(`[${measure.sectionStart}]`) || /[\r\n]/.test(measure.sectionStart))) add(errors, 'invalidSection', `/measures/${measureIndex}/sectionStart`, 'Section name cannot be expressed by the current syntax.');

      const expectedFraction = measure.expectedBeats;
      if (measure.chordPlacementMode === 'equalSplit') measure.chords.forEach((chord, chordIndex) => {
        const actual = chord.beatOffset;
        if (!isNormalizedFraction(actual) || !isNormalizedFraction(expectedFraction)) return;
        const left = BigInt(actual.n) * BigInt(expectedFraction.d) * BigInt(measure.chords.length);
        const right = BigInt(expectedFraction.n) * BigInt(chordIndex) * BigInt(actual.d);
        if (left !== right) add(errors, 'equalSplitOffsetMismatch', `/measures/${measureIndex}/chords/${chordIndex}/beatOffset`, 'Equal-split chord offsets must be exact subdivisions of the expected measure length.');
      });
      if (measure.chordPlacementMode === 'explicitDuration' && measure.chords.length && (measure.chords[0].beatOffset.n !== 0 || measure.chords[0].beatOffset.d !== 1)) add(errors, 'explicitChordStart', `/measures/${measureIndex}/chords/0/beatOffset`, 'Explicit-duration chord sequence must begin at beat zero.');
      if (measure.chordPlacementMode === 'inline') {
        const boundaries = [{ n: 0, d: 1 }];
        let cursor: InterchangeFraction = frac(0);
        for (const [eventIndex, event] of measure.rhythm.events.entries()) {
          const duration = isRecord(event) && isRecord(event.duration) ? event.duration.beats : undefined;
          if (!isNormalizedFraction(duration)) continue;
          if (!(isRecord(event.techniques) && event.techniques.grace === true)) {
            const sum = addFractionsExact(cursor, duration);
            if (!sum) {
              add(errors, 'fractionOverflow', `/measures/${measureIndex}/rhythm/events/${eventIndex}/duration/beats`, 'Exact inline rhythm boundary exceeds the safe integer fraction range.');
              continue;
            }
            cursor = sum;
          }
          boundaries.push(cursor);
        }
        measure.chords.forEach((chord, chordIndex) => {
          if (isNormalizedFraction(chord.beatOffset) && !boundaries.some(boundary => compareFractionsExact(boundary, chord.beatOffset) === 0)) add(errors, 'inlineChordOffsetMismatch', `/measures/${measureIndex}/chords/${chordIndex}/beatOffset`, 'Inline chord onset must align with a parsed rhythm-event boundary.');
        });
      }
      if (measure.rhythm.origin === 'implicit' && measure.rhythm.events.length) add(errors, 'implicitRhythmHasEvents', `/measures/${measureIndex}/rhythm/events`, 'Synthesized implicit rhythm cannot be represented as authored events.');
    });

    const tabPositions = typedMeasures.flatMap(measure => (measure.tabVoices ?? []).flatMap(voice => voice.beats.map(beat => ({ measureIndex: measure.index, beat }))));
    const tabBeats = tabPositions.map(position => position.beat);
    tabPositions.forEach(({ measureIndex, beat }, beatIndex) => {
      if (beat.isRest && beat.syllables.length > 0) add(errors, 'lyricOnNonSungTabBeat', `/measures/${measureIndex}/tabVoices/0/beats/${beatIndex}/syllables`, 'A TAB rest cannot own syllables; lyric rows attach only to sounding slots.');
      for (let noteIndex = 0; noteIndex < beat.notes.length; noteIndex++) {
        const note = beat.notes[noteIndex];
        if (!note.tieToNext) continue;
        if (resolveTabLinkTarget(tabBeats, beatIndex, note, 'tie').status !== 'valid') add(errors, 'invalidTabTie', `/measures/${measureIndex}/tabVoices/0/beats/${beatIndex}/notes/${noteIndex}`, 'TAB tie must target the same sounding string and fret.');
      }
    });
    const validTuning = isRecord(metadata.tuning) ? metadata.tuning as Record<string, any> : null;
    if (validTuning && Array.isArray(validTuning.openMidi) && validTuning.openMidi.length === 6 && Number.isInteger(metadata.capo) && (metadata.capo as number) >= 0 && (metadata.capo as number) <= MAX_CAPO) {
      try {
        const instrument = createInstrumentModel({ openMidi: validTuning.openMidi as [number, number, number, number, number, number] }, metadata.capo as number);
        score.measures.forEach((measure: any, measureIndex: number) => measure.tabVoices?.forEach((voice: any) => voice.beats.forEach((beat: any, beatIndex: number) => beat.notes.forEach((note: InterchangeTabNote, noteIndex: number) => {
          if (!note.dead && note.fret !== undefined) {
            try { instrument.pitchAt(note.string, note.fret); }
            catch { add(errors, 'fretOutsideInstrumentRange', `/measures/${measureIndex}/tabVoices/0/beats/${beatIndex}/notes/${noteIndex}/fret`, 'Fret exceeds the shared instrument model range for this capo.'); }
          }
        }))));
      } catch { add(errors, 'invalidInstrument', '/metadata/tuning', 'Tuning and capo cannot construct the shared instrument model.'); }
    }
  }
  return errors;
}
