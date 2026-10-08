import type { InterchangeLyricSlot, InterchangeScore } from './model';

/**
 * Mirrors melody.ts::takesSyllable(): rests, grace notes, and tied continuations do not consume lyric slots.
 * The compiler remains the parser authority; this predicate is used only on the normalized snapshot.
 */
export function takesMelodySyllable(note: NonNullable<InterchangeScore['measures'][number]['melody']>[number]): boolean {
  return !note.isRest && !note.techniques?.grace && !note.tiedFromPrev;
}

/** Minimum authored verse count across melody groups wholly contained in a written section. */
export function sectionLyricVerseCapacity(score: InterchangeScore, startMeasure: number, endMeasureExclusive: number): number {
  const counts: number[] = [];
  for (const group of score.melodyGroups) {
    if (group.startMeasure < startMeasure || group.endMeasureExclusive > endMeasureExclusive || group.verseCount <= 0) continue;
    const hasSungNote = score.measures
      .slice(group.startMeasure, group.endMeasureExclusive)
      .some(measure => measure.melody?.some(takesMelodySyllable) ?? false);
    if (hasSungNote) counts.push(group.verseCount);
  }
  return counts.length ? Math.min(...counts) : 0;
}

function hasAuthoredLyric(value: InterchangeLyricSlot | undefined): boolean {
  return value === null || (typeof value === 'object' && value !== null && !('kind' in value && value.kind === 'omitted'));
}

/** Returns the length of an authored lyric prefix, or -1 when a later slot resumes after an omission. */
export function lyricPrefixLength(slots: readonly (InterchangeLyricSlot | undefined)[]): number {
  let length = 0;
  let omitted = false;
  for (const slot of slots) {
    if (hasAuthoredLyric(slot)) {
      if (omitted) return -1;
      length++;
    } else omitted = true;
  }
  return length;
}
