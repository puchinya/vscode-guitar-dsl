// Gemini API adapter for YouTube audio transcription.
// Encapsulates all @google/genai SDK dependencies.

import { GoogleGenAI } from '@google/genai';
import { MUSIC_IR_JSON_SCHEMA, TranscribedSong, validateBaselineSong } from './model';
import { normalizeYouTubeUrl } from './youtube';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

/** Models known to support agentic video processing; other/custom models keep the default. */
export const AGENTIC_VIDEO_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];

export const FIXED_TRANSCRIPTION_PROMPT =
  'Transcribe the song structure, sounding chords, vocal melody notes, and vocal lyrics from this YouTube video. ' +
  'IMPORTANT: Transcribe the FULL, COMPLETE song from beginning to end without summarizing or skipping measures. ' +
  'Cover all sections sequentially (Intro, Verse, Pre-Chorus, Chorus, Bridge, Solo, Outro, etc.) until the video finishes. ' +
  'Report the sounding (concert) key and sounding chord names; do not transpose for a capo. ' +
  'STRICT SYLLABLE-TO-NOTE ALIGNMENT: Every sung syllable must have its own melody note with exact pitch and duration. ' +
  'IMPORTANT FOR JAPANESE LYRICS: Small kana (ゃ, ゅ, ょ, っ, ぁ, ぃ, ぅ, ぇ, ぉ, ゎ, ッ etc.) and long vowel mark (ー) must NEVER be standalone syllables or assigned to separate notes. They MUST always attach to the preceding character (e.g. "きょ", "がっ", "こー", "ふぁ") as a single syllable for one note. ' +
  'For example, if 8 syllables are sung in a measure ("き・ど・う・し・た・きょ・う・に"), output 8 eighth-notes (duration: "8"), each with its exact single syllable in the lyric property. Do NOT lump syllables together or simplify the vocal rhythm. ' +
  'TEMPO / BPM ACCURACY: Carefully detect the true tempo (BPM) from the rhythm section. In upbeat rock/pop 8-beat songs (like BPM 160-220), do NOT mistake the tempo as half-time (e.g. 80-110). Standard 8-beat has the bass drum on beats 1 & 3 and snare drum on beats 2 & 4 at the fast tempo (e.g. around BPM 185 for fast rock). Count each quarter-note beat where snare hits on 2 & 4 to determine the exact BPM. ' +
  'Output the transcription as structured music IR adhering to the provided JSON schema. ' +
  'The time signature must be 4/4. Melody sequences within each measure must sum to exactly 4 beats. If a vocal melody phrase finishes or pauses early in a measure, ' +
  'you MUST fill the remaining beats of that measure with rest note(s) (pitch: "r") so that every measure sums to EXACTLY 4 beats. ' +
  'When melody notes are tied across beats or across the barline, set tieToNext: true.';

export function buildTranscriptionPrompt(): string {
  return FIXED_TRANSCRIPTION_PROMPT;
}

/** Baseline skeleton embedded in follow-up prompts so the refinement keeps the exact measure layout. */
export interface SongSkeletonSection {
  sectionIndex: number;
  name: string;
  measureCount: number;
  /** Short lyric hint per measure ('' when instrumental). */
  lyricHints: string[];
}

function skeletonText(skeleton: SongSkeletonSection[]): string {
  return 'BASELINE STRUCTURE (authoritative; keep exactly these sections and measure counts, in this order, ' +
    'with sectionIndex and measureIndex starting at 0): ' + JSON.stringify(skeleton) + ' ';
}

export function buildHarmonyPrompt(skeleton: SongSkeletonSection[]): string {
  return 'Re-listen to the same video and refine ONLY the chord progression of the transcription above. ' +
    skeletonText(skeleton) +
    'For every measure, list each chord change with tick16 = its 16th-note position within the measure (0..15, 0 = downbeat; ' +
    'every measure must have a change at tick16 0, and ticks must strictly ascend). ' +
    'Give 1 to 3 candidate SOUNDING chord names per change (what actually sounds, never transposed for a capo), ' +
    'ordered by descending confidence (0..1). Listen to the bass line and the full harmony; borrowed chords, secondary ' +
    'dominants, slash chords and sevenths are allowed. ' +
    'SYNCOPATION / ANTICIPATION: when a chord change is anticipated before the beat (e.g. on the "and" of beat 2 = tick16 6, ' +
    'or the last eighth of a measure = tick16 14 for the next measure\'s chord), report it at the actual anticipated tick. ' +
    'A change anticipated across the barline belongs to the previous measure at its anticipated tick. ' +
    'Do NOT output durations or a capo. Optionally confirm the sounding key as soundingKey.';
}

export interface VerificationItem {
  sectionIndex: number;
  measureIndex: number;
  tick16: number;
  candidates: string[];
  previousChord?: string;
  nextChord?: string;
}

export function buildVerificationPrompt(items: VerificationItem[]): string {
  return 'Some chord changes above are uncertain. Re-check the video at each listed position and, for each item, ' +
    'select exactly one name from its candidates. You MUST NOT answer a chord that is not in the candidates list. ' +
    'Neighboring chords are given as context. Items: ' + JSON.stringify(items);
}

export function buildGroovePrompt(skeleton: SongSkeletonSection[], beatType: 'auto' | '8beat' | '16beat'): string {
  const gridRule = beatType === '8beat'
    ? 'Use grid 8 for every measure. '
    : beatType === '16beat'
      ? 'Use grid 16 for every measure. '
      : 'Choose grid 8 (eighths), 12 (eighth-note triplets / shuffle) or 16 (sixteenths) per measure. ';
  return 'Re-listen to the same video and observe ONLY the guitar accompaniment rhythm. ' +
    skeletonText(skeleton) +
    gridRule +
    'For every measure report: style (strum, arpeggio for picked/broken chords, or sustain for held whole/half-note chords); ' +
    'attacks = ascending grid slots (0..grid-1) where the guitar actually strikes; ' +
    'accents = only the clearly accented attack slots (omit if unsure); ' +
    'sustainFromPrevious = true only when the previous measure\'s last stroke is held across the barline (syncopated tie) and there is no new attack on beat 1; ' +
    'confidence 0..1. Include syncopated attacks exactly where they occur. ' +
    'Do NOT output stroke directions or note durations.';
}

export function buildRetryPrompt(error: string, skeleton: SongSkeletonSection[]): string {
  return `Your previous answer was structurally invalid: ${error}. Answer the same request again. ` + skeletonText(skeleton);
}

export interface GeminiClientLike {
  interactions: {
    create: (params: any) => Promise<any>;
  };
}

export function createGeminiClient(apiKey: string): GeminiClientLike {
  return new GoogleGenAI({ apiKey });
}

function extractTextFromOutput(interaction: any): string | undefined {
  if (typeof interaction.output_text === 'string' && interaction.output_text.trim()) {
    return interaction.output_text.trim();
  }

  // Fallback to checking steps if output_text is not populated
  if (Array.isArray(interaction.steps)) {
    for (const step of interaction.steps) {
      if (step.type === 'model_output' && Array.isArray(step.content)) {
        for (const content of step.content) {
          if (content.type === 'text' && typeof content.text === 'string') {
            return content.text.trim();
          }
          if (Array.isArray(content.parts)) {
            for (const part of content.parts) {
              if (typeof part.text === 'string') {
                return part.text.trim();
              }
            }
          }
        }
      }
    }
  }

  return undefined;
}

function classifyGeminiError(err: unknown): Error {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('api_key') || msg.includes('api key') || msg.includes('unauthenticated') || msg.includes('auth')) {
      return new Error('Gemini API authentication failed. Please check your API key.');
    }
    if (msg.includes('quota') || msg.includes('rate limit') || msg.includes('resource_exhausted')) {
      return new Error('Gemini API quota exceeded or rate limit reached. Please try again later.');
    }
    if (msg.includes('not found') || msg.includes('video') || msg.includes('unsupported')) {
      return new Error('The requested YouTube video could not be processed or is unavailable.');
    }
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused') || msg.includes('etimedout')) {
      return new Error('Network error while connecting to Gemini API. Please check your internet connection.');
    }
    // Return sanitized message without stack traces or secrets
    return new Error(`Gemini API error: ${err.message.split('\n')[0]}`);
  }
  return new Error('An unknown error occurred while communicating with the Gemini API.');
}

export interface StructuredInteractionRequest {
  client: GeminiClientLike;
  model: string;
  input: unknown[];
  schema: object;
  previousInteractionId?: string;
}

export interface StructuredInteractionResult {
  id: string;
  json: unknown;
}

/**
 * One stored interactions.create call with a JSON-schema response. The response format is always
 * re-specified; follow-ups chain through previous_interaction_id. Never logs keys or responses.
 */
export async function createStructuredInteraction(request: StructuredInteractionRequest): Promise<StructuredInteractionResult> {
  const params: Record<string, unknown> = {
    model: request.model,
    input: request.input,
    store: true,
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: request.schema
    }
  };
  if (request.previousInteractionId) {
    params.previous_interaction_id = request.previousInteractionId;
  }

  let interaction: any;
  try {
    interaction = await request.client.interactions.create(params);
  } catch (err) {
    throw classifyGeminiError(err);
  }

  if (interaction?.status === 'failed') {
    const detail = interaction.errors?.[0]?.message || 'Interaction failed';
    throw new Error(`Gemini transcription interaction failed: ${detail}`);
  }

  const rawText = extractTextFromOutput(interaction);
  if (!rawText) {
    throw new Error('Gemini API returned an empty response.');
  }

  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new Error('Gemini model response was not valid JSON.');
  }

  if (typeof interaction.id !== 'string' || !interaction.id) {
    throw new Error('Gemini API did not return an interaction id.');
  }
  return { id: interaction.id, json };
}

export interface BaselinePassOptions {
  youtubeUrl: string;
  model: string;
  client: GeminiClientLike;
}

export interface BaselinePassResult {
  song: TranscribedSong;
  interactionId: string;
}

/** Baseline pass: full-song structure, melody and lyrics from the video. Chords/rhythm are context only. */
export async function runBaselinePass(options: BaselinePassOptions): Promise<BaselinePassResult> {
  const canonicalUrl = normalizeYouTubeUrl(options.youtubeUrl);
  const video: Record<string, unknown> = { type: 'video', uri: canonicalUrl };
  if (AGENTIC_VIDEO_MODELS.includes(options.model)) {
    video.processing = 'agentic';
  }

  const result = await createStructuredInteraction({
    client: options.client,
    model: options.model,
    input: [video, { type: 'text', text: buildTranscriptionPrompt() }],
    schema: MUSIC_IR_JSON_SCHEMA
  });

  const validation = validateBaselineSong(result.json);
  if (!validation.valid) {
    throw new Error(`Invalid transcription data: ${validation.error}`);
  }
  return { song: validation.song, interactionId: result.id };
}
