import { MAX_FRET, createInstrumentModel } from '../instrumentModel';
import { detectChordNames, parseChordName } from '../chordDetect';
import type { StringFret } from '../chordDefinition';
import { appendLoss, emptyLossReport, validateInterchangeScore } from '../interchange';
import type {
  InterchangeFraction,
  InterchangeLossReport,
  InterchangeMeasure,
  InterchangeRhythmEvent,
  InterchangeScore,
  InterchangeTabBeat,
} from '../interchange';

export type Gp78StrumUnavailableReason =
  | 'noStrumPattern'
  | 'mixedMelody'
  | 'unsupportedNotes'
  | 'ambiguousHarmony'
  | 'unsupportedLyrics'
  | 'unrepresentableRhythm'
  | 'resourceLimit';

export interface Gp78StrumStats {
  readonly measures: number;
  readonly attacks: number;
  readonly inferredChords: number;
}

export type Gp78StrumPlan =
  | {
      readonly ok: true;
      readonly score: InterchangeScore;
      readonly loss: InterchangeLossReport;
      readonly stats: Gp78StrumStats;
    }
  | {
      readonly ok: false;
      readonly reason: Gp78StrumUnavailableReason;
      readonly path: string;
      readonly detail: string;
    };

const MAX_MEASURES = 2_000;
const MAX_TAB_BEATS = 20_000;
const TAB_POLICY = 'gp78.strum.drop-tab-note-details.v1';
const INFERENCE_POLICY = 'gp78.strum.unique-chord-inference.v1';
const RHYTHM_POLICY = 'gp78.strum.force-rhythm-visible.v1';
const LYRIC_POLICY = 'gp78.strum.measure-lyric.v1';

interface Attack {
  readonly beat: InterchangeTabBeat;
  readonly offset: InterchangeFraction;
  readonly frets: StringFret[];
  readonly candidateNames: readonly string[];
}

interface MeasurePlan {
  readonly measure: InterchangeMeasure;
  readonly rhythm: readonly InterchangeRhythmEvent[];
  readonly chords: InterchangeMeasure['chords'];
  readonly measureLyric?: string;
  readonly hasLyric: boolean;
  readonly noteCount: number;
  readonly attacks: number;
  readonly inferred: readonly { readonly offset: InterchangeFraction; readonly name: string }[];
}

function unavailable(
  reason: Gp78StrumUnavailableReason,
  path: string,
  detail: string
): Gp78StrumPlan {
  return { ok: false, reason, path, detail };
}

function gcd(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right !== 0n) [left, right] = [right, left % right];
  return left || 1n;
}

function addFractions(a: InterchangeFraction, b: InterchangeFraction): InterchangeFraction | null {
  const n = BigInt(a.n) * BigInt(b.d) + BigInt(b.n) * BigInt(a.d);
  const d = BigInt(a.d) * BigInt(b.d);
  const divisor = gcd(n, d);
  const reducedN = n / divisor;
  const reducedD = d / divisor;
  const numberN = Number(reducedN);
  const numberD = Number(reducedD);
  if (!Number.isSafeInteger(numberN) || !Number.isSafeInteger(numberD) || numberD <= 0) return null;
  return { n: numberN, d: numberD };
}

function compareFractions(a: InterchangeFraction, b: InterchangeFraction): number {
  const left = BigInt(a.n) * BigInt(b.d);
  const right = BigInt(b.n) * BigInt(a.d);
  return left === right ? 0 : left < right ? -1 : 1;
}

function fractionKey(value: InterchangeFraction): string {
  return `${value.n}/${value.d}`;
}

function formatFraction(value: InterchangeFraction): string {
  return value.d === 1 ? String(value.n) : `${value.n}/${value.d}`;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => cloneValue(item)) as T;
  if (value && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) copy[key] = cloneValue(child);
    return copy as T;
  }
  return value;
}

function safeLyric(text: string): boolean {
  return text.length > 0 && !/["\\\r\n\u0000-\u001f\u007f]/u.test(text);
}

function extractMeasureLyric(measure: InterchangeMeasure, measureIndex: number):
  | { readonly ok: true; readonly text?: string }
  | { readonly ok: false; readonly path: string; readonly detail: string } {
  const voices = measure.tabVoices ?? [];
  const beats = voices.flatMap(voice => voice.beats);
  const occupied = beats.flatMap((beat, beatIndex) => beat.syllables.map((slot, slotIndex) => ({ beat, beatIndex, slot, slotIndex })));
  if (occupied.length === 0) return { ok: true, ...(measure.measureLyric === undefined ? {} : { text: measure.measureLyric }) };

  const path = `/measures/${measureIndex}/tabVoices`;
  const firstSoundingIndex = beats.findIndex(beat => !beat.isRest);
  const firstSounding = firstSoundingIndex >= 0 ? beats[firstSoundingIndex] : undefined;
  const slotsBefore = beats.slice(0, Math.max(firstSoundingIndex, 0)).some(beat => beat.syllables.length > 0);
  if (!firstSounding || slotsBefore || firstSoundingIndex !== 0 || firstSounding.syllables.length !== 1) {
    return { ok: false, path, detail: 'Lyrics require one safe syllable on the first sounding beat at measure offset zero.' };
  }
  const first = firstSounding.syllables[0];
  if (!first || typeof first !== 'object' || !('text' in first) || first.hyphenToNext || first.extend || !safeLyric(first.text)) {
    return { ok: false, path: `${path}/0/beats/${firstSoundingIndex}/syllables/0`, detail: 'The first lyric slot must be one safe, unhyphenated syllable without an extension.' };
  }
  const hasOtherSlots = beats.some((beat, index) => index !== firstSoundingIndex && beat.syllables.length > 0);
  if (hasOtherSlots) return { ok: false, path, detail: 'Additional lyric slots, skips, and omissions cannot be retained in optimized rhythm notation.' };
  if (measure.measureLyric !== undefined && measure.measureLyric !== first.text) {
    return { ok: false, path: `/measures/${measureIndex}/measureLyric`, detail: 'The existing measure lyric conflicts with the TAB lyric.' };
  }
  return { ok: true, text: first.text };
}

function exactChordName(name: string, pitches: readonly number[]): boolean {
  const parsed = parseChordName(name);
  if (!parsed?.quality) return false;
  const pitchClasses = new Set(pitches.map(pitch => pitch % 12));
  const chordClasses = new Set(parsed.quality.intervals.map(interval => (parsed.rootPc + interval) % 12));
  const exact = pitchClasses.size === chordClasses.size && [...pitchClasses].every(pitch => chordClasses.has(pitch));
  const omitFifth = parsed.quality.intervals.length >= 4 && parsed.quality.intervals.includes(7) &&
    ![...pitchClasses].some(pitch => pitch === (parsed.rootPc + 7) % 12) &&
    (() => {
      const withoutFifth = parsed.quality!.intervals.filter(interval => interval !== 7)
        .map(interval => (parsed.rootPc + interval) % 12);
      return pitchClasses.size === withoutFifth.length && withoutFifth.every(pitch => pitchClasses.has(pitch));
    })();
  if (!exact && !omitFifth) return false;
  const bassPc = Math.min(...pitches) % 12;
  return parsed.bassPc === undefined ? parsed.rootPc === bassPc : parsed.bassPc === bassPc;
}

function compatibleExplicitName(sourceName: string, candidateNames: readonly string[]): boolean {
  const source = parseChordName(sourceName);
  if (!source?.quality) return false;
  return candidateNames.some(name => {
    const candidate = parseChordName(name);
    return candidate?.quality !== undefined &&
      candidate.rootPc === source.rootPc && candidate.suffix === source.suffix &&
      candidate.bassPc === source.bassPc;
  });
}

function buildAttack(
  beat: InterchangeTabBeat,
  measureIndex: number,
  beatIndex: number,
  offset: InterchangeFraction,
  instrument: ReturnType<typeof createInstrumentModel>
): { readonly ok: true; readonly attack: Attack } | { readonly ok: false; readonly plan: Gp78StrumPlan } {
  const path = `/measures/${measureIndex}/tabVoices/0/beats/${beatIndex}`;
  if (beat.effects.length > 0 || beat.isRest || beat.notes.length < 3) {
    return {
      ok: false,
      plan: unavailable('unsupportedNotes', path, 'A sounding chord-strum attack requires at least three pitched strings and no beat effects.'),
    };
  }
  const frets: StringFret[] = ['x', 'x', 'x', 'x', 'x', 'x'];
  const pitches: number[] = [];
  const chordInstrument = createInstrumentModel(instrument.tuning, 0);
  const seen = new Set<number>();
  try {
    for (const note of beat.notes) {
      if (note.dead || note.tieToNext || note.effects.length > 0 || note.fret === undefined ||
          !Number.isInteger(note.fret) || note.fret < 0 || note.fret > MAX_FRET || seen.has(note.string)) {
        return {
          ok: false,
          plan: unavailable('unsupportedNotes', path, 'Dead notes, ties, note effects, missing frets, and duplicate strings cannot be converted to chord slashes.'),
        };
      }
      instrument.pitchAt(note.string, note.fret);
      const pitch = chordInstrument.pitchAt(note.string, note.fret);
      seen.add(note.string);
      frets[6 - note.string] = note.fret;
      pitches.push(pitch);
    }
  } catch {
    return { ok: false, plan: unavailable('unsupportedNotes', path, 'A TAB note uses a string or fret outside the selected instrument range.') };
  }
  if (seen.size < 3) {
    return { ok: false, plan: unavailable('unsupportedNotes', path, 'A chord-strum attack requires three distinct pitched strings.') };
  }
  const names = detectChordNames(frets, 32, instrument)
    .filter(candidate => exactChordName(candidate.name, pitches))
    .map(candidate => candidate.name);
  if (names.length === 0) {
    return { ok: false, plan: unavailable('ambiguousHarmony', path, 'The canonical chord detector found no exact chord name for this voicing.') };
  }
  return { ok: true, attack: { beat, offset, frets, candidateNames: names } };
}

/**
 * Plan a whole-score chord-strum conversion without mutating the imported interchange snapshot.
 * The function deliberately rejects partial conversions: callers receive either a complete score
 * plan with its losses or a stable reason/path explaining why the optimization is unavailable.
 */
export function planGp78ChordStrum(score: InterchangeScore): Gp78StrumPlan {
  if (score && Array.isArray(score.measures) && score.measures.length > MAX_MEASURES) {
    return unavailable('resourceLimit', '/measures', `The optimizer supports at most ${MAX_MEASURES} written measures.`);
  }
  if (score && Array.isArray(score.measures)) {
    let tabBeatCount = 0;
    for (const measure of score.measures) {
      const voices: unknown = measure && typeof measure === 'object' ? measure.tabVoices : undefined;
      if (!Array.isArray(voices)) continue;
      for (const voice of voices) {
        const beats: unknown = voice && typeof voice === 'object' ? voice.beats : undefined;
        if (!Array.isArray(beats)) continue;
        tabBeatCount += beats.length;
        if (tabBeatCount > MAX_TAB_BEATS) {
          return unavailable('resourceLimit', '/measures', `The optimizer supports at most ${MAX_TAB_BEATS} TAB beats.`);
        }
      }
    }
  }

  let validation;
  try {
    validation = validateInterchangeScore(score);
  } catch (error) {
    return unavailable('unsupportedNotes', '', error instanceof Error ? error.message : 'The interchange score is invalid.');
  }
  if (validation.length > 0) {
    const first = validation[0];
    const text = `${first.code} ${first.path}`.toLowerCase();
    const reason: Gp78StrumUnavailableReason = /lyric|syllable/.test(text)
      ? 'unsupportedLyrics'
      : /melody/.test(text)
        ? 'mixedMelody'
        : /chord/.test(text)
          ? 'ambiguousHarmony'
          : /duration|rhythm|expectedbeats|fraction/.test(text)
            ? 'unrepresentableRhythm'
            : 'unsupportedNotes';
    return unavailable(reason, first.path, `${first.code}: ${first.detail}`);
  }
  if (score.melodyGroups.length > 0 || score.measures.some(measure => (measure.melody?.length ?? 0) > 0)) {
    return unavailable('mixedMelody', '/melodyGroups', 'Independent melody content cannot be represented as chord-strum rhythm slashes.');
  }

  let instrument: ReturnType<typeof createInstrumentModel>;
  try {
    instrument = createInstrumentModel(score.metadata.tuning, score.metadata.capo);
  } catch (error) {
    return unavailable('unsupportedNotes', '/metadata/tuning', error instanceof Error ? error.message : 'The selected guitar tuning is invalid.');
  }

  const measurePlans: MeasurePlan[] = [];
  let totalAttacks = 0;
  let inferredCount = 0;
  for (let measureIndex = 0; measureIndex < score.measures.length; measureIndex += 1) {
    const measure = score.measures[measureIndex];
    const voices = measure.tabVoices ?? [];
    if (voices.some(voice => voice.voice !== 1) || voices.length > 1) {
      return unavailable('unsupportedNotes', `/measures/${measureIndex}/tabVoices`, 'Only one TAB voice (voice 1) can be optimized.');
    }
    if (measure.rhythm.events.length > 0) {
      return unavailable('unrepresentableRhythm', `/measures/${measureIndex}/rhythm/events`, 'Existing rhythm events cannot be combined with imported TAB attacks safely.');
    }
    const lyric = extractMeasureLyric(measure, measureIndex);
    if (!lyric.ok) return unavailable('unsupportedLyrics', lyric.path, lyric.detail);

    const beats = voices[0]?.beats ?? [];
    let offset: InterchangeFraction = { n: 0, d: 1 };
    let durationSum: InterchangeFraction = { n: 0, d: 1 };
    const attacks: Attack[] = [];
    const rhythm: InterchangeRhythmEvent[] = [];
    let noteCount = 0;
    for (let beatIndex = 0; beatIndex < beats.length; beatIndex += 1) {
      const beat = beats[beatIndex];
      const nextDuration = addFractions(durationSum, beat.duration.beats);
      if (!nextDuration) {
        return unavailable('unrepresentableRhythm', `/measures/${measureIndex}/tabVoices/0/beats/${beatIndex}/duration`, 'Summed beat durations exceed the exact rational range.');
      }
      durationSum = nextDuration;
      if (beat.isRest) {
        if (beat.notes.length > 0 || beat.effects.length > 0) {
          return unavailable('unsupportedNotes', `/measures/${measureIndex}/tabVoices/0/beats/${beatIndex}`, 'A rest cannot also contain pitched notes or beat effects.');
        }
      } else {
        const built = buildAttack(beat, measureIndex, beatIndex, offset, instrument);
        if (!built.ok) return built.plan;
        attacks.push(built.attack);
        noteCount += beat.notes.length;
      }
      rhythm.push({
        duration: cloneValue(beat.duration),
        isRest: beat.isRest,
        down: false,
        up: false,
        ghost: false,
        accent: false,
        tie: false,
      });
      const nextOffset = addFractions(offset, beat.duration.beats);
      if (!nextOffset) {
        return unavailable('unrepresentableRhythm', `/measures/${measureIndex}/tabVoices/0/beats/${beatIndex}/duration`, 'Beat onset exceeds the exact rational range.');
      }
      offset = nextOffset;
    }
    if (beats.length > 0 && compareFractions(durationSum, measure.expectedBeats) !== 0) {
      return unavailable('unrepresentableRhythm', `/measures/${measureIndex}/tabVoices/0/beats`, 'The TAB beat durations do not exactly fill the written measure.');
    }
    if (attacks.length === 1) {
      return unavailable('noStrumPattern', `/measures/${measureIndex}/tabVoices/0`, 'Every sounding measure must contain at least two chord-strum attacks.');
    }

    const explicitByOffset = new Map<string, typeof measure.chords>();
    for (const chord of measure.chords) {
      const key = fractionKey(chord.beatOffset);
      explicitByOffset.set(key, [...(explicitByOffset.get(key) ?? []), chord]);
    }
    const attackByOffset = new Map(attacks.map(attack => [fractionKey(attack.offset), attack]));
    if (attacks.length > 0) {
      for (const [key, chords] of explicitByOffset) {
        const attack = attackByOffset.get(key);
        if (!attack || chords.length !== 1) {
          return unavailable('ambiguousHarmony', `/measures/${measureIndex}/chords`, 'Every explicit chord symbol must match exactly one TAB attack boundary.');
        }
        const candidateNames = attack.candidateNames;
        if (!compatibleExplicitName(chords[0].name, candidateNames)) {
          return unavailable('ambiguousHarmony', `/measures/${measureIndex}/chords`, `Explicit chord ${chords[0].name} does not match the notes at beat ${formatFraction(attack.offset)}.`);
        }
      }
    }

    const outputChords: InterchangeMeasure['chords'][number][] = attacks.length === 0
      ? measure.chords.map(chord => cloneValue(chord))
      : [];
    const inferred: { offset: InterchangeFraction; name: string }[] = [];
    let lastExplicit: InterchangeMeasure['chords'][number] | undefined;
    for (const attack of attacks) {
      const sourceChords = explicitByOffset.get(fractionKey(attack.offset)) ?? [];
      if (sourceChords.length === 1) {
        outputChords.push(cloneValue(sourceChords[0]));
        lastExplicit = sourceChords[0];
        continue;
      }
      const candidates = attack.candidateNames;
      if (lastExplicit && compatibleExplicitName(lastExplicit.name, candidates)) {
        outputChords.push({
          name: lastExplicit.name,
          ...(lastExplicit.label === undefined ? {} : { label: lastExplicit.label }),
          beatOffset: cloneValue(attack.offset),
        });
        continue;
      }
      lastExplicit = undefined;
      if (candidates.length !== 1) {
        return unavailable('ambiguousHarmony', `/measures/${measureIndex}/tabVoices/0`, `Beat ${formatFraction(attack.offset)} has ${candidates.length} exact chord names; add an explicit compatible chord symbol or use faithful import.`);
      }
      const name = candidates[0];
      outputChords.push({ name, beatOffset: cloneValue(attack.offset) });
      inferred.push({ offset: cloneValue(attack.offset), name });
    }
    totalAttacks += attacks.length;
    inferredCount += inferred.length;
    measurePlans.push({
      measure,
      rhythm,
      chords: outputChords,
      ...(lyric.text === undefined ? {} : { measureLyric: lyric.text }),
      hasLyric: lyric.text !== undefined && voices.some(voice => voice.beats.some(beat => beat.syllables.length > 0)),
      noteCount,
      attacks: attacks.length,
      inferred,
    });
  }

  if (totalAttacks < 2) {
    return unavailable('noStrumPattern', '/measures', 'The score has fewer than two chord-strum attacks.');
  }

  let loss = emptyLossReport();
  for (let index = 0; index < measurePlans.length; index += 1) {
    const plan = measurePlans[index];
    if ((plan.measure.tabVoices?.length ?? 0) > 0) {
      loss = appendLoss(loss, {
        category: 'droppedByPolicy',
        code: 'optimizedTabToRhythm',
        path: `/measures/${index}/tabVoices`,
        detail: `Measure ${index + 1}: removed TAB detail for ${plan.noteCount} note(s) across ${plan.attacks} attack(s); exact beat timing and rests remain.`,
        policyId: TAB_POLICY,
      });
    }
    for (const item of plan.inferred) {
      loss = appendLoss(loss, {
        category: 'inferred',
        code: 'inferredStrumChord',
        path: `/measures/${index}/chords@${fractionKey(item.offset)}`,
        detail: `Inferred ${item.name} at measure ${index + 1}, beat ${formatFraction(item.offset)} from one exact chord candidate.`,
        policyId: INFERENCE_POLICY,
      });
    }
    if (plan.hasLyric) {
      loss = appendLoss(loss, {
        category: 'approximated',
        code: 'adaptedMeasureLyric',
        path: `/measures/${index}/measureLyric`,
        detail: `Moved the single safe TAB syllable to measure ${index + 1} as its measure lyric.`,
        policyId: LYRIC_POLICY,
      });
    }
  }
  if (!score.metadata.showRhythm) {
    loss = appendLoss(loss, {
      category: 'droppedByPolicy',
      code: 'enabledRhythmDisplay',
      path: '/metadata/showRhythm',
      detail: 'Enabled rhythm display so the optimized strum slashes are visible.',
      policyId: RHYTHM_POLICY,
    });
  }

  const transformedMeasures = measurePlans.map(plan => {
    const { tabVoices: _tabVoices, ...preserved } = cloneValue(plan.measure);
    return {
      ...preserved,
      chords: cloneValue(plan.chords),
      chordPlacementMode: 'inline' as const,
      rhythm: { origin: 'explicit' as const, events: cloneValue(plan.rhythm) },
      ...(plan.measureLyric === undefined ? {} : { measureLyric: plan.measureLyric }),
    };
  });
  const transformed: InterchangeScore = {
    ...cloneValue(score),
    metadata: { ...cloneValue(score.metadata), showRhythm: true },
    measures: transformedMeasures,
  };
  return {
    ok: true,
    score: transformed,
    loss,
    stats: { measures: score.measures.length, attacks: totalAttacks, inferredChords: inferredCount },
  };
}
