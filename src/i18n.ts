import type { DiagnosticCode } from './compiler';
import type { AudioMirErrorCode } from './audioMir/model';
import type { BeginnerFailureCode } from './beginnerMode';
import type { CapoTransformFailureCode, PlayabilityLevel } from './capo';

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

  // Capo / playability (preview toolbar, score settings editor, host notifications)
  uiCapo: string;
  uiCapoTitle: string;
  uiPlayability: string;
  uiPlayabilityUnavailable: string;
  uiRecommended: string;
  uiCapoPreviewOnly: string;
  uiApplyToDsl: string;
  uiApplyToDslTitle: string;
  uiEditCapo: string;
  uiEditCapoTitle: string;
  playabilityLevels: Record<PlayabilityLevel, string>;
  capoFailures: Record<CapoTransformFailureCode, string>;
  msgCapoOverrideReset: (reason: string) => string;
  msgCapoApplied: (capo: number) => string;
  msgCapoApplyFailed: (reason: string) => string;
  msgCapoEditRejected: string;
  msgCapoUnusedDefinitions: (keys: string) => string;

  // Beginner Mode (preview capo bar, score settings editor, host notifications)
  uiBeginnerMode: string;
  uiBeginnerModeTitle: string;
  uiBeginnerOn: string;
  uiBeginnerOff: string;
  uiBarreChords: string;
  uiBarreAllow: string;
  uiBarreForbid: string;
  uiBarreTitle: string;
  uiBeginnerAuto: string;
  uiBeginnerSubstitutions: string;
  beginnerFailure: (code: BeginnerFailureCode, detail?: string) => string;
  msgBeginnerReset: (reason: string) => string;
  msgBeginnerApplied: (capo: number, substitutions: number) => string;
  msgBeginnerApplyFailed: (reason: string) => string;

  // YouTube transcription messages
  msgPromptApiKey: string;
  msgApiKeySaved: string;
  msgApiKeyCleared: string;
  msgPromptYouTubeUrl: string;
  msgYouTubeUrlPlaceholder: string;
  msgInvalidYouTubeUrl: string;
  msgTranscribingProgress: string;

  // Local Audio MIR transcription messages
  audioMirDialogTitle: string;
  audioMirWavFilter: string;
  audioMirProgress: string;
  audioMirBusy: string;
  audioMirUnsupportedEnvironment: string;
  audioMirFileTooLarge: string;
  audioMirInvalidResult: string;
  audioMirErrors: Record<AudioMirErrorCode, string>;
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
  uiSavePdfTitle: '選択中の用紙サイズと向きでPDFを保存',

  uiCapo: 'カポ',
  uiCapoTitle: 'プレビューとPDFだけカポ位置を変えて表示（DSLは変更しません）',
  uiPlayability: '弾きやすさ',
  uiPlayabilityUnavailable: '評価できません',
  uiRecommended: '推奨',
  uiCapoPreviewOnly: 'プレビューのみ',
  uiApplyToDsl: 'DSLに適用',
  uiApplyToDslTitle: '選択中のカポ位置とコード名をDSLに書き込みます（元に戻す可能）',
  uiEditCapo: '編集…',
  uiEditCapoTitle: 'カポ / 弾きやすさの編集パネルを開く',
  playabilityLevels: {
    veryEasy: 'とても簡単',
    easy: '簡単',
    moderate: '普通',
    hard: '難しい',
    veryHard: 'とても難しい'
  },
  capoFailures: {
    sourceParseError: 'DSLにエラーがあります',
    invalidSourceCapo: 'capo: の値が 0〜12 の整数ではありません',
    invalidTargetCapo: 'カポ位置は 0〜12 の整数で指定してください',
    untransposableChord: '移調できないコード名があります',
    labeledChordVariant: 'ラベル付きコード（C@label など）はカポを変更できません',
    customDefinitionCollision: '変換後のコード名がファイル内のコード定義と衝突します',
    transformedParseError: '変換後のDSLを正しく解析できません'
  },
  msgCapoOverrideReset: (reason: string) => `プレビューのカポ変更を解除しました: ${reason}`,
  msgCapoApplied: (capo: number) => `カポ ${capo} をDSLに適用しました。`,
  msgCapoApplyFailed: (reason: string) => `カポを適用できません: ${reason}`,
  msgCapoEditRejected: 'エディタが変更を受け付けませんでした',
  msgCapoUnusedDefinitions: (keys: string) => `次のコード定義は使われなくなる可能性があります（削除はしません）: ${keys}`,

  uiBeginnerMode: '初心者モード',
  uiBeginnerModeTitle: '弾きやすいカポ位置と簡単なコードへの置き換えをプレビューとPDFに反映（DSLは変更しません）',
  uiBeginnerOn: 'ON',
  uiBeginnerOff: 'OFF',
  uiBarreChords: 'バレーコード',
  uiBarreAllow: '許可する',
  uiBarreForbid: '使用しない',
  uiBarreTitle: '「使用しない」ではセーハのある押さえ方を一切使いません',
  uiBeginnerAuto: '自動',
  uiBeginnerSubstitutions: '置き換え',
  beginnerFailure: (code, detail) => {
    if (code === 'noPlayableAlternative') return `条件を満たす押さえ方がないコードがあります${detail ? `（${detail}）` : ''}`;
    if (code === 'noRecommendation') return '初心者モードで使えるカポ位置がありません';
    return MESSAGES_JA.capoFailures[code];
  },
  msgBeginnerReset: (reason: string) => `初心者モードを解除しました: ${reason}`,
  msgBeginnerApplied: (capo: number, substitutions: number) => `初心者モードの変換（カポ ${capo}、置き換え ${substitutions} 種類）をDSLに適用しました。`,
  msgBeginnerApplyFailed: (reason: string) => `初心者モードの変換を適用できません: ${reason}`,

  msgPromptApiKey: 'Gemini API キーを入力してください',
  msgApiKeySaved: 'Gemini API キーを保存しました。',
  msgApiKeyCleared: 'Gemini API キーを削除しました。',
  msgPromptYouTubeUrl: '採譜するYouTube動画のURLを入力してください',
  msgYouTubeUrlPlaceholder: 'https://www.youtube.com/watch?v=...',
  msgInvalidYouTubeUrl: '有効なYouTube動画のURL（https://...）を入力してください。',
  msgTranscribingProgress: 'GeminiでYouTube音源を自動採譜中...',

  audioMirDialogTitle: '採譜するWAVファイルを選択（実験的）',
  audioMirWavFilter: 'WAV音声',
  audioMirProgress: 'ローカル音源を解析中（実験的）...',
  audioMirBusy: 'ローカル音源の採譜はすでに実行中です。',
  audioMirUnsupportedEnvironment: 'ローカル音源の採譜はローカルファイル（デスクトップ版 VS Code）のみ対応しています。',
  audioMirFileTooLarge: 'WAVファイルが大きすぎます（上限 128 MiB）。',
  audioMirInvalidResult: '解析結果を楽譜に変換できませんでした。',
  audioMirErrors: {
    INVALID_WAV: 'WAVファイルを読み取れませんでした（破損または途中で切れています）。',
    UNSUPPORTED_FORMAT: '非対応のWAV形式です。非圧縮の整数PCM（16/24 bit）のみ対応しています。',
    UNSUPPORTED_SAMPLE_RATE: '非対応のサンプルレートです。44.1 kHz または 48 kHz のみ対応しています。',
    UNSUPPORTED_CHANNELS: '非対応のチャンネル数です。モノラルまたはステレオのみ対応しています。',
    UNSUPPORTED_BIT_DEPTH: '非対応のビット深度です。16 bit または 24 bit のみ対応しています。',
    AUDIO_TOO_LONG: '音源が長すぎます（上限 15 分 / 128 MiB）。',
    NO_STABLE_BEAT: '安定した拍を検出できませんでした。',
    NO_COMPLETE_MEASURE: '完全な4/4小節を検出できませんでした。',
    ANALYSIS_FAILED: '音源の解析に失敗しました。',
    AUDIO_MIR_RUNTIME_MISSING: '解析エンジン（WASM）が見つかりません。拡張機能を再インストールしてください。'
  }
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
  uiSavePdfTitle: 'Save score as PDF with selected paper size and orientation',

  uiCapo: 'Capo',
  uiCapoTitle: 'Show the preview and PDF with another capo position (the DSL is not changed)',
  uiPlayability: 'Playability',
  uiPlayabilityUnavailable: 'Not available',
  uiRecommended: 'Recommended',
  uiCapoPreviewOnly: 'Preview only',
  uiApplyToDsl: 'Apply to DSL',
  uiApplyToDslTitle: 'Write the selected capo and chord names to the DSL (undoable)',
  uiEditCapo: 'Edit…',
  uiEditCapoTitle: 'Open the capo / playability editor',
  playabilityLevels: {
    veryEasy: 'Very easy',
    easy: 'Easy',
    moderate: 'Moderate',
    hard: 'Hard',
    veryHard: 'Very hard'
  },
  capoFailures: {
    sourceParseError: 'the DSL has errors',
    invalidSourceCapo: 'the capo: value is not an integer from 0 to 12',
    invalidTargetCapo: 'the capo must be an integer from 0 to 12',
    untransposableChord: 'a chord name cannot be transposed',
    labeledChordVariant: 'labeled chords (such as C@label) cannot change capo',
    customDefinitionCollision: 'a transposed chord name collides with a chord definition in the file',
    transformedParseError: 'the transposed DSL could not be parsed'
  },
  msgCapoOverrideReset: (reason: string) => `Preview capo change was cleared: ${reason}`,
  msgCapoApplied: (capo: number) => `Applied capo ${capo} to the DSL.`,
  msgCapoApplyFailed: (reason: string) => `Cannot apply capo: ${reason}`,
  msgCapoEditRejected: 'the editor rejected the change',
  msgCapoUnusedDefinitions: (keys: string) => `These chord definitions may become unused (they are not deleted): ${keys}`,

  uiBeginnerMode: 'Beginner mode',
  uiBeginnerModeTitle: 'Show the preview and PDF with an easy capo position and simpler chords (the DSL is not changed)',
  uiBeginnerOn: 'ON',
  uiBeginnerOff: 'OFF',
  uiBarreChords: 'Barre chords',
  uiBarreAllow: 'Allow',
  uiBarreForbid: 'Do not use',
  uiBarreTitle: '"Do not use" never uses a shape with a barre',
  uiBeginnerAuto: 'Auto',
  uiBeginnerSubstitutions: 'Substitutions',
  beginnerFailure: (code, detail) => {
    if (code === 'noPlayableAlternative') return `a chord has no shape that meets the conditions${detail ? ` (${detail})` : ''}`;
    if (code === 'noRecommendation') return 'no capo position is available in beginner mode';
    return MESSAGES_EN.capoFailures[code];
  },
  msgBeginnerReset: (reason: string) => `Beginner mode was turned off: ${reason}`,
  msgBeginnerApplied: (capo: number, substitutions: number) => `Applied the beginner mode transform (capo ${capo}, ${substitutions} substituted chord(s)) to the DSL.`,
  msgBeginnerApplyFailed: (reason: string) => `Cannot apply the beginner mode transform: ${reason}`,

  msgPromptApiKey: 'Enter your Gemini API key',
  msgApiKeySaved: 'Gemini API key has been saved.',
  msgApiKeyCleared: 'Gemini API key has been cleared.',
  msgPromptYouTubeUrl: 'Enter the YouTube video URL to transcribe',
  msgYouTubeUrlPlaceholder: 'https://www.youtube.com/watch?v=...',
  msgInvalidYouTubeUrl: 'Please enter a valid YouTube video URL (https://...).',
  msgTranscribingProgress: 'Transcribing YouTube audio with Gemini...',

  audioMirDialogTitle: 'Select a WAV file to transcribe (experimental)',
  audioMirWavFilter: 'WAV audio',
  audioMirProgress: 'Analyzing local audio (experimental)...',
  audioMirBusy: 'Local audio transcription is already running.',
  audioMirUnsupportedEnvironment: 'Local audio transcription supports local files in desktop VS Code only.',
  audioMirFileTooLarge: 'The WAV file is too large (limit: 128 MiB).',
  audioMirInvalidResult: 'The analysis result could not be converted into a score.',
  audioMirErrors: {
    INVALID_WAV: 'The WAV file could not be read (corrupted or truncated).',
    UNSUPPORTED_FORMAT: 'Unsupported WAV format. Only uncompressed integer PCM (16/24-bit) is supported.',
    UNSUPPORTED_SAMPLE_RATE: 'Unsupported sample rate. Only 44.1 kHz and 48 kHz are supported.',
    UNSUPPORTED_CHANNELS: 'Unsupported channel count. Only mono and stereo are supported.',
    UNSUPPORTED_BIT_DEPTH: 'Unsupported bit depth. Only 16-bit and 24-bit are supported.',
    AUDIO_TOO_LONG: 'The audio is too long (limit: 15 minutes / 128 MiB).',
    NO_STABLE_BEAT: 'No stable beat could be detected.',
    NO_COMPLETE_MEASURE: 'No complete 4/4 measure could be detected.',
    ANALYSIS_FAILED: 'Audio analysis failed.',
    AUDIO_MIR_RUNTIME_MISSING: 'The analysis engine (WASM) is missing. Please reinstall the extension.'
  }
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
  beatCountMismatch: a => `小節の長さが${a.expected ?? 4}拍ではありません（${a.beats}拍）`,
  syllableCountMismatch: a => `歌詞の音節数（${a.syllables}）と歌う音符の数（${a.notes}）が一致しません`,
  lyricBarMismatch: () => '歌詞の | の位置がメロディの小節区切りと一致しません',
  measureLyricWithMelody: () => 'メロディのある小節の l:"..." は表示されません（lyr: を使ってください）',
  invalidMeasuresPerRow: a => `measures_per_row は 1〜8 の整数で指定してください: ${a.value}`,
  invalidChordDefinition: a => `コード定義が不正です（${CHORD_DEF_REASON_JA[a.reason] ?? a.reason}）: ${a.detail}`,
  duplicateChordDefinition: a => `コード ${a.chord} は既に定義されています（最初の定義が使われます）`,
  unknownChordVariant: a => `コード ${a.chord} の定義がありません（ラベルなしのダイアグラムで表示します）`,
  invalidTimeSignature: a => `拍子が不正です: ${a.value}（分子 1〜32 / 分母 1・2・4・8・16、例: 7/8(2+2+3)）`,
  invalidBeatGrouping: a => `拍のグループが不正です: ${a.value}（各グループは分子より小さい正の整数で、合計が分子と等しいこと）`,
  invalidFeel: a => `フィールが不正です: ${a.value}（straight / swing / shuffle）`,
  invalidPickup: a => `弱起の長さが不正です: ${a.value}（0 より長く、最初の拍子の1小節より短い音価）`,
  invalidScoreEvent: a => `スコアイベントが不正です: ${a.directive}: ${a.value ?? ''}`,
  orphanScoreEvent: a => `${a.directive} の後に小節がないため、このイベントは使われません`,
  measureRepeatMeterMismatch: () => '拍子の異なる小節は % で繰り返せません',
  invalidTuplet: a => `連符の比が不正です: ${a.token}（{実数:通常数} は 2〜16 の異なる整数）`,
  incompleteTupletGroup: () => '連符のグループが小節内で完結していません',
  invalidTechnique: a => `奏法の指定が不正です: ${a.token}`,
  techniqueRequiresPitch: a => `この奏法は音高のある音符にだけ付けられます: ${a.token}`,
  danglingTechnique: a => `${a.technique} の接続先の音符がありません`,
  danglingGrace: () => '装飾音符の後に拍を持つ音符がありません',
  nestedSlur: () => 'スラーの中で slur-start が重なっています（入れ子にできません）',
  unmatchedSlurEnd: () => '対応する slur-start のない slur-end です',
  unclosedSlur: () => 'slur-start に対応する slur-end がありません'
};

const DIAGNOSTICS_EN: DiagnosticTemplates = {
  upperCaseNoteName: a => `Melody note names must be lowercase: ${a.token}`,
  invalidMelodyNote: a => `Not a valid melody note: ${a.token}`,
  invalidLength: a => `Invalid length: ${a.token} (after \`/\` use a note value 1, 2, 4, 8, 16 with . t +; after \`:\` use a beat count)`,
  missingInitialOctaveOrLength: a => `The first note of a mel: line needs an octave and a length: ${a.token}`,
  tooManyMelodyMeasures: () => 'No measure left for this melody cell (the mel: line has more cells than measures)',
  melodyRepeatWithoutPrevious: () => 'The measure before % has no melody to repeat',
  lyricsWithoutMelody: () => 'lyr: line has no preceding mel: line',
  beatCountMismatch: a => `Measure length is not ${a.expected ?? 4} beats (${a.beats} beats)`,
  syllableCountMismatch: a => `Syllable count (${a.syllables}) does not match the sung notes (${a.notes})`,
  lyricBarMismatch: () => 'The | positions in the lyrics do not match the melody measures',
  measureLyricWithMelody: () => 'l:"..." is not shown in a measure with a melody (use lyr:)',
  invalidMeasuresPerRow: a => `measures_per_row must be an integer from 1 to 8: ${a.value}`,
  invalidChordDefinition: a => `Invalid chord definition (${CHORD_DEF_REASON_EN[a.reason] ?? a.reason}): ${a.detail}`,
  duplicateChordDefinition: a => `Chord ${a.chord} is already defined (the first definition is used)`,
  unknownChordVariant: a => `Chord ${a.chord} is not defined (the unlabeled diagram is shown)`,
  invalidTimeSignature: a => `Invalid time signature: ${a.value} (numerator 1-32 / denominator 1, 2, 4, 8, 16, e.g. 7/8(2+2+3))`,
  invalidBeatGrouping: a => `Invalid beat grouping: ${a.value} (each group is a positive integer smaller than the numerator, summing to it)`,
  invalidFeel: a => `Invalid feel: ${a.value} (straight / swing / shuffle)`,
  invalidPickup: a => `Invalid pickup length: ${a.value} (a note value longer than 0 and shorter than one measure of the initial meter)`,
  invalidScoreEvent: a => `Invalid score event: ${a.directive}: ${a.value ?? ''}`,
  orphanScoreEvent: a => `No measure follows ${a.directive}, so this event is not used`,
  measureRepeatMeterMismatch: () => 'A measure with a different time signature cannot be repeated with %',
  invalidTuplet: a => `Invalid tuplet ratio: ${a.token} ({actual:normal} must be two different integers from 2 to 16)`,
  incompleteTupletGroup: () => 'A tuplet group is not complete within the measure',
  invalidTechnique: a => `Invalid technique: ${a.token}`,
  techniqueRequiresPitch: a => `This technique needs a pitched note: ${a.token}`,
  danglingTechnique: a => `No target note follows ${a.technique}`,
  danglingGrace: () => 'No timed note follows this grace note',
  nestedSlur: () => 'slur-start inside an open slur (slurs cannot be nested)',
  unmatchedSlurEnd: () => 'slur-end without a matching slur-start',
  unclosedSlur: () => 'slur-start without a matching slur-end'
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

/** Score settings editor (generic, section-based webview; capo / playability is the first section). */
export interface ScoreSettingsEditorMessages {
  panelTitle: string;
  sectionCapo: string;
  sectionBeginner: string;
  currentCapo: string;
  selectedCapo: string;
  colCapo: string;
  colScore: string;
  colLevel: string;
  colStatus: string;
  supported: string;
  unsupported: string;
  current: string;
  recommended: string;
  currentVocabulary: string;
  targetVocabulary: string;
  mapping: string;
  warnings: string;
  noChords: string;
  unresolvedChords: string;
  apply: string;
  close: string;
  barreChords: string;
  barreAllow: string;
  barreForbid: string;
  capo: string;
  capoAuto: string;
  recommendedCapo: string;
  currentPlayability: string;
  targetPlayability: string;
  colSource: string;
  colCapoChord: string;
  colTarget: string;
  substituted: string;
  selectable: string;
  notSelectable: string;
  beginnerNote: string;
}

const SCORE_SETTINGS_JA: ScoreSettingsEditorMessages = {
  panelTitle: '楽譜設定',
  sectionCapo: 'カポ / 弾きやすさ',
  sectionBeginner: '初心者モード',
  currentCapo: '現在のカポ',
  selectedCapo: '選択中のカポ',
  colCapo: 'カポ',
  colScore: 'スコア',
  colLevel: '弾きやすさ',
  colStatus: '状態',
  supported: '変更可',
  unsupported: '変更不可',
  current: '現在',
  recommended: '推奨',
  currentVocabulary: '現在のコード',
  targetVocabulary: '変更後のコード',
  mapping: 'コードの対応',
  warnings: '警告',
  noChords: 'コードがないため弾きやすさを評価できません。',
  unresolvedChords: '押さえ方が不明なコード',
  apply: 'DSLに適用',
  close: '閉じる',
  barreChords: 'バレーコード',
  barreAllow: '許可する',
  barreForbid: '使用しない',
  capo: 'カポ',
  capoAuto: '自動',
  recommendedCapo: '推奨カポ',
  currentPlayability: '現在の弾きやすさ',
  targetPlayability: '変更後の弾きやすさ',
  colSource: '元',
  colCapoChord: 'カポ変更後',
  colTarget: '最終',
  substituted: '置き換え',
  selectable: '選択可',
  notSelectable: '選択不可',
  beginnerNote: '鳴る響きをカポで保ちながら、弾きやすいカポ位置と簡単なコードを提案します。設定はDSLに保存されません。'
};

const SCORE_SETTINGS_EN: ScoreSettingsEditorMessages = {
  panelTitle: 'Score Settings',
  sectionCapo: 'Capo / Playability',
  sectionBeginner: 'Beginner Mode',
  currentCapo: 'Current capo',
  selectedCapo: 'Selected capo',
  colCapo: 'Capo',
  colScore: 'Score',
  colLevel: 'Playability',
  colStatus: 'Status',
  supported: 'Supported',
  unsupported: 'Unsupported',
  current: 'Current',
  recommended: 'Recommended',
  currentVocabulary: 'Current chords',
  targetVocabulary: 'Target chords',
  mapping: 'Chord mapping',
  warnings: 'Warnings',
  noChords: 'No chords, so playability is not available.',
  unresolvedChords: 'Chords without a known shape',
  apply: 'Apply to DSL',
  close: 'Close',
  barreChords: 'Barre chords',
  barreAllow: 'Allow',
  barreForbid: 'Do not use',
  capo: 'Capo',
  capoAuto: 'Auto',
  recommendedCapo: 'Recommended capo',
  currentPlayability: 'Current playability',
  targetPlayability: 'Playability after the change',
  colSource: 'Source',
  colCapoChord: 'After capo',
  colTarget: 'Final',
  substituted: 'Substituted',
  selectable: 'Selectable',
  notSelectable: 'Not selectable',
  beginnerNote: 'Suggests an easy capo position and simpler chords while the capo keeps the sounding harmony. Settings are not saved in the DSL.'
};

export function getScoreSettingsEditorMessages(locale: SupportedLocale): ScoreSettingsEditorMessages {
  return locale === 'ja' ? SCORE_SETTINGS_JA : SCORE_SETTINGS_EN;
}
