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
const COMPACT_ATTACK_WIDTH = 10;
const COMPACT_ATTACK_HEIGHT = 36;
const COMPACT_BRUSH_WIDTH = 18;
const COMPACT_BOTH_WIDTH = 20;
const COMPACT_TIE_WIDTH = 12;
const COMPACT_PALM_MUTE_LABEL_WIDTH = 12;
const COMPACT_STROKE_WIDTH = 1.8;

/** Returns the CSS width occupied by a stroke and its optional palm-mute label. */
export function practiceGuideStrokeVisualWidth(spec: PracticeGuideStrokeSpec): number {
  const iconWidth = spec.kind === 'tie' ? 32 : spec.kind === 'brush' ? 20 : spec.kind === 'string' ? 16 : 14;
  return spec.palmMute ? PALM_MUTE_LABEL_WIDTH + 2 + iconWidth : iconWidth;
}

/** Returns the natural width of a compact-only icon master in its local 36-unit height. */
export function practiceGuideCompactStrokeVisualWidth(spec: PracticeGuideStrokeSpec): number {
  const iconWidth = spec.kind === 'tie' ? COMPACT_TIE_WIDTH
    : spec.kind === 'brush' ? COMPACT_BRUSH_WIDTH
      : spec.kind === 'attack' && spec.direction === 'both' ? COMPACT_BOTH_WIDTH
        : COMPACT_ATTACK_WIDTH;
  return spec.palmMute ? COMPACT_PALM_MUTE_LABEL_WIDTH + 2 + iconWidth : iconWidth;
}

function compactIconSvg(width: number, x: number, y: number, kind: PracticeGuideStrokeKind, marks: string): string {
  return `<svg class="practice-guide-stroke-icon practice-guide-compact-stroke-icon" data-guide-stroke="${kind}" x="${x}" y="${y}" width="${width}" height="${COMPACT_ATTACK_HEIGHT}" viewBox="0 0 ${width} ${COMPACT_ATTACK_HEIGHT}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${marks}</svg>`;
}

function compactAttackPath(direction: 'down' | 'up', x: number, y: number): string {
  const shaft = direction === 'down'
    ? `M${x + 5} ${y + 3}V${y + 32}`
    : `M${x + 5} ${y + 33}V${y + 4}`;
  const head = direction === 'down'
    ? `M${x + 2.5} ${y + 27}L${x + 5} ${y + 32}L${x + 7.5} ${y + 27}`
    : `M${x + 2.5} ${y + 9}L${x + 5} ${y + 4}L${x + 7.5} ${y + 9}`;
  const stroke = `fill="none" stroke="currentColor" stroke-width="${COMPACT_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"`;
  return `<path class="practice-guide-compact-attack-shaft" data-guide-compact-part="shaft" d="${shaft}" ${stroke}/><path class="practice-guide-compact-attack-head" data-guide-compact-part="head" d="${head}" ${stroke}/>`;
}

/** Renders compact-only portrait attack geometry; detailed-grid SVGs keep their existing renderer. */
export function renderPracticeGuideCompactStrokeSvgElement(spec: PracticeGuideStrokeSpec): string {
  const label = escapeAttribute(spec.label);
  if (spec.palmMute) {
    const icon = renderPracticeGuideCompactStrokeSvgElement({ ...spec, palmMute: false });
    return `<g class="practice-guide-pm-stroke"><text class="practice-guide-pm-label" x="0" y="21" text-anchor="start" font-family="sans-serif" font-size="8" font-weight="700" fill="currentColor">PM</text><g transform="translate(${COMPACT_PALM_MUTE_LABEL_WIDTH + 2} 0)">${icon}</g></g>`;
  }

  if (spec.kind === 'tie') {
    return compactIconSvg(COMPACT_TIE_WIDTH, 0, 0, spec.kind,
      `<path d="M0 21Q3 15 6 21T12 21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`);
  }

  if (spec.kind === 'mute') {
    return compactIconSvg(COMPACT_ATTACK_WIDTH, 0, 0, spec.kind,
      '<circle cx="5" cy="18" r="3.5" fill="currentColor"/>');
  }

  if (spec.kind === 'string') {
    const number = Math.max(1, Math.min(6, Math.floor(spec.stringNumber ?? 1)));
    return compactIconSvg(COMPACT_ATTACK_WIDTH, 0, 0, spec.kind,
      `<text x="5" y="22" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="700" fill="currentColor">${number}</text>`);
  }

  const direction = spec.direction ?? (spec.kind === 'brush' ? 'down' : 'neutral');
  if (spec.kind === 'brush') {
    const arrow = direction === 'up'
      ? compactAttackPath('up', 8, 0)
      : compactAttackPath('down', 8, 0);
    return compactIconSvg(COMPACT_BRUSH_WIDTH, 0, 0, spec.kind,
      `<path d="M1 13l6 6m0-6-6 6" fill="none" stroke="currentColor" stroke-width="${COMPACT_STROKE_WIDTH}" stroke-linecap="round"/>${arrow}`);
  }

  if (direction === 'down' || direction === 'both') {
    const down = compactAttackPath('down', 0, 0);
    if (direction !== 'both') return compactIconSvg(COMPACT_ATTACK_WIDTH, 0, 0, spec.kind, down);
    const up = compactAttackPath('up', 10, 0);
    return compactIconSvg(COMPACT_BOTH_WIDTH, 0, 0, spec.kind, `${down}${up}`);
  }
  if (direction === 'up') {
    return compactIconSvg(COMPACT_ATTACK_WIDTH, 0, 0, spec.kind, compactAttackPath('up', 0, 0));
  }
  return compactIconSvg(COMPACT_ATTACK_WIDTH, 0, 0, spec.kind,
    '<circle cx="5" cy="18" r="3" fill="currentColor"/>');
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
