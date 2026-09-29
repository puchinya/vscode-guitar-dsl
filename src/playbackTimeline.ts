import { eventPitches, expandMeasureRepeat } from './compiler';
import type { ParsedScore, RhythmItem } from './compiler';
import { Fraction, ZERO, fadd, fcmp, fnum, frac, fsub, parseRhythmDuration } from './duration';
import { Pitch } from './melody';
import { beamGroupStarts } from './scoreEvents';
import type { TimeSignature } from './scoreEvents';

export type PlaybackTimelineErrorCode = 'invalidPlayOrder' | 'unresolvedTempo';

export interface PlaybackOccurrence {
  occurrenceIndex: number;
  measureIndex: number;
  startBeat: Fraction;
  durationBeats: Fraction;
  startSeconds: number;
  durationSeconds: number;
  tempoBpm: number;
  timeSignature: TimeSignature;
}

interface PlaybackEventBase {
  occurrenceIndex: number;
  measureIndex: number;
  beatInMeasure: Fraction;
  absoluteBeat: Fraction;
  timeSeconds: number;
  durationBeats: Fraction;
  durationSeconds: number;
}

export type PlaybackEvent =
  | (PlaybackEventBase & { kind: 'pitched'; source: 'melody' | 'inline'; pitches: Pitch[] })
  | (PlaybackEventBase & { kind: 'rhythmAttack'; chord?: { name: string; label?: string } })
  | (PlaybackEventBase & { kind: 'rest'; source: 'melody' | 'rhythm' })
  | (PlaybackEventBase & { kind: 'metronome'; accent: boolean });

export interface PlaybackTimeline {
  occurrences: PlaybackOccurrence[];
  events: PlaybackEvent[];
  durationBeats: Fraction;
  durationSeconds: number;
}

export type PlaybackTimelineResult =
  | { ok: true; timeline: PlaybackTimeline }
  | { ok: false; code: PlaybackTimelineErrorCode };

export interface PlaybackPosition {
  occurrenceIndex: number | null;
  measureIndex: number | null;
  beatInMeasure: Fraction;
  absoluteBeat: Fraction;
  timeSeconds: number;
}

const copyFraction = (value: Fraction): Fraction => frac(value.n, value.d);
const secondsForBeats = (beats: Fraction, bpm: number): number => fnum(beats) * 60 / bpm;

function clippedDuration(start: Fraction, duration: Fraction, measureLength: Fraction): Fraction | null {
  if (fcmp(start, ZERO) < 0 || fcmp(start, measureLength) >= 0) return null;
  const remaining = fsub(measureLength, start);
  return fcmp(duration, remaining) > 0 ? remaining : copyFraction(duration);
}

function chordAtOrBefore(measure: ParsedScore['measures'][number], beat: Fraction): { name: string; label?: string } | undefined {
  const target = fnum(beat);
  let selected: ParsedScore['measures'][number]['chords'][number] | undefined;
  for (const chord of measure.chords) {
    if (chord.beat <= target && (!selected || chord.beat >= selected.beat)) selected = chord;
  }
  if (!selected) return undefined;
  return selected.label === undefined ? { name: selected.name } : { name: selected.name, label: selected.label };
}

function rhythmItemDuration(item: RhythmItem): Fraction | null {
  if (item.techniques?.grace) return frac(0);
  const parsed = parseRhythmDuration(item.duration);
  return parsed ? parsed.beats : null;
}

/**
 * Builds a deterministic playback timeline from the compiler's resolved score and play order.
 * All musical positions and durations remain exact fractions until their seconds fields are emitted.
 */
export function buildPlaybackTimeline(score: ParsedScore): PlaybackTimelineResult {
  if (!score.playOrder.valid) return { ok: false, code: 'invalidPlayOrder' };

  const occurrences: PlaybackOccurrence[] = [];
  const events: PlaybackEvent[] = [];
  let durationBeats = ZERO;
  let durationSeconds = 0;

  for (const played of score.playOrder.occurrences) {
    const sourceMeasure = score.measures[played.measureIndex];
    if (!sourceMeasure || sourceMeasure.measureIndex !== played.measureIndex) return { ok: false, code: 'invalidPlayOrder' };
    // Resolve the written % sign through the compiler's existing notation helper. Play order and
    // occurrence coordinates still come exclusively from ParsedScore.playOrder.
    const measure = sourceMeasure.isMeasureRepeat
      ? expandMeasureRepeat(sourceMeasure, score.measures)
      : sourceMeasure;

    const tempoBpm = measure.context.tempoBpm;
    if (tempoBpm === null || !Number.isFinite(tempoBpm) || tempoBpm <= 0) {
      return { ok: false, code: 'unresolvedTempo' };
    }

    const measureLength = copyFraction(measure.expectedBeats);
    const occurrenceSeconds = secondsForBeats(measureLength, tempoBpm);
    const occurrence: PlaybackOccurrence = {
      occurrenceIndex: played.occurrenceIndex,
      measureIndex: played.measureIndex,
      startBeat: copyFraction(durationBeats),
      durationBeats: measureLength,
      startSeconds: durationSeconds,
      durationSeconds: occurrenceSeconds,
      tempoBpm,
      timeSignature: {
        numerator: measure.context.timeSignature.numerator,
        denominator: measure.context.timeSignature.denominator,
        groups: [...measure.context.timeSignature.groups]
      }
    };
    occurrences.push(occurrence);

    const createBase = (beat: Fraction, nominal: Fraction): PlaybackEventBase | null => {
      const eventDuration = clippedDuration(beat, nominal, measureLength);
      if (eventDuration === null) return null;
      return {
        occurrenceIndex: played.occurrenceIndex,
        measureIndex: played.measureIndex,
        beatInMeasure: copyFraction(beat),
        absoluteBeat: fadd(occurrence.startBeat, beat),
        timeSeconds: occurrence.startSeconds + secondsForBeats(beat, tempoBpm),
        durationBeats: eventDuration,
        durationSeconds: secondsForBeats(eventDuration, tempoBpm)
      };
    };

    // A measure-line % repeats rhythm only. Melody repetition is explicit in mel: cells and has
    // already been resolved onto the source measure by the compiler.
    let melodyBeat = ZERO;
    for (const note of sourceMeasure.melody ?? []) {
      const base = createBase(melodyBeat, note.beats);
      if (base) {
        if (note.isRest) {
          events.push({ ...base, kind: 'rest', source: 'melody' });
        } else {
          const pitches = eventPitches(note).map(pitch => ({ ...pitch }));
          if (pitches.length > 0) events.push({ ...base, kind: 'pitched', source: 'melody', pitches });
        }
      }
      melodyBeat = fadd(melodyBeat, note.beats);
    }

    let rhythmBeat = ZERO;
    for (const item of measure.rhythms) {
      const itemDuration = rhythmItemDuration(item);
      if (!itemDuration) continue;
      const base = createBase(rhythmBeat, itemDuration);
      if (base) {
        if (item.isRest) {
          events.push({ ...base, kind: 'rest', source: 'rhythm' });
        } else {
          const pitches = eventPitches(item).map(pitch => ({ ...pitch }));
          if (pitches.length > 0) {
            events.push({ ...base, kind: 'pitched', source: 'inline', pitches });
          } else {
            const chord = chordAtOrBefore(measure, rhythmBeat);
            events.push(chord
              ? { ...base, kind: 'rhythmAttack', chord }
              : { ...base, kind: 'rhythmAttack' });
          }
        }
      }
      rhythmBeat = fadd(rhythmBeat, itemDuration);
    }

    for (const [groupIndex, beat] of beamGroupStarts(occurrence.timeSignature).entries()) {
      const base = createBase(beat, frac(0));
      if (base) events.push({ ...base, kind: 'metronome', accent: groupIndex === 0 });
    }

    durationBeats = fadd(durationBeats, measureLength);
    durationSeconds += occurrenceSeconds;
  }

  events.sort((a, b) => fcmp(a.absoluteBeat, b.absoluteBeat));
  return { ok: true, timeline: { occurrences, events, durationBeats, durationSeconds } };
}

function fractionFromApproximation(value: number): Fraction {
  const precision = 1_000_000;
  return frac(Math.round(value * precision), precision);
}

/** Maps an audio-clock score time to a source measure occurrence and its local beat. */
export function playbackPositionAtSeconds(timeline: PlaybackTimeline, seconds: number): PlaybackPosition {
  const timeSeconds = Number.isFinite(seconds)
    ? Math.max(0, Math.min(timeline.durationSeconds, seconds))
    : 0;
  if (timeline.occurrences.length === 0) {
    return { occurrenceIndex: null, measureIndex: null, beatInMeasure: frac(0), absoluteBeat: frac(0), timeSeconds: 0 };
  }

  let occurrence = timeline.occurrences[timeline.occurrences.length - 1];
  if (timeSeconds < timeline.durationSeconds) {
    occurrence = timeline.occurrences.find(candidate =>
      timeSeconds < candidate.startSeconds + candidate.durationSeconds
    ) ?? occurrence;
  }

  const elapsed = Math.max(0, Math.min(occurrence.durationSeconds, timeSeconds - occurrence.startSeconds));
  const beatNumber = Math.max(0, Math.min(
    fnum(occurrence.durationBeats),
    elapsed * occurrence.tempoBpm / 60
  ));
  const beatInMeasure = timeSeconds >= timeline.durationSeconds
    ? copyFraction(occurrence.durationBeats)
    : fractionFromApproximation(beatNumber);
  return {
    occurrenceIndex: occurrence.occurrenceIndex,
    measureIndex: occurrence.measureIndex,
    beatInMeasure,
    absoluteBeat: fadd(occurrence.startBeat, beatInMeasure),
    timeSeconds
  };
}

/** Maps a source-measure occurrence and local beat back to the audio-clock score time. */
export function playbackSecondsAtPosition(
  timeline: PlaybackTimeline,
  occurrenceIndex: number,
  beatInMeasure: Fraction
): number {
  const occurrence = timeline.occurrences.find(candidate => candidate.occurrenceIndex === occurrenceIndex);
  if (!occurrence) return occurrenceIndex < 0 ? 0 : timeline.durationSeconds;
  const beat = fcmp(beatInMeasure, ZERO) < 0
    ? ZERO
    : fcmp(beatInMeasure, occurrence.durationBeats) > 0
      ? occurrence.durationBeats
      : beatInMeasure;
  return occurrence.startSeconds + secondsForBeats(beat, occurrence.tempoBpm);
}
