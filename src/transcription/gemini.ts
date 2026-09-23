// Gemini API adapter for YouTube audio transcription.
// Encapsulates all @google/genai SDK dependencies.

import { GoogleGenAI } from '@google/genai';
import { MUSIC_IR_JSON_SCHEMA, TranscribedSong, validateTranscribedSong } from './model';
import { normalizeYouTubeUrl } from './youtube';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export const FIXED_TRANSCRIPTION_PROMPT =
  'Transcribe the entire guitar chords, rhythm strumming pattern, vocal melody notes, and vocal lyrics from this YouTube video. ' +
  'IMPORTANT: Transcribe the FULL, COMPLETE song from beginning to end without summarizing or skipping measures. ' +
  'Cover all sections sequentially (Intro, Verse, Pre-Chorus, Chorus, Bridge, Solo, Outro, etc.) until the video finishes. ' +
  'Determine the recommended capo position (0..7) to allow playing with easy open guitar chords, and express chords in that play form. ' +
  'STRICT SYLLABLE-TO-NOTE ALIGNMENT: Every sung syllable must have its own melody note with exact pitch and duration. ' +
  'IMPORTANT FOR JAPANESE LYRICS: Small kana (ゃ, ゅ, ょ, っ, ぁ, ぃ, ぅ, ぇ, ぉ, ゎ, ッ etc.) and long vowel mark (ー) must NEVER be standalone syllables or assigned to separate notes. They MUST always attach to the preceding character (e.g. "きょ", "がっ", "こー", "ふぁ") as a single syllable for one note. ' +
  'For example, if 8 syllables are sung in a measure ("き・ど・う・し・た・きょ・う・に"), output 8 eighth-notes (duration: "8"), each with its exact single syllable in the lyric property. Do NOT lump syllables together or simplify the vocal rhythm. ' +
  'TEMPO / BPM ACCURACY: Carefully detect the true tempo (BPM) from the rhythm section. In upbeat rock/pop 8-beat songs (like BPM 160-220), do NOT mistake the tempo as half-time (e.g. 80-110). Standard 8-beat has the bass drum on beats 1 & 3 and snare drum on beats 2 & 4 at the fast tempo (e.g. around BPM 185 for fast rock). Count each quarter-note beat where snare hits on 2 & 4 to determine the exact BPM. ' +
  'STRUMMING & ARPEGGIO GUIDELINES: Prioritize classic, natural guitar accompaniment patterns (such as standard 8-beat "4.d 8.d 8.u 8.d 8.u 4.d", basic 8-beat "4.d 4.d 8.d 8.u 8.d 8.u", 16-beat "4.d 8.d 16.d 16.u 8.d 8.u 8.d 8.u", 8th-note fingerpicking arpeggios "8 8 8 8 8 8 8 8", triplet arpeggios, or sustained whole/half notes) rather than erratic or overly complex variations. ' +
  'Output the transcription as structured music IR adhering to the provided JSON schema. ' +
  'The time signature must be 4/4. Every measure must have chords and rhythm, and all chord, rhythm, and melody ' +
  'sequences within each measure must sum to exactly 4 beats. ' +
  'CRITICAL CHORD DURATION RULES: "1" = whole note (lasts full 4-beat measure), "2" = half note (2 beats), "4" = quarter note (1 beat). ' +
  'If a measure has only 1 chord, its duration MUST be "1". If it has 2 chords, each duration is usually "2". ' +
  'Use standard guitar chord names and standard note values (1, 2, 4, 8, 16, 8t, etc.).';

export function buildTranscriptionPrompt(options?: { beatType?: 'auto' | '8beat' | '16beat' }): string {
  let prompt = FIXED_TRANSCRIPTION_PROMPT;
  if (options?.beatType === '8beat') {
    prompt += ' BEAT TYPE REQUIREMENT: Transcribe the rhythm strictly as an 8-beat guitar groove (e.g. 4.d 8.d 8.u 8.d 8.u 4.d or eighth-note arpeggios). Avoid sixteenth-note divisions.';
  } else if (options?.beatType === '16beat') {
    prompt += ' BEAT TYPE REQUIREMENT: Transcribe the rhythm as a 16-beat guitar groove (e.g. 4.d 8.d 16.d 16.u 8.d 8.u 8.d 8.u or 16th-note cutting).';
  }
  return prompt;
}

export interface GeminiClientLike {
  interactions: {
    create: (params: any) => Promise<any>;
  };
}

export interface GeminiTranscriptionOptions {
  apiKey: string;
  youtubeUrl: string;
  model?: string;
  beatType?: 'auto' | '8beat' | '16beat';
  client?: GeminiClientLike;
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

/**
 * Calls Gemini interactions.create with the YouTube video URL and Music IR schema,
 * then validates and returns the TranscribedSong.
 * Never logs API keys or raw responses.
 */
export async function transcribeWithGemini(options: GeminiTranscriptionOptions): Promise<TranscribedSong> {
  const canonicalUrl = normalizeYouTubeUrl(options.youtubeUrl);
  const modelName = options.model?.trim() || DEFAULT_GEMINI_MODEL;

  const client: GeminiClientLike = options.client ?? new GoogleGenAI({ apiKey: options.apiKey });

  let interaction: any;
  try {
    interaction = await client.interactions.create({
      model: modelName,
      input: [
        {
          type: 'video',
          uri: canonicalUrl
        },
        {
          type: 'text',
          text: buildTranscriptionPrompt({ beatType: options.beatType })
        }
      ],
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: MUSIC_IR_JSON_SCHEMA
      }
    });
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

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new Error('Gemini model response was not valid JSON.');
  }

  const validation = validateTranscribedSong(parsedJson);
  if (!validation.valid) {
    throw new Error(`Invalid transcription data: ${validation.error}`);
  }

  return validation.song;
}
