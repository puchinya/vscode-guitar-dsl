// Deterministic serializer: validated Music IR -> GuitarDSL text.
// Pure module independent of VS Code APIs and network.

import { TranscribedSong, RhythmEvent, MelodyEvent } from './model';
import { parseGuitarDsl } from '../compiler';

function formatRhythmToken(r: RhythmEvent): string {
  let tok = r.duration;
  if (r.direction) {
    tok += `.${r.direction}`;
  }
  if (r.accent) {
    tok += '.a';
  }
  if (r.ghost) {
    tok += '.g';
  }
  return tok;
}

function formatMelodyNote(m: MelodyEvent): string {
  let tok = `${m.pitch}/${m.duration}`;
  if (m.tieToNext) {
    tok += '~';
  }
  return tok;
}

/**
 * Converts a validated TranscribedSong into deterministic GuitarDSL text.
 * Calls parseGuitarDsl on the resulting text to guarantee zero error diagnostics.
 */
export function serializeSongToGuitarDsl(song: TranscribedSong): string {
  const lines: string[] = [];

  if (song.title) {
    lines.push(`title: ${song.title}`);
  }
  if (song.artist) {
    lines.push(`artist: ${song.artist}`);
  }
  lines.push(`key: ${song.key}`);
  lines.push(`bpm: ${song.bpm}`);
  lines.push('');

  for (let sIdx = 0; sIdx < song.sections.length; sIdx++) {
    const section = song.sections[sIdx];
    lines.push(`[${section.name}]`);

    for (let mIdx = 0; mIdx < section.measures.length; mIdx++) {
      const measure = section.measures[mIdx];
      const chordsStr = measure.chords.map(c => `${c.name}/${c.duration}`).join(' ');
      const rhythmStr = measure.rhythm.map(formatRhythmToken).join(' ');
      lines.push(`| ${chordsStr} | ${rhythmStr} |`);

      if (measure.melody && measure.melody.length > 0) {
        const melodyStr = measure.melody.map(formatMelodyNote).join(' ');
        lines.push(`mel: | ${melodyStr} |`);
      }
    }

    lines.push('');
  }

  const dslText = lines.join('\n');

  // Compiler verification
  const parsed = parseGuitarDsl(dslText);
  const errors = parsed.diagnostics.filter(d => d.severity === 'error');
  if (errors.length > 0) {
    const errorDetails = errors.map(e => `${e.code} (line ${e.line + 1})`).join(', ');
    throw new Error(`Generated GuitarDSL failed compiler validation with errors: ${errorDetails}`);
  }

  return dslText;
}
