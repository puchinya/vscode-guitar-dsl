// GuitarDSL compiler front-end: parses DSL text into the score AST (ParsedScore).
// Rendering (SVG / HTML / PDF) lives in src/render and src/pdf.ts.

export interface RhythmItem {
  duration: string; // '4', '8', '16', '2', '1', 'w', 'h', 'q', 'r...'
  isRest: boolean;
  down: boolean;
  up: boolean;
  ghost: boolean;
  accent: boolean;
  tie: boolean;
  inlineLyric?: string;
}

export interface ChordPlacement {
  name: string;
  beat: number;
}

export interface MeasureData {
  chord: string;
  chords: ChordPlacement[];
  isMeasureRepeat?: boolean;
  repeatStart: boolean;
  repeatEnd: boolean;
  doubleEnd: boolean;
  bracket?: string; // '1.', '2.'
  specialMark?: string; // 'segno', 'coda', 'fine', 'to_coda'
  sectionName?: string;
  rhythms: RhythmItem[];
  lyric: string;
}

export function parseDurationToBeats(durationStr: string): number {
  const clean = durationStr.replace(/^r/, '').toLowerCase();
  switch (clean) {
    case '1':
    case 'w':
      return 4;
    case '2':
    case 'h':
      return 2;
    case '4':
    case 'q':
      return 1;
    case '8':
      return 0.5;
    case '16':
      return 0.25;
    default:
      return 1;
  }
}

function parseChordToken(tok: string): { name: string; duration?: number } | null {
  const match = tok.match(/^([A-G][b#]?(?:maj|m|min|aug|dim|sus[24]|add9|[0-9]+)*(?:\/[A-G][b#]?)?)(?::([0-9]+(?:\.[0-9]+)?))?$/);
  if (!match) return null;
  return {
    name: match[1],
    duration: match[2] !== undefined ? parseFloat(match[2]) : undefined
  };
}

export interface ScoreStyle {
  chordSize?: number;
  lyricSize?: number;
  titleSize?: number;
  sectionSize?: number;
  fontSize?: number;
}

export interface ScorePage {
  pageNumber: number;
  measures: MeasureData[];
}

export interface ParsedScore {
  title: string;
  artist: string;
  capo: string;
  originalKey: string;
  bpm: string;
  memo: string;
  style: ScoreStyle;
  usedChords: string[];
  measures: MeasureData[];
  pages: ScorePage[];
}

export function parseGuitarDsl(dslContent: string): ParsedScore {
  const lines = dslContent.split(/\r?\n/);
  
  let title = 'Guitar Rhythm Score';
  let artist = '';
  let capo = '0';
  let originalKey = 'C';
  let bpm = '90';
  let memo = '';
  const style: ScoreStyle = {};
  
  const measures: MeasureData[] = [];
  const pages: ScorePage[] = [{ pageNumber: 1, measures: [] }];
  let currentPageIndex = 0;
  let currentSection = '';
  const usedChordsSet = new Set<string>();

  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Page break: --- or pagebreak
    if (/^---+$/.test(line) || /^pagebreak$/i.test(line)) {
      if (pages[currentPageIndex].measures.length > 0) {
        currentPageIndex++;
        pages.push({ pageNumber: currentPageIndex + 1, measures: [] });
      }
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(title|artist|capo|key|original_key|tempo|bpm|memo|(?:style_)?(?:chord_size|lyric_size|title_size|section_size|font_size)):\s*(.*)$/i);
    if (headerMatch) {
      const key = headerMatch[1].toLowerCase().replace(/^style_/, '');
      const val = headerMatch[2].trim();
      if (key === 'title') title = val;
      else if (key === 'artist') artist = val;
      else if (key === 'capo') capo = val;
      else if (key === 'key' || key === 'original_key') originalKey = val;
      else if (key === 'bpm' || key === 'tempo') bpm = val;
      else if (key === 'memo') memo = val;
      else if (key === 'chord_size') {
        const n = parseFloat(val);
        if (!isNaN(n) && n > 0) style.chordSize = n;
      } else if (key === 'lyric_size') {
        const n = parseFloat(val);
        if (!isNaN(n) && n > 0) style.lyricSize = n;
      } else if (key === 'title_size') {
        const n = parseFloat(val);
        if (!isNaN(n) && n > 0) style.titleSize = n;
      } else if (key === 'section_size') {
        const n = parseFloat(val);
        if (!isNaN(n) && n > 0) style.sectionSize = n;
      } else if (key === 'font_size') {
        const n = parseFloat(val);
        if (!isNaN(n) && n > 0) style.fontSize = n;
      }
      continue;
    }

    // Section label [Intro], [Aメロ] etc
    const secMatch = line.match(/^\[([^\]]+)\]$/);
    if (secMatch) {
      currentSection = secMatch[1];
      continue;
    }

    // Measure line: | C | 4.d 4.d 4.d 4.d l:"..." | or | C 4.d ... |
    if (line.includes('|')) {
      const rawBars = line.split('|').map(s => s.trim()).filter(s => s.length > 0 && s !== ':');
      
      const bars: string[] = [];
      const CHORD_REGEX = /^[A-G][b#]?(maj|m|min|aug|dim|sus[24]|add9|[0-9]+)*(\/[A-G][b#]?)?(:[0-9]+(\.[0-9]+)?)?$/;
      const RHYTHM_REGEX = /^(16|8|4|2|1|w|h|q|r[a-z0-9]*)(\.[a-z]+)*$/;

      let bi = 0;
      while (bi < rawBars.length) {
        const cur = rawBars[bi];
        const next = rawBars[bi + 1];
        const curTokens = cur.replace(/^:+|:+$/g, '').trim().split(/\s+/).filter(Boolean);
        const isCurOnlyChords = curTokens.length >= 1 && curTokens.every(t => CHORD_REGEX.test(t));

        if (isCurOnlyChords && next) {
          const nextClean = next.replace(/l:\"[^\"]*\"/, '').trim();
          const nextTokens = nextClean.replace(/^:+|:+$/g, '').trim().split(/\s+/).filter(Boolean);
          const nextHasChord = nextTokens.some(t => CHORD_REGEX.test(t));
          const nextHasRhythm = nextTokens.some(t => RHYTHM_REGEX.test(t.split('.')[0]) || t === '%');

          if (!nextHasChord && nextHasRhythm) {
            bars.push(cur + ' ' + next);
            bi += 2;
            continue;
          }
        }
        bars.push(cur);
        bi++;
      }

      for (let barIdx = 0; barIdx < bars.length; barIdx++) {
        const bar = bars[barIdx];
        if (bar === ':' || bar === '') continue;

        let mLyric = '';
        let cleanBar = bar;

        // Extract l:"..."
        const lyricMatch = cleanBar.match(/l:\"([^\"]*)\"/);
        if (lyricMatch) {
          mLyric = lyricMatch[1];
          cleanBar = cleanBar.replace(/l:\"([^\"]*)\"/, '').trim();
        }

        let rStart = false;
        let rEnd = false;

        if (cleanBar.startsWith(':')) {
          rStart = true;
          cleanBar = cleanBar.replace(/^:+/, '').trim();
        } else if (barIdx === 0 && rawLine.trim().startsWith('|:')) {
          rStart = true;
        }

        if (cleanBar.endsWith(':')) {
          rEnd = true;
          cleanBar = cleanBar.replace(/:+$/, '').trim();
        } else if (barIdx === bars.length - 1 && rawLine.trim().endsWith(':|')) {
          rEnd = true;
        }

        const tokens = cleanBar.split(/\s+/);
        interface RawParsedChord {
          name: string;
          duration?: number;
          accumBeatAtToken: number;
        }
        const rawChords: RawParsedChord[] = [];
        const rhythms: RhythmItem[] = [];
        let runningBeat = 0;
        let isMeasureRepeat = false;

        for (let tokIdx = 0; tokIdx < tokens.length; tokIdx++) {
          const tok = tokens[tokIdx];
          if (!tok || tok === ':' || tok === '|') continue;
          if (tok === '%') {
            isMeasureRepeat = true;
            continue;
          }
          const parsedChord = parseChordToken(tok);
          if (parsedChord) {
            rawChords.push({
              name: parsedChord.name,
              duration: parsedChord.duration,
              accumBeatAtToken: runningBeat
            });
            usedChordsSet.add(parsedChord.name);
          } else if (tok.match(/^(\[[12]\.\])$/)) {
            // brackets like [1.] or [2.]
          } else if (RHYTHM_REGEX.test(tok)) {
            // Rhythm token e.g. 4.d, 8.u, 16.d.a, rq, etc.
            const parts = tok.split('.');
            const dur = parts[0];
            const isRest = dur.startsWith('r');
            let down = false, up = false, ghost = false, accent = false, tie = false;
            let inlineL: string | undefined = undefined;

            for (let i = 1; i < parts.length; i++) {
              const mod = parts[i];
              if (mod === 'd') down = true;
              else if (mod === 'u') up = true;
              else if (mod === 'g' || mod === 'ghost') ghost = true;
              else if (mod === 'a' || mod === 'accent') accent = true;
              else if (mod === 't' || mod === 'tie') tie = true;
            }

            rhythms.push({
              duration: dur,
              isRest,
              down,
              up,
              ghost,
              accent,
              tie,
              inlineLyric: inlineL
            });
            runningBeat += parseDurationToBeats(dur);
          }
        }

        let barChords: ChordPlacement[] = [];
        if (rawChords.length === 1) {
          barChords = [{ name: rawChords[0].name, beat: rawChords[0].accumBeatAtToken }];
        } else if (rawChords.length > 1) {
          const allChordsBeforeRhythm = rawChords.every(c => c.accumBeatAtToken === 0);
          if (allChordsBeforeRhythm) {
            const anyHasDuration = rawChords.some(c => c.duration !== undefined);
            if (anyHasDuration) {
              let curB = 0;
              barChords = rawChords.map(c => {
                const b = curB;
                curB += (c.duration ?? 2);
                return { name: c.name, beat: b };
              });
            } else {
              const step = 4.0 / rawChords.length;
              barChords = rawChords.map((c, idx) => ({ name: c.name, beat: idx * step }));
            }
          } else {
            barChords = rawChords.map(c => ({ name: c.name, beat: c.accumBeatAtToken }));
          }
        } else if (isMeasureRepeat && measures.length > 0) {
          const prev = measures[measures.length - 1];
          if (prev.chords && prev.chords.length > 0) {
            barChords = prev.chords.map(c => ({ ...c }));
          } else if (prev.chord) {
            barChords = [{ name: prev.chord, beat: 0 }];
          }
          barChords.forEach(c => usedChordsSet.add(c.name));
        }

        const mData: MeasureData = {
          chord: barChords.length > 0 ? barChords[0].name : '',
          chords: barChords,
          isMeasureRepeat,
          repeatStart: rStart,
          repeatEnd: rEnd,
          doubleEnd: false,
          sectionName: currentSection,
          rhythms: isMeasureRepeat ? [] : (rhythms.length > 0 ? rhythms : [
            { duration: '4', isRest: false, down: true, up: false, ghost: false, accent: false, tie: false },
            { duration: '4', isRest: false, down: false, up: false, ghost: false, accent: false, tie: false },
            { duration: '4', isRest: false, down: true, up: false, ghost: false, accent: false, tie: false },
            { duration: '4', isRest: false, down: false, up: false, ghost: false, accent: false, tie: false }
          ]),
          lyric: mLyric
        };
        measures.push(mData);
        pages[currentPageIndex].measures.push(mData);
        currentSection = ''; // consume section for the first bar
      }
    }
  }

  const validPages = pages.filter((p, idx) => p.measures.length > 0 || idx === 0);
  validPages.forEach((p, idx) => {
    p.pageNumber = idx + 1;
  });

  return {
    title,
    artist,
    capo,
    originalKey,
    bpm,
    memo,
    style,
    usedChords: Array.from(usedChordsSet),
    measures,
    pages: validPages
  };
}
