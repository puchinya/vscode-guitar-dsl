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
const COMPACT_ATTACK_WIDTH = 4;
const COMPACT_ATTACK_HEIGHT = 30;
const COMPACT_BRUSH_WIDTH = 8;
const COMPACT_BOTH_WIDTH = 8;
const COMPACT_WAVE_WIDTH = 5.6;
const COMPACT_STROKE_WIDTH = 1.15;
const COMPACT_STROKE_ATTRIBUTES = `fill="none" stroke="currentColor" stroke-width="${COMPACT_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="miter" vector-effect="non-scaling-stroke"`;

export type PracticeGuideCompactWaveVariant = 'narrow' | 'medium' | 'wide';

export const PRACTICE_GUIDE_COMPACT_WAVE_THRESHOLDS = { wide: 7, medium: 5.5 } as const;

export const PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS: Record<PracticeGuideCompactWaveVariant, { width: number; path: string }> = {
  narrow: {
    width: 2.4,
    path: 'M0.15 15 C0.45 9.8 0.90 9.8 1.20 15 S1.95 20.2 2.25 15'
  },
  medium: {
    width: 4.2,
    path: 'M0.45 15 C1.00 10.4 1.55 10.4 2.10 15 S3.20 19.6 3.75 15'
  },
  wide: {
    width: COMPACT_WAVE_WIDTH,
    path: 'M0.40 15 C1.15 10.8 2.00 10.8 2.80 15 S4.45 19.2 5.20 15'
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
  downShaft: 'M2 1 V27.8',
  downHead: 'M0.55 24 L2 28.5 L3.45 24',
  upShaft: 'M2 29 V2.2',
  upHead: 'M0.55 6 L2 1.5 L3.45 6',
  wave: PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS.wide.path,
  grid16WaveNarrow: PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS.narrow.path,
  grid16WaveMedium: PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS.medium.path,
  grid16WaveWide: PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS.wide.path,
  brushCross: 'M0.5 11 L2.5 13 M2.5 11 L0.5 13'
} as const;

/** Returns the CSS width occupied by a stroke and its optional palm-mute label. */
export function practiceGuideStrokeVisualWidth(spec: PracticeGuideStrokeSpec): number {
  const iconWidth = spec.kind === 'tie' ? 32 : spec.kind === 'brush' ? 20 : spec.kind === 'string' ? 16 : 14;
  return spec.palmMute ? PALM_MUTE_LABEL_WIDTH + 2 + iconWidth : iconWidth;
}

/** Returns the natural width of a compact-only icon in its fixed 30-unit height. */
export function practiceGuideCompactStrokeVisualWidth(spec: PracticeGuideStrokeSpec): number {
  const iconWidth = spec.kind === 'tie' ? COMPACT_WAVE_WIDTH
    : spec.kind === 'brush' ? COMPACT_BRUSH_WIDTH
      : spec.kind === 'attack' && spec.direction === 'both' ? COMPACT_BOTH_WIDTH
        : COMPACT_ATTACK_WIDTH;
  return iconWidth;
}

function compactIconSvg(width: number, kind: PracticeGuideStrokeKind, marks: string): string {
  return `<svg class="practice-guide-stroke-icon practice-guide-compact-stroke-icon" data-guide-stroke="${kind}" x="0" y="0" width="${width}" height="${COMPACT_ATTACK_HEIGHT}" viewBox="0 0 ${width} ${COMPACT_ATTACK_HEIGHT}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${marks}</svg>`;
}

function compactAttackPath(direction: 'down' | 'up', x: number): string {
  const shaft = direction === 'down' ? PRACTICE_GUIDE_COMPACT_PATHS.downShaft : PRACTICE_GUIDE_COMPACT_PATHS.upShaft;
  const head = direction === 'down' ? PRACTICE_GUIDE_COMPACT_PATHS.downHead : PRACTICE_GUIDE_COMPACT_PATHS.upHead;
  return `<g transform="translate(${x} 0)"><path class="practice-guide-compact-attack-shaft" data-guide-compact-part="shaft" d="${shaft}" ${COMPACT_STROKE_ATTRIBUTES}/><path class="practice-guide-compact-attack-head" data-guide-compact-part="head" d="${head}" ${COMPACT_STROKE_ATTRIBUTES}/></g>`;
}

/** One fixed continuation/tie path; grid16 selects one of three fixed compact geometries. */
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
  return `<svg class="practice-guide-stroke-icon practice-guide-compact-wave-icon" data-guide-wave-variant="${selectedVariant}" width="${width}" height="${COMPACT_ATTACK_HEIGHT}" viewBox="0 0 ${width} ${COMPACT_ATTACK_HEIGHT}" aria-hidden="true" focusable="false"><title>${safeLabel}</title><path class="practice-guide-wave-path" data-guide-stroke="wave" data-guide-wave-width="${width.toFixed(2)}" data-guide-wave-variant="${selectedVariant}" d="${geometry.path}" ${COMPACT_STROKE_ATTRIBUTES}/></svg>`;
}

/** Renders compact-only path geometry; detailed-grid SVGs keep their existing renderer. */
export function renderPracticeGuideCompactStrokeSvgElement(spec: PracticeGuideStrokeSpec): string {
  const label = escapeAttribute(spec.label);
  if (spec.kind === 'tie') {
    return renderPracticeGuideCompactWavePathSvg(label).replace('data-guide-stroke="wave"', 'data-guide-stroke="tie"');
  }
  if (spec.kind === 'mute') {
    return compactIconSvg(COMPACT_ATTACK_WIDTH, spec.kind,
      '<circle cx="2" cy="15" r="1.6" fill="currentColor"/>');
  }
  if (spec.kind === 'string') {
    const number = Math.max(1, Math.min(6, Math.floor(spec.stringNumber ?? 1)));
    return compactIconSvg(COMPACT_ATTACK_WIDTH, spec.kind,
      `<text x="2" y="22" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="700" fill="currentColor">${number}</text>`);
  }

  const direction = spec.direction ?? (spec.kind === 'brush' ? 'down' : 'neutral');
  if (spec.kind === 'brush') {
    const arrow = direction === 'up' ? compactAttackPath('up', 4) : compactAttackPath('down', 4);
    const cross = `<path class="practice-guide-compact-brush-cross" d="${PRACTICE_GUIDE_COMPACT_PATHS.brushCross}" ${COMPACT_STROKE_ATTRIBUTES}/>`;
    return compactIconSvg(COMPACT_BRUSH_WIDTH, spec.kind, `${cross}${arrow}`);
  }
  if (direction === 'down' || direction === 'both') {
    const down = compactAttackPath('down', 0);
    if (direction !== 'both') return compactIconSvg(COMPACT_ATTACK_WIDTH, spec.kind, down);
    const up = compactAttackPath('up', 4);
    return compactIconSvg(COMPACT_BOTH_WIDTH, spec.kind, `${down}${up}`);
  }
  if (direction === 'up') {
    return compactIconSvg(COMPACT_ATTACK_WIDTH, spec.kind, compactAttackPath('up', 0));
  }
  return compactIconSvg(COMPACT_ATTACK_WIDTH, spec.kind,
    '<circle cx="2" cy="15" r="1.6" fill="currentColor"/>');
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
