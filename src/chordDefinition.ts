// Chord diagram definitions (spec §7.4): `chord <Name>[@<label>] = <frets> [base:n] [fingers:...] [barre:f[:a-b]]`.
// Model, parser and formatter shared by the compiler, the renderer and the chord editor.

export const CHORD_NAME_PATTERN = '[A-G][b#]?(?:maj|m|min|aug|dim|sus[24]|add9|[0-9]+)*(?:\\/[A-G][b#]?)?';
export const CHORD_LABEL_PATTERN = '[A-Za-z0-9_]+';

const CHORD_NAME_RE = new RegExp(`^${CHORD_NAME_PATTERN}$`);
const CHORD_LABEL_RE = new RegExp(`^${CHORD_LABEL_PATTERN}$`);

export const STRING_COUNT = 6;
/** Number of frets drawn in a diagram. */
export const DIAGRAM_FRET_WINDOW = 5;
export const MAX_FRET = 24;

/** Fret of one string: 'x' = muted, 0 = open, n = absolute fret. */
export type StringFret = number | 'x';
export type Finger = '1' | '2' | '3' | '4' | 'T';

/** A barre over string indexes [from, to] (0 = 6th string, 5 = 1st string). */
export interface Barre {
  fret: number;
  from: number;
  to: number;
}

export interface ChordVoicing {
  /** 6th string to 1st string. */
  frets: StringFret[];
  /** First fret shown in the diagram; undefined = automatic (see resolveBaseFret). */
  baseFret?: number;
  /** 6th string to 1st string; null = no finger shown. Undefined when no finger is set. */
  fingers?: (Finger | null)[];
  barres: Barre[];
}

export interface ChordDefinition extends ChordVoicing {
  name: string;
  label?: string;
  /** 0-based source line. */
  line: number;
}

export type ChordDefinitionError = 'syntax' | 'name' | 'label' | 'frets' | 'base' | 'fingers' | 'barre' | 'option' | 'span';

export type ChordDefinitionParseResult =
  | { ok: true; definition: Omit<ChordDefinition, 'line'> }
  | { ok: false; error: ChordDefinitionError; detail: string };

/** `name` or `name@label`: the key that identifies one diagram. */
export function chordKey(name: string, label?: string): string {
  return label ? `${name}@${label}` : name;
}

export function splitChordKey(key: string): { name: string; label?: string } {
  const at = key.indexOf('@');
  return at < 0 ? { name: key } : { name: key.slice(0, at), label: key.slice(at + 1) };
}

export function isValidChordName(name: string): boolean {
  return CHORD_NAME_RE.test(name);
}

export function isValidChordLabel(label: string): boolean {
  return CHORD_LABEL_RE.test(label);
}

/** True when the (trimmed) line is a `chord` definition line, valid or not. */
export function isChordDefinitionLine(line: string): boolean {
  return /^chord\s/i.test(line.trim());
}

export function parseChordDefinition(line: string): ChordDefinitionParseResult {
  const m = line.trim().match(/^chord\s+([^\s=]+)\s*=\s*(.*)$/i);
  if (!m) {
    return { ok: false, error: 'syntax', detail: line.trim() };
  }
  const { name, label } = splitChordKey(m[1]);
  if (!isValidChordName(name)) {
    return { ok: false, error: 'name', detail: name };
  }
  if (label !== undefined && !isValidChordLabel(label)) {
    return { ok: false, error: 'label', detail: label };
  }

  // End-of-line comment (§2.3); '#' directly after a note name (C#) is not a comment.
  const tokens = m[2].replace(/(^|\s)#.*$/, '').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { ok: false, error: 'frets', detail: '' };
  }
  const frets = parseFrets(tokens[0]);
  if (!frets) {
    return { ok: false, error: 'frets', detail: tokens[0] };
  }

  const voicing: ChordVoicing = { frets, barres: [] };
  const barreSpecs: { fret: number; range?: [number, number]; token: string }[] = [];
  for (const tok of tokens.slice(1)) {
    const opt = tok.match(/^(base|fingers|barre):(.+)$/i);
    if (!opt) {
      return { ok: false, error: 'option', detail: tok };
    }
    const key = opt[1].toLowerCase();
    const val = opt[2];
    if (key === 'base') {
      const n = Number(val);
      if (!Number.isInteger(n) || n < 1 || n > MAX_FRET) {
        return { ok: false, error: 'base', detail: tok };
      }
      voicing.baseFret = n;
    } else if (key === 'fingers') {
      const fingers = parseFingers(val);
      if (!fingers) {
        return { ok: false, error: 'fingers', detail: tok };
      }
      voicing.fingers = fingers;
    } else {
      const b = val.match(/^([0-9]+)(?::([1-6])-([1-6]))?$/);
      if (!b) {
        return { ok: false, error: 'barre', detail: tok };
      }
      const fret = Number(b[1]);
      const range: [number, number] | undefined = b[2] ? [STRING_COUNT - Number(b[2]), STRING_COUNT - Number(b[3])] : undefined;
      barreSpecs.push({ fret, range, token: tok });
    }
  }

  for (const spec of barreSpecs) {
    const barre = resolveBarre(frets, spec.fret, spec.range);
    if (!barre) {
      return { ok: false, error: 'barre', detail: spec.token };
    }
    voicing.barres.push(barre);
  }

  const spanError = checkSpan(voicing);
  if (spanError) {
    return { ok: false, error: 'span', detail: spanError };
  }

  return { ok: true, definition: { name, label, ...voicing } };
}

/** `x32010` (single-digit frets) or `x,x,10,9,8,8`; 6th string first. */
export function parseFrets(text: string): StringFret[] | null {
  const parts = text.includes(',') ? text.split(',') : Array.from(text);
  if (parts.length !== STRING_COUNT) return null;
  const frets: StringFret[] = [];
  for (const p of parts) {
    const t = p.trim().toLowerCase();
    if (t === 'x') frets.push('x');
    else if (t === 'o') frets.push(0);
    else if (/^[0-9]{1,2}$/.test(t) && Number(t) <= MAX_FRET) frets.push(Number(t));
    else return null;
  }
  return frets;
}

function parseFingers(text: string): (Finger | null)[] | null {
  const chars = Array.from(text);
  if (chars.length !== STRING_COUNT) return null;
  const fingers: (Finger | null)[] = [];
  for (const c of chars) {
    if (c === '-') fingers.push(null);
    else if (/^[1-4]$/.test(c)) fingers.push(c as Finger);
    else if (c === 'T' || c === 't') fingers.push('T');
    else return null;
  }
  return fingers;
}

/** Explicit range (string indexes) or, when omitted, the outermost strings fretted at `fret`. */
export function resolveBarre(frets: StringFret[], fret: number, range?: [number, number]): Barre | null {
  if (!Number.isInteger(fret) || fret < 1 || fret > MAX_FRET) return null;
  if (range) {
    const from = Math.min(range[0], range[1]);
    const to = Math.max(range[0], range[1]);
    return from === to ? null : { fret, from, to };
  }
  const at = frets.map((f, i) => (f === fret ? i : -1)).filter(i => i >= 0);
  if (at.length < 2) return null;
  return { fret, from: at[0], to: at[at.length - 1] };
}

/** First fret shown: explicit base, else 1 when everything fits in frets 1-5, else the lowest fretted fret. */
export function resolveBaseFret(voicing: ChordVoicing): number {
  if (voicing.baseFret !== undefined) return voicing.baseFret;
  const fretted = frettedFrets(voicing);
  if (fretted.length === 0) return 1;
  const max = Math.max(...fretted);
  return max <= DIAGRAM_FRET_WINDOW ? 1 : Math.min(...fretted);
}

function frettedFrets(voicing: ChordVoicing): number[] {
  const fretted = voicing.frets.filter((f): f is number => typeof f === 'number' && f > 0);
  return fretted.concat(voicing.barres.map(b => b.fret));
}

/** Returns the first fret outside the drawn window, or null when everything fits. */
function checkSpan(voicing: ChordVoicing): string | null {
  const base = resolveBaseFret(voicing);
  const outside = frettedFrets(voicing).find(f => f < base || f >= base + DIAGRAM_FRET_WINDOW);
  return outside === undefined ? null : String(outside);
}

export function formatFrets(frets: StringFret[]): string {
  const compact = frets.every(f => f === 'x' || f <= 9);
  const parts = frets.map(f => (f === 'x' ? 'x' : String(f)));
  return compact ? parts.join('') : parts.join(',');
}

/** Serializes a definition back to its DSL line; parseChordDefinition(formatChordDefinition(d)) round-trips. */
export function formatChordDefinition(def: Omit<ChordDefinition, 'line'>): string {
  let out = `chord ${chordKey(def.name, def.label)} = ${formatFrets(def.frets)}`;
  if (def.baseFret !== undefined) {
    out += ` base:${def.baseFret}`;
  }
  if (def.fingers && def.fingers.some(f => f !== null)) {
    out += ` fingers:${def.fingers.map(f => f ?? '-').join('')}`;
  }
  for (const b of def.barres) {
    const auto = resolveBarre(def.frets, b.fret);
    const sameAsAuto = auto && auto.from === b.from && auto.to === b.to;
    out += sameAsAuto ? ` barre:${b.fret}` : ` barre:${b.fret}:${STRING_COUNT - b.from}-${STRING_COUNT - b.to}`;
  }
  return out;
}
