export type PracticeGuideStrokeKind = 'attack' | 'mute' | 'brush' | 'tie' | 'string';
export type PracticeGuideStrokeDirection = 'down' | 'up' | 'both' | 'neutral';

export interface PracticeGuideStrokeSpec {
  kind: PracticeGuideStrokeKind;
  direction?: PracticeGuideStrokeDirection;
  stringNumber?: number;
  palmMute?: boolean;
  label: string;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const DOWN = '<path d="M10 3v25M4 22l6 7 6-7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
const UP = '<path d="M10 31V6M4 12l6-7 6 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
const CROSS = '<path d="m1 9 6 6m0-6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>';
const PALM_MUTE_LABEL_WIDTH = 12;
export const PRACTICE_GUIDE_COMPACT_MARK_WIDTH = 15;
export const PRACTICE_GUIDE_COMPACT_MARK_HEIGHT = 47;
/** Native trace bounds for the inset stroke track inside each reference measure. */
export const PRACTICE_GUIDE_COMPACT_REFERENCE_LAYOUT = {
  8: { measureWidth: 366, trackInset: 34, trackWidth: 324 },
  16: { measureWidth: 400, trackInset: 32, trackWidth: 324 }
} as const;
const COMPACT_ATTACK_WIDTH = PRACTICE_GUIDE_COMPACT_MARK_WIDTH;
const COMPACT_ATTACK_HEIGHT = PRACTICE_GUIDE_COMPACT_MARK_HEIGHT;
const COMPACT_BRUSH_WIDTH = PRACTICE_GUIDE_COMPACT_MARK_WIDTH * 2;
const COMPACT_BOTH_WIDTH = PRACTICE_GUIDE_COMPACT_MARK_WIDTH * 2;
const COMPACT_WAVE_WIDTH = PRACTICE_GUIDE_COMPACT_MARK_WIDTH;
const COMPACT_WAVE_OFFSET_Y = 21;
const COMPACT_ATTACK_STROKE_WIDTH = 2.65;
const COMPACT_WAVE_STROKE_WIDTH = 2.35;
const COMPACT_AUX_STROKE_ATTRIBUTES = 'fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="miter"';

export type PracticeGuideCompactWaveVariant = 'narrow' | 'medium' | 'wide';

export const PRACTICE_GUIDE_COMPACT_WAVE_THRESHOLDS = { wide: 7, medium: 5.5 } as const;

export const PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS: Record<PracticeGuideCompactWaveVariant, { width: number; path: string }> = {
  narrow: {
    width: COMPACT_WAVE_WIDTH,
    path: 'M0 0 C3.2 -3.35 5.2 -3.35 7.5 0 S12.4 3.35 15 0'
  },
  medium: {
    width: COMPACT_WAVE_WIDTH,
    path: 'M0 0 C3.2 -3.35 5.2 -3.35 7.5 0 S12.4 3.35 15 0'
  },
  wide: {
    width: COMPACT_WAVE_WIDTH,
    path: 'M0 0 C3.2 -3.35 5.2 -3.35 7.5 0 S12.4 3.35 15 0'
  }
};

/** Selects the fixed grid16 path using its actual horizontal beat interval. */
export function practiceGuideCompactWaveVariant(
  slotWidth: number,
  measureBeats: number,
  grid: number
): PracticeGuideCompactWaveVariant {
  if (grid !== 16) return 'wide';
  const cell = (slotWidth - 10) / (Math.max(0.000001, measureBeats) * 4);
  return cell >= PRACTICE_GUIDE_COMPACT_WAVE_THRESHOLDS.wide ? 'wide'
    : cell >= PRACTICE_GUIDE_COMPACT_WAVE_THRESHOLDS.medium ? 'medium'
      : 'narrow';
}

export const PRACTICE_GUIDE_COMPACT_PATHS = {
  downShaft: 'M0 0 V31',
  downHead: 'M-7.5 30 L7.5 30 L0 47 Z',
  upShaft: 'M0 47 V17',
  upHead: 'M-7.5 17 L0 0 L7.5 17 Z',
  wave: PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS.wide.path,
  grid16WaveNarrow: PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS.narrow.path,
  grid16WaveMedium: PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS.medium.path,
  grid16WaveWide: PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS.wide.path,
  brushCross: 'M5.5 15 L9.5 19 M9.5 15 L5.5 19'
} as const;

/** Returns the CSS width occupied by a stroke and its optional palm-mute label. */
export function practiceGuideStrokeVisualWidth(spec: PracticeGuideStrokeSpec): number {
  const iconWidth = spec.kind === 'tie' ? 32 : spec.kind === 'brush' ? 20 : spec.kind === 'string' ? 16 : 14;
  return spec.palmMute ? PALM_MUTE_LABEL_WIDTH + 2 + iconWidth : iconWidth;
}

/** Returns the natural width of a compact-only icon in its fixed 47-unit reference height. */
export function practiceGuideCompactStrokeVisualWidth(spec: PracticeGuideStrokeSpec): number {
  const iconWidth = spec.kind === 'tie' ? COMPACT_WAVE_WIDTH
    : spec.kind === 'brush' ? COMPACT_BRUSH_WIDTH
      : spec.kind === 'attack' && spec.direction === 'both' ? COMPACT_BOTH_WIDTH
        : COMPACT_ATTACK_WIDTH;
  return iconWidth;
}

function compactIconSvg(width: number, kind: PracticeGuideStrokeKind, marks: string): string {
  return `<svg class="practice-guide-stroke-icon practice-guide-compact-stroke-icon" data-guide-stroke="${kind}" x="0" y="0" width="${width}" height="${COMPACT_ATTACK_HEIGHT}" viewBox="0 0 ${width} ${COMPACT_ATTACK_HEIGHT}" aria-hidden="true" focusable="false">${marks}</svg>`;
}

function compactAttackPath(direction: 'down' | 'up', x: number): string {
  const shaft = direction === 'down' ? PRACTICE_GUIDE_COMPACT_PATHS.downShaft : PRACTICE_GUIDE_COMPACT_PATHS.upShaft;
  const head = direction === 'down' ? PRACTICE_GUIDE_COMPACT_PATHS.downHead : PRACTICE_GUIDE_COMPACT_PATHS.upHead;
  return `<g transform="translate(${x} 0)"><path class="practice-guide-compact-attack-shaft" data-guide-compact-part="shaft" d="${shaft}" fill="none" stroke="currentColor" stroke-width="${COMPACT_ATTACK_STROKE_WIDTH}" stroke-linecap="butt"/><path class="practice-guide-compact-attack-head" data-guide-compact-part="head" d="${head}" fill="currentColor" stroke="none"/></g>`;
}

/** One screenshot-traced continuation/tie master; grid labels never select another path. */
export function renderPracticeGuideCompactWavePathSvg(
  label: string,
  grid?: number,
  variant: PracticeGuideCompactWaveVariant = 'narrow'
): string {
  const safeLabel = escapeAttribute(label);
  const isGrid16 = grid === 16;
  const selectedVariant = isGrid16 ? variant : 'wide';
  const geometry = PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS[selectedVariant];
  const width = geometry.width;
  return `<svg class="practice-guide-stroke-icon practice-guide-compact-wave-icon" data-guide-wave-variant="${selectedVariant}" width="${width}" height="${COMPACT_ATTACK_HEIGHT}" viewBox="0 0 ${width} ${COMPACT_ATTACK_HEIGHT}" aria-hidden="true" focusable="false"><title>${safeLabel}</title><g transform="translate(0 ${COMPACT_WAVE_OFFSET_Y})"><path class="practice-guide-wave-path" data-guide-stroke="wave" data-guide-wave-width="${width.toFixed(2)}" data-guide-wave-offset-y="${COMPACT_WAVE_OFFSET_Y}" data-guide-wave-variant="${selectedVariant}" d="${geometry.path}" fill="none" stroke="currentColor" stroke-width="${COMPACT_WAVE_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
}

/** Renders compact-only path geometry; detailed-grid SVGs keep their existing renderer. */
export function renderPracticeGuideCompactStrokeSvgElement(spec: PracticeGuideStrokeSpec): string {
  const label = escapeAttribute(spec.label);
  if (spec.kind === 'tie') {
    return renderPracticeGuideCompactWavePathSvg(label).replace('data-guide-stroke="wave"', 'data-guide-stroke="tie"');
  }
  if (spec.kind === 'mute') {
    return compactIconSvg(COMPACT_ATTACK_WIDTH, spec.kind,
      '<circle cx="7.5" cy="23.5" r="2.8" fill="currentColor"/>');
  }
  if (spec.kind === 'string') {
    const number = Math.max(1, Math.min(6, Math.floor(spec.stringNumber ?? 1)));
    return compactIconSvg(COMPACT_ATTACK_WIDTH, spec.kind,
      `<text x="7.5" y="30" text-anchor="middle" font-family="sans-serif" font-size="18" font-weight="700" fill="currentColor">${number}</text>`);
  }

  const direction = spec.direction ?? (spec.kind === 'brush' ? 'down' : 'neutral');
  if (spec.kind === 'brush') {
    const arrow = direction === 'up' ? compactAttackPath('up', 22.5) : compactAttackPath('down', 22.5);
    const cross = `<path class="practice-guide-compact-brush-cross" d="${PRACTICE_GUIDE_COMPACT_PATHS.brushCross}" ${COMPACT_AUX_STROKE_ATTRIBUTES}/>`;
    return compactIconSvg(COMPACT_BRUSH_WIDTH, spec.kind, `${cross}${arrow}`);
  }
  if (direction === 'down' || direction === 'both') {
    const down = compactAttackPath('down', 7.5);
    if (direction !== 'both') return compactIconSvg(COMPACT_ATTACK_WIDTH, spec.kind, down);
    const up = compactAttackPath('up', 22.5);
    return compactIconSvg(COMPACT_BOTH_WIDTH, spec.kind, `${down}${up}`);
  }
  if (direction === 'up') {
    return compactIconSvg(COMPACT_ATTACK_WIDTH, spec.kind, compactAttackPath('up', 7.5));
  }
  return compactIconSvg(COMPACT_ATTACK_WIDTH, spec.kind,
    '<circle cx="7.5" cy="23.5" r="2.8" fill="currentColor"/>');
}

/** Renders a visible stroke mark with vector geometry; descriptive text is only metadata. */
export function renderPracticeGuideStrokeSvg(spec: PracticeGuideStrokeSpec): string {
  const label = escapeAttribute(spec.label);
  if (spec.palmMute) {
    const arrow = renderPracticeGuideStrokeSvg({ ...spec, palmMute: false });
    return `<span class="practice-guide-pm-stroke" role="img" aria-label="${label}" title="${label}"><span class="practice-guide-pm-label">PM</span>${arrow}</span>`;
  }
  let marks = '';
  if (spec.kind === 'mute') {
    marks = '<circle cx="10" cy="17" r="3.5" fill="currentColor"/>';
  } else if (spec.kind === 'tie') {
    return `<svg class="practice-guide-stroke-icon practice-guide-wave" data-guide-stroke="tie" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 16" role="img" aria-label="${label}" width="32" height="18"><title>${label}</title><path d="M2 9Q6 3 10 9T18 9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;
  } else if (spec.kind === 'string') {
    const number = Math.max(1, Math.min(6, Math.floor(spec.stringNumber ?? 1)));
    marks = `<text x="10" y="21" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="700" fill="currentColor">${number}</text>`;
  } else {
    const direction = spec.direction ?? (spec.kind === 'brush' ? 'down' : 'neutral');
    if (spec.kind === 'brush') {
      marks += CROSS;
      if (direction === 'up') marks += '<path d="M14 31V6m-5 6 5-7 5 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
      else marks += '<path d="M14 3v25m-5-6 5 7 5-7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
    } else {
      if (direction === 'down' || direction === 'both') marks += DOWN;
      if (direction === 'up' || direction === 'both') marks += UP;
    }
    if (direction === 'neutral') marks += '<circle cx="10" cy="17" r="3" fill="currentColor"/>';
  }
  const width = practiceGuideStrokeVisualWidth(spec);
  return `<svg class="practice-guide-stroke-icon" data-guide-stroke="${spec.kind}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 34" role="img" aria-label="${label}" width="${width}" height="28"><title>${label}</title>${marks}</svg>`;
}

/** Renders the same stroke geometry as an SVG child for compact measure roots. */
export function renderPracticeGuideStrokeSvgElement(spec: PracticeGuideStrokeSpec, x = 0, y = 0): string {
  const label = escapeAttribute(spec.label);
  if (spec.palmMute) {
    const icon = renderPracticeGuideStrokeSvgElement({ ...spec, palmMute: false }, x + PALM_MUTE_LABEL_WIDTH + 2, y);
    return `<g class="practice-guide-pm-stroke" role="img" aria-label="${label}"><title>${label}</title><text class="practice-guide-pm-label" x="${x}" y="${y + 18}" text-anchor="start" font-family="sans-serif" font-size="8" font-weight="700" fill="currentColor">PM</text>${icon}</g>`;
  }
  if (spec.kind === 'tie') {
    return `<g class="practice-guide-stroke-icon practice-guide-wave" data-guide-stroke="tie" role="img" aria-label="${label}"><title>${label}</title><path d="M${x} ${y + 9}Q${x + 3} ${y + 3} ${x + 6} ${y + 9}T${x + 12} ${y + 9}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></g>`;
  }
  let marks = '';
  if (spec.kind === 'mute') {
    marks = `<circle cx="${x + 10}" cy="${y + 17}" r="3.5" fill="currentColor"/>`;
  } else if (spec.kind === 'string') {
    const number = Math.max(1, Math.min(6, Math.floor(spec.stringNumber ?? 1)));
    marks = `<text x="${x + 10}" y="${y + 21}" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="700" fill="currentColor">${number}</text>`;
  } else {
    const direction = spec.direction ?? (spec.kind === 'brush' ? 'down' : 'neutral');
    if (spec.kind === 'brush') {
      marks += `<path d="M${x + 1} ${y + 9}l6 6m0-6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`;
      marks += direction === 'up'
        ? `<path d="M${x + 14} ${y + 31}V${y + 6}m-5 6 5-7 5 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<path d="M${x + 14} ${y + 3}v25m-5-6 5 7 5-7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else {
      if (direction === 'down' || direction === 'both') marks += `<path d="M${x + 10} ${y + 3}v25m-6-6 6 7 6-7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      if (direction === 'up' || direction === 'both') marks += `<path d="M${x + 10} ${y + 31}V${y + 6}m-6 6 6-7 6 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      if (direction === 'neutral') marks += `<circle cx="${x + 10}" cy="${y + 17}" r="3" fill="currentColor"/>`;
    }
  }
  return `<g class="practice-guide-stroke-icon" data-guide-stroke="${spec.kind}" role="img" aria-label="${label}"><title>${label}</title>${marks}</g>`;
}

/** One canonical compact continuation marker; callers place and uniformly scale each Fraction independently. */
export function renderPracticeGuideWavePathSvg(label: string): string {
  const safeLabel = escapeAttribute(label);
  return `<path class="practice-guide-wave-path" data-guide-stroke="wave" data-guide-wave-width="12.00" d="M0 9Q3.00 3 6.00 9T12.00 9" fill="none" stroke="currentColor" stroke-width="1.50" stroke-linecap="round" role="img" aria-label="${safeLabel}"><title>${safeLabel}</title></path>`;
}

/** One stretched duration wave; callers add at most one per written onset. */
export function renderPracticeGuideWaveSvg(label: string, width: number): string {
  const safeWidth = Math.max(18, Math.min(88, Math.round(width)));
  const safeLabel = escapeAttribute(label);
  return `<svg class="practice-guide-stroke-icon practice-guide-wave" data-guide-stroke="wave" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 16" role="img" aria-label="${safeLabel}" width="${safeWidth}" height="18"><title>${safeLabel}</title><path d="M2 9Q6 3 10 9T18 9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;
}
