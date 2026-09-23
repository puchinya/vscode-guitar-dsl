// Preset strumming and arpeggio patterns and DSL rhythm replacement utilities.

export interface StrummingPatternPreset {
  id: string;
  category: '8beat' | '16beat' | '4beat' | 'triplet' | 'ballad' | 'arpeggio';
  nameJa: string;
  nameEn: string;
  descriptionJa: string;
  descriptionEn: string;
  pattern: string;
}

export const STRUMMING_PATTERN_PRESETS: StrummingPatternPreset[] = [
  // --- 8ビート系 ---
  {
    id: '8beat_standard',
    category: '8beat',
    nameJa: '王道8ビート A (疾走・ポップス・ロック)',
    nameEn: 'Standard 8-Beat A (Rock/Pop)',
    descriptionJa: 'ジャン ジャカ ジャカ ジャン（アコギ弾き語りの最重要パターン）',
    descriptionEn: 'Down, Down-Up, Down-Up, Down',
    pattern: '4.d 8.d 8.u 8.d 8.u 4.d'
  },
  {
    id: '8beat_basic',
    category: '8beat',
    nameJa: '王道8ビート B (基本ポップス)',
    nameEn: 'Standard 8-Beat B (Basic Pop)',
    descriptionJa: 'ジャン ジャン ジャカ ジャカ（初心者からプロまで定番）',
    descriptionEn: 'Down, Down, Down-Up, Down-Up',
    pattern: '4.d 4.d 8.d 8.u 8.d 8.u'
  },
  {
    id: '8beat_alternate',
    category: '8beat',
    nameJa: '8ビート均等オルタネイト',
    nameEn: '8-Beat Continuous Alternate',
    descriptionJa: 'ジャカ ジャカ ジャカ ジャカ（8ビートフルストローク）',
    descriptionEn: 'Continuous down-up 8th notes',
    pattern: '8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u'
  },
  {
    id: '8beat_syncopated',
    category: '8beat',
    nameJa: '8ビート・シンコペーション (軽快タイ)',
    nameEn: '8-Beat Syncopated',
    descriptionJa: 'タイで2拍目裏と3拍目をつなぐ軽快でノリの良い8ビート',
    descriptionEn: 'Syncopated 8-beat tied across beat 2 & 3',
    pattern: '4.d 8.d 8.u 4.u 8.d 8.u'
  },
  {
    id: '8beat_accent',
    category: '8beat',
    nameJa: '8ビート・スネア強調 (2拍・4拍アクセント)',
    nameEn: '8-Beat Snare Accent (2 & 4)',
    descriptionJa: '2拍目と4拍目にアクセントを効かせたタイトなリズム',
    descriptionEn: '8th notes with strong accents on beats 2 and 4',
    pattern: '8.d 8.u 8.d.a 8.u 8.d 8.u 8.d.a 8.u'
  },
  {
    id: '8beat_country',
    category: '8beat',
    nameJa: 'カントリー・フォーク (ブン チャカ ブン チャカ)',
    nameEn: 'Country / Folk Alternating',
    descriptionJa: '低音弦ダウンから軽快に刻むカントリー・フォーク定番',
    descriptionEn: 'Boom-chicka bass-strum folk feel',
    pattern: '4.d 8.d 8.u 4.d 8.d 8.u'
  },

  // --- 16ビート系 ---
  {
    id: '16beat_standard',
    category: '16beat',
    nameJa: '王道16ビート A (定番ポップス・ファンク)',
    nameEn: 'Standard 16-Beat A (Pop/Funk)',
    descriptionJa: 'ジャン ジャ・ジャカ ジャカ ジャカ（洗練されたポップスリズム）',
    descriptionEn: 'Standard 16-beat pop strumming',
    pattern: '4.d 8.d 16.d 16.u 8.d 8.u 8.d 8.u'
  },
  {
    id: '16beat_cutting',
    category: '16beat',
    nameJa: '16ビート・カッティング (細やか刻み)',
    nameEn: '16-Beat Cutting / Dance',
    descriptionJa: '細やかな16分音符のオルタネイトカッティング',
    descriptionEn: 'Continuous 16th-note strumming',
    pattern: '16.d 16.u 16.d 16.u 16.d 16.u 16.d 16.u 16.d 16.u 16.d 16.u 16.d 16.u 16.d 16.u'
  },
  {
    id: '16beat_syncopated',
    category: '16beat',
    nameJa: '16ビート・シンコペーション (R&B / シティポップ)',
    nameEn: '16-Beat Syncopated (R&B / City Pop)',
    descriptionJa: 'ノルーヴ感あふれる現代的な16ビート',
    descriptionEn: 'Groovy syncopated 16th rhythm',
    pattern: '8.d 16.d 16.u 8.u 16.d 16.u 8.d 16.d 16.u 8.u 16.d 16.u'
  },
  {
    id: '16beat_ballad',
    category: '16beat',
    nameJa: '16ビート・バラード',
    nameEn: '16-Beat Ballad',
    descriptionJa: 'ゆったりしたテンポで情感豊かに響かせる16ビート',
    descriptionEn: 'Slow, expressive 16-beat ballad strum',
    pattern: '4.d 8.d 16.d 16.u 4.d 8.d 16.d 16.u'
  },

  // --- 4ビート系 ---
  {
    id: 'four_beat_down',
    category: '4beat',
    nameJa: '4分音符ダウン (力強い基本刻み)',
    nameEn: '4-Beat Quarter Down',
    descriptionJa: '4分音符ダウン×4。素朴なフォークソングや力強いビート',
    descriptionEn: 'Solid quarter note downstrokes',
    pattern: '4.d 4.d 4.d 4.d'
  },
  {
    id: 'four_beat_accent',
    category: '4beat',
    nameJa: '4ビート・2拍4拍アクセント',
    nameEn: '4-Beat 2 & 4 Accent',
    descriptionJa: '2拍・4拍を強めにダウンする4ビート',
    descriptionEn: 'Quarter notes emphasizing beats 2 and 4',
    pattern: '4.d 4.d.a 4.d 4.d.a'
  },

  // --- 3連符・スローロック系 ---
  {
    id: 'triplet_slow_rock',
    category: 'triplet',
    nameJa: 'スローロック / ハチロク (6/8風 3連シャッフル)',
    nameEn: 'Slow Rock / 6/8 Triplet Shuffle',
    descriptionJa: 'タッカタッカと跳ねる3連符シャッフルストローク',
    descriptionEn: 'Triplet shuffle slow rock feel (4t.d 8t.u)',
    pattern: '4t.d 8t.u 4t.d 8t.u 4t.d 8t.u 4t.d 8t.u'
  },
  {
    id: 'triplet_sixteen',
    category: 'triplet',
    nameJa: '3連符ストローク (1拍3連×4刻み)',
    nameEn: 'Continuous 8th Triplets',
    descriptionJa: '1小節に12打の3連符ストローク',
    descriptionEn: '12-pulse triplet strum',
    pattern: '8t.d 8t.u 8t.d 8t.d 8t.u 8t.d 8t.d 8t.u 8t.d 8t.d 8t.u 8t.d'
  },

  // --- バラード・持続系 ---
  {
    id: 'ballad_whole',
    category: 'ballad',
    nameJa: '全音符白玉 (ジャーンと1小節伸ばす)',
    nameEn: 'Whole Note Sustained',
    descriptionJa: '1小節に1回コードをジャーンと鳴らす（イントロや静かなAメロ）',
    descriptionEn: 'Single full-measure whole note strum',
    pattern: '1.d'
  },
  {
    id: 'ballad_half',
    category: 'ballad',
    nameJa: '2分音符白玉 (ジャーン・ジャーン)',
    nameEn: 'Half Notes Sustained',
    descriptionJa: '2拍ごとにゆったり鳴らす（バラードやブリッジ）',
    descriptionEn: 'Two half notes per measure',
    pattern: '2.d 2.d'
  },

  // --- アルペジオ系 ---
  {
    id: 'arpeggio_8beat',
    category: 'arpeggio',
    nameJa: '8分音符アルペジオ (王道分散和音)',
    nameEn: '8th-Note Arpeggio',
    descriptionJa: 'ポロン・ポロン・ポロン・ポロン（弾き語りの定番指弾き・アルペジオ）',
    descriptionEn: 'Standard 8th-note fingerpicking arpeggio',
    pattern: '8 8 8 8 8 8 8 8'
  },
  {
    id: 'arpeggio_triplet',
    category: 'arpeggio',
    nameJa: '3連符アルペジオ (スローロック・分散和音)',
    nameEn: 'Triplet Arpeggio (Slow Rock / 6/8)',
    descriptionJa: '1拍3連×4（6/8風バラードやスローロックの定番アルペジオ）',
    descriptionEn: '12-note triplet fingerpicking pattern',
    pattern: '8t 8t 8t 8t 8t 8t 8t 8t 8t 8t 8t 8t'
  },
  {
    id: 'arpeggio_16beat',
    category: 'arpeggio',
    nameJa: '16分音符アルペジオ (フィンガーピッキング)',
    nameEn: '16th-Note Fingerpicking / Travis',
    descriptionJa: '細やかなフィンガーピッキング・スリーフィンガー風',
    descriptionEn: 'Fast 16th-note fingerpicking pattern',
    pattern: '16 16 16 16 16 16 16 16 16 16 16 16 16 16 16 16'
  },
  {
    id: 'arpeggiato_whole',
    category: 'arpeggio',
    nameJa: '波線アルペジオ奏法 (Arpeggiato 全音符)',
    nameEn: 'Arpeggiato Whole Note (Rolled Chord)',
    descriptionJa: 'コードを下から上へポロロ〜ンと爪弾き1小節伸ばす（波線記号付き）',
    descriptionEn: 'Arpeggiato rolled whole note with wavy sign',
    pattern: '1.arp'
  },
  {
    id: 'arpeggiato_half',
    category: 'arpeggio',
    nameJa: '波線アルペジオ奏法 (Arpeggiato 2分音符)',
    nameEn: 'Arpeggiato Half Notes (Rolled Chords)',
    descriptionJa: '2拍ごとにポロロ〜ンと爪弾く（波線記号付き）',
    descriptionEn: 'Two rolled half notes per measure',
    pattern: '2.arp 2.arp'
  }
];

export function getPresetById(id: string): StrummingPatternPreset | undefined {
  return STRUMMING_PATTERN_PRESETS.find(p => p.id === id);
}

/**
 * Replaces the rhythm tokens in a single GuitarDSL measure line with newRhythmPattern.
 * Preserves chords, barlines (|:, :|, ||, |]), brackets ([1.], [2.]), special marks, and lyrics (l:"...").
 */
export function replaceMeasureLineRhythm(line: string, newRhythmPattern: string): string {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return line;

  // Split line by '|'
  const rawParts = line.split('|');
  if (rawParts.length < 2) return line;

  // We want to handle format:
  // '| chords | rhythm |'
  // '| chords | rhythm l:"..." |'
  // '| % |' -> '| % | newRhythm |'
  // '| chords | % |' -> '| chords | newRhythm |'

  const firstBar = rawParts[0]; // e.g. "" or "  "
  const lastBar = rawParts[rawParts.length - 1]; // e.g. "" or "  "

  const cells = rawParts.slice(1, rawParts.length - 1);

  if (cells.length === 1) {
    // Single cell: '| chords rhythm |' or '| % |'
    const cell = cells[0];
    const lyricMatch = cell.match(/l:\"([^\"]*)\"/);
    const lyric = lyricMatch ? ` l:"${lyricMatch[1]}"` : '';
    const cleanCell = cell.replace(/l:\"[^\"]*\"/, '').trim();

    // Check if repeat
    if (cleanCell === '%') {
      return `${firstBar}| % | ${newRhythmPattern}${lyric} |${lastBar}`;
    }

    // Try to extract chords
    // Chord token pattern
    const tokens = cleanCell.split(/\s+/).filter(Boolean);
    const chords: string[] = [];
    for (const t of tokens) {
      if (/^[A-G][b#]?(?:m|maj|min|dim|aug|sus[24]|add9|[0-9])*(?:\/[A-G][b#]?)?(?:@[A-Za-z0-9_]+)?(?::[0-9.]+|\/[0-9.t+]+)?$/.test(t)) {
        chords.push(t);
      } else {
        break;
      }
    }

    if (chords.length > 0) {
      return `${firstBar}| ${chords.join(' ')} | ${newRhythmPattern}${lyric} |${lastBar}`;
    } else {
      return `${firstBar}| % | ${newRhythmPattern}${lyric} |${lastBar}`;
    }
  } else if (cells.length >= 2) {
    // Standard format: cell 0 is chords, cell 1 is rhythm
    const chordCell = cells[0];
    const rhythmCell = cells[1];

    const lyricMatch = rhythmCell.match(/l:\"([^\"]*)\"/);
    const lyric = lyricMatch ? ` l:"${lyricMatch[1]}"` : '';

    const hasColonStart = rhythmCell.trim().startsWith(':');
    const hasColonEnd = rhythmCell.trim().endsWith(':');
    const colonStart = hasColonStart ? ': ' : '';
    const colonEnd = hasColonEnd ? ' :' : '';

    const chordHasBracket = /\[([0-9]+[.,\-0-9]*)\]/.test(chordCell);
    const rhythmBracketMatch = rhythmCell.match(/\[([0-9]+[.,\-0-9]*)\]/);
    const bracket = (!chordHasBracket && rhythmBracketMatch) ? `${rhythmBracketMatch[0]} ` : '';

    const rightPad = hasColonEnd ? '' : ' ';
    cells[1] = ` ${colonStart}${bracket}${newRhythmPattern}${lyric}${colonEnd}${rightPad}`;

    return `${firstBar}|${cells.join('|')}|${lastBar}`;
  }

  return line;
}

/**
 * Replaces the rhythm in a GuitarDSL document.
 * If sectionName is provided, only replaces measures within that section.
 */
export function replaceRhythmInDsl(
  dslText: string,
  newRhythmPattern: string,
  options?: { sectionName?: string }
): string {
  const lines = dslText.split(/\r?\n/);
  const targetSection = options?.sectionName?.trim();
  let inTargetSection = targetSection === undefined; // If no section specified, match all

  const resultLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Check section header
    const sectionMatch = trimmed.match(/^\[(.*)\]$/);
    if (sectionMatch) {
      const sec = sectionMatch[1].trim();
      if (targetSection !== undefined) {
        inTargetSection = sec === targetSection;
      }
      resultLines.push(rawLine);
      continue;
    }

    // Skip comment, header, melody, lyrics, chord definitions, page breaks
    if (
      !inTargetSection ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('mel:') ||
      trimmed.startsWith('lyr:') ||
      trimmed.startsWith('chord ') ||
      trimmed.startsWith('---') ||
      /^pagebreak$/i.test(trimmed) ||
      !trimmed.includes('|')
    ) {
      resultLines.push(rawLine);
      continue;
    }

    // Replace rhythm in measure line
    resultLines.push(replaceMeasureLineRhythm(rawLine, newRhythmPattern));
  }

  return resultLines.join('\n');
}
