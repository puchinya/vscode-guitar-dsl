// Transcription pipeline: baseline pass -> harmony refinement -> (ambiguity verification) ->
// groove refinement + strumming optimizer (or explicit preset) -> BPM / capo -> strict validation.
// VS Code independent; the Gemini SDK stays behind gemini.ts.

import {
  DEFAULT_GEMINI_MODEL, GeminiClientLike, SongSkeletonSection, VerificationItem,
  buildGroovePrompt, buildHarmonyPrompt, buildRetryPrompt, buildVerificationPrompt,
  createGeminiClient, createStructuredInteraction, runBaselinePass
} from './gemini';
import {
  HARMONY_REFINEMENT_JSON_SCHEMA, HARMONY_VERIFICATION_JSON_SCHEMA, HarmonyRefinement, SongShape,
  chooseChords, findAmbiguousEvents, harmonyToChordEvents, validateHarmonyRefinement
} from './harmonyRefinement';
import { BeatType, GROOVE_REFINEMENT_JSON_SCHEMA, GrooveRefinement, optimizeGroove, validateGrooveRefinement } from './grooveOptimizer';
import { applyCapo, chooseCapo } from './capoOptimizer';
import { RhythmEvent, TranscribedSong, validateTranscribedSong } from './model';
import { getPresetById, parsePresetStrokes } from '../strummingPatterns';

export type TranscriptionStage = 'baseline' | 'harmony' | 'verification' | 'groove' | 'finalizing';

export interface TranscriptionPipelineOptions {
  apiKey: string;
  youtubeUrl: string;
  model?: string;
  beatType?: BeatType;
  /** 'auto' or undefined runs groove refinement; any preset id is a hard override. */
  strummingPresetId?: string;
  /** Manual BPM override (30..300). */
  bpm?: number;
  /** Manual capo override (0..12). */
  capo?: number;
  client?: GeminiClientLike;
  onStage?: (stage: TranscriptionStage) => void;
}

const LYRIC_HINT_LENGTH = 12;

export function buildSongSkeleton(song: TranscribedSong): SongSkeletonSection[] {
  return song.sections.map((section, sectionIndex) => ({
    sectionIndex,
    name: section.name,
    measureCount: section.measures.length,
    lyricHints: section.measures.map(measure => {
      const syllables = measure.melody?.map(n => n.lyric ?? '').join('') ?? '';
      const text = syllables || (typeof measure.lyrics === 'string' ? measure.lyrics : '');
      return text.slice(0, LYRIC_HINT_LENGTH);
    })
  }));
}

function textInput(text: string): unknown[] {
  return [{ type: 'text', text }];
}

/**
 * Structured follow-up with one retry on a structural (shape) validation failure. The retry chains
 * from the invalid answer and repeats the request with the error and the baseline skeleton.
 */
async function refineWithRetry<T>(
  client: GeminiClientLike,
  model: string,
  previousInteractionId: string,
  prompt: string,
  schema: object,
  skeleton: SongSkeletonSection[],
  validate: (json: unknown) => { valid: true; refinement: T } | { valid: false; error: string },
  label: string
): Promise<{ refinement: T; id: string }> {
  const first = await createStructuredInteraction({ client, model, input: textInput(prompt), schema, previousInteractionId });
  const firstCheck = validate(first.json);
  if (firstCheck.valid) return { refinement: firstCheck.refinement, id: first.id };

  const retry = await createStructuredInteraction({
    client,
    model,
    input: textInput(buildRetryPrompt(firstCheck.error, skeleton) + prompt),
    schema,
    previousInteractionId: first.id
  });
  const retryCheck = validate(retry.json);
  if (retryCheck.valid) return { refinement: retryCheck.refinement, id: retry.id };
  throw new Error(`Invalid ${label} refinement: ${retryCheck.error}`);
}

function verificationItems(refinement: HarmonyRefinement, topNames: string[][][]): VerificationItem[] {
  const flat: { s: number; m: number; c: number }[] = [];
  refinement.sections.forEach((section, s) =>
    section.measures.forEach((measure, m) => measure.changes.forEach((_, c) => flat.push({ s, m, c }))));
  const position = new Map(flat.map((p, i) => [`${p.s}:${p.m}:${refinement.sections[p.s].measures[p.m].changes[p.c].tick16}`, i]));
  const nameAt = (i: number) => (i >= 0 && i < flat.length ? topNames[flat[i].s][flat[i].m][flat[i].c] : undefined);

  return findAmbiguousEvents(refinement).map(e => {
    const i = position.get(`${e.sectionIndex}:${e.measureIndex}:${e.tick16}`)!;
    return {
      sectionIndex: e.sectionIndex,
      measureIndex: e.measureIndex,
      tick16: e.tick16,
      candidates: e.candidates.map(c => c.name),
      previousChord: nameAt(i - 1),
      nextChord: nameAt(i + 1)
    };
  });
}

function presetRhythm(presetId: string): RhythmEvent[] {
  const preset = getPresetById(presetId);
  if (!preset) {
    throw new Error(`Unknown strumming preset '${presetId}'`);
  }
  return parsePresetStrokes(preset.pattern);
}

/**
 * Runs the whole transcription and returns a strictly validated song whose chords are play-form
 * names for the chosen capo. Throws on baseline, harmony, groove or final validation failure;
 * a verification failure falls back to the top harmony candidates.
 */
export async function runTranscriptionPipeline(options: TranscriptionPipelineOptions): Promise<TranscribedSong> {
  const model = options.model?.trim() || DEFAULT_GEMINI_MODEL;
  const client = options.client ?? createGeminiClient(options.apiKey);
  const beatType = options.beatType ?? 'auto';
  const explicitPreset = options.strummingPresetId && options.strummingPresetId !== 'auto' ? options.strummingPresetId : undefined;

  options.onStage?.('baseline');
  const baseline = await runBaselinePass({ youtubeUrl: options.youtubeUrl, model, client });
  const song = baseline.song;
  const shape: SongShape = song.sections.map(s => s.measures.length);
  const skeleton = buildSongSkeleton(song);

  options.onStage?.('harmony');
  const harmony = await refineWithRetry(
    client, model, baseline.interactionId, buildHarmonyPrompt(skeleton), HARMONY_REFINEMENT_JSON_SCHEMA, skeleton,
    json => validateHarmonyRefinement(json, shape), 'harmony'
  );
  let lastId = harmony.id;

  const topNames = chooseChords(harmony.refinement);
  let verification: unknown;
  const items = verificationItems(harmony.refinement, topNames);
  if (items.length > 0) {
    options.onStage?.('verification');
    try {
      const verified = await createStructuredInteraction({
        client, model, input: textInput(buildVerificationPrompt(items)), schema: HARMONY_VERIFICATION_JSON_SCHEMA,
        previousInteractionId: lastId
      });
      verification = verified.json;
      lastId = verified.id;
    } catch {
      verification = undefined;
    }
  }
  const chosenNames = chooseChords(harmony.refinement, verification);

  let rhythm: RhythmEvent[][][];
  if (explicitPreset) {
    const events = presetRhythm(explicitPreset);
    rhythm = shape.map(count => Array.from({ length: count }, () => events.map(e => ({ ...e }))));
  } else {
    options.onStage?.('groove');
    const groove = await refineWithRetry<GrooveRefinement>(
      client, model, lastId, buildGroovePrompt(skeleton, beatType), GROOVE_REFINEMENT_JSON_SCHEMA, skeleton,
      json => validateGrooveRefinement(json, shape, beatType), 'groove'
    );
    rhythm = optimizeGroove(groove.refinement);
  }

  options.onStage?.('finalizing');
  const refined: TranscribedSong = {
    ...song,
    key: harmony.refinement.soundingKey ?? song.key,
    sections: song.sections.map((section, s) => ({
      ...section,
      measures: section.measures.map((measure, m) => ({
        ...measure,
        chords: harmonyToChordEvents(harmony.refinement.sections[s].measures[m], chosenNames[s][m]),
        rhythm: rhythm[s][m]
      }))
    }))
  };
  if (options.bpm !== undefined) {
    refined.bpm = Math.round(options.bpm);
  }

  const capo = chooseCapo(refined, options.capo);
  const final = validateTranscribedSong(applyCapo(refined, capo));
  if (!final.valid) {
    throw new Error(`Invalid transcription data: ${final.error}`);
  }
  return final.song;
}
