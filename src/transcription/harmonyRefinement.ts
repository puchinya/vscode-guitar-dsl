// Harmony refinement IR: sounding chord candidates on a 16th-note grid, ambiguity detection,
// candidate-only verification and deterministic tick -> chord duration conversion.
// Pure module independent of VS Code APIs and Gemini SDK.

import { frac } from '../duration';
import { parseKeySignature } from '../compiler';
import { isValidChordName } from '../chordDefinition';
import { ChordEvent, beatsToDurationString } from './model';

export interface ChordCandidate {
  /** Sounding chord, never capo-transposed. */
  name: string;
  /** 0..1, non-increasing within a change. */
  confidence: number;
}

export interface HarmonyChange {
  /** Integer 0..15; 0 = measure start. */
  tick16: number;
  candidates: ChordCandidate[];
}

export interface HarmonyMeasure {
  measureIndex: number;
  changes: HarmonyChange[];
}

export interface HarmonySection {
  sectionIndex: number;
  measures: HarmonyMeasure[];
}

export interface HarmonyRefinement {
  soundingKey?: string;
  sections: HarmonySection[];
}

export interface HarmonyDecision {
  sectionIndex: number;
  measureIndex: number;
  tick16: number;
  selectedName: string;
}

export interface HarmonyVerification {
  decisions: HarmonyDecision[];
}

export interface AmbiguousEvent {
  sectionIndex: number;
  measureIndex: number;
  tick16: number;
  candidates: ChordCandidate[];
}

/** Measure count of every baseline section, in order. Refinements must match it exactly. */
export type SongShape = number[];

export const TICKS_PER_MEASURE = 16;
export const AMBIGUOUS_TOP_CONFIDENCE = 0.78;
export const AMBIGUOUS_MARGIN = 0.18;

export const HARMONY_REFINEMENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    soundingKey: { type: 'string', description: 'Confirmed sounding (concert) key, e.g. C, Am, F#m' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sectionIndex: { type: 'integer' },
          measures: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                measureIndex: { type: 'integer' },
                changes: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      tick16: { type: 'integer', description: '16th-note position 0..15 of the chord change within the measure; 0 = downbeat' },
                      candidates: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            name: { type: 'string', description: 'Sounding chord name (e.g. C, Am7, G/B), never capo-transposed' },
                            confidence: { type: 'number', description: '0..1' }
                          },
                          required: ['name', 'confidence']
                        }
                      }
                    },
                    required: ['tick16', 'candidates']
                  }
                }
              },
              required: ['measureIndex', 'changes']
            }
          }
        },
        required: ['sectionIndex', 'measures']
      }
    }
  },
  required: ['sections']
};

export const HARMONY_VERIFICATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sectionIndex: { type: 'integer' },
          measureIndex: { type: 'integer' },
          tick16: { type: 'integer' },
          selectedName: { type: 'string', description: 'Exactly one of the supplied candidate names' }
        },
        required: ['sectionIndex', 'measureIndex', 'tick16', 'selectedName']
      }
    }
  },
  required: ['decisions']
};

export type HarmonyValidationResult =
  | { valid: true; refinement: HarmonyRefinement }
  | { valid: false; error: string };

function isConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Validates a harmony refinement payload against the IR rules and the baseline shape. */
export function validateHarmonyRefinement(data: unknown, shape: SongShape): HarmonyValidationResult {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Harmony refinement must be an object' };
  }
  const raw = data as Record<string, unknown>;
  if ('capo' in raw) {
    return { valid: false, error: 'Harmony refinement must not contain a capo field' };
  }
  if (!Array.isArray(raw.sections) || raw.sections.length !== shape.length) {
    return { valid: false, error: `Harmony refinement must contain exactly ${shape.length} sections` };
  }

  const sections: HarmonySection[] = [];
  for (let s = 0; s < shape.length; s++) {
    const rawSection = raw.sections[s] as Record<string, unknown> | undefined;
    if (!rawSection || typeof rawSection !== 'object' || rawSection.sectionIndex !== s) {
      return { valid: false, error: `Harmony section ${s} is missing or out of order` };
    }
    if (!Array.isArray(rawSection.measures) || rawSection.measures.length !== shape[s]) {
      return { valid: false, error: `Harmony section ${s} must contain exactly ${shape[s]} measures` };
    }
    const measures: HarmonyMeasure[] = [];
    for (let m = 0; m < shape[s]; m++) {
      const rawMeasure = rawSection.measures[m] as Record<string, unknown> | undefined;
      const where = `section ${s}, measure ${m}`;
      if (!rawMeasure || typeof rawMeasure !== 'object' || rawMeasure.measureIndex !== m) {
        return { valid: false, error: `Harmony ${where} is missing or out of order` };
      }
      if (!Array.isArray(rawMeasure.changes) || rawMeasure.changes.length === 0) {
        return { valid: false, error: `Harmony ${where} has no chord changes` };
      }
      const changes: HarmonyChange[] = [];
      for (const rawChange of rawMeasure.changes as unknown[]) {
        const change = rawChange as Record<string, unknown>;
        const tick = change?.tick16;
        if (typeof tick !== 'number' || !Number.isInteger(tick) || tick < 0 || tick >= TICKS_PER_MEASURE) {
          return { valid: false, error: `Harmony ${where} has an invalid tick16 '${tick}'` };
        }
        if (changes.length === 0 ? tick !== 0 : tick <= changes[changes.length - 1].tick16) {
          return { valid: false, error: `Harmony ${where} changes must start at tick 0 and strictly ascend` };
        }
        if (!Array.isArray(change.candidates) || change.candidates.length < 1 || change.candidates.length > 3) {
          return { valid: false, error: `Harmony ${where}, tick ${tick} must have 1..3 candidates` };
        }
        const candidates: ChordCandidate[] = [];
        for (const rawCandidate of change.candidates as unknown[]) {
          const candidate = rawCandidate as Record<string, unknown>;
          const name = typeof candidate?.name === 'string' ? candidate.name.trim() : '';
          if (!isValidChordName(name)) {
            return { valid: false, error: `Harmony ${where}, tick ${tick} has an invalid chord name '${name}'` };
          }
          if (!isConfidence(candidate.confidence)) {
            return { valid: false, error: `Harmony ${where}, tick ${tick} has an invalid confidence` };
          }
          if (candidates.length > 0 && candidate.confidence > candidates[candidates.length - 1].confidence) {
            return { valid: false, error: `Harmony ${where}, tick ${tick} candidates must be in descending confidence` };
          }
          candidates.push({ name, confidence: candidate.confidence });
        }
        changes.push({ tick16: tick, candidates });
      }
      measures.push({ measureIndex: m, changes });
    }
    sections.push({ sectionIndex: s, measures });
  }

  const refinement: HarmonyRefinement = { sections };
  if (typeof raw.soundingKey === 'string' && parseKeySignature(raw.soundingKey.trim()) !== null) {
    refinement.soundingKey = raw.soundingKey.trim();
  }
  return { valid: true, refinement };
}

export function isAmbiguous(change: HarmonyChange): boolean {
  const [top, second] = change.candidates;
  if (top.confidence < AMBIGUOUS_TOP_CONFIDENCE) return true;
  return second !== undefined && top.confidence - second.confidence < AMBIGUOUS_MARGIN;
}

export function findAmbiguousEvents(refinement: HarmonyRefinement): AmbiguousEvent[] {
  const events: AmbiguousEvent[] = [];
  for (const section of refinement.sections) {
    for (const measure of section.measures) {
      for (const change of measure.changes) {
        if (isAmbiguous(change)) {
          events.push({
            sectionIndex: section.sectionIndex,
            measureIndex: measure.measureIndex,
            tick16: change.tick16,
            candidates: change.candidates
          });
        }
      }
    }
  }
  return events;
}

function eventId(sectionIndex: number, measureIndex: number, tick16: number): string {
  return `${sectionIndex}:${measureIndex}:${tick16}`;
}

/**
 * Chosen chord name for every change: the verified decision when it names one of that ambiguous
 * event's candidates, otherwise the top candidate. Result is indexed [section][measure][change].
 */
export function chooseChords(refinement: HarmonyRefinement, verification?: unknown): string[][][] {
  const ambiguous = new Map<string, ChordCandidate[]>();
  for (const e of findAmbiguousEvents(refinement)) {
    ambiguous.set(eventId(e.sectionIndex, e.measureIndex, e.tick16), e.candidates);
  }

  const selected = new Map<string, string>();
  const decisions = (verification as HarmonyVerification | undefined)?.decisions;
  if (Array.isArray(decisions)) {
    for (const d of decisions) {
      if (!d || typeof d !== 'object' || typeof d.selectedName !== 'string') continue;
      const id = eventId(d.sectionIndex, d.measureIndex, d.tick16);
      const candidates = ambiguous.get(id);
      const name = d.selectedName.trim();
      if (candidates && candidates.some(c => c.name === name)) {
        selected.set(id, name);
      }
    }
  }

  return refinement.sections.map(section =>
    section.measures.map(measure =>
      measure.changes.map(change =>
        selected.get(eventId(section.sectionIndex, measure.measureIndex, change.tick16)) ?? change.candidates[0].name
      )
    )
  );
}

/** Deterministic chord durations: each change lasts until the next one, the last until tick 16. */
export function harmonyToChordEvents(measure: HarmonyMeasure, names: string[]): ChordEvent[] {
  return measure.changes.map((change, i) => {
    const end = i + 1 < measure.changes.length ? measure.changes[i + 1].tick16 : TICKS_PER_MEASURE;
    const duration = beatsToDurationString(frac(end - change.tick16, 4));
    if (!duration) {
      throw new Error(`Cannot express ${end - change.tick16} sixteenth notes as a chord duration`);
    }
    return { name: names[i], duration };
  });
}
