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

      for (const bar of bars) {
        if (bar === ':' || bar === '') continue;

        let mLyric = '';
        let cleanBar = bar;

        // Extract l:"..."
        const lyricMatch = cleanBar.match(/l:\"([^\"]*)\"/);
        if (lyricMatch) {
          mLyric = lyricMatch[1];
          cleanBar = cleanBar.replace(/l:\"([^\"]*)\"/, '').trim();
        }

        const tokens = cleanBar.split(/\s+/);
        let barChord = '';
        const rhythms: RhythmItem[] = [];
        let rStart = bar.startsWith(':') || rawLine.includes('|:');
        let rEnd = bar.endsWith(':') || rawLine.includes(':|');

        for (const tok of tokens) {
          if (!tok) continue;
          if (tok.match(/^[A-G][b#]?(maj|m|min|aug|dim|sus[24]|add9|[0-9]+)*(\/[A-G][b#]?)?$/)) {
            barChord = tok;
            usedChordsSet.add(tok);
          } else if (tok.match(/^(\[[12]\.\])$/)) {
            // brackets like [1.] or [2.]
          } else {
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

  let clefSvg = '';
  if (isFirst) {
    // Elegant, standard Treble Clef centered around G-line (staveLines[3] = 94)
    clefSvg += `<g transform="translate(28, 52) scale(0.537)">
      <path d="M11.35,45.61q3.72-4.22,7.69-8a45.71,45.71,0,0,1-2.19-12c-.23-7.24.88-14.93,5-21C23,2.79,25-.25,27.17,0,29,.24,30,2.83,30.72,4.32c4.92,10,5.93,20.54.25,31.93a46,46,0,0,1-7.84,10.8l2.38,12.12a8.74,8.74,0,0,1,.87-.14,14.2,14.2,0,0,1,8.56,1.41c5.6,3,9.08,10.57,8.52,16.83-.5,5.5-3,9.3-7.15,12.63a23.92,23.92,0,0,1-4.24,2.78l2.87,14.62a28.07,28.07,0,0,1,.12,3.74c-.35,7.71-6.35,12.16-13.78,11.82-5.72-.36-11.67-4.9-11.7-10.64-.06-11.13,15-10.6,13.9-.42-.32,3-2.51,5.65-7.21,5.82,3.79,6.28,15.51,1.79,16.31-6.44a17.52,17.52,0,0,0-.69-6.24L29.72,93.65a17.7,17.7,0,0,1-3.07.67A23.71,23.71,0,0,1,8.5,88.66a26,26,0,0,1-8-24.34C2,56.69,6.39,51.26,11.35,45.61Zm9.81-9.53C19.09,28.55,19.4,19,24.73,12.76S35.94,15,28.18,27.42a48.8,48.8,0,0,1-7,8.66Zm0,13c-.67.67-1.36,1.34-2.06,2-4,3.85-8,7.52-11,13a20.65,20.65,0,0,0-1.5,17.23c2.4,7.49,14,12.21,22.65,9.94L24.72,67.63a9.82,9.82,0,0,0-7.09,8,8.7,8.7,0,0,0,3.08,7.81,16.74,16.74,0,0,0,1.81,1.36c1.24.82.63,1.41-.53,1.06-3.87-1.3-6.19-3.44-7.43-6.17-3.67-8.08.83-17.08,8.66-19.92L21.16,49.07ZM31.63,90.43,27.09,67.24a9,9,0,0,1,4.53,1,12,12,0,0,1,6.62,8.23c1.2,5.57-1.7,11.72-6.49,13.94l-.12.05Z" fill="#000"/>
    </g>`;
    clefSvg += `<text x="58" y="${staveY + 14}" font-family="Arial, sans-serif" font-size="14" font-weight="bold">4</text>`;
    clefSvg += `<text x="58" y="${staveY + 30}" font-family="Arial, sans-serif" font-size="14" font-weight="bold">4</text>`;
  }

  let barsSvg = '';
  const startX = isFirst ? 78 : 25;
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

    // Section Label (placed at the top: y = 6 to 22)
    if (m.sectionName) {
      barsSvg += `
        <rect x="${bx + 4}" y="6" width="${m.sectionName.length * 9 + 14}" height="16" fill="#fff" stroke="#000" stroke-width="1.2"/>
        <text x="${bx + 11}" y="18" font-family="Arial, sans-serif" font-size="10" font-weight="bold">${escapeXml(m.sectionName)}</text>
      `;
    }

    // Chord (placed clearly above picking marks: baseline at y = 42)
    if (m.chord) {
      barsSvg += `<text x="${bx + 8}" y="42" font-family="-apple-system, BlinkMacSystemFont, Arial, sans-serif" font-size="15" font-weight="900" fill="#000">${escapeXml(m.chord)}</text>`;
    }

    // Rhythms
    const rCount = m.rhythms.length;
    const rStep = (actualBarWidth - 20) / (rCount > 0 ? rCount : 1);
    const midY = staveLines[2]; // 3rd line = 86

    m.rhythms.forEach((r, rIdx) => {
      const rx = bx + 12 + rIdx * rStep;
      if (r.isRest) {
        // Quarter/eighth rest shape
        barsSvg += `<text x="${rx - 4}" y="${midY + 5}" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#333">𝄽</text>`;
      } else {
        const opacity = r.ghost ? '0.35' : '1.0';
        // Slash head centered around midY (86)
        barsSvg += `<polygon points="${rx-6},${midY+4} ${rx-3},${midY+6} ${rx+6},${midY-3} ${rx+3},${midY-5}" fill="#000" opacity="${opacity}"/>`;
        // Stem (from y=62 to y=midY-3=83)
        barsSvg += `<line x1="${rx+4}" y1="62" x2="${rx+4}" y2="${midY-3}" stroke="#000" stroke-width="1.3" opacity="${opacity}"/>`;

        // Down / Up stroke mark (placed at y=52 to 57, above stem y=62, below chord y=42)
        const py = 52;
        if (r.down) {
          barsSvg += `<path d="M ${rx+1},${py+5} L ${rx+1},${py} L ${rx+7},${py} L ${rx+7},${py+5}" fill="none" stroke="#000" stroke-width="1.4" opacity="${opacity}"/>`;
        } else if (r.up) {
          barsSvg += `<path d="M ${rx+1},${py} L ${rx+4},${py+5} L ${rx+7},${py}" fill="none" stroke="#000" stroke-width="1.4" opacity="${opacity}"/>`;
        }

        // Accent (placed at y=46 to 51)
        const ay = 46;
        if (r.accent) {
          barsSvg += `<path d="M ${rx+1},${ay} L ${rx+7},${ay+3} L ${rx+1},${ay+6}" fill="none" stroke="#000" stroke-width="1.4"/>`;
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
