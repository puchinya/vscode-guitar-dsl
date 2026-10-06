import { MeasureData } from '../compiler';
import { Fraction, NoteBase, NoteValuePart, fadd, fcmp, fnum, formatNoteValuePart, partBeats, tupletGroups } from '../duration';
import { TabBeat, TabEffectCall, TabNote, TabVoiceMeasure, resolveTabLinkTarget } from '../tab';
import { beamGroupIndex } from '../scoreEvents';
import { SystemGeometry, estimateTextWidth } from './layout';
import {
  RenderContext,
  SystemPrefix,
  barBeats,
  escapeXml,
  fmt,
  measureBounds,
  renderFlags,
  renderRestGlyph,
  renderTieArc,
  renderTimeSignature
} from './notation';
import { renderBend, renderGliss, renderHammerPull, renderSlide, renderVibrato } from './technique';

const TAB_LINE_COUNT = 6;
const NUMBER_SIZE = 12;
const NUMBER_GAP = 4;

interface BeatPosition {
  measureIndex: number;
  localMeasure: number;
  beatIndex: number;
  globalIndex: number;
  beat: TabBeat;
  offset: Fraction;
  x: number;
  measureEnd: number;
  part: NoteValuePart;
  durationLabel?: string;
  stemX: number;
}

/** Draws compiled voice 1 TAB in shared system coordinates. No GuitarDSL source or pitch lookup is used. */
export function renderTabStaff(
  measures: MeasureData[],
  ctx: RenderContext,
  geometry: SystemGeometry,
  prefix: SystemPrefix
): string {
  const top = geometry.tabOffset;
  const lineGap = geometry.tabStaffHeight / (TAB_LINE_COUNT - 1);
  const tabBottom = geometry.tabStaffHeight;
  const lineYs = Array.from({ length: TAB_LINE_COUNT }, (_unused, index) => top + index * lineGap);
  const restStaffLines = Array.from({ length: 5 }, (_unused, index) => top + lineGap / 2 + index * lineGap);
  const restMidY = top + tabBottom / 2;
  const xStart = ctx.startX;
  const xEnd = ctx.totalWidth - 5;
  let out = '';

  for (let stringIndex = 0; stringIndex < lineYs.length; stringIndex++) {
    const y = lineYs[stringIndex];
    out += `<line class="tab-string-line" data-string="${stringIndex + 1}" x1="${fmt(xStart)}" y1="${fmt(y)}" x2="${fmt(xEnd)}" y2="${fmt(y)}" stroke="#000" stroke-width="${stringIndex === 0 || stringIndex === 5 ? '1.2' : '0.9'}"/>`;
  }
  out += `<text class="tab-label tab-clef" x="${fmt(ctx.startX - 42)}" y="${fmt(top + tabBottom / 2 + 7)}" font-family="serif" font-size="20" font-weight="bold" text-anchor="middle">TAB</text>`;
  out += renderTimeSignature(prefix, top - 1);

  const rowMeasures = new Set(measures.map(measure => measure.measureIndex));
  const rowPositionByBeat = new Map<string, BeatPosition>();
  const rowEntries: BeatPosition[] = [];
  const allEntries: { measureIndex: number; beatIndex: number; beat: TabBeat }[] = [];
  for (const measure of ctx.score.measures) {
    const voice = voiceOne(measure);
    for (let beatIndex = 0; beatIndex < (voice?.beats.length ?? 0); beatIndex++) {
      allEntries.push({ measureIndex: measure.measureIndex, beatIndex, beat: voice!.beats[beatIndex] });
    }
  }
  let globalIndex = 0;
  measures.forEach((measure, localMeasure) => {
    const voice = voiceOne(measure);
    const beats = voice?.beats ?? [];
    const { bx, width } = measureBounds(ctx, measures.length, localMeasure);
    const inset = 15;
    let offset = { n: 0, d: 1 };
    const expected = Math.max(0.000001, barBeats(measure));
    const positions = beats.map((beat, beatIndex) => {
      const x = bx + inset + fnum(offset) / expected * Math.max(0, width - 2 * inset);
      const normalizedPart = singlePartDuration(beat.duration.parts, beat.duration.beats);
      const durationLabel = normalizedPart || beat.duration.parts.length < 2
        ? undefined
        : beat.duration.parts.map(formatNoteValuePart).join('+');
      const part = normalizedPart ?? fallbackRhythmPart(beat.duration.parts);
      const position: BeatPosition = { measureIndex: measure.measureIndex, localMeasure, beatIndex, globalIndex: globalIndex++, beat, offset: { ...offset }, x, measureEnd: bx + width - inset, part, durationLabel, stemX: x + 5 };
      offset = fadd(offset, beat.duration.beats);
      return position;
    });
    spreadCollisions(positions, bx + inset, bx + width - inset);
    for (const position of positions) {
      rowEntries.push(position);
      rowPositionByBeat.set(`${position.measureIndex}:${position.beatIndex}`, position);
    }
    out += renderTabBarline(measure, bx, bx + width, top, top + tabBottom);
  });

  // Rhythm stems, beams and tuplet counts use the shared NoteValue parts and beat grouping.
  for (const measure of measures) {
    const positions = rowEntries.filter(entry => entry.measureIndex === measure.measureIndex);
    const groups = new Map<number, BeatPosition[]>();
    for (const position of positions) {
      if (position.beat.isRest || position.part.base < 8) continue;
      const key = beamGroupKey(measure, position);
      const bucket = groups.get(key) ?? [];
      bucket.push(position);
      groups.set(key, bucket);
    }
    const beamed = new Set<BeatPosition>();
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.forEach(entry => beamed.add(entry));
      out += `<line class="tab-beam" x1="${fmt(group[0].stemX)}" y1="${fmt(top - 17)}" x2="${fmt(group[group.length - 1].stemX)}" y2="${fmt(top - 17)}" stroke="#000" stroke-width="2.6"/>`;
      if (group.some(entry => entry.part.base >= 16)) {
        out += `<line class="tab-beam-secondary" x1="${fmt(group[0].stemX)}" y1="${fmt(top - 13)}" x2="${fmt(group[group.length - 1].stemX)}" y2="${fmt(top - 13)}" stroke="#000" stroke-width="1.8"/>`;
      }
    }
    for (const position of positions) {
      if (position.beat.isRest || position.part.base === 1) continue;
      out += `<line class="tab-stem" x1="${fmt(position.stemX)}" y1="${fmt(top - 1)}" x2="${fmt(position.stemX)}" y2="${fmt(top - 18)}" stroke="#000" stroke-width="1.1"/>`;
      if (position.part.base >= 8 && !beamed.has(position)) {
        out += renderFlags(position.part.base as NoteBase, position.stemX, top - 18);
      }
      if (position.part.dotted) {
        out += `<circle class="tab-duration-dot" cx="${fmt(position.stemX + 2)}" cy="${fmt(top - 20)}" r="1.25" fill="#000"/>`;
      }
    }
    const tupletHeads = positions.map(position => ({ position, part: position.part }));
    for (const group of tupletGroups(tupletHeads)) {
      const first = group.items[0].position;
      const last = group.items[group.items.length - 1].position;
      const center = (first.x + last.x) / 2;
      out += `<text class="tab-tuplet-number" x="${fmt(center)}" y="${fmt(top - 24)}" font-size="7" font-style="italic" text-anchor="middle">${group.items[0].part.tuplet!.actual}</text>`;
    }
  }

  for (const position of rowEntries) {
    if (!position.durationLabel) continue;
    out += `<text class="tab-composite-duration" x="${fmt(position.x)}" y="${fmt(top + tabBottom + 15)}" font-size="6.5" text-anchor="middle">${escapeXml(position.durationLabel)}</text>`;
  }

  for (const position of rowEntries) {
    if (position.beat.isRest) {
      out += `<g class="tab-rest-glyph" data-base="${position.part.base}">${renderRestGlyph(position.part.base, position.x, restMidY, restStaffLines)}${position.part.dotted ? `<circle class="tab-rest-dot" cx="${fmt(position.x + 9)}" cy="${fmt(restMidY)}" r="1.25" fill="#000"/>` : ''}</g>`;
      continue;
    }
    for (const note of position.beat.notes) {
      const y = lineYs[note.string - 1];
      const label = note.dead ? 'x' : String(note.fret ?? 0);
      const labelWidth = estimateTextWidth(label, NUMBER_SIZE, true);
      out += `<text class="tab-fret" data-string="${note.string}" x="${fmt(position.x)}" y="${fmt(y + 3.2)}" font-size="${NUMBER_SIZE}" font-weight="bold" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="2.5">${escapeXml(label)}</text>`;
      out += renderNoteEffects(note.effects, position, y, labelWidth);
    }
    out += renderBeatEffects(position.beat.effects, position, rowEntries.filter(entry => entry.measureIndex === position.measureIndex), top);
  }

  out += renderTabConnections(ctx, measures, rowPositionByBeat, allEntries, lineYs, xStart, xEnd);
  out += renderTabLyrics(rowEntries, geometry);
  return `<g class="tab-staff">${out}</g>`;
}

function voiceOne(measure: MeasureData): TabVoiceMeasure | undefined {
  return measure.tabVoices?.find(voice => voice.voice === 1);
}

function spreadCollisions(positions: BeatPosition[], min: number, max: number): void {
  for (let index = 1; index < positions.length; index++) {
    const before = positions[index - 1];
    const current = positions[index];
    const beforeWidth = beatLabelWidth(before.beat);
    const currentWidth = beatLabelWidth(current.beat);
    current.x = Math.max(current.x, before.x + Math.max(9, (beforeWidth + currentWidth) / 2 + NUMBER_GAP));
    current.stemX = current.x + 5;
  }
  if (positions.length === 0) return;
  const shift = Math.min(0, max - positions[positions.length - 1].x);
  positions.forEach(position => {
    position.x = Math.max(min, position.x + shift);
    position.stemX = position.x + 5;
  });
}

function beatLabelWidth(beat: TabBeat): number {
  const durationLabel = singlePartDuration(beat.duration.parts, beat.duration.beats) || beat.duration.parts.length < 2
    ? 0
    : estimateTextWidth(beat.duration.parts.map(formatNoteValuePart).join('+'), 6.5, false);
  return Math.max(durationLabel, ...beat.notes.map(note => estimateTextWidth(note.dead ? 'x' : String(note.fret ?? 0), NUMBER_SIZE, true)));
}

function singlePartDuration(parts: readonly NoteValuePart[], beats: Fraction): NoteValuePart | undefined {
  if (parts.length === 0) return undefined;
  const tuplets: Array<NoteValuePart['tuplet']> = [undefined];
  for (const part of parts) {
    if (part.tuplet && !tuplets.some(value => value?.actual === part.tuplet!.actual && value.normal === part.tuplet!.normal)) {
      tuplets.push(part.tuplet);
    }
  }
  for (const base of [1, 2, 4, 8, 16] as const) {
    for (const dotted of [false, true]) {
      for (const tuplet of tuplets) {
        const candidate: NoteValuePart = { base, dotted, ...(tuplet ? { tuplet } : {}) };
        if (fcmp(partBeats(candidate), beats) === 0) return candidate;
      }
    }
  }
  return undefined;
}

function fallbackRhythmPart(parts: readonly NoteValuePart[]): NoteValuePart {
  if (parts.length < 2) return parts[0] ?? { base: 4, dotted: false };
  const base = Math.max(...parts.map(part => part.base)) as NoteBase;
  return { base, dotted: false };
}

function beamGroupKey(measure: MeasureData, position: BeatPosition): number {
  // Beat grouping is stable for the measure even if rendering geometry distributes the x positions.
  return beamGroupIndex(measure.context.timeSignature, fnum(position.offset));
}

function renderTabBarline(measure: MeasureData, left: number, right: number, top: number, bottom: number): string {
  const width = measure.finalEnd || measure.repeatEnd ? 2.5 : 1.1;
  let out = `<line class="tab-barline" x1="${fmt(right)}" y1="${fmt(top)}" x2="${fmt(right)}" y2="${fmt(bottom)}" stroke="#000" stroke-width="${width}"/>`;
  if (measure.repeatStart) {
    out += `<line class="tab-repeat-start" x1="${fmt(left)}" y1="${fmt(top)}" x2="${fmt(left)}" y2="${fmt(bottom)}" stroke="#000" stroke-width="2.5"/>`;
    out += `<line x1="${fmt(left + 4)}" y1="${fmt(top)}" x2="${fmt(left + 4)}" y2="${fmt(bottom)}" stroke="#000" stroke-width="1"/>`;
  }
  return out;
}

function renderNoteEffects(effects: readonly TabEffectCall[], position: BeatPosition, y: number, labelWidth: number): string {
  let out = '';
  for (const effect of effects) {
    if (effect.name === 'bend' && typeof effect.args.amount === 'number') {
      out += renderBend(position.x - labelWidth / 2, y - 2, y - 25, effect.args.amount);
    } else if (effect.name === 'vibrato') {
      out += renderVibrato(position.x + labelWidth / 2 + 4, position.x + labelWidth / 2 + 17, y - 5);
    } else if (effect.name === 'pm' || effect.name === 'let-ring') {
      out += renderRangeMark(effect.name, position.x, position.x + Math.max(12, labelWidth + 8), position.x, y - 7);
    }
  }
  return out;
}

function renderBeatEffects(effects: readonly TabEffectCall[], position: BeatPosition, positions: BeatPosition[], top: number): string {
  let out = '';
  for (const effect of effects) {
    if (effect.name !== 'pm' && effect.name !== 'let-ring') continue;
    const next = positions[position.beatIndex + 1];
    const end = next?.x ?? position.measureEnd;
    out += renderRangeMark(effect.name, position.x, end, (position.x + end) / 2, top - 7);
  }
  return out;
}

function renderRangeMark(name: 'pm' | 'let-ring', x1: number, x2: number, labelX: number, y: number): string {
  const label = name === 'pm' ? 'P.M.' : 'let ring';
  return `<g class="tab-effect-range tab-effect-${name}"><text x="${fmt(labelX)}" y="${fmt(y)}" font-size="6.5" font-style="italic" text-anchor="middle">${label}</text><path d="M ${fmt(x1)},${fmt(y + 2)} v 3 H ${fmt(x2)} v -3" fill="none" stroke="#000" stroke-width="0.8"/></g>`;
}

function renderTabConnections(
  ctx: RenderContext,
  measures: MeasureData[],
  rowPositions: Map<string, BeatPosition>,
  allEntries: { measureIndex: number; beatIndex: number; beat: TabBeat }[],
  lineYs: number[],
  xStart: number,
  xEnd: number
): string {
  let out = '';
  const rowMeasureIndexes = new Set(measures.map(measure => measure.measureIndex));
  const allBeats = allEntries.map(entry => entry.beat);
  const sourceEntries = allEntries;
  for (let sourceIndex = 0; sourceIndex < sourceEntries.length; sourceIndex++) {
    const source = sourceEntries[sourceIndex];
    const sourceBeat = rowPositions.get(`${source.measureIndex}:${source.beatIndex}`);
    if (!sourceBeat) continue;
    for (const note of source.beat.notes) {
      const fromX = sourceBeat.x;
      const y = lineYs[note.string - 1];
      const tieResolution = note.tieToNext ? resolveTabLinkTarget(allBeats, sourceIndex, note, 'tie') : undefined;
      const tieTarget = tieResolution?.status === 'valid' ? allEntries[tieResolution.targetIndex] : undefined;
      const hasConnection = note.effects.some(effect => ['hammer', 'pull', 'slide', 'gliss'].includes(effect.name));
      const connectionResolution = hasConnection ? resolveTabLinkTarget(allBeats, sourceIndex, note, 'connection') : undefined;
      const connectionTarget = connectionResolution?.status === 'valid' ? allEntries[connectionResolution.targetIndex] : undefined;
      const targetPosition = tieTarget ? rowPositions.get(`${tieTarget.measureIndex}:${tieTarget.beatIndex}`) : undefined;
      if (note.tieToNext && tieTarget) {
        const toX = targetPosition?.x ?? xEnd - 4;
        out += `<g class="tab-tie" data-string="${note.string}">${renderTieArc(fromX + 5, toX - 5, y - 5, false)}</g>`;
      }
      for (const effect of note.effects) {
        if (!['hammer', 'pull', 'slide', 'gliss'].includes(effect.name) || !connectionTarget) continue;
        const connectionPosition = rowPositions.get(`${connectionTarget.measureIndex}:${connectionTarget.beatIndex}`);
        const toX = connectionPosition?.x ?? xEnd - 4;
        if (effect.name === 'hammer' || effect.name === 'pull') out += renderHammerPull(effect.name, fromX + 5, toX - 5, y - 6, false);
        else if (effect.name === 'slide') out += renderSlide(fromX + 5, y - 4, toX - 5, y - 4);
        else out += renderGliss(fromX + 5, y - 4, toX - 5, y - 4);
      }
    }
  }

  // Incoming links from a previous system continue with the same mark at the current system edge.
  for (const current of sourceEntries) {
    const position = rowPositions.get(`${current.measureIndex}:${current.beatIndex}`);
    if (!position) continue;
    const currentIndex = allEntries.findIndex(entry => entry.measureIndex === current.measureIndex && entry.beatIndex === current.beatIndex);
    if (currentIndex < 0) continue;
    for (let sourceIndex = currentIndex - 1; sourceIndex >= 0; sourceIndex--) {
      const source = allEntries[sourceIndex];
      if (rowMeasureIndexes.has(source.measureIndex)) continue;
      for (const note of source.beat.notes) {
        const y = lineYs[note.string - 1];
        const tieResolution = note.tieToNext ? resolveTabLinkTarget(allBeats, sourceIndex, note, 'tie') : undefined;
        if (tieResolution?.status === 'valid' && tieResolution.targetIndex === currentIndex) {
          out += `<g class="tab-tie" data-string="${note.string}">${renderTieArc(xStart + 3, position.x - 5, y - 5, false)}</g>`;
        }
        const hasConnection = note.effects.some(effect => ['hammer', 'pull', 'slide', 'gliss'].includes(effect.name));
        const connectionResolution = hasConnection ? resolveTabLinkTarget(allBeats, sourceIndex, note, 'connection') : undefined;
        if (connectionResolution?.status !== 'valid' || connectionResolution.targetIndex !== currentIndex) continue;
        for (const effect of note.effects) {
          if (!['hammer', 'pull', 'slide', 'gliss'].includes(effect.name)) continue;
          if (effect.name === 'hammer' || effect.name === 'pull') out += renderHammerPull(effect.name, xStart + 3, position.x - 5, y - 6, false);
          else if (effect.name === 'slide') out += renderSlide(xStart + 3, y - 4, position.x - 5, y - 4);
          else out += renderGliss(xStart + 3, y - 4, position.x - 5, y - 4);
        }
      }
    }
  }
  return out;
}

function renderTabLyrics(entries: BeatPosition[], geometry: SystemGeometry): string {
  let out = '';
  const verseCount = Math.max(0, ...entries.map(position => position.beat.syllables.length));
  const lyricSize = 10;
  for (let verse = 0; verse < verseCount; verse++) {
    const baseline = geometry.tabLyricBaseline + verse * geometry.tabLyricLineHeight;
    let lastEnd: number | null = null;
    let pendingHyphenFrom: number | null = null;
    for (const position of entries) {
      const syllable = position.beat.syllables[verse];
      if (!syllable) continue;
      if (syllable.extend) {
        if (lastEnd !== null) {
          const x2 = position.x;
          out += `<line class="tab-lyric-extension" x1="${fmt(lastEnd + 1)}" y1="${fmt(baseline + 1)}" x2="${fmt(x2)}" y2="${fmt(baseline + 1)}" stroke="#222" stroke-width="0.8"/>`;
          lastEnd = x2;
        }
        continue;
      }
      const halfWidth = estimateTextWidth(syllable.text, lyricSize, false) / 2;
      if (pendingHyphenFrom !== null) {
        const hyphenX = (pendingHyphenFrom + (position.x - halfWidth)) / 2;
        out += `<text class="tab-lyric-hyphen" x="${fmt(hyphenX)}" y="${fmt(baseline)}" font-size="${lyricSize}" text-anchor="middle" fill="#222">-</text>`;
        pendingHyphenFrom = null;
      }
      out += `<text class="tab-lyric" x="${fmt(position.x)}" y="${fmt(baseline)}" font-size="${lyricSize}" text-anchor="middle" fill="#222">${escapeXml(syllable.text)}</text>`;
      lastEnd = position.x + halfWidth;
      if (syllable.hyphenToNext) pendingHyphenFrom = lastEnd;
    }
    if (pendingHyphenFrom !== null) {
      out += `<text class="tab-lyric-hyphen" x="${fmt(pendingHyphenFrom + 6)}" y="${fmt(baseline)}" font-size="${lyricSize}" text-anchor="middle" fill="#222">-</text>`;
    }
  }
  return out;
}
