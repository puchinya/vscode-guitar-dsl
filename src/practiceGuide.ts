import { parseRhythmDuration } from './duration';
import { expandMeasureRepeat } from './compiler';
import type { ParsedScore, RhythmItem } from './compiler';

export type PracticeGuideGrid = 4 | 8 | 16;

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
