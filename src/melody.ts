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
  pitch?: Pitch;
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
  | 'techniqueRequiresPitch';

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

export type LyricItem =
  | { kind: 'syllable'; text: string; hyphenToNext: boolean }
  | { kind: 'extend' }
  | { kind: 'skip' }
  | { kind: 'bar' };

// Small kana, sokuon (っ) and chouon (ー) that join the preceding character into one mora.
const SMALL_KANA = new Set('ゃゅょぁぃぅぇぉゎっヵヶャュョァィゥェォヮッー'.split(''));
// Punctuation that attaches to the preceding syllable instead of taking a note.
const TRAILING_PUNCT = new Set('、。，．！？!?,.」』)）'.split(''));

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

    const trimmed = seg.trim();
    if (!trimmed) continue;

    // When the segment contains whitespace between tokens, whitespace delimits syllables.
    const hasSpace = /\s/.test(trimmed);

    if (hasSpace) {
      const chars = Array.from(trimmed);
      let i = 0;
      while (i < chars.length) {
        const ch = chars[i];
        if (/\s/.test(ch)) {
          i++;
          continue;
        }
        if (ch === '_') {
          items.push({ kind: 'extend' });
          i++;
          continue;
        }
        if (ch === '*') {
          items.push({ kind: 'skip' });
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
          items.push({ kind: 'syllable', text: group.trim(), hyphenToNext: false });
          i = j + 1;
          continue;
        }

        let word = '';
        while (i < chars.length && !/\s/.test(chars[i]) && chars[i] !== '(' && chars[i] !== '（') {
          word += chars[i];
          i++;
        }
        if (word === '_') {
          items.push({ kind: 'extend' });
        } else if (word === '*') {
          items.push({ kind: 'skip' });
        } else if (word.length > 0) {
          const hyphen = word.length > 1 && word.endsWith('-');
          items.push({ kind: 'syllable', text: hyphen ? word.slice(0, -1) : word, hyphenToNext: hyphen });
        }
      }
    } else {
      // Unspaced text: split character by character with small kana / ー / っ joining
      const chars = Array.from(trimmed);
      let i = 0;
      while (i < chars.length) {
        const ch = chars[i];
        if (ch === '_') {
          items.push({ kind: 'extend' });
          i++;
          continue;
        }
        if (ch === '*') {
          items.push({ kind: 'skip' });
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
          items.push({ kind: 'syllable', text: group.trim(), hyphenToNext: false });
          i = j + 1;
          continue;
        }

        if (isAsciiWordChar(ch)) {
          let word = '';
          while (i < chars.length && (isAsciiWordChar(chars[i]) || TRAILING_PUNCT.has(chars[i]))) {
            word += chars[i];
            i++;
          }
          const hyphen = word.length > 1 && word.endsWith('-');
          items.push({ kind: 'syllable', text: hyphen ? word.slice(0, -1) : word, hyphenToNext: hyphen });
          continue;
        }

        if ((SMALL_KANA.has(ch) || TRAILING_PUNCT.has(ch)) && items.length > 0 && items[items.length - 1].kind === 'syllable') {
          const prev = items[items.length - 1] as { kind: 'syllable'; text: string };
          prev.text += ch;
          i++;
          continue;
        }

        items.push({ kind: 'syllable', text: ch, hyphenToNext: false });
        i++;
      }
    }
  }

  return items;
}

/** A note is sung (takes a syllable) unless it is a rest, a grace note or the continuation of a tie. */
export function takesSyllable(note: MelodyNote): boolean {
  return !note.isRest && !note.tiedFromPrev && !isGrace(note);
}
