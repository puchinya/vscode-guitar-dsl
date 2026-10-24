import { fadd, fcmp, fmul, frac, formatNoteValuePart, parseRhythmDuration, partBeats, type Fraction, type NoteValue } from './duration';
import { expandMeasureRepeat } from './compiler';
import type { ParsedScore, RhythmItem } from './compiler';
import type { TabBeat, TabVoiceMeasure } from './tab';

export type PracticeGuideGrid = 4 | 8 | 16;
export type PracticeGuideCapacity = 4 | 2 | 1;

export interface PracticeGuideOccurrence {
  occurrenceIndex: number;
  measureIndex: number;
  lyricVerse?: number;
}

export interface PracticeGuideBank<T extends PracticeGuideOccurrence> {
  id: 'left' | 'right';
  occurrences: readonly T[];
  startIndex: number | null;
}

export interface PracticeGuidePageProjection<T extends PracticeGuideOccurrence> {
  capacity: PracticeGuideCapacity;
  bankSize: number;
  currentOccurrence: T | null;
  currentBank: 'left' | 'right';
  pageIndex: number;
  banks: { left: PracticeGuideBank<T>; right: PracticeGuideBank<T> };
}

/** Projects the ordered playback occurrences into two fixed banks without resolving play order. */
export function projectPracticeGuidePage<T extends PracticeGuideOccurrence>(
  occurrences: readonly T[],
  occurrenceIndex: number,
  capacity: PracticeGuideCapacity
): PracticeGuidePageProjection<T> {
  const requestedIndex = occurrences.findIndex(item => item.occurrenceIndex === occurrenceIndex);
  const index = requestedIndex >= 0 ? requestedIndex : Number.isInteger(occurrenceIndex) ? occurrenceIndex : -1;
  const currentOccurrence = index >= 0 && index < occurrences.length ? occurrences[index] : null;
  const bankSize = capacity === 4 ? 2 : 1;
  const pageIndex = currentOccurrence ? Math.floor(index / bankSize) : -1;
  const currentBank: 'left' | 'right' = pageIndex >= 0 && pageIndex % 2 === 1 ? 'right' : 'left';
  const makeBank = (id: 'left' | 'right'): PracticeGuideBank<T> => {
    if (!currentOccurrence) return { id, occurrences: [], startIndex: null };
    if (capacity === 1 && id !== currentBank) return { id, occurrences: [], startIndex: null };
    const isCurrent = id === currentBank;
    const startIndex = isCurrent
      ? Math.floor(index / bankSize) * bankSize
      : (Math.floor(index / bankSize) + 1) * bankSize;
    return { id, occurrences: occurrences.slice(startIndex, startIndex + bankSize), startIndex };
  };
  return {
    capacity,
    bankSize,
    currentOccurrence,
    currentBank,
    pageIndex,
    banks: { left: makeBank('left'), right: makeBank('right') }
  };
}

export interface PracticeGuideCapacityOptions {
  leftRailWidth?: number;
  rightRailWidth?: number;
  measureGap?: number;
  bankGap?: number;
  horizontalPadding?: number;
}

/** The compact practice guide always projects four measures; width changes scrolling, not capacity. */
export function selectPracticeGuideCapacity(
  _measureWidths: readonly number[],
  _availableWidth: number,
  _options: PracticeGuideCapacityOptions = {}
): PracticeGuideCapacity {
  return 4;
}

const REST_GLYPHS: Readonly<Record<number, string>> = Object.freeze({
  1: '\u{1D13B}',
  2: '\u{1D13C}',
  4: '\u{1D13D}',
  8: '\u{1D13E}',
  16: '\u{1D13F}'
});

export function practiceGuideRestGlyph(duration: NoteValue | string): string {
  const value = typeof duration === 'string' ? parseRhythmDuration(duration.replace(/^r/, '')) : duration;
  const base = value?.parts[0]?.base;
  return base ? REST_GLYPHS[base] ?? REST_GLYPHS[4] : REST_GLYPHS[4];
}

export interface PracticeGuideTabEvent {
  at: Fraction;
  duration: NoteValue;
  durationLabel: string;
  label: string;
  kind: 'attack' | 'continuation' | 'rest';
  percussive: boolean;
  voice: number;
  eventIndex: number;
}

/** Exact offsets for the visible continuation marks inside one written rhythm event. */
export function practiceGuideValueContinuationOffsets(
  duration: NoteValue,
  grid: PracticeGuideGrid,
  options: { isRest?: boolean; percussive?: boolean } = {}
): Fraction[] {
  if (options.isRest || options.percussive) return [];

  const offsets: Fraction[] = [];
  let partStart = frac(0);
  for (const [index, part] of duration.parts.entries()) {
    const partDuration = partBeats(part);
    if (index > 0) offsets.push(partStart);
    let step = frac(4, grid);
    if (part.tuplet) step = fmul(step, frac(part.tuplet.normal, part.tuplet.actual));
    let offset = step;
    while (fcmp(offset, partDuration) < 0) {
      offsets.push(fadd(partStart, offset));
      offset = fadd(offset, step);
    }
    partStart = fadd(partStart, partDuration);
  }

  return offsets.filter((offset, index) => offsets.findIndex(candidate => fcmp(candidate, offset) === 0) === index);
}

export function practiceGuideContinuationOffsets(item: RhythmItem, grid: PracticeGuideGrid): Fraction[] {
  if (item.mute || item.invalidTechnique || item.ghost || item.techniques?.staccato) return [];
  const duration = parseRhythmDuration(item.duration);
  return duration ? practiceGuideValueContinuationOffsets(duration, grid, { isRest: item.isRest }) : [];
}

/** Projects TAB-only measures into guide events; implicit rhythm never overrides written TAB. */
export function practiceGuideTabEvents(voices: readonly TabVoiceMeasure[]): PracticeGuideTabEvent[] {
  const events: PracticeGuideTabEvent[] = [];
  for (const voice of voices) {
    let at = frac(0);
    let previousBeat: TabBeat | undefined;
    for (const [eventIndex, beat] of voice.beats.entries()) {
      const durationLabel = beat.duration.parts.map(formatNoteValuePart).join('+');
      if (beat.isRest) {
        events.push({ at, duration: beat.duration, durationLabel, label: practiceGuideRestGlyph(beat.duration), kind: 'rest', percussive: false, voice: voice.voice, eventIndex });
      } else if (beat.notes.length > 0) {
        const labels = beat.notes.map(note => {
          const tiedFromPrevious = previousBeat?.notes.some(previous =>
            previous.tieToNext && previous.string === note.string && previous.fret === note.fret
          ) ?? false;
          return tiedFromPrevious ? '〜' : note.dead ? `×${note.string}` : String(note.string);
        });
        const allTied = labels.every(label => label === '〜');
        const allPercussive = beat.notes.every(note => note.dead || note.effects.some(effect => effect.name === 'stacc' || effect.name === 'staccato'));
        events.push({
          at,
          duration: beat.duration,
          durationLabel,
          label: labels.join(' '),
          kind: allTied ? 'continuation' : 'attack',
          percussive: allPercussive,
          voice: voice.voice,
          eventIndex
        });
      }
      at = fadd(at, beat.duration.beats);
      previousBeat = beat;
    }
  }
  return events.sort((left, right) => fcmp(left.at, right.at) || left.voice - right.voice || left.eventIndex - right.eventIndex);
}

/** Labels one onset without conflating a mute, rest, tie continuation, or directionless attack. */
export function practiceGuideRhythmLabel(item: RhythmItem): string {
  if (item.mute) return '・';
  if (item.isRest) return practiceGuideRestGlyph(item.duration);
  if (item.tiedFromPrev) return '〜';
  const labels: string[] = [];
  const direction = item.down && item.up ? '↓↑' : item.down ? '↓' : item.up ? '↑' : '';
  if (item.ghost) labels.push(item.down ? '×↓' : item.up ? '×↑' : '×');
  else if (item.stringAttack !== undefined) labels.push(String(item.stringAttack));
  else if (item.techniques?.palmMute) labels.push(`PM${direction || '●'}`);
  else if (direction) labels.push(direction);
  if (item.accent) labels.push('a');
  if (item.techniques?.palmMute && (item.ghost || item.stringAttack !== undefined)) labels.push('PM');
  if (item.techniques?.letRing) labels.push('LR');
  return labels.join(' ') || '●';
}

function baseValues(item: RhythmItem): number[] {
  if (item.techniques?.grace) return [];
  return parseRhythmDuration(item.duration)?.parts.map(part => part.base) ?? [];
}

/**
 * Chooses one subdivision for the whole written song. Implicit rhythm and melody are excluded;
 * explicit rhythm, resolved rhythm repeats, and TAB-only measures contribute their written values.
 */
export function automaticPracticeGuideGrid(score: ParsedScore): PracticeGuideGrid {
  let sawEighth = false;
  for (const [index, measure] of score.measures.entries()) {
    let rhythmItems: readonly RhythmItem[] = [];
    let hasExplicitRhythm = false;
    if (measure.rhythmOrigin === 'explicit') {
      hasExplicitRhythm = true;
      rhythmItems = measure.rhythms;
    } else if (measure.rhythmOrigin === 'repeat') {
      let sourceIndex = index - 1;
      while (sourceIndex >= 0 && score.measures[sourceIndex].isMeasureRepeat) sourceIndex--;
      if (sourceIndex >= 0 && score.measures[sourceIndex].rhythmOrigin === 'explicit') {
        hasExplicitRhythm = true;
        rhythmItems = expandMeasureRepeat(measure, score.measures).rhythms;
      }
    }

    const values = rhythmItems.flatMap(baseValues);
    if (hasExplicitRhythm) {
      if (values.includes(16)) return 16;
      if (values.includes(8)) sawEighth = true;
      continue;
    }

    // A measure with explicit rhythm has priority over TAB. TAB contributes only when it is the
    // sole written rhythm source, avoiding duplicated subdivisions in combined rhythm + TAB scores.
    const tabVoices = measure.tabVoices ?? (measure.rhythmOrigin === 'repeat'
      ? expandMeasureRepeat(measure, score.measures).tabVoices
      : undefined);
    for (const voice of tabVoices ?? []) {
      for (const beat of voice.beats) {
        for (const part of beat.duration.parts) {
          if (part.base === 16) return 16;
          if (part.base === 8) sawEighth = true;
        }
      }
    }
  }
  return sawEighth ? 8 : 4;
}

/** True when the score has at least one resolved rhythm or TAB note value for the guide to follow. */
export function practiceGuideHasWrittenRhythm(score: ParsedScore): boolean {
  for (const [index, measure] of score.measures.entries()) {
    let explicitRhythm: readonly RhythmItem[] | undefined;
    if (measure.rhythmOrigin === 'explicit') {
      explicitRhythm = measure.rhythms;
    } else if (measure.rhythmOrigin === 'repeat') {
      let sourceIndex = index - 1;
      while (sourceIndex >= 0 && score.measures[sourceIndex].isMeasureRepeat) sourceIndex--;
      if (sourceIndex >= 0 && score.measures[sourceIndex].rhythmOrigin === 'explicit') {
        explicitRhythm = expandMeasureRepeat(measure, score.measures).rhythms;
      }
    }
    if (explicitRhythm?.some(item => baseValues(item).length > 0)) return true;
    if (explicitRhythm) continue;
    const tabVoices = measure.tabVoices ?? (measure.rhythmOrigin === 'repeat'
      ? expandMeasureRepeat(measure, score.measures).tabVoices
      : undefined);
    if (tabVoices?.some(voice => voice.beats.some(beat => beat.duration.parts.length > 0))) return true;
  }
  return false;
}
