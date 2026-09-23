import type { DiagnosticCode } from './compiler';

export type SupportedLocale = 'ja' | 'en';

export interface Messages {
  // Extension host messages
  msgOpenGuitarDslFile: string;
  msgDocNotFound: string;
  msgPdfSaved: (filename: string) => string;
  msgOpenFile: string;
  msgPdfFailed: (err: string) => string;
  dialogSavePdfTitle: string;
  previewTitle: string;

  // Webview Toolbar messages
  uiView: string;
  uiSinglePage: string;
  uiSinglePageTitle: string;
  uiSpread: string;
  uiSpreadTitle: string;
  uiWeb: string;
  uiWebTitle: string;
  uiPaper: string;
  uiPaperTitle: string;
  uiOrientation: string;
  uiPortrait: string;
  uiPortraitTitle: string;
  uiLandscape: string;
  uiLandscapeTitle: string;
  uiSavePdf: string;
  uiSavePdfTitle: string;
}

export const MESSAGES_JA: Messages = {
  msgOpenGuitarDslFile: 'GuitarDSL (.guitardsl) ファイルを開いてください。',
  msgDocNotFound: '対象のGuitarDSLドキュメントが見つかりません。',
  msgPdfSaved: (filename: string) => `PDFを保存しました: ${filename}`,
  msgOpenFile: 'ファイルを開く',
  msgPdfFailed: (err: string) => `PDF保存に失敗しました: ${err}`,
  dialogSavePdfTitle: 'GuitarDSL スコアをPDFとして保存',
  previewTitle: 'GuitarDSL スコアプレビュー',

  uiView: '表示',
  uiSinglePage: '1ページ',
  uiSinglePageTitle: '1ページ単位表示（縦スクロール）',
  uiSpread: '見開き',
  uiSpreadTitle: '見開き表示（2ページ横並び）',
  uiWeb: 'Web',
  uiWebTitle: 'Web表示（用紙枠なしシームレススクロール）',
  uiPaper: '用紙',
  uiPaperTitle: '用紙サイズ',
  uiOrientation: '向き',
  uiPortrait: '縦',
  uiPortraitTitle: '縦向き',
  uiLandscape: '横（見開き）',
  uiLandscapeTitle: '横向き（見開き印刷）',
  uiSavePdf: '📄 PDF保存',
  uiSavePdfTitle: '選択中の用紙サイズと向きでPDFを保存'
};

export const MESSAGES_EN: Messages = {
  msgOpenGuitarDslFile: 'Please open a GuitarDSL (.guitardsl) file.',
  msgDocNotFound: 'Target GuitarDSL document not found.',
  msgPdfSaved: (filename: string) => `PDF saved: ${filename}`,
  msgOpenFile: 'Open File',
  msgPdfFailed: (err: string) => `Failed to export PDF: ${err}`,
  dialogSavePdfTitle: 'Save GuitarDSL Score as PDF',
  previewTitle: 'GuitarDSL Score Preview',

  uiView: 'View',
  uiSinglePage: 'Single Page',
  uiSinglePageTitle: 'Single page view (vertical scroll)',
  uiSpread: 'Spread',
  uiSpreadTitle: 'Two-page spread view',
  uiWeb: 'Web',
  uiWebTitle: 'Continuous web view (seamless scroll)',
  uiPaper: 'Paper',
  uiPaperTitle: 'Paper size',
  uiOrientation: 'Orientation',
  uiPortrait: 'Portrait',
  uiPortraitTitle: 'Portrait orientation',
  uiLandscape: 'Landscape',
  uiLandscapeTitle: 'Landscape orientation (2-up spread)',
  uiSavePdf: '📄 Save PDF',
  uiSavePdfTitle: 'Save score as PDF with selected paper size and orientation'
};

export function resolveLocale(vscodeLang?: string): SupportedLocale {
  if (!vscodeLang) {
    return 'en';
  }
  const lower = vscodeLang.toLowerCase().trim();
  if (lower === 'ja' || lower.startsWith('ja-') || lower.startsWith('ja_')) {
    return 'ja';
  }
  return 'en';
}

export function getMessages(locale: SupportedLocale): Messages {
  return locale === 'ja' ? MESSAGES_JA : MESSAGES_EN;
}

type DiagnosticArgs = Record<string, string | number>;
type DiagnosticTemplates = Record<DiagnosticCode, (a: DiagnosticArgs) => string>;

const DIAGNOSTICS_JA: DiagnosticTemplates = {
  upperCaseNoteName: a => `メロディの音名は小文字で書いてください: ${a.token}`,
  invalidMelodyNote: a => `メロディの音符として解釈できません: ${a.token}`,
  invalidLength: a => `長さの指定が不正です: ${a.token}（\`/\` の後は音価 1・2・4・8・16 と . t +、\`:\` の後は拍数）`,
  missingInitialOctaveOrLength: a => `mel: 行の最初の音符にはオクターブと長さが必要です: ${a.token}`,
  tooManyMelodyMeasures: () => 'メロディを割り当てる小節がありません（mel: のセル数が小節数を超えています）',
  melodyRepeatWithoutPrevious: () => '% で繰り返す直前の小節にメロディがありません',
  lyricsWithoutMelody: () => 'lyr: の前に対応する mel: 行がありません',
  beatCountMismatch: a => `小節の長さが4拍ではありません（${a.beats}拍）`,
  syllableCountMismatch: a => `歌詞の音節数（${a.syllables}）と歌う音符の数（${a.notes}）が一致しません`,
  lyricBarMismatch: () => '歌詞の | の位置がメロディの小節区切りと一致しません',
  measureLyricWithMelody: () => 'メロディのある小節の l:"..." は表示されません（lyr: を使ってください）',
  invalidMeasuresPerRow: a => `measures_per_row は 1〜8 の整数で指定してください: ${a.value}`
};

const DIAGNOSTICS_EN: DiagnosticTemplates = {
  upperCaseNoteName: a => `Melody note names must be lowercase: ${a.token}`,
  invalidMelodyNote: a => `Not a valid melody note: ${a.token}`,
  invalidLength: a => `Invalid length: ${a.token} (after \`/\` use a note value 1, 2, 4, 8, 16 with . t +; after \`:\` use a beat count)`,
  missingInitialOctaveOrLength: a => `The first note of a mel: line needs an octave and a length: ${a.token}`,
  tooManyMelodyMeasures: () => 'No measure left for this melody cell (the mel: line has more cells than measures)',
  melodyRepeatWithoutPrevious: () => 'The measure before % has no melody to repeat',
  lyricsWithoutMelody: () => 'lyr: line has no preceding mel: line',
  beatCountMismatch: a => `Measure length is not 4 beats (${a.beats} beats)`,
  syllableCountMismatch: a => `Syllable count (${a.syllables}) does not match the sung notes (${a.notes})`,
  lyricBarMismatch: () => 'The | positions in the lyrics do not match the melody measures',
  measureLyricWithMelody: () => 'l:"..." is not shown in a measure with a melody (use lyr:)',
  invalidMeasuresPerRow: a => `measures_per_row must be an integer from 1 to 8: ${a.value}`
};

export function formatDiagnostic(code: DiagnosticCode, args: DiagnosticArgs | undefined, locale: SupportedLocale): string {
  const templates = locale === 'ja' ? DIAGNOSTICS_JA : DIAGNOSTICS_EN;
  return templates[code](args ?? {});
}
