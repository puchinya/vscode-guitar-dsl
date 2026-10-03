import { CHORD_QUALITIES, parseChordName, type ParsedChordName } from './chordDetect';
import { expandMeasureRepeat } from './compiler';
import type { ChordPlacement, MeasureData, ParsedScore } from './compiler';

export type HarmonicMode = 'major' | 'minor';
export type HarmonicStatus = 'recognized' | 'ambiguous' | 'unknown';
export type HarmonicKind = 'diatonic' | 'secondaryDominant' | 'borrowed' | 'chromatic';
export type HarmonicCadenceKind = 'authentic' | 'plagal' | 'half' | 'deceptive';
export type MinorScaleFit = 'natural' | 'harmonic' | 'both';

export interface NashvilleNumber {
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  accidental: -1 | 0 | 1;
  suffix: string;
}

export interface HarmonicSlashBass {
  written: string;
  writtenPc: number;
  soundingPc: number | null;
  intervalFromRoot: number;
  /** null means the chord quality is unsupported, so membership cannot be determined. */
  isChordTone: boolean | null;
}

export interface SecondaryDominantTarget {
  degree: 2 | 3 | 4 | 5 | 6 | 7;
  accidental: -1 | 0 | 1;
  soundingRootPc: number;
  scale: 'major' | 'naturalMinor' | 'harmonicMinor';
}

export type HarmonicUnknownReason = 'invalidChord' | 'invalidCapo' | 'invalidKey' | 'unsupportedQuality';

export interface HarmonicChordAnalysis {
  measureIndex: number;
  chordIndex: number;
  beat: number;
  writtenName: string;
  key: string;
  mode: HarmonicMode | null;
  soundingRootPc: number | null;
  status: HarmonicStatus;
  kind?: HarmonicKind;
  reason?: HarmonicUnknownReason;
  roman?: string;
  nashville?: NashvilleNumber;
  minorScaleFit?: MinorScaleFit;
  slashBass?: HarmonicSlashBass;
  secondaryTarget?: SecondaryDominantTarget;
}

export interface HarmonicAnalysisDiagnostic {
  code: HarmonicUnknownReason;
  value: string;
  measureIndex?: number;
  chordIndex?: number;
}

export interface HarmonicCadence {
  kind: HarmonicCadenceKind;
  key: string;
  sectionName?: string;
  from: { measureIndex: number; chordIndex: number };
  to: { measureIndex: number; chordIndex: number };
}

export interface HarmonicAnalysisResult {
  chords: HarmonicChordAnalysis[];
  cadences: HarmonicCadence[];
  diagnostics: HarmonicAnalysisDiagnostic[];
}

type QualityFamily = 'major' | 'minor' | 'diminished' | 'augmented' | 'thirdless';
type ScaleName = SecondaryDominantTarget['scale'];
type KeyInfo = { tonicPc: number; mode: HarmonicMode };
type NashvilleCoordinate = Pick<NashvilleNumber, 'degree' | 'accidental'>;

interface AnalyzedChordEvent {
  analysis: HarmonicChordAnalysis;
  family: QualityFamily;
}

interface SecondaryMatch {
  target: SecondaryDominantTarget;
  targetRoman: string;
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;
const NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10] as const;
const HARMONIC_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 11] as const;
const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;
const THIRDLESS_SUFFIXES = new Set(['sus2', 'sus4', '7sus4', '5']);

const CHROMATIC_DEGREES: readonly NashvilleCoordinate[] = [
  { degree: 1, accidental: 0 },
  { degree: 2, accidental: -1 },
  { degree: 2, accidental: 0 },
  { degree: 3, accidental: -1 },
  { degree: 3, accidental: 0 },
  { degree: 4, accidental: 0 },
  { degree: 4, accidental: 1 },
  { degree: 5, accidental: 0 },
  { degree: 6, accidental: -1 },
  { degree: 6, accidental: 0 },
  { degree: 7, accidental: -1 },
  { degree: 7, accidental: 0 }
];

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

function parseCapo(value: unknown): number | null {
  if (typeof value !== 'string' || !/^(?:0|[1-9]|1[0-2])$/.test(value)) return null;
  return Number(value);
}

function parseKey(value: unknown): KeyInfo | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^([A-G][b#]?)(m?)$/);
  if (!match) return null;
  const parsedRoot = parseChordName(match[1]);
  if (!parsedRoot) return null;
  return { tonicPc: parsedRoot.rootPc, mode: match[2] ? 'minor' : 'major' };
}

function scalePcs(tonicPc: number, intervals: readonly number[]): Set<number> {
  return new Set(intervals.map(interval => mod12(tonicPc + interval)));
}

function qualityFitsScale(rootPc: number, intervals: readonly number[], scale: Set<number>): boolean {
  return intervals.every(interval => scale.has(mod12(rootPc + interval)));
}

function nashvilleFor(rootPc: number, key: KeyInfo, suffix: string): NashvilleNumber {
  const coordinate = CHROMATIC_DEGREES[mod12(rootPc - key.tonicPc)];
  return { ...coordinate, suffix };
}

function romanRoot(number: NashvilleCoordinate, family: QualityFamily): string {
  const numeral = ROMAN_NUMERALS[number.degree - 1];
  const caseAdjusted = family === 'minor' || family === 'diminished' ? numeral.toLowerCase() : numeral;
  const accidental = number.accidental === -1 ? 'b' : number.accidental === 1 ? '#' : '';
  return `${accidental}${caseAdjusted}`;
}

function romanExtension(suffix: string): string {
  if (suffix === '' || suffix === 'm') return '';
  if (suffix === 'dim') return '°';
  if (suffix === 'dim7') return '°7';
  if (suffix === 'aug') return '+';
  if (suffix === 'm6' || suffix === 'm7' || suffix === 'm9') return suffix.slice(1);
  return suffix;
}

function romanFor(number: NashvilleCoordinate, family: QualityFamily, suffix: string): string | undefined {
  if (family === 'thirdless') return undefined;
  return `${romanRoot(number, family)}${romanExtension(suffix)}`;
}

function qualityFamily(suffix: string): QualityFamily {
  if (THIRDLESS_SUFFIXES.has(suffix)) return 'thirdless';
  if (suffix === 'm' || suffix === 'm6' || suffix === 'm7' || suffix === 'm9') return 'minor';
  if (suffix === 'dim' || suffix === 'dim7') return 'diminished';
  if (suffix === 'aug') return 'augmented';
  return 'major';
}

function triadFamily(intervals: readonly number[], degree: number): QualityFamily {
  const index = degree - 1;
  const root = intervals[index];
  const third = intervals[(index + 2) % 7];
  const fifth = intervals[(index + 4) % 7];
  const shape = `${mod12(third - root)},${mod12(fifth - root)}`;
  if (shape === '4,7') return 'major';
  if (shape === '3,7') return 'minor';
  if (shape === '3,6') return 'diminished';
  return 'augmented';
}

function secondaryDominantTarget(rootPc: number, key: KeyInfo): SecondaryMatch | undefined {
  const scales: { name: ScaleName; intervals: readonly number[] }[] = key.mode === 'major'
    ? [{ name: 'major', intervals: MAJOR_SCALE }]
    : [
        { name: 'naturalMinor', intervals: NATURAL_MINOR_SCALE },
        { name: 'harmonicMinor', intervals: HARMONIC_MINOR_SCALE }
      ];

  for (const scale of scales) {
    for (let degree = 2; degree <= 7; degree++) {
      const targetPc = mod12(key.tonicPc + scale.intervals[degree - 1]);
      if (mod12(targetPc + 7) !== rootPc) continue;
      const coordinate = nashvilleFor(targetPc, key, '');
      const targetFamily = triadFamily(scale.intervals, degree);
      return {
        target: {
          degree: degree as SecondaryDominantTarget['degree'],
          accidental: coordinate.accidental,
          soundingRootPc: targetPc,
          scale: scale.name
        },
        targetRoman: romanFor(coordinate, targetFamily, targetFamily === 'diminished' ? 'dim' : targetFamily === 'augmented' ? 'aug' : targetFamily === 'minor' ? 'm' : '') ?? ROMAN_NUMERALS[degree - 1]
      };
    }
  }
  return undefined;
}

function slashBassFor(
  parsed: ParsedChordName,
  capo: number | null,
  qualityIntervals: readonly number[] | undefined
): HarmonicSlashBass | undefined {
  if (!parsed.bass || parsed.bassPc === undefined) return undefined;
  const intervalFromRoot = mod12(parsed.bassPc - parsed.rootPc);
  return {
    written: parsed.bass,
    writtenPc: parsed.bassPc,
    soundingPc: capo === null ? null : mod12(parsed.bassPc + capo),
    intervalFromRoot,
    isChordTone: qualityIntervals ? qualityIntervals.some(interval => mod12(interval) === intervalFromRoot) : null
  };
}

function unknownChord(
  measureIndex: number,
  chordIndex: number,
  placement: ChordPlacement,
  keyText: string,
  mode: HarmonicMode | null,
  soundingRootPc: number | null,
  reason: HarmonicUnknownReason,
  parsed?: ParsedChordName,
  capo: number | null = null,
  qualityIntervals?: readonly number[],
  nashville?: NashvilleNumber
): HarmonicChordAnalysis {
  const slashBass = parsed ? slashBassFor(parsed, capo, qualityIntervals) : undefined;
  return {
    measureIndex,
    chordIndex,
    beat: placement.beat,
    writtenName: placement.name,
    key: keyText,
    mode,
    soundingRootPc,
    status: 'unknown',
    reason,
    ...(nashville ? { nashville } : {}),
    ...(slashBass ? { slashBass } : {})
  };
}

function analyzeChord(
  measureIndex: number,
  chordIndex: number,
  placement: ChordPlacement,
  keyText: string,
  key: KeyInfo | null,
  capo: number | null,
  diagnostics: HarmonicAnalysisDiagnostic[]
): AnalyzedChordEvent | undefined {
  const parsed = typeof placement.name === 'string' ? parseChordName(placement.name) : null;
  if (!parsed) {
    diagnostics.push({ code: 'invalidChord', value: String(placement.name), measureIndex, chordIndex });
    return {
      analysis: unknownChord(measureIndex, chordIndex, placement, keyText, key?.mode ?? null, null, 'invalidChord'),
      family: 'thirdless'
    };
  }

  const quality = CHORD_QUALITIES.find(candidate => candidate.suffix === parsed.suffix);
  const soundingRootPc = capo === null ? null : mod12(parsed.rootPc + capo);
  const family = qualityFamily(parsed.suffix);
  const nashville = key && soundingRootPc !== null
    ? nashvilleFor(soundingRootPc, key, parsed.suffix)
    : undefined;

  if (capo === null) {
    return {
      analysis: unknownChord(measureIndex, chordIndex, placement, keyText, key?.mode ?? null, null, 'invalidCapo', parsed, capo, quality?.intervals),
      family
    };
  }
  if (!key) {
    return {
      analysis: unknownChord(measureIndex, chordIndex, placement, keyText, null, soundingRootPc, 'invalidKey', parsed, capo, quality?.intervals),
      family
    };
  }
  if (!quality) {
    diagnostics.push({ code: 'unsupportedQuality', value: parsed.suffix, measureIndex, chordIndex });
    return {
      analysis: unknownChord(measureIndex, chordIndex, placement, keyText, key.mode, soundingRootPc, 'unsupportedQuality', parsed, capo, undefined, nashville),
      family
    };
  }

  const soundingRoot = mod12(parsed.rootPc + capo);
  const nashvilleNumber = nashville!;
  const slashBass = slashBassFor(parsed, capo, quality.intervals);
  if (family === 'thirdless') {
    return {
      analysis: {
        measureIndex,
        chordIndex,
        beat: placement.beat,
        writtenName: placement.name,
        key: keyText,
        mode: key.mode,
        soundingRootPc,
        status: 'ambiguous',
        nashville: nashvilleNumber,
        ...(slashBass ? { slashBass } : {})
      },
      family
    };
  }

  const currentScales = key.mode === 'major'
    ? [{ name: 'major' as const, intervals: MAJOR_SCALE }]
    : [
        { name: 'naturalMinor' as const, intervals: NATURAL_MINOR_SCALE },
        { name: 'harmonicMinor' as const, intervals: HARMONIC_MINOR_SCALE }
      ];
  const scaleFits = currentScales.filter(candidate =>
    qualityFitsScale(soundingRoot, quality.intervals, scalePcs(key.tonicPc, candidate.intervals))
  );

  let kind: HarmonicKind;
  let minorScaleFit: MinorScaleFit | undefined;
  let secondaryTarget: SecondaryDominantTarget | undefined;
  let roman: string | undefined;

  if (scaleFits.length > 0) {
    kind = 'diatonic';
    if (key.mode === 'minor') {
      minorScaleFit = scaleFits.length === 2
        ? 'both'
        : scaleFits[0].name === 'naturalMinor' ? 'natural' : 'harmonic';
    }
    roman = romanFor(nashvilleNumber, family, parsed.suffix);
  } else {
    const secondary = ['','7','9'].includes(parsed.suffix)
      ? secondaryDominantTarget(soundingRoot, key)
      : undefined;
    if (secondary) {
      kind = 'secondaryDominant';
      secondaryTarget = secondary.target;
      roman = `V${romanExtension(parsed.suffix)}/${secondary.targetRoman}`;
    } else {
      const borrowedScale = key.mode === 'major' ? NATURAL_MINOR_SCALE : MAJOR_SCALE;
      const borrowed = qualityFitsScale(soundingRoot, quality.intervals, scalePcs(key.tonicPc, borrowedScale));
      kind = borrowed ? 'borrowed' : 'chromatic';
      roman = romanFor(nashvilleNumber, family, parsed.suffix);
    }
  }

  return {
    analysis: {
      measureIndex,
      chordIndex,
      beat: placement.beat,
      writtenName: placement.name,
      key: keyText,
      mode: key.mode,
      soundingRootPc: soundingRoot,
      status: 'recognized',
      kind,
      ...(roman ? { roman } : {}),
      nashville: nashvilleNumber,
      ...(minorScaleFit ? { minorScaleFit } : {}),
      ...(slashBass ? { slashBass } : {}),
      ...(secondaryTarget ? { secondaryTarget } : {})
    },
    family
  };
}

function cadenceAtBoundary(events: AnalyzedChordEvent[], sectionName?: string): HarmonicCadence | undefined {
  const recognized = events.filter(event => event.analysis.status === 'recognized');
  if (recognized.length < 2) return undefined;

  const from = recognized[recognized.length - 2];
  const to = recognized[recognized.length - 1];
  const a = from.analysis;
  const b = to.analysis;
  if (a.key !== b.key || a.mode !== b.mode || !a.nashville || !b.nashville || !a.mode) return undefined;

  const fromNumber = a.nashville;
  const toNumber = b.nashville;
  const fromIsV = fromNumber.degree === 5 && fromNumber.accidental === 0 && from.family === 'major';
  const toIsTonic = toNumber.degree === 1 && toNumber.accidental === 0;
  let kind: HarmonicCadenceKind | undefined;

  if (fromIsV && toIsTonic) {
    kind = 'authentic';
  } else if (
    toIsTonic && fromNumber.degree === 4 && fromNumber.accidental === 0 &&
    (from.family === 'major' || from.family === 'minor')
  ) {
    kind = 'plagal';
  } else if (
    fromIsV && toNumber.degree === 6 && toNumber.accidental === (a.mode === 'minor' ? -1 : 0)
  ) {
    kind = 'deceptive';
  } else if (toNumber.degree === 5 && toNumber.accidental === 0 && to.family === 'major') {
    kind = 'half';
  }

  if (!kind) return undefined;
  return {
    kind,
    key: b.key,
    ...(sectionName ? { sectionName } : {}),
    from: { measureIndex: a.measureIndex, chordIndex: a.chordIndex },
    to: { measureIndex: b.measureIndex, chordIndex: b.chordIndex }
  };
}

function expandedChords(measure: MeasureData, measures: MeasureData[]): ChordPlacement[] {
  return expandMeasureRepeat(measure, measures).chords;
}

export function analyzeHarmony(score: Pick<ParsedScore, 'capo' | 'measures'>): HarmonicAnalysisResult {
  const capo = parseCapo(score.capo);
  const chords: HarmonicChordAnalysis[] = [];
  const cadences: HarmonicCadence[] = [];
  const diagnostics: HarmonicAnalysisDiagnostic[] = [];
  let sectionEvents: AnalyzedChordEvent[] = [];
  let activeSectionName: string | undefined;

  if (capo === null) diagnostics.push({ code: 'invalidCapo', value: String(score.capo) });

  const closeSection = () => {
    const cadence = cadenceAtBoundary(sectionEvents, activeSectionName);
    if (cadence) cadences.push(cadence);
    sectionEvents = [];
  };

  score.measures.forEach((measure, measureIndex) => {
    if (measure.sectionName) {
      if (measureIndex > 0) closeSection();
      activeSectionName = measure.sectionName;
    }

    const keyText = measure.context.key;
    const key = parseKey(keyText);
    if (!key) diagnostics.push({ code: 'invalidKey', value: String(keyText), measureIndex });

    expandedChords(measure, score.measures).forEach((placement, chordIndex) => {
      const event = analyzeChord(measureIndex, chordIndex, placement, String(keyText), key, capo, diagnostics);
      if (!event) return;
      chords.push(event.analysis);
      if (event.analysis.status === 'recognized') sectionEvents.push(event);
    });
  });

  closeSection();
  return { chords, cadences, diagnostics };
}
