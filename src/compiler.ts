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

    // Measure line: | C | 4.d 4.d 4.d 4.d l:"..." |
    if (line.includes('|')) {
      const rawBars = line.split('|').map(s => s.trim()).filter(s => s.length > 0);
      for (const bar of rawBars) {
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
  const sysHeight = 120;

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
  const staveY = 55;
  const staveLines = [0, 8, 16, 24, 32].map(dy => staveY + dy);

  let staveSvg = '';
  staveLines.forEach(y => {
    staveSvg += `<line x1="25" y1="${y}" x2="${totalWidth - 5}" y2="${y}" stroke="#000" stroke-width="1"/>`;
  });
  staveSvg += `<line x1="25" y1="${staveLines[0]}" x2="25" y2="${staveLines[4]}" stroke="#000" stroke-width="2"/>`;

  let clefSvg = '';
  if (isFirst) {
    // Treble Clef
    clefSvg += `<path d="M 35,${staveY + 28} C 37,${staveY + 31} 41,${staveY + 31} 42,${staveY + 29} C 43,${staveY + 26} 41,${staveY + 24} 38,${staveY + 24} C 32,${staveY + 24} 29,${staveY + 15} 35,${staveY + 8} C 39,${staveY + 3} 44,${staveY + 7} 42,${staveY + 15} C 40,${staveY + 22} 30,${staveY + 20} 30,${staveY + 13} C 30,${staveY + 9} 33,${staveY + 7} 35,${staveY + 7} C 36,${staveY + 7} 37,${staveY + 8} 36,${staveY + 10} C 35,${staveY + 11} 34,${staveY + 11} 33,${staveY + 13} C 33,${staveY + 16} 38,${staveY + 16} 38,${staveY + 12} C 38,${staveY + 5} 29,${staveY} 36,${staveY - 13} C 39,${staveY - 19} 42,${staveY - 16} 41,${staveY - 10} C 39,${staveY + 3} 38,${staveY + 15} 38,${staveY + 29} C 38,${staveY + 39} 33,${staveY + 42} 29,${staveY + 38} C 27,${staveY + 36} 29,${staveY + 33} 31,${staveY + 34} C 33,${staveY + 35} 35,${staveY + 33} 34,${staveY + 30} Z" fill="#000"/>`;
    clefSvg += `<text x="50" y="${staveY + 14}" font-family="Arial" font-size="14" font-weight="bold">4</text>`;
    clefSvg += `<text x="50" y="${staveY + 30}" font-family="Arial" font-size="14" font-weight="bold">4</text>`;
  }

  let barsSvg = '';
  const startX = isFirst ? 65 : 25;
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

    // Section Label
    if (m.sectionName) {
      barsSvg += `
        <rect x="${bx + 4}" y="${staveY - 45}" width="${m.sectionName.length * 9 + 14}" height="18" fill="#fff" stroke="#000" stroke-width="1.2"/>
        <text x="${bx + 11}" y="${staveY - 32}" font-family="Arial" font-size="10" font-weight="bold">${escapeXml(m.sectionName)}</text>
      `;
    }

    // Chord
    if (m.chord) {
      barsSvg += `<text x="${bx + 8}" y="${staveY - 8}" font-family="Arial" font-size="14" font-weight="900">${escapeXml(m.chord)}</text>`;
    }

    // Rhythms
    const rCount = m.rhythms.length;
    const rStep = (actualBarWidth - 20) / (rCount > 0 ? rCount : 1);
    const midY = staveLines[2]; // 3rd line

    m.rhythms.forEach((r, rIdx) => {
      const rx = bx + 12 + rIdx * rStep;
      if (r.isRest) {
        // Simple quarter/eighth rest shape
        barsSvg += `<text x="${rx - 4}" y="${midY + 5}" font-family="Arial" font-size="14" font-weight="bold" fill="#333">𝄽</text>`;
      } else {
        const opacity = r.ghost ? '0.35' : '1.0';
        // Slash head
        barsSvg += `<polygon points="${rx-6},${midY+3} ${rx-3},${midY+5} ${rx+6},${midY-3} ${rx+3},${midY-5}" fill="#000" opacity="${opacity}"/>`;
        // Stem
        barsSvg += `<line x1="${rx+4}" y1="${midY-3}" x2="${rx+4}" y2="${midY-24}" stroke="#000" stroke-width="1.3" opacity="${opacity}"/>`;

        // Down / Up stroke
        if (r.down) {
          barsSvg += `<path d="M ${rx+1},${midY-28} L ${rx+1},${midY-33} L ${rx+7},${midY-33} L ${rx+7},${midY-28}" fill="none" stroke="#000" stroke-width="1.4" opacity="${opacity}"/>`;
        } else if (r.up) {
          barsSvg += `<path d="M ${rx+1},${midY-33} L ${rx+4},${midY-28} L ${rx+7},${midY-33}" fill="none" stroke="#000" stroke-width="1.4" opacity="${opacity}"/>`;
        }

        // Accent
        if (r.accent) {
          barsSvg += `<path d="M ${rx+1},${midY-37} L ${rx+7},${midY-35} L ${rx+1},${midY-33}" fill="none" stroke="#000" stroke-width="1.4"/>`;
        }
      }
    });

    // Lyric
    if (m.lyric) {
      barsSvg += `<text x="${bx + actualBarWidth / 2}" y="${staveLines[4] + 16}" font-family="sans-serif" font-size="9" text-anchor="middle" fill="#222">${escapeXml(m.lyric)}</text>`;
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
