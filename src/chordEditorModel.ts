// Chord editor logic independent of VS Code: editor state <-> `chord` line, and where a save goes.

import { parseGuitarDsl } from './compiler';
import {
  Barre,
  ChordDefinition,
  ChordDefinitionError,
  ChordVoicing,
  Finger,
  STRING_COUNT,
  StringFret,
  chordKey,
  formatChordDefinition,
  isChordDefinitionLine,
  parseChordDefinition,
  resolveBaseFret,
  splitChordKey
} from './chordDefinition';
import { resolveChordDiagram } from './render/chordLibrary';

/** State edited in the chord editor webview (plain JSON). */
export interface ChordEditorState {
  name: string;
  label: string;
  frets: StringFret[];
  /** First fret shown in the editor grid; written as `base:` only when it differs from the automatic base. */
  windowBase: number;
  fingers: (Finger | null)[];
  barres: Barre[];
}

export interface ChordEditorSession {
  state: ChordEditorState;
  /** Source line of the definition being edited; undefined for a new definition. */
  line?: number;
}

/** Initial editor session for a diagram key: its definition when one exists, else the resolved diagram as a new definition. */
export function createEditorSession(text: string, key: string): ChordEditorSession {
  const score = parseGuitarDsl(text);
  const def = score.chordDefinitions.find(d => chordKey(d.name, d.label) === key);
  if (def) {
    return { state: stateFromVoicing(def.name, def.label ?? '', def), line: def.line };
  }
  const { name, label } = splitChordKey(key);
  const resolved = resolveChordDiagram(name, score.chordDefinitions);
  return { state: stateFromVoicing(name, label ?? '', resolved.voicing) };
}

export function stateFromVoicing(name: string, label: string, voicing: ChordVoicing): ChordEditorState {
  return {
    name,
    label,
    frets: [...voicing.frets],
    windowBase: resolveBaseFret(voicing),
    fingers: voicing.fingers ? [...voicing.fingers] : new Array(STRING_COUNT).fill(null),
    barres: voicing.barres.map(b => ({ ...b }))
  };
}

export type BuildLineResult =
  | { ok: true; line: string; definition: Omit<ChordDefinition, 'line'> }
  | { ok: false; error: ChordDefinitionError; detail: string };

/** Formats the state as a `chord` line and validates it by parsing it back. */
export function buildChordLine(state: ChordEditorState): BuildLineResult {
  const autoBase = resolveBaseFret({ frets: state.frets, barres: state.barres });
  const label = state.label.trim();
  const draft = formatChordDefinition({
    name: state.name.trim(),
    label: label === '' ? undefined : label,
    frets: state.frets,
    baseFret: state.windowBase !== autoBase ? state.windowBase : undefined,
    fingers: state.fingers,
    barres: state.barres
  });
  const parsed = parseChordDefinition(draft);
  if (!parsed.ok) {
    return parsed;
  }
  return { ok: true, line: draft, definition: parsed.definition };
}

export type SavePlan =
  | { kind: 'replace'; line: number; text: string }
  | { kind: 'insert'; line: number; text: string }
  | { kind: 'duplicate'; key: string };

/**
 * Where a saved `chord` line goes. Editing an existing definition replaces its line unless `asNew`;
 * a new definition goes after the last definition, else before the first score line (after the header).
 */
export function planChordSave(text: string, chordLine: string, definition: Omit<ChordDefinition, 'line'>, editingLine: number | undefined, asNew: boolean): SavePlan {
  const score = parseGuitarDsl(text);
  const key = chordKey(definition.name, definition.label);
  const replaceLine = asNew ? undefined : editingLine;
  if (score.chordDefinitions.some(d => chordKey(d.name, d.label) === key && d.line !== replaceLine)) {
    return { kind: 'duplicate', key };
  }
  if (replaceLine !== undefined) {
    return { kind: 'replace', line: replaceLine, text: chordLine };
  }
  return { kind: 'insert', line: findInsertLine(text), text: chordLine };
}

function findInsertLine(text: string): number {
  const lines = text.split(/\r?\n/);
  let lastDefinition = -1;
  lines.forEach((l, i) => {
    if (isChordDefinitionLine(l)) lastDefinition = i;
  });
  if (lastDefinition >= 0) {
    return lastDefinition + 1;
  }
  const firstScore = lines.findIndex(l => {
    const t = l.trim();
    return t.includes('|') || /^\[[^\]]+\]$/.test(t) || /^(mel|lyr):/i.test(t) || /^---+$/.test(t) || /^pagebreak$/i.test(t);
  });
  if (firstScore < 0) {
    return lines.length;
  }
  let at = firstScore;
  while (at > 0 && lines[at - 1].trim() === '') at--;
  return at;
}
