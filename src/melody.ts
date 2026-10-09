// Parsing of `mel:` note tokens and `lyr:` syllable lines (see docs/specs/guitardsl-syntax.md §12, §13).

import { Fraction, NoteValuePart, ZERO, decomposeBeats, parseBeats, parseNoteValueDetailed } from './duration';

export type PitchStep = 'c' | 'd' | 'e' | 'f' | 'g' | 'a' | 'b';

export interface Pitch {
  step: PitchStep;
  alter: -1 | 0 | 1;
  octave: number;
}

export interface Syllable {
  text: string;
  /** English word continues on the next syllable (`sun-`). */
  hyphenToNext: boolean;
  /** Melisma (`_`): extends the previous syllable over this note. */
  extend: boolean;
}

export type ConnectionTechnique = 'hammer' | 'pull' | 'slide' | 'gliss';

/** Structured technique block of a note (`{hammer,bend:2}`, spec §12.2.1); absent keys = not set. */
export interface NoteTechniques {
  /** Connects this note to the next sounding non-grace note. */
  connection?: ConnectionTechnique;
  /** Bend amount in semitones (0.5 steps, 0.5..4); notation only. */
  bend?: number;
  vibrato?: boolean;
  staccato?: boolean;
  tenuto?: boolean;
  fermata?: boolean;
  breath?: boolean;
  grace?: boolean;
  slurStart?: boolean;
  slurEnd?: boolean;
  palmMute?: boolean;
  letRing?: boolean;
}

const FLAG_TECHNIQUES: Record<string, keyof NoteTechniques> = {
  vibrato: 'vibrato',
  staccato: 'staccato',
  tenuto: 'tenuto',
  fermata: 'fermata',
  breath: 'breath',
  grace: 'grace',
  'slur-start': 'slurStart',
  'slur-end': 'slurEnd',
  pm: 'palmMute',
  'let-ring': 'letRing'
};
const CONNECTIONS: readonly string[] = ['hammer', 'pull', 'slide', 'gliss'];

/**
 * Parses the inside of a technique block (`hammer`, `bend:2,vibrato`). Unknown names, duplicates,
 * two connections, slur-start with slur-end, or a bend outside 0.5..4 (0.5 steps) are invalid.
 */
export function parseTechniqueBlock(body: string): NoteTechniques | 'invalidTechnique' {
  const tech: NoteTechniques = {};
  const seen = new Set<string>();
  for (const raw of body.split(',')) {
    const item = raw.trim().toLowerCase();
    const bend = item.match(/^bend:([0-9]+(?:\.[0-9]+)?)$/);
    const name = bend ? 'bend' : item;
    if (!name || seen.has(name)) return 'invalidTechnique';
    seen.add(name);
    if (bend) {
      const amount = Number(bend[1]);
      if (!(amount >= 0.5 && amount <= 4) || !Number.isInteger(amount * 2)) return 'invalidTechnique';
      tech.bend = amount;
    } else if (CONNECTIONS.includes(name)) {
      if (tech.connection) return 'invalidTechnique';
      tech.connection = name as ConnectionTechnique;
    } else if (FLAG_TECHNIQUES[name]) {
      (tech as Record<string, unknown>)[FLAG_TECHNIQUES[name]] = true;
    } else {
      return 'invalidTechnique';
    }
  }
  if (tech.slurStart && tech.slurEnd) return 'invalidTechnique';
  return tech;
}

/** True when any technique other than fermata / breath is set (those need a sounding pitch). */
export function needsPitch(tech: NoteTechniques): boolean {
  return Object.keys(tech).some(k => k !== 'fermata' && k !== 'breath');
}

export function isGrace(note: { techniques?: NoteTechniques }): boolean {
  return note.techniques?.grace === true;
}

export interface MelodyNote {
  isRest: boolean;
  /** Single pitch; undefined for rests and note groups. */
  pitch?: Pitch;
  /** Simultaneous note group (`[c4,e4,g4]/4`, spec §18): two or more pitches, `pitch` undefined. */
  pitches?: Pitch[];
  parts: NoteValuePart[];
  /** Rhythmic length; 0 for grace notes (their `parts` only shape the glyph). */
  beats: Fraction;
  techniques?: NoteTechniques;
  tieToNext: boolean;
  /** Set on the note that a preceding `~` ties into; it takes no syllable. */
  tiedFromPrev: boolean;
  /** Syllable per verse (index 0 = verse 1); null / undefined = no lyric. */
  syllables: (Syllable | null)[];
}

export interface MelodyLength {
  parts: NoteValuePart[];
  beats: Fraction;
}

export interface MelodyTokenState {
  octave?: number;
  length?: MelodyLength;
}

export type MelodyTokenError =
  | 'upperCaseNoteName'
  | 'invalidMelodyNote'
  | 'invalidLength'
  | 'missingInitialOctaveOrLength'
  | 'invalidTuplet'
  | 'invalidTechnique'
  | 'techniqueRequiresPitch'
  | 'invalidNoteGroup'
  | 'unsupportedNoteGroupTechnique';

const NOTE_RE = /^([a-gA-G])([#b]?)([0-9])?(?:\/(.+)|:([^/]+))?$/;
const REST_RE = /^r(?:\/(.+)|:([^/]+))?$/;
// Technique block: `{` + a name (letter first; a tuplet ratio starts with a digit) + `}` at the end.
const TECHNIQUE_BLOCK_RE = /\{([A-Za-z][^{}]*)\}$/;
/** Grace notes without a written length are drawn as eighths. */
const GRACE_DEFAULT_PARTS: NoteValuePart[] = [{ base: 8, dotted: false }];

function parseLength(noteValue: string | undefined, beats: string | undefined): MelodyLength | 'invalidLength' | 'invalidTuplet' | undefined {
  if (noteValue !== undefined) {
    const v = parseNoteValueDetailed(noteValue);
    if (v === 'invalidTuplet') return 'invalidTuplet';
    return v === 'invalid' ? 'invalidLength' : { parts: v.parts, beats: v.beats };
  }
  if (beats !== undefined) {
    const b = parseBeats(beats);
    const parts = b ? decomposeBeats(b) : null;
    return b && parts ? { parts, beats: b } : 'invalidLength';
  }
  return undefined;
}

/** Length of the pitch part (`c#4`) at the start of a note token; 0 for rests / non-notes. */
export function pitchTextLength(tok: string): number {
  return tok.match(/^[a-gA-G][#b]?[0-9]?/)?.[0].length ?? 0;
}

/**
 * Parses one melody token. Octave and length are inherited from `state` (the previous token of the
 * same `mel:` line) and `state` is updated on success. Grace notes update the octave but neither
 * use nor change the inherited length.
 */
export function parseMelodyToken(tok: string, state: MelodyTokenState): MelodyNote | MelodyTokenError {
  let body = tok;
  const tieToNext = body.endsWith('~');
  if (tieToNext) body = body.slice(0, -1);
  let techniques: NoteTechniques | undefined;
  const block = body.match(TECHNIQUE_BLOCK_RE);
  if (block) {
    const parsed = parseTechniqueBlock(block[1]);
    if (parsed === 'invalidTechnique') return 'invalidTechnique';
    techniques = parsed;
    body = body.slice(0, block.index);
  }
  const grace = techniques?.grace === true;

  const rest = body.match(REST_RE);
  if (rest) {
    if (tieToNext) return 'invalidMelodyNote';
    const len = parseLength(rest[1], rest[2]);
    if (typeof len === 'string') return len;
    if (techniques && needsPitch(techniques)) return 'techniqueRequiresPitch';
    const length = len ?? state.length;
    if (!length) return 'missingInitialOctaveOrLength';
    state.length = length;
    const note: MelodyNote = { isRest: true, parts: length.parts, beats: length.beats, tieToNext: false, tiedFromPrev: false, syllables: [] };
    if (techniques) note.techniques = techniques;
    return note;
  }

  const m = body.match(NOTE_RE);
  if (!m) return 'invalidMelodyNote';
  if (m[1] !== m[1].toLowerCase()) return 'upperCaseNoteName';

  const len = parseLength(m[4], m[5]);
  if (typeof len === 'string') return len;
  const octave = m[3] !== undefined ? Number(m[3]) : state.octave;
  const length = grace ? (len ?? { parts: GRACE_DEFAULT_PARTS, beats: ZERO }) : (len ?? state.length);
  if (octave === undefined || !length) return 'missingInitialOctaveOrLength';
  state.octave = octave;
  if (!grace) state.length = length;

  const note: MelodyNote = {
    isRest: false,
    pitch: { step: m[1] as PitchStep, alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, octave },
    parts: length.parts,
    beats: grace ? ZERO : length.beats,
    tieToNext,
    tiedFromPrev: false,
    syllables: []
  };
  if (techniques) note.techniques = techniques;
  return note;
}

const GROUP_RE = /^\[([^[\]]*)\](.*)$/;
const GROUP_MEMBER_RE = /^([a-gA-G])([#b]?)([0-9])$/;
const GROUP_LENGTH_RE = /^(?:\/(.+)|:([^/]+))$/;

/** A parsed note group and the column offset / length of each member's pitch text within the token. */
export interface NoteGroupToken {
  note: MelodyNote;
  members: { offset: number; length: number }[];
}

/**
 * Parses a simultaneous note group `[c4,e4,g4]/4{staccato}` (spec §18). Members need an explicit octave,
 * the shared length is mandatory and only group-level techniques are allowed (no connection, bend or slur).
 * A trailing tie applies to the complete group. Never reads nor updates the single-note inheritance state.
 */
export function parseNoteGroupToken(tok: string): NoteGroupToken | MelodyTokenError {
  const tieToNext = tok.endsWith('~');
  if (tieToNext) tok = tok.slice(0, -1);
  const m = tok.match(GROUP_RE);
  if (!m) return 'invalidNoteGroup';
  let tail = m[2];
  let techniques: NoteTechniques | undefined;
  const block = tail.match(TECHNIQUE_BLOCK_RE);
  if (block) {
    const parsed = parseTechniqueBlock(block[1]);
    if (parsed === 'invalidTechnique') return 'invalidTechnique';
    if (parsed.connection || parsed.bend !== undefined || parsed.slurStart || parsed.slurEnd) return 'unsupportedNoteGroupTechnique';
    techniques = parsed;
    tail = tail.slice(0, block.index);
  }

  const pitches: Pitch[] = [];
  const members: { offset: number; length: number }[] = [];
  let offset = 1;
  for (const text of m[1].split(',')) {
    const pm = text.match(GROUP_MEMBER_RE);
    if (!pm) return 'invalidNoteGroup';
    if (pm[1] !== pm[1].toLowerCase()) return 'upperCaseNoteName';
    const pitch: Pitch = { step: pm[1] as PitchStep, alter: pm[2] === '#' ? 1 : pm[2] === 'b' ? -1 : 0, octave: Number(pm[3]) };
    if (pitches.some(p => p.step === pitch.step && p.alter === pitch.alter && p.octave === pitch.octave)) return 'invalidNoteGroup';
    pitches.push(pitch);
    members.push({ offset, length: text.length });
    offset += text.length + 1;
  }
  if (pitches.length < 2) return 'invalidNoteGroup';

  const lm = tail.match(GROUP_LENGTH_RE);
  if (!lm) return 'invalidNoteGroup';
  const length = parseLength(lm[1], lm[2]);
  if (length === undefined) return 'invalidNoteGroup';
  if (typeof length === 'string') return length;

  const grace = techniques?.grace === true;
  const note: MelodyNote = {
    isRest: false,
    pitches,
    parts: length.parts,
    beats: grace ? ZERO : length.beats,
    tieToNext,
    tiedFromPrev: false,
    syllables: []
  };
  if (techniques) note.techniques = techniques;
  return { note, members };
}

export type LyricItem =
  | { kind: 'syllable'; text: string; hyphenToNext: boolean }
  | { kind: 'extend' }
  | { kind: 'skip' }
  | { kind: 'bar' };

// Exactly the small kana that §13.2 joins to the preceding Japanese syllable.
const JOINING_SMALL_KANA = new Set('ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ');
// Punctuation that attaches to the preceding syllable instead of taking a note.
const TRAILING_PUNCT = new Set('、。，．！？!?,.」』)）'.split(''));
const JAPANESE_LYRIC_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export function isJoiningSmallKana(ch: string): boolean {
  return JOINING_SMALL_KANA.has(ch);
}

function isJapaneseLyricChar(ch: string): boolean {
  return JAPANESE_LYRIC_CHAR.test(ch);
}

function isAsciiWordChar(ch: string): boolean {
  return /[A-Za-z0-9'’\-]/.test(ch);
}

/** Splits the text after `lyr:` into syllables and markers (§13.2). */
export function tokenizeLyrics(text: string): LyricItem[] {
  const items: LyricItem[] = [];
  const rawSegments = text.split(/(\|)/);

  for (const seg of rawSegments) {
    if (seg === '|') {
      items.push({ kind: 'bar' });
      continue;
    }

    const chars = Array.from(seg);
    let lastSyllableIndex: number | null = null;
    let lastJapaneseSyllableIndex: number | null = null;
    let i = 0;

    const pushSyllable = (value: string, hyphenToNext = false, japanese = false) => {
      items.push({ kind: 'syllable', text: value, hyphenToNext });
      lastSyllableIndex = items.length - 1;
      lastJapaneseSyllableIndex = japanese ? lastSyllableIndex : null;
    };

    while (i < chars.length) {
      const ch = chars[i];
      if (/\s/.test(ch)) {
        lastSyllableIndex = null;
        lastJapaneseSyllableIndex = null;
        i++;
        continue;
      }
      if (ch === '_') {
        items.push({ kind: 'extend' });
        lastSyllableIndex = null;
        lastJapaneseSyllableIndex = null;
        i++;
        continue;
      }
      if (ch === '*') {
        items.push({ kind: 'skip' });
        lastSyllableIndex = null;
        lastJapaneseSyllableIndex = null;
        i++;
        continue;
      }
      if (ch === '(' || ch === '（') {
        const close = ch === '(' ? ')' : '）';
        let j = i + 1;
        let group = '';
        while (j < chars.length && chars[j] !== close) {
          group += chars[j];
          j++;
        }
        pushSyllable(group.trim());
        lastJapaneseSyllableIndex = null;
        i = j < chars.length ? j + 1 : j;
        continue;
      }

      if (isAsciiWordChar(ch)) {
        let word = '';
        while (i < chars.length && (isAsciiWordChar(chars[i]) || TRAILING_PUNCT.has(chars[i]))) {
          word += chars[i];
          i++;
        }
        const hyphen = word.length > 1 && word.endsWith('-');
        pushSyllable(hyphen ? word.slice(0, -1) : word, hyphen);
        continue;
      }

      if (TRAILING_PUNCT.has(ch) && lastSyllableIndex !== null) {
        const previous = items[lastSyllableIndex];
        if (previous.kind === 'syllable') {
          previous.text += ch;
          i++;
          continue;
        }
      }

      if (isJoiningSmallKana(ch) && lastJapaneseSyllableIndex !== null) {
        const previous = items[lastJapaneseSyllableIndex];
        if (previous.kind === 'syllable') {
          previous.text += ch;
          i++;
          continue;
        }
      }

      pushSyllable(ch, false, isJapaneseLyricChar(ch));
      i++;
    }
  }

  return items;
}

/** A melody note takes a syllable unless it is a rest or a grace note. */
export function takesSyllable(note: MelodyNote): boolean {
  return !note.isRest && !isGrace(note);
}
