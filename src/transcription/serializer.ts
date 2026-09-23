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

function isSameChords(a: any[], b: any[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((c, i) => c.name === b[i].name && c.duration === b[i].duration);
}

function isSameRhythm(a: RhythmEvent[], b: RhythmEvent[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((r, i) =>
    r.duration === b[i].duration &&
    r.direction === b[i].direction &&
    r.accent === b[i].accent &&
    r.ghost === b[i].ghost
  );
}

function isSameMelody(a: MelodyEvent[], b: MelodyEvent[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((m, i) =>
    m.pitch === b[i].pitch &&
    m.duration === b[i].duration &&
    m.tieToNext === b[i].tieToNext
  );
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
  if (song.capo !== undefined && song.capo > 0) {
    lines.push(`capo: ${song.capo}`);
  }
  lines.push(`key: ${song.key}`);
  lines.push(`bpm: ${song.bpm}`);
  lines.push('');

  for (let sIdx = 0; sIdx < song.sections.length; sIdx++) {
    const section = song.sections[sIdx];
    lines.push(`[${section.name}]`);

    for (let mIdx = 0; mIdx < section.measures.length; mIdx++) {
      const measure = section.measures[mIdx];
      const prevMeasure = mIdx > 0 ? section.measures[mIdx - 1] : undefined;

      const chordsStr = measure.chords.map(c => `${c.name}/${c.duration}`).join(' ');
      const rhythmStr = measure.rhythm.map(formatRhythmToken).join(' ');

      const sameChords = prevMeasure ? isSameChords(measure.chords, prevMeasure.chords) : false;
      const sameRhythm = prevMeasure ? isSameRhythm(measure.rhythm, prevMeasure.rhythm) : false;

      // Only use measure-level lyrics if there is no melody line (to avoid measureLyricWithMelody warning)
      const hasMeasureLyrics = (!measure.melody || measure.melody.length === 0) && !!measure.lyrics && measure.lyrics.trim().length > 0;
      const lyricSuffix = hasMeasureLyrics ? ` l:"${measure.lyrics!.trim().replace(/"/g, "'")}"` : '';

      if (sameChords && sameRhythm) {
        lines.push(`| %${lyricSuffix} |`);
      } else if (sameRhythm) {
        lines.push(`| ${chordsStr} | %${lyricSuffix} |`);
      } else {
        lines.push(`| ${chordsStr} | ${rhythmStr}${lyricSuffix} |`);
      }

      if (measure.melody && measure.melody.length > 0) {
        const sameMelody = prevMeasure && prevMeasure.melody ? isSameMelody(measure.melody, prevMeasure.melody) : false;
        if (sameMelody) {
          lines.push('mel: | % |');
        } else {
          const melodyStr = measure.melody.map(formatMelodyNote).join(' ');
          lines.push(`mel: | ${melodyStr} |`);
        }

        const hasSyllables = measure.melody.some(m => m.lyric && m.lyric.trim().length > 0);
        if (hasSyllables) {
          const sungNotes = measure.melody.filter(n => n.pitch.toLowerCase() !== 'r');
          const syllables = sungNotes.map(n => n.lyric?.trim() || '_');
          if (syllables.length > 0) {
            lines.push(`lyr: | ${syllables.join(' ')} |`);
          }
        }
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
