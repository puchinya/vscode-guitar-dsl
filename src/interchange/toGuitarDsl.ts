import { parseGuitarDsl } from '../compiler';
import type { ScoreDiagnostic } from '../compiler';
import { decomposeBeats, fcmp, fsub, frac, formatNoteValuePart, parseNoteValueDetailed, type Fraction } from '../duration';
import { scanArrangementBlockLines, lowerArrangement } from '../arrangement';
import { formatChordDefinition, type ChordDefinition } from '../chordDefinition';
import { createInstrumentModel, type TuningPreset } from '../instrumentModel';
import { formatTimeSignature, type ScoreEventPayload } from '../scoreEvents';
import { resolvePlayOrder } from '../playOrder';
import type { PlayOrderMeasure } from '../playOrder';
import { takesSyllable, type NoteTechniques } from '../melody';
import { mergeLossReports, emptyLossReport, hasBlockingLoss } from './loss';
import { parsedScoreToInterchange } from './fromGuitarDsl';
import { validateInterchangeScore } from './validate';
import { interchangeSemanticMismatch } from './semanticProjection';
import type {
  InterchangeArrangementEntry,
  InterchangeChord,
  InterchangeEffectValue,
  InterchangeEvent,
  InterchangeFraction,
  InterchangeLossReport,
  InterchangeMeasure,
  InterchangeNote,
  InterchangeNoteTechniques,
  InterchangeNoteValue,
  InterchangePitch,
  InterchangeResult,
  InterchangeRhythmEvent,
  InterchangeScore,
  InterchangeSyllable,
  InterchangeTabBeat,
  InterchangeTabEffectCall,
  InterchangeTabNote
} from './model';

class Unrepresentable extends Error {
  constructor(readonly code: string, readonly path: string, message: string) { super(message); }
}

function fail(
  code: Extract<InterchangeResult<unknown>, { ok: false }>['code'],
  loss: InterchangeLossReport,
  errors: readonly { code: string; path: string; detail: string }[] = [],
  diagnostics: readonly ScoreDiagnostic[] = []
): InterchangeResult<string> {
  return { ok: false, code, loss, diagnostics: [...diagnostics], errors: [...errors] };
}

function fraction(value: InterchangeFraction): Fraction { return { n: value.n, d: value.d }; }
function noteValueText(value: InterchangeNoteValue): string { return value.parts.map(formatNoteValuePart).join('+'); }

function addExactFractions(a: InterchangeFraction, b: InterchangeFraction, path: string): InterchangeFraction {
  let numerator = BigInt(a.n) * BigInt(b.d) + BigInt(b.n) * BigInt(a.d);
  let denominator = BigInt(a.d) * BigInt(b.d);
  let x = numerator;
  let y = denominator;
  while (y !== 0n) [x, y] = [y, x % y];
  const divisor = x || 1n;
  numerator /= divisor;
  denominator /= divisor;
  if (numerator > BigInt(Number.MAX_SAFE_INTEGER) || denominator > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Unrepresentable('fractionOverflow', path, 'Exact rhythm boundary exceeds the safe integer fraction range.');
  }
  return { n: Number(numerator), d: Number(denominator) };
}

function checkedLineValue(value: string, path: string): string {
  if (/[\r\n]/.test(value) || /\s#/.test(value) || value.startsWith('#')) throw new Unrepresentable('unsafeText', path, 'Text cannot be emitted safely in the current GuitarDSL line syntax.');
  return value;
}

function pitchText(pitch: InterchangePitch): string {
  return `${pitch.step}${pitch.alter === 1 ? '#' : pitch.alter === -1 ? 'b' : ''}${pitch.octave}`;
}

function techniqueNames(value?: InterchangeNoteTechniques): string[] {
  if (!value) return [];
  const names: string[] = [];
  if (value.connection) names.push(value.connection);
  if (value.bend !== undefined) names.push(`bend:${value.bend}`);
  const flags: Array<[keyof InterchangeNoteTechniques, string]> = [
    ['vibrato', 'vibrato'], ['staccato', 'staccato'], ['tenuto', 'tenuto'], ['fermata', 'fermata'],
    ['breath', 'breath'], ['grace', 'grace'], ['slurStart', 'slur-start'], ['slurEnd', 'slur-end'],
    ['palmMute', 'pm'], ['letRing', 'let-ring']
  ];
  for (const [key, name] of flags) if (value[key]) names.push(name);
  return names;
}

function techniqueBlock(value?: InterchangeNoteTechniques): string {
  const names = techniqueNames(value);
  return names.length ? `{${names.join(',')}}` : '';
}

function melodyNoteText(note: InterchangeNote, path: string): string {
  const duration = noteValueText(note.duration);
  const tech = techniqueBlock(note.techniques);
  if (note.isRest) return `r/${duration}${tech}`;
  const tie = note.tieToNext ? '~' : '';
  if (note.pitch) return `${pitchText(note.pitch)}/${duration}${tech}${tie}`;
  if (note.pitches) {
    if (note.tieToNext) throw new Unrepresentable('unsupportedGroupTie', path, 'Grouped notes cannot be tied using the current GuitarDSL syntax.');
    return `[${note.pitches.map(pitchText).join(',')}]/${duration}${tech}`;
  }
  throw new Unrepresentable('missingPitch', path, 'Sounding melody note has no pitch.');
}

function rhythmEventText(event: InterchangeRhythmEvent, path: string): string {
  if (event.inlineLyric !== undefined && event.inlineLyric !== '') throw new Unrepresentable('inlineLyric', `${path}/inlineLyric`, 'The current GuitarDSL syntax has no typed inline lyric token.');
  const duration = noteValueText(event.duration);
  if (event.pitch || event.pitches) {
    const text = event.pitch
      ? `${pitchText(event.pitch)}/${duration}${techniqueBlock(event.techniques)}${event.tie ? '~' : ''}`
      : `[${event.pitches!.map(pitchText).join(',')}]/${duration}${techniqueBlock(event.techniques)}`;
    if (event.down || event.up || event.ghost || event.accent || event.arpeggio) throw new Unrepresentable('inlineRhythmFlags', path, 'Inline pitched events cannot carry slash-only rhythm modifiers in current syntax.');
    if (event.pitches && event.tie) throw new Unrepresentable('groupTie', path, 'Grouped inline notes cannot carry a tie.');
    return text;
  }
  let text = `${event.isRest ? 'r' : ''}${duration}`;
  const modifiers: string[] = [];
  if (event.down) modifiers.push('d');
  if (event.up) modifiers.push('u');
  if (event.ghost) modifiers.push('g');
  if (event.accent) modifiers.push('a');
  if (event.tie) modifiers.push('t');
  if (event.arpeggio) modifiers.push('arp');
  const techniques = event.techniques;
  if (techniques?.palmMute) modifiers.push('pm');
  if (techniques?.letRing) modifiers.push('lr');
  if (techniques?.staccato) modifiers.push('stacc');
  if (techniques?.tenuto) modifiers.push('ten');
  if (techniques?.fermata) modifiers.push('fermata');
  if (techniques?.vibrato) modifiers.push('vib');
  if (techniques?.breath) modifiers.push('breath');
  const unsupported = techniqueNames(techniques).filter(name => !['pm', 'let-ring', 'staccato', 'tenuto', 'fermata', 'vibrato', 'breath'].includes(name));
  if (unsupported.length) throw new Unrepresentable('rhythmTechnique', path, 'Pitched-only techniques require an inline pitch event.');
  if (modifiers.length) text += `.${modifiers.join('.')}`;
  return text;
}

function fractionCompare(a: InterchangeFraction, b: InterchangeFraction): number {
  return fcmp(fraction(a), fraction(b));
}

const DURATION_PARTS: Array<{ text: string; beats: Fraction }> = (() => {
  const items: Array<{ text: string; beats: Fraction }> = [];
  for (const base of [1, 2, 4, 8, 16] as const) {
    for (const dotted of [false, true]) {
      const plain = formatNoteValuePart({ base, dotted });
      const parsed = parseNoteValueDetailed(plain);
      if (typeof parsed !== 'string') items.push({ text: plain, beats: parsed.beats });
      for (let actual = 2; actual <= 16; actual++) for (let normal = 2; normal <= 16; normal++) {
        if (actual === normal) continue;
        const part = { base, dotted: false, tuplet: { actual, normal } };
        const text = formatNoteValuePart(part);
        const value = parseNoteValueDetailed(text);
        if (typeof value !== 'string') items.push({ text, beats: value.beats });
      }
    }
  }
  const unique = new Map<string, { text: string; beats: Fraction }>();
  for (const item of items) {
    const key = `${item.beats.n}/${item.beats.d}`;
    const old = unique.get(key);
    if (!old || item.text.localeCompare(old.text) < 0) unique.set(key, item);
  }
  return [...unique.values()].sort((a, b) => fcmp(b.beats, a.beats) || a.text.localeCompare(b.text));
})();

function exactDurationParts(target: InterchangeFraction, path: string): string[] {
  const wanted = fraction(target);
  if (wanted.n <= 0) throw new Unrepresentable('invalidChordDuration', path, 'Chord duration must be positive.');
  const ordinary = decomposeBeats(wanted);
  if (ordinary) return ordinary.map(formatNoteValuePart);
  const memo = new Map<string, string[] | null>();
  const maxTerms = Math.min(128, Math.max(8, Math.ceil(wanted.n / wanted.d * 8) + 8));
  const solve = (remaining: Fraction, depth: number): string[] | null => {
    if (remaining.n === 0) return [];
    if (depth >= maxTerms) return null;
    const key = `${remaining.n}/${remaining.d}:${depth}`;
    if (memo.has(key)) return memo.get(key)!;
    for (const candidate of DURATION_PARTS) {
      if (fcmp(candidate.beats, remaining) > 0) continue;
      const next = fsub(remaining, candidate.beats);
      if (!Number.isSafeInteger(next.n) || !Number.isSafeInteger(next.d)) continue;
      const suffix = solve(next, depth + 1);
      if (suffix) {
        const value = [candidate.text, ...suffix];
        memo.set(key, value);
        return value;
      }
    }
    memo.set(key, null);
    return null;
  };
  const parts = solve(wanted, 0);
  if (!parts) throw new Unrepresentable('unsupportedExactDuration', path, 'Exact chord duration cannot be expressed by the current shared note-value grammar.');
  return parts;
}

function chordToken(chord: InterchangeChord): string {
  return `${chord.name}${chord.label ? `@${chord.label}` : ''}`;
}

function chordTokensForMeasure(measure: InterchangeMeasure): { prefix: string[]; byOffset: Map<string, string[]> } {
  const prefix: string[] = [];
  const byOffset = new Map<string, string[]>();
  const pushAt = (offset: InterchangeFraction, token: string) => {
    const key = `${offset.n}/${offset.d}`;
    byOffset.set(key, [...(byOffset.get(key) ?? []), token]);
  };
  if (measure.chordPlacementMode === 'equalSplit') {
    for (const chord of measure.chords) prefix.push(chordToken(chord));
  } else if (measure.chordPlacementMode === 'explicitDuration') {
    for (let index = 0; index < measure.chords.length; index++) {
      const chord = measure.chords[index];
      const start = fraction(chord.beatOffset);
      const end = index + 1 < measure.chords.length ? fraction(measure.chords[index + 1].beatOffset) : fraction(measure.expectedBeats);
      const duration = fsub(end, start);
      if (duration.n <= 0) throw new Unrepresentable('invalidChordBoundary', `/measures/${measure.index}/chords/${index}/beatOffset`, 'Explicit chord boundaries must have positive durations.');
      const parts = exactDurationParts({ n: duration.n, d: duration.d }, `/measures/${measure.index}/chords/${index}/beatOffset`);
      prefix.push(`${chordToken(chord)}/${parts.join('+')}`);
    }
  } else {
    for (const chord of measure.chords) pushAt(chord.beatOffset, chordToken(chord));
  }
  return { prefix, byOffset };
}

function eventDirective(event: InterchangeEvent, path: string): string {
  const value = (text: string) => checkedLineValue(text, path);
  switch (event.kind) {
    case 'keyChange': return `@key: ${value(event.key!)}`;
    case 'tempoChange': return `@tempo: ${event.bpm}`;
    case 'tempoMark': return `@tempo: ${({ ritardando: 'rit.', accelerando: 'accel.', aTempo: 'a tempo', tempoPrimo: 'tempo primo' } as const)[event.mark!]}`;
    case 'timeSignatureChange': return `@time: ${formatTimeSignature({ ...event.timeSignature!, groups: [...event.timeSignature!.groups] })}`;
    case 'feelChange': return `@feel: ${event.feel}`;
    case 'dynamic': return `@dynamic: ${event.dynamic}`;
    case 'rehearsalMark': return `@mark: ${value(event.text!)}`;
    case 'text': return `@text: ${value(event.text!)}`;
    case 'ottavaChange': return `@ottava: ${event.ottava === 'none' ? 'off' : event.ottava}`;
  }
}

function arrangementName(name: string): string {
  return /^[\p{L}_][\p{L}\p{N}_-]*$/u.test(name) ? name : `[${name}]`;
}

function arrangementBlock(entries: readonly InterchangeArrangementEntry[]): string[] {
  if (!entries.length) return [];
  return ['arrangement {', ...entries.map(entry => `  ${arrangementName(checkedLineValue(entry.name, '/arrangement'))}${entry.lyricVerse === undefined ? '' : `(lyr=${entry.lyricVerse})`}${entry.count === 1 ? '' : ` x${entry.count}`}`), '}'];
}

function tuningNames(openMidi: readonly number[], preset?: TuningPreset): string {
  if (preset) return preset;
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const tokens = openMidi.map(midi => {
    const octave = Math.floor(midi / 12) - 1;
    if (octave < 0 || octave > 9) throw new Unrepresentable('tuningPitch', '/metadata/tuning/openMidi', 'Open-string MIDI pitch cannot be expressed in the current tuning header syntax.');
    return `${names[((midi % 12) + 12) % 12]}${octave}`;
  });
  return tokens.join(' ');
}

function metadataLines(score: InterchangeScore): string[] {
  const meta = score.metadata;
  const lines = [
    `title: ${checkedLineValue(meta.title, '/metadata/title')}`,
    `artist: ${checkedLineValue(meta.artist, '/metadata/artist')}`,
    `memo: ${checkedLineValue(meta.memo, '/metadata/memo')}`,
    `key: ${meta.key}`,
    `bpm: ${String(meta.bpm)}`,
    `capo: ${meta.capo}`,
    `tuning: ${tuningNames(meta.tuning.openMidi, meta.tuning.preset)}`,
    `time: ${formatTimeSignature({ ...meta.timeSignature, groups: [...meta.timeSignature.groups] })}`,
    `feel: ${meta.feel}`,
    ...(meta.pickup ? [`pickup: ${noteValueText({ beats: meta.pickup, parts: exactDurationParts(meta.pickup, '/metadata/pickup').map(text => {
      const parsed = parseNoteValueDetailed(text);
      if (typeof parsed === 'string') throw new Unrepresentable('pickupDuration', '/metadata/pickup', 'Pickup duration is not representable.');
      return parsed.parts[0];
    }) })}`] : []),
    `show_rhythm: ${meta.showRhythm}`,
    `measures_per_row: ${meta.measuresPerRow}`,
    `expand_page_break_repeats: ${meta.expandPageBreakRepeats}`
  ];
  const styleNames: Array<[keyof InterchangeScore['metadata']['style'], string]> = [
    ['chordSize', 'style_chord_size'], ['lyricSize', 'style_lyric_size'], ['titleSize', 'style_title_size'],
    ['sectionSize', 'style_section_size'], ['fontSize', 'style_font_size']
  ];
  for (const [key, name] of styleNames) if (meta.style[key] !== undefined) lines.push(`${name}: ${meta.style[key]}`);
  return lines;
}

function serializeSyllable(value: InterchangeSyllable | null): string {
  if (value === null) return '*';
  if (value.extend) return '_';
  if (/[\r\n|()]/.test(value.text)) throw new Unrepresentable('lyricText', '', 'Syllable text cannot be represented safely in the current lyric syntax.');
  if (value.hyphenToNext) {
    if (!/^[A-Za-z0-9'’\-]+$/.test(value.text) || value.text.length === 0) throw new Unrepresentable('lyricHyphen', '', 'Hyphenated syllable text is outside the current lyric token syntax.');
    return `${value.text}-`;
  }
  if (value.text === '') return '()';
  return `(${value.text})`;
}

function melodyGroupLines(measures: readonly InterchangeMeasure[]): string[] {
  if (!measures.length) return [];
  const cells = measures.map(measure => measure.melody!.map((note, index) => melodyNoteText(note, `/measures/${measure.index}/melody/${index}`)).join(' '));
  const lines = [`mel: | ${cells.join(' | ')} |`];
  const verseCount = Math.max(0, ...measures.flatMap(measure => measure.melody!.flatMap(note => note.syllables.map((_value, index) => index + 1))));
  for (let verse = 0; verse < verseCount; verse++) {
    const lyricCells = measures.map(measure => measure.melody!
      .filter(note => !note.isRest && !note.techniques?.grace && !note.tiedFromPrev)
      .map(note => serializeSyllable(note.syllables[verse] ?? null)).join(' '));
    lines.push(`lyr: | ${lyricCells.join(' | ')} |`);
  }
  return lines;
}

function melodyVerseCount(measure: InterchangeMeasure): number {
  return Math.max(0, ...(measure.melody ?? []).flatMap(note => note.syllables.map((_value, index) => index + 1)));
}

function tieContinuesAcross(left: InterchangeMeasure, right: InterchangeMeasure): boolean {
  const previous = left.melody?.at(-1);
  const next = right.melody?.[0];
  const parserWouldMarkContinuation = !!previous?.tieToNext && !!next && !next.isRest && !next.pitches;
  return !!next?.tiedFromPrev === parserWouldMarkContinuation;
}

function tabNoteText(note: InterchangeTabNote, path: string): string {
  const effects = effectText(note.effects, path);
  return `${note.string}${note.dead ? 'x' : `f${note.fret}`}${effects}${note.tieToNext ? '~' : ''}`;
}

function effectValueText(value: InterchangeEffectValue, path: string): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Unrepresentable('invalidEffectValue', path, 'Effect number is not finite.');
    return String(value);
  }
  if (typeof value === 'string') {
    if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(value)) return value;
    if (/["\\\r\n]/.test(value)) throw new Unrepresentable('effectString', path, 'Effect string cannot be quoted safely.');
    return `"${value}"`;
  }
  if (Array.isArray(value)) return `[${value.map((item, index) => effectValueText(item, `${path}/${index}`)).join(',')}]`;
  if ('n' in value && 'd' in value) return `${value.n}/${value.d}`;
  throw new Unrepresentable('effectValue', path, 'Effect value schema is invalid.');
}

function effectText(effects: readonly InterchangeTabEffectCall[], path: string): string {
  if (!effects.length) return '';
  const calls = effects.map((effect, index) => {
    const args = Object.entries(effect.args).map(([key, value]) => `${key}=${effectValueText(value, `${path}/${index}/args/${key}`)}`);
    return args.length ? `${effect.name}(${args.join(',')})` : effect.name;
  });
  return `{${calls.join(',')}}`;
}

function tabBeatText(beat: InterchangeTabBeat, path: string): string {
  const duration = noteValueText(beat.duration);
  let item: string;
  if (beat.isRest) item = 'r';
  else if (beat.notes.length === 1) item = tabNoteText(beat.notes[0], `${path}/notes/0`);
  else item = `[${beat.notes.map((note, index) => tabNoteText(note, `${path}/notes/${index}`)).join(',')}]`;
  const beatEffects = beat.effects.length ? `!{${effectText(beat.effects, `${path}/effects`).slice(1, -1)}}` : '';
  return `${item}/${duration}${beatEffects}`;
}

function tabLyricLines(measures: readonly InterchangeMeasure[], lastTabMeasure: number): string[] {
  const beats = measures.slice(0, lastTabMeasure + 1).flatMap(measure => measure.tabVoices?.[0]?.beats ?? []);
  let verseCount = 0;
  for (const beat of beats) verseCount = Math.max(verseCount, beat.syllables.length);
  const beatTakesSlot: boolean[] = [];
  for (let index = 0; index < beats.length; index++) {
    const beat = beats[index];
    const takes = !beat.isRest && beat.notes.some(note => {
      if (note.dead) return true;
      for (let prior = index - 1; prior >= 0; prior--) {
        const previous = beats[prior];
        if (previous.isRest || previous.notes.length === 0) continue;
        const linked = previous.notes.find(candidate => candidate.string === note.string);
        return !(linked?.tieToNext && linked.fret === note.fret);
      }
      return true;
    });
    beatTakesSlot.push(takes);
  }
  const slots = beats.map((beat, index) => ({ beat, takes: beatTakesSlot[index] })).filter(slot => slot.takes);
  const lines: string[] = [];
  for (let verse = 0; verse < verseCount; verse++) lines.push(`lyr: ${slots.map(slot => serializeSyllable(slot.beat.syllables[verse] ?? null)).join(' ')}`);
  return lines;
}

function barlineClose(measure: InterchangeMeasure): string {
  const b = measure.barline;
  if (b.finalEnd && b.repeatEnd) return ':|]';
  if (b.finalEnd) return '|]';
  if (b.doubleEnd) return '||';
  if (b.repeatEnd) return ':|';
  return '|';
}

function barlineTokens(measure: InterchangeMeasure): string[] {
  const tokens: string[] = [];
  if (measure.barline.bracket) tokens.push(`[${measure.barline.bracket}]`);
  const marks: Record<string, string> = { to_coda: 'to Coda', dc: 'D.C.', ds: 'D.S.', fine: 'Fine', coda: 'Coda', segno: 'Segno' };
  if (measure.barline.specialMark) {
    const value = marks[measure.barline.specialMark];
    if (!value) throw new Unrepresentable('specialMark', `/measures/${measure.index}/barline/specialMark`, 'Navigation mark is not supported by the current GuitarDSL parser.');
    tokens.push(value);
  }
  return tokens;
}

function serializeMeasureBody(measure: InterchangeMeasure): string[] {
  const { prefix: chordPrefix, byOffset } = chordTokensForMeasure(measure);
  const tokens = [...barlineTokens(measure), ...chordPrefix];
  const rhythm = measure.rhythm.events;
  if (measure.rhythm.origin === 'repeat') tokens.push('%');
  if (measure.chordPlacementMode === 'inline') {
    let offset = frac(0);
    if (byOffset.has('0/1')) tokens.push(...byOffset.get('0/1')!);
    for (let index = 0; index < rhythm.length; index++) {
      const event = rhythm[index];
      tokens.push(rhythmEventText(event, `/measures/${measure.index}/rhythm/events/${index}`));
      offset = event.techniques?.grace ? offset : addExactFractions(offset, event.duration.beats, `/measures/${measure.index}/rhythm/events/${index}/duration/beats`);
      const key = `${offset.n}/${offset.d}`;
      if (byOffset.has(key)) tokens.push(...byOffset.get(key)!);
    }
    for (const [key, values] of byOffset) if (!tokens.some(token => values.includes(token)) && key !== '0/1') throw new Unrepresentable('chordOnsetNotBoundary', `/measures/${measure.index}/chords`, 'Inline chord onset is not a rhythm-event boundary.');
  } else if (!(measure.rhythm.origin === 'implicit' || (measure.rhythm.origin === 'repeat' && rhythm.length === 0))) {
    tokens.push(...rhythm.map((event, index) => rhythmEventText(event, `/measures/${measure.index}/rhythm/events/${index}`)));
  }
  if (measure.measureLyric !== undefined) {
    if (/["\r\n]/.test(measure.measureLyric)) throw new Unrepresentable('measureLyric', `/measures/${measure.index}/measureLyric`, 'Measure lyric text cannot be quoted safely.');
    tokens.push(`l:"${measure.measureLyric}"`);
  }
  if (!tokens.length) throw new Unrepresentable('emptyMeasure', `/measures/${measure.index}`, 'A written measure requires at least one token in the current GuitarDSL syntax.');
  const open = measure.barline.repeatStart ? '|:' : '|';
  return [`${open} ${tokens.join(' ')} ${barlineClose(measure)}`];
}

function sectionLyricVerseCount(score: InterchangeScore, measureIndex: number): number {
  let start = measureIndex;
  while (start > 0 && !score.measures[start].sectionStart && !score.measures[start].pageBreakBefore) start--;
  let end = measureIndex + 1;
  while (end < score.measures.length && !score.measures[end].sectionStart && !score.measures[end].pageBreakBefore) end++;
  return Math.max(0, ...score.measures.slice(start, end).flatMap(measure => measure.melody?.flatMap(note => note.syllables.map((_value, index) => index + 1)) ?? []));
}

function resolveExpectedOccurrences(score: InterchangeScore): readonly { occurrenceIndex: number; measureIndex: number; lyricVerse?: number }[] {
  const written: PlayOrderMeasure[] = score.measures.map(measure => ({
    measureIndex: measure.index,
    repeatStart: measure.barline.repeatStart,
    repeatEnd: measure.barline.repeatEnd,
    bracket: measure.barline.bracket,
    specialMark: measure.barline.specialMark,
    sectionName: measure.sectionStart
  }));
  let input: PlayOrderMeasure[] = written;
  if (score.arrangement) {
    const starts = score.measures.flatMap(measure => measure.sectionStart ? [{ name: measure.sectionStart, start: measure.index }] : []);
    const sections = starts.map((section, index) => ({
      ...section,
      end: starts[index + 1]?.start ?? score.measures.length,
      labelSpan: { line: 0, startCol: 0, endCol: 0 },
      lyricVerseCount: Math.max(0, ...score.measures.slice(section.start, starts[index + 1]?.start ?? score.measures.length).flatMap(measure => measure.melody?.flatMap(note => note.syllables.map((_value, verse) => verse + 1)) ?? []))
    }));
    const lowered = lowerArrangement(score.arrangement.map((entry, index) => ({ ...entry, span: { line: 0, startCol: index, endCol: index + 1 }, nameSpan: { line: 0, startCol: index, endCol: index + 1 } })), sections, written);
    if (!lowered.valid) throw new Unrepresentable('invalidArrangement', '/arrangement', 'Arrangement references cannot be resolved.');
    input = lowered.measures;
  }
  const resolved = resolvePlayOrder(input);
  if (!resolved.valid) throw new Unrepresentable('invalidPlayOrder', '/measures', 'Written repeat/navigation structure does not resolve.');
  return resolved.occurrences;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().filter(key => object[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function serialize(score: InterchangeScore): string {
  const output = [...metadataLines(score)];
  for (const definition of score.chordDefinitions) {
    output.push(formatChordDefinition({
      name: definition.name,
      ...(definition.label === undefined ? {} : { label: definition.label }),
      frets: [...definition.frets],
      ...(definition.baseFret === undefined ? {} : { baseFret: definition.baseFret }),
      ...(definition.fingers === undefined ? {} : { fingers: [...definition.fingers] }),
      barres: definition.barres.map(barre => ({ ...barre }))
    } as Omit<ChordDefinition, 'line'>));
  }
  output.push(...arrangementBlock(score.arrangement ?? []));

  let melodyCursor = 0;
  let melodyGroup: InterchangeMeasure[] = [];
  const flushMelody = () => {
    if (!melodyGroup.length) return;
    if (melodyGroup[0].index !== melodyCursor) throw new Unrepresentable('sparseMelody', `/measures/${melodyGroup[0].index}/melody`, `Current GuitarDSL assigns melody to the next unfilled measure in the active section/page (cursor ${melodyCursor}, expected ${melodyGroup[0].index}).`);
    output.push(...melodyGroupLines(melodyGroup));
    melodyCursor += melodyGroup.length;
    melodyGroup = [];
  };
  for (const measure of score.measures) {
    if (measure.pageBreakBefore) {
      flushMelody();
      output.push('pagebreak');
      melodyCursor = measure.index;
    }
    if (measure.sectionStart !== undefined) {
      flushMelody();
      output.push(`[${checkedLineValue(measure.sectionStart, `/measures/${measure.index}/sectionStart`)}]`);
      melodyCursor = measure.index;
    }
    if (!measure.melody?.length) flushMelody();
    for (const event of measure.eventsBefore) output.push(eventDirective(event, `/measures/${measure.index}/eventsBefore`));
    output.push(...serializeMeasureBody(measure));
    if (measure.melody?.length) {
      if (melodyGroup.length) {
        const previous = melodyGroup[melodyGroup.length - 1];
        if (previous.index + 1 !== measure.index || melodyVerseCount(previous) !== melodyVerseCount(measure) || !tieContinuesAcross(previous, measure)) flushMelody();
      }
      melodyGroup.push(measure);
    }
  }
  flushMelody();

  let lastTabMeasure = -1;
  for (let index = 0; index < score.measures.length; index++) if (score.measures[index].tabVoices?.length) lastTabMeasure = index;
  if (lastTabMeasure >= 0) {
    for (let index = 0; index <= lastTabMeasure; index++) {
      if (score.measures[index].tabVoices?.length !== 1 || score.measures[index].tabVoices?.[0].voice !== 1) throw new Unrepresentable('sparseTab', `/measures/${index}/tabVoices`, 'Current GuitarDSL TAB assignment fills the next unassigned written measure, so gaps cannot be encoded without adding a TAB part.');
    }
    const cells = score.measures.slice(0, lastTabMeasure + 1).map(measure => {
      const voice = measure.tabVoices![0];
      const beats = voice.beats.map((beat, index) => tabBeatText(beat, `/measures/${measure.index}/tabVoices/0/beats/${index}`));
      if (!beats.length) throw new Unrepresentable('emptyTabCell', `/measures/${measure.index}/tabVoices/0/beats`, 'An empty TAB cell cannot be distinguished from an absent cell in the current syntax.');
      return beats.join(' ');
    });
    output.push(`tab: | ${cells.join(' | ')} |`);
    output.push(...tabLyricLines(score.measures, lastTabMeasure));
  }
  return output.join('\n');
}

/** Emits canonical uncompressed GuitarDSL and proves semantic and execution-order equality by reparsing. */
export function interchangeToGuitarDsl(score: InterchangeScore, priorLoss?: InterchangeLossReport): InterchangeResult<string> {
  let loss: InterchangeLossReport;
  try { loss = mergeLossReports(priorLoss ?? emptyLossReport()); }
  catch (error) {
    const detail = error instanceof Error ? error.message : 'Loss report is invalid.';
    return fail('invalidIr', emptyLossReport(), [{ code: 'invalidLossReport', path: '/loss', detail }]);
  }
  if (hasBlockingLoss(loss)) return fail('unrepresentableValue', loss, [{ code: 'blockingLoss', path: '/loss/entries', detail: 'A prior unsupported loss blocks canonical GuitarDSL output.' }]);
  const validation = validateInterchangeScore(score);
  if (validation.length) return fail('invalidIr', loss, validation);
  let expectedOccurrences: ReturnType<typeof resolveExpectedOccurrences>;
  let source: string;
  try {
    expectedOccurrences = resolveExpectedOccurrences(score);
    source = serialize(score);
  } catch (error) {
    if (error instanceof Unrepresentable) return fail('unrepresentableValue', loss, [{ code: error.code, path: error.path, detail: error.message }]);
    throw error;
  }
  const parsed = parseGuitarDsl(source);
  const arrangementScan = scanArrangementBlockLines(source.split(/\r?\n/));
  const errors = parsed.diagnostics.filter(item => item.severity === 'error');
  if (errors.length) return fail('semanticMismatch', loss, [{ code: 'canonicalSourceRejected', path: '', detail: 'Canonical GuitarDSL produced parser error diagnostics.' }], errors);
  if (!parsed.playOrder.valid) return fail('invalidPlayOrder', loss, [{ code: 'invalidPlayOrder', path: '/measures', detail: 'Reparsed source has no valid complete execution sequence.' }], parsed.diagnostics);
  const reparsed = parsedScoreToInterchange(parsed, arrangementScan);
  if (!reparsed.ok) return fail('semanticMismatch', loss, reparsed.errors, reparsed.diagnostics);
  const mismatch = interchangeSemanticMismatch(score, reparsed.value);
  const sameScore = mismatch === undefined;
  const sameOccurrences = canonical(expectedOccurrences) === canonical(parsed.playOrder.occurrences.map(({ occurrenceIndex, measureIndex, lyricVerse }) => ({ occurrenceIndex, measureIndex, ...(lyricVerse === undefined ? {} : { lyricVerse }) })));
  if (!sameScore || !sameOccurrences) {
    return fail('semanticMismatch', loss, [mismatch ?? { code: 'semanticProjectionMismatch', path: '/playOrder/occurrences', detail: 'Resolved play-order occurrences differ after canonical serialization.' }], parsed.diagnostics);
  }
  return { ok: true, value: source, loss, warnings: parsed.diagnostics.filter(item => item.severity === 'warning').map(item => ({ ...item, ...(item.args ? { args: { ...item.args } } : {}) })) };
}
