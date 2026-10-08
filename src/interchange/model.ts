import type { NoteBase } from '../duration';
import type { ScoreDiagnostic } from '../compiler';
import type { ConnectionTechnique, PitchStep } from '../melody';
import type { Dynamic, Feel, Ottava, TempoMark } from '../scoreEvents';
import type { Finger, StringFret } from '../chordDefinition';
import type { GuitarString, TuningPreset } from '../instrumentModel';

export interface InterchangeFraction {
  readonly n: number;
  readonly d: number;
}

export interface InterchangeNoteValuePart {
  readonly base: NoteBase;
  readonly dotted: boolean;
  readonly tuplet?: {
    readonly actual: number;
    readonly normal: number;
  };
}

export interface InterchangeNoteValue {
  readonly beats: InterchangeFraction;
  readonly parts: readonly InterchangeNoteValuePart[];
}

export interface InterchangePitch {
  readonly step: PitchStep;
  readonly alter: -1 | 0 | 1;
  readonly octave: number;
}

export interface InterchangeSyllable {
  readonly text: string;
  readonly hyphenToNext: boolean;
  readonly extend: boolean;
}

export interface InterchangeNoteTechniques {
  readonly connection?: ConnectionTechnique;
  readonly bend?: number;
  readonly vibrato?: boolean;
  readonly staccato?: boolean;
  readonly tenuto?: boolean;
  readonly fermata?: boolean;
  readonly breath?: boolean;
  readonly grace?: boolean;
  readonly slurStart?: boolean;
  readonly slurEnd?: boolean;
  readonly palmMute?: boolean;
  readonly letRing?: boolean;
}

export type InterchangeEffectValue =
  | string
  | number
  | InterchangeFraction
  | readonly InterchangeEffectValue[];

export interface InterchangeTabEffectCall {
  readonly name: string;
  readonly args: Readonly<Record<string, InterchangeEffectValue>>;
}

/** A semantic melody or inline-note event. TAB positions use InterchangeTabNote instead. */
export interface InterchangeNote {
  readonly isRest: boolean;
  readonly pitch?: InterchangePitch;
  readonly pitches?: readonly InterchangePitch[];
  readonly duration: InterchangeNoteValue;
  readonly techniques?: InterchangeNoteTechniques;
  readonly tieToNext: boolean;
  readonly tiedFromPrev: boolean;
  /** One slot per lyric verse; null means this note has no syllable in that verse. */
  readonly syllables: readonly (InterchangeSyllable | null)[];
}

export interface InterchangeChord {
  readonly name: string;
  readonly label?: string;
  /** Exact onset in quarter-note units. */
  readonly beatOffset: InterchangeFraction;
}

export type InterchangeChordPlacementMode = 'equalSplit' | 'explicitDuration' | 'inline';
export type InterchangeRhythmOrigin = 'explicit' | 'implicit' | 'repeat';

export interface InterchangeRhythmEvent {
  readonly duration: InterchangeNoteValue;
  readonly isRest: boolean;
  readonly down: boolean;
  readonly up: boolean;
  readonly ghost: boolean;
  readonly accent: boolean;
  readonly tie: boolean;
  readonly arpeggio?: boolean;
  readonly pitch?: InterchangePitch;
  readonly pitches?: readonly InterchangePitch[];
  readonly inlineLyric?: string;
  readonly techniques?: InterchangeNoteTechniques;
}

export interface InterchangeTabNote {
  readonly string: GuitarString;
  readonly fret?: number;
  readonly dead: boolean;
  readonly tieToNext: boolean;
  readonly effects: readonly InterchangeTabEffectCall[];
}

export interface InterchangeTabBeat {
  readonly isRest: boolean;
  readonly notes: readonly InterchangeTabNote[];
  readonly duration: InterchangeNoteValue;
  readonly effects: readonly InterchangeTabEffectCall[];
  readonly syllables: readonly (InterchangeSyllable | null)[];
}

export interface InterchangeTabVoice {
  readonly voice: 1 | 2 | 3 | 4;
  readonly beats: readonly InterchangeTabBeat[];
}

export interface InterchangeEvent {
  readonly kind:
    | 'keyChange'
    | 'tempoChange'
    | 'tempoMark'
    | 'timeSignatureChange'
    | 'feelChange'
    | 'dynamic'
    | 'rehearsalMark'
    | 'text'
    | 'ottavaChange';
  readonly key?: string;
  readonly bpm?: number;
  readonly mark?: TempoMark;
  readonly timeSignature?: InterchangeTimeSignature;
  readonly feel?: Feel;
  readonly dynamic?: Dynamic;
  readonly text?: string;
  readonly ottava?: Ottava;
}

export interface InterchangeTimeSignature {
  readonly numerator: number;
  readonly denominator: 1 | 2 | 4 | 8 | 16;
  readonly groups: readonly number[];
}

export interface InterchangeBarline {
  readonly repeatStart: boolean;
  readonly repeatEnd: boolean;
  readonly doubleEnd: boolean;
  readonly finalEnd: boolean;
  readonly bracket?: string;
  readonly specialMark?: string;
}

export interface InterchangeMeasure {
  readonly index: number;
  /** Present only on the first written measure of a named section. */
  readonly sectionStart?: string;
  readonly pageBreakBefore?: boolean;
  readonly expectedBeats: InterchangeFraction;
  readonly isPickup?: boolean;
  readonly barline: InterchangeBarline;
  readonly eventsBefore: readonly InterchangeEvent[];
  readonly chords: readonly InterchangeChord[];
  readonly chordPlacementMode: InterchangeChordPlacementMode;
  readonly rhythm: {
    readonly origin: InterchangeRhythmOrigin;
    /** Empty for parser-synthesized implicit rhythm and written measure repeats. */
    readonly events: readonly InterchangeRhythmEvent[];
  };
  readonly measureLyric?: string;
  readonly melody?: readonly InterchangeNote[];
  readonly tabVoices?: readonly InterchangeTabVoice[];
}

export interface InterchangeChordDefinition {
  readonly name: string;
  readonly label?: string;
  readonly frets: readonly StringFret[];
  readonly baseFret?: number;
  readonly fingers?: readonly (Finger | null)[];
  /** String indexes are zero-based from the sixth string to the first string. */
  readonly barres: readonly {
    readonly fret: number;
    readonly from: number;
    readonly to: number;
  }[];
}

export interface InterchangeArrangementEntry {
  readonly name: string;
  readonly count: number;
  readonly lyricVerse?: number;
}

export interface InterchangeTuning {
  /** Open MIDI pitches, ordered from the 6th string to the 1st. */
  readonly openMidi: readonly [number, number, number, number, number, number];
  readonly preset?: TuningPreset;
}

export interface InterchangeMetadata {
  readonly title: string;
  readonly artist: string;
  readonly memo: string;
  /** Initial sounding key, taken from ParsedScore.originalKey. */
  readonly key: string;
  readonly bpm: number;
  readonly capo: number;
  readonly tuning: InterchangeTuning;
  readonly timeSignature: InterchangeTimeSignature;
  readonly feel: Feel;
  readonly pickup?: InterchangeFraction;
  readonly showRhythm: boolean;
  readonly measuresPerRow: number;
  readonly style: {
    readonly chordSize?: number;
    readonly lyricSize?: number;
    readonly titleSize?: number;
    readonly sectionSize?: number;
    readonly fontSize?: number;
  };
  readonly expandPageBreakRepeats: boolean;
}

export interface InterchangeScore {
  readonly schemaVersion: 1;
  readonly metadata: InterchangeMetadata;
  readonly chordDefinitions: readonly InterchangeChordDefinition[];
  /** Absent when written repeat/navigation semantics are used instead. */
  readonly arrangement?: readonly InterchangeArrangementEntry[];
  /** Contiguous written-measure order; never flattened to execution order. */
  readonly measures: readonly InterchangeMeasure[];
}

export type InterchangeLossCategory = 'unsupported' | 'approximated' | 'droppedByPolicy' | 'inferred';

export interface InterchangeLoss {
  readonly category: InterchangeLossCategory;
  readonly code: string;
  /** IR JSON Pointer, or an adapter-supplied stable source path. */
  readonly path: string;
  readonly detail: string;
  readonly policyId?: string;
}

export interface InterchangeLossReport {
  readonly schemaVersion: 1;
  readonly entries: readonly InterchangeLoss[];
}

export interface InterchangeError {
  readonly code: string;
  readonly path: string;
  readonly detail: string;
}

export type InterchangeResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly loss: InterchangeLossReport;
      readonly warnings: readonly ScoreDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly code: 'invalidSource' | 'invalidPlayOrder' | 'invalidIr' | 'unrepresentableValue' | 'semanticMismatch';
      readonly loss: InterchangeLossReport;
      readonly diagnostics: readonly ScoreDiagnostic[];
      readonly errors: readonly InterchangeError[];
    };
