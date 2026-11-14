// Score-event annotations and technique spans of one system row (docs/specs/guitardsl-syntax.md §11, §16).
// Layout uses rowAnnotations() to reserve lanes; svg.ts draws the same entries, so lane presence and
// drawing never disagree. Pure: no DOM.

import { MeasureData, ParsedScore, RhythmItem } from '../compiler';
import { MelodyNote } from '../melody';
import { ResolvedMeasureContext, ScoreEvent, structuralChange } from '../scoreEvents';

/** Lanes above the system content, top to bottom. */
export type AnnotationLane = 'mark' | 'tempo' | 'text' | 'ottava' | 'palmMute' | 'letRing' | 'techniqueMarks';

export const LANE_ORDER: readonly AnnotationLane[] = ['mark', 'tempo', 'text', 'ottava', 'palmMute', 'letRing', 'techniqueMarks'];

export const LANE_HEIGHT: Record<AnnotationLane, number> = {
  mark: 18,
  tempo: 16,
  text: 14,
  ottava: 13,
  palmMute: 12,
  letRing: 12,
  techniqueMarks: 14
};


export type TopAnnotation =
  | { lane: 'mark'; measure: number; text: string }
  | { lane: 'tempo'; measure: number; kind: 'bpm'; bpm: number }
  | { lane: 'tempo'; measure: number; kind: 'text'; text: string }
  | { lane: 'text'; measure: number; text: string; isKey?: boolean };

export interface RowAnnotations {
  top: TopAnnotation[];
  dynamics: { measure: number; text: string }[];
  lanes: Set<AnnotationLane>;
}

const TEMPO_MARK_TEXT: Record<string, string> = {
  ritardando: 'rit.',
  accelerando: 'accel.',
  aTempo: 'a tempo',
  tempoPrimo: 'Tempo primo'
};

function previousContext(score: Pick<ParsedScore, 'measures'>, m: MeasureData): ResolvedMeasureContext | undefined {
  return m.measureIndex > 0 ? score.measures[m.measureIndex - 1]?.context : undefined;
}

/** Feel label for a feelChange: swing / shuffle always, straight only when leaving another feel. */
function feelLabel(event: ScoreEvent, before: ResolvedMeasureContext | undefined): string | null {
  if (event.kind !== 'feelChange') return null;
  if (event.feel === 'swing') return 'Swing';
  if (event.feel === 'shuffle') return 'Shuffle';
  return before && before.feel !== 'straight' ? 'Straight' : null;
}

export function isPalmMute(n: { techniques?: MelodyNote['techniques'] }): boolean {
  return n.techniques?.palmMute === true;
}

export function isLetRing(n: { techniques?: MelodyNote['techniques'] }): boolean {
  return n.techniques?.letRing === true;
}

/** Rhythm-staff fermata / vibrato are drawn in the technique marks lane (the slash area has no free row). */
export function hasRhythmLaneMark(r: RhythmItem): boolean {
  return r.techniques?.fermata === true || r.techniques?.vibrato === true;
}

/**
 * Annotations of a row. `rhythmOnly` = the system has no melody staff (it then shows `Key: X` text at a
 * structural key change instead of a key signature).
 */
export function rowAnnotations(measures: MeasureData[], score: Pick<ParsedScore, 'measures'> & Partial<Pick<ParsedScore, 'feel'>>, rhythmOnly: boolean, showRhythm = true): RowAnnotations {
  const top: TopAnnotation[] = [];
  const dynamics: { measure: number; text: string }[] = [];
  const lanes = new Set<AnnotationLane>();
  measures.forEach((m, idx) => {
    const events = m.eventsBefore ?? [];
    // Feel labels compare with the feel in effect before this measure's own events.
    let before = previousContext(score, m);
    // The initial feel (`feel:` header) is shown on the first measure unless it is straight.
    if (m.measureIndex === 0 && score.feel && score.feel !== 'straight' && !events.some(e => e.kind === 'feelChange')) {
      top.push({ lane: 'tempo', measure: idx, kind: 'text', text: score.feel === 'swing' ? 'Swing' : 'Shuffle' });
    }
    for (const ev of events) {
      if (ev.kind === 'rehearsalMark') top.push({ lane: 'mark', measure: idx, text: ev.text });
      else if (ev.kind === 'tempoChange') top.push({ lane: 'tempo', measure: idx, kind: 'bpm', bpm: ev.bpm });
      else if (ev.kind === 'tempoMark') top.push({ lane: 'tempo', measure: idx, kind: 'text', text: TEMPO_MARK_TEXT[ev.mark] });
      else if (ev.kind === 'feelChange') {
        const label = feelLabel(ev, before);
        if (label) top.push({ lane: 'tempo', measure: idx, kind: 'text', text: label });
      } else if (ev.kind === 'text') top.push({ lane: 'text', measure: idx, text: ev.text });
      else if (ev.kind === 'dynamic') dynamics.push({ measure: idx, text: ev.dynamic });
      if (ev.kind === 'feelChange' && before) before = { ...before, feel: ev.feel };
    }
    if (idx === 0 && rhythmOnly && structuralChange(previousContext(score, m), m).key) {
      top.unshift({ lane: 'text', measure: 0, text: `Key: ${m.context.key}`, isKey: true });
    }
    if (m.context?.ottava && m.context.ottava !== 'none') lanes.add('ottava');
    const rhythms = m.isMeasureRepeat || !showRhythm ? [] : m.rhythms;
    const notes: { techniques?: MelodyNote['techniques'] }[] = [...rhythms, ...(m.melody ?? [])];
    if (notes.some(isPalmMute)) lanes.add('palmMute');
    if (notes.some(isLetRing)) lanes.add('letRing');
    if (rhythms.some(hasRhythmLaneMark)) lanes.add('techniqueMarks');
  });
  for (const a of top) lanes.add(a.lane);
  return { top, dynamics, lanes };
}

/** y of each present lane (top of the lane band) and the total height, in system units. */
export function laneLayout(lanes: Set<AnnotationLane>): { positions: Map<AnnotationLane, number>; height: number } {
  const positions = new Map<AnnotationLane, number>();
  let y = 0;
  for (const lane of LANE_ORDER) {
    if (!lanes.has(lane)) continue;
    positions.set(lane, y);
    y += LANE_HEIGHT[lane];
  }
  return { positions, height: y };
}

/** One head of a staff in a row, in drawing order, for coalescing P.M. / let ring spans. */
export interface StaffSpanEntry {
  x: number;
  palmMute: boolean;
  letRing: boolean;
}

export interface StaffSpans {
  entries: StaffSpanEntry[];
  /** Flags of the item just before / after this row in score order (continuation across systems). */
  before: { palmMute: boolean; letRing: boolean };
  after: { palmMute: boolean; letRing: boolean };
}

/** Collected by the staff renderers while drawing a row, then drawn in the lanes. */
export interface RowSpanCollector {
  staffs: StaffSpans[];
  /** Rhythm-staff fermata / vibrato drawn in the technique marks lane. */
  laneMarks: { x: number; fermata: boolean; vibrato: boolean }[];
}

export function newRowSpanCollector(): RowSpanCollector {
  return { staffs: [], laneMarks: [] };
}

export type LinkKind = 'hammer' | 'pull' | 'slide' | 'gliss' | 'slur';

/**
 * Connections (to the next sounding non-grace pitched note) and slurs (slur-start to the next slur-end,
 * no nesting) of a note sequence, as index pairs. Same rules as the parser diagnostics.
 */
export function connectionLinks<T extends { isRest: boolean; pitch?: unknown; techniques?: MelodyNote['techniques'] }>(items: readonly T[]): { from: number; to: number; kind: LinkKind }[] {
  const links: { from: number; to: number; kind: LinkKind }[] = [];
  let open = -1;
  items.forEach((item, i) => {
    const tech = item.techniques;
    if (!tech) return;
    if (tech.connection) {
      for (let j = i + 1; j < items.length; j++) {
        if (items[j].isRest || items[j].techniques?.grace) continue;
        if (items[j].pitch) links.push({ from: i, to: j, kind: tech.connection });
        break;
      }
    }
    if (tech.slurStart && open < 0) open = i;
    if (tech.slurEnd && open >= 0) {
      links.push({ from: open, to: i, kind: 'slur' });
      open = -1;
    }
  });
  return links;
}
