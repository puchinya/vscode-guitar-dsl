import type { CodeActionSourceToken, LetDefinitionSummary, VisualSourceBinding } from '../compiler';
import type { SourceOffsetEdit } from '../sourceEdits';

export type VisualEditTarget =
  | { readonly kind: 'chord'; readonly bindingId: string }
  | { readonly kind: 'melody'; readonly bindingId: string }
  | { readonly kind: 'rhythm'; readonly bindingId: string }
  | { readonly kind: 'tab'; readonly bindingId: string }
  | { readonly kind: 'lyric'; readonly line: number; readonly startCol: number; readonly endCol: number; readonly expected: string };

export type VisualEditOperation =
  | { readonly kind: 'replaceChord'; readonly bindingId: string; readonly name: string }
  | { readonly kind: 'insertToken'; readonly bindingId: string; readonly text: string }
  | { readonly kind: 'deleteToken'; readonly bindingId: string }
  | { readonly kind: 'replaceMelodyToken'; readonly bindingId: string; readonly text: string }
  | { readonly kind: 'transposeMelody'; readonly bindingId: string; readonly semitones: number }
  | { readonly kind: 'changeDuration'; readonly bindingId: string; readonly direction: 'longer' | 'shorter' }
  | { readonly kind: 'replaceRhythmToken'; readonly bindingId: string; readonly text: string }
  | { readonly kind: 'replaceTabToken'; readonly bindingId: string; readonly text: string }
  | { readonly kind: 'addTabChordNote'; readonly bindingId: string; readonly note: string }
  | { readonly kind: 'deleteTabChordNote'; readonly bindingId: string; readonly note: string }
  | { readonly kind: 'replaceLyric'; readonly bindingId: string; readonly text: string };

export type LetOperation =
  | { readonly kind: 'add'; readonly name: string; readonly value: string }
  | { readonly kind: 'editGlobal'; readonly name: string; readonly value: string }
  | { readonly kind: 'rename'; readonly name: string; readonly newName: string }
  | { readonly kind: 'clone'; readonly name: string; readonly newName: string }
  | { readonly kind: 'deleteUnused'; readonly name: string }
  | { readonly kind: 'detachLocal'; readonly name: string; readonly line: number; readonly startCol: number; readonly endCol: number; readonly value?: string };

export interface VisualEditPlan {
  readonly ok: true;
  readonly edits: readonly SourceOffsetEdit[];
  readonly resultingSource: string;
  readonly postcondition: 'no-new-errors';
}

export interface VisualEditFailure {
  readonly ok: false;
  readonly code:
    | 'invalidOperation'
    | 'targetNotFound'
    | 'unsupportedTarget'
    | 'invalidValue'
    | 'duplicateName'
    | 'definitionNotFound'
    | 'definitionInvalid'
    | 'definitionInUse'
    | 'ambiguousReference'
    | 'unsafeExpansion'
    | 'staleSource'
    | 'diagnosticRegression';
}

export type VisualEditResult = VisualEditPlan | VisualEditFailure;

export interface VisualEditingSnapshot {
  readonly uri: string;
  readonly documentVersion: number;
  readonly previewGeneration: number;
  readonly source: string;
  readonly bindings: readonly VisualSourceBinding[];
  readonly definitions: readonly LetDefinitionSummary[];
  readonly tokens: readonly CodeActionSourceToken[];
}
