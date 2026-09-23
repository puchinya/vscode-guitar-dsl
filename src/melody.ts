// Parsing of `mel:` note tokens and `lyr:` syllable lines (see docs/specs/guitardsl-syntax.md §12, §13).

import { Fraction, NoteValuePart, decomposeBeats, parseBeats, parseNoteValue } from './duration';

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

export interface MelodyNote {
  isRest: boolean;
  pitch?: Pitch;
  parts: NoteValuePart[];
  beats: Fraction;
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

export type MelodyTokenError = 'upperCaseNoteName' | 'invalidMelodyNote' | 'invalidLength' | 'missingInitialOctaveOrLength';

const NOTE_RE = /^([a-gA-G])([#b]?)([0-9])?(?:\/([^:~]+)|:([^/~]+))?(~)?$/;
const REST_RE = /^r(?:\/([^:~]+)|:([^/~]+))?$/;

function parseLength(noteValue: string | undefined, beats: string | undefined): MelodyLength | null | undefined {
  if (noteValue !== undefined) {
    const v = parseNoteValue(noteValue);
    return v ? { parts: v.parts, beats: v.beats } : null;
  }
  if (beats !== undefined) {
    const b = parseBeats(beats);
    const parts = b ? decomposeBeats(b) : null;
    return b && parts ? { parts, beats: b } : null;
  }
  return undefined;
}

/**
 * Parses one melody token. Octave and length are inherited from `state` (the previous token of the
 * same `mel:` line) and `state` is updated on success.
 */
export function parseMelodyToken(tok: string, state: MelodyTokenState): MelodyNote | MelodyTokenError {
  const rest = tok.match(REST_RE);
  if (rest) {
    const len = parseLength(rest[1], rest[2]);
    if (len === null) return 'invalidLength';
    const length = len ?? state.length;
    if (!length) return 'missingInitialOctaveOrLength';
    state.length = length;
    return { isRest: true, parts: length.parts, beats: length.beats, tieToNext: false, tiedFromPrev: false, syllables: [] };
  }

  const m = tok.match(NOTE_RE);
  if (!m) return 'invalidMelodyNote';
  if (m[1] !== m[1].toLowerCase()) return 'upperCaseNoteName';

  const len = parseLength(m[4], m[5]);
  if (len === null) return 'invalidLength';
  const octave = m[3] !== undefined ? Number(m[3]) : state.octave;
  const length = len ?? state.length;
  if (octave === undefined || !length) return 'missingInitialOctaveOrLength';
  state.octave = octave;
  state.length = length;

  return {
    isRest: false,
    pitch: { step: m[1] as PitchStep, alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, octave },
    parts: length.parts,
    beats: length.beats,
    tieToNext: m[6] === '~',
    tiedFromPrev: false,
    syllables: []
  };
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

/** A note is sung (takes a syllable) unless it is a rest or the continuation of a tie. */
export function takesSyllable(note: MelodyNote): boolean {
  return !note.isRest && !note.tiedFromPrev;
}
