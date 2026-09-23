// Groove observation IR and deterministic strumming optimizer: every measure chooses between the
// compatible strumming presets and one candidate synthesized from the observed rhythm, minimizing
// local + transition cost over each section (dynamic programming).
// Pure module independent of VS Code APIs and Gemini SDK.

import { ZERO, fadd, feq, frac, parseRhythmDuration } from '../duration';
import { STRUMMING_PATTERN_PRESETS, StrummingPatternPreset, parsePresetStrokes } from '../strummingPatterns';
import { RhythmEvent, beatsToDurationString } from './model';
import { SongShape } from './harmonyRefinement';

export type GrooveGrid = 8 | 12 | 16;
export type GrooveStyle = 'strum' | 'arpeggio' | 'sustain';
export type BeatType = 'auto' | '8beat' | '16beat';

export interface GrooveMeasure {
  measureIndex: number;
  grid: GrooveGrid;
  style: GrooveStyle;
  /** Sorted unique slots 0..grid-1 where a stroke starts. */
  attacks: number[];
  /** Optional subset of attacks; only reported when Gemini is certain. */
  accents?: number[];
  /** The previous measure's last stroke keeps sounding into this measure (tie across the barline). */
  sustainFromPrevious?: boolean;
  confidence: number;
}

export interface GrooveSection {
  sectionIndex: number;
  measures: GrooveMeasure[];
}

export interface GrooveRefinement {
  sections: GrooveSection[];
}

export const GROOVE_REFINEMENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
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
                grid: { type: 'integer', enum: [8, 12, 16], description: 'Subdivisions per 4/4 measure: 8 = eighths, 12 = eighth-note triplets, 16 = sixteenths' },
                style: { type: 'string', enum: ['strum', 'arpeggio', 'sustain'] },
                attacks: { type: 'array', items: { type: 'integer' }, description: 'Ascending grid slots (0..grid-1) where the guitar strikes' },
                accents: { type: 'array', items: { type: 'integer' }, description: 'Optional: clearly accented attack slots only' },
                sustainFromPrevious: { type: 'boolean', description: 'True when the previous measure\'s last stroke is held (tied) across the barline instead of a new stroke on beat 1' },
                confidence: { type: 'number', description: '0..1' }
              },
              required: ['measureIndex', 'grid', 'style', 'attacks', 'confidence']
            }
          }
        },
        required: ['sectionIndex', 'measures']
      }
    }
  },
  required: ['sections']
};

export type GrooveValidationResult =
  | { valid: true; refinement: GrooveRefinement }
  | { valid: false; error: string };

function isSortedUniqueSlots(value: unknown, grid: number): value is number[] {
  if (!Array.isArray(value)) return false;
  for (let i = 0; i < value.length; i++) {
    const v = value[i];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= grid) return false;
    if (i > 0 && v <= value[i - 1]) return false;
  }
  return true;
}

/** Validates a groove payload against the IR rules, the baseline shape and the requested beat type. */
export function validateGrooveRefinement(data: unknown, shape: SongShape, beatType: BeatType = 'auto'): GrooveValidationResult {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Groove refinement must be an object' };
  }
  const raw = data as Record<string, unknown>;
  if (!Array.isArray(raw.sections) || raw.sections.length !== shape.length) {
    return { valid: false, error: `Groove refinement must contain exactly ${shape.length} sections` };
  }
  const requiredGrid = beatType === '8beat' ? 8 : beatType === '16beat' ? 16 : undefined;

  const sections: GrooveSection[] = [];
  for (let s = 0; s < shape.length; s++) {
    const rawSection = raw.sections[s] as Record<string, unknown> | undefined;
    if (!rawSection || typeof rawSection !== 'object' || rawSection.sectionIndex !== s) {
      return { valid: false, error: `Groove section ${s} is missing or out of order` };
    }
    if (!Array.isArray(rawSection.measures) || rawSection.measures.length !== shape[s]) {
      return { valid: false, error: `Groove section ${s} must contain exactly ${shape[s]} measures` };
    }
    const measures: GrooveMeasure[] = [];
    for (let m = 0; m < shape[s]; m++) {
      const rm = rawSection.measures[m] as Record<string, unknown> | undefined;
      const where = `section ${s}, measure ${m}`;
      if (!rm || typeof rm !== 'object' || rm.measureIndex !== m) {
        return { valid: false, error: `Groove ${where} is missing or out of order` };
      }
      const grid = rm.grid;
      if (grid !== 8 && grid !== 12 && grid !== 16) {
        return { valid: false, error: `Groove ${where} has an invalid grid '${grid}'` };
      }
      if (requiredGrid !== undefined && grid !== requiredGrid) {
        return { valid: false, error: `Groove ${where} must use grid ${requiredGrid}` };
      }
      if (rm.style !== 'strum' && rm.style !== 'arpeggio' && rm.style !== 'sustain') {
        return { valid: false, error: `Groove ${where} has an invalid style` };
      }
      if (!isSortedUniqueSlots(rm.attacks, grid)) {
        return { valid: false, error: `Groove ${where} attacks must be ascending unique slots within the grid` };
      }
      const attacks = rm.attacks;
      if (rm.accents !== undefined) {
        if (!isSortedUniqueSlots(rm.accents, grid) || !rm.accents.every(a => attacks.includes(a))) {
          return { valid: false, error: `Groove ${where} accents must be a sorted subset of attacks` };
        }
      }
      const confidence = rm.confidence;
      if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        return { valid: false, error: `Groove ${where} has an invalid confidence` };
      }
      const measure: GrooveMeasure = { measureIndex: m, grid, style: rm.style, attacks: [...attacks], confidence };
      if (rm.accents !== undefined) measure.accents = [...(rm.accents as number[])];
      if (rm.sustainFromPrevious === true) measure.sustainFromPrevious = true;
      measures.push(measure);
    }
    sections.push({ sectionIndex: s, measures });
  }
  return { valid: true, refinement: { sections } };
}

// --- Candidates ---

export interface GrooveMask {
  attacks: number[];
  accents: number[];
}

interface Candidate {
  id: string;
  family: string;
  /** Tie-break order: declaration index for presets, presets.length for the observed candidate. */
  order: number;
  localCost: number;
  events: RhythmEvent[];
  observed?: GrooveMeasure;
}

const TRANSITION_SAME_FAMILY = 2;
const TRANSITION_OTHER_FAMILY = 6;
const ATTACK_WEIGHT = 10;
const ACCENT_WEIGHT = 3;
const OBSERVED_CONFIDENCE_TARGET = 0.85;
const OBSERVED_PENALTY_WEIGHT = 40;
const EPSILON = 1e-9;

function presetStyle(preset: StrummingPatternPreset): GrooveStyle {
  if (preset.category === 'arpeggio') return 'arpeggio';
  if (preset.category === 'ballad') return 'sustain';
  return 'strum';
}

function observedFamily(measure: GrooveMeasure): string {
  if (measure.style === 'arpeggio') return 'arpeggio';
  if (measure.style === 'sustain') return 'ballad';
  return measure.grid === 12 ? 'triplet' : measure.grid === 8 ? '8beat' : '16beat';
}

/**
 * Attack/accent slots of a preset on the grid, or null when a stroke does not start exactly on a
 * grid slot or the pattern does not fill 4 beats. A stroke following a tied stroke is not an attack.
 */
export function presetMask(preset: StrummingPatternPreset, grid: GrooveGrid): GrooveMask | null {
  const attacks: number[] = [];
  const accents: number[] = [];
  let position = ZERO;
  let tiedFromPrevious = false;
  for (const stroke of parsePresetStrokes(preset.pattern)) {
    const value = parseRhythmDuration(stroke.duration);
    if (!value) return null;
    const slot = frac(position.n * grid, position.d * 4);
    if (slot.d !== 1) return null;
    if (!stroke.duration.startsWith('r') && !tiedFromPrevious) {
      attacks.push(slot.n);
      if (stroke.accent) accents.push(slot.n);
    }
    tiedFromPrevious = stroke.tie === true;
    position = fadd(position, value.beats);
  }
  return feq(position, frac(4)) ? { attacks, accents } : null;
}

function symmetricDifference(a: number[], b: number[]): number {
  const setB = new Set(b);
  const setA = new Set(a);
  return a.filter(x => !setB.has(x)).length + b.filter(x => !setA.has(x)).length;
}

/** Local cost of a preset mask against an observation; accents count only when they were reported. */
export function presetLocalCost(mask: GrooveMask, measure: GrooveMeasure): number {
  let cost = ATTACK_WEIGHT * symmetricDifference(mask.attacks, measure.attacks);
  if (measure.accents !== undefined) {
    cost += ACCENT_WEIGHT * symmetricDifference(mask.accents, measure.accents);
  }
  return cost;
}

export function observedPenalty(confidence: number): number {
  return Math.max(0, OBSERVED_CONFIDENCE_TARGET - confidence) * OBSERVED_PENALTY_WEIGHT;
}

/**
 * Stroke direction of an attack by the pendulum rule. Straight grids swing the arm on the coarsest
 * pendulum (8th or 16th) containing every attack of the measure: even pendulum slot = down, odd = up.
 * Triplet grid: d, u, d within each beat.
 */
export function pendulumDirection(slot: number, measure: Pick<GrooveMeasure, 'grid' | 'attacks'>): 'd' | 'u' {
  if (measure.grid === 12) {
    return slot % 3 === 1 ? 'u' : 'd';
  }
  const eighthsOnly = measure.attacks.every(a => (a * 8) % measure.grid === 0);
  const pendulum = eighthsOnly ? 8 : 16;
  const pendulumSlot = (slot * pendulum) / measure.grid;
  return pendulumSlot % 2 === 0 ? 'd' : 'u';
}

function slotsToDuration(slots: number, grid: GrooveGrid): string {
  const duration = beatsToDurationString(frac(slots * 4, grid));
  if (!duration) {
    throw new Error(`Cannot express ${slots}/${grid} of a measure as a rhythm duration`);
  }
  return duration;
}

/**
 * Rhythm events of the observed candidate. The leading gap is a rest, or (with tiedLead) the held
 * continuation of the previous measure's last stroke. The last attack extends to the measure end.
 */
export function observedEvents(measure: GrooveMeasure, tiedLead = false): RhythmEvent[] {
  const events: RhythmEvent[] = [];
  const { attacks, grid } = measure;
  const firstAttack = attacks.length > 0 ? attacks[0] : grid;
  if (firstAttack > 0) {
    const duration = slotsToDuration(firstAttack, grid);
    events.push(tiedLead ? { duration } : { duration: `r${duration}` });
  }
  const accents = new Set(measure.accents ?? []);
  attacks.forEach((slot, i) => {
    const end = i + 1 < attacks.length ? attacks[i + 1] : grid;
    const event: RhythmEvent = { duration: slotsToDuration(end - slot, grid) };
    if (measure.style !== 'arpeggio') {
      event.direction = pendulumDirection(slot, measure);
    }
    if (accents.has(slot)) event.accent = true;
    events.push(event);
  });
  return events;
}

function observedId(measure: GrooveMeasure): string {
  return `observed:${measure.style}:${measure.grid}:${measure.attacks.join(',')}|${(measure.accents ?? []).join(',')}`;
}

function candidatesFor(measure: GrooveMeasure): Candidate[] {
  const candidates: Candidate[] = [];
  STRUMMING_PATTERN_PRESETS.forEach((preset, order) => {
    if (presetStyle(preset) !== measure.style) return;
    const mask = presetMask(preset, measure.grid);
    if (!mask) return;
    candidates.push({
      id: preset.id,
      family: preset.category,
      order,
      localCost: presetLocalCost(mask, measure),
      events: parsePresetStrokes(preset.pattern)
    });
  });
  candidates.push({
    id: observedId(measure),
    family: observedFamily(measure),
    order: STRUMMING_PATTERN_PRESETS.length,
    localCost: observedPenalty(measure.confidence),
    events: observedEvents(measure),
    observed: measure
  });
  return candidates;
}

function transitionCost(from: Candidate, to: Candidate): number {
  if (from.id === to.id) return 0;
  return from.family === to.family ? TRANSITION_SAME_FAMILY : TRANSITION_OTHER_FAMILY;
}

/** Lower cost first; on an exact tie, lower order (presets in declaration order, observed last). */
function better(costA: number, orderA: number, costB: number, orderB: number): boolean {
  if (costA < costB - EPSILON) return true;
  if (costA > costB + EPSILON) return false;
  return orderA < orderB;
}

export interface GrooveChoice {
  id: string;
  events: RhythmEvent[];
}

/** Section-level DP: minimizes the sum of local and transition costs over the section's measures. */
export function optimizeSection(measures: GrooveMeasure[]): GrooveChoice[] {
  if (measures.length === 0) return [];
  const layers = measures.map(candidatesFor);
  const totals: number[][] = [layers[0].map(c => c.localCost)];
  const back: number[][] = [layers[0].map(() => -1)];

  for (let m = 1; m < layers.length; m++) {
    const prev = layers[m - 1];
    totals.push([]);
    back.push([]);
    for (const candidate of layers[m]) {
      let bestIndex = 0;
      let bestCost = Infinity;
      prev.forEach((p, i) => {
        const cost = totals[m - 1][i] + transitionCost(p, candidate);
        if (bestCost === Infinity || better(cost, p.order, bestCost, prev[bestIndex].order)) {
          bestCost = cost;
          bestIndex = i;
        }
      });
      totals[m].push(bestCost + candidate.localCost);
      back[m].push(bestIndex);
    }
  }

  const last = layers.length - 1;
  let index = 0;
  layers[last].forEach((c, i) => {
    if (better(totals[last][i], c.order, totals[last][index], layers[last][index].order)) {
      index = i;
    }
  });

  const chosen: Candidate[] = new Array(layers.length);
  for (let m = last; m >= 0; m--) {
    chosen[m] = layers[m][index];
    index = back[m][index];
  }

  const result: GrooveChoice[] = chosen.map(c => ({ id: c.id, events: c.events.map(e => ({ ...e })) }));
  // Tie across the barline: only when this measure keeps its observed rhythm and the previous
  // measure ends with a sounding stroke.
  for (let m = 1; m < chosen.length; m++) {
    const observed = chosen[m].observed;
    if (!observed?.sustainFromPrevious || (observed.attacks[0] ?? observed.grid) === 0) continue;
    const prevEvents = result[m - 1].events;
    const prevLast = prevEvents[prevEvents.length - 1];
    if (!prevLast || prevLast.duration.startsWith('r')) continue;
    prevLast.tie = true;
    result[m].events = observedEvents(observed, true);
  }
  return result;
}

/** Optimizes every section independently; DP state never crosses a section boundary. */
export function optimizeGroove(refinement: GrooveRefinement): RhythmEvent[][][] {
  return refinement.sections.map(section => optimizeSection(section.measures).map(choice => choice.events));
}
