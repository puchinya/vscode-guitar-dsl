// Deterministic serializer: validated Music IR -> GuitarDSL text.
// Pure module independent of VS Code APIs and network.

import { TranscribedSong, Section, Measure, RhythmEvent, MelodyEvent } from './model';
import { parseGuitarDsl } from '../compiler';
import { tokenizeLyrics } from '../melody';
import { getPresetById } from '../strummingPatterns';

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
  if (r.tie) {
    tok += '.t';
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

function normalizeRawSyllables(syllables: string[]): string[] {
  const SMALL_KANA_SET = new Set('ゃゅょぁぃぅぇぉゎっヵヶャュョァィゥェォヮッー'.split(''));
  const merged: string[] = [];
  for (const s of syllables) {
    if (s.length === 1 && SMALL_KANA_SET.has(s) && merged.length > 0) {
      merged[merged.length - 1] += s;
    } else {
      merged.push(s);
    }
  }
  return merged;
}

function extractFinalSyllables(measure: Measure, sungNotesCount: number, lyricIdx = 0): string[] {
  let rawSyllables: string[] = [];
  const noteSyllables = measure.melody?.map(n => n.lyric?.trim()).filter(Boolean);
  if (lyricIdx === 0 && noteSyllables && noteSyllables.length > 0) {
    rawSyllables = noteSyllables as string[];
  } else if (measure.lyrics) {
    const lText = Array.isArray(measure.lyrics)
      ? measure.lyrics[lyricIdx]
      : (lyricIdx === 0 ? measure.lyrics : undefined);
    if (lText && lText.trim().length > 0) {
      const lyricItems = tokenizeLyrics(lText.trim());
      rawSyllables = lyricItems
        .filter(it => it.kind === 'syllable')
        .map(it => (it as any).text);
    }
  }

  rawSyllables = normalizeRawSyllables(rawSyllables);
  if (rawSyllables.length === 0) return [];

  const targetCount = sungNotesCount;
  if (rawSyllables.length === targetCount) {
    return rawSyllables;
  } else if (rawSyllables.length < targetCount) {
    const padded = [...rawSyllables];
    while (padded.length < targetCount) padded.push('_');
    return padded;
  } else {
    const kept = rawSyllables.slice(0, targetCount - 1);
    const excess = rawSyllables.slice(targetCount - 1).join('');
    kept.push(`(${excess})`);
    return kept;
  }
}

function canCompressSections(s1: Section, s2: Section): boolean {
  if (s1.measures.length !== s2.measures.length || s1.measures.length === 0) return false;
  for (let i = 0; i < s1.measures.length; i++) {
    const m1 = s1.measures[i];
    const m2 = s2.measures[i];
    if (!isSameChords(m1.chords, m2.chords)) return false;
    if (!isSameRhythm(m1.rhythm, m2.rhythm)) return false;
    if (!!m1.melody !== !!m2.melody) return false;
    if (m1.melody && m2.melody && !isSameMelody(m1.melody, m2.melody)) return false;
  }
  return true;
}

export interface SerializationOptions {
  compressRepeats?: boolean;
  strummingPresetId?: string;
}

/**
 * Converts a validated TranscribedSong into deterministic GuitarDSL text.
 * Calls parseGuitarDsl on the resulting text to guarantee zero error diagnostics.
 */
export function serializeSongToGuitarDsl(song: TranscribedSong, options?: SerializationOptions): string {
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

  const preset = options?.strummingPresetId ? getPresetById(options.strummingPresetId) : undefined;

  let sIdx = 0;
  while (sIdx < song.sections.length) {
    const section = song.sections[sIdx];
    const nextSection = sIdx + 1 < song.sections.length ? song.sections[sIdx + 1] : undefined;

    const doCompress = options?.compressRepeats && nextSection && canCompressSections(section, nextSection);

    lines.push(`[${section.name}]`);

    for (let mIdx = 0; mIdx < section.measures.length; mIdx++) {
      const measure = section.measures[mIdx];
      const prevMeasure = mIdx > 0 ? section.measures[mIdx - 1] : undefined;
      const isFirstBar = mIdx === 0;
      const isLastBar = mIdx === section.measures.length - 1;

      const chordsStr = measure.chords.map(c => `${c.name}/${c.duration}`).join(' ');
      const rhythmStr = preset ? preset.pattern : measure.rhythm.map(formatRhythmToken).join(' ');

      // Never use repeat sign % on the first measure of a section or the first measure of a 4-measure system (row)
      const isRowStart = mIdx % 4 === 0;
      const allowRepeat = !isRowStart && prevMeasure !== undefined;

      const sameChords = allowRepeat ? isSameChords(measure.chords, prevMeasure.chords) : false;
      const sameRhythm = allowRepeat ? (preset ? true : isSameRhythm(measure.rhythm, prevMeasure.rhythm)) : false;

      // Only use measure-level lyrics if there is no melody line
      const firstLyric = Array.isArray(measure.lyrics) ? measure.lyrics[0] : measure.lyrics;
      const hasMeasureLyrics = (!measure.melody || measure.melody.length === 0) && !!firstLyric && firstLyric.trim().length > 0;
      const lyricSuffix = hasMeasureLyrics ? ` l:"${firstLyric.trim().replace(/"/g, "'")}"` : '';

      const barStart = (doCompress && isFirstBar) ? '|:' : '|';
      const barEnd = (doCompress && isLastBar) ? ':|' : '|';

      if (sameChords && sameRhythm) {
        lines.push(`${barStart} %${lyricSuffix} ${barEnd}`);
      } else if (sameRhythm) {
        lines.push(`${barStart} ${chordsStr} | %${lyricSuffix} ${barEnd}`);
      } else {
        lines.push(`${barStart} ${chordsStr} | ${rhythmStr}${lyricSuffix} ${barEnd}`);
      }

      if (measure.melody && measure.melody.length > 0) {
        const sameMelody = allowRepeat && prevMeasure && prevMeasure.melody ? isSameMelody(measure.melody, prevMeasure.melody) : false;
        if (sameMelody) {
          lines.push('mel: | % |');
        } else {
          const melodyStr = measure.melody.map(formatMelodyNote).join(' ');
          lines.push(`mel: | ${melodyStr} |`);
        }

        const sungNotes = measure.melody.filter(n => n.pitch.toLowerCase() !== 'r');
        if (sungNotes.length > 0) {
          const syls1 = extractFinalSyllables(measure, sungNotes.length, 0);
          if (syls1.length > 0) {
            lines.push(`lyr: ${syls1.join(' ')}`);
          }

          if (doCompress && nextSection) {
            const measure2 = nextSection.measures[mIdx];
            const syls2 = extractFinalSyllables(measure2, sungNotes.length, 0);
            if (syls2.length > 0) {
              lines.push(`lyr: ${syls2.join(' ')}`);
            }
          } else if (Array.isArray(measure.lyrics) && measure.lyrics.length > 1) {
            for (let v = 1; v < measure.lyrics.length; v++) {
              const sylsV = extractFinalSyllables(measure, sungNotes.length, v);
              if (sylsV.length > 0) {
                lines.push(`lyr: ${sylsV.join(' ')}`);
              }
            }
          }
        }
      }
    }

    lines.push('');
    sIdx += doCompress ? 2 : 1;
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
