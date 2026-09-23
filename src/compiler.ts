const FETA_TREBLE_CLEF_PATH = "m12.049 3.5296c0.305 3.1263-2.019 5.6563-4.0772 7.7014-0.9349 0.897-0.155 0.148-0.6437 0.594-0.1022-0.479-0.2986-1.731-0.2802-2.11 0.1304-2.6939 2.3198-6.5875 4.2381-8.0236 0.309 0.5767 0.563 0.6231 0.763 1.8382zm0.651 16.142c-1.232-0.906-2.85-1.144-4.3336-0.885-0.1913-1.255-0.3827-2.51-0.574-3.764 2.3506-2.329 4.9066-5.0322 5.0406-8.5394 0.059-2.232-0.276-4.6714-1.678-6.4836-1.7004 0.12823-2.8995 2.156-3.8019 3.4165-1.4889 2.6705-1.1414 5.9169-0.57 8.7965-0.8094 0.952-1.9296 1.743-2.7274 2.734-2.3561 2.308-4.4085 5.43-4.0046 8.878 0.18332 3.334 2.5894 6.434 5.8702 7.227 1.2457 0.315 2.5639 0.346 3.8241 0.099 0.2199 2.25 1.0266 4.629 0.0925 6.813-0.7007 1.598-2.7875 3.004-4.3325 2.192-0.5994-0.316-0.1137-0.051-0.478-0.252 1.0698-0.257 1.9996-1.036 2.26-1.565 0.8378-1.464-0.3998-3.639-2.1554-3.358-2.262 0.046-3.1904 3.14-1.7356 4.685 1.3468 1.52 3.833 1.312 5.4301 0.318 1.8125-1.18 2.0395-3.544 1.8325-5.562-0.07-0.678-0.403-2.67-0.444-3.387 0.697-0.249 0.209-0.059 1.193-0.449 2.66-1.053 4.357-4.259 3.594-7.122-0.318-1.469-1.044-2.914-2.302-3.792zm0.561 5.757c0.214 1.991-1.053 4.321-3.079 4.96-0.136-0.795-0.172-1.011-0.2626-1.475-0.4822-2.46-0.744-4.987-1.116-7.481 1.6246-0.168 3.4576 0.543 4.0226 2.184 0.244 0.577 0.343 1.197 0.435 1.812zm-5.1486 5.196c-2.5441 0.141-4.9995-1.595-5.6343-4.081-0.749-2.153-0.5283-4.63 0.8207-6.504 1.1151-1.702 2.6065-3.105 4.0286-4.543 0.183 1.127 0.366 2.254 0.549 3.382-2.9906 0.782-5.0046 4.725-3.215 7.451 0.5324 0.764 1.9765 2.223 2.7655 1.634-1.102-0.683-2.0033-1.859-1.8095-3.227-0.0821-1.282 1.3699-2.911 2.6513-3.198 0.4384 2.869 0.9413 6.073 1.3797 8.943-0.5054 0.1-1.0211 0.143-1.536 0.143z";
interface ChordDiagram {
  name: string;
  strings: (number | 'x' | 'o')[]; // 6th string to 1st string
  baseFret?: number;
}

const CHORD_LIBRARY: Record<string, (number | 'x' | 'o')[]> = {
  'C': ['x', 3, 2, 'o', 1, 'o'],
  'G': [3, 2, 'o', 'o', 'o', 3],
  'D': ['x', 'x', 'o', 2, 3, 2],
  'A': ['x', 'o', 2, 2, 2, 'o'],
  'E': ['o', 2, 2, 1, 'o', 'o'],
  'Am': ['x', 'o', 2, 2, 1, 'o'],
  'Em': ['o', 2, 2, 'o', 'o', 'o'],
  'Dm': ['x', 'x', 'o', 2, 3, 1],
  'F': [1, 3, 3, 2, 1, 1],
  'B7': ['x', 2, 1, 2, 'o', 2],
  'Cadd9': ['x', 3, 2, 'o', 3, 3],
  'G/B': ['x', 2, 'o', 'o', 3, 3],
  'D/F#': [2, 'o', 'o', 2, 3, 2],
  'Dm7': ['x', 'x', 'o', 2, 1, 1],
  'Am7': ['x', 'o', 2, 'o', 1, 'o'],
  'Em7': ['o', 2, 2, 'o', 3, 3],
  'G7': [3, 2, 'o', 'o', 'o', 1],
  'C7': ['x', 3, 2, 3, 1, 'o'],
  'A7': ['x', 'o', 2, 'o', 2, 'o'],
  'E7': ['o', 2, 'o', 1, 'o', 'o'],
  'Fmaj7': ['x', 'x', 3, 2, 1, 'o'],
  'Bm7': ['x', 2, 4, 2, 3, 2],
  'Cmaj7': ['x', 3, 2, 'o', 'o', 'o']
};

interface RhythmItem {
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

interface MeasureData {
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

function parseDurationToBeats(durationStr: string): number {
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

export type PageSize = 'A4' | 'A3' | 'A5' | 'B4' | 'B5' | 'Letter';
export type PageOrientation = 'portrait' | 'landscape';

export const PAGE_CONFIG: Record<PageSize, { widthMm: number; heightMm: number; name: string }> = {
  A4: { widthMm: 210, heightMm: 297, name: 'A4' },
  A3: { widthMm: 297, heightMm: 420, name: 'A3' },
  A5: { widthMm: 148, heightMm: 210, name: 'A5' },
  B4: { widthMm: 250, heightMm: 353, name: 'B4' },
  B5: { widthMm: 176, heightMm: 250, name: 'B5' },
  Letter: { widthMm: 215.9, heightMm: 279.4, name: 'Letter' }
};

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

export function compileGuitarDslToHtml(dslContent: string): string {
  const score = parseGuitarDsl(dslContent);
  const { title, artist, capo, originalKey, bpm } = score;

  // Generate Chord Diagrams SVG
  let chordSvgs = '';
  for (const chord of score.usedChords) {
    const frets = CHORD_LIBRARY[chord] || ['x', 'x', 'o', 2, 3, 2];
    chordSvgs += renderChordDiagram(chord, frets);
  }

  const measuresPerRow = 4;
  const sysWidth = 780;
  const barWidth = sysWidth / measuresPerRow;
  const sysHeight = 140;
  const totalPages = score.pages.length;

  const spreadGroups: string[] = [];
  for (let pIdx = 0; pIdx < score.pages.length; pIdx += 2) {
    const page1 = score.pages[pIdx];
    const page2 = (pIdx + 1 < score.pages.length) ? score.pages[pIdx + 1] : null;

    let p1Systems = '';
    for (let i = 0; i < page1.measures.length; i += measuresPerRow) {
      const rowMeasures = page1.measures.slice(i, i + measuresPerRow);
      const isFirstRow = (page1.pageNumber === 1 && i === 0);
      p1Systems += renderSystemRow(rowMeasures, isFirstRow, barWidth, sysHeight, sysWidth, score.style);
    }
    const p1Html = `
      <div class="sheet-page" data-page="${page1.pageNumber}">
        ${page1.pageNumber === 1 ? `
          <div class="score-header">
            <div class="title-area">
              <h1 style="font-size: ${score.style.titleSize ?? 20}pt;">${escapeXml(title)}</h1>
              <div class="meta">${artist ? 'Words & Music: ' + escapeXml(artist) : ''}</div>
            </div>
            <div class="play-info">
              <div>Key: ${escapeXml(originalKey)} ／ BPM: ${escapeXml(bpm)}</div>
              <div><span class="capo-badge">Capo: ${escapeXml(capo)}</span></div>
            </div>
          </div>
          ${chordSvgs ? `<div class="diagrams-row">${chordSvgs}</div>` : ''}
        ` : `
          <div class="running-header">
            <div class="running-title">${escapeXml(title)}</div>
            <div class="running-page">- ${page1.pageNumber} -</div>
          </div>
        `}
        <div class="score-sheet">
          ${p1Systems}
        </div>
        <div class="page-footer">
          <span>${page1.pageNumber} / ${totalPages}</span>
        </div>
      </div>
    `;

    let p2Html = '';
    if (page2) {
      let p2Systems = '';
      for (let i = 0; i < page2.measures.length; i += measuresPerRow) {
        const rowMeasures = page2.measures.slice(i, i + measuresPerRow);
        p2Systems += renderSystemRow(rowMeasures, false, barWidth, sysHeight, sysWidth, score.style);
      }
      p2Html = `
        <div class="sheet-page" data-page="${page2.pageNumber}">
          <div class="running-header">
            <div class="running-title">${escapeXml(title)}</div>
            <div class="running-page">- ${page2.pageNumber} -</div>
          </div>
          <div class="score-sheet">
            ${p2Systems}
          </div>
          <div class="page-footer">
            <span>${page2.pageNumber} / ${totalPages}</span>
          </div>
        </div>
      `;
    }

    spreadGroups.push(`
      <div class="spread-sheet" data-spread="${Math.floor(pIdx / 2) + 1}">
        ${p1Html}
        ${p2Html}
      </div>
    `);
  }
  const pagesHtml = spreadGroups.join('\n');

  // Web mode: continuous seamless score
  let webScoreContent = `
    <div class="score-header">
      <div class="title-area">
        <h1 style="font-size: ${score.style.titleSize ?? 20}pt;">${escapeXml(title)}</h1>
        <div class="meta">${artist ? 'Words & Music: ' + escapeXml(artist) : ''}</div>
      </div>
      <div class="play-info">
        <div>Key: ${escapeXml(originalKey)} ／ BPM: ${escapeXml(bpm)}</div>
        <div><span class="capo-badge">Capo: ${escapeXml(capo)}</span></div>
      </div>
    </div>
    ${chordSvgs ? `<div class="diagrams-row">${chordSvgs}</div>` : ''}
    <div class="score-sheet">
  `;

  for (let pIdx = 0; pIdx < score.pages.length; pIdx++) {
    const page = score.pages[pIdx];
    if (pIdx > 0) {
      webScoreContent += `<div class="web-page-separator"><span>PAGE BREAK (${page.pageNumber})</span></div>`;
    }
    for (let i = 0; i < page.measures.length; i += measuresPerRow) {
      const rowMeasures = page.measures.slice(i, i + measuresPerRow);
      const isFirstRow = (pIdx === 0 && i === 0);
      webScoreContent += renderSystemRow(rowMeasures, isFirstRow, barWidth, sysHeight, sysWidth, score.style);
    }
  }
  webScoreContent += `</div>`;

  const baseFontSize = score.style.fontSize ?? 10;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeXml(title)}</title>
<style>
  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
    font-size: ${baseFontSize}pt;
    color: #111;
    margin: 0;
    padding: 66px 16px 36px 16px;
    background: #e9ecef;
    min-height: 100vh;
  }

  /* Fixed External Toolbar */
  .toolbar-container {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 48px;
    background: #252526;
    border-bottom: 1px solid #3c3c3c;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    z-index: 1000;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    color: #cccccc;
    user-select: none;
  }
  .toolbar-left, .toolbar-center, .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .toolbar-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #888;
    margin-right: 2px;
  }
  .segmented-control {
    display: inline-flex;
    background: #1e1e1e;
    border-radius: 4px;
    padding: 2px;
    border: 1px solid #3c3c3c;
  }
  .tool-btn {
    background: transparent;
    color: #aaa;
    border: none;
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 500;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .tool-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }
  .tool-btn.active {
    background: #007acc;
    color: #ffffff;
    font-weight: 600;
  }
  .tool-select {
    background: #1e1e1e;
    color: #eeeeee;
    border: 1px solid #3c3c3c;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    cursor: pointer;
  }
  .tool-select:focus {
    outline: 1px solid #007acc;
  }
  .btn-pdf {
    background: #007acc;
    color: #fff;
    border: none;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: bold;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: background 0.15s ease;
  }
  .btn-pdf:hover {
    background: #0062a3;
  }

  /* Sheet Page (Base) */
  .sheet-page {
    background: #ffffff;
    padding: 24px 28px 20px 28px;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.1);
    box-sizing: border-box;
    width: 100%;
    max-width: 840px;
    border-radius: 2px;
    position: relative;
  }

  /* Single Page Mode (Default): Vertical scrolling of pages like Word / PDF viewer */
  body[data-display-mode="single"] .sheet-pages-wrapper {
    display: block;
  }
  body[data-display-mode="single"] .spread-sheet {
    display: contents;
  }
  body[data-display-mode="single"] .sheet-page {
    display: block;
    margin: 0 auto 28px auto;
  }
  body[data-display-mode="single"] .web-score-container {
    display: none;
  }

  /* Spread Mode (見開き): 2 pages side-by-side */
  body[data-display-mode="spread"] .sheet-pages-wrapper {
    display: block;
  }
  body[data-display-mode="spread"] .spread-sheet {
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: flex-start;
    gap: 24px;
    max-width: 1720px;
    margin: 0 auto 28px auto;
  }
  body[data-display-mode="spread"] .sheet-page {
    display: block;
    flex: 1 1 0;
    max-width: 840px;
    min-width: 380px;
    margin: 0;
  }
  body[data-display-mode="spread"] .web-score-container {
    display: none;
  }

  /* Landscape (横向き・見開き印刷): spread-sheet becomes a single landscape card */
  body[data-orientation="landscape"] .sheet-pages-wrapper {
    display: block;
  }
  body[data-orientation="landscape"] .spread-sheet {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    gap: 32px;
    background: #ffffff;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.12);
    border-radius: 2px;
    padding: 24px 32px 20px 32px;
    max-width: 1300px;
    margin: 0 auto 32px auto;
    position: relative;
    box-sizing: border-box;
  }
  body[data-orientation="landscape"] .spread-sheet::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 24px;
    bottom: 24px;
    border-left: 1px dashed #ccc;
  }
  body[data-orientation="landscape"] .sheet-page {
    background: transparent;
    box-shadow: none;
    padding: 0;
    flex: 1 1 0;
    max-width: calc(50% - 16px);
    margin: 0;
  }
  body[data-orientation="landscape"] .sheet-page.empty-page {
    visibility: hidden;
  }
  body[data-orientation="landscape"] .web-score-container {
    display: none;
  }

  /* Web Mode (シームレス連続スクロール) */
  body[data-display-mode="web"] .sheet-pages-wrapper {
    display: none;
  }
  body[data-display-mode="web"] .web-score-container {
    display: block;
    background: #ffffff;
    padding: 28px 32px 32px 32px;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.1);
    box-sizing: border-box;
    width: 100%;
    max-width: 860px;
    border-radius: 2px;
    margin: 0 auto 32px auto;
  }
  .web-page-separator {
    display: flex;
    align-items: center;
    margin: 20px 0 16px 0;
    color: #888;
    font-size: 8.5pt;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .web-page-separator::before,
  .web-page-separator::after {
    content: '';
    flex: 1;
    border-bottom: 1px dashed #bbb;
  }
  .web-page-separator span {
    padding: 0 12px;
    font-weight: bold;
    color: #777;
  }

  /* Header (Page 1) */
  .score-header {
    border-bottom: 2px solid #000;
    padding-bottom: 6px;
    margin-bottom: 12px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .title-area h1 {
    margin: 0 0 3px 0;
    font-weight: 900;
    letter-spacing: -0.5px;
  }
  .title-area .meta {
    font-size: 9pt;
    color: #444;
  }
  .play-info {
    text-align: right;
    font-size: 9pt;
    line-height: 1.35;
  }
  .capo-badge {
    display: inline-block;
    background: #000;
    color: #fff;
    font-weight: bold;
    padding: 1px 6px;
    border-radius: 2px;
    font-size: 8.5pt;
  }

  /* Running Header (Page 2+) */
  .running-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #999;
    padding-bottom: 6px;
    margin-bottom: 16px;
    font-size: 9pt;
    color: #555;
  }
  .running-title {
    font-weight: bold;
    color: #222;
  }
  .running-page {
    font-size: 8.5pt;
    color: #666;
  }

  /* Page Footer */
  .page-footer {
    margin-top: 14px;
    padding-top: 6px;
    border-top: 1px solid #eee;
    text-align: right;
    font-size: 8pt;
    color: #888;
  }

  /* Chord Diagrams */
  .diagrams-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    border-bottom: 1px solid #aaa;
    padding-bottom: 8px;
    margin-bottom: 12px;
  }
  .diagram-box {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .diagram-name {
    font-size: 10.5pt;
    font-weight: bold;
    font-family: Arial, sans-serif;
  }

  /* Systems */
  .system-row {
    margin-bottom: 8px;
  }
  .system-svg {
    width: 100%;
    height: auto;
    display: block;
  }
</style>
</head>
<body data-display-mode="single" data-orientation="portrait" data-page-size="A4">
  <div class="toolbar-container">
    <div class="toolbar-left">
      <span class="toolbar-label">表示</span>
      <div class="segmented-control">
        <button class="tool-btn active" data-mode="single" title="1ページ単位表示（縦スクロール）">1ページ</button>
        <button class="tool-btn" data-mode="spread" title="見開き表示（2ページ横並び）">見開き</button>
        <button class="tool-btn" data-mode="web" title="Web表示（用紙枠なしシームレススクロール）">Web</button>
      </div>
    </div>

    <div class="toolbar-center">
      <span class="toolbar-label">用紙</span>
      <select id="select-page-size" class="tool-select" title="用紙サイズ">
        <option value="A4" selected>A4 (210×297mm)</option>
        <option value="A3">A3 (297×420mm)</option>
        <option value="A5">A5 (148×210mm)</option>
        <option value="B4">B4 (250×353mm)</option>
        <option value="B5">B5 (176×250mm)</option>
        <option value="Letter">Letter (8.5×11")</option>
      </select>
      <span class="toolbar-label" style="margin-left: 8px;">向き</span>
      <div class="segmented-control">
        <button class="tool-btn active" data-orientation="portrait" title="縦向き">縦</button>
        <button class="tool-btn" data-orientation="landscape" title="横向き（見開き印刷）">横（見開き）</button>
      </div>
    </div>

    <div class="toolbar-right">
      <button class="btn-pdf" id="btn-save-pdf" title="選択中の用紙サイズと向きでPDFを保存">📄 PDF保存</button>
    </div>
  </div>

  <div class="sheet-pages-wrapper">
    ${pagesHtml}
  </div>

  <div class="web-score-container">
    ${webScoreContent}
  </div>

  <script>
    (function() {
      const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
      let currentMode = 'single';
      let currentOrientation = 'portrait';
      let currentPageSize = 'A4';

      if (vscode) {
        const state = vscode.getState();
        if (state) {
          if (state.currentMode && ['single', 'spread', 'web'].includes(state.currentMode)) {
            currentMode = state.currentMode;
          }
          if (state.currentOrientation && ['portrait', 'landscape'].includes(state.currentOrientation)) {
            currentOrientation = state.currentOrientation;
          }
          if (state.currentPageSize) {
            currentPageSize = state.currentPageSize;
          }
        }
      }

      function saveState() {
        if (vscode) {
          vscode.setState({
            currentMode,
            currentOrientation,
            currentPageSize
          });
        }
      }

      const body = document.body;
      const modeButtons = document.querySelectorAll('.tool-btn[data-mode]');
      const orientationButtons = document.querySelectorAll('.tool-btn[data-orientation]');
      const pageSizeSelect = document.getElementById('select-page-size');
      const savePdfBtn = document.getElementById('btn-save-pdf');

      if (pageSizeSelect) {
        pageSizeSelect.value = currentPageSize;
      }

      function updateView() {
        body.setAttribute('data-display-mode', currentMode);
        body.setAttribute('data-orientation', currentOrientation);
        body.setAttribute('data-page-size', currentPageSize);

        modeButtons.forEach(btn => {
          btn.classList.toggle('active', btn.getAttribute('data-mode') === currentMode);
        });

        orientationButtons.forEach(btn => {
          btn.classList.toggle('active', btn.getAttribute('data-orientation') === currentOrientation);
        });

        saveState();
      }

      modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          currentMode = btn.getAttribute('data-mode');
          updateView();
        });
      });

      orientationButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          currentOrientation = btn.getAttribute('data-orientation');
          updateView();
        });
      });

      if (pageSizeSelect) {
        pageSizeSelect.addEventListener('change', (e) => {
          currentPageSize = e.target.value;
          updateView();
        });
      }

      if (savePdfBtn) {
        savePdfBtn.addEventListener('click', () => {
          if (vscode) {
            vscode.postMessage({
              command: 'savePdf',
              pageSize: currentPageSize,
              orientation: currentOrientation
            });
          }
        });
      }

      updateView();
    })();
  </script>
</body>
</html>`;
}

export function compileGuitarDslToPrintHtml(
  dslContent: string,
  pageSize: PageSize = 'A4',
  orientation: PageOrientation = 'portrait'
): string {
  const score = parseGuitarDsl(dslContent);
  const { title, artist, capo, originalKey, bpm } = score;

  let chordSvgs = '';
  for (const chord of score.usedChords) {
    const frets = CHORD_LIBRARY[chord] || ['x', 'x', 'o', 2, 3, 2];
    chordSvgs += renderChordDiagram(chord, frets);
  }

  const measuresPerRow = 4;
  const sysWidth = 780;
  const barWidth = sysWidth / measuresPerRow;
  const sysHeight = 140;
  const totalPages = score.pages.length;

  const spreadGroups: string[] = [];
  if (orientation === 'landscape') {
    // 2-up Spread print
    for (let pIdx = 0; pIdx < score.pages.length; pIdx += 2) {
      const page1 = score.pages[pIdx];
      const page2 = (pIdx + 1 < score.pages.length) ? score.pages[pIdx + 1] : null;

      let p1Systems = '';
      for (let i = 0; i < page1.measures.length; i += measuresPerRow) {
        const rowMeasures = page1.measures.slice(i, i + measuresPerRow);
        const isFirst = (page1.pageNumber === 1 && i === 0);
        p1Systems += renderSystemRow(rowMeasures, isFirst, barWidth, sysHeight, sysWidth, score.style);
      }
      const p1Html = `
        <div class="sheet-page" data-page="${page1.pageNumber}">
          ${page1.pageNumber === 1 ? `
            <div class="score-header">
              <div class="title-area">
                <h1 style="font-size: ${score.style.titleSize ?? 18}pt;">${escapeXml(title)}</h1>
                <div class="meta">${artist ? 'Words & Music: ' + escapeXml(artist) : ''}</div>
              </div>
              <div class="play-info">
                <div>Key: ${escapeXml(originalKey)} ／ BPM: ${escapeXml(bpm)}</div>
                <div><span class="capo-badge">Capo: ${escapeXml(capo)}</span></div>
              </div>
            </div>
            ${chordSvgs ? `<div class="diagrams-row">${chordSvgs}</div>` : ''}
          ` : `
            <div class="running-header">
              <div class="running-title">${escapeXml(title)}</div>
              <div class="running-page">- ${page1.pageNumber} -</div>
            </div>
          `}
          <div class="score-sheet">
            ${p1Systems}
          </div>
          <div class="page-footer">
            <span>${page1.pageNumber} / ${totalPages}</span>
          </div>
        </div>
      `;

      let p2Html = '';
      if (page2) {
        let p2Systems = '';
        for (let i = 0; i < page2.measures.length; i += measuresPerRow) {
          const rowMeasures = page2.measures.slice(i, i + measuresPerRow);
          p2Systems += renderSystemRow(rowMeasures, false, barWidth, sysHeight, sysWidth, score.style);
        }
        p2Html = `
          <div class="sheet-page" data-page="${page2.pageNumber}">
            <div class="running-header">
              <div class="running-title">${escapeXml(title)}</div>
              <div class="running-page">- ${page2.pageNumber} -</div>
            </div>
            <div class="score-sheet">
              ${p2Systems}
            </div>
            <div class="page-footer">
              <span>${page2.pageNumber} / ${totalPages}</span>
            </div>
          </div>
        `;
      } else {
        p2Html = `<div class="sheet-page empty-page"></div>`;
      }

      spreadGroups.push(`
        <div class="spread-sheet">
          ${p1Html}
          ${p2Html}
        </div>
      `);
    }
  } else {
    // Portrait: 1 page per sheet
    for (let pIdx = 0; pIdx < score.pages.length; pIdx++) {
      const page = score.pages[pIdx];
      let pageSystems = '';
      for (let i = 0; i < page.measures.length; i += measuresPerRow) {
        const rowMeasures = page.measures.slice(i, i + measuresPerRow);
        const isFirst = (page.pageNumber === 1 && i === 0);
        pageSystems += renderSystemRow(rowMeasures, isFirst, barWidth, sysHeight, sysWidth, score.style);
      }
      spreadGroups.push(`
        <div class="sheet-page" data-page="${page.pageNumber}">
          ${page.pageNumber === 1 ? `
            <div class="score-header">
              <div class="title-area">
                <h1 style="font-size: ${score.style.titleSize ?? 20}pt;">${escapeXml(title)}</h1>
                <div class="meta">${artist ? 'Words & Music: ' + escapeXml(artist) : ''}</div>
              </div>
              <div class="play-info">
                <div>Key: ${escapeXml(originalKey)} ／ BPM: ${escapeXml(bpm)}</div>
                <div><span class="capo-badge">Capo: ${escapeXml(capo)}</span></div>
              </div>
            </div>
            ${chordSvgs ? `<div class="diagrams-row">${chordSvgs}</div>` : ''}
          ` : `
            <div class="running-header">
              <div class="running-title">${escapeXml(title)}</div>
              <div class="running-page">- ${page.pageNumber} -</div>
            </div>
          `}
          <div class="score-sheet">
            ${pageSystems}
          </div>
          <div class="page-footer">
            <span>${page.pageNumber} / ${totalPages}</span>
          </div>
        </div>
      `);
    }
  }

  const isLandscape = orientation === 'landscape';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${escapeXml(title)}</title>
<style>
  @page {
    size: ${pageSize} ${orientation};
    margin: 8mm 10mm 8mm 10mm;
  }
  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
    color: #111;
    margin: 0;
    padding: 0;
    background: #ffffff;
  }
  ${isLandscape ? `
  .spread-sheet {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    gap: 12mm;
    width: 100%;
    page-break-after: always;
    break-after: page;
  }
  .spread-sheet:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  .sheet-page {
    flex: 1 1 0;
    max-width: 48%;
    box-sizing: border-box;
  }
  .sheet-page.empty-page {
    visibility: hidden;
  }
  ` : `
  .sheet-page {
    page-break-after: always;
    break-after: page;
    width: 100%;
    box-sizing: border-box;
  }
  .sheet-page:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  `}
  .score-header {
    border-bottom: 2px solid #000;
    padding-bottom: 4px;
    margin-bottom: 10px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .title-area h1 {
    margin: 0 0 2px 0;
    font-weight: 900;
    letter-spacing: -0.5px;
  }
  .title-area .meta {
    font-size: 8.5pt;
    color: #444;
  }
  .play-info {
    text-align: right;
    font-size: 8.5pt;
    line-height: 1.3;
  }
  .capo-badge {
    display: inline-block;
    background: #000;
    color: #fff;
    font-weight: bold;
    padding: 1px 5px;
    border-radius: 2px;
    font-size: 8pt;
  }
  .running-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #999;
    padding-bottom: 4px;
    margin-bottom: 12px;
    font-size: 8.5pt;
    color: #555;
  }
  .running-title {
    font-weight: bold;
    color: #222;
  }
  .running-page {
    font-size: 8pt;
    color: #666;
  }
  .page-footer {
    margin-top: 10px;
    padding-top: 4px;
    border-top: 1px solid #ddd;
    text-align: right;
    font-size: 7.5pt;
    color: #888;
  }
  .diagrams-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    border-bottom: 1px solid #aaa;
    padding-bottom: 6px;
    margin-bottom: 10px;
  }
  .diagram-box {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .diagram-name {
    font-size: 9.5pt;
    font-weight: bold;
    font-family: Arial, sans-serif;
  }
  .system-row {
    margin-bottom: 6px;
  }
  .system-svg {
    width: 100%;
    height: auto;
    display: block;
  }
</style>
</head>
<body>
  ${spreadGroups.join('\n')}
</body>
</html>`;
}

export function compileGuitarDslToSvg(dslContent: string): string {
  const score = parseGuitarDsl(dslContent);
  const { title, artist, capo, originalKey, bpm } = score;

  const measuresPerRow = 4;
  const sysWidth = 780;
  const barWidth = sysWidth / measuresPerRow;
  const sysHeight = 140;

  let numRows = 0;
  for (const page of score.pages) {
    numRows += Math.ceil(page.measures.length / measuresPerRow);
  }
  if (numRows === 0) numRows = 1;

  const headerHeight = 70;
  const chordDiagramsHeight = score.usedChords.length > 0 ? 80 : 0;
  const totalWidth = 840;
  const leftMargin = 30;
  const topMargin = 20;
  const totalHeight = topMargin + headerHeight + chordDiagramsHeight + numRows * sysHeight + 40;

  let svg = `<svg width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg" style="background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif;">\n`;

  // Header
  const titleSize = score.style.titleSize ?? 22;
  svg += `<text x="${leftMargin}" y="${topMargin + 28}" font-size="${titleSize}" font-weight="900" fill="#111">${escapeXml(title)}</text>\n`;
  if (artist) {
    svg += `<text x="${leftMargin}" y="${topMargin + 46}" font-size="11" fill="#444">Words &amp; Music: ${escapeXml(artist)}</text>\n`;
  }
  const rightX = totalWidth - leftMargin;
  svg += `<text x="${rightX}" y="${topMargin + 24}" font-size="11" text-anchor="end" fill="#111">Key: ${escapeXml(originalKey)} ／ BPM: ${escapeXml(bpm)}</text>\n`;
  svg += `<rect x="${rightX - 65}" y="${topMargin + 32}" width="65" height="18" rx="2" fill="#000"/>\n`;
  svg += `<text x="${rightX - 32.5}" y="${topMargin + 45}" font-size="10.5" font-weight="bold" fill="#fff" text-anchor="middle">Capo: ${escapeXml(capo)}</text>\n`;
  svg += `<line x1="${leftMargin}" y1="${topMargin + 58}" x2="${rightX}" y2="${topMargin + 58}" stroke="#000" stroke-width="2"/>\n`;

  let currentY = topMargin + headerHeight;

  // Chord diagrams
  if (score.usedChords.length > 0) {
    let diagX = leftMargin;
    for (const chord of score.usedChords) {
      const frets = CHORD_LIBRARY[chord] || ['x', 'x', 'o', 2, 3, 2];
      svg += `<g transform="translate(${diagX}, ${currentY})">\n`;
      svg += `  <text x="25" y="0" font-size="12" font-weight="bold" font-family="Arial" text-anchor="middle" fill="#000">${escapeXml(chord)}</text>\n`;
      svg += `  <g transform="translate(0, 5)">\n`;
      svg += renderChordDiagramSvg(frets);
      svg += `  </g>\n`;
      svg += `</g>\n`;
      diagX += 56;
    }
    svg += `<line x1="${leftMargin}" y1="${currentY + 68}" x2="${rightX}" y2="${currentY + 68}" stroke="#aaa" stroke-width="1"/>\n`;
    currentY += chordDiagramsHeight;
  }

  // System rows by page
  for (let pIdx = 0; pIdx < score.pages.length; pIdx++) {
    const page = score.pages[pIdx];
    for (let i = 0; i < page.measures.length; i += measuresPerRow) {
      const rowMeasures = page.measures.slice(i, i + measuresPerRow);
      const isFirst = (pIdx === 0 && i === 0);
      svg += `<g transform="translate(${leftMargin}, ${currentY})">\n`;
      svg += renderSystemSvgContent(rowMeasures, isFirst, barWidth, sysHeight, sysWidth, score.style);
      svg += `</g>\n`;
      currentY += sysHeight;
    }
  }

  svg += `</svg>\n`;
  return svg;
}

function renderChordDiagramSvg(frets: (number | 'x' | 'o')[]): string {
  let circles = '';
  let topMarks = '';

  for (let s = 0; s < 6; s++) {
    const x = 5 + s * 8;
    const f = frets[s];
    if (f === 'x') {
      topMarks += `<text x="${x}" y="9" font-size="8" font-family="Arial" text-anchor="middle" fill="#000">×</text>`;
    } else if (f === 'o') {
      topMarks += `<circle cx="${x}" cy="7" r="2" fill="none" stroke="#000" stroke-width="0.8"/>`;
    } else if (typeof f === 'number' && f > 0) {
      const y = 14 + (f - 1) * 9 + 4.5;
      circles += `<circle cx="${x}" cy="${y}" r="3" fill="#000"/>`;
    }
  }

  return `
    ${topMarks}
    <!-- Nut -->
    <line x1="5" y1="14" x2="45" y2="14" stroke="#000" stroke-width="2.2"/>
    <!-- Frets -->
    <line x1="5" y1="23" x2="45" y2="23" stroke="#888" stroke-width="0.7"/>
    <line x1="5" y1="32" x2="45" y2="32" stroke="#888" stroke-width="0.7"/>
    <line x1="5" y1="41" x2="45" y2="41" stroke="#888" stroke-width="0.7"/>
    <line x1="5" y1="50" x2="45" y2="50" stroke="#888" stroke-width="0.7"/>
    <!-- Strings -->
    <line x1="5" y1="14" x2="5" y2="50" stroke="#000" stroke-width="0.7"/>
    <line x1="13" y1="14" x2="13" y2="50" stroke="#000" stroke-width="0.7"/>
    <line x1="21" y1="14" x2="21" y2="50" stroke="#000" stroke-width="0.7"/>
    <line x1="29" y1="14" x2="29" y2="50" stroke="#000" stroke-width="0.7"/>
    <line x1="37" y1="14" x2="37" y2="50" stroke="#000" stroke-width="0.7"/>
    <line x1="45" y1="14" x2="45" y2="50" stroke="#000" stroke-width="0.7"/>
    ${circles}`;
}

function renderChordDiagram(name: string, frets: (number | 'x' | 'o')[]): string {
  return `
    <div class="diagram-box">
      <span class="diagram-name">${escapeXml(name)}</span>
      <svg width="42" height="50" viewBox="0 0 50 58">
        ${renderChordDiagramSvg(frets)}
      </svg>
    </div>`;
}

function renderSystemRow(measures: MeasureData[], isFirst: boolean, barWidth: number, height: number, totalWidth: number, style?: ScoreStyle): string {
  return `
    <div class="system-row">
      <svg class="system-svg" viewBox="0 0 ${totalWidth} ${height}" xmlns="http://www.w3.org/2000/svg">
        ${renderSystemSvgContent(measures, isFirst, barWidth, height, totalWidth, style)}
      </svg>
    </div>`;
}

function renderSystemSvgContent(measures: MeasureData[], isFirst: boolean, barWidth: number, height: number, totalWidth: number, style?: ScoreStyle): string {
  const chordSize = style?.chordSize ?? 15;
  const sectionSize = style?.sectionSize ?? 9.5;
  const lyricSize = style?.lyricSize ?? 10;

  const staveY = 70;
  const staveLines = [0, 8, 16, 24, 32].map(dy => staveY + dy);

  let staveSvg = '';
  staveLines.forEach(y => {
    staveSvg += `<line x1="25" y1="${y}" x2="${totalWidth - 5}" y2="${y}" stroke="#000" stroke-width="1"/>`;
  });
  staveSvg += `<line x1="25" y1="${staveLines[0]}" x2="${25}" y2="${staveLines[4]}" stroke="#000" stroke-width="2"/>`;

  // Treble clef appears at the start of every system row (standard musical notation convention)
  let clefSvg = `<g transform="translate(28, 53.36) scale(1.6)"><path d="${FETA_TREBLE_CLEF_PATH}" fill="#000"/></g>`;
  if (isFirst) {
    clefSvg += `<text x="58" y="${staveY + 14}" font-family="Arial, sans-serif" font-size="14" font-weight="bold">4</text>`;
    clefSvg += `<text x="58" y="${staveY + 30}" font-family="Arial, sans-serif" font-size="14" font-weight="bold">4</text>`;
  }

  let barsSvg = '';
  // Align measure barlines consistently across all rows
  const startX = 78;
  const usableWidth = (totalWidth - 5) - startX;
  const actualBarWidth = usableWidth / measures.length;

  measures.forEach((m, idx) => {
    const bx = startX + idx * actualBarWidth;
    const bEnd = bx + actualBarWidth;

    // Barline
    if (m.repeatEnd) {
      barsSvg += `<circle cx="${bEnd - 12}" cy="${staveLines[1] + 4}" r="2" fill="#000"/>`;
      barsSvg += `<circle cx="${bEnd - 12}" cy="${staveLines[2] + 4}" r="2" fill="#000"/>`;
      barsSvg += `<line x1="${bEnd - 5}" y1="${staveLines[0]}" x2="${bEnd - 5}" y2="${staveLines[4]}" stroke="#000" stroke-width="1.2"/>`;
      barsSvg += `<line x1="${bEnd}" y1="${staveLines[0]}" x2="${bEnd}" y2="${staveLines[4]}" stroke="#000" stroke-width="3"/>`;
    } else {
      barsSvg += `<line x1="${bEnd}" y1="${staveLines[0]}" x2="${bEnd}" y2="${staveLines[4]}" stroke="#000" stroke-width="1.2"/>`;
    }

    if (m.repeatStart) {
      barsSvg += `<line x1="${bx}" y1="${staveLines[0]}" x2="${bx}" y2="${staveLines[4]}" stroke="#000" stroke-width="3"/>`;
      barsSvg += `<line x1="${bx + 5}" y1="${staveLines[0]}" x2="${bx + 5}" y2="${staveLines[4]}" stroke="#000" stroke-width="1.2"/>`;
      barsSvg += `<circle cx="${bx + 12}" cy="${staveLines[1] + 4}" r="2" fill="#000"/>`;
      barsSvg += `<circle cx="${bx + 12}" cy="${staveLines[2] + 4}" r="2" fill="#000"/>`;
    }

    // Section Label (placed at the top: y = 2 to 16)
    if (m.sectionName) {
      barsSvg += `
        <rect x="${bx + 4}" y="2" width="${m.sectionName.length * (sectionSize * 0.95) + 12}" height="${sectionSize + 5}" fill="#fff" stroke="#000" stroke-width="1.2"/>
        <text x="${bx + 10}" y="${sectionSize + 3.5}" font-family="Arial, sans-serif" font-size="${sectionSize}" font-weight="bold">${escapeXml(m.sectionName)}</text>
      `;
    }

    if (m.isMeasureRepeat) {
      // Chords (placed clearly above: baseline at y = 33)
      const chordsToRender = m.chords && m.chords.length > 0
        ? m.chords
        : (m.chord ? [{ name: m.chord, beat: 0 }] : []);

      const padLeft = 14;
      const padRight = 14;
      const usableW = actualBarWidth - padLeft - padRight;
      let lastChordRight = bx;

      chordsToRender.forEach((ch, chIdx) => {
        let chordX = bx + 8;
        if (chIdx > 0 || ch.beat > 0) {
          chordX = Math.max(bx + 8, bx + padLeft + (ch.beat / 4.0) * usableW);
        }
        chordX = Math.max(lastChordRight + 6, chordX);
        lastChordRight = chordX + ch.name.length * (chordSize * 0.6);
        barsSvg += `<text x="${chordX}" y="33" font-family="-apple-system, BlinkMacSystemFont, Arial, sans-serif" font-size="${chordSize}" font-weight="900" fill="#000">${escapeXml(ch.name)}</text>`;
      });

      // Measure Repeat Sign (Simile mark: diagonal slash with two dots)
      const centerX = bx + actualBarWidth / 2;
      // Diagonal slash across stave lines 2 to 4 (y=74 to y=98)
      barsSvg += `<line x1="${centerX - 13}" y1="98" x2="${centerX + 13}" y2="74" stroke="#000" stroke-width="3.6" stroke-linecap="round"/>`;
      // Upper dot in space 2 (y=82)
      barsSvg += `<circle cx="${centerX - 7}" cy="82" r="2.6" fill="#000"/>`;
      // Lower dot in space 3 (y=90)
      barsSvg += `<circle cx="${centerX + 7}" cy="90" r="2.6" fill="#000"/>`;

      // Lyric (placed below bottom stave line: baseline y = 120)
      if (m.lyric) {
        barsSvg += `<text x="${bx + actualBarWidth / 2}" y="${staveLines[4] + 18}" font-family="-apple-system, BlinkMacSystemFont, 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif" font-size="${lyricSize}" text-anchor="middle" fill="#222">${escapeXml(m.lyric)}</text>`;
      }
      return;
    }

    // Rhythms with duration calculation, Guitar Pro style slash heads, and beam grouping
    const midY = staveLines[2]; // 3rd line = 86
    const stemTopY = 60;

    // Pre-calculate positions and metrics for all rhythm items in this measure
    interface RenderedRhythm {
      item: RhythmItem;
      beats: number;
      beatOffset: number;
      rx: number;
      stemX: number;
      isWhole: boolean;
      isHalf: boolean;
      isQuarterOrShorter: boolean;
    }

    const rhythmDetails: RenderedRhythm[] = [];
    const padLeft = 14;
    const padRight = 14;
    const usableW = actualBarWidth - padLeft - padRight;
    const rCount = m.rhythms.length;
    const rStep = usableW / (rCount > 0 ? rCount : 1);

    let curBeat = 0;
    m.rhythms.forEach((r, idx) => {
      const beats = parseDurationToBeats(r.duration);
      const cleanDur = r.duration.replace(/^r/, '').toLowerCase();
      const isWhole = cleanDur === '1' || cleanDur === 'w';
      const isHalf = cleanDur === '2' || cleanDur === 'h';
      const isQuarterOrShorter = !isWhole && !isHalf;

      let rx: number;
      if (rCount === 1) {
        // Center single note in measure
        rx = bx + actualBarWidth / 2;
      } else {
        // Equal spacing across the measure
        rx = bx + padLeft + (idx + 0.5) * rStep;
      }

      const stemX = isWhole ? rx : rx + 6.5;

      rhythmDetails.push({
        item: r,
        beats,
        beatOffset: curBeat,
        rx,
        stemX,
        isWhole,
        isHalf,
        isQuarterOrShorter
      });

      curBeat += beats;
    });

    // Chords (placed clearly above picking marks: baseline at y = 33)
    const chordsToRender = m.chords && m.chords.length > 0
      ? m.chords
      : (m.chord ? [{ name: m.chord, beat: 0 }] : []);

    let lastChordRight = bx;
    chordsToRender.forEach((ch, chIdx) => {
      let chordX = bx + 8;
      if (chIdx > 0 || ch.beat > 0) {
        const matchingRhythm = rhythmDetails.find(rd => Math.abs(rd.beatOffset - ch.beat) < 0.05);
        if (matchingRhythm) {
          chordX = Math.max(bx + 8, matchingRhythm.rx - 4);
        } else {
          chordX = Math.max(bx + 8, bx + padLeft + (ch.beat / 4.0) * usableW);
        }
      }
      chordX = Math.max(lastChordRight + 6, chordX);
      lastChordRight = chordX + ch.name.length * (chordSize * 0.6);
      barsSvg += `<text x="${chordX}" y="33" font-family="-apple-system, BlinkMacSystemFont, Arial, sans-serif" font-size="${chordSize}" font-weight="900" fill="#000">${escapeXml(ch.name)}</text>`;
    });

    // Beam grouping for eighth and sixteenth notes (group by integer beat floor)
    const beamedIndices = new Set<number>();
    const beatGroups: Map<number, number[]> = new Map();

    rhythmDetails.forEach((rd, idx) => {
      if (!rd.item.isRest && rd.beats <= 0.5) {
        const beatKey = Math.floor(rd.beatOffset);
        if (!beatGroups.has(beatKey)) {
          beatGroups.set(beatKey, []);
        }
        beatGroups.get(beatKey)!.push(idx);
      }
    });

    // Render beams for groups with >= 2 notes
    beatGroups.forEach((indices) => {
      if (indices.length >= 2) {
        indices.forEach(i => beamedIndices.add(i));
        const first = rhythmDetails[indices[0]];
        const last = rhythmDetails[indices[indices.length - 1]];

        // Main beam at y = 60
        barsSvg += `<line x1="${first.stemX}" y1="${stemTopY}" x2="${last.stemX}" y2="${stemTopY}" stroke="#000" stroke-width="3.6" stroke-linecap="butt"/>`;

        // Sub-beam at y = 65 for sixteenth notes
        // Group consecutive 16th notes
        let subStart: RenderedRhythm | null = null;
        let subEnd: RenderedRhythm | null = null;

        for (let i = 0; i < indices.length; i++) {
          const rd = rhythmDetails[indices[i]];
          if (rd.beats <= 0.25) {
            if (!subStart) subStart = rd;
            subEnd = rd;
          } else {
            if (subStart && subEnd) {
              if (subStart === subEnd) {
                // Fractional beam (flaglet towards neighbor)
                const fracX = (i === 0) ? subStart.stemX + 6 : subStart.stemX - 6;
                barsSvg += `<line x1="${subStart.stemX}" y1="${stemTopY + 5}" x2="${fracX}" y2="${stemTopY + 5}" stroke="#000" stroke-width="2.4" stroke-linecap="butt"/>`;
              } else {
                barsSvg += `<line x1="${subStart.stemX}" y1="${stemTopY + 5}" x2="${subEnd.stemX}" y2="${stemTopY + 5}" stroke="#000" stroke-width="2.4" stroke-linecap="butt"/>`;
              }
              subStart = null;
              subEnd = null;
            }
          }
        }
        if (subStart && subEnd) {
          if (subStart === subEnd) {
            const fracX = (subStart === last) ? subStart.stemX - 6 : subStart.stemX + 6;
            barsSvg += `<line x1="${subStart.stemX}" y1="${stemTopY + 5}" x2="${fracX}" y2="${stemTopY + 5}" stroke="#000" stroke-width="2.4" stroke-linecap="butt"/>`;
          } else {
            barsSvg += `<line x1="${subStart.stemX}" y1="${stemTopY + 5}" x2="${subEnd.stemX}" y2="${stemTopY + 5}" stroke="#000" stroke-width="2.4" stroke-linecap="butt"/>`;
          }
        }
      }
    });

    // Render individual rhythm items
    rhythmDetails.forEach((rd, rIdx) => {
      const r = rd.item;
      const rx = rd.rx;
      const stemX = rd.stemX;
      const opacity = r.ghost ? '0.35' : '1.0';

      if (r.isRest) {
        const cleanDur = r.duration.replace(/^r/, '').toLowerCase();
        if (cleanDur === '1' || cleanDur === 'w') {
          // Whole rest: hanging from 4th stave line (index 1: y = 78)
          barsSvg += `<rect x="${rx - 6}" y="${staveLines[1]}" width="12" height="5" fill="#000"/>`;
        } else if (cleanDur === '2' || cleanDur === 'h') {
          // Half rest: sitting on 3rd stave line (index 2: y = 86)
          barsSvg += `<rect x="${rx - 6}" y="${staveLines[2] - 5}" width="12" height="5" fill="#000"/>`;
        } else if (cleanDur === '8') {
          // Eighth rest vector
          barsSvg += `<g transform="translate(${rx}, ${midY})">
            <circle cx="-2" cy="-5" r="2.4" fill="#000"/>
            <path d="M -0.2,-5 C 1.2,-5 2.8,-6.2 3.8,-8.5 L 4.5,-8.5 C 3.2,-3.5 0.5,3.5 -3.5,8.5 L -4.5,8.0 C -1.5,4.0 0.8,-1.5 1.5,-4.5 C 0.8,-4.2 0.2,-4.2 -0.2,-4.2 Z" fill="#000"/>
          </g>`;
        } else if (cleanDur === '16') {
          // Sixteenth rest vector
          barsSvg += `<g transform="translate(${rx}, ${midY})">
            <circle cx="-2" cy="-8" r="2.2" fill="#000"/>
            <circle cx="-3" cy="-1" r="2.2" fill="#000"/>
            <path d="M -0.2,-8 C 1.2,-8 2.5,-9.2 3.5,-11.5 L 4.2,-11.5 C 3.0,-6.5 0.5,2.5 -3.5,8.5 L -4.5,8.0 C -1.5,4.0 0.8,-2.5 1.5,-5.5 C 0.8,-5.2 0.2,-5.2 -0.2,-5.2 Z" fill="#000"/>
            <path d="M -1.2,-1 C 0.2,-1 1.5,-2.2 2.5,-4.5 L 3.2,-4.5 C 2.5,-1.5 1.5,2.5 -0.5,5.5 L -1.5,5.0 C 0,-1.0 0.5,-3.0 0.5,-3.0 Z" fill="#000"/>
          </g>`;
        } else {
          // Quarter rest vector (default)
          barsSvg += `<g transform="translate(${rx}, ${midY})">
            <path d="M 1.2,-14.5 C 1.8,-15.5 2.8,-16 4.0,-16 C 5.5,-16 6.8,-14.8 6.8,-13.2 C 6.8,-11.5 5.2,-9.8 3.5,-8.2 L -1.5,-3.5 C -0.8,-3.2 0,-3.2 0.8,-3.2 C 3.2,-3.2 5.2,-1.5 5.2,1.2 C 5.2,3.2 3.8,4.8 1.8,5.8 L -2.5,7.8 C -3.8,8.5 -4.8,9.8 -4.8,11.2 C -4.8,13.2 -3.0,14.8 -0.8,14.8 C 0.5,14.8 1.8,14.2 2.8,13.2 L 3.5,14.2 C 2.2,15.5 0.8,16.2 -0.8,16.2 C -3.8,16.2 -6.2,13.8 -6.2,10.8 C -6.2,8.8 -4.8,7.0 -2.8,6.0 L 1.2,4.0 C 2.5,3.2 3.2,2.2 3.2,1.2 C 3.2,-0.2 2.0,-1.5 0.5,-1.5 C -0.5,-1.5 -1.5,-1.0 -2.5,-0.2 L -3.8,-1.5 L 1.2,-6.2 C -0.5,-7.8 -2.2,-9.5 -2.2,-11.5 C -2.2,-13.8 0,-15.8 2.2,-16 L 1.2,-14.5 Z" fill="#000"/>
          </g>`;
        }
      } else {
        // Guitar Pro style slash heads
        if (rd.isWhole) {
          // Whole note: wide white slash, no stem
          barsSvg += `<polygon points="${rx - 12},${midY + 7} ${rx},${midY + 7} ${rx + 12},${midY - 7} ${rx},${midY - 7}" fill="#fff"/>`;
          barsSvg += `<path d="M ${rx - 12},${midY + 7} L ${rx},${midY + 7} L ${rx + 12},${midY - 7} L ${rx},${midY - 7} Z M ${rx - 8.5},${midY + 5.2} L ${rx - 1.5},${midY + 5.2} L ${rx + 8.5},${midY - 5.2} L ${rx + 1.5},${midY - 5.2} Z" fill="#000" fill-rule="evenodd" opacity="${opacity}"/>`;
        } else if (rd.isHalf) {
          // Half note: white slash with stem cleanly attached at top-right corner
          barsSvg += `<line x1="${stemX}" y1="${stemTopY}" x2="${stemX}" y2="${midY - 7}" stroke="#000" stroke-width="1.35" stroke-linecap="square" opacity="${opacity}"/>`;
          barsSvg += `<polygon points="${rx - 6.5},${midY + 7} ${rx + 0.5},${midY + 7} ${rx + 7},${midY - 7} ${rx},${midY - 7}" fill="#fff"/>`;
          barsSvg += `<path d="M ${rx - 6.5},${midY + 7} L ${rx + 0.5},${midY + 7} L ${rx + 7},${midY - 7} L ${rx},${midY - 7} Z M ${rx - 3.8},${midY + 5.2} L ${rx - 0.8},${midY + 5.2} L ${rx + 4.2},${midY - 5.2} L ${rx + 1.2},${midY - 5.2} Z" fill="#000" fill-rule="evenodd" opacity="${opacity}"/>`;
        } else {
          // Quarter or shorter: solid black slash with stem
          barsSvg += `<line x1="${stemX}" y1="${stemTopY}" x2="${stemX}" y2="${midY - 7}" stroke="#000" stroke-width="1.35" stroke-linecap="square" opacity="${opacity}"/>`;
          barsSvg += `<polygon points="${rx - 5.5},${midY + 7} ${rx},${midY + 7} ${rx + 6.5},${midY - 7} ${rx + 1},${midY - 7}" fill="#000" opacity="${opacity}"/>`;

          // If not beamed, draw flag for eighth / sixteenth notes
          if (!beamedIndices.has(rIdx)) {
            if (rd.beats === 0.5) {
              // 8th flag
              barsSvg += `<path d="M ${stemX},${stemTopY} C ${stemX + 4},${stemTopY + 4} ${stemX + 6},${stemTopY + 8} ${stemX + 6},${stemTopY + 13} C ${stemX + 4},${stemTopY + 10} ${stemX + 2},${stemTopY + 8} ${stemX},${stemTopY + 6} Z" fill="#000" opacity="${opacity}"/>`;
            } else if (rd.beats <= 0.25) {
              // 16th double flag
              barsSvg += `<path d="M ${stemX},${stemTopY} C ${stemX + 4},${stemTopY + 4} ${stemX + 6},${stemTopY + 8} ${stemX + 6},${stemTopY + 13} C ${stemX + 4},${stemTopY + 10} ${stemX + 2},${stemTopY + 8} ${stemX},${stemTopY + 6} Z" fill="#000" opacity="${opacity}"/>`;
              barsSvg += `<path d="M ${stemX},${stemTopY + 5} C ${stemX + 4},${stemTopY + 9} ${stemX + 6},${stemTopY + 13} ${stemX + 6},${stemTopY + 18} C ${stemX + 4},${stemTopY + 15} ${stemX + 2},${stemTopY + 13} ${stemX},${stemTopY + 11} Z" fill="#000" opacity="${opacity}"/>`;
            }
          }
        }

        // Down / Up stroke mark (placed at y = 47 to 52, above stemTopY = 60, below chord baseline = 32)
        const py = 47;
        const markX = rd.isWhole ? rx : stemX;
        if (r.down) {
          barsSvg += `<path d="M ${markX - 3},${py + 5} L ${markX - 3},${py} L ${markX + 3},${py} L ${markX + 3},${py + 5}" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;
        } else if (r.up) {
          barsSvg += `<path d="M ${markX - 3},${py} L ${markX},${py + 5} L ${markX + 3},${py}" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;
        }

        // Accent (placed at y = 38 to 44, between chord baseline = 32 and stroke mark = 47)
        const ay = 38;
        if (r.accent) {
          barsSvg += `<path d="M ${markX - 3},${ay} L ${markX + 3},${ay + 3} L ${markX - 3},${ay + 6}" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`;
        }
      }
    });

    // Lyric (placed below bottom stave line: baseline y = 120)
    if (m.lyric) {
      barsSvg += `<text x="${bx + actualBarWidth / 2}" y="${staveLines[4] + 18}" font-family="-apple-system, BlinkMacSystemFont, 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif" font-size="${lyricSize}" text-anchor="middle" fill="#222">${escapeXml(m.lyric)}</text>`;
    }
  });

  return `
    ${staveSvg}
    ${clefSvg}
    ${barsSvg}`;
}
function escapeXml(str: string): string {
  return str.replace(/[&<>"']/g, c => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}
