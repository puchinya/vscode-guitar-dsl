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
  'Bm7': ['x', 2, 4, 2, 3, 2]
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

interface MeasureData {
  chord: string;
  chords?: { name: string; beat: number }[];
  repeatStart: boolean;
  repeatEnd: boolean;
  doubleEnd: boolean;
  bracket?: string; // '1.', '2.'
  specialMark?: string; // 'segno', 'coda', 'fine', 'to_coda'
  sectionName?: string;
  rhythms: RhythmItem[];
  lyric: string;
}

export function compileGuitarDslToHtml(dslContent: string): string {
  const lines = dslContent.split(/\r?\n/);
  
  let title = 'Guitar Rhythm Score';
  let artist = '';
  let capo = '0';
  let originalKey = 'C';
  let bpm = '90';
  let memo = '';
  
  const measures: MeasureData[] = [];
  let currentSection = '';
  const usedChordsSet = new Set<string>();

  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Headers
    const headerMatch = line.match(/^(title|artist|capo|key|original_key|tempo|bpm|memo):\s*(.*)$/i);
    if (headerMatch) {
      const key = headerMatch[1].toLowerCase();
      const val = headerMatch[2].trim();
      if (key === 'title') title = val;
      else if (key === 'artist') artist = val;
      else if (key === 'capo') capo = val;
      else if (key === 'key' || key === 'original_key') originalKey = val;
      else if (key === 'bpm' || key === 'tempo') bpm = val;
      else if (key === 'memo') memo = val;
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
      const CHORD_REGEX = /^[A-G][b#]?(maj|m|min|aug|dim|sus[24]|add9|[0-9]+)*(\/[A-G][b#]?)?$/;
      const RHYTHM_REGEX = /^(16|8|4|2|1|w|h|q|r[a-z0-9]*)(\.[a-z]+)*$/;

      let bi = 0;
      while (bi < rawBars.length) {
        const cur = rawBars[bi];
        const next = rawBars[bi + 1];
        const curTokens = cur.replace(/^:+|:+$/g, '').trim().split(/\s+/).filter(Boolean);
        const isCurOnlyChord = curTokens.length === 1 && CHORD_REGEX.test(curTokens[0]);

        if (isCurOnlyChord && next) {
          const nextClean = next.replace(/l:\"[^\"]*\"/, '').trim();
          const nextTokens = nextClean.replace(/^:+|:+$/g, '').trim().split(/\s+/).filter(Boolean);
          const nextHasChord = nextTokens.some(t => CHORD_REGEX.test(t));
          const nextHasRhythm = nextTokens.some(t => RHYTHM_REGEX.test(t.split('.')[0]));

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
        let barChord = '';
        const rhythms: RhythmItem[] = [];

        for (const tok of tokens) {
          if (!tok || tok === ':' || tok === '|') continue;
          if (tok.match(CHORD_REGEX)) {
            barChord = tok;
            usedChordsSet.add(tok);
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
          }
        }

        measures.push({
          chord: barChord,
          repeatStart: rStart,
          repeatEnd: rEnd,
          doubleEnd: false,
          sectionName: currentSection,
          rhythms: rhythms.length > 0 ? rhythms : [
            { duration: '4', isRest: false, down: true, up: false, ghost: false, accent: false, tie: false },
            { duration: '4', isRest: false, down: false, up: false, ghost: false, accent: false, tie: false },
            { duration: '4', isRest: false, down: true, up: false, ghost: false, accent: false, tie: false },
            { duration: '4', isRest: false, down: false, up: false, ghost: false, accent: false, tie: false }
          ],
          lyric: mLyric
        });
        currentSection = ''; // consume section for the first bar
      }
    }
  }

  // Generate Chord Diagrams SVG
  let chordSvgs = '';
  for (const chord of Array.from(usedChordsSet)) {
    const frets = CHORD_LIBRARY[chord] || ['x', 'x', 'o', 2, 3, 2];
    chordSvgs += renderChordDiagram(chord, frets);
  }

  // Render Measures into Systems (4 measures per row)
  let systemsSvg = '';
  const measuresPerRow = 4;
  const sysWidth = 780;
  const barWidth = sysWidth / measuresPerRow;
  const sysHeight = 140;

  for (let i = 0; i < measures.length; i += measuresPerRow) {
    const rowMeasures = measures.slice(i, i + measuresPerRow);
    systemsSvg += renderSystemRow(rowMeasures, i === 0, barWidth, sysHeight, sysWidth);
  }

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${escapeXml(title)}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 12mm 14mm 12mm 14mm;
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
    padding: 20px;
    background: #f7f7f7;
  }
  .page-container {
    max-width: 840px;
    margin: 0 auto;
    background: #fff;
    padding: 24px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.1);
  }
  @media print {
    body { background: #fff; padding: 0; }
    .page-container { box-shadow: none; padding: 0; max-width: 100%; }
    .action-bar { display: none !important; }
  }
  .action-bar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 12px;
    gap: 10px;
  }
  .btn-print {
    background: #107c41;
    color: #fff;
    border: none;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: bold;
    border-radius: 4px;
    cursor: pointer;
  }
  .btn-print:hover { background: #0b5a2f; }

  /* Header */
  .score-header {
    border-bottom: 2px solid #000;
    padding-bottom: 6px;
    margin-bottom: 12px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .title-area h1 {
    font-size: 20pt;
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
<body>
  <div class="page-container">
    <div class="action-bar">
      <button class="btn-print" onclick="window.print()">A4印刷 / PDF保存</button>
    </div>

    <div class="score-header">
      <div class="title-area">
        <h1>${escapeXml(title)}</h1>
        <div class="meta">${artist ? 'Words & Music: ' + escapeXml(artist) : ''}</div>
      </div>
      <div class="play-info">
        <div>Key: ${escapeXml(originalKey)} ／ BPM: ${escapeXml(bpm)}</div>
        <div><span class="capo-badge">Capo: ${escapeXml(capo)}</span></div>
      </div>
    </div>

    ${chordSvgs ? `<div class="diagrams-row">${chordSvgs}</div>` : ''}

    <div class="score-sheet">
      ${systemsSvg}
    </div>
  </div>

  <script>
    window.addEventListener('message', event => {
      if (event.data && event.data.command === 'print') {
        window.print();
      }
    });
  </script>
</body>
</html>`;
}

function renderChordDiagram(name: string, frets: (number | 'x' | 'o')[]): string {
  // 6 strings: x coords 5, 13, 21, 29, 37, 45
  let circles = '';
  let topMarks = '';

  for (let s = 0; s < 6; s++) {
    const x = 5 + s * 8;
    const f = frets[s];
    if (f === 'x') {
      topMarks += `<text x="${x}" y="9" font-size="8" font-family="Arial" text-anchor="middle">×</text>`;
    } else if (f === 'o') {
      topMarks += `<circle cx="${x}" cy="7" r="2" fill="none" stroke="#000" stroke-width="0.8"/>`;
    } else if (typeof f === 'number' && f > 0) {
      const y = 14 + (f - 1) * 9 + 4.5;
      circles += `<circle cx="${x}" cy="${y}" r="3" fill="#000"/>`;
    }
  }

  return `
    <div class="diagram-box">
      <span class="diagram-name">${escapeXml(name)}</span>
      <svg width="42" height="50" viewBox="0 0 50 58">
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
        ${circles}
      </svg>
    </div>`;
}

function renderSystemRow(measures: MeasureData[], isFirst: boolean, barWidth: number, height: number, totalWidth: number): string {
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
        <rect x="${bx + 4}" y="2" width="${m.sectionName.length * 9 + 12}" height="14" fill="#fff" stroke="#000" stroke-width="1.2"/>
        <text x="${bx + 10}" y="13" font-family="Arial, sans-serif" font-size="9.5" font-weight="bold">${escapeXml(m.sectionName)}</text>
      `;
    }

    // Chord (placed clearly above picking marks: baseline at y = 33)
    if (m.chord) {
      barsSvg += `<text x="${bx + 8}" y="33" font-family="-apple-system, BlinkMacSystemFont, Arial, sans-serif" font-size="15" font-weight="900" fill="#000">${escapeXml(m.chord)}</text>`;
    }

    // Rhythms with duration calculation, Guitar Pro style slash heads, and beam grouping
    const midY = staveLines[2]; // 3rd line = 86
    const stemTopY = 60;

    // Helper: calculate beats from duration string
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
      barsSvg += `<text x="${bx + actualBarWidth / 2}" y="${staveLines[4] + 18}" font-family="-apple-system, BlinkMacSystemFont, 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif" font-size="10" text-anchor="middle" fill="#222">${escapeXml(m.lyric)}</text>`;
    }
  });

  return `
    <div class="system-row">
      <svg class="system-svg" viewBox="0 0 ${totalWidth} ${height}" xmlns="http://www.w3.org/2000/svg">
        ${staveSvg}
        ${clefSvg}
        ${barsSvg}
      </svg>
    </div>`;
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
