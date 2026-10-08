import { parseGuitarDsl } from '../compiler';
import type { ParsedScore, ScoreDiagnostic } from '../compiler';
import { parseRhythmDurationDetailed, type NoteValue, type NoteValuePart } from '../duration';
import { scanArrangementBlockLines } from '../arrangement';
import type { ArrangementScanResult } from '../arrangement';
import type { ScoreEvent } from '../scoreEvents';
import { appendLoss, emptyLossReport } from './loss';
import type {
  InterchangeError,
  InterchangeEvent,
  InterchangeFraction,
  InterchangeLossReport,
  InterchangeLyricSlot,
  InterchangeNote,
  InterchangeNoteTechniques,
  InterchangeNoteValue,
  InterchangePitch,
  InterchangeResult,
  InterchangeRhythmEvent,
  InterchangeScore,
  InterchangeSyllable,
  InterchangeTabEffectCall,
  InterchangeTabVoice
} from './model';
import { validateInterchangeScore } from './validate';

function fraction(value: { readonly n: number; readonly d: number }): InterchangeFraction {
  if (!Number.isSafeInteger(value.n) || !Number.isSafeInteger(value.d) || value.d <= 0) throw new RangeError('fraction exceeds safe integer range');
  return { n: value.n, d: value.d };
}

function part(value: NoteValuePart): InterchangeNoteValue['parts'][number] {
  return { base: value.base, dotted: value.dotted, ...(value.tuplet ? { tuplet: { actual: value.tuplet.actual, normal: value.tuplet.normal } } : {}) };
}

function noteValue(value: NoteValue): InterchangeNoteValue {
  return { beats: fraction(value.beats), parts: value.parts.map(part) };
}

function pitch(value: { step: InterchangePitch['step']; alter: -1 | 0 | 1; octave: number }): InterchangePitch {
  return { step: value.step, alter: value.alter, octave: value.octave };
}

function syllable(value: { text: string; hyphenToNext: boolean; extend: boolean } | null): InterchangeSyllable | null {
  return value ? { text: value.text, hyphenToNext: value.hyphenToNext, extend: value.extend } : null;
}

function lyricSlots(values: readonly ({ text: string; hyphenToNext: boolean; extend: boolean } | null)[]): InterchangeLyricSlot[] {
  const slots: InterchangeLyricSlot[] = [];
  for (let index = 0; index < values.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(values, index) || values[index] === undefined) slots.push({ kind: 'omitted' });
    else slots.push(syllable(values[index]));
  }
  return slots;
}

function techniques(value: Record<string, unknown> | undefined): InterchangeNoteTechniques | undefined {
  if (!value) return undefined;
  return {
    ...(value.connection === undefined ? {} : { connection: value.connection as NonNullable<InterchangeNoteTechniques['connection']> }),
    ...(value.bend === undefined ? {} : { bend: value.bend as number }),
    ...(['vibrato', 'staccato', 'tenuto', 'fermata', 'breath', 'grace', 'slurStart', 'slurEnd', 'palmMute', 'letRing'] as const)
      .reduce((out, key) => value[key] === undefined ? out : { ...out, [key]: value[key] as boolean }, {} as Record<string, boolean>)
  };
}

function event(value: ScoreEvent): InterchangeEvent {
  switch (value.kind) {
    case 'keyChange': return { kind: value.kind, key: value.key };
    case 'tempoChange': return { kind: value.kind, bpm: value.bpm };
    case 'tempoMark': return { kind: value.kind, mark: value.mark };
    case 'timeSignatureChange': return { kind: value.kind, timeSignature: { ...value.timeSignature, groups: [...value.timeSignature.groups] } };
    case 'feelChange': return { kind: value.kind, feel: value.feel };
    case 'dynamic': return { kind: value.kind, dynamic: value.dynamic };
    case 'rehearsalMark': return { kind: value.kind, text: value.text };
    case 'text': return { kind: value.kind, text: value.text };
    case 'ottavaChange': return { kind: value.kind, ottava: value.ottava };
  }
}

function convertNote(value: import('../melody').MelodyNote): InterchangeNote {
  return {
    isRest: value.isRest,
    ...(value.pitch ? { pitch: pitch(value.pitch) } : {}),
    ...(value.pitches ? { pitches: value.pitches.map(pitch) } : {}),
    duration: { beats: fraction(value.beats), parts: value.parts.map(part) },
    ...(value.techniques ? { techniques: techniques(value.techniques as unknown as Record<string, unknown>) } : {}),
    tieToNext: value.tieToNext,
    tiedFromPrev: value.tiedFromPrev,
    syllables: lyricSlots(value.syllables)
  };
}

function convertTabVoices(value: NonNullable<import('../compiler').MeasureData['tabVoices']>): InterchangeTabVoice[] {
  return value.map(voice => ({
    voice: voice.voice,
    beats: voice.beats.map(beat => ({
      isRest: beat.isRest,
      duration: noteValue(beat.duration),
      notes: beat.notes.map(note => ({
        string: note.string,
        ...(note.fret === undefined ? {} : { fret: note.fret }),
        dead: note.dead,
        tieToNext: note.tieToNext,
        effects: note.effects.map(effect => ({
          name: effect.name,
          args: Object.fromEntries(Object.entries(effect.args).map(([key, val]) => [key, copyEffectValue(val)]))
        }))
      })),
      effects: beat.effects.map(effect => ({
        name: effect.name,
        args: Object.fromEntries(Object.entries(effect.args).map(([key, val]) => [key, copyEffectValue(val)]))
      })),
      syllables: lyricSlots(beat.syllables)
    }))
  }));
}

function copyEffectValue(value: unknown): import('./model').InterchangeEffectValue {
  if (Array.isArray(value)) return value.map(copyEffectValue);
  if (value && typeof value === 'object') {
    const f = value as { n?: number; d?: number };
    if (typeof f.n === 'number' && typeof f.d === 'number') return fraction({ n: f.n, d: f.d });
  }
  return value as string | number;
}

function convertRhythm(value: import('../compiler').RhythmItem): InterchangeRhythmEvent {
  const parsed = value.inlineDuration ?? parseRhythmDurationDetailed(value.duration);
  if (typeof parsed === 'string') throw new RangeError(`unrepresentable rhythm duration ${value.duration}`);
  const baseDuration = noteValue(parsed);
  const convertedDuration = value.techniques?.grace ? { ...baseDuration, beats: { n: 0, d: 1 } } : baseDuration;
  return {
    duration: convertedDuration,
    isRest: value.isRest,
    down: value.down,
    up: value.up,
    ghost: value.ghost,
    accent: value.accent,
    tie: value.tie,
    ...(value.arpeggio ? { arpeggio: true } : {}),
    ...(value.pitch ? { pitch: pitch(value.pitch) } : {}),
    ...(value.pitches ? { pitches: value.pitches.map(pitch) } : {}),
    ...(value.inlineLyric === undefined ? {} : { inlineLyric: value.inlineLyric }),
    ...(value.techniques ? { techniques: techniques(value.techniques as unknown as Record<string, unknown>) } : {})
  };
}

function failure(
  code: Extract<InterchangeResult<unknown>, { ok: false }>['code'],
  diagnostics: readonly ScoreDiagnostic[],
  errors: readonly InterchangeError[] = [],
  loss: InterchangeLossReport = emptyLossReport()
): InterchangeResult<InterchangeScore> {
  return { ok: false, code, diagnostics: [...diagnostics], errors: [...errors], loss };
}

/** Creates an owned, format-neutral snapshot from one validated GuitarDSL source. */
export function guitarDslToInterchange(source: string): InterchangeResult<InterchangeScore> {
  if (typeof source !== 'string') return failure('invalidSource', [], [{ code: 'invalidSourceType', path: '', detail: 'Source must be a string.' }]);
  const parsed = parseGuitarDsl(source);
  const arrangementScan = scanArrangementBlockLines(source.split(/\r?\n/));
  return parsedScoreToInterchange(parsed, arrangementScan);
}

/** Internal mapper shared with the serializer's single required reparse. Not exported from the public barrel. */
export function parsedScoreToInterchange(score: ParsedScore, arrangementScan: ArrangementScanResult): InterchangeResult<InterchangeScore> {
  const loss = emptyLossReport();
  const diagnostics = score.diagnostics;
  if (!score.playOrder.valid) return failure('invalidPlayOrder', diagnostics, [], loss);
  if (diagnostics.some(item => item.severity === 'error')) return failure('invalidSource', diagnostics, [], loss);
  if (score.measures.length === 0) return failure('invalidSource', diagnostics, [{ code: 'emptyScore', path: '/measures', detail: 'At least one written measure is required.' }], loss);

  const orphanEvents = score.events.map((value, index) => ({ value, index })).filter(({ value }) => value.beforeMeasure >= score.measures.length);
  if (orphanEvents.length) {
    let report = loss;
    for (const orphan of orphanEvents) report = appendLoss(report, {
      category: 'unsupported', code: 'orphanScoreEvent', path: `/events/${orphan.index}`,
      detail: 'The score event occurs after the final written measure and has no InterchangeMeasure owner.'
    });
    return failure('unrepresentableValue', diagnostics, orphanEvents.map(item => ({ code: 'orphanEventUnrepresentable', path: `/events/${item.index}`, detail: 'Orphan event cannot be assigned to a written measure.' })), report);
  }

  try {
    const bpm = Number(score.bpm);
    const pageStarts = new Set<number>();
    for (const page of score.pages.slice(1)) {
      const first = page.measures[0]?.measureIndex;
      if (first !== undefined) pageStarts.add(first);
    }
    const measures = score.measures.map((measure, index) => {
      const offsets = measure.chordBeatOffsets;
      if (offsets.length !== measure.chords.length) throw new RangeError(`chord offset count mismatch at measure ${index}`);
      return {
        index,
        ...(measure.sectionName ? { sectionStart: measure.sectionName } : {}),
        ...(pageStarts.has(index) ? { pageBreakBefore: true } : {}),
        expectedBeats: fraction(measure.expectedBeats),
        ...(measure.isPickup ? { isPickup: true } : {}),
        barline: {
          repeatStart: measure.repeatStart,
          repeatEnd: measure.repeatEnd,
          doubleEnd: measure.doubleEnd,
          finalEnd: measure.finalEnd ?? false,
          ...(measure.bracket ? { bracket: measure.bracket } : {}),
          ...(measure.specialMark ? { specialMark: measure.specialMark } : {})
        },
        eventsBefore: measure.eventsBefore.map(event),
        chords: measure.chords.map((chord, chordIndex) => ({
          name: chord.name,
          ...(chord.label === undefined ? {} : { label: chord.label }),
          beatOffset: fraction(offsets[chordIndex])
        })),
        chordPlacementMode: measure.chordPlacementMode,
        rhythm: {
          origin: measure.rhythmOrigin,
          events: measure.rhythms.map(convertRhythm)
        },
        ...(measure.lyric ? { measureLyric: measure.lyric } : {}),
        ...(measure.melody ? { melody: measure.melody.map(convertNote) } : {}),
        ...(measure.tabVoices ? { tabVoices: convertTabVoices(measure.tabVoices) } : {})
      };
    });
    const scoreIR: InterchangeScore = {
      schemaVersion: 1,
      metadata: {
        title: score.title,
        artist: score.artist,
        memo: score.memo,
        key: score.originalKey,
        bpm,
        capo: Number(score.capo),
        tuning: { openMidi: [...score.tuning.openMidi] as [number, number, number, number, number, number], ...(score.tuning.preset ? { preset: score.tuning.preset } : {}) },
        timeSignature: { ...score.timeSignature, groups: [...score.timeSignature.groups] },
        feel: score.feel,
        ...(score.pickup ? { pickup: fraction(score.pickup) } : {}),
        showRhythm: score.showRhythm,
        measuresPerRow: score.measuresPerRow,
        style: { ...score.style },
        expandPageBreakRepeats: score.expandPageBreakRepeats
      },
      chordDefinitions: score.chordDefinitions.map(definition => ({
        name: definition.name,
        ...(definition.label === undefined ? {} : { label: definition.label }),
        frets: [...definition.frets],
        ...(definition.baseFret === undefined ? {} : { baseFret: definition.baseFret }),
        ...(definition.fingers === undefined || definition.fingers.every(finger => finger === null) ? {} : { fingers: [...definition.fingers] }),
        barres: definition.barres.map(barre => ({ ...barre }))
      })),
      ...(arrangementScan.present ? { arrangement: arrangementScan.entries.map(entry => ({ name: entry.name, count: entry.count, ...(entry.lyricVerse === undefined ? {} : { lyricVerse: entry.lyricVerse }) })) } : {}),
      melodyGroups: score.melodyGroups.map(group => ({ ...group })),
      measures
    };
    const errors = validateInterchangeScore(scoreIR);
    if (errors.length) return failure('unrepresentableValue', diagnostics, errors, loss);
    return { ok: true, value: scoreIR, loss, warnings: diagnostics.filter(item => item.severity === 'warning').map(item => ({ ...item, ...(item.args ? { args: { ...item.args } } : {}) })) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Conversion exceeded the supported exact-value range.';
    return failure('unrepresentableValue', diagnostics, [{ code: 'exactValueOutOfRange', path: '', detail }], loss);
  }
}
