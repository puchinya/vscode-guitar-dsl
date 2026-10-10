import type { DiagnosticCode } from './compiler';
import type { AudioMirErrorCode } from './audioMir/model';
import type { BeginnerFailureCode } from './beginnerMode';
import type { CapoTransformFailureCode, PlayabilityLevel } from './capo';
import type { TransposeFailureCode } from './transpose';

export type SupportedLocale = 'ja' | 'en';

/** Starter templates offered by `guitardsl.newDocumentFromTemplate`, in Quick Pick order. */
export type StarterTemplateId = 'basicChordSong' | 'melodyExample' | 'leadSheetExample';
/** Curated samples offered by `guitardsl.openSample` (file names under `samples/`). */
export type CuratedSampleId =
  | 'sample.guitardsl'
  | 'sample_melody.guitardsl'
  | 'sample_leadsheet.guitardsl'
  | 'sample_voicings.guitardsl'
  | 'sample_notes.guitardsl';

export interface Messages {
  // Extension host messages
  msgOpenGuitarDslFile: string;
  msgDocNotFound: string;
  msgPdfSaved: (filename: string) => string;
  msgOpenFile: string;
  msgPdfFailed: (err: string) => string;
  dialogSavePdfTitle: string;
  previewTitle: string;
  gp78ImportTrackPrompt: string;
  gp78ImportNoEligibleTracks: string;
  gp78ImportLossConfirm: (count: number) => string;
  gp78ExportLossConfirm: (count: number) => string;
  gp78Continue: string;
  gp78Cancel: string;
  gp78Busy: string;
  gp78Saved: (filename: string) => string;
  gp78Failed: (detail: string) => string;
  dialogOpenGp78Title: string;
  dialogSaveGp78Title: string;

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
  uiHelp: string;
  uiHelpTitle: string;
  msgHelpOpenFailed: string;
  uiPlaybackGroup: string;
  uiPlay: string;
  uiPause: string;
  uiResume: string;
  uiStop: string;
  uiSeek: string;
  uiPlaybackTime: string;
  uiCountIn: string;
  uiMetronome: string;
  uiPlaybackInvalidOrder: string;
  uiPlaybackUnresolvedTempo: string;
  uiPlaybackEmpty: string;
  uiPlaybackAudioUnavailable: string;
  uiPractice: string;
  uiPracticeTitle: string;
  uiPracticeSpeed: string;
  uiPracticeLoop: string;
  uiPracticeLoopOff: string;
  uiPracticeLoopMeasure: string;
  uiPracticeLoopSection: string;
  uiPracticeLoopAB: string;
  uiPracticeA: string;
  uiPracticeB: string;
  uiPracticeSetA: string;
  uiPracticeSetB: string;
  uiPracticeClear: string;
  uiPracticeFollow: string;
  uiPracticeFollowTitle: string;
  uiPracticeMeasure: string;
  uiPracticeOccurrence: string;
  uiPracticeUnavailable: string;
  uiPracticeEnableFirst: string;
  uiPracticeARequired: string;
  uiPracticeInvalidEnd: string;
  uiPracticeUnnamedSection: string;
  uiPracticeASet: string;
  uiPracticeLoopSet: string;
  uiPracticeLoopCleared: string;
  msgPlaybackNoPreview: string;

  // Onboarding sidebar (Activity Bar "Start Here" view) and onboarding commands
  sidebarGetStarted: string;
  sidebarCurrentFile: string;
  sidebarTools: string;
  sidebarNoActiveFile: string;
  sidebarNewFromTemplate: string;
  sidebarOpenSample: string;
  sidebarOpenPreview: string;
  sidebarOpenHelp: string;
  sidebarEditChordDiagram: string;
  sidebarEditScoreSettings: string;
  sidebarEditCapo: string;
  sidebarChangeAccompaniment: string;
  sidebarExportPdf: string;
  sidebarTranscribeYouTube: string;
  sidebarTranscribeAudio: string;
  templatePickPlaceholder: string;
  templates: Record<StarterTemplateId, { label: string; description: string }>;
  samplePickPlaceholder: string;
  samples: Record<CuratedSampleId, string>;
  msgTemplateOpenFailed: string;
  msgSampleOpenFailed: string;

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

  // Sounding transposition (score settings editor)
  transposeFailure: (code: TransposeFailureCode, detail?: string) => string;
  msgTransposeApplied: (semitones: number, key: string) => string;
  msgTransposeApplyFailed: (reason: string) => string;
  msgNoCapoRecommendation: string;

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
  gp78ImportTrackPrompt: '取り込むギタートラックを選択してください',
  gp78ImportNoEligibleTracks: '1スタッフ・6弦ギター・TAB声部1に対応するトラックがありません。',
  gp78ImportLossConfirm: (count: number) => `インポート時に${count}件の情報を省略または補完します。内容を確認して続行しますか？`,
  gp78ExportLossConfirm: (count: number) => `エクスポート時に${count}件の表示または音色情報を省略します。続行しますか？`,
  gp78Continue: '続行',
  gp78Cancel: 'キャンセル',
  gp78Busy: 'Guitar Pro変換を実行中です。完了後にもう一度お試しください。',
  gp78Saved: (filename: string) => `Guitar Proファイルを保存しました: ${filename}`,
  gp78Failed: (detail: string) => `Guitar Pro変換に失敗しました: ${detail}`,
  dialogOpenGp78Title: 'Guitar Pro 7/8ファイルを選択',
  dialogSaveGp78Title: 'Guitar Pro 7互換ファイルとして保存',

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
  uiHelp: 'ヘルプ',
  uiHelpTitle: 'GuitarDSL ヘルプを開く',
  msgHelpOpenFailed: 'GuitarDSL ヘルプを開けませんでした。拡張機能を再インストールしてください。',
  uiPlaybackGroup: '再生操作',
  uiPlay: '再生',
  uiPause: '一時停止',
  uiResume: '再開',
  uiStop: '停止',
  uiSeek: '再生位置',
  uiPlaybackTime: '現在位置 / 全長',
  uiCountIn: 'カウントイン',
  uiMetronome: 'メトロノーム',
  uiPlaybackInvalidOrder: '演奏順序にエラーがあるため再生できません。',
  uiPlaybackUnresolvedTempo: '再生位置のテンポを解決できないため再生できません。',
  uiPlaybackEmpty: '再生する小節がありません。',
  uiPlaybackAudioUnavailable: 'この環境では Web Audio を利用できません。',
  uiPractice: '練習',
  uiPracticeTitle: '練習モードを切り替え',
  uiPracticeSpeed: '速度',
  uiPracticeLoop: 'ループ',
  uiPracticeLoopOff: 'オフ',
  uiPracticeLoopMeasure: '小節',
  uiPracticeLoopSection: 'セクション',
  uiPracticeLoopAB: 'A–B',
  uiPracticeA: 'A',
  uiPracticeB: 'B',
  uiPracticeSetA: 'ループ開始点 A を設定',
  uiPracticeSetB: 'ループ終了点 B を設定',
  uiPracticeClear: 'クリア',
  uiPracticeFollow: '追従',
  uiPracticeFollowTitle: '再生位置への追従を切り替え',
  uiPracticeMeasure: '小節',
  uiPracticeOccurrence: '出現',
  uiPracticeUnavailable: '再生できないため練習操作を利用できません。',
  uiPracticeEnableFirst: '先に練習モードをオンにしてください。',
  uiPracticeARequired: '先に A を設定してください。',
  uiPracticeInvalidEnd: 'B は A より後に設定してください。',
  uiPracticeUnnamedSection: 'この小節にセクション名がないため、セクションループを設定できません。',
  uiPracticeASet: 'A を設定しました。B を設定してください。',
  uiPracticeLoopSet: 'ループを設定しました。',
  uiPracticeLoopCleared: 'ループを解除しました。',
  msgPlaybackNoPreview: '再生操作には開いている GuitarDSL Preview が必要です。',

  sidebarGetStarted: 'はじめる',
  sidebarCurrentFile: '現在のファイル',
  sidebarTools: 'ツール',
  sidebarNoActiveFile: '.guitardsl ファイルを開くと、ファイル操作が表示されます。',
  sidebarNewFromTemplate: 'テンプレートから新規作成',
  sidebarOpenSample: 'サンプルを開く',
  sidebarOpenPreview: 'プレビューを横に開く',
  sidebarOpenHelp: 'ヘルプを開く',
  sidebarEditChordDiagram: 'コードダイアグラムを編集',
  sidebarEditScoreSettings: '楽譜設定を編集',
  sidebarEditCapo: 'カポ / 弾きやすさを編集',
  sidebarChangeAccompaniment: '伴奏パターンを変更',
  sidebarExportPdf: 'PDF出力 / 印刷',
  sidebarTranscribeYouTube: 'YouTubeから採譜（実験的）',
  sidebarTranscribeAudio: 'ローカル音源から採譜（実験的）',
  templatePickPlaceholder: '新しい GuitarDSL ドキュメントのテンプレートを選択',
  templates: {
    basicChordSong: { label: 'コード譜（基本）', description: 'コードとストロークのリズム、小節単位の歌詞' },
    melodyExample: { label: 'メロディ付き', description: 'mel: のメロディ行と lyr: の音符単位の歌詞' },
    leadSheetExample: { label: 'リードシート', description: 'リズムを隠し、メロディとコードだけを表示' }
  },
  samplePickPlaceholder: '開くサンプルを選択（無題の編集可能なドキュメントとして開きます）',
  samples: {
    'sample.guitardsl': '8ビートのコード譜と歌詞',
    'sample_melody.guitardsl': 'メロディと音符単位の歌詞',
    'sample_leadsheet.guitardsl': 'リードシート表示と3連符',
    'sample_voicings.guitardsl': 'コードダイアグラムとボイシング定義',
    'sample_notes.guitardsl': '音符・リズム記号の一覧'
  },
  msgTemplateOpenFailed: 'テンプレートからドキュメントを作成できませんでした。',
  msgSampleOpenFailed: 'サンプルを開けませんでした。拡張機能を再インストールしてください。',

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
    transformedParseError: '変換後のDSLを正しく解析できません',
    tabTransformUnsupported: 'TAB を含む譜面は、この変換にまだ対応していません'
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
  transposeFailure: (code, detail) => {
    const own: Partial<Record<TransposeFailureCode, string>> = {
      invalidSemitones: '移調量は -11〜+11 の整数で指定してください',
      untransposableKey: 'キーを移調できません',
      pitchOutOfRange: '移調後の音高がオクターブ 0〜9 の範囲を超えます',
      labeledChordVariant: 'ラベル付きのコード（C@label）があるため移調できません'
    };
    const text = own[code] ?? MESSAGES_JA.capoFailures[code as CapoTransformFailureCode] ?? code;
    return detail ? `${text}（${detail}）` : text;
  },
  msgTransposeApplied: (semitones: number, key: string) => `${semitones > 0 ? '+' : ''}${semitones} 半音移調しました（キー ${key}）`,
  msgTransposeApplyFailed: (reason: string) => `移調を適用できません: ${reason}`,
  msgNoCapoRecommendation: 'コードがないため推奨カポを決められません。カポはそのままにします。',

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
  gp78ImportTrackPrompt: 'Select the guitar track to import',
  gp78ImportNoEligibleTracks: 'No track supports one staff, six strings, and TAB voice 1.',
  gp78ImportLossConfirm: (count: number) => `Import will omit or infer ${count} items. Review the reported details and continue?`,
  gp78ExportLossConfirm: (count: number) => `Export will omit ${count} display or instrument-sound items. Continue?`,
  gp78Continue: 'Continue',
  gp78Cancel: 'Cancel',
  gp78Busy: 'A Guitar Pro conversion is already running. Try again when it finishes.',
  gp78Saved: (filename: string) => `Guitar Pro file saved: ${filename}`,
  gp78Failed: (detail: string) => `Guitar Pro conversion failed: ${detail}`,
  dialogOpenGp78Title: 'Select a Guitar Pro 7/8 file',
  dialogSaveGp78Title: 'Save as a Guitar Pro 7 compatible file',

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
  uiHelp: 'Help',
  uiHelpTitle: 'Open GuitarDSL Help',
  msgHelpOpenFailed: 'Could not open GuitarDSL Help. Try reinstalling the extension.',
  uiPlaybackGroup: 'Playback controls',
  uiPlay: 'Play',
  uiPause: 'Pause',
  uiResume: 'Resume',
  uiStop: 'Stop',
  uiSeek: 'Seek position',
  uiPlaybackTime: 'Current position / duration',
  uiCountIn: 'Count-in',
  uiMetronome: 'Metronome',
  uiPlaybackInvalidOrder: 'Playback is unavailable because the play order is invalid.',
  uiPlaybackUnresolvedTempo: 'Playback is unavailable because a played measure has no valid tempo.',
  uiPlaybackEmpty: 'There are no measures to play.',
  uiPlaybackAudioUnavailable: 'Web Audio is unavailable in this environment.',
  uiPractice: 'Practice',
  uiPracticeTitle: 'Toggle Practice Mode',
  uiPracticeSpeed: 'Speed',
  uiPracticeLoop: 'Loop',
  uiPracticeLoopOff: 'Off',
  uiPracticeLoopMeasure: 'Measure',
  uiPracticeLoopSection: 'Section',
  uiPracticeLoopAB: 'A–B',
  uiPracticeA: 'A',
  uiPracticeB: 'B',
  uiPracticeSetA: 'Set loop start A',
  uiPracticeSetB: 'Set loop end B',
  uiPracticeClear: 'Clear',
  uiPracticeFollow: 'Follow',
  uiPracticeFollowTitle: 'Toggle follow playback position',
  uiPracticeMeasure: 'Measure',
  uiPracticeOccurrence: 'Occurrence',
  uiPracticeUnavailable: 'Practice controls are unavailable because playback cannot start.',
  uiPracticeEnableFirst: 'Turn on Practice Mode first.',
  uiPracticeARequired: 'Set A before setting B.',
  uiPracticeInvalidEnd: 'B must be after A.',
  uiPracticeUnnamedSection: 'This measure has no section name, so a section loop cannot be set.',
  uiPracticeASet: 'A is set. Set B to complete the loop.',
  uiPracticeLoopSet: 'Loop set.',
  uiPracticeLoopCleared: 'Loop cleared.',
  msgPlaybackNoPreview: 'Open a GuitarDSL Preview to use playback commands.',

  sidebarGetStarted: 'Get Started',
  sidebarCurrentFile: 'Current File',
  sidebarTools: 'Tools',
  sidebarNoActiveFile: 'Open a .guitardsl file to show file actions.',
  sidebarNewFromTemplate: 'New from Template',
  sidebarOpenSample: 'Open Sample',
  sidebarOpenPreview: 'Open Preview to the Side',
  sidebarOpenHelp: 'Open Help',
  sidebarEditChordDiagram: 'Edit Chord Diagram',
  sidebarEditScoreSettings: 'Edit Score Settings',
  sidebarEditCapo: 'Edit Capo / Playability',
  sidebarChangeAccompaniment: 'Change Accompaniment Pattern',
  sidebarExportPdf: 'Export PDF / Print',
  sidebarTranscribeYouTube: 'Transcribe from YouTube (Experimental)',
  sidebarTranscribeAudio: 'Transcribe Local Audio (Experimental)',
  templatePickPlaceholder: 'Choose a template for the new GuitarDSL document',
  templates: {
    basicChordSong: { label: 'Basic Chord Song', description: 'Chords, strumming rhythm and per-bar lyrics' },
    melodyExample: { label: 'Melody Example', description: 'A mel: melody line with lyr: per-note lyrics' },
    leadSheetExample: { label: 'Lead Sheet Example', description: 'Melody and chords only, rhythm hidden' }
  },
  samplePickPlaceholder: 'Choose a sample to open (opens as an untitled, editable document)',
  samples: {
    'sample.guitardsl': '8-beat chord chart with lyrics',
    'sample_melody.guitardsl': 'Melody with per-note lyrics',
    'sample_leadsheet.guitardsl': 'Lead sheet display and triplets',
    'sample_voicings.guitardsl': 'Chord diagrams and voicing definitions',
    'sample_notes.guitardsl': 'Catalog of note and rhythm symbols'
  },
  msgTemplateOpenFailed: 'Could not create a document from the template.',
  msgSampleOpenFailed: 'Could not open the sample. Try reinstalling the extension.',

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
    transformedParseError: 'the transposed DSL could not be parsed',
    tabTransformUnsupported: 'this transform is not supported for a score containing TAB'
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
  transposeFailure: (code, detail) => {
    const own: Partial<Record<TransposeFailureCode, string>> = {
      invalidSemitones: 'The shift must be an integer from -11 to +11',
      untransposableKey: 'The key cannot be transposed',
      pitchOutOfRange: 'A transposed pitch would leave octaves 0-9',
      labeledChordVariant: 'Labeled chords (C@label) prevent transposition'
    };
    const text = own[code] ?? MESSAGES_EN.capoFailures[code as CapoTransformFailureCode] ?? code;
    return detail ? `${text} (${detail})` : text;
  },
  msgTransposeApplied: (semitones: number, key: string) => `Transposed by ${semitones > 0 ? '+' : ''}${semitones} semitones (key ${key})`,
  msgTransposeApplyFailed: (reason: string) => `Cannot apply the transposition: ${reason}`,
  msgNoCapoRecommendation: 'No chords to recommend a capo from; the capo is kept.',

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

const VARIABLE_VALUE_REASON_JA: Record<string, string> = {
  percent: '% は let の中では使えません',
  token: '解釈できないトークン',
  noContext: '小節行と mel: の両方で使えない要素の組み合わせ',
  openTie: '最後の音符のタイの続く先がありません',
  tieTarget: 'タイの直後が同じ定義の中の音高を持つ単音ではありません',
  danglingConnection: '接続先の音符が定義の中にありません',
  danglingGrace: '装飾音符の後に拍を持つ音符が定義の中にありません',
  openSlur: 'slur-start が定義の中で閉じられていません',
  unmatchedSlurEnd: '対応する slur-start のない slur-end',
  nestedSlur: 'スラーの入れ子'
};
const VARIABLE_VALUE_REASON_EN: Record<string, string> = {
  percent: '% cannot be used in let',
  token: 'unrecognized token',
  noContext: 'no line type accepts all of its items',
  openTie: 'the last note is tied to nothing',
  tieTarget: 'the tie is not followed by a single pitched note inside the definition',
  danglingConnection: 'the connection target is not inside the definition',
  danglingGrace: 'no timed note follows the grace note inside the definition',
  openSlur: 'slur-start is not closed inside the definition',
  unmatchedSlurEnd: 'slur-end without a matching slur-start',
  nestedSlur: 'nested slur'
};

type DiagnosticArgs = Record<string, string | number>;
type DiagnosticTemplates = Record<DiagnosticCode, (a: DiagnosticArgs) => string>;

const DIAGNOSTICS_JA: DiagnosticTemplates = {
  upperCaseNoteName: a => `メロディの音名は小文字で書いてください: ${a.token}`,
  invalidMelodyNote: a => `メロディの音符として解釈できません: ${a.token}`,
  invalidLength: a => `長さの指定が不正です: ${a.token}（\`/\` の後は音価 1・2・4・8・16 と . t +、\`:\` の後は拍数）`,
  missingInitialOctaveOrLength: a => `mel: 行・let 定義の最初の音符にはオクターブと長さが必要です。TAB 行・let 定義の最初の拍には音価が必要です: ${a.token}`,
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
  invalidTuningStringCount: a => `tuning は第6弦から第1弦の音高を6つ指定してください: ${a.value}`,
  invalidTuningPitch: a => `チューニングの音高が不正です: ${a.pitch}（例: C#4）`,
  unknownTuningPreset: a => `チューニングのプリセットが不明です: ${a.value}`,
  duplicateTuning: () => 'tuning は1回だけ指定できます（最初の指定を使います）',
  tuningOutsideHeader: () => 'tuning は楽譜本文の前に指定してください',
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
  unclosedSlur: () => 'slur-start に対応する slur-end がありません',
  invalidLetDefinition: a => `let 定義の書式が不正です（let 名前 = 値、型注釈は書けません）: ${a.token}`,
  duplicateVariable: a => `${a.name} は既に定義されています（最初の定義が使われます）`,
  unknownVariable: a => `$${a.name} は定義されていません`,
  cyclicVariableReference: a => `$${a.name} の参照が循環しています`,
  invalidVariableValue: a => `let ${a.name} の値が不正です（${VARIABLE_VALUE_REASON_JA[a.reason] ?? a.reason}）: ${a.token}`,
  variableContextMismatch: a => `$${a.name} は${a.context === 'melody' ? ' mel: 行' : '小節行'}では使えません`,
  invalidNoteGroup: a => `同時複数音が不正です（[音名オクターブ,…] に2音以上、重複なし、空白なし、共通の長さが必須）: ${a.token}`,
  unsupportedNoteGroupTechnique: a => `同時複数音では接続・ベンド・スラーは未対応です（タイは同じ音高セットの次の同時複数音へ続ける場合のみ使えます）: ${a.token}`,
  unknownMeasureToken: a => `小節の中で解釈できないトークンです（コード・リズム・音符・記号のどれでもありません）: ${a.token}`,
  unsupportedContinuationLine: () => '`mel:` / `lyr:` の続きの行は書けません。この行は小節として読みません。1 行にまとめるか、行ごとに `mel:` / `lyr:` を付けてください',
  repeatEndWithoutStart: () => '反復終了線 `:|` に対応する反復開始線 `|:` がありません（楽譜の先頭または直前の `:|` のあと）',
  invalidTabToken: a => `TAB の拍を解釈できません: ${a.token}`,
  unsupportedTabVoice: a => `TAB の声部 ${a.voice} は未対応です。このリリースでは声部 1 のみ使用できます`,
  invalidTabString: a => `TAB の弦番号は 1〜6 で指定してください: ${a.string}`,
  invalidTabFret: a => `TAB のフレット位置が不正です: ${a.fret}`,
  duplicateTabString: a => `同じ TAB 拍で弦 ${a.string} が重複しています`,
  tabRepeatWithoutPrevious: () => 'TAB の % の前に同じ声部の TAB 小節がありません',
  invalidTabEffect: a => `TAB の奏法または引数が不正です: ${a.effect ?? a.token ?? ''}`,
  invalidTabEffectScope: a => `TAB の奏法 ${a.effect} はこの位置では使えません`,
  invalidTabConnection: a => `${a.technique} の接続先は弦 ${a.string} の有効な音符である必要があります`,
  danglingTabConnection: a => `${a.technique} の TAB 接続先がありません`,
  invalidTabTie: a => `TAB のタイは直後の発音する拍に同じ弦・フレットが必要です（弦 ${a.string}、フレット ${a.fret}）`,
  tooManyTabMeasures: () => 'TAB セル数がスコア小節数を超えています',
  arrangementInvalidSyntax: a => `編曲ブロックの記述が不正です: ${a.token ?? a.value ?? ''}`,
  arrangementDuplicateBlock: () => '編曲ブロックは文書に1つだけ指定できます',
  arrangementUnterminatedBlock: () => '編曲ブロックに閉じ括弧 `}` がありません',
  arrangementUnexpectedEnd: () => '対応する編曲ブロックのない `}` です',
  arrangementOutsideHeader: () => '編曲ブロックはスコア本文より前に置いてください',
  arrangementEmpty: () => '編曲ブロックには1つ以上のセクション参照が必要です',
  arrangementDuplicateSection: a => `セクション ${a.section} が重複して定義されています`,
  arrangementEmptySection: a => `セクション ${a.section} に小節がありません`,
  arrangementUnassignedMeasures: () => '編曲ブロックがある文書では、すべての小節を名前付きセクションに含めてください',
  arrangementUnknownReference: a => `セクション ${a.section} が定義されていません`,
  arrangementAmbiguousReference: a => `セクション ${a.section} の定義が複数あります（${a.count} 個）`,
  arrangementNavigationConflict: a => `編曲ブロックと小節 ${a.measure} の反復・ナビゲーション記号は併用できません`,
  arrangementLyricVerseUnavailable: a => `セクション ${a.section} に歌詞 ${a.verse} 番がありません（利用可能: ${a.count} 番）`,
  playOrderMultipleNavigationJumps: () => '楽譜全体で `D.C.` または `D.S.` は 1 つだけ指定できます',
  playOrderMissingDestination: a => `演奏順のジャンプ先 ${a.destination} がありません`,
  playOrderAmbiguousDestination: a => `演奏順のジャンプ先 ${a.destination} が複数あります（${a.count} 個）`,
  playOrderInvalidVolta: a => `volta の通過番号が不正です: [${a.bracket}]`,
  playOrderVoltaWithoutRepeat: a => `volta [${a.bracket}] に対応する反復区間がありません`,
  playOrderUnclosedRepeat: () => '反復開始線 `|:` に対応する反復終了線 `:|` がありません',
  playOrderLimitExceeded: a => `演奏小節数が上限 ${a.limit} を超えます`
};

const DIAGNOSTICS_EN: DiagnosticTemplates = {
  upperCaseNoteName: a => `Melody note names must be lowercase: ${a.token}`,
  invalidMelodyNote: a => `Not a valid melody note: ${a.token}`,
  invalidLength: a => `Invalid length: ${a.token} (after \`/\` use a note value 1, 2, 4, 8, 16 with . t +; after \`:\` use a beat count)`,
  missingInitialOctaveOrLength: a => `The first melody note needs an octave and length, and the first TAB beat needs a duration: ${a.token}`,
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
  invalidTuningStringCount: a => `Tuning needs six pitches, from the 6th string to the 1st: ${a.value}`,
  invalidTuningPitch: a => `Invalid tuning pitch: ${a.pitch} (for example, C#4)`,
  unknownTuningPreset: a => `Unknown tuning preset: ${a.value}`,
  duplicateTuning: () => 'Tuning can be specified only once (the first value is used)',
  tuningOutsideHeader: () => 'Place tuning before the score body',
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
  unclosedSlur: () => 'slur-start without a matching slur-end',
  invalidLetDefinition: a => `Invalid let definition (let name = value; type annotations are not allowed): ${a.token}`,
  duplicateVariable: a => `${a.name} is already defined (the first definition is used)`,
  unknownVariable: a => `$${a.name} is not defined`,
  cyclicVariableReference: a => `$${a.name} refers to itself through a cycle`,
  invalidVariableValue: a => `Invalid value for let ${a.name} (${VARIABLE_VALUE_REASON_EN[a.reason] ?? a.reason}): ${a.token}`,
  variableContextMismatch: a => `$${a.name} cannot be used in ${a.context === 'melody' ? 'a mel: line' : 'a measure line'}`,
  invalidNoteGroup: a => `Invalid note group ([pitch+octave,...] with two or more distinct pitches, no spaces and a shared length): ${a.token}`,
  unsupportedNoteGroupTechnique: a => `Note groups cannot use connections, bends, or slurs; a tie must continue to a note group with the same pitch set: ${a.token}`,
  unknownMeasureToken: a => `Unrecognized token in a measure (not a chord, rhythm, note or mark): ${a.token}`,
  unsupportedContinuationLine: () => 'A `mel:` / `lyr:` line cannot continue on the next line; this line is not read as measures. Put it on one line or start each line with `mel:` / `lyr:`',
  repeatEndWithoutStart: () => 'Repeat end `:|` has no matching repeat start `|:` (since the start of the score or the previous `:|`)',
  invalidTabToken: a => `Cannot parse TAB beat: ${a.token}`,
  unsupportedTabVoice: a => `TAB voice ${a.voice} is not supported; this release supports voice 1 only`,
  invalidTabString: a => `TAB string must be from 1 to 6: ${a.string}`,
  invalidTabFret: a => `Invalid TAB fret position: ${a.fret}`,
  duplicateTabString: a => `String ${a.string} is duplicated in this TAB beat`,
  tabRepeatWithoutPrevious: () => 'No previous TAB measure exists for % in this voice',
  invalidTabEffect: a => `Invalid TAB effect or argument: ${a.effect ?? a.token ?? ''}`,
  invalidTabEffectScope: a => `TAB effect ${a.effect} is not valid at this scope`,
  invalidTabConnection: a => `${a.technique} needs a valid target note on string ${a.string}`,
  danglingTabConnection: a => `No target note follows the TAB ${a.technique} connection`,
  invalidTabTie: a => `A TAB tie needs the same string and fret in the next sounding beat (string ${a.string}, fret ${a.fret})`,
  tooManyTabMeasures: () => 'There are more TAB cells than score measures',
  arrangementInvalidSyntax: a => `Invalid arrangement block syntax: ${a.token ?? a.value ?? ''}`,
  arrangementDuplicateBlock: () => 'A document can contain only one arrangement block',
  arrangementUnterminatedBlock: () => 'Arrangement block is missing its closing `}`',
  arrangementUnexpectedEnd: () => 'Unmatched arrangement closing `}`',
  arrangementOutsideHeader: () => 'Place the arrangement block before the score body',
  arrangementEmpty: () => 'Arrangement block needs at least one section reference',
  arrangementDuplicateSection: a => `Section ${a.section} is defined more than once`,
  arrangementEmptySection: a => `Section ${a.section} has no measures`,
  arrangementUnassignedMeasures: () => 'With an arrangement block, every measure must belong to a named section',
  arrangementUnknownReference: a => `Section ${a.section} is not defined`,
  arrangementAmbiguousReference: a => `Section ${a.section} has multiple definitions (${a.count})`,
  arrangementNavigationConflict: a => `Repeat and navigation marks cannot be combined with the arrangement block (measure ${a.measure})`,
  arrangementLyricVerseUnavailable: a => `Section ${a.section} has no lyric verse ${a.verse} (available: ${a.count})`,
  playOrderMultipleNavigationJumps: () => 'A score can contain only one primary jump: `D.C.` or `D.S.`',
  playOrderMissingDestination: a => `Play-order jump destination ${a.destination} is missing`,
  playOrderAmbiguousDestination: a => `Play-order jump destination ${a.destination} is ambiguous (${a.count} marks)`,
  playOrderInvalidVolta: a => `Invalid volta pass numbers: [${a.bracket}]`,
  playOrderVoltaWithoutRepeat: a => `Volta [${a.bracket}] is not associated with a repeat`,
  playOrderUnclosedRepeat: () => 'Repeat start `|:` has no matching repeat end `:|`',
  playOrderLimitExceeded: a => `Play order exceeds the occurrence limit of ${a.limit}`
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
  sectionTranspose: string;
  transposeNote: string;
  semitones: string;
  currentKey: string;
  targetKey: string;
  capoPolicy: string;
  capoKeep: string;
  capoRecommended: string;
  capoExplicit: string;
  targetCapo: string;
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
  beginnerNote: '鳴る響きをカポで保ちながら、弾きやすいカポ位置と簡単なコードを提案します。設定はDSLに保存されません。',
  sectionTranspose: '移調',
  transposeNote: '曲全体の鳴る音（キー・コード・メロディ）を移調し、DSLを書き換えます。カポはそのまま・推奨・指定から選べます。',
  semitones: '移調量（半音）',
  currentKey: '現在のキー',
  targetKey: '移調後のキー',
  capoPolicy: '移調後のカポ',
  capoKeep: 'そのまま',
  capoRecommended: '推奨',
  capoExplicit: '指定',
  targetCapo: '変更後のカポ'
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
  beginnerNote: 'Suggests an easy capo position and simpler chords while the capo keeps the sounding harmony. Settings are not saved in the DSL.',
  sectionTranspose: 'Transpose',
  transposeNote: 'Transposes the sounding music (keys, chords, melody) of the whole song and rewrites the DSL. The capo can be kept, recommended or chosen.',
  semitones: 'Shift (semitones)',
  currentKey: 'Current key',
  targetKey: 'Target key',
  capoPolicy: 'Capo after transposing',
  capoKeep: 'Keep',
  capoRecommended: 'Recommended',
  capoExplicit: 'Choose',
  targetCapo: 'Capo after the change'
};

export function getScoreSettingsEditorMessages(locale: SupportedLocale): ScoreSettingsEditorMessages {
  return locale === 'ja' ? SCORE_SETTINGS_JA : SCORE_SETTINGS_EN;
}

/** Confirmation / progress text of the language model tools (spec extension §8.6). */
export interface AiToolMessages {
  activeDocument: string;
  validating: (doc: string) => string;
  analyzing: (doc: string) => string;
  capoTitle: string;
  capoConfirm: (doc: string, capo: number) => string;
  capoProgress: (doc: string) => string;
  beginnerTitle: string;
  beginnerConfirm: (doc: string, barre: 'allow' | 'forbid', capo: number | undefined) => string;
  beginnerProgress: (doc: string) => string;
  transposeTitle: string;
  transposeConfirm: (doc: string, semitones: number, capo: string) => string;
  transposeProgress: (doc: string) => string;
  capoKeep: string;
  capoRecommended: string;
  capoExplicit: (capo: number) => string;
  accompanimentAnalyzing: (doc: string) => string;
  accompanimentTitle: string;
  accompanimentConfirm: (doc: string, sections: string, extras: string) => string;
  accompanimentProgress: (doc: string) => string;
  accompanimentTransitions: (count: number) => string;
  accompanimentEnding: string;
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

const AI_TOOLS_JA: AiToolMessages = {
  activeDocument: 'アクティブな GuitarDSL ファイル',
  validating: doc => `${doc} を検証しています`,
  analyzing: doc => `${doc} の弾きやすさを分析しています`,
  capoTitle: 'GuitarDSL: カポを変更',
  capoConfirm: (doc, capo) => `${doc} のカポを ${capo} に変更し、コード名を書き換えます（1 回の編集。元に戻せます）。`,
  capoProgress: doc => `${doc} のカポを変更しています`,
  beginnerTitle: 'GuitarDSL: 初心者モードを適用',
  beginnerConfirm: (doc, barre, capo) =>
    `${doc} に初心者モードを適用します（セーハ: ${barre === 'allow' ? '使う' : '使わない'}、カポ: ${capo === undefined ? '自動' : capo}）。カポとコード名を 1 回の編集で書き換えます（元に戻せます）。`,
  beginnerProgress: doc => `${doc} に初心者モードを適用しています`,
  transposeTitle: 'GuitarDSL: 実音を移調',
  transposeConfirm: (doc, semitones, capo) => `${doc} の実音を ${signed(semitones)} 半音移調します（移調後のカポ: ${capo}）。1 回の編集で書き換えます（元に戻せます）。`,
  transposeProgress: doc => `${doc} を移調しています`,
  capoKeep: '維持',
  capoRecommended: '推奨',
  capoExplicit: capo => String(capo),
  accompanimentAnalyzing: doc => `${doc} の伴奏を分析しています`,
  accompanimentTitle: 'GuitarDSL: 伴奏を適用',
  accompanimentConfirm: (doc, sections, extras) =>
    `${doc} のセクション ${sections}${extras} の伴奏リズムを書き換えます。コード・歌詞・メロディは変更しません（1 回の編集。元に戻せます）。`,
  accompanimentProgress: doc => `${doc} に伴奏を適用しています`,
  accompanimentTransitions: count => `、セクション切替 ${count} か所`,
  accompanimentEnding: '、エンディング'
};

const AI_TOOLS_EN: AiToolMessages = {
  activeDocument: 'the active GuitarDSL file',
  validating: doc => `Validating ${doc}`,
  analyzing: doc => `Analyzing playability of ${doc}`,
  capoTitle: 'GuitarDSL: Change capo',
  capoConfirm: (doc, capo) => `Change the capo of ${doc} to ${capo} and rewrite the chord names (one undoable edit).`,
  capoProgress: doc => `Changing the capo of ${doc}`,
  beginnerTitle: 'GuitarDSL: Apply Beginner Mode',
  beginnerConfirm: (doc, barre, capo) =>
    `Apply Beginner Mode to ${doc} (barre chords: ${barre === 'allow' ? 'allowed' : 'not used'}, capo: ${capo === undefined ? 'auto' : capo}). The capo and chord names are rewritten in one undoable edit.`,
  beginnerProgress: doc => `Applying Beginner Mode to ${doc}`,
  transposeTitle: 'GuitarDSL: Transpose sounding pitch',
  transposeConfirm: (doc, semitones, capo) => `Transpose the sounding music of ${doc} by ${signed(semitones)} semitones (capo after transposing: ${capo}) in one undoable edit.`,
  transposeProgress: doc => `Transposing ${doc}`,
  capoKeep: 'keep',
  capoRecommended: 'recommended',
  capoExplicit: capo => String(capo),
  accompanimentAnalyzing: doc => `Analyzing the accompaniment of ${doc}`,
  accompanimentTitle: 'GuitarDSL: Apply accompaniment',
  accompanimentConfirm: (doc, sections, extras) =>
    `Rewrite the accompaniment rhythm of ${doc}, section(s) ${sections}${extras}. Chords, lyrics and melody stay unchanged (one undoable edit).`,
  accompanimentProgress: doc => `Applying accompaniment to ${doc}`,
  accompanimentTransitions: count => `, ${count} section transition(s)`,
  accompanimentEnding: ', the ending'
};

export function getAiToolMessages(locale: SupportedLocale): AiToolMessages {
  return locale === 'ja' ? AI_TOOLS_JA : AI_TOOLS_EN;
}

/** Text of the accompaniment pattern QuickPick (spec extension §3.10). */
export interface AccompanimentUiMessages {
  lensTitle: (section: string) => string;
  unnamedSection: string;
  scopeEntireScore: string;
  scopeEntireScoreDetail: string;
  scopeSection: string;
  scopePlaceholder: string;
  categoryPlaceholder: (target: string) => string;
  patternPlaceholder: (target: string, category: string) => string;
  currentShortcut: string;
  currentShortcutDetail: string;
  meterCategory: (meter: string) => string;
  familyLabels: Record<string, string>;
  usageGroupLabels: Record<string, string>;
  levelLabels: Record<string, string>;
  requiresFeel: (feels: string) => string;
  entireScore: string;
  noDocument: string;
  noMeasures: string;
  mixedMeter: string;
  noPresets: (meter: string) => string;
  noChange: string;
  applied: (target: string, name: string) => string;
  failed: (detail: string) => string;
  staleSection: string;
}

const ACCOMPANIMENT_UI_JA: AccompanimentUiMessages = {
  lensTitle: section => `$(symbol-event) 伴奏パターンを変更 [${section}]`,
  unnamedSection: '（先頭）',
  scopeEntireScore: '$(globe) 楽譜全体に適用',
  scopeEntireScoreDetail: 'すべての小節の伴奏パターンを変更',
  scopeSection: 'このセクションのみ変更',
  scopePlaceholder: '変更を適用する範囲を選択してください',
  categoryPlaceholder: target => `${target} の伴奏カテゴリを選択してください`,
  patternPlaceholder: (target, category) => `${target} に適用するパターンを選択してください（${category}）`,
  currentShortcut: '$(history) 現在のパターンに近い候補',
  currentShortcutDetail: '今のパターンと同じ系統（ファミリー・奏法・細かさ）の候補',
  meterCategory: meter => (meter === '3/4' ? '3/4 ワルツ' : meter),
  familyLabels: {
    quarter: '基本 / 4分',
    eighth: '8ビート',
    sixteenth: '16ビート',
    shuffle: 'シャッフル',
    swing: 'スウィング',
    triplet: '3連',
    sustain: 'バラード / サステイン',
    arpeggio: 'アルペジオ',
    rolled: 'アルペジアート'
  },
  usageGroupLabels: {
    standard: '基本 / 汎用',
    popJpop: 'Pop / J-POP',
    acousticBallad: 'Acoustic / Folk / Ballad',
    rockPunkMetal: 'Rock / Punk / Metal',
    funkSoulDisco: 'Funk / Soul / Disco / R&B',
    reggaeSka: 'Reggae / Ska',
    blues: 'Blues / Shuffle',
    special: '特殊奏法（オールダウン等）'
  },
  levelLabels: {
    low: '低', medium: '中', high: '高', sparse: '疎', dense: '密',
    none: 'なし', light: '弱', strong: '強',
    downbeat: '強拍', backbeat: 'バックビート', offbeat: '裏拍', custom: '独自',
    beginner: '初級', intermediate: '中級', advanced: '上級'
  },
  requiresFeel: feels => `要 feel: ${feels}`,
  entireScore: '楽譜全体',
  noDocument: 'GuitarDSL ファイルが見つかりません。',
  noMeasures: '伴奏を変更できる小節がありません。',
  mixedMeter: '拍子が混在しているため、楽譜全体へは 1 つのパターンを適用できません。セクションを選んで適用してください。',
  noPresets: meter => `${meter} に使えるパターンがありません。`,
  noChange: '変更対象の小節が見つかりませんでした。',
  applied: (target, name) => `${target} の伴奏パターンを「${name}」に変更しました。`,
  failed: detail => `伴奏パターンを適用できません: ${detail}`,
  staleSection: 'セクションが変更されています。CodeLens が更新されてから、もう一度実行してください。'
};

const ACCOMPANIMENT_UI_EN: AccompanimentUiMessages = {
  lensTitle: section => `$(symbol-event) Change Pattern [${section}]`,
  unnamedSection: '(start)',
  scopeEntireScore: '$(globe) Apply to Entire Score',
  scopeEntireScoreDetail: 'Change the accompaniment pattern of every measure',
  scopeSection: 'Change only this section',
  scopePlaceholder: 'Select the target scope for the accompaniment pattern',
  categoryPlaceholder: target => `Select an accompaniment category for ${target}`,
  patternPlaceholder: (target, category) => `Select the pattern to apply to ${target} (${category})`,
  currentShortcut: '$(history) Close to the current pattern',
  currentShortcutDetail: 'Candidates of the same family, style and subdivision as the current pattern',
  meterCategory: meter => (meter === '3/4' ? '3/4 Waltz' : meter),
  familyLabels: {
    quarter: 'Basic / Quarter',
    eighth: '8-beat',
    sixteenth: '16-beat',
    shuffle: 'Shuffle',
    swing: 'Swing',
    triplet: 'Triplet',
    sustain: 'Ballad / Sustain',
    arpeggio: 'Arpeggio',
    rolled: 'Arpeggiato'
  },
  usageGroupLabels: {
    standard: 'Standard',
    popJpop: 'Pop / J-POP',
    acousticBallad: 'Acoustic / Folk / Ballad',
    rockPunkMetal: 'Rock / Punk / Metal',
    funkSoulDisco: 'Funk / Soul / Disco / R&B',
    reggaeSka: 'Reggae / Ska',
    blues: 'Blues / Shuffle',
    special: 'Special techniques (all-downs, ...)'
  },
  levelLabels: {
    low: 'low', medium: 'medium', high: 'high', sparse: 'sparse', dense: 'dense',
    none: 'none', light: 'light', strong: 'strong',
    downbeat: 'downbeat', backbeat: 'backbeat', offbeat: 'offbeat', custom: 'custom',
    beginner: 'beginner', intermediate: 'intermediate', advanced: 'advanced'
  },
  requiresFeel: feels => `needs feel: ${feels}`,
  entireScore: 'Entire Score',
  noDocument: 'No GuitarDSL document found.',
  noMeasures: 'There are no measures whose accompaniment can change.',
  mixedMeter: 'The score mixes meters, so one pattern cannot be applied to the entire score. Choose a section instead.',
  noPresets: meter => `No pattern is available for ${meter}.`,
  noChange: 'No matching measures found to update.',
  applied: (target, name) => `Changed the accompaniment pattern of ${target} to "${name}".`,
  failed: detail => `Cannot apply the accompaniment pattern: ${detail}`,
  staleSection: 'The section has changed. Refresh the CodeLens and try again.'
};

export function getAccompanimentUiMessages(locale: SupportedLocale): AccompanimentUiMessages {
  return locale === 'ja' ? ACCOMPANIMENT_UI_JA : ACCOMPANIMENT_UI_EN;
}
