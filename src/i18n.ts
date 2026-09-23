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

const CHORD_DEF_REASON_JA: Record<string, string> = {
  syntax: '`chord <名前>[@<ラベル>] = <フレット>` の形で書いてください',
  name: 'コード名',
  label: 'ラベルは英数字と _ のみ',
  frets: 'フレットは6弦から1弦の順に6つ（x / o / 数字、2桁はカンマ区切り）',
  base: 'base は 1〜24',
  fingers: 'fingers は6文字（- / 1〜4 / T）',
  barre: 'barre のフレットまたは弦の範囲',
  option: '不明なオプション',
  span: '押弦位置が表示範囲（5フレット）に収まりません'
};

const CHORD_DEF_REASON_EN: Record<string, string> = {
  syntax: 'write `chord <name>[@<label>] = <frets>`',
  name: 'chord name',
  label: 'labels use letters, digits and _ only',
  frets: 'six frets from the 6th string (x / o / digits, comma-separated for two digits)',
  base: 'base must be 1-24',
  fingers: 'fingers needs six characters (- / 1-4 / T)',
  barre: 'barre fret or string range',
  option: 'unknown option',
  span: 'the fretted notes do not fit in the 5-fret window'
};

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
  invalidMeasuresPerRow: a => `measures_per_row は 1〜8 の整数で指定してください: ${a.value}`,
  invalidChordDefinition: a => `コード定義が不正です（${CHORD_DEF_REASON_JA[a.reason] ?? a.reason}）: ${a.detail}`,
  duplicateChordDefinition: a => `コード ${a.chord} は既に定義されています（最初の定義が使われます）`,
  unknownChordVariant: a => `コード ${a.chord} の定義がありません（ラベルなしのダイアグラムで表示します）`
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
  invalidMeasuresPerRow: a => `measures_per_row must be an integer from 1 to 8: ${a.value}`,
  invalidChordDefinition: a => `Invalid chord definition (${CHORD_DEF_REASON_EN[a.reason] ?? a.reason}): ${a.detail}`,
  duplicateChordDefinition: a => `Chord ${a.chord} is already defined (the first definition is used)`,
  unknownChordVariant: a => `Chord ${a.chord} is not defined (the unlabeled diagram is shown)`
};

export function formatDiagnostic(code: DiagnosticCode, args: DiagnosticArgs | undefined, locale: SupportedLocale): string {
  const templates = locale === 'ja' ? DIAGNOSTICS_JA : DIAGNOSTICS_EN;
  return templates[code](args ?? {});
}

export function formatChordDefinitionError(reason: string, detail: string, locale: SupportedLocale): string {
  return formatDiagnostic('invalidChordDefinition', { reason, detail }, locale);
}

/** Chord diagram editor (webview + entry points). Keys prefixed with help_ are looked up by tool name. */
export interface ChordEditorMessages {
  panelTitle: string;
  presets: string;
  root: string;
  quality: string;
  name: string;
  label: string;
  labelPlaceholder: string;
  baseFret: string;
  toolFret: string;
  toolFinger: string;
  toolBarre: string;
  help_fret: string;
  help_finger: string;
  help_barre: string;
  fingerNone: string;
  clear: string;
  detected: string;
  dslLine: string;
  preview: string;
  save: string;
  saveAsNew: string;
  close: string;
  noPresets: string;
  editingNew: string;
  editingExisting: (line: number) => string;
  saved: (key: string) => string;
  duplicate: (key: string) => string;
  codeLens: string;
  pickPlaceholder: string;
  pickDefined: string;
  pickUsed: string;
  pickNew: string;
  newNamePrompt: string;
  invalidName: string;
}

export const CHORD_EDITOR_JA: ChordEditorMessages = {
  panelTitle: 'コードダイアグラム編集',
  presets: 'プリセット',
  root: 'ルート',
  quality: 'タイプ',
  name: 'コード名',
  label: 'ラベル',
  labelPlaceholder: '空欄 = デフォルト',
  baseFret: '開始フレット',
  toolFret: '押弦',
  toolFinger: '指番号',
  toolBarre: 'セーハ',
  help_fret: 'マスをクリックで押弦／解除。上の ○ × をクリックで開放⇔ミュート。',
  help_finger: '指を選んでから押弦位置をクリック。',
  help_barre: '同じフレットの2本の弦を順にクリック。セーハをクリックすると解除。',
  fingerNone: '消去',
  clear: 'クリア',
  detected: '自動判定',
  dslLine: 'DSL',
  preview: 'プレビュー',
  save: '保存',
  saveAsNew: '別バリエーションとして保存',
  close: '閉じる',
  noPresets: 'プリセットがありません',
  editingNew: '新規定義',
  editingExisting: (line: number) => `${line} 行目の定義を編集中`,
  saved: (key: string) => `chord ${key} を保存しました`,
  duplicate: (key: string) => `${key} は既に定義されています（ラベルを変えてください）`,
  codeLens: 'ダイアグラムを編集',
  pickPlaceholder: '編集するコードダイアグラムを選択',
  pickDefined: 'ファイル内の定義',
  pickUsed: '使用中（未定義）',
  pickNew: '新規作成…',
  newNamePrompt: 'コード名（例: C, Am7, C@barre）',
  invalidName: 'コード名として解釈できません'
};

export const CHORD_EDITOR_EN: ChordEditorMessages = {
  panelTitle: 'Chord Diagram Editor',
  presets: 'Presets',
  root: 'Root',
  quality: 'Type',
  name: 'Chord name',
  label: 'Label',
  labelPlaceholder: 'empty = default',
  baseFret: 'Start fret',
  toolFret: 'Fret',
  toolFinger: 'Finger',
  toolBarre: 'Barre',
  help_fret: 'Click a cell to fret / unfret. Click ○ × above the nut to toggle open / muted.',
  help_finger: 'Pick a finger, then click a fretted note.',
  help_barre: 'Click two strings on the same fret. Click a barre to remove it.',
  fingerNone: 'Clear',
  clear: 'Clear',
  detected: 'Detected',
  dslLine: 'DSL',
  preview: 'Preview',
  save: 'Save',
  saveAsNew: 'Save as New Variant',
  close: 'Close',
  noPresets: 'No presets',
  editingNew: 'New definition',
  editingExisting: (line: number) => `Editing the definition on line ${line}`,
  saved: (key: string) => `Saved chord ${key}`,
  duplicate: (key: string) => `${key} is already defined (use another label)`,
  codeLens: 'Edit Diagram',
  pickPlaceholder: 'Select a chord diagram to edit',
  pickDefined: 'Defined in this file',
  pickUsed: 'Used (not defined)',
  pickNew: 'New…',
  newNamePrompt: 'Chord name (e.g. C, Am7, C@barre)',
  invalidName: 'Not a valid chord name'
};

export function getChordEditorMessages(locale: SupportedLocale): ChordEditorMessages {
  return locale === 'ja' ? CHORD_EDITOR_JA : CHORD_EDITOR_EN;
}
