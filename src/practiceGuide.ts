import { fadd, fcmp, fmul, frac, formatNoteValuePart, parseRhythmDuration, partBeats, type Fraction, type NoteValue } from './duration';
import { expandMeasureRepeat } from './compiler';
import type { ParsedScore, RhythmItem } from './compiler';
import type { TabBeat, TabVoiceMeasure } from './tab';

export type PracticeGuideGrid = 4 | 8 | 16;

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
        events.push({ at, duration: beat.duration, durationLabel, label: `r${durationLabel}`, kind: 'rest', percussive: false, voice: voice.voice, eventIndex });
      } else if (beat.notes.length > 0) {
        const labels = beat.notes.map(note => {
          const tiedFromPrevious = previousBeat?.notes.some(previous =>
            previous.tieToNext && previous.string === note.string && previous.fret === note.fret
          ) ?? false;
          return tiedFromPrevious ? '〜' : note.dead ? `×s${note.string}` : `s${note.string}`;
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
  if (item.isRest) return item.duration.startsWith('r') ? item.duration : `r${item.duration}`;
  if (item.tiedFromPrev) return '〜';
  const labels: string[] = [];
  if (item.ghost) labels.push(item.down ? '×↓' : item.up ? '×↑' : '×');
  else if (item.stringAttack !== undefined) labels.push(`s${item.stringAttack}`);
  else if (item.down || item.up) labels.push(item.down && item.up ? '↓↑' : item.down ? '↓' : '↑');
  if (item.accent) labels.push('a');
  if (item.techniques?.palmMute) labels.push('PM');
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
