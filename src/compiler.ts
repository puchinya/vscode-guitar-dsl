// GuitarDSL compiler front-end: parses DSL text into the score AST (ParsedScore).
// Rendering (SVG / HTML / PDF) lives in src/render and src/pdf.ts.

import { Fraction, ZERO, fadd, feq, fnum, frac, parseBeats, parseNoteValue, parseRhythmDuration } from './duration';
import { MelodyNote, MelodyTokenState, parseMelodyToken, takesSyllable, tokenizeLyrics } from './melody';
import { CHORD_LABEL_PATTERN, CHORD_NAME_PATTERN, ChordDefinition, chordKey, isChordDefinitionLine, parseChordDefinition } from './chordDefinition';

export type { MelodyNote, Pitch, Syllable } from './melody';
export type { ChordDefinition } from './chordDefinition';

export interface RhythmItem {
  duration: string; // '4', '8', '16', '2', '1', 'w', 'h', 'q', '8t', '4+8', 'r...'
  isRest: boolean;
  down: boolean;
  up: boolean;
  ghost: boolean;
  accent: boolean;
  tie: boolean;
  inlineLyric?: string;
}

export interface ChordPlacement {
  /** Displayed chord name (without the `@label`). */
  name: string;
  beat: number;
  /** Diagram variant label from `name@label` (spec §7.4). */
  label?: string;
}

export interface MeasureData {
  chord: string;
  chords: ChordPlacement[];
  isMeasureRepeat?: boolean;
  repeatStart: boolean;
  repeatEnd: boolean;
  doubleEnd: boolean;
  finalEnd?: boolean;
  bracket?: string; // '1.', '2.'
  specialMark?: string; // 'segno', 'coda', 'fine', 'to_coda', 'dc', 'ds'
  sectionName?: string;
  rhythms: RhythmItem[];
  lyric: string;
  /** Melody assigned by a `mel:` line; undefined when the measure has no melody. */
  melody?: MelodyNote[];
}

export type DiagnosticSeverity = 'error' | 'warning';

export type DiagnosticCode =
  | 'upperCaseNoteName'
  | 'invalidMelodyNote'
  | 'invalidLength'
  | 'missingInitialOctaveOrLength'
  | 'tooManyMelodyMeasures'
  | 'melodyRepeatWithoutPrevious'
  | 'lyricsWithoutMelody'
  | 'beatCountMismatch'
  | 'syllableCountMismatch'
  | 'lyricBarMismatch'
  | 'measureLyricWithMelody'
  | 'invalidMeasuresPerRow'
  | 'invalidChordDefinition'
  | 'duplicateChordDefinition'
  | 'unknownChordVariant';

export interface ScoreDiagnostic {
  /** 0-based line index in the source text. */
  line: number;
  /** 0-based column range [startCol, endCol). */
  startCol: number;
  endCol: number;
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  args?: Record<string, string | number>;
}

const DIAGNOSTIC_SEVERITY: Record<DiagnosticCode, DiagnosticSeverity> = {
  upperCaseNoteName: 'error',
  invalidMelodyNote: 'error',
  invalidLength: 'error',
  missingInitialOctaveOrLength: 'error',
  tooManyMelodyMeasures: 'error',
  melodyRepeatWithoutPrevious: 'error',
  lyricsWithoutMelody: 'error',
  beatCountMismatch: 'warning',
  syllableCountMismatch: 'warning',
  lyricBarMismatch: 'warning',
  measureLyricWithMelody: 'warning',
  invalidMeasuresPerRow: 'warning',
  invalidChordDefinition: 'error',
  duplicateChordDefinition: 'warning',
  unknownChordVariant: 'warning'
};

/** Beats of a rhythm token duration ('4', 'q', '8t', '4+8', 'r8', ...). Unknown durations count as 1 beat. */
export function parseDurationToBeats(durationStr: string): number {
  const value = parseRhythmDuration(durationStr);
  return value ? fnum(value.beats) : 1;
}

function rhythmBeatsFraction(durationStr: string): Fraction {
  const value = parseRhythmDuration(durationStr);
  return value ? value.beats : frac(1);
}

// Optional `@label` selects a diagram variant (§7.4). Length: ':' = beat count (legacy), '/' followed by a digit = note value.
const CHORD_TOKEN_RE = new RegExp(`^(${CHORD_NAME_PATTERN})(?:@(${CHORD_LABEL_PATTERN}))?(?::([0-9][0-9.]*)|\\/([0-9][0-9.t+]*))?$`);

interface ParsedChordToken {
  name: string;
  label?: string;
  duration?: Fraction;
  invalidLength?: boolean;
}

function parseChordToken(tok: string): ParsedChordToken | null {
  const match = tok.match(CHORD_TOKEN_RE);
  if (!match) return null;
  const base = { name: match[1], label: match[2] };
  if (match[3] !== undefined) {
    const beats = parseBeats(match[3]);
    return beats ? { ...base, duration: beats } : { ...base, invalidLength: true };
  }
  if (match[4] !== undefined) {
    const value = parseNoteValue(match[4]);
    return value ? { ...base, duration: value.beats } : { ...base, invalidLength: true };
  }
  return base;
}

const MAJOR_KEY_SIGNATURES: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7
};
const MINOR_KEY_SIGNATURES: Record<string, number> = {
  A: 0, E: 1, B: 2, 'F#': 3, 'C#': 4, 'G#': 5, 'D#': 6, 'A#': 7,
  D: -1, G: -2, C: -3, F: -4, Bb: -5, Eb: -6, Ab: -7
};

/** Number of sharps (positive) or flats (negative) for a `key:` value, or null when it cannot be parsed. */
export function parseKeySignature(key: string): number | null {
  const m = key.trim().match(/^([A-G][b#]?)(m)?$/);
  if (!m) return null;
  const table = m[2] ? MINOR_KEY_SIGNATURES : MAJOR_KEY_SIGNATURES;
  return table[m[1]] ?? null;
}

export const DEFAULT_MEASURES_PER_ROW = 4;
const MAX_MEASURES_PER_ROW = 8;

export interface ScoreStyle {
  chordSize?: number;
  lyricSize?: number;
  titleSize?: number;
  sectionSize?: number;
  fontSize?: number;
}

export interface ScorePage {
  pageNumber: number;
  measures: MeasureData[];
}

export interface ParsedScore {
  title: string;
  artist: string;
  capo: string;
  originalKey: string;
  bpm: string;
  memo: string;
  style: ScoreStyle;
  /** Diagram keys (`name` or `name@label`) in order of first use. */
  usedChords: string[];
  /** `chord` definitions in source order (first definition of a key wins). */
  chordDefinitions: ChordDefinition[];
  measures: MeasureData[];
  pages: ScorePage[];
  /** Sharps (> 0) / flats (< 0) derived from `key:`; null when the key cannot be parsed. */
  keySignature: number | null;
  showRhythm: boolean;
  measuresPerRow: number;
  diagnostics: ScoreDiagnostic[];
}

const WHOLE_MEASURE = frac(4);

/** A `mel:` line: the notes it produced (in order) and the note index range of each cell. */
interface MelodyGroup {
  notes: MelodyNote[];
  cellRanges: { start: number; end: number }[];
  verseCount: number;
}

export function parseGuitarDsl(dslContent: string): ParsedScore {
  const lines = dslContent.split(/\r?\n/);

  let title = 'Guitar Rhythm Score';
  let artist = '';
  let capo = '0';
  let originalKey = 'C';
  let bpm = '90';
  let memo = '';
  let showRhythm = true;
  let measuresPerRow = DEFAULT_MEASURES_PER_ROW;
  const style: ScoreStyle = {};
  const diagnostics: ScoreDiagnostic[] = [];

  const measures: MeasureData[] = [];
  const pages: ScorePage[] = [{ pageNumber: 1, measures: [] }];
  let currentPageIndex = 0;
  let currentSection = '';
  const usedChordsSet = new Set<string>();
  const chordDefinitions: ChordDefinition[] = [];
  const chordUses: { key: string; line: number; startCol: number; endCol: number }[] = [];

  // Index of the first measure that has not received a melody yet (§12.3).
  let melodyCursor = 0;
  let lastMelodyGroup: MelodyGroup | null = null;

  const report = (lineIdx: number, startCol: number, endCol: number, code: DiagnosticCode, args?: Record<string, string | number>) => {
    diagnostics.push({ line: lineIdx, startCol, endCol: Math.max(endCol, startCol + 1), severity: DIAGNOSTIC_SEVERITY[code], code, args });
  };

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx];
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const lineStart = rawLine.indexOf(line);
    const lineEnd = lineStart + line.length;

    // Page break: --- or pagebreak
    if (/^---+$/.test(line) || /^pagebreak$/i.test(line)) {
      if (pages[currentPageIndex].measures.length > 0) {
        currentPageIndex++;
        pages.push({ pageNumber: currentPageIndex + 1, measures: [] });
      }
      melodyCursor = measures.length;
      lastMelodyGroup = null;
      continue;
    }

    // Chord diagram definition: chord C@barre = x35553 base:3
    if (isChordDefinitionLine(line)) {
      const result = parseChordDefinition(line);
      if (!result.ok) {
        report(lineIdx, lineStart, lineEnd, 'invalidChordDefinition', { reason: result.error, detail: result.detail });
      } else {
        const key = chordKey(result.definition.name, result.definition.label);
        if (chordDefinitions.some(d => chordKey(d.name, d.label) === key)) {
          report(lineIdx, lineStart, lineEnd, 'duplicateChordDefinition', { chord: key });
        } else {
          chordDefinitions.push({ ...result.definition, line: lineIdx });
        }
      }
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(title|artist|capo|key|original_key|tempo|bpm|memo|show_rhythm|rhythm|measures_per_row|bars_per_row|(?:style_)?(?:chord_size|lyric_size|title_size|section_size|font_size)):\s*(.*)$/i);
    if (headerMatch) {
      const key = headerMatch[1].toLowerCase().replace(/^style_/, '');
      const val = headerMatch[2].trim();
      if (key === 'title') title = val;
      else if (key === 'artist') artist = val;
      else if (key === 'capo') capo = val;
      else if (key === 'key' || key === 'original_key') originalKey = val;
      else if (key === 'bpm' || key === 'tempo') bpm = val;
      else if (key === 'memo') memo = val;
      else if (key === 'show_rhythm' || key === 'rhythm') {
        const v = val.toLowerCase();
        if (['false', 'off', 'no', '0'].includes(v)) showRhythm = false;
        else if (['true', 'on', 'yes', '1'].includes(v)) showRhythm = true;
      } else if (key === 'measures_per_row' || key === 'bars_per_row') {
        const n = Number(val);
        if (Number.isInteger(n) && n >= 1 && n <= MAX_MEASURES_PER_ROW) {
          measuresPerRow = n;
        } else {
          measuresPerRow = DEFAULT_MEASURES_PER_ROW;
          report(lineIdx, lineStart, lineEnd, 'invalidMeasuresPerRow', { value: val });
        }
      } else if (key === 'chord_size') {
        const n = parseFloat(val);
        if (!isNaN(n) && n > 0) style.chordSize = n;
      } else if (key === 'lyric_size') {
        const n = parseFloat(val);
        if (!isNaN(n) && n > 0) style.lyricSize = n;
      } else if (key === 'title_size') {
        const n = parseFloat(val);
        if (!isNaN(n) && n > 0) style.titleSize = n;
      } else if (key === 'section_size') {
        const n = parseFloat(val);
        if (!isNaN(n) && n > 0) style.sectionSize = n;
      } else if (key === 'font_size') {
        const n = parseFloat(val);
        if (!isNaN(n) && n > 0) style.fontSize = n;
      }
      continue;
    }

    // Section label [Intro], [Aメロ] etc
    const secMatch = line.match(/^\[([^\]]+)\]$/);
    if (secMatch) {
      currentSection = secMatch[1];
      melodyCursor = measures.length;
      lastMelodyGroup = null;
      continue;
    }

    // Melody line: mel: | e4/8 d c | ... |
    const melMatch = rawLine.match(/^(\s*mel:)(.*)$/i);
    if (melMatch) {
      lastMelodyGroup = parseMelodyLine(rawLine, melMatch[1].length, lineIdx);
      continue;
    }

    // Syllable lyric line: lyr: あさの ひかりを | ...
    const lyrMatch = rawLine.match(/^(\s*lyr:)(.*)$/i);
    if (lyrMatch) {
      if (!lastMelodyGroup) {
        report(lineIdx, lineStart, lineEnd, 'lyricsWithoutMelody');
      } else {
        assignLyrics(lastMelodyGroup, lyrMatch[2], lineIdx, lineStart, lineEnd);
      }
      continue;
    }

    // Measure line: | C | 4.d 4.d 4.d 4.d l:"..." | or | C 4.d ... |
    if (line.includes('|')) {
      parseMeasureLine(rawLine, lineIdx);
    }
  }

  function parseMeasureLine(rawLine: string, lineIdx: number) {
    const rawBars = rawLine.split('|').map(s => s.trim()).filter(s => s.length > 0 && s !== ':' && s !== ']' && s !== ':]');

    const bars: string[] = [];
    const CHORD_REGEX = new RegExp(`^${CHORD_NAME_PATTERN}(?:@${CHORD_LABEL_PATTERN})?(?::[0-9][0-9.]*|\\/[0-9][0-9.t+]*)?$`);
    const RHYTHM_REGEX = /^(?:r?(?:(?:16|8|4|2|1)t?(?:\+(?:16|8|4|2|1)t?)*|w|h|q)|r[a-z0-9]*)(\.[a-z]+)*$/;
    let searchPos = 0;

    let bi = 0;
    while (bi < rawBars.length) {
      const cur = rawBars[bi];
      const next = rawBars[bi + 1];
      const curTokens = cur.replace(/^:+|:+$/g, '').trim().split(/\s+/).filter(Boolean);
      const isCurOnlyChords = curTokens.length >= 1 && curTokens.every(t => CHORD_REGEX.test(t));

      if (isCurOnlyChords && next) {
        const nextClean = next.replace(/l:\"[^\"]*\"/, '').trim();
        const nextTokens = nextClean.replace(/^:+|:+$/g, '').trim().split(/\s+/).filter(Boolean);
        const nextHasChord = nextTokens.some(t => CHORD_REGEX.test(t));
        const nextHasRhythm = nextTokens.some(t => RHYTHM_REGEX.test(t.split('.')[0]) || t === '%');

        if (!nextHasChord && nextHasRhythm) {
          bars.push(cur + ' ' + next);
          bi += 2;
          continue;
        }
      }
      bars.push(cur);
      bi++;
    }

    for (let barIdx = 0; barIdx < bars.length; barIdx++) {
      const bar = bars[barIdx];
      if (bar === ':' || bar === '') continue;

      let mLyric = '';
      let cleanBar = bar;

      // Extract l:"..."
      const lyricMatch = cleanBar.match(/l:\"([^\"]*)\"/);
      if (lyricMatch) {
        mLyric = lyricMatch[1];
        cleanBar = cleanBar.replace(/l:\"([^\"]*)\"/, '').trim();
      }

      let rStart = false;
      let rEnd = false;
      let dEnd = false;
      let fEnd = false;

      if (cleanBar.startsWith(':')) {
        rStart = true;
        cleanBar = cleanBar.replace(/^:+/, '').trim();
      } else if (barIdx === 0 && rawLine.trim().startsWith('|:')) {
        rStart = true;
      }

      if (cleanBar.endsWith(':')) {
        rEnd = true;
        cleanBar = cleanBar.replace(/:+$/, '').trim();
      } else if (barIdx === bars.length - 1 && rawLine.trim().endsWith(':|')) {
        rEnd = true;
      }

      if (barIdx === bars.length - 1) {
        const trimmedLine = rawLine.trim();
        if (trimmedLine.endsWith('|]') || trimmedLine.endsWith(':|]')) {
          fEnd = true;
        } else if (trimmedLine.endsWith('||')) {
          dEnd = true;
        }
      }
      if (cleanBar.endsWith(']')) {
        fEnd = true;
        cleanBar = cleanBar.replace(/\]+$/, '').trim();
      }

      if (cleanBar.endsWith('||')) {
        dEnd = true;
        cleanBar = cleanBar.replace(/\|\|+$/, '').trim();
      }

      const tokens = cleanBar.split(/\s+/);
      interface RawParsedChord {
        name: string;
        label?: string;
        duration?: Fraction;
        accumBeatAtToken: number;
      }
      const rawChords: RawParsedChord[] = [];
      const rhythms: RhythmItem[] = [];
      let runningBeat = ZERO;
      let isMeasureRepeat = false;
      let invalidChordLength = false;
      let firstTokenCol = -1;
      let mBracket: string | undefined = undefined;
      let mSpecialMark: string | undefined = undefined;

      for (let tokIdx = 0; tokIdx < tokens.length; tokIdx++) {
        const tok = tokens[tokIdx];
        if (!tok || tok === ':' || tok === '|') continue;
        const found = rawLine.indexOf(tok, searchPos);
        const tokCol = found >= 0 ? found : searchPos;
        if (found >= 0) searchPos = found + tok.length;
        if (firstTokenCol < 0) firstTokenCol = tokCol;

        if (tok === '%') {
          isMeasureRepeat = true;
          continue;
        }

        const bracketMatch = tok.match(/^\[([0-9]+[.,\-0-9]*)\]$/);
        if (bracketMatch) {
          mBracket = bracketMatch[1];
          continue;
        }

        if (tok.toLowerCase() === 'to' && tokens[tokIdx + 1]?.toLowerCase() === 'coda') {
          mSpecialMark = 'to_coda';
          tokIdx++;
          continue;
        }

        const markMatch = tok.match(/^(D\.C\.|D\.S\.|Fine|Coda|Segno|to_?Coda)$/i);
        if (markMatch) {
          let norm = markMatch[1].toLowerCase().replace(/[\s.]+/g, '_').replace(/^_|_$/g, '');
          if (norm === 'd_c') norm = 'dc';
          if (norm === 'd_s') norm = 'ds';
          mSpecialMark = norm;
          continue;
        }

        const parsedChord = parseChordToken(tok);
        if (parsedChord) {
          if (parsedChord.invalidLength) {
            invalidChordLength = true;
            report(lineIdx, tokCol, tokCol + tok.length, 'invalidLength', { token: tok });
          }
          rawChords.push({
            name: parsedChord.name,
            label: parsedChord.label,
            duration: parsedChord.duration,
            accumBeatAtToken: fnum(runningBeat)
          });
          const key = chordKey(parsedChord.name, parsedChord.label);
          usedChordsSet.add(key);
          if (parsedChord.label !== undefined) {
            chordUses.push({ key, line: lineIdx, startCol: tokCol, endCol: tokCol + tok.length });
          }
        } else if (RHYTHM_REGEX.test(tok)) {
          // Rhythm token e.g. 4.d, 8.u, 16.d.a, rq, 8t.d, 4+8.d, etc.
          const parts = tok.split('.');
          const dur = parts[0];
          const isRest = dur.startsWith('r');
          let down = false, up = false, ghost = false, accent = false, tie = false;
          let inlineL: string | undefined = undefined;

          for (let i = 1; i < parts.length; i++) {
            const mod = parts[i];
            if (mod === 'd') down = true;
            else if (mod === 'u') up = true;
            else if (mod === 'g' || mod === 'ghost') ghost = true;
            else if (mod === 'a' || mod === 'accent') accent = true;
            else if (mod === 't' || mod === 'tie') tie = true;
          }

          rhythms.push({
            duration: dur,
            isRest,
            down,
            up,
            ghost,
            accent,
            tie,
            inlineLyric: inlineL
          });
          runningBeat = fadd(runningBeat, rhythmBeatsFraction(dur));
        }
      }

      if (!isMeasureRepeat && rhythms.length > 0 && !feq(runningBeat, WHOLE_MEASURE)) {
        const col = firstTokenCol >= 0 ? firstTokenCol : 0;
        report(lineIdx, col, searchPos, 'beatCountMismatch', { beats: formatBeats(runningBeat) });
      }

      let barChords: ChordPlacement[] = [];
      if (rawChords.length === 1) {
        barChords = [placement(rawChords[0], rawChords[0].accumBeatAtToken)];
      } else if (rawChords.length > 1) {
        const allChordsBeforeRhythm = rawChords.every(c => c.accumBeatAtToken === 0);
        if (allChordsBeforeRhythm) {
          const anyHasDuration = rawChords.some(c => c.duration !== undefined);
          if (anyHasDuration && !invalidChordLength) {
            let curB = ZERO;
            barChords = rawChords.map(c => {
              const b = curB;
              curB = fadd(curB, c.duration ?? frac(2));
              return placement(c, fnum(b));
            });
          } else {
            const step = 4.0 / rawChords.length;
            barChords = rawChords.map((c, idx) => placement(c, idx * step));
          }
        } else {
          barChords = rawChords.map(c => placement(c, c.accumBeatAtToken));
        }
      } else if (isMeasureRepeat && measures.length > 0) {
        const prev = measures[measures.length - 1];
        if (prev.chords && prev.chords.length > 0) {
          barChords = prev.chords.map(c => ({ ...c }));
        } else if (prev.chord) {
          barChords = [{ name: prev.chord, beat: 0 }];
        }
        barChords.forEach(c => usedChordsSet.add(chordKey(c.name, c.label)));
      }

      const mData: MeasureData = {
        chord: barChords.length > 0 ? barChords[0].name : '',
        chords: barChords,
        isMeasureRepeat,
        repeatStart: rStart,
        repeatEnd: rEnd,
        doubleEnd: dEnd,
        finalEnd: fEnd,
        bracket: mBracket,
        specialMark: mSpecialMark,
        sectionName: currentSection,
        rhythms: isMeasureRepeat ? [] : (rhythms.length > 0 ? rhythms : [
          { duration: '4', isRest: false, down: true, up: false, ghost: false, accent: false, tie: false },
          { duration: '4', isRest: false, down: false, up: false, ghost: false, accent: false, tie: false },
          { duration: '4', isRest: false, down: true, up: false, ghost: false, accent: false, tie: false },
          { duration: '4', isRest: false, down: false, up: false, ghost: false, accent: false, tie: false }
        ]),
        lyric: mLyric
      };
      measures.push(mData);
      pages[currentPageIndex].measures.push(mData);
      currentSection = ''; // consume section for the first bar
    }
  }

  function placement(c: { name: string; label?: string }, beat: number): ChordPlacement {
    return c.label !== undefined ? { name: c.name, beat, label: c.label } : { name: c.name, beat };
  }

  function parseMelodyLine(rawLine: string, bodyStart: number, lineIdx: number): MelodyGroup {
    const group: MelodyGroup = { notes: [], cellRanges: [], verseCount: 0 };
    const state: MelodyTokenState = {};

    // Split the body into cells at '|', keeping source columns.
    const cells: { text: string; col: number }[] = [];
    let cellStart = bodyStart;
    for (let i = bodyStart; i <= rawLine.length; i++) {
      if (i === rawLine.length || rawLine[i] === '|') {
        const text = rawLine.slice(cellStart, i);
        if (text.trim()) cells.push({ text, col: cellStart });
        cellStart = i + 1;
      }
    }

    let prevNote: MelodyNote | null = null;
    for (const cell of cells) {
      const cellEnd = cell.col + cell.text.length;
      const trimmedCol = cell.col + (cell.text.length - cell.text.trimStart().length);
      const trimmedEnd = cell.col + cell.text.trimEnd().length;

      if (melodyCursor >= measures.length) {
        report(lineIdx, trimmedCol, trimmedEnd, 'tooManyMelodyMeasures');
        continue;
      }
      const measureIdx = melodyCursor++;
      const measure = measures[measureIdx];
      const start = group.notes.length;
      let notes: MelodyNote[] = [];

      if (cell.text.trim() === '%') {
        const prevMelody = measureIdx > 0 ? measures[measureIdx - 1].melody : undefined;
        if (!prevMelody) {
          report(lineIdx, trimmedCol, trimmedEnd, 'melodyRepeatWithoutPrevious');
        } else {
          notes = prevMelody.map(n => ({ ...n, pitch: n.pitch ? { ...n.pitch } : undefined, tiedFromPrev: false, syllables: [] }));
          const last = prevMelody[prevMelody.length - 1];
          if (last) state.octave = last.pitch?.octave ?? state.octave;
        }
      } else {
        const re = /\S+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(cell.text)) !== null) {
          const col = cell.col + m.index;
          const parsed = parseMelodyToken(m[0], state);
          if (typeof parsed === 'string') {
            report(lineIdx, col, col + m[0].length, parsed, { token: m[0] });
            continue;
          }
          notes.push(parsed);
        }
      }

      for (const note of notes) {
        if (prevNote?.tieToNext && !note.isRest) note.tiedFromPrev = true;
        prevNote = note;
      }

      measure.melody = notes;
      group.notes.push(...notes);
      group.cellRanges.push({ start, end: group.notes.length });

      if (measure.lyric) {
        report(lineIdx, trimmedCol, trimmedEnd, 'measureLyricWithMelody');
      }
      const total = notes.reduce((acc, n) => fadd(acc, n.beats), ZERO);
      if (notes.length > 0 && !feq(total, WHOLE_MEASURE)) {
        report(lineIdx, trimmedCol, Math.min(trimmedEnd, cellEnd), 'beatCountMismatch', { beats: formatBeats(total) });
      }
    }
    return group;
  }

  function assignLyrics(group: MelodyGroup, text: string, lineIdx: number, lineStart: number, lineEnd: number) {
    const verse = group.verseCount++;
    const items = tokenizeLyrics(text);
    const sung = group.notes.map((n, idx) => ({ n, idx })).filter(x => takesSyllable(x.n));

    let noteCursor = 0;
    let consumed = 0;
    for (const item of items) {
      if (item.kind === 'bar') continue;
      consumed++;
      if (noteCursor >= sung.length) continue;
      const note = sung[noteCursor++].n;
      if (item.kind === 'syllable') {
        note.syllables[verse] = { text: item.text, hyphenToNext: item.hyphenToNext, extend: false };
      } else if (item.kind === 'extend') {
        note.syllables[verse] = { text: '', hyphenToNext: false, extend: true };
      } else {
        note.syllables[verse] = null;
      }
    }
    if (consumed !== sung.length) {
      report(lineIdx, lineStart, lineEnd, 'syllableCountMismatch', { syllables: consumed, notes: sung.length });
    }

    // Optional '|' markers: each segment must cover exactly the sung notes of the matching cell.
    if (items.some(i => i.kind === 'bar')) {
      const segments: number[] = [];
      let count = 0;
      let seenContent = false;
      for (const item of items) {
        if (item.kind === 'bar') {
          if (seenContent) segments.push(count);
          count = 0;
          seenContent = false;
        } else {
          count++;
          seenContent = true;
        }
      }
      if (seenContent) segments.push(count);
      const expected = group.cellRanges.map(r => group.notes.slice(r.start, r.end).filter(takesSyllable).length);
      const matches = segments.length === expected.length && segments.every((c, i) => c === expected[i]);
      if (!matches) {
        report(lineIdx, lineStart, lineEnd, 'lyricBarMismatch');
      }
    }
  }

  // `name@label` references need a matching definition (definitions may appear anywhere in the file).
  const definedKeys = new Set(chordDefinitions.map(d => chordKey(d.name, d.label)));
  for (const use of chordUses) {
    if (!definedKeys.has(use.key)) {
      report(use.line, use.startCol, use.endCol, 'unknownChordVariant', { chord: use.key });
    }
  }

  const validPages = pages.filter((p, idx) => p.measures.length > 0 || idx === 0);
  validPages.forEach((p, idx) => {
    p.pageNumber = idx + 1;
  });

  return {
    title,
    artist,
    capo,
    originalKey,
    bpm,
    memo,
    style,
    usedChords: Array.from(usedChordsSet),
    chordDefinitions,
    measures,
    pages: validPages,
    keySignature: parseKeySignature(originalKey),
    showRhythm,
    measuresPerRow,
    diagnostics
  };
}

function formatBeats(b: Fraction): string {
  return b.d === 1 ? String(b.n) : `${b.n}/${b.d}`;
}
