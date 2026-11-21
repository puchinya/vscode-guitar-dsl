import inspectorSettingsSource from '../../packages/ui/src/inspectorSettings.js?raw';
import { parseGuitarDsl, type ParsedScore } from '@guitardsl/core/compiler';
import { createWorkspaceScoreCache } from './controllers/workspaceScoreCache';
import { canOpenDriveFile, createLatestRequestSequence, readLocalExplorerRowsIfCurrent } from './controllers/workspaceAsyncGuards';
import { formatDiagnostic, getMessages, getScoreSettingsEditorMessages } from '@guitardsl/core/i18n';
import { planBeginnerTransform } from '@guitardsl/core/beginnerMode';
import { planCapoTransform } from '@guitardsl/core/capo';
import { planTransposeWithCapo } from '@guitardsl/core/transpose';
import { BeginnerSection, CapoSection, TransposeSection } from '@guitardsl/core/scoreSettingsSections';
import type { BeginnerSectionModel, CapoSectionModel, ScoreSettingsSectionContext, TransposeSectionModel } from '@guitardsl/core/scoreSettingsSections';
import { planVisualEdit } from '@guitardsl/core/visualEditing/planners';
import type { VisualEditOperation } from '@guitardsl/core/visualEditing/model';
import { suggestProgressions } from '@guitardsl/core/progressionSuggestions';
import type { ProgressionBars, ProgressionCandidate, ProgressionTarget } from '@guitardsl/core/progressionSuggestions';
import { planProgressionEdit, type ProgressionEditOperation } from '@guitardsl/core/progressionSourceEdits';
import { buildProgressionAuditionPlaybackData, compileGuitarDslToHtml } from '@guitardsl/ui/previewHtml';
import { ProgressionAudioLeaseCoordinator, type ProgressionAudioStartMessage } from '@guitardsl/ui/progressionAudioLease';
import { renderInspectorTabsMarkup, type InspectorTabId } from '@guitardsl/ui/inspectorTabs';
import { renderProgressionInspectorMarkup } from '@guitardsl/ui/progressionInspectorMarkup';
import type { PageOrientation, PageSize } from '@guitardsl/pdf';
import type { DocumentIdentity, DocumentSnapshot, StorageKind } from '@guitardsl/document';
import { SourceEditorSurface } from './editor/sourceEditor';
import { showChordDiagramEditor } from './editor/chordDiagramEditor';
import { renderVariablesEditor } from './editor/variableInspector';
import { activeTab as findActiveTab, sameTabIdentity, tabKey } from './tabs/documentTabs';
import { downloadScorePdf, scoreFontUrls } from './pdfExporter';
import { listenForPreviewMessages, WEB_PREVIEW_BRIDGE, WEB_PREVIEW_STYLE, type PreviewMessage, type PreviewPostMessage } from './adapters/previewBridge';
import { GoogleAuthError, GoogleOAuth, type GoogleAccount } from './auth/googleOAuth';
import { DriveApiError, driveIdentity, GoogleDriveApi, isSupportedDriveFile, isSupportedDriveMimeType,
  type DriveFile, type DrivePickerSelection } from './storage/googleDrive';
import { DEFAULT_DRIVE_APPDATA_STATE, DriveAppDataError, DriveAppDataStore, validateDriveAppDataState, validatePendingDriveAppData,
  type DriveAppDataSaveResult, type DriveAppDataSnapshot, type DriveAppDataState, type PendingDriveAppData } from './storage/driveAppData';
import { serializeDriveSave } from './storage/driveSaveQueue';
import { indexedDb, type StoredDocument } from './storage/indexedDb';
import { downloadSource, importLocalFile, moveLocalDocumentToDrive, LocalMoveConflictError, MoveRecoveryError, MoveVerificationError } from './storage/fileTransfer';
import { createWebIcon, setIconButton, WEB_ICON_SPRITE } from './icons';
import { registerPwa, type PwaRuntime } from './pwa/registerPwa';
import type { WebWorkspaceController, WorkspaceCommand, WorkspaceContextMenuRequest, WorkspaceDiagnosticSnapshot, WorkspaceFileSnapshot, DriveLibraryEntrySnapshot, WorkspaceMenuSnapshot, WorkspaceViewSnapshot, WorkspaceHostBindings } from './types/workspace';

type PreviewMode = 'normal' | 'edit' | 'practice';
type InspectorTab = InspectorTabId;
type ScoreSettingsSectionId = 'capo' | 'beginner' | 'transpose';
type MobilePane = 'source' | 'preview';
type WorkspaceViewMode = 'source' | 'split' | 'score';

interface WorkspaceSession {
  tabs: string[];
  active: string | null;
}

interface OpenTab {
  document: StoredDocument;
  source: string;
  revision: number;
  accountId?: string;
  previewMode: PreviewMode;
  pageSize: PageSize;
  orientation: PageOrientation;
  persistable: boolean;
  persistedBase: { revision: number; source: string };
  saveStatus: 'local-saved' | 'drive-saved' | 'saving' | 'draft' | 'error';
  driveTrashPending?: boolean;
  driveTrashed?: boolean;
  variableSelectedName?: string;
}

interface AppState {
  tabs: OpenTab[];
  activeKey: string | null;
  activeStorage: StorageKind;
  account?: GoogleAccount;
  drive?: GoogleDriveApi;
  folderId?: string;
  folderName?: string;
  driveGeneration: number;
  appDataStore?: DriveAppDataStore;
  appDataSnapshot?: DriveAppDataSnapshot;
  appDataPending?: PendingDriveAppData;
  appDataPendingChoice?: 'remote' | 'local';
  appDataSync: 'idle' | 'pending' | 'syncing' | 'error';
  appDataError?: string;
  inspectorTab: InspectorTab;
  mobilePane: MobilePane;
  locale: 'en' | 'ja';
  theme: 'system' | 'light' | 'dark';
  pageSize: PageSize;
  orientation: PageOrientation;
  expandPageBreakRepeats: boolean;
  storageReady: boolean;
  welcomeOpen: boolean;
  welcomeActive: boolean;
  welcomeSuppressed: boolean;
  rightDockPane: 'inspector' | 'tutorial';
  tutorialStepIndex: number;
  tutorialChordOnlyCompleted: boolean;
  tutorialMelodyCompleted: boolean;
  aboutOpen: boolean;
  previewGeneration: number;
  splitRatio: number;
  viewMode: WorkspaceViewMode;
  explorerOpen: boolean;
  inspectorOpen: boolean;
  explorerWidth: number;
  inspectorWidth: number;
  problemsOpen: boolean;
  problemsHeight: number;
  authExpired: boolean;
  lastProgression?: {
    target: ProgressionTarget; operation: ProgressionEditOperation; bars: ProgressionBars;
    candidates: ProgressionCandidate[]; source: string; revision: number;
  };
  progressionBars: ProgressionBars;
  progressionOperation: ProgressionEditOperation;
  progressionStartMeasure?: number;
  progressionCandidateId?: string;
  progressionError?: string;
  progressionAuditionMode: 'chord' | 'bars' | 'melody' | 'song';
  progressionSide: 'A' | 'B';
  progressionSpeed: 50 | 75 | 100 | 125 | 150;
  scoreSettingsSection: ScoreSettingsSectionId;
  audioCandidateId?: string;
  audioStatus: string;
}

interface PreviewModeDraftCheck {
  identity: { documentUri: string; documentVersion: number; previewGeneration: number };
  resolve: (hasDraft: boolean | undefined) => void;
}

const DEFAULT_SOURCE = 'title: My song\n\ntempo: 96\n\n[Verse]\nC | G | Am | F |\n';
const GUITAR_MARK_URL = new URL('../../media/icons/guitardsl-sidebar.svg', import.meta.url).href;
const GOOGLE_DRIVE_LOGO_URL = new URL('../../media/icons/google-drive-2026-color.png', import.meta.url).href;

const STRINGS = {
  en: {
    files: 'Files', project: 'EXPLORER', local: 'On this device', drive: 'Google Drive', newScore: 'New score', connect: 'Connect to Google Drive', connectInline: 'Connect',
    reconnect: 'Reconnect Drive', connecting: 'Connecting…', connectedAs: 'Connected as', disconnect: 'Disconnect',
    disconnectPendingConfirm: 'Google Drive app settings are not synchronized. Disconnect anyway? Pending settings for this account and local drafts will be kept for the next connection.',
    openDrive: 'Import from Google Drive…',
    addFile: 'Import file', source: 'Source', preview: 'Preview', inspector: 'Inspector', document: 'Document',
    variables: 'Variables', settings: 'Settings', progression: 'Progression', save: 'Save', saved: 'Saved locally',
    draft: 'Local draft saved', saving: 'Saving draft…', unsaved: 'Unsaved changes', downloadPdf: 'Download PDF',
    moveDrive: 'Move to Drive', closeTab: 'Close', language: 'Language',
    theme: 'Theme', pageSize: 'Page size', orientation: 'Orientation', portrait: 'Portrait', landscape: 'Landscape',
    targetMeasure: 'Target measure',
    narrowSource: 'Source', narrowPreview: 'Score', createFirst: 'Create a score to get started.',
    connectHint: 'Connect Google Drive to show files that this app can access.', noFolder: 'Set up the GuitarDSL Library first.',
    driveOverwriteWarning: 'A save from another device at nearly the same time may overwrite its changes.',
    driveSaveUnknown: 'Drive could not confirm the save. Your local draft is kept and no automatic retry was sent. Check Drive before saving again.',
    driveSaveUnknownApplied: 'Drive currently contains the submitted source, but the response was not confirmed. Your local draft is kept; check Drive before saving again. No automatic retry was sent.',
    driveSaveUnauthorized: 'Drive authorization expired before the save could be confirmed. Your local draft is kept. Reconnect Drive, review the file, and retry manually; the PATCH was not resent.',
    driveSaveForbidden: 'Drive denied the save due to access permissions. Your local draft is kept and no automatic retry was sent. Check file access before retrying.',
    reconnectOwner: 'Reconnect the Google account used by this tab before saving.',
    finishComposition: 'Finish the current text composition before saving or exporting.',
    draftRestoreConflict: 'Another version of this document was saved while the page was in browser history. The editor text and stored draft were kept; review them before saving again.',
    draftRestoreUnavailable: 'Could not verify the saved draft after browser restore. The editor text remains open; export it before closing this page.',
    driveAccess: 'Drive access is limited to files you open with this app or create here.', noDiagnostics: 'No diagnostics.',
    driveAuthStatus: 'Drive authorization expired. Reconnect to continue.', explorerOptions: 'Explorer options', closeExplorer: 'Close Explorer',
    resetExplorerWidth: 'Reset Explorer Width (220px)', inspectorOptions: 'Inspector options', closeInspector: 'Close Inspector',
    resetInspectorWidth: 'Reset width to default', closeProblems: 'Close Problems', severity: 'Severity', file: 'File',
    lineCol: 'Line:Col', message: 'Message', error: 'Error', warning: 'Warning',
    title: 'Title', artist: 'Artist', tempo: 'Tempo', measures: 'Measures', chords: 'Chords', errors: 'Errors',
    suggest: 'Suggest next chords', reload: 'Reload latest', saveCopy: 'Save local version as a new Drive file', cancel: 'Cancel',
    ready: 'Local storage ready', unavailable: 'Local storage is unavailable. Download your work to keep a copy.', loadingDrive: 'Loading Drive files…',
    previewEditGuard: 'Apply the pending Preview edit before changing modes.', noSuggestions: 'No suggestion is available for this score.',
    confirmDelete: 'Delete this local score and its draft?',
    audition: 'Audition', stopAudition: 'Stop audition', audioStarting: 'Starting audition…',
    audioPlaying: 'Audition playing.', audioStopped: 'Audition stopped.', audioUnavailable: 'Audio audition is unavailable.',
    problems: 'Problems', toolWindows: 'Tool windows', noProblems: 'No problems', previewEmpty: 'No score', previewInvalid: 'Unable to parse source',
    previewCheck: 'Check diagnostics', previewReady: 'Preview ready', previewFailed: 'Preview failed', resetLayout: 'Reset layout',
    sourceView: 'Source view', splitView: 'Split view', scoreView: 'Score view',
    openTab: 'Open this tab', closeTabMenu: 'Close', closeOthers: 'Close other tabs', exportSource: 'Export source', deleteFile: 'Delete', copyName: 'Copy name',
    renameFile: 'Rename', duplicateFile: 'Duplicate', downloadFile: 'Download', downloadPdfFile: 'Download as PDF', moveGoogleDrive: 'Move to Google Drive', renamePrompt: 'File name',
    newFolder: 'New folder…', refreshDrive: 'Refresh', openDriveInGoogle: 'Open in Google Drive', libraryAbout: 'About this library',
    openFolder: 'Open folder', closeFolder: 'Close folder', importHere: 'Import here…', moveFolder: 'Move to folder…', trashDriveFile: 'Move to trash',
    goToSource: 'Go to source position', expand: 'Expand', collapse: 'Collapse',
    explorer: 'Explorer', toggleExplorer: 'Toggle Explorer', toggleInspector: 'Toggle Inspector',
    help: 'Help', close: 'Close', resetLayoutConfirm: 'Reset workspace layout to defaults?',
    menuFile: 'File', menuEdit: 'Edit', menuView: 'View', menuHelp: 'Help',
    menuWelcome: 'Welcome', menuTutorial: 'Tutorial', menuLicenses: 'Licenses', menuPrivacy: 'Privacy Policy', menuTerms: 'Terms of Service', menuSource: 'Source code (GitHub)', menuAbout: 'About GuitarDSL',
    welcomeStorageError: 'Could not save the Welcome preference. Your previous setting is still active.',
    tutorialStorageError: 'Could not save tutorial progress. Your previous progress is still active.',
    downloadCopy: 'Download a copy', driveRootOptions: 'Google Drive options',
    account: 'Account', driveNotConnected: 'Not connected', driveConnecting: 'Connecting…', driveConnected: 'Connected', driveReauth: 'Reconnect required',
    undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all', find: 'Find…', replace: 'Replace…', goToLine: 'Go to line…',
    folderPromptTitle: 'Set up the GuitarDSL Library?', folderPromptBody: 'An existing GuitarDSL folder in My Drive will be reused. If none is available, create a new library folder or do this later.',
    createChoice: 'Create library', laterChoice: 'Later', createFolderConfirm: 'Create a visible GuitarDSL folder in My Drive?',
    appDataPending: 'Google Drive app state sync pending', appDataError: 'Google Drive app state could not be synchronized', appDataDuplicates: 'Multiple GuitarDSL app state files were found. The oldest file is in use; duplicates were retained.',
    appDataConflictTitle: 'Review Google Drive settings', appDataConflictBody: 'This device’s unsynchronized settings do not match the settings in Drive. Choose which settings to use.',
    reloadRemote: 'Reload remote', keepLocal: 'Keep this device’s settings', helpPopupBlocked: 'Your browser blocked the Help window. Use this link to open Help in a new tab:', openHelpLink: 'Open Help in a new tab', driveRootMenuOpen: 'Import from Google Drive…', driveRootMenuCreate: 'Set up GuitarDSL Library…',
  },
  ja: {
    files: 'ファイル', project: 'EXPLORER', local: 'このデバイス', drive: 'Google Drive', newScore: '新しい楽譜', connect: 'Google Drive に接続', connectInline: '接続',
    reconnect: 'Drive に再接続', connecting: '接続中…', connectedAs: '接続中のアカウント', disconnect: '接続を解除',
    disconnectPendingConfirm: 'Google Drive のアプリ設定は未同期です。このまま接続を解除しますか？このアカウントの保留中の設定とローカル下書きは、次回接続時に確認できるよう保持されます。',
    openDrive: 'Google Drive からインポート…',
    addFile: 'ファイルを読み込む', source: 'ソース', preview: 'プレビュー', inspector: 'インスペクター', document: '文書',
    variables: '変数', settings: '設定', progression: 'コード進行', save: '保存', saved: 'ローカルに保存済み',
    draft: '下書きを保存済み', saving: '下書きを保存中…', unsaved: '未保存の変更', downloadPdf: 'PDF をダウンロード',
    moveDrive: 'Drive に移動', closeTab: 'タブを閉じる', language: '言語',
    theme: 'テーマ', pageSize: '用紙サイズ', orientation: '向き', portrait: '縦', landscape: '横',
    targetMeasure: '対象の小節',
    narrowSource: 'ソース', narrowPreview: '譜面', createFirst: '新しい楽譜を作成してください。',
    connectHint: 'Drive に接続すると、このアプリがアクセスできるファイルを表示します。', noFolder: '先に GuitarDSL ライブラリを設定してください。',
    driveOverwriteWarning: '別の端末からほぼ同時に保存すると、その端末の編集が上書きされることがあります。',
    driveSaveUnknown: 'Drive の保存結果を確認できませんでした。下書きは保持し、自動再送していません。Drive の状態を確認してから再度保存してください。',
    driveSaveUnknownApplied: 'Drive には送信内容が見つかりましたが、応答を確認できないため下書きを保持しました。内容を確認してください。自動再送はしていません。',
    driveSaveUnauthorized: 'Drive の認証が失効したため保存を確認できません。下書きは保持しました。Drive に再接続し、ファイルの状態を確認してから手動で再試行してください。PATCH の自動再送はしていません。',
    driveSaveForbidden: 'Drive が保存を拒否しました（ファイルのアクセス権を確認してください）。下書きは保持し、自動再送していません。権限を確認してから手動で再試行してください。',
    reconnectOwner: 'このタブの保存に使う Google アカウントへ再接続してください。',
    finishComposition: '日本語入力を確定してから保存または書き出してください。',
    draftRestoreConflict: 'ブラウザー履歴への退避中に別の版が保存されました。エディターの内容と保存済み下書きは両方保持しています。再保存する前に内容を確認してください。',
    draftRestoreUnavailable: 'ブラウザー復帰後に保存済み下書きを確認できませんでした。エディターの内容は開いたままです。閉じる前に書き出してください。',
    driveAccess: 'Drive の一覧には、このアプリで開いたファイルと作成したファイルのみ表示されます。', noDiagnostics: '診断はありません。',
    driveAuthStatus: 'Drive の認証が失効しました。再接続してください。', explorerOptions: 'エクスプローラーのオプション', closeExplorer: 'エクスプローラーを閉じる',
    resetExplorerWidth: 'エクスプローラーの幅を初期値へ戻す（220px）', inspectorOptions: 'Inspector のオプション', closeInspector: 'Inspector を閉じる',
    resetInspectorWidth: '幅を初期値へ戻す', closeProblems: '問題パネルを閉じる', severity: '重要度', file: 'ファイル',
    lineCol: '行:列', message: 'メッセージ', error: 'エラー', warning: '警告',
    title: 'タイトル', artist: 'アーティスト', tempo: 'テンポ', measures: '小節', chords: 'コード', errors: 'エラー',
    suggest: '次のコードを提案', reload: '最新の内容を読み込む', saveCopy: 'ローカル版を新しい Drive ファイルとして保存', cancel: 'キャンセル',
    ready: 'ローカル保存を利用できます', unavailable: 'ローカル保存を利用できません。作業内容を残すにはダウンロードしてください。', loadingDrive: 'Drive のファイルを読み込み中…',
    previewEditGuard: 'Preview の編集中の内容を適用してからモードを切り替えてください。', noSuggestions: 'この楽譜では提案できません。',
    confirmDelete: 'このローカル楽譜と下書きを削除しますか？',
    audition: '試聴', stopAudition: '試聴を停止', audioStarting: '試聴を開始しています…',
    audioPlaying: '試聴中です。', audioStopped: '試聴を停止しました。', audioUnavailable: '試聴を利用できません。',
    problems: '問題', toolWindows: 'ツールウィンドウ', noProblems: '問題はありません', previewEmpty: '譜面がありません', previewInvalid: 'ソースを解析できません',
    previewCheck: '診断を確認してください', previewReady: 'プレビューを表示中', previewFailed: 'プレビューを表示できません', resetLayout: 'レイアウトをリセット',
    sourceView: 'ソース表示', splitView: '分割表示', scoreView: '譜面表示',
    openTab: 'このタブを開く', closeTabMenu: '閉じる', closeOthers: 'ほかのタブを閉じる', exportSource: 'ソースを書き出す', deleteFile: '削除', copyName: '名前をコピー',
    renameFile: '名前を変更', duplicateFile: '複製', downloadFile: 'ダウンロード', downloadPdfFile: 'PDF としてダウンロード', moveGoogleDrive: 'Google Drive に移動', renamePrompt: 'ファイル名',
    newFolder: '新しいフォルダー…', refreshDrive: '更新', openDriveInGoogle: 'Google Driveで開く', libraryAbout: 'ライブラリについて',
    openFolder: 'フォルダーを開く', closeFolder: 'フォルダーを閉じる', importHere: 'ここにインポート…', moveFolder: 'フォルダーへ移動…', trashDriveFile: 'ゴミ箱へ移動',
    goToSource: 'ソース位置へ移動', expand: '展開', collapse: '折りたたむ',
    explorer: 'エクスプローラー', toggleExplorer: 'Explorer の表示を切り替え', toggleInspector: 'Inspector の表示を切り替え',
    help: 'ヘルプ', close: '閉じる', resetLayoutConfirm: 'ワークスペースのレイアウトを初期状態に戻しますか？',
    menuFile: 'ファイル', menuEdit: '編集', menuView: '表示', menuHelp: 'ヘルプ',
    menuWelcome: 'ようこそ', menuTutorial: 'チュートリアル', menuLicenses: 'ライセンスの表示', menuPrivacy: 'プライバシーポリシー', menuTerms: '利用規約', menuSource: 'ソースコード（GitHub）', menuAbout: 'バージョン情報',
    welcomeStorageError: 'ようこそ画面の設定を保存できませんでした。変更前の設定を維持しています。',
    tutorialStorageError: 'チュートリアルの進捗を保存できませんでした。変更前の進捗を維持しています。',
    downloadCopy: 'コピーをダウンロード', driveRootOptions: 'Google Drive のオプション',
    account: 'アカウント', driveNotConnected: '未接続', driveConnecting: '接続中…', driveConnected: '接続済み', driveReauth: '再認証が必要',
    undo: '元に戻す', redo: 'やり直す', cut: '切り取り', copy: 'コピー', paste: '貼り付け', selectAll: 'すべて選択', find: '検索…', replace: '置換…', goToLine: '行へ移動…',
    folderPromptTitle: 'GuitarDSL ライブラリを設定しますか？', folderPromptBody: 'マイドライブ直下に既存の GuitarDSL フォルダーがあれば同じフォルダーを使います。見つからない場合は、新しいライブラリを作成するか後で設定できます。',
    createChoice: 'ライブラリを作成', laterChoice: '後で', createFolderConfirm: 'マイドライブ直下に GuitarDSL フォルダーを作成しますか？',
    appDataPending: 'Google Drive のアプリ状態は未同期です', appDataError: 'Google Drive のアプリ状態を同期できませんでした', appDataDuplicates: 'GuitarDSL のアプリ状態ファイルが複数あります。最も古いファイルを使用し、重複ファイルは残しました。',
    appDataConflictTitle: 'Google Drive の設定を確認してください', appDataConflictBody: 'この端末の未同期設定と Drive の設定が一致しません。どちらを使うか選んでください。',
    reloadRemote: 'Drive から再読み込み', keepLocal: 'この端末の設定を優先', helpPopupBlocked: 'ブラウザーがヘルプ画面を開けませんでした。次のリンクから新しいタブで開いてください:', openHelpLink: 'ヘルプを新しいタブで開く', driveRootMenuOpen: 'Google Drive からインポート…', driveRootMenuCreate: 'GuitarDSL ライブラリを設定…',
  }
} as const;

const app = document.querySelector<HTMLElement>('.app-shell')!;
const runtimeLifecycle = new AbortController();
const runtimeListenerOptions: AddEventListenerOptions = { signal: runtimeLifecycle.signal };
let runtimeDisposed = false;
let workspaceInitializing = true;
let reloadPreparationActive = false;
let reloadBaselineMatches: (() => boolean) | undefined;
let remoteAppDataRestoreInProgress = false;
let reloadPreparationRemoteRestoreOutcome: 'restored' | 'failed' | undefined;
let pageCacheSuspended = false;
let pageCacheBaseline: { activeKey: string | null; identity: DocumentIdentity; accountId: string | undefined; source: string; revision: number; editorSource: string } | undefined;
let deferredExplorerRefresh = false;
let deferredAppDataSync = false;
let previewAudioLockId: string | undefined;
let previewAudioLockPurpose: 'reload' | 'bfcache' | undefined;
let previewAudioLockAcknowledged = false;
let previewAudioLockSequence = 0;
const previewAudioStopWaiters = new Map<string, { resolve(stopped: boolean): void; timeout: number }>();
let workspaceResizeObserver: ResizeObserver | undefined;
let removePreviewMessageListener = () => {};
let unsubscribePwaRuntime = () => {};
// Do not accept edits or create documents until the persisted workspace has loaded.
app.inert = true;
app.setAttribute('aria-busy', 'true');
const sharedSettingsScript = document.createElement('script');
sharedSettingsScript.textContent = inspectorSettingsSource;
document.body.append(sharedSettingsScript);
sharedSettingsScript.remove();
const state: AppState = {
  tabs: [], activeKey: null, activeStorage: 'local', inspectorTab: 'variables', mobilePane: 'source',
  locale: navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en', theme: 'system', pageSize: 'A4',
    orientation: 'portrait', expandPageBreakRepeats: true, storageReady: false,
    welcomeOpen: false, welcomeActive: false, welcomeSuppressed: false,
    rightDockPane: 'inspector', tutorialStepIndex: 0, tutorialChordOnlyCompleted: false, tutorialMelodyCompleted: false, aboutOpen: false,
    previewGeneration: 0,
    progressionBars: 4, progressionOperation: 'append', progressionAuditionMode: 'bars', progressionSide: 'B', progressionSpeed: 100,
  scoreSettingsSection: 'capo',
    audioStatus: '',
    splitRatio: 0.4, viewMode: 'split', explorerOpen: true, inspectorOpen: true,
    explorerWidth: 220, inspectorWidth: 300, problemsOpen: true, problemsHeight: 200, authExpired: false,
    driveGeneration: 0, appDataSync: 'idle'
};
const webScoreSettingsSections = {
  capo: new CapoSection(), beginner: new BeginnerSection(), transpose: new TransposeSection()
};
const auth = new GoogleOAuth();
const draftWrites = new Map<string, Promise<void>>();
const closingTabs = new WeakMap<OpenTab, Promise<void>>();
const previewModeDraftChecks = new Map<string, PreviewModeDraftCheck>();
let previewModeDraftCheckSequence = 0;
let moveToDriveInProgress = false;
let driveConnectInProgress = false;
let driveConnectInterrupted = false;
let activeDriveOperations = 0;
let activeDriveListOperations = 0;
let activeDriveReadOperations = 0;
let activeDriveWorkflowOperations = 0;
let workspaceOperationGeneration = 0;
let updatePreparationGeneration = 0;
let activeWorkspaceOperationCount = 0;
const activeWorkspaceOperations = new Set<Promise<unknown>>();
const explorerListRequests = createLatestRequestSequence();
let driveSaveNeedsReviewAfterBfcache = false;
let appDataSyncTimer = 0;
let appDataSyncQueue: Promise<void> = Promise.resolve();
let appDataPendingQueue: Promise<void> = Promise.resolve();
let appDataDesiredSequence = 0;
let latestAppDataDesired: {
  accountId: string; drive: GoogleDriveApi; generation: number; workspaceGeneration: number;
  sequence: number; state: DriveAppDataState
} | undefined;
let appDataOfflinePending = false;
let appDataUnknownOutcome = false;
let restoringDriveSession = false;
let helpBlobUrl = '';
let localExpanded = true;
let driveExpanded = true;
let explorerAutoHidden = false;
let inspectorAutoHidden = false;
let mobileDockOpen = false;
let workspaceMessage: WorkspaceViewSnapshot['message'];
let workspaceStorageStatus = '';
let cursorPositionLabel = 'Ln 1, Col 1';
let previewStatusLabel = '';
let localFileRows: StoredDocument[] = [];
let driveFileRows: DriveFile[] = [];
const driveChildrenByParent = new Map<string, DriveFile[]>();
const driveExpandedFolders = new Set<string>();
const driveLoadingFolders = new Set<string>();
const driveFolderErrors = new Map<string, string>();
const driveChildRequestSequences = new Map<string, number>();
let workspaceMenuSnapshot: Readonly<WorkspaceMenuSnapshot> | undefined;
let workspaceMenuActions: Array<WorkspaceMenuAction> = [];
const workspaceListeners = new Set<(snapshot: Readonly<WorkspaceViewSnapshot>) => void>();
let pwaRuntime: PwaRuntime;
const derivedScoreCache = createWorkspaceScoreCache(
  (source, expandPageBreakRepeats) => parseGuitarDsl(source, { expandPageBreakRepeats })
);

function syncWorkspaceInteractionLock(): void {
  const locked = workspaceInitializing || moveToDriveInProgress || reloadPreparationActive
    || remoteAppDataRestoreInProgress || pageCacheSuspended;
  app.inert = locked;
  if (locked) app.setAttribute('aria-busy', 'true');
  else app.removeAttribute('aria-busy');
}

function requestPreviewAudioLock(purpose: 'reload' | 'bfcache'): Promise<boolean> {
  if (!activeTab()) return Promise.resolve(true);
  if (previewAudioLockId) return Promise.resolve(previewAudioLockAcknowledged);
  const frame = scoreFrame.contentWindow;
  if (!frame) return Promise.resolve(false);
  const leaseId = `workspace-${purpose}-${++previewAudioLockSequence}`;
  previewAudioLockId = leaseId;
  previewAudioLockPurpose = purpose;
  previewAudioLockAcknowledged = false;
  return new Promise(resolve => {
    const timeout = window.setTimeout(() => {
      const waiter = previewAudioStopWaiters.get(leaseId);
      if (!waiter) return;
      previewAudioStopWaiters.delete(leaseId);
      waiter.resolve(false);
    }, 2000);
    previewAudioStopWaiters.set(leaseId, { resolve, timeout });
    frame.postMessage({ command: 'progressionAudioLock', leaseId }, '*');
  });
}

function releasePreviewAudioLock(purpose: 'reload' | 'bfcache'): void {
  const leaseId = previewAudioLockId;
  if (!leaseId || previewAudioLockPurpose !== purpose) return;
  scoreFrame.contentWindow?.postMessage({ command: 'progressionAudioUnlock', leaseId }, '*');
  const waiter = previewAudioStopWaiters.get(leaseId);
  if (waiter) {
    window.clearTimeout(waiter.timeout);
    previewAudioStopWaiters.delete(leaseId);
    waiter.resolve(false);
  }
  previewAudioLockId = undefined;
  previewAudioLockPurpose = undefined;
  previewAudioLockAcknowledged = false;
}

function capturePageCacheBaseline(): void {
  const tab = activeTab();
  pageCacheBaseline = tab ? {
    activeKey: state.activeKey,
    identity: { ...tab.document.identity },
    accountId: tab.accountId,
    source: tab.source,
    revision: tab.revision,
    editorSource: sourceEditor.getText()
  } : undefined;
}

function suspendWorkspaceForBfcache(): void {
  if (runtimeDisposed) return;
  workspaceOperationGeneration += 1;
  capturePageCacheBaseline();
  if (pageCacheSuspended) return;
  if (driveConnectInProgress) {
    driveConnectInterrupted = true;
    driveConnectInProgress = false;
  }
  pageCacheSuspended = true;
  syncWorkspaceInteractionLock();
  publishWorkspaceSnapshot();
  if (progressionAudioLease.activeLeaseId) {
    void stopCandidateAudition().then(() => {
      if (pageCacheSuspended && !reloadPreparationActive) void requestPreviewAudioLock('bfcache');
    }).catch(error => {
      if (pageCacheSuspended) showMessage(shortError(error), 'error');
    });
  } else void requestPreviewAudioLock('bfcache');
}

async function resumeWorkspaceFromBfcache(): Promise<void> {
  if (runtimeDisposed || !pageCacheSuspended) return;
  workspaceOperationGeneration += 1;
  const resumeGeneration = workspaceOperationGeneration;
  const baseline = pageCacheBaseline;
  const tabs = [...state.tabs];
  const retryDrafts: OpenTab[] = [];
  let draftRestoreMessage: string | undefined;
  for (const tab of tabs) {
    const key = tabKey(tab);
    const identity = { ...tab.document.identity };
    const accountId = tab.accountId;
    const source = tab.source;
    const revision = tab.revision;
    const oldPersistedBase = { ...tab.persistedBase };
    try {
      const persisted = await indexedDb.getDraftBaseline(identity, accountId);
      if (runtimeDisposed || !pageCacheSuspended || resumeGeneration !== workspaceOperationGeneration) return;
      if (!state.tabs.includes(tab) || tabKey(tab) !== key || !sameTabIdentity(tab, identity, accountId)
        || tab.source !== source || tab.revision !== revision) {
        draftRestoreMessage ??= strings().draftRestoreConflict;
        continue;
      }
      if (!persisted) {
        tab.saveStatus = 'error';
        draftRestoreMessage ??= strings().draftRestoreUnavailable;
        continue;
      }
      const persistedMatchesEditor = persisted.revision === revision && persisted.source === source;
      const persistedMatchesPrevious = persisted.revision === oldPersistedBase.revision && persisted.source === oldPersistedBase.source;
      if (persistedMatchesEditor || persistedMatchesPrevious) {
        tab.persistedBase = { revision: persisted.revision, source: persisted.source };
        if (persistedMatchesEditor) {
          tab.saveStatus = persisted.kind === 'draft' ? 'draft'
            : tab.document.identity.storage === 'drive' ? 'drive-saved' : 'local-saved';
        } else if (source !== persisted.source || revision !== persisted.revision) retryDrafts.push(tab);
        else tab.saveStatus = persisted.kind === 'draft' ? 'draft'
          : tab.document.identity.storage === 'drive' ? 'drive-saved' : 'local-saved';
      } else {
        tab.saveStatus = 'error';
        draftRestoreMessage ??= strings().draftRestoreConflict;
      }
    } catch {
      if (runtimeDisposed || !pageCacheSuspended || resumeGeneration !== workspaceOperationGeneration) return;
      tab.saveStatus = 'error';
      draftRestoreMessage ??= strings().draftRestoreUnavailable;
    }
  }
  if (runtimeDisposed || !pageCacheSuspended || resumeGeneration !== workspaceOperationGeneration) return;
  const tab = activeTab();
  const documentStillMatches = baseline
    ? Boolean(tab && state.activeKey === baseline.activeKey
      && sameTabIdentity(tab, baseline.identity, baseline.accountId)
      && tab.source === baseline.source && tab.revision === baseline.revision
      && sourceEditor.getText() === baseline.editorSource)
    : !tab;
  pageCacheBaseline = undefined;
  pageCacheSuspended = false;
  if (driveConnectInterrupted) {
    driveConnectInterrupted = false;
    if (!state.appDataSnapshot) {
      state.account = undefined; state.drive = undefined; state.folderId = undefined; state.folderName = undefined;
      state.appDataStore = undefined; state.appDataPending = undefined; state.appDataPendingChoice = undefined;
      state.appDataSync = 'idle'; state.appDataError = undefined; state.driveGeneration += 1;
    }
    workspaceMessage = {
      text: state.locale === 'ja'
        ? 'ブラウザー履歴への退避中にGoogle Drive接続が中断されました。状態を確認してから再接続してください。'
        : 'Google Drive connection was interrupted while this page entered browser history. Review the session and reconnect if needed.',
      kind: 'info'
    };
  }
  releasePreviewAudioLock('bfcache');
  syncWorkspaceInteractionLock();
  applyWorkspaceLayout();
  applySplitRatio();
  if (!documentStillMatches) {
    workspaceMessage = {
      text: state.locale === 'ja'
        ? 'ブラウザー復帰中に文書状態が変わりました。内容を確認してください。'
        : 'The document changed while the browser restored this page. Review its contents before saving.',
      kind: 'error'
    };
  }
  if (draftRestoreMessage) {
    workspaceMessage = { text: draftRestoreMessage, kind: 'error' };
  }
  if (driveSaveNeedsReviewAfterBfcache) {
    driveSaveNeedsReviewAfterBfcache = false;
    workspaceMessage = {
      text: state.locale === 'ja'
        ? 'ブラウザー復帰前にDrive保存結果を確認できませんでした。ローカル下書きは保持されています。Driveを確認してから必要な場合だけ再保存してください。'
        : 'The Drive save result was not confirmed before browser suspension. The local draft is kept; check Drive before retrying.',
      kind: 'error'
    };
  }
  publishWorkspaceSnapshot();
  for (const tab of retryDrafts) {
    if (state.tabs.includes(tab) && hasUnpersistedDraft(tab)) scheduleDraft(tab);
  }
  if (deferredExplorerRefresh) {
    deferredExplorerRefresh = false;
    void refreshExplorerSnapshot();
  }
  if (!reloadPreparationActive && navigator.onLine && (deferredAppDataSync || state.appDataSync === 'pending'
    || appDataUnknownOutcome)) {
    deferredAppDataSync = false;
    scheduleDriveAppDataSync();
  }
}

const editor = app.querySelector<HTMLElement>('.editor-surface')!;
const sourceEditor = new SourceEditorSurface(editor, onEditorInput, renderCursorPosition);
let lastPdfInputForTest: string | undefined;
if (import.meta.env.DEV) {
  const testWindow = window as Window & {
    __guitarDslReadSource?: () => string;
    __guitarDslReplaceSource?: (source: string) => boolean;
    __guitarDslDispatchSourceEdit?: (source: string, userEvent?: string) => boolean;
    __guitarDslReadTabs?: () => Array<{
      key: string; identity: DocumentIdentity; accountId?: string; source: string; revision: number;
      persistedBase: { revision: number; source: string }; saveStatus: OpenTab['saveStatus']
    }>;
    __guitarDslReadLastPdfInput?: () => string | undefined;
    __guitarDslReadSelection?: () => { from: number; to: number; head: number };
    __guitarDslRenderAll?: () => void;
    __guitarDslSetCursor?: (offset: number) => void;
    __guitarDslUndo?: () => boolean;
    __guitarDslRedo?: () => boolean;
  };
  testWindow.__guitarDslReadSource = () => sourceEditor.getSource();
  testWindow.__guitarDslReplaceSource = source => sourceEditor.replaceSource(source);
  testWindow.__guitarDslDispatchSourceEdit = (source, userEvent) => sourceEditor.dispatchSourceEdit(source, userEvent);
  testWindow.__guitarDslReadTabs = () => state.tabs.map(tab => ({
    key: tabKey(tab), identity: { ...tab.document.identity }, accountId: tab.accountId, source: tab.source, revision: tab.revision,
    persistedBase: { ...tab.persistedBase }, saveStatus: tab.saveStatus
  }));
  testWindow.__guitarDslReadLastPdfInput = () => lastPdfInputForTest;
  testWindow.__guitarDslReadSelection = () => sourceEditor.selection();
  testWindow.__guitarDslRenderAll = renderAll;
  testWindow.__guitarDslSetCursor = offset => sourceEditor.setSelection(offset);
  testWindow.__guitarDslUndo = () => sourceEditor.undo();
  testWindow.__guitarDslRedo = () => sourceEditor.redo();
}
const scoreFrame = app.querySelector<HTMLIFrameElement>('#score-frame')!;
const inspectorContent = app.querySelector<HTMLDivElement>('#inspector-content')!;
const sharedSettingsHost = app.querySelector<HTMLDivElement>('#shared-inspector-settings')!;
const sharedSettingsParking = app.querySelector<HTMLDivElement>('#inspector-settings-parking')!;
const inspectorTabsHost = app.querySelector<HTMLDivElement>('#inspector-tabs-host')!;
interface ActiveWebAudioRun {
  leaseId: string;
  requestId: string;
  nodes: Set<{ oscillator: OscillatorNode; gain: GainNode }>;
}
const audioResumePromises = new Map<string, Promise<boolean>>();
let auditionAudioContext: AudioContext | undefined;
let auditionMasterGain: GainNode | undefined;
let activeWebAudioRun: ActiveWebAudioRun | undefined;
let auditionCompletionTimer = 0;
const pendingAudioStopTimers = new Map<string, number>();
let progressionAudioLease: ProgressionAudioLeaseCoordinator;
let progressionSessionGeneration = 0;

progressionAudioLease = new ProgressionAudioLeaseCoordinator({
  hasPreview: () => Boolean(activeTab() && scoreFrame.contentWindow),
  lockPreview: async leaseId => {
    const frame = scoreFrame.contentWindow;
    if (!frame) return false;
    frame.postMessage({ command: 'progressionAudioLock', leaseId }, '*');
    return true;
  },
  unlockPreview: leaseId => scoreFrame.contentWindow?.postMessage({ command: 'progressionAudioUnlock', leaseId }, '*'),
  startInspector: message => startWebAuditionAudio(message),
  stopInspector: (leaseId, requestId) => {
    stopWebAuditionAudio(leaseId, requestId);
    return Promise.resolve(true);
  },
  reportStartError: requestId => {
    audioResumePromises.delete(requestId);
    state.audioStatus = strings().audioUnavailable;
    state.audioCandidateId = undefined;
    renderInspector();
  }
});

function strings() { return STRINGS[state.locale]; }
function activeTab(): OpenTab | undefined { return findActiveTab(state.tabs, state.activeKey); }

function tabOperationSnapshot(tab: OpenTab): DocumentSnapshot & { accountId?: string } {
  return { ...snapshot(tab), accountId: tab.accountId };
}

function tabMatchesSnapshot(tab: OpenTab, expected: DocumentSnapshot & { accountId?: string }): boolean {
  return state.tabs.includes(tab)
    && sameTabIdentity(tab, expected.identity, expected.accountId)
    && tab.revision === expected.revision
    && tab.source === expected.source;
}

function renderDriveOperationControls(): void {
  publishWorkspaceSnapshot();
}

function trackWorkspaceOperation<T>(operation: () => T | Promise<T>): T | Promise<T> | undefined {
  if (runtimeDisposed || reloadPreparationActive || remoteAppDataRestoreInProgress || pageCacheSuspended) return undefined;
  activeWorkspaceOperationCount += 1;
  try {
    const result = operation();
    if (result && typeof (result as Promise<T>).then === 'function') {
      let tracked: Promise<T>;
      tracked = Promise.resolve(result).finally(() => {
        activeWorkspaceOperations.delete(tracked);
        activeWorkspaceOperationCount = Math.max(0, activeWorkspaceOperationCount - 1);
        if (activeWorkspaceOperationCount === 0 && deferredExplorerRefresh
          && !runtimeDisposed && !reloadPreparationActive && !pageCacheSuspended) {
          deferredExplorerRefresh = false;
          queueMicrotask(() => { void refreshExplorerSnapshot(); });
        }
      });
      activeWorkspaceOperations.add(tracked);
      return tracked;
    }
    activeWorkspaceOperationCount = Math.max(0, activeWorkspaceOperationCount - 1);
    return result;
  } catch (error) {
    activeWorkspaceOperationCount = Math.max(0, activeWorkspaceOperationCount - 1);
    throw error;
  }
}

function workspaceOperationIsCurrent(generation: number): boolean {
  return !runtimeDisposed && !pageCacheSuspended && generation === workspaceOperationGeneration;
}

async function withDriveOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (reloadPreparationActive || remoteAppDataRestoreInProgress || pageCacheSuspended) {
    throw new Error('Drive operations are paused while workspace settings are being restored or the page is in browser history cache.');
  }
  activeDriveOperations += 1;
  renderDriveOperationControls();
  try { return await operation(); }
  finally {
    activeDriveOperations = Math.max(0, activeDriveOperations - 1);
    renderDriveOperationControls();
  }
}
function esc(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
function shortError(error: unknown): string {
  if (error instanceof GoogleAuthError && error.code === 'insufficient-scope' && state.locale === 'ja') {
    return 'Google Drive の2つの権限が必要です。もう一度接続し、要求された両方の権限を許可してください。';
  }
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred.';
}
function markDriveAuthState(error: unknown): void {
  if (error instanceof GoogleAuthError && (error.code === 'expired' || error.code === 'insufficient-scope') || error instanceof DriveApiError && error.status === 401) {
    state.authExpired = true;
    renderAll();
  }
}
function showMessage(message: string, kind: 'info' | 'error' = 'info'): void {
  workspaceMessage = message ? { text: message, kind } : undefined;
  publishWorkspaceSnapshot();
}
function activeIdentityLabel(tab: OpenTab): string {
  return tab.document.identity.storage === 'drive'
    ? `drive:${tab.accountId}:${tab.document.identity.fileId}`
    : `local:${tab.document.identity.fileId}`;
}
function snapshot(tab: OpenTab): DocumentSnapshot {
  return { identity: tab.document.identity, revision: tab.revision, source: tab.source };
}
function rebuildDriveFileRows(): void {
  const unique = new Map<string, DriveFile>();
  for (const children of driveChildrenByParent.values()) {
    for (const child of children) {
      if (child.mimeType !== 'application/vnd.google-apps.folder' && isSupportedDriveFile(child.name)) unique.set(child.id, child);
    }
  }
  driveFileRows = [...unique.values()];
}
function driveLibraryEntriesSnapshot(): DriveLibraryEntrySnapshot[] {
  const accountId = state.account?.accountId;
  const entries: DriveLibraryEntrySnapshot[] = [];
  const seen = new Set<string>();
  const visit = (parentId: string, depth: number) => {
    for (const row of driveChildrenByParent.get(parentId) ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const kind = row.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'score';
      const selected = kind === 'score' && state.tabs.some(tab => tab.document.identity.storage === 'drive'
        && tab.document.identity.fileId === row.id && tab.accountId === accountId && tabKey(tab) === state.activeKey);
      entries.push({
        identity: { storage: 'drive', fileId: row.id }, accountId, name: row.name,
        revision: Number(row.version) || 0, selected, updatedAt: Date.parse(row.modifiedTime) || undefined,
        kind, parentId, depth, expanded: driveExpandedFolders.has(row.id), loading: driveLoadingFolders.has(row.id),
        error: driveFolderErrors.get(row.id)
      });
      if (kind === 'folder' && driveExpandedFolders.has(row.id)) visit(row.id, depth + 1);
    }
  };
  if (state.folderId && driveExpanded) visit(state.folderId, 0);
  return entries;
}
function workspaceSnapshot(): Readonly<WorkspaceViewSnapshot> {
  const tab = activeTab();
  const derived = tab ? derivedScoreFor(tab) : undefined;
  const diagnostics: WorkspaceDiagnosticSnapshot[] = (derived?.score?.diagnostics ?? []).map(item => {
    const from = derived!.offsetFor(item.line, item.startCol);
    return {
      severity: item.severity,
      message: formatDiagnostic(item.code, item.args, state.locale),
      file: tab?.document.name ?? '', line: item.line + 1, column: item.startCol + 1,
      from, to: from + Math.max(1, item.endCol - item.startCol)
    };
  });
  const localFiles: WorkspaceFileSnapshot[] = localFileRows.map(row => {
    const open = state.tabs.find(candidate => candidate.document.identity.storage === 'local'
      && candidate.document.identity.fileId === row.identity.fileId);
    return {
      identity: row.identity, name: open?.document.name ?? row.name, revision: open?.revision ?? row.revision,
      selected: row.identity.fileId === tab?.document.identity.fileId && tab.document.identity.storage === 'local',
      updatedAt: row.updatedAt, localDraft: open ? hasUnpersistedDraft(open) : false
    };
  });
  const driveFiles: WorkspaceFileSnapshot[] = driveFileRows.map(row => ({
    identity: { storage: 'drive', fileId: row.id }, accountId: state.account?.accountId,
    name: row.name, revision: Number(row.version) || 0,
    selected: tab?.document.identity.storage === 'drive' && tab.document.identity.fileId === row.id
      && tab.accountId === state.account?.accountId,
    updatedAt: Date.parse(row.modifiedTime) || undefined
  }));
  const driveEntries = driveLibraryEntriesSnapshot();
  const driveStatus = !navigator.onLine ? 'offline'
    : driveConnectInProgress ? 'connecting'
      : state.authExpired ? 'reauth'
        : state.account && state.drive ? 'connected' : 'disconnected';
  return Object.freeze({
    ready: state.storageReady,
    tabs: state.tabs.map(item => ({
      key: tabKey(item), identity: item.document.identity, accountId: item.accountId,
      name: item.document.name, source: item.source, revision: item.revision, saveStatus: item.saveStatus
    })),
    activeKey: state.activeKey, activeStorage: state.activeStorage, locale: state.locale, theme: state.theme,
    viewMode: state.viewMode, explorerOpen: state.explorerOpen, inspectorOpen: state.inspectorOpen,
    problemsOpen: state.problemsOpen, explorerAutoHidden, inspectorAutoHidden,
    localExpanded, driveExpanded, explorerWidth: state.explorerWidth, inspectorWidth: state.inspectorWidth,
    problemsHeight: state.problemsHeight, splitRatio: state.splitRatio,
    welcomeOpen: state.welcomeOpen, welcomeActive: state.welcomeActive, welcomeSuppressed: state.welcomeSuppressed,
    rightDockPane: state.rightDockPane, tutorialStepIndex: state.tutorialStepIndex,
    tutorialChordOnlyCompleted: state.tutorialChordOnlyCompleted, tutorialMelodyCompleted: state.tutorialMelodyCompleted,
    aboutOpen: state.aboutOpen,
    localFiles, driveFiles, driveEntries, diagnostics, menu: workspaceMenuSnapshot,
    online: navigator.onLine, driveStatus,
    driveGeneration: state.driveGeneration,
    driveAccountId: state.account?.accountId,
    driveAccountLabel: state.account?.emailAddress ?? state.account?.accountId,
    driveFolderName: state.folderName, driveFolderId: state.folderId,
    driveScopeNote: state.account && state.drive && navigator.onLine ? strings().driveAccess : undefined,
    driveOverwriteWarning: state.account && state.drive && navigator.onLine ? strings().driveOverwriteWarning : undefined,
    storageStatus: workspaceStorageStatus, cursorPosition: cursorPositionLabel,
    previewStatus: previewStatusLabel, driveBusy: activeDriveOperations > 0,
    saveDisabled: activeDriveOperations > 0 || Boolean(tab?.document.identity.storage === 'drive' && tab.accountId !== state.account?.accountId),
    pwa: pwaRuntime?.snapshot() ?? { updateAvailable: false, offlineReady: false, updating: false, online: navigator.onLine },
    message: workspaceMessage
  });
}

function publishWorkspaceSnapshot(): void {
  if (runtimeDisposed) return;
  const next = workspaceSnapshot();
  for (const listener of workspaceListeners) listener(next);
}

async function loadDriveChildren(parentId: string, force = false, stillCurrent: () => boolean = () => true): Promise<void> {
  const drive = state.drive;
  const accountId = state.account?.accountId;
  const generation = state.driveGeneration;
  const rootId = state.folderId;
  if (!drive || !accountId || !rootId || state.authExpired || !navigator.onLine) return;
  const isKnownFolder = parentId === rootId || [...driveChildrenByParent.values()].some(rows => rows.some(row =>
    row.id === parentId && row.mimeType === 'application/vnd.google-apps.folder'));
  if (!isKnownFolder) return;
  if (!force && driveChildrenByParent.has(parentId)) return;
  const sequence = (driveChildRequestSequences.get(parentId) ?? 0) + 1;
  driveChildRequestSequences.set(parentId, sequence);
  const isCurrent = () => stillCurrent() && state.drive === drive && state.account?.accountId === accountId
    && state.driveGeneration === generation && state.folderId === rootId && !state.authExpired
    && driveChildRequestSequences.get(parentId) === sequence;
  driveLoadingFolders.add(parentId);
  driveFolderErrors.delete(parentId);
  publishWorkspaceSnapshot();
  activeDriveListOperations += 1;
  try {
    const children = await drive.listChildren(parentId);
    if (!isCurrent()) return;
    driveChildrenByParent.set(parentId, children);
    rebuildDriveFileRows();
  } catch (error) {
    if (!isCurrent()) return;
    driveChildrenByParent.delete(parentId);
    driveFolderErrors.set(parentId, shortError(error));
    rebuildDriveFileRows();
    markDriveAuthState(error);
    showMessage(shortError(error), 'error');
  } finally {
    activeDriveListOperations = Math.max(0, activeDriveListOperations - 1);
    if (driveChildRequestSequences.get(parentId) === sequence) {
      driveLoadingFolders.delete(parentId);
      if (isCurrent()) publishWorkspaceSnapshot();
    }
  }
}

function refreshExplorerSnapshot(): Promise<void> {
  if (runtimeDisposed) return Promise.resolve();
  if (reloadPreparationActive || remoteAppDataRestoreInProgress || pageCacheSuspended) {
    deferredExplorerRefresh = true;
    return Promise.resolve();
  }
  const tracked = trackWorkspaceOperation(refreshExplorerSnapshotOperation);
  return tracked instanceof Promise ? tracked : Promise.resolve();
}

async function refreshExplorerSnapshotOperation(): Promise<void> {
  const sequence = explorerListRequests.begin();
  const operationGeneration = workspaceOperationGeneration;
  const preparationGeneration = updatePreparationGeneration;
  const drive = state.drive;
  const accountId = state.account?.accountId;
  const driveGeneration = state.driveGeneration;
  const folderId = state.folderId;
  const requestIsCurrent = () => explorerListRequests.isLatest(sequence)
    && preparationGeneration === updatePreparationGeneration && workspaceOperationIsCurrent(operationGeneration);
  const driveSessionIsCurrent = () => Boolean(drive && accountId && folderId && state.drive === drive
    && state.account?.accountId === accountId && state.driveGeneration === driveGeneration
    && state.folderId === folderId && !state.authExpired && navigator.onLine);

  let localListIsCurrent = false;
  try {
    localListIsCurrent = await readLocalExplorerRowsIfCurrent(
      () => indexedDb.listDocuments('local'), requestIsCurrent, rows => { localFileRows = rows; }
    );
  } catch (error) {
    if (requestIsCurrent()) {
      state.storageReady = false;
      showMessage(`${strings().unavailable} ${shortError(error)}`, 'error');
    }
    return;
  }
  if (!localListIsCurrent || !requestIsCurrent()) {
    if (!runtimeDisposed) deferredExplorerRefresh = true;
    return;
  }
  if (!navigator.onLine || !drive || !accountId || !folderId || state.authExpired) {
    driveFileRows = [];
    driveChildrenByParent.clear();
    driveFolderErrors.clear();
    publishWorkspaceSnapshot();
    return;
  }
  if (!driveSessionIsCurrent()) return;
  if (driveExpanded) await loadDriveChildren(folderId, true, requestIsCurrent);
  else if (requestIsCurrent() && driveSessionIsCurrent()) publishWorkspaceSnapshot();
}

function derivedScoreFor(tab: OpenTab) {
  return derivedScoreCache.get(activeIdentityLabel(tab), tab.revision, tab.source, state.locale, state.expandPageBreakRepeats);
}

function currentScore(source: string, tab?: OpenTab): ParsedScore | undefined {
  if (tab?.source === source) return derivedScoreFor(tab).score;
  try { return parseGuitarDsl(source, { expandPageBreakRepeats: state.expandPageBreakRepeats }); }
  catch { return undefined; }
}
function editorReadyForDocumentChange(): boolean {
  if (sourceEditor.flushPendingEdit()) return true;
  showMessage(state.locale === 'ja' ? '日本語入力の確定後に文書を切り替えてください。' : 'Finish the current text composition before switching documents.', 'info');
  return false;
}
function editorReadyForSnapshot(tab: OpenTab): boolean {
  if (state.activeKey !== tabKey(tab) || sourceEditor.flushPendingEdit()) return true;
  showMessage(strings().finishComposition, 'info');
  return false;
}
async function setActive(key: string, isCurrent?: () => boolean): Promise<void> {
  const operationGeneration = workspaceOperationGeneration;
  const next = state.tabs.find(tab => tabKey(tab) === key);
  if (!next || isCurrent && !isCurrent()) return;
  if (state.activeKey !== key && !editorReadyForDocumentChange()) return;
  if (state.activeKey !== key) resetWebScoreSettings();
  if (progressionAudioLease.activeSessionUri && progressionAudioLease.activeSessionUri !== activeIdentityLabel(next)) {
    await stopCandidateAudition();
  }
  if (!workspaceOperationIsCurrent(operationGeneration) || isCurrent && !isCurrent()) return;
  if (state.activeKey !== key && !editorReadyForDocumentChange()) return;
  state.activeKey = key;
  state.welcomeActive = false;
  const tab = activeTab();
  if (!tab) return;
  state.activeStorage = tab.document.identity.storage;
  renderAll();
  void persistSessions();
}

function driveWorkspaceState(): DriveAppDataState {
  const previous = state.appDataPending?.state ?? state.appDataSnapshot?.state ?? DEFAULT_DRIVE_APPDATA_STATE;
  const accountId = state.account?.accountId;
  const tabs = accountId ? state.tabs.filter(tab => tab.document.identity.storage === 'drive' && tab.accountId === accountId
    && !tab.driveTrashed) : [];
  const activeId = tabs.find(tab => tabKey(tab) === state.activeKey)?.document.identity.fileId ?? null;
  const recent = activeId ? [activeId, ...previous.recentDriveFileIds.filter(id => id !== activeId)] : previous.recentDriveFileIds;
  return {
    ...previous,
    selectedFolderId: state.folderId ?? previous.selectedFolderId,
    openDriveFileIds: [...new Set(tabs.map(tab => tab.document.identity.fileId))].slice(0, 30),
    activeDriveFileId: activeId,
    recentDriveFileIds: [...new Set(recent)].slice(0, 50)
  };
}

function pendingDriveAppDataKey(accountId: string): string { return `pending-drive-state:${accountId}`; }

function sameDriveAppDataState(left: DriveAppDataState, right: DriveAppDataState): boolean {
  return JSON.stringify(validateDriveAppDataState(left)) === JSON.stringify(validateDriveAppDataState(right));
}

function desiredDriveAppData(
  accountId: string, drive: GoogleDriveApi, generation: number, value: DriveAppDataState, force = false
): NonNullable<typeof latestAppDataDesired> {
  const normalized = validateDriveAppDataState(value);
  const latest = latestAppDataDesired;
  if (!force && latest?.accountId === accountId && latest.drive === drive && latest.generation === generation
    && latest.workspaceGeneration === workspaceOperationGeneration
    && sameDriveAppDataState(latest.state, normalized)) return latest;
  const desired = {
    accountId, drive, generation, workspaceGeneration: workspaceOperationGeneration,
    sequence: ++appDataDesiredSequence, state: normalized
  };
  latestAppDataDesired = desired;
  return desired;
}

function appDataDesiredIsCurrent(
  desired: NonNullable<typeof latestAppDataDesired>, allowReloadPreparation = false
): boolean {
  return latestAppDataDesired === desired && desired.workspaceGeneration === workspaceOperationGeneration
    && !runtimeDisposed && !pageCacheSuspended && (!reloadPreparationActive || allowReloadPreparation)
    && driveSessionIsCurrent(desired.accountId, desired.drive, desired.generation);
}

function isLatestAppDataDesired(desired: NonNullable<typeof latestAppDataDesired>): boolean {
  return appDataDesiredIsCurrent(desired);
}

async function readPendingDriveAppData(accountId: string): Promise<PendingDriveAppData | undefined> {
  const value = await indexedDb.getValue<unknown>('settings', pendingDriveAppDataKey(accountId));
  return value === undefined ? undefined : validatePendingDriveAppData(value, accountId);
}

async function persistPendingDriveAppData(
  accountId: string, drive: GoogleDriveApi, generation: number, value: DriveAppDataState,
  desired = desiredDriveAppData(accountId, drive, generation, value), allowReloadPreparation = false
): Promise<boolean> {
  const pending = validatePendingDriveAppData({ schemaVersion: 1, accountId, state: value, updatedAt: Date.now() }, accountId);
  const write = appDataPendingQueue.then(async () => {
    if (!appDataDesiredIsCurrent(desired, allowReloadPreparation)) return false;
    await indexedDb.setValue('settings', pendingDriveAppDataKey(accountId), pending);
    if (!appDataDesiredIsCurrent(desired, allowReloadPreparation)) return false;
    state.appDataPending = pending;
    return true;
  });
  appDataPendingQueue = write.then(() => undefined, () => undefined);
  return write;
}

async function clearPendingDriveAppData(
  accountId: string, drive: GoogleDriveApi, generation: number, expectedState?: DriveAppDataState,
  desired?: NonNullable<typeof latestAppDataDesired>, allowReloadPreparation = false
): Promise<boolean> {
  const write = appDataPendingQueue.then(async () => {
    if (desired ? !appDataDesiredIsCurrent(desired, allowReloadPreparation)
      : !driveSessionIsCurrent(accountId, drive, generation)) return false;
    const persisted = await readPendingDriveAppData(accountId);
    if (desired && !appDataDesiredIsCurrent(desired, allowReloadPreparation)) return false;
    if (expectedState && persisted && !sameDriveAppDataState(persisted.state, expectedState)) return false;
    if (expectedState && !persisted && state.appDataPending) return false;
    await indexedDb.deleteValue('settings', pendingDriveAppDataKey(accountId));
    if (desired ? !appDataDesiredIsCurrent(desired, allowReloadPreparation)
      : !driveSessionIsCurrent(accountId, drive, generation)) return false;
    state.appDataPending = undefined;
    state.appDataPendingChoice = undefined;
    return true;
  });
  appDataPendingQueue = write.then(() => undefined, () => undefined);
  return write;
}

function scheduleDriveAppDataSync(): void {
  if (remoteAppDataRestoreInProgress) return;
  if (restoringDriveSession || !state.account || !state.drive || !state.appDataStore || !state.appDataSnapshot) return;
  if (driveConnectInProgress) {
    deferredAppDataSync = true;
    return;
  }
  if (reloadPreparationActive || pageCacheSuspended) {
    deferredAppDataSync = true;
    state.appDataSync = 'pending';
    renderStorageStatus();
    return;
  }
  const accountId = state.account.accountId;
  const drive = state.drive;
  const generation = state.driveGeneration;
  const next = driveWorkspaceState();
  const previous = latestAppDataDesired;
  const desired = desiredDriveAppData(accountId, drive, generation, next);
  if (previous === desired && !appDataUnknownOutcome) return;
  if (sameDriveAppDataState(next, state.appDataSnapshot.state) && !state.appDataPending
    && state.appDataSync === 'idle' && !appDataSyncTimer) return;
  state.appDataSync = 'pending';
  renderStorageStatus();
  window.clearTimeout(appDataSyncTimer);
  void persistPendingDriveAppData(accountId, drive, generation, next, desired).then(saved => {
    if (!saved || !isLatestAppDataDesired(desired)) return;
    window.clearTimeout(appDataSyncTimer);
    if (sameDriveAppDataState(next, state.appDataSnapshot!.state)) {
      void persistDriveAppData(next, desired);
      return;
    }
    appDataSyncTimer = window.setTimeout(() => {
      appDataSyncTimer = 0;
      if (reloadPreparationActive || pageCacheSuspended) { deferredAppDataSync = true; return; }
      if (isLatestAppDataDesired(desired)) void persistDriveAppData(next, desired);
    }, 900);
  }).catch(error => {
    if (!isLatestAppDataDesired(desired)) return;
    state.appDataSync = 'error';
    state.appDataError = shortError(error);
    renderStorageStatus();
    showMessage(`${strings().appDataError}: ${state.appDataError}`, 'error');
  });
}

async function restoreRemoteDriveAppData(
  snapshot: DriveAppDataSnapshot, accountId: string, drive: GoogleDriveApi, generation: number, restoreTabs = true
): Promise<boolean> {
  if (remoteAppDataRestoreInProgress || !driveSessionIsCurrent(accountId, drive, generation) || !state.appDataStore) return false;
  const cancelledReloadPreparation = reloadPreparationActive;
  remoteAppDataRestoreInProgress = true;
  syncWorkspaceInteractionLock();
  publishWorkspaceSnapshot();
  if (cancelledReloadPreparation) {
    // A remote choice changes the workspace baseline. Cancel this update attempt, but keep
    // the shell locked until the selected Drive folder and tabs have finished restoring.
    deferredAppDataSync = false;
    deferredExplorerRefresh = false;
    releaseReloadPreparation();
  }

  let succeeded = false;
  const previousPending = state.appDataPending;
  let pending = previousPending;
  try {
    // Let any earlier durable pending write settle before remembering what the remote choice
    // is allowed to clear. The choice must not delete a newer account-scoped record.
    await appDataPendingQueue;
    if (!driveSessionIsCurrent(accountId, drive, generation) || !state.appDataStore) return false;
    const persistedPending = await readPendingDriveAppData(accountId);
    if (!driveSessionIsCurrent(accountId, drive, generation) || !state.appDataStore) return false;
    pending = persistedPending ?? previousPending;

    const desired = desiredDriveAppData(accountId, drive, generation, snapshot.state);
    state.appDataSnapshot = snapshot;
    // Hide the local pending value only while applying the explicitly selected remote state;
    // restore it below if any part of that operation fails.
    state.appDataPending = undefined;
    state.appDataPendingChoice = 'remote';
    state.folderId = undefined;
    state.folderName = undefined;
    state.appDataSync = 'syncing';
    state.appDataError = undefined;
    appDataUnknownOutcome = true;
    renderStorageStatus();

    const folder = await findCanonicalLibraryRoot(accountId, drive, generation, snapshot, snapshot.state, true);
    if (!driveSessionIsCurrent(accountId, drive, generation) || state.appDataSnapshot !== snapshot) {
      throw new Error('The Drive session changed while restoring the selected settings.');
    }
    const hasDriveTabReferences = snapshot.state.openDriveFileIds.length > 0 || snapshot.state.activeDriveFileId !== null;
    if (folder) {
      if (snapshot.state.selectedFolderId && snapshot.state.selectedFolderId !== folder.id) {
        throw new Error('The selected Drive library folder no longer matches the verified GuitarDSL root.');
      }
      await commitSelectedDriveFolder(folder, 'completed', snapshot.state);
      const folderId = state.folderId;
      if (!folderId || folderId !== folder.id) throw new Error('The selected Drive library folder could not be restored.');
      // Resolve the selected folder's listing before clearing pending state or releasing the shell lock.
      const children = await drive.listChildren(folderId);
      if (!driveSessionIsCurrent(accountId, drive, generation) || state.appDataSnapshot !== snapshot || state.folderId !== folderId) {
        throw new Error('The Drive session changed while restoring the selected library.');
      }
      driveChildrenByParent.set(folderId, children);
      driveFolderErrors.delete(folderId);
      rebuildDriveFileRows();
    } else {
      if (snapshot.state.selectedFolderId !== null || (restoreTabs && hasDriveTabReferences) || snapshot.state.folderPrompt === 'completed') {
        throw new Error('The selected Drive library folder could not be verified.');
      }
      // An unset library with no open Drive references is a valid remote v1 state.
      // Clear old account rows and restore the local-only session without inventing a root.
      driveChildrenByParent.clear(); driveExpandedFolders.clear(); driveLoadingFolders.clear();
      driveFolderErrors.clear(); driveChildRequestSequences.clear(); driveFileRows = [];
      state.folderId = undefined;
      state.folderName = undefined;
    }
    const restored = !restoreTabs || await restoreDriveSession(accountId, drive, generation, snapshot.state);
    if (!restored || !driveSessionIsCurrent(accountId, drive, generation) || state.appDataSnapshot !== snapshot) {
      throw new Error(state.locale === 'ja'
        ? 'Drive のタブを復元できません。保留中の設定は保持されています。'
        : 'Drive tabs could not be restored. Pending settings have been kept.');
    }
    deferredExplorerRefresh = false;
    if (pending && !await clearPendingDriveAppData(accountId, drive, generation, pending.state, desired)) {
      throw new Error(state.locale === 'ja'
        ? 'Drive のタブは復元しましたが、保留中の設定を安全に消去できませんでした。'
        : 'Drive tabs were restored, but the pending settings could not be safely cleared.');
    }
    if (!driveSessionIsCurrent(accountId, drive, generation) || state.appDataSnapshot !== snapshot) {
      throw new Error('The Drive session changed before pending settings could be cleared.');
    }
    state.appDataPending = undefined;
    state.appDataPendingChoice = undefined;
    state.appDataSync = 'idle';
    state.appDataError = undefined;
    appDataOfflinePending = false;
    appDataUnknownOutcome = false;
    succeeded = true;
  } catch (error) {
    if (driveSessionIsCurrent(accountId, drive, generation) && state.appDataStore) {
      state.appDataPending = pending ?? previousPending;
      state.appDataPendingChoice = 'remote';
      state.appDataSync = 'error';
      state.appDataError = state.locale === 'ja'
        ? `Drive の選択した設定を復元できません。保留中の設定は保持されています。${shortError(error)}`
        : `The selected Drive settings could not be restored. Pending settings have been kept. ${shortError(error)}`;
      appDataUnknownOutcome = true;
      renderStorageStatus();
      showMessage(`${strings().appDataError}: ${state.appDataError}`, 'error');
    }
  } finally {
    if (cancelledReloadPreparation) reloadPreparationRemoteRestoreOutcome = succeeded ? 'restored' : 'failed';
    remoteAppDataRestoreInProgress = false;
    deferredAppDataSync = false;
    syncWorkspaceInteractionLock();
    publishWorkspaceSnapshot();
    if (deferredExplorerRefresh && !runtimeDisposed && !pageCacheSuspended) {
      deferredExplorerRefresh = false;
      void refreshExplorerSnapshot();
    }
    if (succeeded && !state.folderId && snapshot.state.folderPrompt === 'unasked'
      && !snapshot.state.selectedFolderId && snapshot.state.openDriveFileIds.length === 0
      && snapshot.state.activeDriveFileId === null) {
      // Keep the optional setup choice outside the appData queue and restore lock. A Later
      // dismissal preserves the explicitly selected remote state and sends no PATCH.
      window.setTimeout(() => { void promptForLibraryAfterRemoteRestore(accountId, drive, generation, snapshot); }, 0);
    }
  }
  if (!succeeded) return false;
  renderAll();
  return driveSessionIsCurrent(accountId, drive, generation) && state.appDataSync === 'idle' && !state.appDataPending;
}

async function promptForLibraryAfterRemoteRestore(
  accountId: string, drive: GoogleDriveApi, generation: number, snapshot: DriveAppDataSnapshot
): Promise<void> {
  if (!driveSessionIsCurrent(accountId, drive, generation) || state.appDataSnapshot !== snapshot || state.folderId
    || state.appDataPending || state.appDataSync !== 'idle' || reloadPreparationActive || pageCacheSuspended) return;
  const choice = await folderSetupDialog();
  if (!driveSessionIsCurrent(accountId, drive, generation) || state.appDataSnapshot !== snapshot || state.folderId) return;
  if (choice === 'create') await createDriveFolder(true);
}

async function persistDriveAppData(
  next = driveWorkspaceState(), requestedDesired?: NonNullable<typeof latestAppDataDesired>, allowReloadPreparation = false
): Promise<boolean> {
  window.clearTimeout(appDataSyncTimer);
  appDataSyncTimer = 0;
  const accountId = state.account?.accountId;
  const drive = state.drive;
  const store = state.appDataStore;
  const generation = state.driveGeneration;
  if (!accountId || !drive || !store || !state.appDataSnapshot) return false;
  const desired = requestedDesired && requestedDesired.accountId === accountId && requestedDesired.drive === drive
    && requestedDesired.generation === generation && sameDriveAppDataState(requestedDesired.state, next)
    ? requestedDesired : desiredDriveAppData(accountId, drive, generation, next);
  const write = appDataSyncQueue.then(async () => {
    if (!appDataDesiredIsCurrent(desired, allowReloadPreparation) || state.appDataStore !== store) return false;
    const baseline = state.appDataSnapshot;
    if (!baseline) return false;
    if (!appDataUnknownOutcome && sameDriveAppDataState(baseline.state, next)) {
      if (!await clearPendingDriveAppData(accountId, drive, generation, state.appDataPending?.state, desired, allowReloadPreparation)) return false;
      if (!appDataDesiredIsCurrent(desired, allowReloadPreparation)) return false;
      state.appDataSync = 'idle';
      state.appDataError = undefined;
      appDataOfflinePending = false;
      renderStorageStatus();
      return true;
    }
    if (!await persistPendingDriveAppData(accountId, drive, generation, next, desired, allowReloadPreparation)) return false;
    if (!appDataDesiredIsCurrent(desired, allowReloadPreparation)) return false;
    if (!navigator.onLine) {
      appDataOfflinePending = true;
      state.appDataSync = 'pending';
      renderStorageStatus();
      return false;
    }
    state.appDataSync = 'syncing';
    renderStorageStatus();
    let patchMayHaveBeenSent = false;
    const shouldContinue = () => appDataDesiredIsCurrent(desired, allowReloadPreparation)
      && state.appDataStore === store;
    try {
      let result: DriveAppDataSaveResult;
      if (appDataUnknownOutcome) {
        const latest = await store.load(shouldContinue);
        if (!shouldContinue()) return false;
        if (!latest) throw new DriveAppDataError('unknown-outcome', 'Drive app state could not be read to resolve an earlier update.');
        result = sameDriveAppDataState(latest.state, next)
          ? { kind: 'saved' as const, snapshot: latest }
          : { kind: 'conflict' as const, latest };
      } else {
        result = await store.update(baseline, next, {
          shouldContinue,
          onPatchStart: () => { patchMayHaveBeenSent = true; },
          onPatchSettled: () => { patchMayHaveBeenSent = false; }
        });
        patchMayHaveBeenSent = false;
      }
      if (!driveSessionIsCurrent(accountId, drive, generation) || state.appDataStore !== store) return false;
      if (!appDataDesiredIsCurrent(desired, allowReloadPreparation)) {
        if (result.kind === 'saved') state.appDataSnapshot = result.snapshot;
        return false;
      }
      while (result.kind === 'conflict') {
        const choice = await appDataConflictDialog();
        if (!appDataDesiredIsCurrent(desired, allowReloadPreparation) || state.appDataStore !== store) return false;
        if (choice === 'local') {
          // The user's choice authorizes one update against the exact snapshot
          // shown in the dialog. A newer conflict requires another choice.
          appDataUnknownOutcome = false;
          try {
            result = await store.update(result.latest, next, {
              shouldContinue,
              onPatchStart: () => { patchMayHaveBeenSent = true; },
              onPatchSettled: () => { patchMayHaveBeenSent = false; }
            });
            patchMayHaveBeenSent = false;
          } catch (error) {
            if (patchMayHaveBeenSent || error instanceof DriveAppDataError && error.code === 'unknown-outcome') {
              appDataUnknownOutcome = true;
            }
            throw error;
          }
          if (!appDataDesiredIsCurrent(desired, allowReloadPreparation)) {
            if (result.kind === 'saved') state.appDataSnapshot = result.snapshot;
            return false;
          }
        } else {
          const restored = await restoreRemoteDriveAppData(result.latest, accountId, drive, generation);
          return restored;
        }
      }
      if (!driveSessionIsCurrent(accountId, drive, generation) || state.appDataStore !== store
        || !appDataDesiredIsCurrent(desired, allowReloadPreparation)) return false;
      state.appDataSnapshot = result.snapshot;
      if (!await clearPendingDriveAppData(accountId, drive, generation, next, desired, allowReloadPreparation)) {
        throw new DriveAppDataError('unknown-outcome', 'Drive saved its metadata, but the local pending record could not be cleared.');
      }
      appDataUnknownOutcome = false;
      state.appDataSync = 'idle';
      state.appDataError = undefined;
      appDataOfflinePending = false;
      renderStorageStatus();
      if (result.snapshot.duplicateCount > 1) showMessage(strings().appDataDuplicates, 'error');
      return true;
    } catch (error) {
      if (patchMayHaveBeenSent || error instanceof DriveAppDataError && error.code === 'unknown-outcome') {
        appDataUnknownOutcome = true;
      }
      if (!driveSessionIsCurrent(accountId, drive, generation) || state.appDataStore !== store
        || !appDataDesiredIsCurrent(desired, allowReloadPreparation)) return false;
      state.appDataSync = 'error';
      state.appDataError = shortError(error);
      renderStorageStatus();
      showMessage(`${strings().appDataError}: ${state.appDataError}`, 'error');
      return false;
    }
  });
  appDataSyncQueue = write.then(() => undefined, () => undefined);
  return write;
}

async function flushDriveAppData(shouldContinue: () => boolean = () => true): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (appDataSyncTimer) {
      window.clearTimeout(appDataSyncTimer);
      appDataSyncTimer = 0;
    }
    await appDataPendingQueue;
    if (!shouldContinue() || state.appDataSync === 'error' && !appDataUnknownOutcome) return false;
    if (state.appDataSync === 'syncing') {
      await appDataSyncQueue;
      if (!shouldContinue()) return false;
      continue;
    }
    if (state.appDataSync === 'pending' || state.appDataPending || deferredAppDataSync || appDataUnknownOutcome) {
      deferredAppDataSync = false;
      const synced = await persistDriveAppData(driveWorkspaceState(), latestAppDataDesired, true);
      if (!synced || !shouldContinue()) return false;
      continue;
    }
    if (state.appDataSync === 'idle' && !state.appDataPending && !appDataSyncTimer) return true;
  }
  return false;
}

async function persistSessions(_additionalDriveAccounts: string[] = []): Promise<void> {
  if (!state.storageReady) return;
  const accountId = state.account?.accountId;
  const drive = state.drive;
  const generation = state.driveGeneration;
  const localTabs = state.tabs.filter(tab => tab.document.identity.storage === 'local');
  const localActive = localTabs.find(tab => tabKey(tab) === state.activeKey);
  try {
    await indexedDb.setValue('sessions', 'workspace-local', {
      tabs: localTabs.map(tab => tab.document.identity.fileId), active: localActive?.document.identity.fileId ?? null
    } satisfies WorkspaceSession);
    if (state.account?.accountId !== accountId || state.drive !== drive || state.driveGeneration !== generation) return;
    scheduleDriveAppDataSync();
  } catch { state.storageReady = false; renderStorageStatus(); }
}

function renderStorageStatus(text?: string): void {
  const t = strings();
  const tab = activeTab();
  workspaceStorageStatus = text ?? (state.appDataSync === 'error' ? `${t.appDataError}: ${state.appDataError ?? ''}`
    : state.appDataSync === 'pending' || state.appDataSync === 'syncing' ? t.appDataPending
      : !state.storageReady ? t.unavailable : !tab ? t.ready
    : tab.saveStatus === 'local-saved' ? t.saved
      : tab.saveStatus === 'drive-saved' ? (state.locale === 'ja' ? 'Drive に保存済み' : 'Saved to Drive')
        : tab.saveStatus === 'draft' ? t.draft
          : tab.saveStatus === 'saving' ? t.saving : t.unsaved);
  publishWorkspaceSnapshot();
}

function renderCursorPosition(): void {
  const cursor = sourceEditor.selection().head;
  const lines = sourceEditor.getText().slice(0, cursor).split('\n');
  const row = lines.length;
  const column = (lines.at(-1)?.length ?? 0) + 1;
  cursorPositionLabel = state.locale === 'ja' ? `行 ${row}, 列 ${column}` : `Ln ${row}, Col ${column}`;
  publishWorkspaceSnapshot();
}

function scheduleDraft(tab: OpenTab): void {
  const operationGeneration = workspaceOperationGeneration;
  const operationIsCurrent = () => workspaceOperationIsCurrent(operationGeneration) && state.tabs.includes(tab) && tabKey(tab) === key;
  const key = tabKey(tab);
  tab.saveStatus = 'saving';
  renderStorageStatus();
  const edit = snapshot(tab);
  const previous = draftWrites.get(key) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(async () => {
    if (!operationIsCurrent()) return;
    try {
      if (!tab.persistable || !state.storageReady) throw new DOMException('Local storage is unavailable', 'NotSupportedError');
      const saved = await indexedDb.saveDraft(edit, tab.accountId, tab.persistedBase);
      if (!operationIsCurrent()) return;
      if (!saved) throw new DOMException('Concurrent local edits were detected; export or reload to resolve', 'InvalidStateError');
      tab.persistedBase = { revision: edit.revision, source: edit.source };
      tab.saveStatus = tab.revision === edit.revision ? 'draft' : 'saving';
      if (state.activeKey === key) renderStorageStatus();
      if (state.activeStorage === 'local') void renderExplorer();
    } catch (error) {
      if (!operationIsCurrent()) return;
      tab.saveStatus = 'error';
      if (error instanceof DOMException && error.name === 'NotSupportedError') state.storageReady = false;
      if (state.activeKey === key) renderStorageStatus();
      showMessage(shortError(error), 'error');
    }
  });
  draftWrites.set(key, write);
  void write.finally(() => { if (draftWrites.get(key) === write) draftWrites.delete(key); });
}

function hasUnpersistedDraft(tab: OpenTab): boolean {
  return tab.revision !== tab.persistedBase.revision || tab.source !== tab.persistedBase.source || draftWrites.has(tabKey(tab));
}

function renderDiagnostics(score: ParsedScore | undefined): void {
  const diagnostics = score?.diagnostics ?? [];
  sourceEditor.setDiagnostics(diagnostics.map(item => ({
    message: formatDiagnostic(item.code, item.args, state.locale), line: item.line,
    startCol: item.startCol, endCol: item.endCol, severity: item.severity
  })));
  publishWorkspaceSnapshot();
}

function previewHtml(tab: OpenTab, score: ParsedScore): string {
  const generation = ++state.previewGeneration;
  return compileGuitarDslToHtml(tab.source, {
    locale: state.locale, pageSize: tab.pageSize, orientation: tab.orientation,
    previewUiMode: tab.previewMode, previewEditAvailable: true,
    visualBindings: score.visualSourceBindings ?? [],
    documentUri: activeIdentityLabel(tab), documentVersion: tab.revision, previewGeneration: generation,
    expandPageBreakRepeats: state.expandPageBreakRepeats,
    fontUris: scoreFontUrls,
    nonce: crypto.randomUUID().replace(/-/g, ''),
    progressionAudioLeaseId: progressionAudioLease.activeLeaseId,
    cspSource: `${new URL(scoreFontUrls.regular, location.href).origin} data: blob:`,
    hostBootstrapScript: WEB_PREVIEW_BRIDGE,
    hostStyle: WEB_PREVIEW_STYLE
  });
}

function renderPreview(tab: OpenTab | undefined): void {
  if (!tab) {
    previewStatusLabel = strings().previewEmpty;
    scoreFrame.srcdoc = `<!doctype html><meta charset="utf-8"><p style="font:14px system-ui;padding:24px;color:#6b7280">${strings().previewEmpty}</p>`;
    publishWorkspaceSnapshot();
    return;
  }
  const score = currentScore(tab.source, tab);
  renderDiagnostics(score);
  if (!score) {
    previewStatusLabel = strings().previewInvalid;
    publishWorkspaceSnapshot();
    return;
  }
  previewStatusLabel = score.diagnostics.some(item => item.severity === 'error') ? strings().previewCheck : strings().previewReady;
  try { scoreFrame.srcdoc = previewHtml(tab, score); }
  catch (error) {
    previewStatusLabel = strings().previewFailed;
    showMessage(`Preview could not be rendered: ${shortError(error)}`, 'error');
  }
  publishWorkspaceSnapshot();
}

async function renderExplorer(): Promise<void> {
  await refreshExplorerSnapshot();
}

function actionButton(label: string, callback: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'quiet-button file-action';
  button.textContent = label;
  button.addEventListener('click', callback);
  return button;
}

function prepareWebAudioFromGesture(requestId: string): Promise<boolean> {
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) {
    const unavailable = Promise.resolve(false);
    audioResumePromises.set(requestId, unavailable);
    return unavailable;
  }
  try {
    if (!auditionAudioContext || auditionAudioContext.state === 'closed') {
      auditionAudioContext = new AudioContextConstructor();
      auditionMasterGain = auditionAudioContext.createGain();
      auditionMasterGain.gain.value = 0.5;
      auditionMasterGain.connect(auditionAudioContext.destination);
    }
    const resume = auditionAudioContext.resume().then(() => auditionAudioContext?.state === 'running').catch(() => false);
    audioResumePromises.set(requestId, resume);
    return resume;
  } catch {
    const unavailable = Promise.resolve(false);
    audioResumePromises.set(requestId, unavailable);
    return unavailable;
  }
}

function stopWebAuditionAudio(leaseId: string, requestId: string): void {
  const stopKey = `${leaseId}:${requestId}`;
  if (pendingAudioStopTimers.has(stopKey)) return;
  const run = activeWebAudioRun;
  if (run?.leaseId === leaseId && run.requestId === requestId) {
    if (auditionCompletionTimer) window.clearTimeout(auditionCompletionTimer);
    auditionCompletionTimer = 0;
    const needsFadeOut = run.nodes.size > 0;
    if (auditionAudioContext) {
      const now = auditionAudioContext.currentTime;
      for (const node of run.nodes) {
        try {
          node.gain.gain.cancelScheduledValues(now);
          node.gain.gain.setValueAtTime(Math.max(0, node.gain.gain.value), now);
          node.gain.gain.linearRampToValueAtTime(0, now + 0.02);
          node.oscillator.stop(now + 0.025);
        } catch { try { node.oscillator.stop(now); } catch { /* already ended */ } }
      }
    }
    run.nodes.clear();
    activeWebAudioRun = undefined;
    state.audioStatus = strings().audioStopped;
    state.audioCandidateId = undefined;
    const finishStop = () => {
      pendingAudioStopTimers.delete(stopKey);
      audioResumePromises.delete(requestId);
      progressionAudioLease.acknowledge({ command: 'progressionAudioStopped', leaseId, requestId });
      renderInspector();
    };
    if (needsFadeOut) {
      const timer = window.setTimeout(finishStop, 35);
      pendingAudioStopTimers.set(stopKey, timer);
    } else finishStop();
    return;
  }
  audioResumePromises.delete(requestId);
  progressionAudioLease.acknowledge({ command: 'progressionAudioStopped', leaseId, requestId });
  window.setTimeout(() => renderInspector(), 0);
}

async function startWebAuditionAudio(message: ProgressionAudioStartMessage): Promise<boolean> {
  const resume = audioResumePromises.get(message.requestId);
  // Firefox (including headless/OS audio without an output device) can leave resume()
  // unresolved. Bound startup so the audio lease fails closed instead of staying in
  // the "Starting" state indefinitely while Preview is locked.
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;
  const ready = resume ? await Promise.race([
    resume,
    new Promise<false>(resolve => {
      resumeTimer = window.setTimeout(() => resolve(false), 2000);
    })
  ]) : false;
  if (resumeTimer !== undefined) window.clearTimeout(resumeTimer);
  const context = auditionAudioContext;
  if (!ready || !context || context.state !== 'running' || progressionAudioLease.activeLeaseId !== message.leaseId) {
    audioResumePromises.delete(message.requestId);
    state.audioStatus = strings().audioUnavailable;
    state.audioCandidateId = undefined;
    renderInspector();
    progressionAudioLease.acknowledge({ command: 'progressionAudioFailed', leaseId: message.leaseId, requestId: message.requestId });
    return false;
  }
  const run: ActiveWebAudioRun = { leaseId: message.leaseId, requestId: message.requestId, nodes: new Set() };
  activeWebAudioRun = run;
  const speed = message.speed / 100;
  const audioStart = context.currentTime + 0.04;
  try {
    for (const event of message.playback.events) {
      if (!event || !Array.isArray(event.midiNotes) || event.midiNotes.length === 0) continue;
      const chord = event.kind === 'rhythmAttack';
      const volume = (chord ? 0.34 : 0.24) / event.midiNotes.length;
      const when = audioStart + Math.max(0, Number(event.timeSeconds) || 0) / speed;
      const duration = Math.max(0, Number(event.durationSeconds) || 0) / speed;
      if (!duration) continue;
      for (const midi of event.midiNotes) {
        if (!Number.isFinite(midi)) continue;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const attack = Math.min(0.008, duration / 3);
        const release = Math.min(0.04, duration / 3);
        const releaseStart = Math.max(when + attack, when + duration - release);
        oscillator.type = chord ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(440 * Math.pow(2, (midi - 69) / 12), when);
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(volume, when + attack);
        gain.gain.setValueAtTime(volume, releaseStart);
        gain.gain.linearRampToValueAtTime(0, when + duration);
        oscillator.connect(gain);
        gain.connect(auditionMasterGain!);
        const node = { oscillator, gain };
        run.nodes.add(node);
        oscillator.onended = () => {
          run.nodes.delete(node);
          try { oscillator.disconnect(); gain.disconnect(); } catch { /* already disconnected */ }
        };
        oscillator.start(when);
        oscillator.stop(when + duration + 0.002);
      }
    }
  } catch {
    if (auditionAudioContext) {
      const now = auditionAudioContext.currentTime;
      for (const node of run.nodes) {
        try {
          node.gain.gain.cancelScheduledValues(now);
          node.gain.gain.setValueAtTime(0, now);
          node.oscillator.stop(now);
        } catch { try { node.oscillator.stop(now); } catch { /* already ended */ } }
      }
    }
    run.nodes.clear();
    activeWebAudioRun = undefined;
    state.audioStatus = strings().audioUnavailable;
    state.audioCandidateId = undefined;
    renderInspector();
    progressionAudioLease.acknowledge({ command: 'progressionAudioFailed', leaseId: message.leaseId, requestId: message.requestId });
    return false;
  }
  audioResumePromises.delete(message.requestId);
  state.audioStatus = strings().audioPlaying;
  progressionAudioLease.acknowledge({ command: 'progressionAudioStarted', leaseId: message.leaseId, requestId: message.requestId });
  renderInspector();
  auditionCompletionTimer = window.setTimeout(() => stopWebAuditionAudio(message.leaseId, message.requestId),
    Math.max(1, message.playback.durationSeconds * 1_000 / speed + 100));
  return true;
}

function startCandidateAudition(tab: OpenTab, candidate: ProgressionCandidate, _candidateIndex: number): void {
  if (progressionAudioLease.activeLeaseId) {
    if (state.audioCandidateId === candidate.id) void stopCandidateAudition();
    return;
  }
  const score = currentScore(tab.source, tab);
  const progression = state.lastProgression;
  if (!score || !progression || activeTab() !== tab || progression.source !== tab.source || progression.revision !== tab.revision) return;
  let auditionSource = tab.source;
  let startMeasure = progression.target.startMeasure;
  if (state.progressionSide === 'B') {
    const plan = planProgressionEdit(tab.source, score, {
      startMeasure, bars: progression.bars, operation: progression.operation
    }, candidate);
    if (!plan.ok) { state.audioStatus = getMessages(state.locale).progressionApplyFailed; renderInspector(); return; }
    auditionSource = plan.previewSource;
  } else if (progression.operation === 'append') {
    startMeasure = Math.max(0, score.measures.length - progression.bars);
  }
  const playback = buildProgressionAuditionPlaybackData(auditionSource, {
    startMeasure, bars: progression.bars, mode: state.progressionAuditionMode, locale: state.locale
  });
  if (!playback.ok) { state.audioStatus = playback.message; renderInspector(); return; }
  const candidateId = candidate.id;
  const requestId = `web-audition-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const generation = ++progressionSessionGeneration;
  const request = {
    requestId, generation, sessionUri: activeIdentityLabel(tab), sessionVersion: tab.revision,
    sessionGeneration: generation, candidateId, side: state.progressionSide,
    mode: state.progressionAuditionMode, speed: state.progressionSpeed
  };
  void prepareWebAudioFromGesture(requestId);
  state.audioCandidateId = candidateId;
  state.audioStatus = strings().audioStarting;
  renderInspector();
  void progressionAudioLease.start(request, playback.data, () => activeTab() === tab
    && tab.revision === request.sessionVersion && progressionSessionGeneration === generation,
  strings().audioUnavailable);
}

async function stopCandidateAudition(): Promise<void> {
  if (!progressionAudioLease.activeLeaseId) return;
  const stopped = await progressionAudioLease.stop();
  if (stopped) {
    state.audioStatus = strings().audioStopped;
    state.audioCandidateId = undefined;
    renderInspector();
  }
}

function renderInspector(): void {
  const tab = activeTab();
  const t = strings();
  const tabLabels = {
    document: { full: t.document, compact: state.locale === 'ja' ? '文書' : 'Doc' },
    variables: { full: t.variables, compact: state.locale === 'ja' ? '変数' : 'Vars' },
    settings: { full: t.settings, compact: state.locale === 'ja' ? '設定' : 'Set' },
    progression: { full: t.progression, compact: state.locale === 'ja' ? '進行' : 'Progress' }
  };
  app.querySelector('#inspector-tabs-host')!.innerHTML = renderInspectorTabsMarkup({
    listLabel: state.locale === 'ja' ? 'インスペクターの項目' : 'Inspector sections',
    active: state.inspectorTab, labels: tabLabels, controlsId: 'inspector-content', disabled: tab ? [] : ['document', 'variables', 'settings', 'progression']
  });
  inspectorContent.setAttribute('aria-labelledby', `inspector-tab-${state.inspectorTab}`);
  if (sharedSettingsHost.parentElement === inspectorContent) sharedSettingsParking.append(sharedSettingsHost);
  inspectorContent.replaceChildren();
  if (!tab) { inspectorContent.textContent = t.createFirst; return; }
  const score = currentScore(tab.source, tab);
  if (state.inspectorTab === 'document') {
    addInspectorHeading(inspectorContent, t.document);
    addInspectorValue(inspectorContent, t.title, score?.title || '—');
    addInspectorValue(inspectorContent, t.artist, score?.artist || '—');
    addInspectorValue(inspectorContent, t.tempo, score?.bpm || '96');
    addInspectorValue(inspectorContent, t.measures, String(score?.measures.length ?? 0));
    addInspectorValue(inspectorContent, t.chords, String(score?.usedChords.length ?? 0));
    const actions = document.createElement('div'); actions.className = 'inspector-actions';
    if (tab.document.identity.storage === 'local') {
      const rename = actionButton(state.locale === 'ja' ? '名前を変更' : 'Rename', () => {
        const name = window.prompt(state.locale === 'ja' ? 'ファイル名' : 'File name', tab.document.name);
        if (name?.trim()) void renameLocal(tab, name.trim());
      });
      const remove = actionButton(state.locale === 'ja' ? '削除' : 'Delete', () => void deleteLocal(tab));
      actions.append(rename, remove);
    }
    inspectorContent.append(actions);
  } else if (state.inspectorTab === 'variables') {
    if (!score) { inspectorContent.textContent = t.noDiagnostics; return; }
    const sourceRevision = tab.revision;
    const sourceAtOpen = tab.source;
    renderVariablesEditor({
      root: inspectorContent, score, source: sourceAtOpen, locale: state.locale,
      selectedName: tab.variableSelectedName,
      onSelect: name => {
        if (activeTab() !== tab) return;
        tab.variableSelectedName = name;
        renderInspector();
      },
      onApply: (nextSource, expectedSource) => {
        if (moveToDriveInProgress || activeTab() !== tab || tab.source !== expectedSource
          || tab.revision !== sourceRevision) return false;
        replaceEditorSourceWithUndo(nextSource);
        return tab.source === nextSource;
      },
      onJump: (line, startCol, endCol) => {
        if (activeTab() !== tab) return;
        const lines = sourceEditor.getText().split('\n');
        const offset = lines.slice(0, line).reduce((total, value) => total + value.length + 1, 0);
        sourceEditor.setSelection(offset + startCol, offset + endCol);
      }
    });
  } else if (state.inspectorTab === 'settings') {
    addInspectorHeading(inspectorContent, t.settings);
    addInspectorSelect(inspectorContent, t.pageSize, ['A4', 'A3', 'A5', 'B4', 'B5', 'Letter'], tab.pageSize,
      value => { tab.pageSize = value as PageSize; state.pageSize = tab.pageSize; savePreferences(); renderPreview(tab); });
    addInspectorSelect(inspectorContent, t.orientation, ['portrait', 'landscape'], tab.orientation,
      value => { tab.orientation = value as PageOrientation; state.orientation = tab.orientation; savePreferences(); renderPreview(tab); });
    const label = document.createElement('label'); label.className = 'inspector-check';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = state.expandPageBreakRepeats;
    checkbox.addEventListener('change', () => { state.expandPageBreakRepeats = checkbox.checked; savePreferences(); renderPreview(tab); renderInspector(); });
    label.append(checkbox, document.createTextNode(state.locale === 'ja' ? '改ページリピートを展開' : 'Expand page-break repeats'));
    inspectorContent.append(label);
    renderWebScoreSettings(tab, inspectorContent);
  } else {
    const messages = getMessages(state.locale);
    inspectorContent.innerHTML = renderProgressionInspectorMarkup(messages, {
      hidden: false, repeatNoticeVisible: state.progressionBars > 4
    });
    renderWebProgressionInspector(tab, score, messages);
  }
}

function renderWebProgressionInspector(tab: OpenTab, score: ParsedScore | undefined, messages: ReturnType<typeof getMessages>): void {
  const barsContainer = inspectorContent.querySelector<HTMLDivElement>('#bars-options')!;
  const operationContainer = inspectorContent.querySelector<HTMLDivElement>('#operation-options')!;
  const candidateList = inspectorContent.querySelector<HTMLUListElement>('#candidate-list')!;
  const error = inspectorContent.querySelector<HTMLParagraphElement>('#progression-error')!;
  const status = inspectorContent.querySelector<HTMLParagraphElement>('#progression-audio-status')!;
  const repeatNotice = inspectorContent.querySelector<HTMLParagraphElement>('#progression-repeat-notice')!;
  repeatNotice.textContent = messages.uiProgressionRepeatNotice;
  repeatNotice.hidden = state.progressionBars <= 4;
  const progression = state.lastProgression?.source === tab.source && state.lastProgression.revision === tab.revision
    ? state.lastProgression : undefined;
  const choices = (parent: HTMLElement, values: Array<{ value: string; label: string; disabled?: boolean }>, selected: string,
    select: (value: string) => void, group: 'bars' | 'operation') => {
    parent.replaceChildren();
    for (const item of values) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = item.label;
      button.dataset.inspectorControl = group; button.dataset.inspectorKey = item.value;
      button.disabled = item.disabled === true; button.setAttribute('aria-pressed', String(item.value === selected));
      button.addEventListener('click', () => select(item.value)); parent.append(button);
    }
  };
  choices(barsContainer, [
    { value: '4', label: messages.progressionLengthFour, disabled: state.progressionOperation === 'replace' && (score?.measures.length ?? 0) < 4 },
    { value: '8', label: messages.progressionLengthEight, disabled: state.progressionOperation === 'replace' && (score?.measures.length ?? 0) < 8 },
    { value: '16', label: messages.progressionLengthSixteen, disabled: state.progressionOperation === 'replace' && (score?.measures.length ?? 0) < 16 }
  ], String(state.progressionBars), value => {
    state.progressionBars = Number(value) as ProgressionBars; state.lastProgression = undefined;
    void suggestProgression(tab);
  }, 'bars');
  choices(operationContainer, [
    { value: 'replace', label: messages.progressionReplace, disabled: (score?.measures.length ?? 0) < state.progressionBars },
    { value: 'append', label: messages.progressionAppend }
  ], state.progressionOperation, value => {
    state.progressionOperation = value as ProgressionEditOperation; state.progressionStartMeasure = undefined;
    state.lastProgression = undefined; void suggestProgression(tab);
  }, 'operation');
  candidateList.replaceChildren();
  for (const candidate of progression?.candidates ?? []) {
    const item = document.createElement('li');
    const button = document.createElement('button'); button.type = 'button'; button.dataset.inspectorControl = 'candidate';
    button.dataset.inspectorKey = candidate.id; button.setAttribute('aria-pressed', String(candidate.id === state.progressionCandidateId));
    const chords = document.createElement('span'); chords.className = 'candidate-chords';
    chords.textContent = `${candidate.romanNumerals.join(' · ')} · ${messages.progressionCompletionDetail(candidate.score.total)} — ${candidate.chords.join(' | ')}`;
    const rationale = document.createElement('span'); rationale.className = 'candidate-rationale';
    rationale.textContent = messages.progressionScoreBreakdown(candidate.score.followsPreviousRoot, candidate.score.identicalOpeningChord,
      candidate.score.tonicEnding, candidate.melodyEvaluated ? `${candidate.score.melody >= 0 ? '+' : ''}${candidate.score.melody}` : 'not evaluated');
    button.append(chords, rationale);
    button.addEventListener('click', () => { state.progressionCandidateId = candidate.id; renderInspector(); });
    item.append(button); candidateList.append(item);
  }
  const selected = progression?.candidates.find(candidate => candidate.id === state.progressionCandidateId) ?? progression?.candidates[0];
  error.hidden = !state.progressionError;
  error.textContent = state.progressionError ?? (score && progression && !progression.candidates.length ? messages.progressionNoSafeCandidates : '');
  if (!score) { error.hidden = false; error.textContent = messages.progressionSourceErrors; }
  const play = inspectorContent.querySelector<HTMLButtonElement>('#progression-play')!;
  const stop = inspectorContent.querySelector<HTMLButtonElement>('#progression-stop')!;
  const apply = inspectorContent.querySelector<HTMLButtonElement>('#progression-apply')!;
  const cancel = inspectorContent.querySelector<HTMLButtonElement>('#progression-cancel')!;
  const mode = inspectorContent.querySelector<HTMLSelectElement>('#progression-audition-mode')!;
  const speed = inspectorContent.querySelector<HTMLSelectElement>('#progression-speed')!;
  const sideA = inspectorContent.querySelector<HTMLButtonElement>('#progression-side-a')!;
  const sideB = inspectorContent.querySelector<HTMLButtonElement>('#progression-side-b')!;
  const active = Boolean(progressionAudioLease.activeLeaseId);
  play.disabled = !selected || (active && state.audioCandidateId !== selected?.id);
  stop.disabled = !active;
  apply.disabled = !selected || active;
  play.addEventListener('click', () => {
    if (!selected) return;
    if (progressionAudioLease.activeLeaseId) void stopCandidateAudition();
    else startCandidateAudition(tab, selected, 0);
  });
  stop.addEventListener('click', () => void stopCandidateAudition());
  apply.addEventListener('click', () => { if (selected) applyProgressionCandidate(tab, selected); });
  cancel.addEventListener('click', () => {
    if (progressionAudioLease.activeLeaseId) void stopCandidateAudition();
    state.lastProgression = undefined; state.progressionCandidateId = undefined;
    state.inspectorTab = 'document'; renderInspector();
  });
  mode.value = state.progressionAuditionMode;
  mode.addEventListener('change', () => { state.progressionAuditionMode = mode.value as AppState['progressionAuditionMode']; });
  speed.value = String(state.progressionSpeed);
  speed.addEventListener('change', () => { state.progressionSpeed = Number(speed.value) as AppState['progressionSpeed']; });
  sideA.setAttribute('aria-pressed', String(state.progressionSide === 'A'));
  sideB.setAttribute('aria-pressed', String(state.progressionSide === 'B'));
  sideA.addEventListener('click', () => { state.progressionSide = 'A'; renderInspector(); });
  sideB.addEventListener('click', () => { state.progressionSide = 'B'; renderInspector(); });
  status.textContent = state.audioStatus;
}

interface WorkspaceLayoutPreference {
  viewMode: WorkspaceViewMode;
  explorerOpen: boolean;
  inspectorOpen: boolean;
  explorerWidth: number;
  inspectorWidth: number;
  problemsOpen: boolean;
  problemsHeight: number;
  splitRatio: number;
  rightDockPane?: 'inspector' | 'tutorial';
  mobileDockOpen?: boolean;
}
const workspace = app.querySelector<HTMLDivElement>('#workspace')!;
const splitDivider = app.querySelector<HTMLDivElement>('#center-splitter')!;
const splitView = app.querySelector<HTMLDivElement>('.split-view')!;
let layoutSaveTimer = 0;

function renderProblemsLabels(): void {
  publishWorkspaceSnapshot();
}

function layoutSnapshot(): WorkspaceLayoutPreference {
  return {
    viewMode: state.viewMode, explorerOpen: state.explorerOpen, inspectorOpen: state.inspectorOpen,
    explorerWidth: state.explorerWidth, inspectorWidth: state.inspectorWidth,
    problemsOpen: state.problemsOpen, problemsHeight: state.problemsHeight, splitRatio: state.splitRatio,
    rightDockPane: state.rightDockPane, mobileDockOpen
  };
}

function saveLayoutSoon(): void {
  window.clearTimeout(layoutSaveTimer);
  layoutSaveTimer = window.setTimeout(() => {
    void indexedDb.setValue('settings', 'web-layout-v1', layoutSnapshot()).catch(() => {
      state.storageReady = false;
      renderStorageStatus();
    });
  }, 250);
}

function saveLayoutNow(): void {
  window.clearTimeout(layoutSaveTimer);
  layoutSaveTimer = 0;
  void indexedDb.setValue('settings', 'web-layout-v1', layoutSnapshot()).catch(() => {
    state.storageReady = false;
    renderStorageStatus();
  });
}

function setWorkspaceViewMode(mode: WorkspaceViewMode, persist = true): void {
  state.viewMode = mode;
  applySplitRatio();
  if (persist) saveLayoutSoon();
  publishWorkspaceSnapshot();
}

function updateResponsiveCollapse(): void {
  const available = workspace.clientWidth;
  let autoHideInspector = false;
  let autoHideExplorer = false;
  const required = () => 40 + 36 + (state.explorerOpen && !autoHideExplorer ? state.explorerWidth + 6 : 0)
    + 240 + (state.inspectorOpen && !autoHideInspector ? 6 + state.inspectorWidth : 0);
  if (available <= 680) {
    autoHideInspector = state.inspectorOpen && !mobileDockOpen;
    if (required() > available) autoHideExplorer = state.explorerOpen;
  } else {
    if (required() > available) autoHideInspector = state.inspectorOpen;
    if (required() > available) autoHideExplorer = state.explorerOpen;
  }
  inspectorAutoHidden = autoHideInspector;
  explorerAutoHidden = autoHideExplorer;
  publishWorkspaceSnapshot();
}

function applyWorkspaceLayout(): void {
  updateResponsiveCollapse();
  publishWorkspaceSnapshot();
}

function applySplitRatio(): void {
  const width = splitView?.clientWidth ?? 0;
  if (width <= 0) return;
  const minimum = width >= 566 ? 240 / width : 0.35;
  const maximum = width >= 566 ? 1 - 320 / width : 0.65;
  state.splitRatio = Math.max(minimum, Math.min(maximum, state.splitRatio));
  publishWorkspaceSnapshot();
}

function persistSplitRatioSoon(): void { saveLayoutSoon(); }

async function loadLayoutPreferences(): Promise<void> {
  const saved = await indexedDb.getValue<Partial<WorkspaceLayoutPreference>>('settings', 'web-layout-v1').catch(() => undefined);
  if (saved) {
    if (saved.viewMode === 'source' || saved.viewMode === 'split' || saved.viewMode === 'score') state.viewMode = saved.viewMode;
    if (typeof saved.explorerOpen === 'boolean') state.explorerOpen = saved.explorerOpen;
    if (typeof saved.inspectorOpen === 'boolean') state.inspectorOpen = saved.inspectorOpen;
    if (typeof saved.explorerWidth === 'number' && Number.isFinite(saved.explorerWidth)) state.explorerWidth = Math.max(180, Math.min(420, saved.explorerWidth));
    if (typeof saved.inspectorWidth === 'number' && Number.isFinite(saved.inspectorWidth)) state.inspectorWidth = Math.max(260, Math.min(480, saved.inspectorWidth));
    if (typeof saved.problemsOpen === 'boolean') state.problemsOpen = saved.problemsOpen;
    if (typeof saved.problemsHeight === 'number' && Number.isFinite(saved.problemsHeight)) state.problemsHeight = Math.max(140, Math.min(window.innerHeight * 0.45, saved.problemsHeight));
    if (typeof saved.splitRatio === 'number' && Number.isFinite(saved.splitRatio)) state.splitRatio = Math.max(0.24, Math.min(0.76, saved.splitRatio));
    if (saved.rightDockPane === 'inspector' || saved.rightDockPane === 'tutorial') state.rightDockPane = saved.rightDockPane;
    if (typeof saved.mobileDockOpen === 'boolean') mobileDockOpen = saved.mobileDockOpen;
  } else {
    state.problemsHeight = Math.max(140, Math.min(window.innerHeight * 0.45, state.problemsHeight));
    await indexedDb.setValue('settings', 'web-layout-v1', layoutSnapshot()).catch(() => undefined);
  }
}

function addInspectorHeading(parent: HTMLElement, text: string): void { const heading = document.createElement('h2'); heading.textContent = text; parent.append(heading); }
function addInspectorValue(parent: HTMLElement, label: string, value: string): void {
  const row = document.createElement('div'); row.className = 'inspector-value';
  const name = document.createElement('span'); name.textContent = label; const content = document.createElement('strong'); content.textContent = value;
  row.append(name, content); parent.append(row);
}
function addInspectorParagraph(parent: HTMLElement, value: string): void { const p = document.createElement('p'); p.textContent = value; parent.append(p); }
function addInspectorSelect(parent: HTMLElement, label: string, values: string[], selected: string, onChange: (value: string) => void): void {
  const wrapper = document.createElement('label'); wrapper.className = 'inspector-field';
  const name = document.createElement('span'); name.textContent = label;
  const select = document.createElement('select');
  for (const value of values) { const option = document.createElement('option'); option.value = value; option.textContent = value; option.selected = value === selected; select.append(option); }
  select.addEventListener('change', () => onChange(select.value)); wrapper.append(name, select); parent.append(wrapper);
}

function addProgressionSelect(
  parent: HTMLElement, label: string, values: Array<{ value: string; label: string }>, selected: string,
  onChange: (value: string) => void, disabled = false
): void {
  const wrapper = document.createElement('label'); wrapper.className = 'inspector-field';
  const name = document.createElement('span'); name.textContent = label;
  const select = document.createElement('select'); select.disabled = disabled;
  for (const item of values) {
    const option = document.createElement('option'); option.value = item.value; option.textContent = item.label;
    option.selected = item.value === selected; select.append(option);
  }
  select.addEventListener('change', () => onChange(select.value)); wrapper.append(name, select); parent.append(wrapper);
}

function webSettingsContext(tab: OpenTab): ScoreSettingsSectionContext {
  return {
    source: tab.source, messages: getMessages(state.locale), editorMessages: getScoreSettingsEditorMessages(state.locale),
    refresh: () => {}, status: () => {}
  };
}

function resetWebScoreSettings(): void {
  Object.values(webScoreSettingsSections).forEach(section => section.reset());
  state.scoreSettingsSection = 'capo';
}

function renderWebScoreSettings(tab: OpenTab, parent: HTMLElement): void {
  const labels = getScoreSettingsEditorMessages(state.locale);
  const section = webScoreSettingsSections[state.scoreSettingsSection];
  const sections = [
    { id: 'capo', title: labels.sectionCapo },
    { id: 'beginner', title: labels.sectionBeginner },
    { id: 'transpose', title: labels.sectionTranspose }
  ];
  const context = {
    kind: 'settings', uri: activeIdentityLabel(tab), version: tab.revision,
    sessionGeneration: tab.revision + 1, revision: tab.revision, section: state.scoreSettingsSection,
    sections, model: section.buildModel(webSettingsContext(tab)),
    status: labels.panelTitle, description: ''
  };
  const labelsNode = document.getElementById('settings-labels');
  const heading = document.getElementById('settings-heading');
  if (labelsNode) labelsNode.textContent = JSON.stringify(labels);
  if (heading) heading.textContent = context.status;
  if (sharedSettingsHost.parentElement !== parent) parent.append(sharedSettingsHost);
  sharedSettingsHost.hidden = false;
  const host = window as Window & {
    guitarDslInspectorContext?: unknown;
    guitarDslInspectorPostSettings?: (command: string, extra?: Record<string, unknown>) => void;
    renderSettingsInspector?: (nextContext: typeof context, nextLabels?: typeof labels) => void;
  };
  host.guitarDslInspectorContext = context;
  const source = tab.source;
  const revision = tab.revision;
  host.guitarDslInspectorPostSettings = (command, extra = {}) => {
    if (reloadPreparationActive || pageCacheSuspended) {
      showMessage(state.locale === 'ja' ? '更新またはブラウザー復帰の準備中は操作できません。' : 'Inspector settings are paused during update or browser restore.', 'info');
      return;
    }
    return trackWorkspaceOperation(() => handleWebSettingsMessage(tab, source, revision, command, extra));
  };
  host.renderSettingsInspector?.(context, labels);
}

function handleWebSettingsMessage(
  tab: OpenTab, expectedSource: string, expectedRevision: number, command: string, extra: Record<string, unknown>
): void {
  if (reloadPreparationActive || pageCacheSuspended || activeTab() !== tab
    || tab.source !== expectedSource || tab.revision !== expectedRevision || moveToDriveInProgress) {
    showMessage(getScoreSettingsEditorMessages(state.locale).staleDocument, 'error');
    return;
  }
  switch (command) {
    case 'settingsSelectSection':
      if (extra.nextSection === 'capo' || extra.nextSection === 'beginner' || extra.nextSection === 'transpose') state.scoreSettingsSection = extra.nextSection;
      break;
    case 'settingsSelectCapo':
      if (typeof extra.capo === 'number') webScoreSettingsSections.capo.selectCapo(extra.capo);
      break;
    case 'settingsSetBarrePolicy':
      if (extra.policy === 'allow' || extra.policy === 'forbid') webScoreSettingsSections.beginner.setBarrePolicy(extra.policy);
      break;
    case 'settingsSelectBeginnerCapo':
      if (extra.capo === 'auto') webScoreSettingsSections.beginner.selectCapo(undefined);
      else if (typeof extra.capo === 'number') webScoreSettingsSections.beginner.selectCapo(extra.capo);
      break;
    case 'settingsSetSemitones':
      if (typeof extra.semitones === 'number') webScoreSettingsSections.transpose.setSemitones(extra.semitones);
      break;
    case 'settingsSetTransposeCapoMode':
      if ((extra.mode === 'keep' || extra.mode === 'recommended') && webScoreSettingsSections.transpose.setCapoMode(extra.mode)) break;
      if (extra.mode === 'explicit' && typeof extra.capo === 'number') webScoreSettingsSections.transpose.setCapoMode('explicit', extra.capo);
      break;
    case 'settingsApply':
      applyWebScoreSettings(tab, state.scoreSettingsSection);
      return;
    case 'settingsCancel':
      resetWebScoreSettings();
      break;
    default:
      return;
  }
  renderInspector();
}

function applyWebScoreSettings(tab: OpenTab, sectionId: ScoreSettingsSectionId): void {
  const messages = getScoreSettingsEditorMessages(state.locale);
  const section = webScoreSettingsSections[sectionId];
  const model = section.buildModel(webSettingsContext(tab)) as CapoSectionModel | BeginnerSectionModel | TransposeSectionModel;
  if (!model.canApply || !window.confirm(messages.confirmApply)) return;
  const source = tab.source; const revision = tab.revision;
  const plan = sectionId === 'capo'
    ? planCapoTransform(source, (model as CapoSectionModel).selectedCapo)
    : sectionId === 'beginner'
      ? planBeginnerTransform(source, webScoreSettingsSections.beginner.getOptions())
      : planTransposeWithCapo(source, (model as TransposeSectionModel).semitones,
        webScoreSettingsSections.transpose.request((model as TransposeSectionModel).sourceCapo).capoMode);
  if (!plan.ok) { showMessage(messages.staleDocument, 'error'); return; }
  if (activeTab() !== tab || tab.source !== source || tab.revision !== revision || moveToDriveInProgress) {
    showMessage(messages.staleDocument, 'error'); return;
  }
  resetWebScoreSettings();
  replaceEditorSourceWithUndo(plan.text);
}

const systemColorScheme = window.matchMedia('(prefers-color-scheme: dark)');
function applyResolvedTheme(): void {
  const theme = state.theme === 'system' ? (systemColorScheme.matches ? 'dark' : 'light') : state.theme;
  app.dataset.theme = theme;
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('.conflict-dialog')) dialog.dataset.theme = theme;
}
function createThemedConflictDialog(): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.className = 'conflict-dialog';
  dialog.dataset.theme = app.dataset.theme ?? 'light';
  return dialog;
}
systemColorScheme.addEventListener('change', () => {
  if (state.theme === 'system') applyResolvedTheme();
}, runtimeListenerOptions);

function renderAll(): void {
  renderInspector();
  void renderExplorer();
  renderStorageStatus();
  const tab = activeTab();
  if (tab) {
    sourceEditor.setDocument(tabKey(tab), tab.source);
    renderDiagnostics(currentScore(tab.source, tab));
    renderPreview(tab);
  } else {
    sourceEditor.setDocument('', '');
    renderDiagnostics(undefined);
    renderPreview(undefined);
  }
  sourceEditor.setAccessibleName(state.locale === 'ja' ? 'GuitarDSL ソースエディター' : 'GuitarDSL source editor');
  applyResolvedTheme();
  renderCursorPosition();
  applyWorkspaceLayout();
  renderDriveOperationControls();
  publishWorkspaceSnapshot();
}

async function openDocument(
  documentRow: StoredDocument, source = documentRow.source, accountId?: string, persistable = true,
  isCurrent?: () => boolean
): Promise<OpenTab | undefined> {
  const operationGeneration = workspaceOperationGeneration;
  const operationIsCurrent = () => workspaceOperationIsCurrent(operationGeneration) && (!isCurrent || isCurrent());
  if (!operationIsCurrent()) return undefined;
  const match = state.tabs.find(tab => sameTabIdentity(tab, documentRow.identity, accountId));
  if (match) {
    await setActive(tabKey(match), isCurrent);
    return operationIsCurrent() ? match : undefined;
  }
  let savedDocument: StoredDocument | undefined;
  let savedDraftBaseline: Awaited<ReturnType<typeof indexedDb.getDraftBaseline>> = undefined;
  if (persistable) {
    try {
      [savedDocument, savedDraftBaseline] = await Promise.all([
        indexedDb.getSavedDocument(documentRow.identity, accountId),
        indexedDb.getDraftBaseline(documentRow.identity, accountId)
      ]);
    }
    catch { if (operationIsCurrent()) state.storageReady = false; }
  }
  if (!operationIsCurrent()) return undefined;
  const hasDraft = persistable && (!savedDocument
    || savedDocument.revision !== documentRow.revision || savedDocument.source !== source);
  const tab: OpenTab = {
    document: documentRow, source, revision: documentRow.revision, accountId, persistable,
    persistedBase: {
      revision: savedDraftBaseline?.revision ?? savedDocument?.revision ?? documentRow.revision,
      source: savedDraftBaseline?.source ?? savedDocument?.source ?? documentRow.source
    },
    saveStatus: hasDraft ? 'draft' : documentRow.identity.storage === 'drive' ? 'drive-saved' : 'local-saved',
    previewMode: 'normal', pageSize: state.pageSize, orientation: state.orientation
  };
  if (progressionAudioLease.activeSessionUri) await stopCandidateAudition();
  if (!operationIsCurrent()) return undefined;
  if (!editorReadyForDocumentChange()) return undefined;
  const existing = state.tabs.find(tab => sameTabIdentity(tab, documentRow.identity, accountId));
  if (existing) {
    await setActive(tabKey(existing), isCurrent);
    return operationIsCurrent() ? existing : undefined;
  }
  resetWebScoreSettings();
  state.tabs.push(tab);
  state.activeKey = tabKey(tab);
  state.welcomeActive = false;
  state.activeStorage = tab.document.identity.storage;
  renderAll();
  void persistSessions();
  return tab;
}

async function openLocalDocument(identity: DocumentIdentity): Promise<void> {
  const operationGeneration = workspaceOperationGeneration;
  try {
    const documentRow = await indexedDb.getDocument(identity);
    if (!workspaceOperationIsCurrent(operationGeneration)) { deferredExplorerRefresh = true; return; }
    if (!documentRow) throw new DOMException('Document was deleted', 'NotFoundError');
    await openDocument(documentRow, documentRow.source);
  } catch (error) { if (workspaceOperationIsCurrent(operationGeneration)) showMessage(shortError(error), 'error'); }
}

function closeTab(tab: OpenTab, skipDraft = false): Promise<void> {
  const inFlight = closingTabs.get(tab);
  if (inFlight) return inFlight;
  const closePromise = closeTabNow(tab, skipDraft).finally(() => {
    if (closingTabs.get(tab) === closePromise) closingTabs.delete(tab);
  });
  closingTabs.set(tab, closePromise);
  return closePromise;
}

async function closeTabNow(tab: OpenTab, skipDraft = false): Promise<void> {
  const operationGeneration = workspaceOperationGeneration;
  const operationIsCurrent = () => workspaceOperationIsCurrent(operationGeneration);
  const key = tabKey(tab);
  if (!state.tabs.includes(tab)) return;
  if (state.activeKey === key && !editorReadyForDocumentChange()) return;
  if (progressionAudioLease.activeSessionUri === activeIdentityLabel(tab)) await stopCandidateAudition();
  if (!operationIsCurrent()) return;
  if (state.activeKey === key && !editorReadyForDocumentChange()) return;
  if (!skipDraft) {
    while (true) {
      if (state.activeKey === key && !editorReadyForDocumentChange()) return;
      const revision = tab.revision;
      if (!await saveDraftNow(tab)) return;
      if (!operationIsCurrent()) return;
      if (state.activeKey === key && !editorReadyForDocumentChange()) return;
      if (tab.revision === revision) break;
    }
  } else if (state.activeKey === key && draftWrites.has(key)) {
    await draftWrites.get(key);
    if (!operationIsCurrent()) return;
  }
  const index = state.tabs.indexOf(tab);
  if (index < 0) return;
  state.tabs.splice(index, 1);
  derivedScoreCache.clear(activeIdentityLabel(tab));
  if (state.activeKey === key) {
    const next = state.tabs[Math.max(0, index - 1)] ?? state.tabs[0];
    state.activeKey = next ? tabKey(next) : null;
  }
  renderAll();
  await persistSessions(tab.accountId ? [tab.accountId] : []);
}

async function saveDraftNow(tab: OpenTab): Promise<boolean> {
  const operationGeneration = workspaceOperationGeneration;
  const operationIsCurrent = () => workspaceOperationIsCurrent(operationGeneration);
  if (!tab.persistable || !state.storageReady) return false;
  if (!editorReadyForSnapshot(tab)) return false;
  try {
    const key = tabKey(tab);
    while (true) {
      const pendingWrite = draftWrites.get(key);
      if (pendingWrite) await pendingWrite;
      if (!operationIsCurrent()) return false;
      if (!editorReadyForSnapshot(tab)) return false;
      if (draftWrites.get(key) === pendingWrite || !draftWrites.has(key)) break;
    }
    const edit = snapshot(tab);
    const saved = await indexedDb.saveDraft(edit, tab.accountId, tab.persistedBase);
    if (!operationIsCurrent()) return false;
    if (!saved) throw new DOMException('Concurrent local edits were detected; export or reload to resolve', 'InvalidStateError');
    tab.persistedBase = { revision: edit.revision, source: edit.source };
    tab.saveStatus = 'draft';
    if (activeTab() === tab) renderStorageStatus();
    return true;
  } catch (error) {
    if (!operationIsCurrent()) return false;
    tab.saveStatus = 'error';
    if (activeTab() === tab) renderStorageStatus();
    showMessage(shortError(error), 'error');
    return false;
  }
}

function onEditorInput(source: string, documentKey: string): void {
  if (runtimeDisposed || pageCacheSuspended) return;
  const tab = state.tabs.find(candidate => tabKey(candidate) === documentKey);
  if (!tab) return;
  tab.source = source;
  tab.revision += 1;
  scheduleDraft(tab);
  if (activeTab() !== tab) return;
  state.lastProgression = undefined;
  state.progressionCandidateId = undefined;
  state.progressionError = undefined;
  resetWebScoreSettings();
  if (progressionAudioLease.activeSessionUri === activeIdentityLabel(tab)) void stopCandidateAudition();
  const score = currentScore(tab.source, tab);
  renderDiagnostics(score);
  renderPreviewDebounced(tab);
  renderInspector();
}

let previewTimer = 0;
function renderPreviewDebounced(tab: OpenTab): void {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => { if (activeTab() === tab) renderPreview(tab); }, 250);
}

async function saveActiveDocument(): Promise<void> {
  const operationGeneration = workspaceOperationGeneration;
  const operationIsCurrent = () => workspaceOperationIsCurrent(operationGeneration);
  const tab = activeTab();
  if (!tab) return;
  if (!tab.persistable || !state.storageReady) { showMessage(strings().unavailable, 'error'); return; }
  if (!await saveDraftNow(tab)) return;
  if (!operationIsCurrent()) return;
  if (tab.document.identity.storage === 'local') {
    try {
      if (!editorReadyForSnapshot(tab)) return;
      const edit = snapshot(tab);
      const saved = await indexedDb.commitLocal(edit, undefined, tab.persistedBase);
      if (!operationIsCurrent()) { deferredExplorerRefresh = true; return; }
      if (!saved) throw new DOMException('A newer edit exists in another tab', 'InvalidStateError');
      tab.document = saved;
      tab.persistedBase = { revision: saved.revision, source: saved.source };
      tab.saveStatus = 'local-saved';
      renderStorageStatus();
      showMessage(strings().saved);
      void renderExplorer();
    } catch (error) { if (operationIsCurrent()) showMessage(shortError(error), 'error'); }
    return;
  }
  if (tab.accountId !== state.account?.accountId) {
    showMessage(strings().reconnectOwner, 'error');
    return;
  }
  await saveDriveDocument(tab);
}

async function saveDriveDocument(tab: OpenTab): Promise<void> {
  const operationGeneration = workspaceOperationGeneration;
  const drive = state.drive;
  const accountId = state.account?.accountId;
  const driveGeneration = state.driveGeneration;
  if (!drive || !accountId) { showMessage(strings().connectHint, 'error'); return; }
  if (tab.accountId !== accountId) { showMessage(strings().reconnectOwner, 'error'); return; }
  if (tab.driveTrashPending || tab.driveTrashed) {
    showMessage(state.locale === 'ja' ? 'ゴミ箱へ移動したファイルには保存できません。ローカルコピーを編集してください。'
      : 'This file is being moved to trash or is already trashed. Edit its local copy instead.', 'error');
    return;
  }
  const queuedFileId = tab.document.identity.fileId;
  const sessionIsCurrent = () => workspaceOperationIsCurrent(operationGeneration)
    && driveSessionIsCurrent(accountId, drive, driveGeneration) && state.tabs.includes(tab);
  const operationIsCurrent = () => sessionIsCurrent() && tab.accountId === accountId
    && tab.document.identity.storage === 'drive' && tab.document.identity.fileId === queuedFileId;
  const libraryRootId = state.folderId;
  if (!libraryRootId) {
    showMessage(state.locale === 'ja' ? 'GuitarDSL ライブラリを確認できないため保存できません。'
      : 'The GuitarDSL library folder is not confirmed, so this score cannot be saved.', 'error');
    return;
  }
  let identityChanged = false;
  try {
    if (!sessionIsCurrent()) return;
    await withDriveOperation(() => serializeDriveSave(accountId, queuedFileId, async () => {
      if (!sessionIsCurrent()) return;
      if (tab.document.identity.fileId !== queuedFileId || tab.accountId !== accountId) {
        identityChanged = true;
        return;
      }
      if (tab.driveTrashPending || tab.driveTrashed) {
        showMessage(state.locale === 'ja' ? 'ゴミ箱へ移動したファイルには保存できません。ローカルコピーを編集してください。'
          : 'This file is being moved to trash or is already trashed. Edit its local copy instead.', 'error');
        return;
      }
      if (!editorReadyForSnapshot(tab)) return;
      const file: DriveFile = {
        id: queuedFileId, name: tab.document.name,
        version: tab.document.driveVersion ?? '', modifiedTime: tab.document.driveModifiedTime ?? '',
        headRevisionId: tab.document.driveRevisionId,
        ...(tab.document.driveFolderId ? { parents: [tab.document.driveFolderId] } : {})
      };
      const submitted = tabOperationSnapshot(tab);
      const result = await drive.updateFile(file, submitted.source, tab.document.source, libraryRootId, {
        shouldContinue: operationIsCurrent
      });
      if (!operationIsCurrent()) { driveSaveNeedsReviewAfterBfcache = true; return; }
      if (result.kind === 'conflict') {
        await handleDriveConflict(tab, result.latest, drive, accountId, operationIsCurrent);
        if (!operationIsCurrent()) driveSaveNeedsReviewAfterBfcache = true;
        return;
      }
      if (result.kind === 'unavailable') { showMessage(result.message, 'error'); return; }
      if (result.kind === 'unknown') {
        if (result.status === 401) markDriveAuthState(new DriveApiError(401, 'Drive authorization expired.'));
        const message = result.status === 401 ? strings().driveSaveUnauthorized
          : result.status === 403 ? strings().driveSaveForbidden
            : result.latest?.source === submitted.source ? strings().driveSaveUnknownApplied : strings().driveSaveUnknown;
        showMessage(message, 'error');
        return;
      }
      const verified = result.readback;
      if (!operationIsCurrent()) { driveSaveNeedsReviewAfterBfcache = true; return; }
      if (verified.source !== submitted.source) throw new Error('Drive did not return the saved source; the local draft was kept.');
      const updated: StoredDocument = {
        ...tab.document, name: verified.file.name, source: verified.source, revision: submitted.revision,
        driveVersion: verified.file.version, driveModifiedTime: verified.file.modifiedTime,
        driveRevisionId: verified.file.headRevisionId,
        driveFolderId: verified.file.parents?.[0] ?? tab.document.driveFolderId,
        driveEtag: verified.etag, updatedAt: Date.now()
      };
      const committed = await indexedDb.commitDriveDocument(updated, submitted, true, operationIsCurrent);
      if (!operationIsCurrent()) { driveSaveNeedsReviewAfterBfcache = true; return; }
      if (!committed) throw new DOMException('A newer local draft exists; the Drive copy was saved but the local draft was kept.', 'InvalidStateError');
      if (!tabMatchesSnapshot(tab, submitted)) {
        await preserveNewerTabDraftAfterRemoteCommit(tab, updated, operationIsCurrent);
        if (!operationIsCurrent()) { driveSaveNeedsReviewAfterBfcache = true; return; }
        showMessage(state.locale === 'ja'
          ? 'Drive には保存しましたが、保存中に行った新しい編集は下書きとして保持しました。'
          : 'Drive saved the submitted version. Newer edits made during the save remain as a local draft.');
        return;
      }
      tab.document = updated;
      tab.persistedBase = { revision: updated.revision, source: updated.source };
      tab.saveStatus = 'drive-saved';
      renderStorageStatus();
      showMessage(state.locale === 'ja' ? 'Drive に保存しました。' : 'Saved to Google Drive.');
      void renderExplorer();
    }));
  } catch (error) {
    if (!operationIsCurrent()) {
      if (pageCacheSuspended) driveSaveNeedsReviewAfterBfcache = true;
    }
    else { markDriveAuthState(error); showMessage(shortError(error), 'error'); }
  }
  if (sessionIsCurrent() && identityChanged && state.tabs.includes(tab) && tab.document.identity.storage === 'drive'
    && tab.saveStatus !== 'drive-saved') await saveDriveDocument(tab);
}

async function preserveNewerTabDraftAfterRemoteCommit(
  tab: OpenTab, saved: StoredDocument, isCurrent?: () => boolean
): Promise<void> {
  if (isCurrent && !isCurrent()) return;
  if (!state.tabs.includes(tab) || !sameTabIdentity(tab, saved.identity, saved.accountId)) return;
  await draftWrites.get(tabKey(tab));
  if (isCurrent && !isCurrent()) return;
  const source = tab.source;
  const revision = tab.revision;
  tab.document = saved;
  tab.persistedBase = { revision: saved.revision, source: saved.source };
  if (source === saved.source) {
    tab.revision = Math.max(revision, saved.revision);
    tab.persistedBase = { revision: tab.revision, source };
    tab.saveStatus = 'drive-saved';
    if (activeTab() === tab) renderStorageStatus();
    return;
  }
  tab.revision = Math.max(revision, saved.revision + 1);
  tab.persistedBase = { revision: tab.revision, source };
  tab.saveStatus = 'draft';
  if (activeTab() === tab) renderStorageStatus();
}

async function handleDriveConflict(
  tab: OpenTab, latest: DriveFile, drive = state.drive, accountId = state.account?.accountId,
  operationIsCurrent?: () => boolean
): Promise<void> {
  if (!drive || !accountId) return;
  const generation = state.driveGeneration;
  const isCurrent = () => driveSessionIsCurrent(accountId, drive, generation) && (operationIsCurrent?.() ?? true);
  const choice = await conflictDialog();
  if (choice === 'cancel' || !isCurrent()) return;
  if (choice === 'reload') {
    try {
      const expected = tabOperationSnapshot(tab);
      const remote = await withDriveOperation(() => drive.getFile(latest.id, undefined, isCurrent));
      if (!isCurrent()) return;
      if (!tabMatchesSnapshot(tab, expected)) {
        if (!state.tabs.includes(tab) || !sameTabIdentity(tab, expected.identity, expected.accountId)) {
          showMessage(state.locale === 'ja'
            ? 'タブの内容が変わったため再読み込みを中止しました。ドラフトは保持されています。'
            : 'Reload was cancelled because this tab changed identity; its draft was kept.', 'error');
          return;
        }
        if (!await saveDraftNow(tab) || !isCurrent()) return;
        await handleDriveConflict(tab, remote.file, drive, accountId, operationIsCurrent);
        return;
      }
      const updated: StoredDocument = {
        ...tab.document, name: remote.file.name, source: remote.source,
        revision: expected.revision + 1, driveVersion: remote.file.version,
        driveRevisionId: remote.file.headRevisionId,
        driveModifiedTime: remote.file.modifiedTime, driveEtag: remote.etag,
        driveFolderId: remote.file.parents?.[0] ?? tab.document.driveFolderId, updatedAt: Date.now()
      };
      if (!isCurrent()) return;
      const committed = await indexedDb.commitDriveDocument(updated, {
        identity: expected.identity, revision: expected.revision, source: expected.source
      }, false, isCurrent);
      if (!isCurrent()) return;
      if (!committed) throw new Error('A newer local draft exists. It was kept.');
      if (!tabMatchesSnapshot(tab, expected)) {
        await preserveNewerTabDraftAfterRemoteCommit(tab, updated, isCurrent);
        if (!isCurrent()) return;
        await handleDriveConflict(tab, remote.file, drive, accountId, operationIsCurrent);
        return;
      }
      tab.document = updated; tab.source = remote.source; tab.revision = updated.revision;
      tab.persistedBase = { revision: updated.revision, source: updated.source };
      tab.saveStatus = 'drive-saved';
      renderAll();
      showMessage(state.locale === 'ja' ? 'Drive の最新内容を読み込みました。' : 'Reloaded the latest Drive version.');
    } catch (error) { if (isCurrent()) showMessage(shortError(error), 'error'); }
    return;
  }
  try { await saveDriveCopy(tab, latest.parents?.[0] ?? tab.document.driveFolderId ?? state.folderId, drive, accountId, isCurrent); }
  catch (error) { if (isCurrent()) showMessage(shortError(error), 'error'); }
}

function driveSessionIsCurrent(accountId: string, drive: GoogleDriveApi, generation = state.driveGeneration): boolean {
  return state.account?.accountId === accountId && state.drive === drive && state.driveGeneration === generation;
}

function conflictDialog(): Promise<'reload' | 'save-as' | 'cancel'> {
  const t = strings();
  return new Promise(resolve => {
    const dialog = createThemedConflictDialog();
    const heading = document.createElement('h2'); heading.textContent = state.locale === 'ja' ? 'Drive で競合が見つかりました' : 'Drive version conflict';
    const body = document.createElement('p'); body.textContent = state.locale === 'ja'
      ? 'Drive のファイルが別の場所で変更されています。' : 'This Drive file changed since it was opened.';
    const buttons = document.createElement('div'); buttons.className = 'dialog-actions';
    for (const [choice, label] of [['reload', t.reload], ['save-as', t.saveCopy], ['cancel', t.cancel]] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.addEventListener('click', () => { dialog.close(); dialog.remove(); resolve(choice); }); buttons.append(button);
    }
    dialog.append(heading, body, buttons); document.body.append(dialog); dialog.showModal();
    dialog.addEventListener('cancel', () => { dialog.remove(); resolve('cancel'); }, { once: true });
  });
}

function appDataConflictDialog(): Promise<'reload' | 'local'> {
  const t = strings();
  return new Promise(resolve => {
    const dialog = createThemedConflictDialog();
    const heading = document.createElement('h2'); heading.textContent = t.appDataConflictTitle;
    const body = document.createElement('p'); body.textContent = t.appDataConflictBody;
    const buttons = document.createElement('div'); buttons.className = 'dialog-actions';
    for (const [choice, label] of [['reload', t.reloadRemote], ['local', t.keepLocal]] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.addEventListener('click', () => { dialog.close(); dialog.remove(); resolve(choice); }); buttons.append(button);
    }
    dialog.append(heading, body, buttons); document.body.append(dialog); dialog.showModal();
    dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); dialog.remove(); resolve('reload'); }, { once: true });
  });
}

async function saveDriveCopy(
  tab: OpenTab, folderId?: string, drive = state.drive, accountId = state.account?.accountId,
  isCurrent?: () => boolean
): Promise<void> {
  const generation = state.driveGeneration;
  const current = isCurrent ?? (() => !!drive && !!accountId && driveSessionIsCurrent(accountId, drive, generation));
  if (!drive || !accountId || !folderId) throw new Error(strings().noFolder);
  if (!current()) return;
  if (activeTab() === tab && !editorReadyForDocumentChange()) return;
  if (tab.document.identity.storage === 'drive' && tab.accountId !== accountId) throw new Error(strings().reconnectOwner);
  const submitted = tabOperationSnapshot(tab);
  const copyName = `${tab.document.name.replace(/\.(guitardsl|gdsl)$/i, '')} (local copy).guitardsl`;
  await withDriveOperation(async () => {
    const file = await drive.createFile(folderId, copyName, submitted.source);
    if (!current()) return;
    const verified = await drive.getFile(file.id, undefined, current);
    if (!current()) return;
    if (verified.source !== submitted.source) throw new Error('Drive copy verification failed; the original draft was kept.');
    const doc: StoredDocument = {
      identity: driveIdentity(file.id), accountId, name: file.name,
      source: verified.source, revision: submitted.revision, createdAt: Date.now(), updatedAt: Date.now(),
      driveVersion: verified.file.version, driveModifiedTime: verified.file.modifiedTime, driveRevisionId: verified.file.headRevisionId,
      driveEtag: verified.etag, driveFolderId: verified.file.parents?.[0] ?? folderId
    };
    if (!current()) return;
    await indexedDb.upsertDriveDocument(doc, current);
    if (!current()) return;
    if (!editorReadyForDocumentChange()) return;
    if (!tabMatchesSnapshot(tab, submitted)) {
      if (state.tabs.includes(tab) && !await saveDraftNow(tab)) return;
      if (!current()) return;
      const activeBeforeCopy = state.activeKey;
      await openDocument(doc, doc.source, accountId, true, current);
      if (!current()) return;
      if (activeBeforeCopy && state.tabs.some(item => tabKey(item) === activeBeforeCopy)) {
        if (!editorReadyForDocumentChange()) return;
        state.activeKey = activeBeforeCopy;
        state.activeStorage = activeTab()?.document.identity.storage ?? state.activeStorage;
      }
      renderAll();
      await persistSessions([accountId]);
      if (!current()) return;
      showMessage(state.locale === 'ja'
        ? 'Drive のコピーを保存しました。保存中に行った新しい編集は元のタブに保持しています。'
        : 'Saved the Drive copy. Newer edits made during upload remain in the original tab.');
      return;
    }
    const currentIndex = state.tabs.indexOf(tab);
    if (!current()) return;
    const existing = state.tabs.find(other => sameTabIdentity(other, doc.identity, accountId));
    if (existing) {
      if (!editorReadyForDocumentChange()) return;
      existing.source = verified.source; existing.revision = doc.revision; existing.document = doc;
      existing.persistedBase = { revision: doc.revision, source: doc.source }; existing.saveStatus = 'drive-saved';
      if (currentIndex >= 0 && existing !== tab) state.tabs.splice(currentIndex, 1);
      state.activeKey = tabKey(existing);
    } else {
      if (!editorReadyForDocumentChange()) return;
      tab.document = doc; tab.accountId = accountId; tab.source = verified.source;
      tab.persistedBase = { revision: doc.revision, source: doc.source }; tab.saveStatus = 'drive-saved';
      state.activeKey = tabKey(tab);
    }
    renderAll(); await persistSessions([accountId]);
    if (!current()) return;
    showMessage(state.locale === 'ja' ? 'ローカル版を別の Drive ファイルとして保存しました。' : 'Saved the local version as a new Drive file.');
  });
}

async function downloadPdf(tab = activeTab()): Promise<void> {
  if (!tab) return;
  if (!editorReadyForSnapshot(tab)) return;
  try {
    const source = tab.source;
    if (import.meta.env.DEV) lastPdfInputForTest = source;
    await downloadScorePdf(source, tab.document.name, {
      pageSize: tab.pageSize, orientation: tab.orientation, expandPageBreakRepeats: state.expandPageBreakRepeats
    });
  } catch (error) { showMessage(`${state.locale === 'ja' ? 'PDFの書き出しに失敗しました: ' : 'PDF export failed: '}${shortError(error)}`, 'error'); }
}

async function renameLocal(tab: OpenTab, name: string): Promise<void> {
  try {
    await indexedDb.renameLocal(tab.document.identity, name);
    tab.document = { ...tab.document, name };
    renderAll(); await persistSessions();
  } catch (error) { showMessage(shortError(error), 'error'); }
}

async function deleteLocal(tab: OpenTab): Promise<void> {
  if (!editorReadyForDocumentChange()) return;
  if (!window.confirm(strings().confirmDelete)) return;
  try {
    await draftWrites.get(tabKey(tab));
    if (!state.tabs.includes(tab)) return;
    await indexedDb.deleteDocument(tab.document.identity);
    await closeTab(tab, true);
    await renderExplorer();
  } catch (error) { showMessage(shortError(error), 'error'); }
}

async function createNewScore(): Promise<void> {
  const operationGeneration = workspaceOperationGeneration;
  const operationIsCurrent = () => workspaceOperationIsCurrent(operationGeneration);
  const name = window.prompt(state.locale === 'ja' ? 'ファイル名（拡張子なし）' : 'File name (without extension)', 'Untitled');
  if (name === null) return;
  const baseName = name.trim().replace(/\.(?:guitardsl|gdsl)$/i, '').trim() || 'Untitled';
  const fileName = `${baseName}.guitardsl`;
  try {
    const documentRow = await indexedDb.createLocal(fileName, DEFAULT_SOURCE);
    if (!operationIsCurrent()) { deferredExplorerRefresh = true; return; }
    state.storageReady = true;
    await openDocument(documentRow);
    if (!operationIsCurrent()) { deferredExplorerRefresh = true; return; }
    showMessage(state.locale === 'ja' ? 'ローカル楽譜を作成しました。' : 'Created a local score.');
  } catch (error) {
    if (!operationIsCurrent()) return;
    state.storageReady = false;
    const documentRow: StoredDocument = { identity: { storage: 'local', fileId: crypto.randomUUID() }, name: fileName, source: DEFAULT_SOURCE, revision: 0, createdAt: Date.now(), updatedAt: Date.now() };
    const tab: OpenTab = { document: documentRow, source: DEFAULT_SOURCE, revision: 0, previewMode: 'normal', pageSize: state.pageSize, orientation: state.orientation, persistable: false,
      persistedBase: { revision: 0, source: DEFAULT_SOURCE }, saveStatus: 'error' };
    if (!editorReadyForDocumentChange()) return;
    state.tabs.push(tab); state.activeKey = tabKey(tab); state.welcomeActive = false; renderAll();
    showMessage(`${strings().unavailable} ${shortError(error)}`, 'error');
  }
}

async function importFile(file?: File): Promise<void> {
  if (!file) return;
  const operationGeneration = workspaceOperationGeneration;
  const operationIsCurrent = () => workspaceOperationIsCurrent(operationGeneration);
  try {
    const documentRow = await importLocalFile(file);
    if (!operationIsCurrent()) { deferredExplorerRefresh = true; return; }
    state.storageReady = true; await openDocument(documentRow);
    if (!operationIsCurrent()) { deferredExplorerRefresh = true; return; }
    showMessage(state.locale === 'ja' ? 'ファイルを読み込みました。' : 'Imported the GuitarDSL file.');
  } catch (error) { if (operationIsCurrent()) showMessage(shortError(error), 'error'); }
}

function folderSetupDialog(): Promise<'create' | 'later'> {
  const t = strings();
  return new Promise(resolve => {
    const dialog = createThemedConflictDialog();
    const heading = document.createElement('h2'); heading.textContent = t.folderPromptTitle;
    const body = document.createElement('p'); body.textContent = t.folderPromptBody;
    const buttons = document.createElement('div'); buttons.className = 'dialog-actions';
    for (const [choice, label] of [['create', t.createChoice], ['later', t.laterChoice]] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      if (choice === 'create') button.className = 'primary-button';
      button.addEventListener('click', () => { dialog.close(); dialog.remove(); resolve(choice); }); buttons.append(button);
    }
    dialog.append(heading, body, buttons); document.body.append(dialog); dialog.showModal();
    dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); dialog.remove(); resolve('later'); }, { once: true });
  });
}

async function loadDriveAppData(
  accountId: string, drive: GoogleDriveApi, generation: number, shouldContinue: () => boolean = () => true
): Promise<{
  snapshot: DriveAppDataSnapshot; pending?: PendingDriveAppData; pendingChoice?: 'remote' | 'local'
} | undefined> {
  const store = new DriveAppDataStore(auth);
  const isCurrent = () => shouldContinue() && driveSessionIsCurrent(accountId, drive, generation);
  const [existing, pending] = await Promise.all([store.load(isCurrent), readPendingDriveAppData(accountId)]);
  if (!isCurrent()) return undefined;
  let snapshot = existing;
  let pendingChoice: 'remote' | 'local' | undefined;
  if (!snapshot) {
    snapshot = await store.loadOrCreate(pending?.state ?? DEFAULT_DRIVE_APPDATA_STATE, true, isCurrent);
    if (!isCurrent()) return undefined;
    if (pending) pendingChoice = 'local';
  } else if (pending) {
    if (sameDriveAppDataState(pending.state, snapshot.state)) pendingChoice = 'remote';
    else pendingChoice = (await appDataConflictDialog()) === 'local' ? 'local' : 'remote';
    if (!isCurrent()) return undefined;
  }
  if (!isCurrent()) return undefined;
  state.appDataStore = store;
  state.appDataSnapshot = snapshot;
  state.appDataPending = pending;
  state.appDataPendingChoice = pendingChoice;
  state.appDataSync = pending ? 'pending' : 'idle';
  state.appDataError = undefined;
  return { snapshot, pending, pendingChoice };
}

async function commitSelectedDriveFolder(
  folder: DriveFile, prompt: DriveAppDataState['folderPrompt'] = 'completed', baseState?: DriveAppDataState
): Promise<void> {
  const accountId = state.account?.accountId;
  const drive = state.drive;
  const generation = state.driveGeneration;
  if (state.folderId !== folder.id) {
    driveChildrenByParent.clear(); driveExpandedFolders.clear(); driveLoadingFolders.clear();
    driveFolderErrors.clear(); driveChildRequestSequences.clear(); driveFileRows = [];
  }
  const next = { ...(baseState ?? driveWorkspaceState()), selectedFolderId: folder.id, folderPrompt: prompt };
  if (!remoteAppDataRestoreInProgress && accountId && drive && state.appDataSnapshot) {
    try {
      if (!await persistPendingDriveAppData(accountId, drive, generation, next)) return;
    } catch (error) {
      if (driveSessionIsCurrent(accountId, drive, generation)) {
        state.appDataSync = 'error';
        state.appDataError = shortError(error);
        renderStorageStatus();
      }
      throw error;
    }
    if (!driveSessionIsCurrent(accountId, drive, generation)) return;
  }
  state.folderId = folder.id;
  state.folderName = folder.name;
  if (!remoteAppDataRestoreInProgress && accountId && drive && state.appDataSnapshot) {
    state.appDataSync = 'pending';
    state.appDataPendingChoice = 'local';
    renderStorageStatus();
    void persistDriveAppData(next);
  }
  await renderExplorer();
}

async function findCanonicalLibraryRoot(
  accountId: string, drive: GoogleDriveApi, generation: number,
  snapshot: DriveAppDataSnapshot, session: DriveAppDataState, requireSelectedFolderMatch = false
): Promise<DriveFile | undefined> {
  let folders = await drive.findAccessibleFolders();
  if (!driveSessionIsCurrent(accountId, drive, generation) || state.appDataSnapshot !== snapshot) return undefined;
  const marked = folders.filter(folder => folder.appProperties?.guitardslLibraryRoot === '1');
  let folder: DriveFile | undefined;
  if (marked.length === 1) folder = marked[0];
  else if (marked.length > 1) throw new Error('Multiple marked GuitarDSL library roots were found. Remove or rename the duplicate root folders in Google Drive.');
  else if (folders.length === 1) folder = folders[0];
  else if (folders.length > 1) throw new Error('Multiple top-level GuitarDSL folders were found. Remove or rename the duplicate folders in Google Drive.');
  if (!folder && session.selectedFolderId) {
    try {
      const savedCandidate = await drive.getFolder(session.selectedFolderId);
      if (!driveSessionIsCurrent(accountId, drive, generation) || state.appDataSnapshot !== snapshot) return undefined;
      if (await drive.isCanonicalLibraryRoot(savedCandidate)) folder = savedCandidate;
    } catch (error) {
      if (!(error instanceof DriveApiError && (error.status === 403 || error.status === 404))) throw error;
    }
  }
  if (!folder) return undefined;
  if (requireSelectedFolderMatch && session.selectedFolderId && session.selectedFolderId !== folder.id) {
    throw new Error('The selected Drive library folder no longer matches the verified GuitarDSL root.');
  }
  const verified = await drive.markLibraryRoot(folder);
  if (!driveSessionIsCurrent(accountId, drive, generation) || state.appDataSnapshot !== snapshot) return undefined;
  return verified;
}

async function setUpDriveFolderAfterConnect(
  accountId: string, drive: GoogleDriveApi, generation: number, sessionOverride?: DriveAppDataState
): Promise<void> {
  const snapshot = state.appDataSnapshot;
  const session = sessionOverride ?? state.appDataPending?.state ?? snapshot?.state;
  if (!snapshot || !session) return;
  const folder = await findCanonicalLibraryRoot(accountId, drive, generation, snapshot, session);
  if (!driveSessionIsCurrent(accountId, drive, generation) || state.appDataSnapshot !== snapshot) return;
  if (folder) {
    await commitSelectedDriveFolder(folder, 'completed', session);
    return;
  }
  if (session.folderPrompt === 'deferred') return;
  const choice = await folderSetupDialog();
  if (!driveSessionIsCurrent(accountId, drive, generation) || state.appDataSnapshot !== snapshot) return;
  if (choice === 'later') {
    await persistDriveAppData({ ...session, folderPrompt: 'deferred' });
    return;
  }
  await createDriveFolder(true);
}

async function connectDrive(options: { source?: 'welcome' } = {}): Promise<void> {
  if (driveConnectInProgress || reloadPreparationActive || pageCacheSuspended) return;
  const operationGeneration = workspaceOperationGeneration;
  const operationIsCurrent = () => workspaceOperationIsCurrent(operationGeneration);
  driveConnectInProgress = true;
  renderAll();
  try {
    if (state.account && !state.authExpired) {
      const synchronized = await flushDriveAppData();
      if (!operationIsCurrent()) { driveConnectInterrupted = true; return; }
      if (!synchronized || state.appDataSync !== 'idle') {
        await appDataPendingQueue;
        if (!operationIsCurrent()) { driveConnectInterrupted = true; return; }
        if (!window.confirm(strings().disconnectPendingConfirm)) return;
      }
      ++state.driveGeneration;
      try { await auth.disconnect(); } catch { /* local drafts and tabs remain intact */ }
      if (!operationIsCurrent()) { driveConnectInterrupted = true; return; }
      state.account = undefined; state.drive = undefined; state.folderId = undefined; state.folderName = undefined;
      driveChildrenByParent.clear(); driveExpandedFolders.clear(); driveLoadingFolders.clear(); driveFolderErrors.clear(); driveChildRequestSequences.clear(); driveFileRows = [];
      state.appDataStore = undefined; state.appDataSnapshot = undefined; state.appDataPending = undefined;
      state.appDataPendingChoice = undefined; state.appDataSync = 'idle'; state.appDataError = undefined;
      appDataOfflinePending = false;
      appDataUnknownOutcome = false;
      renderAll(); await persistSessions(); return;
    }
    await flushDriveAppData();
    if (!operationIsCurrent()) { driveConnectInterrupted = true; return; }
    const generation = ++state.driveGeneration;
    const previousAccount = state.account;
    const account = await auth.connect();
    if (!operationIsCurrent() || state.driveGeneration !== generation) { driveConnectInterrupted = true; return; }
    if (previousAccount && previousAccount.accountId !== account.accountId) {
      state.folderId = undefined; state.folderName = undefined;
    }
    const drive = new GoogleDriveApi(auth);
    state.account = account; state.drive = drive;
    driveChildrenByParent.clear(); driveExpandedFolders.clear(); driveLoadingFolders.clear(); driveFolderErrors.clear(); driveChildRequestSequences.clear(); driveFileRows = [];
    state.authExpired = false;
    state.folderId = undefined; state.folderName = undefined;
    state.appDataStore = undefined; state.appDataSnapshot = undefined; state.appDataPending = undefined;
    state.appDataPendingChoice = undefined; state.appDataSync = 'idle'; state.appDataError = undefined;
    appDataUnknownOutcome = false;
    const loaded = await loadDriveAppData(account.accountId, drive, generation, operationIsCurrent);
    if (!operationIsCurrent() || !loaded || !driveSessionIsCurrent(account.accountId, drive, generation)) {
      if (!operationIsCurrent()) driveConnectInterrupted = true;
      return;
    }
    const { snapshot, pending, pendingChoice } = loaded;
    if (snapshot.duplicateCount > 1) showMessage(strings().appDataDuplicates, 'error');
    const session = pending?.state ?? snapshot.state;
    if (pendingChoice === 'remote' && pending) {
      const restored = await restoreRemoteDriveAppData(snapshot, account.accountId, drive, generation, options.source !== 'welcome');
      if (!operationIsCurrent() || !restored || !driveSessionIsCurrent(account.accountId, drive, generation)) {
        if (!operationIsCurrent()) driveConnectInterrupted = true;
        return;
      }
    } else {
    await setUpDriveFolderAfterConnect(account.accountId, drive, generation);
    if (!operationIsCurrent() || !driveSessionIsCurrent(account.accountId, drive, generation)) {
      if (!operationIsCurrent()) driveConnectInterrupted = true;
      return;
    }
    const restored = options.source === 'welcome' || await restoreDriveSession(account.accountId, drive, generation, session);
    if (!operationIsCurrent() || !restored || !driveSessionIsCurrent(account.accountId, drive, generation)) {
      if (!operationIsCurrent()) driveConnectInterrupted = true;
      return;
    }
    if (pending) {
      if (sameDriveAppDataState(pending.state, snapshot.state)) {
        if (!await clearPendingDriveAppData(account.accountId, drive, generation, pending.state)) {
          throw new DriveAppDataError('unknown-outcome', 'The remote state matched, but the pending local record could not be cleared.');
        }
        if (!operationIsCurrent()) { driveConnectInterrupted = true; return; }
        state.appDataSync = 'idle';
      } else if (pendingChoice === 'local') {
        state.appDataSync = 'pending';
        await persistDriveAppData(driveWorkspaceState());
        if (!operationIsCurrent()) { driveConnectInterrupted = true; return; }
      }
    }
    }
    renderAll();
    if (state.activeStorage === 'drive') await renderExplorer();
    if (!operationIsCurrent()) { driveConnectInterrupted = true; return; }
    showMessage(account.emailAddress ? `Connected to Google Drive (${account.emailAddress}).` : 'Connected to Google Drive.');
    if (options.source !== 'welcome') {
      const importRecoveryMessage = await reconcilePendingDriveImports(account.accountId, drive, generation);
      if (!operationIsCurrent() || !driveSessionIsCurrent(account.accountId, drive, generation)) return;
      if (importRecoveryMessage) {
        const hasUnresolved = (await readPendingDriveImports(account.accountId)).length > 0;
        showMessage(importRecoveryMessage, hasUnresolved ? 'error' : 'info');
      }
    }
  } catch (error) {
    if (!operationIsCurrent()) driveConnectInterrupted = true;
    else {
      if (error instanceof DriveAppDataError) { state.appDataSync = 'error'; state.appDataError = error.message; }
      markDriveAuthState(error); showMessage(shortError(error), 'error');
    }
  }
  finally {
    if (operationIsCurrent()) {
      driveConnectInProgress = false;
      renderAll();
      if (deferredAppDataSync && state.appDataSync !== 'error' && navigator.onLine) {
        deferredAppDataSync = false;
        scheduleDriveAppDataSync();
      }
    }
  }
}

async function createDriveFolder(alreadyConfirmed = false): Promise<void> {
  const drive = state.drive; const accountId = state.account?.accountId; const generation = state.driveGeneration;
  if (!drive || !accountId || reloadPreparationActive || pageCacheSuspended) return;
  const operationGeneration = workspaceOperationGeneration;
  const isCurrent = () => workspaceOperationIsCurrent(operationGeneration) && driveSessionIsCurrent(accountId, drive, generation);
  activeDriveWorkflowOperations += 1;
  try {
    let folders = await drive.findAccessibleFolders();
    if (!isCurrent()) return;
    const marked = folders.filter(candidate => candidate.appProperties?.guitardslLibraryRoot === '1');
    let folder = marked.length === 1 ? marked[0] : marked.length > 1 ? undefined : folders.length === 1 ? folders[0] : undefined;
    if (marked.length > 1 || !marked.length && folders.length > 1) {
      throw new Error('Multiple top-level GuitarDSL folders were found. Remove or rename the duplicate folders in Google Drive.');
    }
    if (!folder) {
      if (!alreadyConfirmed && !window.confirm(strings().createFolderConfirm)) return;
      try { folder = await drive.createLibraryRoot(); }
      catch (createError) {
        // One list reconciliation handles a lost POST response; it never issues another create.
        folders = await drive.findAccessibleFolders();
        if (!isCurrent()) return;
        if (!folders.length) throw createError;
        const recoveredMarked = folders.filter(candidate => candidate.appProperties?.guitardslLibraryRoot === '1');
        if (recoveredMarked.length === 1) folder = recoveredMarked[0];
        else if (!recoveredMarked.length && folders.length === 1) folder = folders[0];
        else throw createError;
      }
    }
    if (!isCurrent()) return;
    const verified = await drive.markLibraryRoot(folder);
    if (!isCurrent()) return;
    await commitSelectedDriveFolder(verified);
    showMessage(state.locale === 'ja' ? 'GuitarDSL ライブラリを設定しました。' : 'Set up the GuitarDSL Library.');
  } catch (error) { if (isCurrent()) { markDriveAuthState(error); showMessage(shortError(error), 'error'); } }
  finally { activeDriveWorkflowOperations = Math.max(0, activeDriveWorkflowOperations - 1); }
}

function isDriveCommandCurrent(accountId: string, generation: number): boolean {
  return Boolean(state.drive && state.account?.accountId === accountId && state.driveGeneration === generation
    && !state.authExpired && navigator.onLine);
}

function isLibraryFolder(folderId: string): boolean {
  return folderId === state.folderId || [...driveChildrenByParent.values()].some(rows => rows.some(row =>
    row.id === folderId && row.mimeType === 'application/vnd.google-apps.folder'));
}

function toggleDriveLibraryFolder(accountId: string, generation: number, folderId: string): void {
  if (!isDriveCommandCurrent(accountId, generation) || !isLibraryFolder(folderId)) { staleMenuTarget(); return; }
  if (driveExpandedFolders.has(folderId)) {
    driveExpandedFolders.delete(folderId);
    publishWorkspaceSnapshot();
    return;
  }
  driveExpandedFolders.add(folderId);
  publishWorkspaceSnapshot();
  if (!driveChildrenByParent.has(folderId)) void loadDriveChildren(folderId);
}

function clearDriveSubtree(folderId: string): void {
  const queue = [folderId];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const child of driveChildrenByParent.get(current) ?? []) {
      if (child.mimeType === 'application/vnd.google-apps.folder') queue.push(child.id);
      driveExpandedFolders.delete(child.id);
      driveFolderErrors.delete(child.id);
    }
    driveChildrenByParent.delete(current);
    driveFolderErrors.delete(current);
  }
  rebuildDriveFileRows();
}

async function refreshDriveLibraryFolder(accountId: string, generation: number, folderId: string): Promise<void> {
  if (!isDriveCommandCurrent(accountId, generation) || !isLibraryFolder(folderId)) { staleMenuTarget(); return; }
  clearDriveSubtree(folderId);
  publishWorkspaceSnapshot();
  await loadDriveChildren(folderId, true);
}

function normalizedScoreName(input: string, extension = '.guitardsl'): string | undefined {
  const base = input.trim().replace(/\.(?:guitardsl|gdsl)$/iu, '').trim();
  return base ? `${base}${extension}` : undefined;
}

function loadedLibraryFolders(): DriveFile[] {
  const folders = new Map<string, DriveFile>();
  if (state.folderId && state.folderName) {
    folders.set(state.folderId, { id: state.folderId, name: state.folderName, version: '', modifiedTime: '',
      mimeType: 'application/vnd.google-apps.folder', appProperties: { guitardslLibraryRoot: '1' } });
  }
  for (const rows of driveChildrenByParent.values()) {
    for (const row of rows) if (row.mimeType === 'application/vnd.google-apps.folder') folders.set(row.id, row);
  }
  return [...folders.values()];
}

function findDriveLibraryItem(itemId: string): DriveFile | undefined {
  for (const rows of driveChildrenByParent.values()) {
    const found = rows.find(row => row.id === itemId);
    if (found) return found;
  }
  if (itemId === state.folderId && state.folderName) return {
    id: itemId, name: state.folderName, version: '', modifiedTime: '',
    mimeType: 'application/vnd.google-apps.folder',
    appProperties: { guitardslLibraryRoot: '1' }
  };
  return undefined;
}

function chooseLoadedLibraryFolder(): DriveFile | undefined {
  const folders = loadedLibraryFolders();
  if (!folders.length) return undefined;
  if (folders.length === 1) return folders[0];
  const choices = folders.map((folder, index) => `${index + 1}. ${folder.name}`).join('\n');
  const answer = window.prompt(state.locale === 'ja'
    ? `移動先のフォルダー番号を入力してください。\n${choices}`
    : `Enter the destination folder number.\n${choices}`, '1');
  const index = Number(answer) - 1;
  return Number.isInteger(index) && index >= 0 ? folders[index] : undefined;
}

async function createDriveLibraryFolder(accountId: string, generation: number, parentId: string): Promise<void> {
  if (!isDriveCommandCurrent(accountId, generation) || !isLibraryFolder(parentId)) { staleMenuTarget(); return; }
  const libraryRootId = state.folderId;
  if (!libraryRootId) { staleMenuTarget(); return; }
  const name = window.prompt(state.locale === 'ja' ? 'フォルダー名' : 'Folder name', 'New folder')?.trim();
  if (!name) return;
  const drive = state.drive;
  if (!drive) return;
  const operationGeneration = workspaceOperationGeneration;
  const isCurrent = () => workspaceOperationIsCurrent(operationGeneration) && state.drive === drive
    && isDriveCommandCurrent(accountId, generation) && state.folderId === libraryRootId && isLibraryFolder(parentId);
  activeDriveWorkflowOperations += 1;
  try {
    const verified = await getVerifiedLibraryTarget(drive, libraryRootId, parentId, isCurrent);
    if (!isCurrent() || !verified) return;
    const operationId = crypto.randomUUID();
    let created: DriveFile;
    try { created = await drive.createChildFolder(parentId, name, operationId); }
    catch (error) {
      if (!(error instanceof TypeError) && !(error instanceof DriveApiError && (error.status === 429 || error.status >= 500))) throw error;
      const reconciled = await drive.findFolderByOperation(parentId, operationId);
      if (!reconciled) throw new Error(state.locale === 'ja'
        ? 'フォルダー作成の結果を確認できません。Driveを確認してから再操作してください。'
        : 'The folder creation result is unknown. Check Drive before trying again.');
      created = reconciled;
    }
    if (!isCurrent()) return;
    const readback = await drive.getMetadata(created.id);
    if (!isCurrent()) return;
    if (readback.id !== created.id || readback.name !== name || readback.mimeType !== 'application/vnd.google-apps.folder'
      || readback.trashed || !readback.parents?.includes(parentId)) throw new Error('Google Drive did not confirm the new folder.');
    const stillVerified = await getVerifiedLibraryTarget(drive, libraryRootId, parentId, isCurrent);
    if (!isCurrent() || !stillVerified || !readback.parents?.includes(stillVerified.target.id)) return;
    await refreshDriveLibraryFolder(accountId, generation, parentId);
  } catch (error) { if (isCurrent()) { markDriveAuthState(error); showMessage(shortError(error), 'error'); } }
  finally { activeDriveWorkflowOperations = Math.max(0, activeDriveWorkflowOperations - 1); }
}

async function createDriveLibraryScore(accountId: string, generation: number, parentId: string): Promise<void> {
  if (!isDriveCommandCurrent(accountId, generation) || !isLibraryFolder(parentId)) { staleMenuTarget(); return; }
  const libraryRootId = state.folderId;
  if (!libraryRootId) { staleMenuTarget(); return; }
  const entered = window.prompt(state.locale === 'ja' ? '楽譜名（拡張子なし）' : 'Score name (without extension)', 'Untitled');
  if (entered === null) return;
  const name = normalizedScoreName(entered);
  if (!name) return;
  const drive = state.drive;
  if (!drive) return;
  const localOperationId = crypto.randomUUID();
  const operationGeneration = workspaceOperationGeneration;
  const isCurrent = () => workspaceOperationIsCurrent(operationGeneration) && state.drive === drive
    && isDriveCommandCurrent(accountId, generation) && state.folderId === libraryRootId && isLibraryFolder(parentId);
  activeDriveWorkflowOperations += 1;
  try {
    const verified = await getVerifiedLibraryTarget(drive, libraryRootId, parentId, isCurrent);
    if (!isCurrent() || !verified) return;
    let file: DriveFile;
    try { file = await drive.createFile(parentId, name, DEFAULT_SOURCE, localOperationId); }
    catch (error) {
      if (!(error instanceof TypeError) && !(error instanceof DriveApiError && (error.status === 429 || error.status >= 500))) throw error;
      const reconciled = await drive.findMoveUpload(parentId, localOperationId);
      if (!reconciled) throw new Error(state.locale === 'ja'
        ? '作成結果を確認できません。Driveを確認してから再試行してください。'
        : 'The create result is unknown. Check Drive before trying again.');
      file = reconciled;
    }
    if (!isCurrent()) return;
    const readback = await drive.getFile(file.id);
    if (!isCurrent()) return;
    if (readback.file.id !== file.id || readback.file.name !== name || !isSupportedDriveFile(readback.file.name)
      || readback.file.trashed || !readback.file.parents?.includes(parentId) || readback.source !== DEFAULT_SOURCE) {
      throw new Error('Google Drive did not confirm the new score.');
    }
    const stillVerified = await getVerifiedLibraryTarget(drive, libraryRootId, parentId, isCurrent);
    if (!isCurrent() || !stillVerified || !readback.file.parents?.includes(stillVerified.target.id)) return;
    await refreshDriveLibraryFolder(accountId, generation, parentId);
    await openDriveDocument(readback.file, accountId, drive, generation);
  } catch (error) { if (isCurrent()) { markDriveAuthState(error); showMessage(shortError(error), 'error'); } }
  finally { activeDriveWorkflowOperations = Math.max(0, activeDriveWorkflowOperations - 1); }
}

const pendingDriveImportKey = (accountId: string) => `pending-drive-imports:${accountId}`;
type PendingDriveCopyKind = 'import' | 'duplicate';
interface PendingDriveImport {
  operationId: string;
  sourceId: string;
  targetFolderId: string;
  name: string;
  kind: PendingDriveCopyKind;
  sourceSha256?: string;
  copiedFileId?: string;
  mayHaveSentCopy: boolean;
}

async function sha256Utf8Hex(source: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function parsePendingDriveImports(value: unknown): PendingDriveImport[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Partial<PendingDriveImport>;
    if (typeof record.operationId !== 'string' || typeof record.sourceId !== 'string'
      || typeof record.targetFolderId !== 'string' || typeof record.name !== 'string') return [];
    return [{
      operationId: record.operationId,
      sourceId: record.sourceId,
      targetFolderId: record.targetFolderId,
      name: record.name,
      kind: record.kind === 'duplicate' ? 'duplicate' : 'import',
      ...(typeof record.sourceSha256 === 'string' && /^[a-f\d]{64}$/iu.test(record.sourceSha256)
        ? { sourceSha256: record.sourceSha256.toLowerCase() } : {}),
      ...(typeof record.copiedFileId === 'string' ? { copiedFileId: record.copiedFileId } : {}),
      // Older import records were written before files.copy and may already have reached Drive.
      mayHaveSentCopy: record.mayHaveSentCopy === false ? false : true
    }];
  });
}

async function readPendingDriveImports(accountId: string): Promise<PendingDriveImport[]> {
  const value = await indexedDb.getValue<unknown>('settings', pendingDriveImportKey(accountId));
  return parsePendingDriveImports(value);
}

async function updatePendingDriveImports(
  accountId: string, update: (pending: PendingDriveImport[]) => PendingDriveImport[]
): Promise<PendingDriveImport[]> {
  const value = await indexedDb.updateValue<unknown>('settings', pendingDriveImportKey(accountId), current => {
    const next = update(parsePendingDriveImports(current));
    return next.length ? next : undefined;
  });
  return parsePendingDriveImports(value);
}

async function findPendingDriveCopy(
  accountId: string, sourceId: string, targetFolderId: string, kind: PendingDriveCopyKind
): Promise<PendingDriveImport | undefined> {
  return (await readPendingDriveImports(accountId)).find(entry => entry.sourceId === sourceId
    && entry.targetFolderId === targetFolderId && entry.kind === kind);
}

async function reservePendingDriveCopy(
  accountId: string, entry: PendingDriveImport
): Promise<{ entry: PendingDriveImport; reserved: boolean }> {
  let existing: PendingDriveImport | undefined;
  await updatePendingDriveImports(accountId, pending => {
    existing = pending.find(item => item.sourceId === entry.sourceId && item.targetFolderId === entry.targetFolderId
      && item.kind === entry.kind && item.name === entry.name);
    return existing ? pending : [...pending, entry];
  });
  return existing ? { entry: existing, reserved: false } : { entry, reserved: true };
}

async function updatePendingDriveCopy(
  accountId: string, operationId: string, changes: Partial<PendingDriveImport>, onlyIfUnsent = false
): Promise<boolean> {
  let updated = false;
  await updatePendingDriveImports(accountId, pending => pending.map(entry => {
    if (entry.operationId !== operationId || onlyIfUnsent && entry.mayHaveSentCopy) return entry;
    updated = true;
    return { ...entry, ...changes };
  }));
  return updated;
}

async function removePendingDriveCopy(accountId: string, operationId: string, onlyIfUnsent = false): Promise<boolean> {
  let removed = false;
  await updatePendingDriveImports(accountId, pending => pending.filter(entry => {
    if (entry.operationId !== operationId || onlyIfUnsent && entry.mayHaveSentCopy) return true;
    removed = true;
    return false;
  }));
  return removed;
}

async function isConfirmedPendingCopy(
  readback: { file: DriveFile; source: string }, entry: PendingDriveImport, sourceSha256: string
): Promise<boolean> {
  const file = readback.file;
  return file.id !== entry.sourceId && (!entry.copiedFileId || file.id === entry.copiedFileId)
    && file.name === entry.name && isSupportedDriveFile(file.name) && isSupportedDriveMimeType(file.mimeType)
    && !file.trashed && file.parents?.includes(entry.targetFolderId) === true
    && file.appProperties?.guitardslImportOperation === entry.operationId
    && await sha256Utf8Hex(readback.source) === sourceSha256;
}

async function reconcilePendingDriveCopy(
  accountId: string, drive: GoogleDriveApi, generation: number, entry: PendingDriveImport
): Promise<'confirmed' | 'unresolved' | 'not-sent'> {
  if (!entry.mayHaveSentCopy) {
    if (await removePendingDriveCopy(accountId, entry.operationId, true)) return 'not-sent';
    const latest = (await readPendingDriveImports(accountId)).find(item => item.operationId === entry.operationId);
    if (!latest?.mayHaveSentCopy) return 'unresolved';
    entry = latest;
  }
  const isCurrent = () => driveSessionIsCurrent(accountId, drive, generation);
  if (!isCurrent()) return 'unresolved';
  let sourceSha256 = entry.sourceSha256;
  if (!sourceSha256) {
    try {
      const original = await drive.getFile(entry.sourceId);
      if (!isCurrent() || original.file.id !== entry.sourceId || original.file.trashed
        || !isSupportedDriveFile(original.file.name) || !isSupportedDriveMimeType(original.file.mimeType)) return 'unresolved';
      sourceSha256 = await sha256Utf8Hex(original.source);
      if (!isCurrent()) return 'unresolved';
    } catch { return 'unresolved'; }
  }
  let confirmed: DriveFile | undefined;
  if (entry.copiedFileId) {
    try {
      const known = await drive.getFile(entry.copiedFileId);
      if (!isCurrent()) return 'unresolved';
      if (await isConfirmedPendingCopy(known, entry, sourceSha256)) confirmed = known.file;
    } catch { /* Try the operation marker when direct readback is temporarily unavailable. */ }
  }
  if (!isCurrent()) return 'unresolved';
  if (!confirmed) {
    try {
      const marked = await drive.findImportByOperation(entry.targetFolderId, entry.operationId);
      if (!isCurrent()) return 'unresolved';
      if (marked) {
        const readback = await drive.getFile(marked.id);
        if (!isCurrent()) return 'unresolved';
        if (await isConfirmedPendingCopy(readback, entry, sourceSha256)) confirmed = readback.file;
      }
    } catch { /* Preserve the journal until an ID or marker can be read back. */ }
  }
  if (!confirmed || !isCurrent()) return 'unresolved';
  const rootId = state.folderId;
  if (!rootId) return 'unresolved';
  try {
    const target = await getVerifiedLibraryTarget(drive, rootId, entry.targetFolderId, isCurrent);
    if (!isCurrent() || !target || !confirmed.parents?.includes(target.target.id)) return 'unresolved';
  } catch { return 'unresolved'; }
  try { await removePendingDriveCopy(accountId, entry.operationId); }
  catch { /* The confirmed copy is safe; a retained record will confirm it again later. */ }
  return 'confirmed';
}

async function reconcilePendingDriveImports(accountId: string, drive: GoogleDriveApi, generation: number): Promise<string | undefined> {
  const pending = await readPendingDriveImports(accountId);
  if (!pending.length) return undefined;
  let recoveredImports = 0;
  let recoveredDuplicates = 0;
  let unresolved = 0;
  const refreshedFolders = new Set<string>();
  for (const entry of pending) {
    if (!driveSessionIsCurrent(accountId, drive, generation)) return undefined;
    const result = await reconcilePendingDriveCopy(accountId, drive, generation, entry);
    if (result === 'confirmed') {
      if (entry.kind === 'duplicate') recoveredDuplicates += 1;
      else recoveredImports += 1;
      refreshedFolders.add(entry.targetFolderId);
    } else if (result === 'unresolved') unresolved += 1;
  }
  for (const folderId of refreshedFolders) {
    if (!driveSessionIsCurrent(accountId, drive, generation)) return undefined;
    driveChildrenByParent.delete(folderId);
    await loadDriveChildren(folderId, true);
  }
  if (unresolved) return state.locale === 'ja'
    ? `Driveのコピー結果を確認できない操作が ${unresolved} 件あります。再コピーせず、Driveを確認してください。`
    : `${unresolved} Drive copy result${unresolved === 1 ? '' : 's'} remain unconfirmed. Check Drive; no new copy was sent.`;
  const recovered = recoveredImports + recoveredDuplicates;
  if (recovered) return state.locale === 'ja'
    ? `前回のコピー結果を確認しました（インポート ${recoveredImports} 件、複製 ${recoveredDuplicates} 件）。`
    : `Confirmed previous copies: ${recoveredImports} import${recoveredImports === 1 ? '' : 's'}, ${recoveredDuplicates} duplicate${recoveredDuplicates === 1 ? '' : 's'}.`;
  return undefined;
}

async function importFromDrivePicker(
  accountId = state.account?.accountId, generation = state.driveGeneration, targetFolderId = state.folderId,
  preselected?: DrivePickerSelection[]
): Promise<void> {
  const drive = state.drive;
  if (!accountId || !drive || !targetFolderId || reloadPreparationActive || pageCacheSuspended) return;
  if (!isDriveCommandCurrent(accountId, generation) || !isLibraryFolder(targetFolderId)) { staleMenuTarget(); return; }
  const libraryRootId = state.folderId;
  if (!libraryRootId) { staleMenuTarget(); return; }
  const operationGeneration = workspaceOperationGeneration;
  const isCurrent = () => workspaceOperationIsCurrent(operationGeneration) && state.drive === drive
    && isDriveCommandCurrent(accountId, generation) && state.folderId === libraryRootId && isLibraryFolder(targetFolderId);
  activeDriveWorkflowOperations += 1;
  try {
    if (!preselected) {
      const beforePicker = await getVerifiedLibraryTarget(drive, libraryRootId, targetFolderId, isCurrent);
      if (!isCurrent() || !beforePicker) return;
    }
    const selected = preselected ?? await drive.pickFiles();
    if (!isCurrent() || !selected?.length) return;
    const selectedTarget = await getVerifiedLibraryTarget(drive, libraryRootId, targetFolderId, isCurrent);
    if (!isCurrent() || !selectedTarget) return;
    const children = await drive.listChildren(targetFolderId);
    if (!isCurrent()) return;
    const names = new Set(children.map(item => item.name.toLocaleLowerCase()));
    let imported = 0;
    let failed = 0;
    let unknown = 0;
    for (const source of selected) {
      if (!isCurrent()) return;
      if (!isSupportedDriveFile(source.name) || !isSupportedDriveMimeType(source.mimeType)) { failed += 1; continue; }
      const previous = await findPendingDriveCopy(accountId, source.id, targetFolderId, 'import');
      if (previous) {
        if (!previous.mayHaveSentCopy) { unknown += 1; continue; }
        const reconciled = await reconcilePendingDriveCopy(accountId, drive, generation, previous);
        if (!isCurrent()) return;
        if (reconciled === 'confirmed') { imported += 1; names.add(previous.name.toLocaleLowerCase()); }
        else unknown += 1;
        continue;
      }
      let name = source.name;
      if (names.has(name.toLocaleLowerCase())) {
        const entered = window.prompt(state.locale === 'ja'
          ? `${name} は同じ名前のファイルがあります。別の名前を入力するか、空欄でスキップしてください。`
          : `${name} already exists. Enter another name, or leave blank to skip.`, name.replace(/\.(?:guitardsl|gdsl)$/iu, ' (imported)$&'));
        if (entered === null || !entered.trim()) continue;
        const oldExtension = source.name.match(/\.(guitardsl|gdsl)$/iu)?.[0] ?? '.guitardsl';
        name = normalizedScoreName(entered, oldExtension) ?? '';
        if (!name || names.has(name.toLocaleLowerCase())) { failed += 1; continue; }
      }
      let pendingEntry: PendingDriveImport | undefined;
      let requestStarted = false;
      try {
        const original = await drive.getFile(source.id);
        if (!isCurrent()) return;
        if (original.file.id !== source.id || original.file.trashed || !isSupportedDriveFile(original.file.name)
          || !isSupportedDriveMimeType(original.file.mimeType)) {
          throw new Error('The selected Drive file is no longer available for import.');
        }
        const sourceSha256 = await sha256Utf8Hex(original.source);
        if (!isCurrent()) return;
        const currentTarget = await getVerifiedLibraryTarget(drive, libraryRootId, targetFolderId, isCurrent);
        if (!isCurrent() || !currentTarget) return;
        const entry: PendingDriveImport = {
          operationId: crypto.randomUUID(), sourceId: source.id, targetFolderId, name, kind: 'import', sourceSha256,
          mayHaveSentCopy: false
        };
        const reservation = await reservePendingDriveCopy(accountId, entry);
        if (!reservation.reserved) {
          const reconciled = reservation.entry.mayHaveSentCopy
            ? await reconcilePendingDriveCopy(accountId, drive, generation, reservation.entry) : 'unresolved';
          if (!isCurrent()) return;
          if (reconciled === 'confirmed') { imported += 1; names.add(reservation.entry.name.toLocaleLowerCase()); }
          else unknown += 1;
          continue;
        }
        pendingEntry = entry;
        const markedSent = await updatePendingDriveCopy(accountId, entry.operationId, { mayHaveSentCopy: true }, true);
        if (!markedSent) { unknown += 1; continue; }
        if (!isCurrent()) {
          await removePendingDriveCopy(accountId, entry.operationId);
          return;
        }
        requestStarted = true;
        const copied = await drive.copyFile(source.id, currentTarget.target.id, name, entry.operationId);
        try { await updatePendingDriveCopy(accountId, entry.operationId, { copiedFileId: copied.id }); }
        catch { /* The operation marker remains the fallback if this best-effort ID write fails. */ }
        if (!isCurrent()) return;
        const readback = await drive.getFile(copied.id);
        if (!isCurrent()) return;
        if (!await isConfirmedPendingCopy(readback, { ...entry, copiedFileId: copied.id }, sourceSha256)) {
          unknown += 1; continue;
        }
        const verifiedAfterCopy = await getVerifiedLibraryTarget(drive, libraryRootId, targetFolderId, isCurrent);
        if (!isCurrent() || !verifiedAfterCopy || !readback.file.parents?.includes(verifiedAfterCopy.target.id)) {
          unknown += 1;
          continue;
        }
        try { await removePendingDriveCopy(accountId, entry.operationId); }
        catch { /* A confirmed copy remains safe to report; a retained record will reconcile later. */ }
        imported += 1;
        names.add(name.toLocaleLowerCase());
      } catch (error) {
        if (!isCurrent()) return;
        if (requestStarted) unknown += 1;
        else {
          if (pendingEntry) await removePendingDriveCopy(accountId, pendingEntry.operationId, true);
          failed += 1;
        }
      }
    }
    await refreshDriveLibraryFolder(accountId, generation, targetFolderId);
    showMessage(state.locale === 'ja'
      ? `インポート: ${imported} 件確認、${failed} 件失敗、${unknown} 件結果不明`
      : `Import: ${imported} confirmed, ${failed} failed, ${unknown} unconfirmed`, failed || unknown ? 'error' : 'info');
  } catch (error) { if (isCurrent()) { markDriveAuthState(error); showMessage(shortError(error), 'error'); } }
  finally { activeDriveWorkflowOperations = Math.max(0, activeDriveWorkflowOperations - 1); }
}

async function withSerializedDriveMetadataMutation<T>(
  accountId: string, generation: number, itemId: string, mutation: (drive: GoogleDriveApi, file: DriveFile, tab: OpenTab | undefined, isCurrent: () => boolean) => Promise<T>,
  allowTrashPending = false
): Promise<T | undefined> {
  const drive = state.drive;
  const cached = findDriveLibraryItem(itemId);
  if (!drive || !cached || !isDriveCommandCurrent(accountId, generation)) return undefined;
  const operationGeneration = workspaceOperationGeneration;
  const isCurrent = () => workspaceOperationIsCurrent(operationGeneration)
    && state.drive === drive && isDriveCommandCurrent(accountId, generation);
  return withDriveOperation(() => serializeDriveSave(accountId, itemId, async () => {
    if (!isCurrent()) return undefined;
    const tab = state.tabs.find(candidate => candidate.document.identity.storage === 'drive'
      && candidate.document.identity.fileId === itemId && candidate.accountId === accountId);
    if (tab?.driveTrashed || tab?.driveTrashPending && !allowTrashPending) return undefined;
    const latest = await drive.getMetadata(itemId);
    if (!isCurrent()) return undefined;
    const expectedVersion = tab?.document.driveVersion ?? cached.version;
    const expectedModifiedTime = tab?.document.driveModifiedTime ?? cached.modifiedTime;
    const expectedRevision = tab?.document.driveRevisionId ?? cached.headRevisionId;
    if (latest.trashed || expectedVersion && latest.version !== expectedVersion
      || expectedModifiedTime && latest.modifiedTime !== expectedModifiedTime
      || expectedRevision && latest.headRevisionId !== expectedRevision) {
      throw new Error('The Drive item changed since it was loaded. Refresh the library before trying again.');
    }
    return mutation(drive, latest, tab, isCurrent);
  }));
}

async function getVerifiedDriveLibraryRoot(
  drive: GoogleDriveApi, rootId: string, isCurrent: () => boolean
): Promise<DriveFile | undefined> {
  const root = await drive.getMetadata(rootId);
  if (!isCurrent()) return undefined;
  if (!root.trashed && await drive.isCanonicalLibraryRoot(root)) return isCurrent() ? root : undefined;
  if (!isCurrent()) return undefined;
  throw new Error('The GuitarDSL library root is no longer a top-level My Drive folder.');
}

async function getVerifiedDriveLibraryFolder(
  drive: GoogleDriveApi, folderId: string, rootId: string, root: DriveFile, isCurrent: () => boolean
): Promise<DriveFile | undefined> {
  if (folderId === rootId) return root;
  const folder = await drive.getMetadata(folderId);
  if (!isCurrent()) return undefined;
  if (folder.id !== folderId || folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error('The selected Drive folder is no longer available in the library.');
  }
  const isWithinLibrary = await drive.isWithinFolder(folder, rootId);
  if (!isCurrent()) return undefined;
  if (!isWithinLibrary) throw new Error('The selected Drive folder is outside the GuitarDSL library.');
  return folder;
}

async function getVerifiedLibraryTarget(
  drive: GoogleDriveApi, rootId: string, targetFolderId: string, isCurrent: () => boolean
): Promise<{ root: DriveFile; target: DriveFile } | undefined> {
  const root = await getVerifiedDriveLibraryRoot(drive, rootId, isCurrent);
  if (!isCurrent() || !root) return undefined;
  const target = await getVerifiedDriveLibraryFolder(drive, targetFolderId, rootId, root, isCurrent);
  if (!isCurrent() || !target) return undefined;
  return { root, target };
}

async function syncOpenDriveTabMetadata(tab: OpenTab | undefined, accountId: string, file: DriveFile): Promise<void> {
  if (!tab) return;
  const updated = await indexedDb.updateDriveDocumentMetadata(tab.document.identity, accountId, {
    name: file.name, driveVersion: file.version, driveModifiedTime: file.modifiedTime,
    driveRevisionId: file.headRevisionId, driveFolderId: file.parents?.[0]
  });
  if (!updated) throw new Error('The open Drive document is missing from local storage.');
  tab.document = {
    ...tab.document, name: file.name, driveVersion: file.version, driveModifiedTime: file.modifiedTime,
    driveRevisionId: file.headRevisionId, driveEtag: undefined, driveFolderId: file.parents?.[0]
  };
}

async function renameDriveLibraryItem(accountId: string, generation: number, itemId: string, kind: 'folder' | 'score', parentId: string): Promise<void> {
  if (!isDriveCommandCurrent(accountId, generation)) { staleMenuTarget(); return; }
  const current = findDriveLibraryItem(itemId);
  if (!current || kind === 'folder' && current.mimeType !== 'application/vnd.google-apps.folder') { staleMenuTarget(); return; }
  const extension = kind === 'score' ? current.name.match(/\.(?:guitardsl|gdsl)$/iu)?.[0] ?? '.guitardsl' : '';
  const initial = extension ? current.name.slice(0, -extension.length) : current.name;
  const entered = window.prompt(state.locale === 'ja' ? '新しい名前' : 'New name', initial);
  if (entered === null || !entered.trim()) return;
  const name = kind === 'score' ? normalizedScoreName(entered, extension) : entered.trim();
  if (!name) return;
  activeDriveWorkflowOperations += 1;
  try {
    const renamed = await withSerializedDriveMetadataMutation(accountId, generation, itemId, async (drive, latest, tab, isCurrent) => {
      if (!latest.parents?.includes(parentId)) throw new Error('The item is no longer in the selected library folder.');
      const updated = await drive.renameItem(latest, name);
      if (!isCurrent()) return undefined;
      await syncOpenDriveTabMetadata(tab, accountId, updated);
      return updated;
    });
    if (renamed && isDriveCommandCurrent(accountId, generation)) await refreshDriveLibraryFolder(accountId, generation, parentId);
  } catch (error) { if (isDriveCommandCurrent(accountId, generation)) { markDriveAuthState(error); showMessage(shortError(error), 'error'); } }
  finally { activeDriveWorkflowOperations = Math.max(0, activeDriveWorkflowOperations - 1); }
}

async function duplicateDriveLibraryScore(accountId: string, generation: number, itemId: string, parentId: string): Promise<void> {
  const drive = state.drive;
  const source = driveFileRows.find(row => row.id === itemId);
  if (!drive || !source || !isDriveCommandCurrent(accountId, generation)) { staleMenuTarget(); return; }
  const libraryRootId = state.folderId;
  if (!libraryRootId) { staleMenuTarget(); return; }
  activeDriveWorkflowOperations += 1;
  try {
    const outcome = await withSerializedDriveMetadataMutation(accountId, generation, itemId, async (queuedDrive, latest, _tab, isCurrent) => {
      const operationIsCurrent = () => isCurrent() && state.folderId === libraryRootId;
      if (!operationIsCurrent()) return undefined;
      if (!latest.parents?.includes(parentId) || !isSupportedDriveFile(latest.name)
        || !isSupportedDriveMimeType(latest.mimeType)) {
        throw new Error('The score is no longer in the selected library folder.');
      }
      const root = await getVerifiedDriveLibraryRoot(queuedDrive, libraryRootId, operationIsCurrent);
      if (!operationIsCurrent() || !root) return undefined;
      const parent = await getVerifiedDriveLibraryFolder(queuedDrive, parentId, libraryRootId, root, operationIsCurrent);
      if (!operationIsCurrent() || !parent) return undefined;
      const original = await queuedDrive.getFile(itemId);
      if (!operationIsCurrent()) return undefined;
      if (original.file.id !== latest.id || original.file.trashed || original.file.name !== latest.name
        || original.file.version !== latest.version || original.file.modifiedTime !== latest.modifiedTime
        || original.file.headRevisionId !== latest.headRevisionId || !original.file.parents?.includes(parentId)
        || !isSupportedDriveMimeType(original.file.mimeType)) {
        throw new Error('The score changed before it could be copied. Refresh the library and try again.');
      }
      const sourceSha256 = await sha256Utf8Hex(original.source);
      if (!operationIsCurrent()) return undefined;
      const previous = await findPendingDriveCopy(accountId, itemId, parentId, 'duplicate');
      if (previous) {
        const reconciled = previous.mayHaveSentCopy
          ? await reconcilePendingDriveCopy(accountId, queuedDrive, generation, previous) : 'unresolved';
        if (!operationIsCurrent()) return undefined;
        return { status: reconciled === 'confirmed' ? 'recovered' as const : 'unresolved' as const };
      }
      const children = await queuedDrive.listChildren(parentId);
      if (!operationIsCurrent()) return undefined;
      const extension = latest.name.match(/\.(?:guitardsl|gdsl)$/iu)?.[0] ?? '.guitardsl';
      const stem = latest.name.slice(0, -extension.length);
      const names = new Set(children.map(item => item.name.toLocaleLowerCase()));
      let name = `${stem} (copy)${extension}`;
      for (let suffix = 2; names.has(name.toLocaleLowerCase()); suffix += 1) name = `${stem} (copy ${suffix})${extension}`;
      const targetBeforeCopy = await getVerifiedLibraryTarget(queuedDrive, libraryRootId, parent.id, operationIsCurrent);
      if (!operationIsCurrent() || !targetBeforeCopy) return undefined;
      const entry: PendingDriveImport = {
        operationId: crypto.randomUUID(), sourceId: itemId, targetFolderId: parent.id, name,
        kind: 'duplicate', sourceSha256, mayHaveSentCopy: false
      };
      const reservation = await reservePendingDriveCopy(accountId, entry);
      if (!reservation.reserved) {
        const reconciled = reservation.entry.mayHaveSentCopy
          ? await reconcilePendingDriveCopy(accountId, queuedDrive, generation, reservation.entry) : 'unresolved';
        if (!operationIsCurrent()) return undefined;
        return { status: reconciled === 'confirmed' ? 'recovered' as const : 'unresolved' as const };
      }
      let requestStarted = false;
      try {
        const markedSent = await updatePendingDriveCopy(accountId, entry.operationId, { mayHaveSentCopy: true }, true);
        if (!markedSent) return { status: 'unresolved' as const };
        if (!operationIsCurrent()) {
          await removePendingDriveCopy(accountId, entry.operationId);
          return undefined;
        }
        requestStarted = true;
        const copy = await queuedDrive.copyFile(itemId, targetBeforeCopy.target.id, name, entry.operationId);
        try { await updatePendingDriveCopy(accountId, entry.operationId, { copiedFileId: copy.id }); }
        catch { /* The operation marker remains the fallback if this best-effort ID write fails. */ }
        if (!operationIsCurrent()) return { status: 'unresolved' as const };
        const readback = await queuedDrive.getFile(copy.id);
        if (!operationIsCurrent()) return { status: 'unresolved' as const };
        if (!await isConfirmedPendingCopy(readback, { ...entry, copiedFileId: copy.id }, sourceSha256)) {
          return { status: 'unresolved' as const };
        }
        const verifiedAfterCopy = await getVerifiedLibraryTarget(queuedDrive, libraryRootId, parent.id, operationIsCurrent);
        if (!operationIsCurrent() || !verifiedAfterCopy || !readback.file.parents?.includes(verifiedAfterCopy.target.id)) {
          return { status: 'unresolved' as const };
        }
        try { await removePendingDriveCopy(accountId, entry.operationId); }
        catch { /* A confirmed copy remains safe to report; a retained record will reconcile later. */ }
        return { status: 'copied' as const };
      } catch (error) {
        if (requestStarted) return { status: 'unresolved' as const };
        await removePendingDriveCopy(accountId, entry.operationId, true);
        throw error;
      }
    });
    if (!outcome || !isDriveCommandCurrent(accountId, generation)) return;
    if (outcome.status === 'copied' || outcome.status === 'recovered') {
      await refreshDriveLibraryFolder(accountId, generation, parentId);
      if (outcome.status === 'recovered') showMessage(state.locale === 'ja'
        ? '前回の複製結果を確認しました。新しいコピーは作成していません。'
        : 'The previous duplicate was confirmed. No new copy was created.', 'info');
    } else {
      showMessage(state.locale === 'ja'
        ? '複製結果を確認できません。再コピーせず、Driveを確認してください。'
        : 'The duplicate result is unconfirmed. Check Drive; no second copy was sent.', 'error');
    }
  } catch (error) { if (isDriveCommandCurrent(accountId, generation)) { markDriveAuthState(error); showMessage(shortError(error), 'error'); } }
  finally { activeDriveWorkflowOperations = Math.max(0, activeDriveWorkflowOperations - 1); }
}

async function moveDriveLibraryScore(accountId: string, generation: number, itemId: string, sourceParentId: string): Promise<void> {
  const drive = state.drive;
  const source = driveFileRows.find(row => row.id === itemId);
  if (!drive || !source || !isDriveCommandCurrent(accountId, generation)) { staleMenuTarget(); return; }
  const target = chooseLoadedLibraryFolder();
  if (!target || target.id === sourceParentId || !isDriveCommandCurrent(accountId, generation)) return;
  const libraryRootId = state.folderId;
  if (!libraryRootId) { staleMenuTarget(); return; }
  activeDriveWorkflowOperations += 1;
  try {
    const moved = await withSerializedDriveMetadataMutation(accountId, generation, itemId, async (queuedDrive, latest, tab, isCurrent) => {
      const operationIsCurrent = () => isCurrent() && state.folderId === libraryRootId;
      if (!operationIsCurrent()) return undefined;
      if (!latest.parents?.includes(sourceParentId)) throw new Error('The score is no longer in the selected folder.');
      const root = await getVerifiedDriveLibraryRoot(queuedDrive, libraryRootId, operationIsCurrent);
      if (!operationIsCurrent() || !root) return undefined;
      const sourceParent = await getVerifiedDriveLibraryFolder(queuedDrive, sourceParentId, libraryRootId, root, operationIsCurrent);
      if (!operationIsCurrent() || !sourceParent) return undefined;
      const targetParent = await getVerifiedDriveLibraryFolder(queuedDrive, target.id, libraryRootId, root, operationIsCurrent);
      if (!operationIsCurrent() || !targetParent) return undefined;
      const updated = await queuedDrive.moveFile(latest, target.id, sourceParentId);
      if (!operationIsCurrent()) return undefined;
      await syncOpenDriveTabMetadata(tab, accountId, updated);
      return updated;
    });
    if (!moved || !isDriveCommandCurrent(accountId, generation)) return;
    await refreshDriveLibraryFolder(accountId, generation, sourceParentId);
    await refreshDriveLibraryFolder(accountId, generation, target.id);
  } catch (error) { if (isDriveCommandCurrent(accountId, generation)) { markDriveAuthState(error); showMessage(shortError(error), 'error'); } }
  finally { activeDriveWorkflowOperations = Math.max(0, activeDriveWorkflowOperations - 1); }
}

async function trashDriveLibraryScore(accountId: string, generation: number, itemId: string, parentId: string): Promise<void> {
  const drive = state.drive;
  const file = driveFileRows.find(row => row.id === itemId);
  if (!drive || !file || !isDriveCommandCurrent(accountId, generation)) { staleMenuTarget(); return; }
  const identity = driveIdentity(itemId);
  const openTab = state.tabs.find(tab => tab.document.identity.storage === 'drive'
    && tab.document.identity.fileId === itemId && tab.accountId === accountId);
  const draft = await indexedDb.getDraft(identity, accountId);
  if (!isDriveCommandCurrent(accountId, generation)) return;
  const needsLocalCopy = Boolean(openTab || draft);
  const confirmed = window.confirm(needsLocalCopy
    ? state.locale === 'ja'
      ? 'この楽譜は開いているか下書きがあります。ローカルコピーを保存してからGoogle Driveのゴミ箱へ移動しますか？'
      : 'This score is open or has a draft. Save a local copy, then move it to Google Drive trash?'
    : state.locale === 'ja' ? 'この楽譜をGoogle Driveのゴミ箱へ移動しますか？' : 'Move this score to Google Drive trash?');
  if (!confirmed || !isDriveCommandCurrent(accountId, generation)) return;
  if (openTab) openTab.driveTrashPending = true;
  activeDriveWorkflowOperations += 1;
  let convertedTab = false;
  try {
    const trashed = await withSerializedDriveMetadataMutation(accountId, generation, itemId, async (queuedDrive, latest, tab, isCurrent) => {
      let localCopy: StoredDocument | undefined;
      if (tab) {
        const oldKey = tabKey(tab);
        await draftWrites.get(oldKey);
        if (!isCurrent()) return undefined;
      }
      const savedOrDraft = await indexedDb.getDocument(identity, accountId);
      const copySource = tab?.source ?? (needsLocalCopy ? savedOrDraft?.source : undefined);
      if (copySource !== undefined) {
        const extension = latest.name.match(/\.(?:guitardsl|gdsl)$/iu)?.[0] ?? '.guitardsl';
        const stem = latest.name.slice(0, -extension.length);
        localCopy = await indexedDb.createLocal(`${stem} (local copy)${extension}`, copySource);
      }
      if (!isCurrent()) return undefined;
      const result = await queuedDrive.trashFile(latest);
      if (!isCurrent()) return undefined;
      if (tab && localCopy) {
        const oldKey = tabKey(tab);
        await draftWrites.get(oldKey);
        const currentSource = tab.source;
        const revision = currentSource === localCopy.source ? 0 : 1;
        const localBaseline = { revision: localCopy.revision, source: localCopy.source };
        tab.document = localCopy;
        tab.accountId = undefined;
        tab.revision = revision;
        tab.persistedBase = localBaseline;
        tab.saveStatus = revision > 0 ? 'draft' : 'local-saved';
        tab.driveTrashPending = undefined;
        tab.driveTrashed = undefined;
        if (state.activeKey === oldKey) {
          state.activeKey = tabKey(tab);
          state.activeStorage = 'local';
        }
        convertedTab = true;
        renderAll();
        void persistSessions();
        if (revision > 0) {
          const localKey = tabKey(tab);
          const previousWrite = draftWrites.get(localKey) ?? Promise.resolve();
          const localDraftWrite = previousWrite.catch(() => undefined).then(async () => {
            if (!state.tabs.includes(tab) || tabKey(tab) !== localKey) return;
            const kept = await indexedDb.saveDraft({ identity: localCopy.identity, revision, source: currentSource }, undefined, localBaseline);
            if (!kept) throw new Error('The latest editor draft could not be copied to local storage.');
            if (state.tabs.includes(tab) && tabKey(tab) === localKey) {
              tab.persistedBase = { revision, source: currentSource };
              if (tab.revision === revision && tab.source === currentSource) tab.saveStatus = 'draft';
            }
          });
          draftWrites.set(localKey, localDraftWrite);
          try { await localDraftWrite; }
          finally { if (draftWrites.get(localKey) === localDraftWrite) draftWrites.delete(localKey); }
        }
        await indexedDb.deleteDocument(identity, accountId);
      } else if (localCopy) {
        await indexedDb.deleteDocument(identity, accountId);
      }
      return result;
    }, true);
    if (!trashed || !isDriveCommandCurrent(accountId, generation)) return;
    await refreshDriveLibraryFolder(accountId, generation, parentId);
    if (needsLocalCopy) showMessage(state.locale === 'ja' ? 'ローカルコピーを保存し、Drive のゴミ箱へ移動しました。' : 'Saved a local copy and moved the Drive score to trash.');
  } catch (error) { if (isDriveCommandCurrent(accountId, generation)) { markDriveAuthState(error); showMessage(shortError(error), 'error'); } }
  finally {
    if (openTab && !convertedTab) openTab.driveTrashPending = undefined;
    activeDriveWorkflowOperations = Math.max(0, activeDriveWorkflowOperations - 1);
  }
}

function safeDriveLink(webViewLink: string | undefined, itemId: string, kind: 'folder' | 'score'): string {
  if (kind === 'score' && webViewLink) {
    try {
      const url = new URL(webViewLink);
      if (url.protocol === 'https:' && url.hostname === 'drive.google.com') return url.href;
    } catch { /* use a constructed Drive URL */ }
  }
  return kind === 'folder'
    ? `https://drive.google.com/drive/folders/${encodeURIComponent(itemId)}`
    : `https://drive.google.com/open?id=${encodeURIComponent(itemId)}`;
}

function showDriveLinkFallback(url: string): void {
  document.querySelector('.drive-link-fallback')?.remove();
  const toast = document.createElement('div');
  toast.className = 'drive-link-fallback';
  toast.setAttribute('role', 'status');
  toast.textContent = state.locale === 'ja' ? '新しいタブが開かない場合: ' : 'If the new tab did not open: ';
  const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.textContent = state.locale === 'ja' ? 'Google Driveで開く' : 'Open in Google Drive';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'drive-link-fallback-close';
  close.textContent = '×'; close.setAttribute('aria-label', strings().close);
  close.addEventListener('click', () => toast.remove(), { once: true });
  toast.append(link, close); document.body.append(toast);
  window.setTimeout(() => toast.remove(), 12000);
}

function showLibraryAbout(): void {
  const dialog = createThemedConflictDialog();
  const heading = document.createElement('h2');
  heading.textContent = strings().libraryAbout;
  const body = document.createElement('p');
  body.textContent = state.locale === 'ja'
    ? 'このライブラリはマイドライブ直下のGuitarDSLフォルダーです。表示されるのはこのアプリがアクセスできるフォルダーと楽譜だけです。'
    : 'This library is the GuitarDSL folder at the top level of My Drive. It shows only folders and scores this app can access.';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'primary-button';
  close.textContent = strings().close; close.addEventListener('click', () => { dialog.close(); dialog.remove(); });
  dialog.append(heading, body, close); document.body.append(dialog); dialog.showModal();
}

function openDriveLibraryItem(accountId: string, generation: number, itemId: string, kind: 'folder' | 'score', webViewLink?: string): void {
  if (!isDriveCommandCurrent(accountId, generation)) { staleMenuTarget(); return; }
  const url = safeDriveLink(webViewLink, itemId, kind);
  window.open(url, '_blank', 'noopener,noreferrer');
  showDriveLinkFallback(url);
}

async function openFromDrivePicker(): Promise<void> {
  await importFromDrivePicker();
}

async function openDriveDocument(
  file: Pick<DriveFile, 'id'>, accountId = state.account?.accountId, drive = state.drive,
  generation = state.driveGeneration, pickerRetry = false
): Promise<void> {
  const operationGeneration = workspaceOperationGeneration;
  const operationIsCurrent = () => workspaceOperationIsCurrent(operationGeneration);
  if (!drive || !accountId || reloadPreparationActive || pageCacheSuspended) return;
  const isCurrent = () => operationIsCurrent() && driveSessionIsCurrent(accountId, drive, generation);
  if (!isCurrent()) return;
  const identity = driveIdentity(file.id);
  const open = state.tabs.find(tab => sameTabIdentity(tab, identity, accountId));
  if (open) { await setActive(tabKey(open), isCurrent); return; }
  activeDriveReadOperations += 1;
  try {
    const [saved, draft, latest] = await Promise.all([
      indexedDb.getSavedDocument(identity, accountId),
      indexedDb.getDraft(identity, accountId),
      drive.getFile(file.id, undefined, isCurrent)
    ]);
    if (!isCurrent()) return;
    if (latest.file.id !== file.id || latest.file.trashed || !isSupportedDriveFile(latest.file.name)
      || !isSupportedDriveMimeType(latest.file.mimeType)) {
      throw new Error('This Google Drive file is no longer an available GuitarDSL score.');
    }
    if (!state.folderId || !await drive.isWithinFolder(latest.file, state.folderId, undefined, isCurrent)) {
      if (!isCurrent()) return;
      throw new Error('This Google Drive score is no longer inside the GuitarDSL library.');
    }

    if (draft && latest.source === draft.source) {
      const base = saved ?? {
        identity, accountId, name: latest.file.name, source: latest.source, revision: 0,
        createdAt: Date.now(), updatedAt: Date.now()
      } satisfies StoredDocument;
      const refreshed: StoredDocument = {
        ...base, name: latest.file.name, source: latest.source, revision: draft.revision,
        driveVersion: latest.file.version, driveModifiedTime: latest.file.modifiedTime, driveEtag: latest.etag,
        driveRevisionId: latest.file.headRevisionId, driveFolderId: latest.file.parents?.[0], updatedAt: Date.now()
      };
      const committed = await indexedDb.commitDriveDocument(refreshed, draft, false, isCurrent);
      if (!isCurrent()) return;
      if (!committed) throw new Error('A newer local draft exists; it was kept.');
      await openDocument(refreshed, latest.source, accountId, true, isCurrent);
      return;
    }
    if (draft && saved && latest.source === saved.source) {
      const refreshed: StoredDocument = {
        ...saved, name: latest.file.name, driveVersion: latest.file.version,
        driveModifiedTime: latest.file.modifiedTime, driveEtag: latest.etag,
        driveRevisionId: latest.file.headRevisionId, driveFolderId: latest.file.parents?.[0], updatedAt: Date.now()
      };
      const updated = await indexedDb.upsertDriveDocument(refreshed, isCurrent);
      if (!isCurrent()) return;
      if (!updated) return;
      await openDocument({ ...refreshed, revision: draft.revision }, draft.source, accountId, true, isCurrent);
      return;
    }
    if (draft) {
      const choice = await conflictDialog();
      if (choice === 'cancel' || !isCurrent()) return;
      if (choice === 'save-as') {
        const base = saved ?? {
          identity, accountId, name: latest.file.name, source: latest.source, revision: 0,
          createdAt: Date.now(), updatedAt: Date.now(), driveVersion: latest.file.version,
          driveModifiedTime: latest.file.modifiedTime, driveRevisionId: latest.file.headRevisionId,
          driveEtag: latest.etag, driveFolderId: latest.file.parents?.[0]
        } satisfies StoredDocument;
        const oldDoc = { ...base, source: draft.source, revision: draft.revision };
        const opened = await openDocument(oldDoc, draft.source, accountId, true, isCurrent);
        if (!opened || !isCurrent()) return;
        await saveDriveCopy(opened, latest.file.parents?.[0] ?? state.folderId, drive, accountId, isCurrent);
        return;
      }
      const refreshed: StoredDocument = {
        ...(saved ?? {
          identity, accountId, name: latest.file.name, source: latest.source,
          revision: 0, createdAt: Date.now(), updatedAt: Date.now()
        }),
        name: latest.file.name, source: latest.source, revision: Math.max(saved?.revision ?? 0, draft.revision) + 1,
        driveVersion: latest.file.version, driveModifiedTime: latest.file.modifiedTime, driveEtag: latest.etag,
        driveRevisionId: latest.file.headRevisionId,
        driveFolderId: latest.file.parents?.[0] ?? state.folderId, updatedAt: Date.now()
      };
      if (!isCurrent()) return;
      const committed = await indexedDb.commitDriveDocument(refreshed, {
        identity, revision: draft.revision, source: draft.source
      }, false, isCurrent);
      if (!isCurrent()) return;
      if (!committed) throw new Error('A newer local draft exists; it was kept.');
      await openDocument(refreshed, refreshed.source, accountId, true, isCurrent); return;
    }
    const documentRow: StoredDocument = {
      identity, accountId, name: latest.file.name, source: latest.source,
      revision: saved ? saved.revision + Number(saved.source !== latest.source) : 0,
      createdAt: saved?.createdAt ?? Date.now(), updatedAt: Date.now(), driveVersion: latest.file.version,
      driveModifiedTime: latest.file.modifiedTime, driveRevisionId: latest.file.headRevisionId, driveEtag: latest.etag,
      driveFolderId: latest.file.parents?.[0] ?? state.folderId
    };
    if (!isCurrent()) return;
    const updated = await indexedDb.upsertDriveDocument(documentRow, isCurrent);
    if (!isCurrent()) return;
    if (!updated) return;
    await openDocument(documentRow, latest.source, accountId, true, isCurrent);
  } catch (error) {
    if (!isCurrent()) return;
    markDriveAuthState(error);
    if (!pickerRetry && error instanceof DriveApiError && (error.status === 403 || error.status === 404)) {
      const retry = window.confirm(state.locale === 'ja'
        ? 'このファイルはまだ GuitarDSL から認可されていません。Google Drive Picker で選び直しますか？'
        : 'This file is not authorized for GuitarDSL yet. Reopen Google Drive Picker to authorize it?');
      if (retry && isCurrent()) {
        const selection = await drive.pickFile();
        if (!isCurrent() || !selection) return;
        if (selection.id !== file.id) {
          await importFromDrivePicker(accountId, generation, state.folderId, [selection]);
          return;
        }
        let selectedManagedFile = false;
        try {
          const selectedMetadata = await drive.getMetadata(selection.id);
          if (!isCurrent()) return;
          selectedManagedFile = !selectedMetadata.trashed && isSupportedDriveFile(selectedMetadata.name)
            && Boolean(state.folderId && await drive.isWithinFolder(selectedMetadata, state.folderId));
        } catch (selectionError) {
          if (!(selectionError instanceof DriveApiError && (selectionError.status === 403 || selectionError.status === 404))) throw selectionError;
        }
        if (selectedManagedFile) {
          await openDriveDocument(file, accountId, drive, generation, true);
        } else {
          await importFromDrivePicker(accountId, generation, state.folderId, [selection]);
        }
        return;
      }
    }
    showMessage(shortError(error), 'error');
  } finally {
    activeDriveReadOperations = Math.max(0, activeDriveReadOperations - 1);
  }
}

async function restoreDriveSession(
  accountId: string, drive = state.drive, generation = state.driveGeneration,
  session = state.appDataPending?.state ?? state.appDataSnapshot?.state
): Promise<boolean> {
  const snapshot = state.appDataSnapshot;
  if (!state.storageReady || !drive || !snapshot || !session || state.account?.accountId !== accountId) return false;
  const isCurrent = () => driveSessionIsCurrent(accountId, drive, generation) && state.appDataSnapshot === snapshot;
  restoringDriveSession = true;
  try {
    const ids = new Set([...session.openDriveFileIds, ...(session.activeDriveFileId ? [session.activeDriveFileId] : [])]);
    for (const tab of [...state.tabs]) {
      if (tab.document.identity.storage !== 'drive' || tab.accountId !== accountId || ids.has(tab.document.identity.fileId)) continue;
      await closeTab(tab);
      if (!isCurrent()) return false;
      if (state.tabs.includes(tab)) throw new Error('Could not preserve the draft while restoring Drive tabs.');
    }
    for (const fileId of ids) {
      if (!isCurrent()) return false;
      await openDriveDocument({ id: fileId }, accountId, drive, generation);
      if (!isCurrent()) return false;
      if (!state.tabs.some(tab => tab.document.identity.storage === 'drive'
        && tab.document.identity.fileId === fileId && tab.accountId === accountId)) return false;
    }
    if (session.activeDriveFileId && isCurrent()) {
      const tab = state.tabs.find(item => item.document.identity.storage === 'drive' && item.document.identity.fileId === session.activeDriveFileId && item.accountId === accountId);
      if (!tab || !editorReadyForDocumentChange()) return false;
      state.activeKey = tabKey(tab); state.activeStorage = 'drive';
    } else {
      const active = activeTab();
      if (active?.document.identity.storage === 'drive' && active.accountId === accountId) {
        const local = state.tabs.find(item => item.document.identity.storage === 'local');
        state.activeKey = local ? tabKey(local) : null;
        state.activeStorage = local ? 'local' : 'drive';
      }
    }
    return isCurrent();
  } catch (error) {
    if (isCurrent()) { markDriveAuthState(error); showMessage(shortError(error), 'error'); }
    return false;
  }
  finally { restoringDriveSession = false; }
}

async function moveToDrive(tab = activeTab()): Promise<void> {
  if (reloadPreparationActive || pageCacheSuspended) return;
  const drive = state.drive;
  const accountId = state.account?.accountId;
  const folderId = state.folderId;
  const generation = state.driveGeneration;
  if (moveToDriveInProgress || !tab || tab.document.identity.storage !== 'local' || !drive || !accountId || !folderId) return;
  const isCurrent = () => driveSessionIsCurrent(accountId, drive, generation) && state.tabs.includes(tab);
  if (!editorReadyForDocumentChange()) return;
  moveToDriveInProgress = true;
  syncWorkspaceInteractionLock();
  let resultMessage: { text: string; kind: 'info' | 'error' } | undefined;
  try {
    await stopCandidateAudition();
    if (!isCurrent()) return;
    if (!await saveDraftNow(tab)) throw new Error('Could not preserve the local draft; transfer cancelled.');
    if (!isCurrent()) return;
    const transferSnapshot = snapshot(tab);
    const remote = await moveLocalDocumentToDrive(transferSnapshot, tab.document.name, folderId, accountId, drive);
    if (!isCurrent()) return;
    if (!editorReadyForDocumentChange()) throw new Error(state.locale === 'ja' ? '日本語入力を確定してから再試行してください。' : 'Finish text composition before completing the move.');
    const replacement: OpenTab = { ...tab, document: remote, source: remote.source, revision: 0, accountId,
      persistedBase: { revision: 0, source: remote.source }, saveStatus: 'drive-saved' };
    const existing = state.tabs.find(other => other !== tab && sameTabIdentity(other, remote.identity, accountId));
    if (existing) { state.tabs.splice(state.tabs.indexOf(tab), 1); existing.document = remote; existing.source = remote.source; state.activeKey = tabKey(existing); }
    else { state.tabs[state.tabs.indexOf(tab)] = replacement; state.activeKey = tabKey(replacement); }
    renderAll(); await persistSessions(); await renderExplorer();
    resultMessage = { text: state.locale === 'ja' ? 'Drive への移動が完了しました。' : 'Moved the score to Google Drive.', kind: 'info' };
  } catch (error) {
    if (!isCurrent()) return;
    if (error instanceof LocalMoveConflictError) {
      let latestLoaded = false;
      try {
        const latest = await indexedDb.getDocument(tab.document.identity);
        if (!isCurrent()) return;
        if (latest) {
          tab.document = latest;
          tab.source = latest.source;
          tab.revision = latest.revision;
          tab.persistedBase = { revision: latest.revision, source: latest.source };
          tab.saveStatus = 'draft';
          renderAll();
          await persistSessions();
          latestLoaded = true;
        }
      } catch { /* Preserve the transfer error and the local source. */ }
      resultMessage = { text: state.locale === 'ja'
        ? latestLoaded
          ? 'Drive には転送開始時点の版が保存されています。転送中に更新されたローカル版を読み込みました。両方を確認し、必要な版を保存してください。'
          : 'Drive には転送開始時点の版が保存されています。ローカル原本も残っています。両方を確認し、必要な版を保存してください。'
        : latestLoaded
          ? 'Drive contains the version captured at transfer start. The newer local version is loaded. Review both and save the version you need.'
          : 'Drive contains the version captured at transfer start. The local original remains. Review both and save the version you need.', kind: 'error' };
    } else if (error instanceof MoveVerificationError) resultMessage = { text: state.locale === 'ja'
      ? 'Drive 上のファイルがローカル原本と一致しません。ローカル原本は保持されています。Drive とローカルの内容を確認してください。'
      : 'The Drive file does not match the local original. The local original is kept. Review both versions before continuing.', kind: 'error' };
    else if (error instanceof MoveRecoveryError) resultMessage = { text: state.locale === 'ja'
      ? 'Drive 側のコピーは検証済みですが、ローカル原本は残っています。もう一度「Drive に移動」を選ぶと、重複作成せずに完了できます。'
      : 'The Drive copy is verified and the local original remains. Retry Move to Drive to finish without creating a duplicate.', kind: 'error' };
    else { markDriveAuthState(error); resultMessage = { text: shortError(error), kind: 'error' }; }
  } finally {
    moveToDriveInProgress = false;
    syncWorkspaceInteractionLock();
  }
  if (resultMessage) showMessage(resultMessage.text, resultMessage.kind);
}

async function savePreferences(): Promise<void> {
  try { await indexedDb.setValue('settings', 'web-preferences', { pageSize: state.pageSize, orientation: state.orientation, expandPageBreakRepeats: state.expandPageBreakRepeats, locale: state.locale, theme: state.theme, splitRatio: state.splitRatio }); }
  catch { state.storageReady = false; renderStorageStatus(); }
}

async function loadPreferences(): Promise<void> {
  const preferences = await indexedDb.getValue<Partial<AppState>>('settings', 'web-preferences').catch(() => undefined);
  if (!preferences) return;
  if (['A4', 'A3', 'A5', 'B4', 'B5', 'Letter'].includes(String(preferences.pageSize))) state.pageSize = preferences.pageSize as PageSize;
  if (preferences.orientation === 'portrait' || preferences.orientation === 'landscape') state.orientation = preferences.orientation;
  if (typeof preferences.expandPageBreakRepeats === 'boolean') state.expandPageBreakRepeats = preferences.expandPageBreakRepeats;
  if (preferences.locale === 'en' || preferences.locale === 'ja') state.locale = preferences.locale;
  if (preferences.theme === 'system' || preferences.theme === 'light' || preferences.theme === 'dark') state.theme = preferences.theme;
  if (typeof preferences.splitRatio === 'number' && preferences.splitRatio >= 0.25 && preferences.splitRatio <= 0.75) state.splitRatio = preferences.splitRatio;
}

async function restoreLocalSession(): Promise<void> {
  const session = await indexedDb.getValue<WorkspaceSession>('sessions', 'workspace-local').catch(() => undefined);
  if (session?.tabs.length) {
    for (const fileId of session.tabs) {
      const row = await indexedDb.getDocument({ storage: 'local', fileId });
      if (row) await openDocument(row, row.source);
    }
    const selected = session.active && state.tabs.find(tab => tab.document.identity.storage === 'local' && tab.document.identity.fileId === session.active);
    if (selected && editorReadyForDocumentChange()) state.activeKey = tabKey(selected);
  } else {
    const local = await indexedDb.listDocuments('local');
    if (local.length) {
      const row = await indexedDb.getDocument(local[0].identity);
      if (row) await openDocument(row, row.source);
    } else {
      const created = await indexedDb.createLocal('Untitled.guitardsl', DEFAULT_SOURCE);
      await openDocument(created);
    }
  }
}

function progressionStartAtCaret(score: ParsedScore, offset: number): number {
  const before = sourceEditor.getText().slice(0, Math.max(0, offset));
  const line = before.split('\n').length - 1;
  const column = before.length - before.lastIndexOf('\n') - 1;
  const tokens = (score.codeActionTokens ?? []).filter(token => token.kind === 'chord'
    && token.measureIndex !== undefined && token.line === line);
  const exact = tokens.find(token => token.startCol <= column && column <= token.endCol);
  const nearest = [...tokens].reverse().find(token => token.startCol <= column) ?? tokens[0];
  return (exact ?? nearest)?.measureIndex ?? score.measures.length;
}

function progressionFailureMessage(code: string): string {
  const messages = getMessages(state.locale);
  switch (code) {
    case 'sourceHasErrors': return messages.progressionSourceErrors;
    case 'keyNotDeclared': return messages.progressionKeyRequired;
    case 'invalidKey': return messages.progressionInvalidKey;
    case 'invalidCapo': return messages.progressionInvalidCapo;
    case 'unsupportedQuality': return messages.progressionUnsupportedQuality;
    case 'ambiguousHarmony': return messages.progressionAmbiguousHarmony;
    case 'keyBoundary': return messages.progressionKeyBoundary;
    default: return messages.progressionNoSafeCandidates;
  }
}

async function suggestProgression(tab: OpenTab): Promise<void> {
  const score = currentScore(tab.source, tab);
  if (!score || activeTab() !== tab) return;
  const startMeasure = state.progressionOperation === 'append'
    ? score.measures.length
    : Math.min(state.progressionStartMeasure ?? progressionStartAtCaret(score, sourceEditor.selection().from), Math.max(0, score.measures.length - state.progressionBars));
  state.progressionStartMeasure = state.progressionOperation === 'append' ? undefined : startMeasure;
  const target = { startMeasure };
  const result = suggestProgressions(score, target, state.progressionBars);
  state.lastProgression = result.ok ? {
    target, operation: state.progressionOperation, bars: state.progressionBars,
    candidates: result.candidates, source: tab.source, revision: tab.revision
  } : undefined;
  state.progressionCandidateId = result.ok ? result.candidates[0]?.id : undefined;
  state.progressionError = !result.ok ? progressionFailureMessage(result.code)
    : !result.candidates.length ? getMessages(state.locale).progressionNoSafeCandidates : undefined;
  renderInspector();
}

function applyProgressionCandidate(tab: OpenTab, candidate: ProgressionCandidate): void {
  const progression = state.lastProgression;
  const score = currentScore(tab.source, tab);
  if (!progression || !score || moveToDriveInProgress || activeTab() !== tab
    || tab.source !== progression.source || tab.revision !== progression.revision
    || !progression.candidates.some(item => item.id === candidate.id)) {
    showMessage(getMessages(state.locale).progressionApplyFailed, 'error');
    return;
  }
  const plan = planProgressionEdit(tab.source, score, {
    startMeasure: progression.target.startMeasure, bars: progression.bars, operation: progression.operation
  }, candidate);
  if (!plan.ok) {
    showMessage(getMessages(state.locale).progressionApplyFailed, 'error');
    return;
  }
  state.lastProgression = undefined;
  state.progressionCandidateId = undefined;
  replaceEditorSourceWithUndo(plan.previewSource);
}

function requestPreviewDraftCheck(
  identity: PreviewModeDraftCheck['identity'], postToFrame: (payload: Record<string, unknown>) => void
): Promise<boolean | undefined> {
  const requestId = `preview-draft-${++previewModeDraftCheckSequence}`;
  return new Promise(resolve => {
    const timeout = window.setTimeout(() => {
      previewModeDraftChecks.delete(requestId);
      resolve(undefined);
    }, 2000);
    previewModeDraftChecks.set(requestId, {
      identity,
      resolve: hasDraft => { window.clearTimeout(timeout); resolve(hasDraft); }
    });
    postToFrame({ command: 'previewModeDraftCheck', requestId, ...identity });
  });
}

function isCurrentPreviewIdentity(tab: OpenTab, identity: PreviewModeDraftCheck['identity']): boolean {
  return activeTab() === tab && activeIdentityLabel(tab) === identity.documentUri
    && tab.revision === identity.documentVersion && state.previewGeneration === identity.previewGeneration;
}

function visualEditOperationFromMessage(
  score: ParsedScore, message: Record<string, unknown>, visualElementId: string
): VisualEditOperation | undefined {
  const binding = score.visualSourceBindings?.find(item => item.id === visualElementId);
  const payload = typeof message.payload === 'object' && message.payload !== null
    ? message.payload as Record<string, unknown> : undefined;
  if (!binding || !payload) return undefined;
  const text = typeof payload.text === 'string' && payload.text.length <= 256 && !/[\r\n\0]/.test(payload.text)
    ? payload.text : undefined;
  if (binding.kind === 'chord' && message.operation === 'replaceChord'
    && typeof payload.name === 'string' && payload.name.length <= 64 && !/[\r\n\0]/.test(payload.name)) {
    return { kind: 'replaceChord', bindingId: binding.id, name: payload.name };
  }
  if (message.operation === 'insertToken' && text !== undefined) return { kind: 'insertToken', bindingId: binding.id, text };
  if (message.operation === 'deleteToken') return { kind: 'deleteToken', bindingId: binding.id };
  if (['melodyNote', 'melodyGroup', 'melodyRest', 'noteGroup', 'inlineNote'].includes(binding.kind)
    && message.operation === 'replaceMelodyToken' && text !== undefined) {
    return { kind: 'replaceMelodyToken', bindingId: binding.id, text };
  }
  if (binding.kind === 'melodyNote' && message.operation === 'transposeMelody'
    && Number.isSafeInteger(payload.semitones) && payload.semitones !== 0 && Math.abs(payload.semitones as number) <= 11) {
    return { kind: 'transposeMelody', bindingId: binding.id, semitones: payload.semitones as number };
  }
  if (['melodyNote', 'melodyGroup', 'melodyRest', 'rhythm', 'noteGroup', 'inlineNote'].includes(binding.kind)
    && message.operation === 'changeDuration' && (payload.direction === 'longer' || payload.direction === 'shorter')) {
    return { kind: 'changeDuration', bindingId: binding.id, direction: payload.direction };
  }
  if (['rhythm', 'noteGroup', 'inlineNote'].includes(binding.kind)
    && message.operation === 'replaceRhythmToken' && text !== undefined) {
    return { kind: 'replaceRhythmToken', bindingId: binding.id, text };
  }
  if (binding.kind === 'tab' && message.operation === 'replaceTabToken' && text !== undefined) {
    return { kind: 'replaceTabToken', bindingId: binding.id, text };
  }
  if (binding.kind === 'tab' && message.operation === 'addTabChordNote'
    && typeof payload.note === 'string' && payload.note.length <= 64 && !/[\r\n\0]/.test(payload.note)) {
    return { kind: 'addTabChordNote', bindingId: binding.id, note: payload.note };
  }
  if (binding.kind === 'tab' && message.operation === 'deleteTabChordNote'
    && typeof payload.note === 'string' && payload.note.length <= 64 && !/[\r\n\0]/.test(payload.note)) {
    return { kind: 'deleteTabChordNote', bindingId: binding.id, note: payload.note };
  }
  if (binding.kind === 'lyric' && message.operation === 'replaceLyric' && text !== undefined) {
    return { kind: 'replaceLyric', bindingId: binding.id, text };
  }
  return undefined;
}

async function transitionPreviewUiMode(
  tab: OpenTab, mode: PreviewMode, identity: PreviewModeDraftCheck['identity'],
  postToFrame: (payload: Record<string, unknown>) => void
): Promise<void> {
  const previousMode = tab.previewMode;
  if (previousMode === mode) return;
  if (previousMode === 'edit') {
    const hasDraft = await requestPreviewDraftCheck(identity, postToFrame);
    if (!isCurrentPreviewIdentity(tab, identity)) return;
    if (hasDraft === undefined) {
      postToFrame({ command: 'previewUiModeResult', ...identity, mode: previousMode, success: false, reason: 'staleContext' });
      return;
    }
    if (hasDraft) {
      showMessage(strings().previewEditGuard, 'info');
      postToFrame({ command: 'previewUiModeResult', ...identity, mode: previousMode, success: false, reason: 'pendingDraft' });
      return;
    }
  }
  if (!isCurrentPreviewIdentity(tab, identity)) return;
  tab.previewMode = mode;
  postToFrame({ command: 'previewUiModeResult', ...identity, mode, success: true });
  window.setTimeout(() => { if (isCurrentPreviewIdentity(tab, identity)) renderPreview(tab); }, 60);
}

function handlePreviewMessage(message: PreviewMessage, postToFrame: PreviewPostMessage): void {
  if (message.command === 'progressionAudioPreviewStopped' && typeof message.leaseId === 'string') {
    const waiter = previewAudioStopWaiters.get(message.leaseId);
    if (message.leaseId === previewAudioLockId) previewAudioLockAcknowledged = true;
    if (waiter) {
      window.clearTimeout(waiter.timeout);
      previewAudioStopWaiters.delete(message.leaseId);
      waiter.resolve(true);
    }
    progressionAudioLease.acknowledgePreviewStopped(message.leaseId);
    return;
  }
  const tab = activeTab();
  if (!tab) return;
  if (moveToDriveInProgress || reloadPreparationActive || pageCacheSuspended) return;
  if (['contextMenu', 'previewVisualEdit', 'previewEditReference', 'previewOpenVisualSource', 'savePdf'].includes(String(message.command))
    && !sourceEditor.flushPendingEdit()) return;
  const isCurrent = message.documentUri === activeIdentityLabel(tab)
    && message.documentVersion === tab.revision && message.previewGeneration === state.previewGeneration;
  if (message.command === 'contextMenu') {
    if (isCurrent && Number.isFinite(message.clientX) && Number.isFinite(message.clientY)) {
      openPreviewContextMenu(Number(message.clientX), Number(message.clientY), tab, {
        documentUri: activeIdentityLabel(tab), documentVersion: tab.revision, previewGeneration: state.previewGeneration
      }, String(message.visualElementId ?? ''));
    }
    return;
  }
  if (message.command === 'previewUiModeRequest' && isCurrent) {
    const mode = message.mode;
    if (mode === 'normal' || mode === 'edit' || mode === 'practice') {
      void transitionPreviewUiMode(tab, mode, {
        documentUri: activeIdentityLabel(tab), documentVersion: tab.revision, previewGeneration: state.previewGeneration
      }, postToFrame);
    }
    return;
  }
  if (message.command === 'previewModeDraftCheckAcknowledged' && typeof message.requestId === 'string'
    && typeof message.hasDraft === 'boolean') {
    const pending = previewModeDraftChecks.get(message.requestId);
    if (pending && pending.identity.documentUri === message.documentUri
      && pending.identity.documentVersion === message.documentVersion
      && pending.identity.previewGeneration === message.previewGeneration) {
      previewModeDraftChecks.delete(message.requestId);
      pending.resolve(message.hasDraft);
    }
    return;
  }
  if (message.command === 'previewVisualEdit' && isCurrent && tab.previewMode === 'edit') {
    const visualElementId = String(message.visualElementId ?? '');
    const selectedVisualElementId = String(message.selectedVisualElementId ?? '');
    const score = currentScore(tab.source, tab);
    const operation = score ? visualEditOperationFromMessage(score, message, visualElementId) : undefined;
    const resultIdentity = { documentUri: activeIdentityLabel(tab), documentVersion: tab.revision, previewGeneration: state.previewGeneration };
    if (!operation || operation.bindingId !== visualElementId || (selectedVisualElementId && selectedVisualElementId !== visualElementId)) {
      postToFrame({ command: 'previewVisualEditResult', ...resultIdentity, success: false, reason: 'staleContext' }); return;
    }
    const result = score ? planVisualEdit(tab.source, score, operation) : { ok: false as const, code: 'staleSource' as const };
    if (!result.ok) { postToFrame({ command: 'previewVisualEditResult', ...resultIdentity, success: false, reason: result.code }); return; }
    const nextSource = result.resultingSource;
    replaceEditorSourceWithUndo(nextSource);
    postToFrame({ command: 'previewVisualEditResult', ...resultIdentity, success: true });
    return;
  }
  if ((message.command === 'previewEditReference' || message.command === 'previewOpenVisualSource') && isCurrent) {
    const id = String(message.visualElementId ?? '');
    const binding = currentScore(tab.source, tab)?.visualSourceBindings?.find(item => item.id === id);
    if (!binding) return;
    const lines = sourceEditor.getText().split('\n');
    const offset = lines.slice(0, binding.line).reduce((total, line) => total + line.length + 1, 0) + binding.startCol;
    sourceEditor.setSelection(offset, Math.min(sourceEditor.getText().length, offset + Math.max(1, binding.endCol - binding.startCol)));
    return;
  }
  if (message.command === 'layoutChanged' && isCurrent) {
    if (['A4', 'A3', 'A5', 'B4', 'B5', 'Letter'].includes(String(message.pageSize))) tab.pageSize = message.pageSize as PageSize;
    if (message.orientation === 'portrait' || message.orientation === 'landscape') tab.orientation = message.orientation;
    state.pageSize = tab.pageSize; state.orientation = tab.orientation;
    void savePreferences(); renderPreview(tab); renderInspector(); return;
  }
  if (message.command === 'savePdf' && isCurrent) {
    if (['A4', 'A3', 'A5', 'B4', 'B5', 'Letter'].includes(String(message.pageSize))) tab.pageSize = message.pageSize as PageSize;
    if (message.orientation === 'portrait' || message.orientation === 'landscape') tab.orientation = message.orientation;
    void downloadPdf(tab); return;
  }
  if (message.command === 'openScoreSettingsFromPreview') { state.inspectorTab = 'settings'; renderInspector(); return; }
  if (message.command === 'editChord' && isCurrent && typeof message.key === 'string') {
    const originalSource = tab.source;
    const originalRevision = tab.revision;
    try {
      showChordDiagramEditor({
        source: originalSource, key: message.key, locale: state.locale,
        apply: (nextSource, expectedSource) => {
          if (moveToDriveInProgress || activeTab() !== tab || tab.revision !== originalRevision
            || tab.source !== expectedSource) return false;
          replaceEditorSourceWithUndo(nextSource);
          return tab.source === nextSource;
        }
      });
    } catch (error) { showMessage(shortError(error), 'error'); }
    return;
  }
  if (message.command === 'temporarySettingsChanged') showMessage(state.locale === 'ja' ? '一時的な楽譜変換はソースで編集してください。' : 'Edit the source to change score transformations.', 'info');
}

function replaceEditorSourceWithUndo(source: string): void {
  const oldSelection = sourceEditor.selection();
  sourceEditor.replaceSource(source, 'input.replace');
  sourceEditor.setSelection(Math.min(oldSelection.from, sourceEditor.getText().length), Math.min(oldSelection.to, sourceEditor.getText().length));
}

interface WorkspaceMenuAction {
  label: string;
  run?: () => void | Promise<void>;
  disabled?: boolean;
  checked?: boolean;
  shortcut?: string;
  separator?: boolean;
  href?: string;
}
let activeMenuInvoker: HTMLElement | undefined;
let menuInvokerSequence = 0;

function closeWorkspaceMenu(): void {
  const focusTarget = activeMenuInvoker;
  if (focusTarget?.getAttribute('aria-haspopup') === 'menu') focusTarget.setAttribute('aria-expanded', 'false');
  activeMenuInvoker = undefined;
  workspaceMenuSnapshot = undefined;
  workspaceMenuActions = [];
  publishWorkspaceSnapshot();
}

function showWorkspaceMenu(_menu: HTMLElement | null | undefined, x: number, y: number, actions: WorkspaceMenuAction[], invoker?: HTMLElement): void {
  activeMenuInvoker = invoker;
  if (invoker && !invoker.id) invoker.id = `workspace-menu-invoker-${++menuInvokerSequence}`;
  workspaceMenuActions = actions;
  const id = invoker?.id === 'menu-file-trigger' ? 'file'
    : invoker?.id === 'menu-edit-trigger' ? 'edit'
      : invoker?.id === 'menu-view-trigger' ? 'view'
        : invoker?.id === 'menu-help-trigger' ? 'help'
          : invoker?.id === 'connect-drive' ? 'drive'
          : invoker?.id === 'settings-button' ? 'settings'
            : invoker?.id === 'explorer-more' ? 'explorer'
              : invoker?.id === 'inspector-more' ? 'inspector'
                : invoker?.id === 'drive-root-more' ? 'drive-root' : 'context';
  const labels: Record<string, string> = {
    file: strings().menuFile, edit: strings().menuEdit, view: strings().menuView, help: strings().menuHelp,
    drive: strings().drive, 'drive-root': strings().driveRootOptions, settings: strings().settings,
    explorer: strings().explorerOptions, inspector: strings().inspectorOptions, context: strings().menuFile
  };
  const rect = invoker?.getBoundingClientRect();
  workspaceMenuSnapshot = {
    id, label: labels[id] ?? strings().menuFile, invokerId: invoker?.id,
    position: { left: x, top: y },
    items: actions.map((action, index) => ({
      id: `${id}-${index}`, label: action.label, shortcut: action.shortcut,
      disabled: action.disabled, checked: action.checked, separator: action.separator, href: action.href
    }))
  };
  if (rect && invoker?.getAttribute('aria-haspopup') === 'menu') invoker.setAttribute('aria-expanded', 'true');
  publishWorkspaceSnapshot();
}

async function copyWithFailure(text: string): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new DOMException('Clipboard API is unavailable', 'NotAllowedError');
    await navigator.clipboard.writeText(text);
    showMessage(state.locale === 'ja' ? 'クリップボードにコピーしました。' : 'Copied to clipboard.', 'info');
  } catch {
    showMessage(state.locale === 'ja' ? 'クリップボードへコピーできませんでした。' : 'Could not copy to the clipboard.', 'error');
  }
}

function staleMenuTarget(): void {
  showMessage(state.locale === 'ja' ? '対象が変わったため操作を中止しました。' : 'The target changed; the action was cancelled.', 'error');
}

async function deleteLocalFromExplorer(
  file: HTMLButtonElement, fileId: string, expectedRevision: number,
  tab: OpenTab | undefined, tabRevision: number | undefined, tabSource: string | undefined
): Promise<void> {
  const identity: DocumentIdentity = { storage: 'local', fileId };
  const rowIsCurrent = () => file.isConnected && file.dataset.storage === 'local'
    && file.dataset.fileId === fileId && Number(file.dataset.revision) === expectedRevision;
  if (!editorReadyForDocumentChange()) return;
  const initial = await indexedDb.getDocument(identity);
  if (!rowIsCurrent() || !initial || initial.revision !== expectedRevision) { staleMenuTarget(); return; }
  if (!window.confirm(strings().confirmDelete)) return;
  const latest = await indexedDb.getDocument(identity);
  if (!latest || latest.revision !== expectedRevision
    || tab && (!state.tabs.includes(tab) || tab.revision !== tabRevision || tab.source !== tabSource)) { staleMenuTarget(); return; }
  const openTab = state.tabs.find(candidate => candidate.document.identity.storage === 'local' && candidate.document.identity.fileId === fileId);
  if (openTab) {
    await draftWrites.get(tabKey(openTab));
    if (!state.tabs.includes(openTab)) { staleMenuTarget(); return; }
    await closeTab(openTab, true);
    await draftWrites.get(tabKey(openTab));
  }
  const beforeDelete = await indexedDb.getDocument(identity);
  if (!beforeDelete || beforeDelete.revision !== expectedRevision) { staleMenuTarget(); return; }
  await indexedDb.deleteDocument(identity);
  void renderExplorer();
}

function contextActionsFor(element: HTMLElement, keyboard = false): WorkspaceMenuAction[] {
  const t = strings();
  const rootRow = element.closest<HTMLElement>('.storage-root-row');
  if (rootRow) {
    const section = rootRow.closest<HTMLElement>('.storage-section');
    const storage = section?.dataset.storageSection;
    if (!section || (storage !== 'local' && storage !== 'drive')) return [];
    const rootIsCurrent = () => rootRow.isConnected && rootRow.closest('.storage-section') === section;
    if (storage === 'local') return [
      { label: t.newScore, run: () => { if (!rootIsCurrent()) { staleMenuTarget(); return; } return createNewScore(); } },
      { label: t.addFile, run: () => { if (!rootIsCurrent()) { staleMenuTarget(); return; } app.querySelector<HTMLInputElement>('#file-input')!.click(); } }
    ];
    const accountId = state.account?.accountId;
    const drive = state.drive;
    const generation = state.driveGeneration;
    const libraryRootId = state.folderId;
    const driveIsCurrent = () => rootIsCurrent() && state.account?.accountId === accountId && state.drive === drive
      && state.driveGeneration === generation && state.folderId === libraryRootId && !state.authExpired;
    if (!accountId || !drive || state.authExpired) return [{
      label: state.authExpired ? t.reconnect : t.connect,
      disabled: driveConnectInProgress,
      run: () => {
        if (!rootIsCurrent() || state.account?.accountId !== accountId || state.drive !== drive || driveConnectInProgress) { staleMenuTarget(); return; }
        return connectDrive();
      }
    }];
    if (!libraryRootId) return [{ label: t.driveRootMenuCreate, run: () => {
      if (!driveIsCurrent()) { staleMenuTarget(); return; }
      return createDriveFolder();
    } }];
    return [
      { label: t.newScore, run: () => { if (!driveIsCurrent()) { staleMenuTarget(); return; } return createDriveLibraryScore(accountId, generation, libraryRootId); } },
      { label: t.newFolder, run: () => { if (!driveIsCurrent()) { staleMenuTarget(); return; } return createDriveLibraryFolder(accountId, generation, libraryRootId); } },
      { label: t.driveRootMenuOpen, run: () => { if (!driveIsCurrent()) { staleMenuTarget(); return; } return importFromDrivePicker(accountId, generation, libraryRootId); } },
      { label: t.refreshDrive, run: () => { if (!driveIsCurrent()) { staleMenuTarget(); return; } return refreshDriveLibraryFolder(accountId, generation, libraryRootId); } },
      { label: t.openDriveInGoogle, run: () => { if (!driveIsCurrent()) { staleMenuTarget(); return; } return openDriveLibraryItem(accountId, generation, libraryRootId, 'folder'); } },
      { label: t.libraryAbout, run: () => { if (!driveIsCurrent()) { staleMenuTarget(); return; } showLibraryAbout(); } }
    ];
  }

  const libraryEntry = element.closest<HTMLButtonElement>('.drive-library-entry');
  if (libraryEntry) {
    const itemId = libraryEntry.dataset.fileId;
    const parentId = libraryEntry.dataset.parentId;
    const accountId = libraryEntry.dataset.accountId;
    const kind = libraryEntry.dataset.kind;
    const generation = Number(libraryEntry.dataset.driveGeneration);
    const rowIsCurrent = () => libraryEntry.isConnected && libraryEntry.dataset.fileId === itemId
      && libraryEntry.dataset.parentId === parentId && libraryEntry.dataset.accountId === accountId
      && Number(libraryEntry.dataset.driveGeneration) === generation
      && isDriveCommandCurrent(accountId ?? '', generation) && state.folderId !== undefined;
    if (!itemId || !parentId || !accountId || !Number.isInteger(generation) || (kind !== 'folder' && kind !== 'score')) return [];
    const item = findDriveLibraryItem(itemId);
    if (!item) return [];
    const openWeb = () => {
      if (!rowIsCurrent()) { staleMenuTarget(); return; }
      openDriveLibraryItem(accountId, generation, itemId, kind, item.webViewLink);
    };
    if (kind === 'folder') {
      const expanded = driveExpandedFolders.has(itemId);
      return [
        { label: expanded ? t.closeFolder : t.openFolder, run: () => { if (!rowIsCurrent()) { staleMenuTarget(); return; } toggleDriveLibraryFolder(accountId, generation, itemId); } },
        { label: t.newScore, run: () => { if (!rowIsCurrent()) { staleMenuTarget(); return; } return createDriveLibraryScore(accountId, generation, itemId); } },
        { label: t.newFolder, run: () => { if (!rowIsCurrent()) { staleMenuTarget(); return; } return createDriveLibraryFolder(accountId, generation, itemId); } },
        { label: t.importHere, run: () => { if (!rowIsCurrent()) { staleMenuTarget(); return; } return importFromDrivePicker(accountId, generation, itemId); } },
        { label: t.renameFile, run: () => { if (!rowIsCurrent()) { staleMenuTarget(); return; } return renameDriveLibraryItem(accountId, generation, itemId, 'folder', parentId); } },
        { label: t.openDriveInGoogle, run: openWeb }
      ];
    }
    return [
      { label: state.locale === 'ja' ? '開く' : 'Open', run: () => { if (!rowIsCurrent()) { staleMenuTarget(); return; } libraryEntry.click(); } },
      { label: t.renameFile, shortcut: 'F2', run: () => { if (!rowIsCurrent()) { staleMenuTarget(); return; } return renameDriveLibraryItem(accountId, generation, itemId, 'score', parentId); } },
      { label: t.duplicateFile, run: () => { if (!rowIsCurrent()) { staleMenuTarget(); return; } return duplicateDriveLibraryScore(accountId, generation, itemId, parentId); } },
      { label: t.moveFolder, run: () => { if (!rowIsCurrent()) { staleMenuTarget(); return; } return moveDriveLibraryScore(accountId, generation, itemId, parentId); } },
      { label: t.downloadCopy, run: async () => {
        if (!rowIsCurrent()) { staleMenuTarget(); return; }
        const drive = state.drive;
        const file = await drive?.getFile(itemId);
        if (!rowIsCurrent() || !file) { staleMenuTarget(); return; }
        downloadSource(item.name, file.source);
      } },
      { label: t.downloadPdfFile, run: async () => {
        if (!rowIsCurrent()) { staleMenuTarget(); return; }
        const file = await state.drive?.getFile(itemId);
        if (!rowIsCurrent() || !file) { staleMenuTarget(); return; }
        try { await downloadScorePdf(file.source, item.name, { pageSize: state.pageSize, orientation: state.orientation, expandPageBreakRepeats: state.expandPageBreakRepeats }); }
        catch (error) { showMessage(`${state.locale === 'ja' ? 'PDFの書き出しに失敗しました: ' : 'PDF export failed: '}${shortError(error)}`, 'error'); }
      } },
      { label: t.openDriveInGoogle, run: openWeb },
      { label: t.trashDriveFile, run: () => { if (!rowIsCurrent()) { staleMenuTarget(); return; } return trashDriveLibraryScore(accountId, generation, itemId, parentId); } }
    ];
  }

  const file = element.closest<HTMLButtonElement>('.file-item');
  if (file) {
    const storage = file.dataset.storage;
    const fileId = file.dataset.fileId;
    const accountId = file.dataset.accountId;
    const revision = Number(file.dataset.revision);
    const title = file.textContent?.trim() ?? '';
    const tab = state.tabs.find(candidate => candidate.document.identity.storage === storage
      && candidate.document.identity.fileId === fileId && (storage !== 'drive' || candidate.accountId === accountId));
    const tabRevision = tab?.revision;
    const tabSource = tab?.source;
    const rowIsCurrent = () => file.isConnected && file.dataset.storage === storage
      && file.dataset.fileId === fileId && file.dataset.accountId === accountId
      && Number(file.dataset.revision ?? 0) === revision;
    if (!fileId || (storage !== 'local' && storage !== 'drive')) return [];
    const actions: WorkspaceMenuAction[] = [{ label: state.locale === 'ja' ? '開く' : 'Open', run: () => {
      if (!rowIsCurrent() || storage === 'drive' && (state.account?.accountId !== accountId || !state.drive)) { staleMenuTarget(); return; }
      file.click();
    } }];
    if (storage === 'local') {
      const identity: DocumentIdentity = { storage: 'local', fileId };
      const readTarget = async (): Promise<{ document: StoredDocument; source: string } | undefined> => {
        if (!sourceEditor.flushPendingEdit() || !rowIsCurrent()) { staleMenuTarget(); return undefined; }
        if (tab) {
          if (!state.tabs.includes(tab) || tab.revision !== tabRevision || tab.source !== tabSource) { staleMenuTarget(); return undefined; }
          await draftWrites.get(tabKey(tab));
          if (!rowIsCurrent() || !state.tabs.includes(tab) || tab.revision !== tabRevision || tab.source !== tabSource) { staleMenuTarget(); return undefined; }
        }
        const current = await indexedDb.getDocument(identity);
        if (!rowIsCurrent() || !current || !tab && current.revision !== revision
          || tab && (!state.tabs.includes(tab) || tab.revision !== tabRevision || tab.source !== tabSource)) {
          staleMenuTarget(); return undefined;
        }
        return { document: current, source: tab?.source ?? current.source };
      };
      actions.push(
        { label: t.renameFile, run: async () => {
          const target = await readTarget();
          if (!target) return;
          const originalName = target.document.name;
          const extension = originalName.match(/\.(?:guitardsl|gdsl)$/iu)?.[0] ?? '';
          const initialBaseName = extension ? originalName.slice(0, -extension.length) : originalName;
          const enteredName = window.prompt(t.renamePrompt, initialBaseName);
          if (enteredName === null || !enteredName.trim()) return;
          const baseName = enteredName.trim().replace(/\.(?:guitardsl|gdsl)$/iu, '').trim();
          if (!baseName) return;
          const nextName = `${baseName}${extension}`;
          if (!rowIsCurrent() || tab && (!state.tabs.includes(tab) || tab.revision !== tabRevision || tab.source !== tabSource)) { staleMenuTarget(); return; }
          const renamed = await indexedDb.renameLocal(identity, nextName.trim(), { revision: tab?.revision ?? target.document.revision, source: tab?.source ?? target.source });
          if (!renamed) { staleMenuTarget(); return; }
          if (tab) tab.document = { ...tab.document, name: nextName.trim() };
          renderAll(); await persistSessions();
        } },
        { label: t.duplicateFile, run: async () => {
          const target = await readTarget();
          if (!target) return;
          const duplicate = await indexedDb.duplicateLocal(identity, { revision: tab?.revision ?? target.document.revision, source: target.source });
          if (!duplicate) { staleMenuTarget(); return; }
          await openDocument(duplicate, duplicate.source);
        } },
        { label: t.downloadFile, run: async () => {
          const target = await readTarget();
          if (!target) return;
          downloadSource(tab?.document.name ?? target.document.name, target.source);
        } },
        { label: t.downloadPdfFile, run: async () => {
          const target = await readTarget();
          if (!target) return;
          try {
            if (import.meta.env.DEV) lastPdfInputForTest = target.source;
            await downloadScorePdf(target.source, tab?.document.name ?? target.document.name, {
              pageSize: tab?.pageSize ?? state.pageSize,
              orientation: tab?.orientation ?? state.orientation,
              expandPageBreakRepeats: state.expandPageBreakRepeats
            });
          } catch (error) {
            showMessage(`${state.locale === 'ja' ? 'PDFの書き出しに失敗しました: ' : 'PDF export failed: '}${shortError(error)}`, 'error');
          }
        } }
      );
      const driveAtMenuOpen = state.drive;
      const accountAtMenuOpen = state.account?.accountId;
      const folderAtMenuOpen = state.folderId;
      const driveGenerationAtMenuOpen = state.driveGeneration;
      const driveTargetIsCurrent = () => state.drive === driveAtMenuOpen
        && state.account?.accountId === accountAtMenuOpen && state.folderId === folderAtMenuOpen
        && state.driveGeneration === driveGenerationAtMenuOpen && !state.authExpired;
      if (accountAtMenuOpen && driveAtMenuOpen && folderAtMenuOpen) actions.push({ label: t.moveGoogleDrive, run: async () => {
        if (!driveTargetIsCurrent()) { staleMenuTarget(); return; }
        const target = await readTarget();
        if (!target || !driveTargetIsCurrent()) { staleMenuTarget(); return; }
        const targetTab = tab ?? await openDocument(target.document, target.source);
        if (!targetTab || !driveTargetIsCurrent()) { staleMenuTarget(); return; }
        await setActive(tabKey(targetTab));
        if (state.activeKey === tabKey(targetTab) && driveTargetIsCurrent()) await moveToDrive(targetTab);
      } });
      actions.push({ label: t.deleteFile, run: () => deleteLocalFromExplorer(file, fileId, revision, tab, tabRevision, tabSource) });
    } else {
      actions.push({ label: t.copyName, run: () => { if (!rowIsCurrent()) { staleMenuTarget(); return; } return copyWithFailure(title); } });
    }
    return actions;
  }
  const tabElement = element.closest<HTMLElement>('.tab');
  if (tabElement?.dataset.documentTabKey) {
    const key = tabElement.dataset.documentTabKey;
    const tab = state.tabs.find(item => tabKey(item) === key);
    if (!tab) return [];
    const revision = tab.revision;
    const source = tab.source;
    const accountId = tab.accountId;
    const tabIsCurrent = () => sourceEditor.flushPendingEdit() && tabElement.isConnected && state.tabs.includes(tab) && tabKey(tab) === key
      && tab.revision === revision && tab.source === source && tab.accountId === accountId;
    const actions: WorkspaceMenuAction[] = [
      { label: t.openTab, run: () => { if (!tabIsCurrent()) { staleMenuTarget(); return; } return setActive(key); } },
      { label: t.closeTabMenu, run: () => { if (!tabIsCurrent()) { staleMenuTarget(); return; } return closeTab(tab); } },
      { label: t.closeOthers, run: async () => {
        if (!tabIsCurrent()) { staleMenuTarget(); return; }
        await setActive(key);
        if (state.activeKey !== key || !tabIsCurrent()) { staleMenuTarget(); return; }
        for (const other of [...state.tabs]) if (other !== tab) await closeTab(other);
      } },
      { label: t.exportSource, run: () => { if (!tabIsCurrent()) { staleMenuTarget(); return; } downloadSource(tab.document.name, tab.source); } }
    ];
    if (tab.document.identity.storage === 'local' && state.account && state.drive && state.folderId) {
      actions.push({ label: t.moveDrive, run: () => { if (!tabIsCurrent()) { staleMenuTarget(); return; } return moveToDrive(tab); } });
    }
    return actions;
  }
  const problem = element.closest<HTMLElement>('.problem-row');
  if (problem) {
    const tab = activeTab();
    if (!tab) return [];
    const revision = tab.revision;
    const source = tab.source;
    const message = problem.querySelector('.problem-message')?.textContent ?? '';
    return [
      { label: state.locale === 'ja' ? 'ソースで表示' : 'Show in Source', run: () => {
        if (!problem.isConnected || activeTab() !== tab || tab.revision !== revision || tab.source !== source) {
          showMessage(state.locale === 'ja' ? '診断の対象が変わりました。' : 'The diagnostic target changed.', 'error'); return;
        }
        problem.querySelector<HTMLButtonElement>('.problem-message')?.click();
      } },
      { label: state.locale === 'ja' ? 'メッセージをコピー' : 'Copy message', run: () => {
        if (!problem.isConnected || activeTab() !== tab || tab.revision !== revision || tab.source !== source) {
          showMessage(state.locale === 'ja' ? '診断の対象が変わりました。' : 'The diagnostic target changed.', 'error'); return;
        }
        return copyWithFailure(message);
      } }
    ];
  }
  const gutter = element.closest<HTMLElement>('.cm-gutters');
  if (gutter || keyboard && element.closest('.cm-content')) {
    const tab = activeTab();
    if (!tab) return [];
    const revision = tab.revision;
    const source = tab.source;
    const from = sourceEditor.selection().from;
    const line = sourceEditor.getText().slice(0, from).split('\n').length;
    return [
      { label: (state.locale === 'ja' ? '行 ' : 'Line ') + line + (state.locale === 'ja' ? ' へ移動…' : '…'), run: () => {
        if (activeTab() !== tab || tab.revision !== revision || tab.source !== source) {
          showMessage(state.locale === 'ja' ? '文書が変わったため操作を中止しました。' : 'The document changed; the action was cancelled.', 'error'); return;
        }
        const value = window.prompt(state.locale === 'ja' ? '移動先の行番号' : 'Go to line', String(line));
        const destination = Number(value);
        if (value !== null && Number.isInteger(destination) && destination > 0) {
          const lines = sourceEditor.getText().split('\n');
          sourceEditor.setSelection(lines.slice(0, Math.min(destination - 1, lines.length)).reduce((total, row) => total + row.length + 1, 0));
        }
      } },
      { label: state.locale === 'ja' ? '行番号をコピー' : 'Copy line number', run: () => copyWithFailure(String(line)) }
    ];
  }
  return [];
}

function requestWorkspaceContextMenu(request: WorkspaceContextMenuRequest): void {
  const target = request.target;
  if (!target.isConnected) return;
  if (request.keyboard && target.id === 'explorer-more') { openExplorerMenu(); return; }
  if (request.keyboard && target.id === 'inspector-more') { openInspectorMenu(); return; }
  const invoker = target.closest<HTMLElement>('.storage-root-label, .file-item, .tab > [role="tab"], .problem-row, .cm-gutters') ?? target;
  if (!sourceEditor.flushPendingEdit()) return;
  if (invoker.closest('.score-pane')) {
    const tab = activeTab();
    if (tab) openPreviewContextMenu(request.keyboard ? 12 : request.clientX, request.keyboard ? 12 : request.clientY, tab, {
      documentUri: activeIdentityLabel(tab), documentVersion: tab.revision, previewGeneration: state.previewGeneration
    }, '');
    return;
  }
  const menu = app.querySelector<HTMLElement>('#context-menu')!;
  const actions = contextActionsFor(invoker, request.keyboard);
  if (!actions.length) return;
  showWorkspaceMenu(menu, request.clientX, request.clientY, actions, invoker);
}

function openPreviewContextMenu(x: number, y: number, tab: OpenTab, identity: { documentUri: string; documentVersion: number; previewGeneration: number }, visualElementId = ''): void {
  const rect = scoreFrame.getBoundingClientRect();
  const menu = app.querySelector<HTMLElement>('#context-menu')!;
  const t = strings();
  const findBinding = () => visualElementId
    ? currentScore(tab.source, tab)?.visualSourceBindings?.find(binding => binding.id === visualElementId)
    : undefined;
  const actions: WorkspaceMenuAction[] = [
    { label: t.goToSource, disabled: !findBinding(), run: () => {
      if (!sourceEditor.flushPendingEdit() || !isCurrentPreviewIdentity(tab, identity)) { staleMenuTarget(); return; }
      const binding = findBinding();
      if (!binding) { staleMenuTarget(); return; }
      const lines = sourceEditor.getText().split('\n');
      const offset = lines.slice(0, binding.line).reduce((total, line) => total + line.length + 1, 0) + binding.startCol;
      setWorkspaceViewMode('source');
      sourceEditor.setSelection(offset, Math.min(sourceEditor.getText().length, offset + Math.max(1, binding.endCol - binding.startCol)));
    } },
    { label: t.downloadPdf, run: () => {
      if (!sourceEditor.flushPendingEdit() || !isCurrentPreviewIdentity(tab, identity)) { staleMenuTarget(); return; }
      return downloadPdf(tab);
    } }
  ];
  showWorkspaceMenu(menu, rect.left + x, rect.top + y, actions, scoreFrame);
}

function openHelp(): void {
  const dialog = app.querySelector<HTMLDialogElement>('#help-dialog')!;
  const toc = app.querySelector<HTMLElement>('#help-toc')!;
  const content = app.querySelector<HTMLElement>('#help-content')!;
  app.querySelector('#help-title')!.textContent = strings().help;
  const topics = state.locale === 'ja' ? [
    ['getting-started', '基本操作', '新しい楽譜を作成するか、Explorer からローカル文書または Google Drive の文書を開きます。編集内容はブラウザー内の下書きとして保存されます。'],
    ['editing', 'ソース編集', '行番号、構文色分け、補完、検索・置換、元に戻す／やり直しを利用できます。Problems の項目を選ぶと、該当行へ移動します。'],
    ['preview', 'プレビュー', 'Source・Split・Score の表示を切り替えます。譜面プレビュー内の Normal・Edit・Practice は表示レイアウトとは独立しています。'],
    ['drive', 'Google Drive', 'Google Drive は任意です。接続すると、マイドライブ直下の `GuitarDSL` フォルダーを探し、あれば同じフォルダーを使います。見つからない場合は、確認してライブラリを作成するか、後で設定できます。ライブラリではサブフォルダーと対応する楽譜を表示します。「Google Driveで開く」は選んだアイテムをDriveで開きます。「Google Driveからインポート」は選んだ楽譜をライブラリのフォルダーへコピーし、元ファイルは変更しません。開いた楽譜と最近使った楽譜のIDはDriveアプリデータでアカウントごとに同期します。ソースと未保存の下書きはこの端末に残ります。'],
    ['shortcuts', 'キーボード操作', '⌘/Ctrl+S で保存、⌘/Ctrl+F で検索、⌘/Ctrl+H で置換、⌘/Ctrl+G で行へ移動します。Escape でメニューを閉じます。']
  ] : [
    ['getting-started', 'Getting started', 'Create a score or open a local or Google Drive document from Explorer. Edits are stored as a recoverable browser draft.'],
    ['editing', 'Editing source', 'Use line numbers, syntax colors, local completion, search and replace, undo, and redo. Select a Problems row to jump to its source range.'],
    ['preview', 'Preview', 'Switch between Source, Split, and Score views. Normal, Edit, and Practice remain independent Preview modes.'],
    ['drive', 'Google Drive', 'Google Drive is optional. On first sign-in, the app checks for a My Drive folder named GuitarDSL. If none exists, create the library after confirmation or defer setup. Explorer shows nested folders and supported scores in that library. Use Open in Google Drive to open an item; Import from Google Drive copies selected files into a library folder and leaves the originals unchanged. Account-specific open and recent score IDs sync through Drive app data. Score text and unsaved drafts remain in this browser.'],
    ['shortcuts', 'Keyboard shortcuts', 'Use ⌘/Ctrl+S to save, ⌘/Ctrl+F to search, ⌘/Ctrl+H to replace, and ⌘/Ctrl+G to go to a line. Press Escape to close a menu.']
  ] as const;
  const localeName = state.locale === 'ja' ? '日本語' : 'English';
  const helpHtml = `<!doctype html><html lang="${state.locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(strings().help)} · GuitarDSL</title><style>body{margin:0;padding:28px;max-width:900px;font:15px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;color:#20242b;background:#f7f8fa}header{position:sticky;top:0;padding:8px 0 16px;background:#f7f8fa;border-bottom:1px solid #d9dde5}nav{display:flex;gap:8px;flex-wrap:wrap}nav a{color:#3444b8}section{padding:16px 0;border-bottom:1px solid #dfe2e7}a{color:#3444b8}</style><body><header><h1>GuitarDSL ${esc(strings().help)} · ${localeName}</h1><nav>${topics.map(([id, title]) => `<a href="#${id}">${esc(title)}</a>`).join('')}</nav></header>${topics.map(([id, title, body]) => `<section id="${id}"><h2>${esc(title)}</h2><p>${esc(body)}</p></section>`).join('')}</body></html>`;
  if (helpBlobUrl) URL.revokeObjectURL(helpBlobUrl);
  helpBlobUrl = URL.createObjectURL(new Blob([helpHtml], { type: 'text/html;charset=UTF-8' }));
  const popup = window.open(helpBlobUrl, 'guitardsl-help', 'popup,width=920,height=760');
  if (popup) { window.setTimeout(() => { if (helpBlobUrl) URL.revokeObjectURL(helpBlobUrl); helpBlobUrl = ''; }, 120_000); return; }
  toc.replaceChildren(); content.replaceChildren();
  app.querySelector('#help-popup-note')!.textContent = strings().helpPopupBlocked;
  app.querySelector<HTMLElement>('#help-popup-note')!.hidden = false;
  const linkRow = app.querySelector<HTMLElement>('#help-direct-link-row')!;
  const directLink = app.querySelector<HTMLAnchorElement>('#help-direct-link')!;
  directLink.href = helpBlobUrl; directLink.textContent = strings().openHelpLink; linkRow.hidden = false;
  for (const [id, title, body] of topics) {
    const link = document.createElement('button'); link.type = 'button'; link.textContent = title;
    link.addEventListener('click', () => content.querySelector('#help-' + id)?.scrollIntoView({ block: 'start' }));
    toc.append(link);
    const section = document.createElement('section'); section.id = 'help-' + id;
    const heading = document.createElement('h3'); heading.textContent = title;
    const paragraph = document.createElement('p'); paragraph.textContent = body;
    section.append(heading, paragraph); content.append(section);
  }
  if (!dialog.open) dialog.showModal();
}

function menuShortcut(key: string, shift = false): string {
  const mac = /Mac|iPhone|iPad/u.test(navigator.platform);
  return mac ? `⌘${shift ? '⇧' : ''}${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`;
}

function openFileMenu(): void {
  const button = app.querySelector<HTMLButtonElement>('#menu-file-trigger')!;
  const rect = button.getBoundingClientRect();
  const t = strings(); const tab = activeTab();
  showWorkspaceMenu(app.querySelector<HTMLElement>('#file-menu')!, rect.left, rect.bottom + 2, [
    { label: t.newScore, run: () => createNewScore() },
    { label: t.addFile, run: () => app.querySelector<HTMLInputElement>('#file-input')!.click() },
    { label: state.drive && !state.authExpired ? t.openDrive : `${t.openDrive} · ${t.connect}`, disabled: !state.drive || state.authExpired, run: () => openFromDrivePicker() },
    { separator: true, label: '', run: () => {} },
    { label: t.save, shortcut: menuShortcut('S'), disabled: !tab, run: () => saveActiveDocument() },
    { label: t.downloadCopy, disabled: !tab, run: () => {
      const current = activeTab();
      if (!current || !editorReadyForSnapshot(current)) return;
      downloadSource(current.document.name, current.source);
    } },
    { label: t.downloadPdf, disabled: !tab, run: () => downloadPdf() },
    { separator: true, label: '', run: () => {} },
    { label: t.closeTabMenu, disabled: !tab, run: () => tab && closeTab(tab) }
  ], button);
}

function openEditMenu(): void {
  const button = app.querySelector<HTMLButtonElement>('#menu-edit-trigger')!;
  const rect = button.getBoundingClientRect();
  const t = strings(); const tab = activeTab();
  const key = state.activeKey;
  const identity = tab?.document.identity;
  const accountId = tab?.accountId;
  const revision = tab?.revision;
  const source = sourceEditor.getText();
  const operationGeneration = workspaceOperationGeneration;
  const preparationGeneration = updatePreparationGeneration;
  let clipboardDeferred = false;
  const selection = sourceEditor.selection(); const hasSelection = selection.from !== selection.to;
  const targetIsCurrent = () => {
    if (operationGeneration !== workspaceOperationGeneration || preparationGeneration !== updatePreparationGeneration
      || reloadPreparationActive || pageCacheSuspended) {
      clipboardDeferred = true;
      return false;
    }
    return !!tab && activeTab() === tab && state.activeKey === key
    && tab.document.identity.storage === identity?.storage && tab.document.identity.fileId === identity?.fileId
    && tab.accountId === accountId && tab.revision === revision && sourceEditor.getText() === source
    && !sourceEditor.hasPendingEdit() && sourceEditor.selection().from === selection.from
    && sourceEditor.selection().to === selection.to && sourceEditor.selection().head === selection.head;
  };
  const staleClipboardAction = () => showMessage(clipboardDeferred
    ? state.locale === 'ja'
      ? '更新またはブラウザー復帰の準備中にクリップボード操作を保留しました。内容を確認してからもう一度お試しください。'
      : 'The clipboard edit was deferred while the app prepared an update or browser restore. Review the document and try again.'
    : state.locale === 'ja'
      ? '対象の文書または選択範囲が変わったため、切り取り／貼り付けを中止しました。'
      : 'Cut or paste was cancelled because the document or selection changed.', 'info');
  showWorkspaceMenu(app.querySelector<HTMLElement>('#edit-menu')!, rect.left, rect.bottom + 2, [
    { label: t.undo, shortcut: menuShortcut('Z'), disabled: !tab || !sourceEditor.canUndo(), run: () => { sourceEditor.focus(); sourceEditor.undo(); } },
    { label: t.redo, shortcut: menuShortcut(/Mac|iPhone|iPad/u.test(navigator.platform) ? 'Z' : 'Y', /Mac|iPhone|iPad/u.test(navigator.platform)), disabled: !tab || !sourceEditor.canRedo(), run: () => { sourceEditor.focus(); sourceEditor.redo(); } },
    { separator: true, label: '', run: () => {} },
    { label: t.cut, shortcut: menuShortcut('X'), disabled: !tab || !hasSelection || !navigator.clipboard?.writeText, run: async () => { sourceEditor.focus(); try { if (!await sourceEditor.cut(targetIsCurrent)) staleClipboardAction(); } catch { showMessage(state.locale === 'ja' ? 'クリップボードへ切り取れませんでした。' : 'Could not cut to the clipboard.', 'error'); } } },
    { label: t.copy, shortcut: menuShortcut('C'), disabled: !tab || !hasSelection || !navigator.clipboard?.writeText, run: async () => { sourceEditor.focus(); try { await sourceEditor.copy(); } catch { showMessage(state.locale === 'ja' ? 'クリップボードへコピーできませんでした。' : 'Could not copy to the clipboard.', 'error'); } } },
    { label: t.paste, shortcut: menuShortcut('V'), disabled: !tab || !navigator.clipboard?.readText, run: async () => { sourceEditor.focus(); try { if (!await sourceEditor.paste(targetIsCurrent)) staleClipboardAction(); } catch { showMessage(state.locale === 'ja' ? 'クリップボードから貼り付けられませんでした。' : 'Could not paste from the clipboard.', 'error'); } } },
    { label: t.selectAll, shortcut: menuShortcut('A'), disabled: !tab, run: () => { sourceEditor.focus(); sourceEditor.selectAll(); } },
    { separator: true, label: '', run: () => {} },
    { label: t.find, shortcut: menuShortcut('F'), disabled: !tab, run: () => { sourceEditor.focus(); sourceEditor.openSearch(); } },
    { label: t.replace, shortcut: menuShortcut('H'), disabled: !tab, run: () => { sourceEditor.focus(); sourceEditor.openReplace(); } },
    { label: t.goToLine, shortcut: menuShortcut('G'), disabled: !tab, run: () => { sourceEditor.focus(); sourceEditor.goToLine(); } }
  ], button);
}

function resetWorkspaceLayout(): void {
  if (!window.confirm(strings().resetLayoutConfirm)) return;
  state.viewMode = 'split'; state.splitRatio = 0.4; state.explorerOpen = true; state.inspectorOpen = true;
  state.explorerWidth = 220; state.inspectorWidth = 300; state.problemsOpen = true; state.problemsHeight = 200;
  applyWorkspaceLayout(); saveLayoutNow();
}

const toggleExplorer = () => { state.explorerOpen = !state.explorerOpen; applyWorkspaceLayout(); saveLayoutSoon(); };
const toggleInspector = () => { state.inspectorOpen = !state.inspectorOpen; applyWorkspaceLayout(); saveLayoutNow(); };
const toggleProblems = () => { state.problemsOpen = !state.problemsOpen; renderProblemsLabels(); saveLayoutSoon(); };

function openViewMenu(): void {
  const button = app.querySelector<HTMLButtonElement>('#menu-view-trigger')!;
  const rect = button.getBoundingClientRect(); const t = strings();
  showWorkspaceMenu(app.querySelector<HTMLElement>('#view-menu')!, rect.left, rect.bottom + 2, [
    { label: t.sourceView, checked: state.viewMode === 'source', run: () => setWorkspaceViewMode('source') },
    { label: t.splitView, checked: state.viewMode === 'split', run: () => setWorkspaceViewMode('split') },
    { label: t.scoreView, checked: state.viewMode === 'score', run: () => setWorkspaceViewMode('score') },
    { separator: true, label: '', run: () => {} },
    { label: t.toggleExplorer, checked: state.explorerOpen, run: () => toggleExplorer() },
    { label: t.toggleInspector, checked: state.inspectorOpen, run: () => toggleInspector() },
    { label: t.problems, checked: state.problemsOpen, run: () => toggleProblems() },
    { separator: true, label: '', run: () => {} },
    { label: `${t.resetLayout}…`, run: resetWorkspaceLayout }
  ], button);
}

function openHelpMenu(): void {
  const button = app.querySelector<HTMLButtonElement>('#menu-help-trigger')!;
  const rect = button.getBoundingClientRect();
  const t = strings();
  showWorkspaceMenu(app.querySelector<HTMLElement>('#help-menu')!, rect.left, rect.bottom + 2, [
    { label: t.menuWelcome, run: showWelcome },
    { label: t.menuTutorial, run: openTutorial },
    { label: t.help, run: openHelp },
    { label: t.menuSource, href: 'https://github.com/puchinya/vscode-guitar-dsl' },
    { label: '', separator: true },
    { label: t.menuLicenses, href: 'https://guitardsl.app/licenses/' },
    { label: t.menuPrivacy, href: 'https://guitardsl.app/privacy/' },
    { label: t.menuTerms, href: 'https://guitardsl.app/terms/' },
    { label: '', separator: true },
    { label: t.menuAbout, run: () => { state.aboutOpen = true; publishWorkspaceSnapshot(); } }
  ], button);
}

function showWelcome(): void {
  state.welcomeOpen = true;
  state.welcomeActive = true;
  publishWorkspaceSnapshot();
}

function openTutorial(): void {
  state.welcomeActive = false;
  state.rightDockPane = 'tutorial';
  state.inspectorOpen = true;
  mobileDockOpen = workspace.clientWidth <= 680;
  applyWorkspaceLayout();
  saveLayoutNow();
}

async function setWelcomeSuppressed(suppressed: boolean): Promise<void> {
  try {
    await indexedDb.setValue('settings', 'web-welcome-v1', { suppressOnStartup: suppressed });
    state.welcomeSuppressed = suppressed;
    publishWorkspaceSnapshot();
  } catch {
    showMessage(strings().welcomeStorageError, 'error');
  }
}

interface TutorialProgressPreference {
  version: 1;
  stepIndex: number;
  chordOnlyCompleted: boolean;
  melodyCompleted: boolean;
}

async function navigateTutorial(action: 'next' | 'previous' | 'restart' | 'finish'): Promise<void> {
  const progress: TutorialProgressPreference = {
    version: 1, stepIndex: state.tutorialStepIndex,
    chordOnlyCompleted: state.tutorialChordOnlyCompleted,
    melodyCompleted: state.tutorialMelodyCompleted
  };
  if (action === 'restart') {
    progress.stepIndex = 0;
    progress.chordOnlyCompleted = false;
    progress.melodyCompleted = false;
  } else if (action === 'previous') progress.stepIndex = Math.max(0, progress.stepIndex - 1);
  else if (action === 'next') {
    if (progress.stepIndex === 5) progress.chordOnlyCompleted = true;
    progress.stepIndex = Math.min(9, progress.stepIndex + 1);
  } else {
    if (progress.stepIndex === 5) progress.chordOnlyCompleted = true;
    if (progress.stepIndex === 9) progress.melodyCompleted = true;
  }
  try {
    await indexedDb.setValue('settings', 'web-tutorial-v1', progress);
    state.tutorialStepIndex = progress.stepIndex;
    state.tutorialChordOnlyCompleted = progress.chordOnlyCompleted;
    state.tutorialMelodyCompleted = progress.melodyCompleted;
    publishWorkspaceSnapshot();
  } catch {
    showMessage(strings().tutorialStorageError, 'error');
  }
}

function openDriveHeaderMenu(): void {
  const button = app.querySelector<HTMLButtonElement>('#connect-drive')!;
  const rect = button.getBoundingClientRect(); const t = strings();
  const actions: WorkspaceMenuAction[] = [];
  if (driveConnectInProgress) actions.push({ label: t.connecting, disabled: true, run: () => {} });
  else if (!state.drive || !state.account || state.authExpired) actions.push({ label: state.authExpired ? t.reconnect : t.connect, run: () => connectDrive() });
  else {
    actions.push({ label: `${t.connectedAs} ${state.account.emailAddress ?? state.account.accountId}`, disabled: true, run: () => {} });
    actions.push({ separator: true, label: '', run: () => {} });
    actions.push({ label: t.disconnect, run: () => connectDrive() });
  }
  showWorkspaceMenu(app.querySelector<HTMLElement>('#drive-menu')!, rect.left, rect.bottom + 3, actions, button);
}

function openDriveRootMenu(): void {
  const button = app.querySelector<HTMLButtonElement>('#drive-root-more')!;
  const rect = button.getBoundingClientRect();
  const rootLabel = app.querySelector<HTMLElement>('#storage-drive');
  const actions = rootLabel ? contextActionsFor(rootLabel) : [];
  showWorkspaceMenu(app.querySelector<HTMLElement>('#panel-menu')!, rect.left, rect.bottom + 3, actions, button);
}

function openSettingsMenu(): void {
  const button = app.querySelector<HTMLElement>('#settings-button')!;
  const rect = button.getBoundingClientRect();
  const menu = app.querySelector<HTMLElement>('#settings-menu')!;
  const t = strings();
  const actions: WorkspaceMenuAction[] = [];
  for (const theme of ['system', 'light', 'dark'] as const) {
    const label = state.locale === 'ja' ? ({ system: 'テーマ: システム', light: 'テーマ: ライト', dark: 'テーマ: ダーク' }[theme])
      : ({ system: 'Theme: System', light: 'Theme: Light', dark: 'Theme: Dark' }[theme]);
    actions.push({ label, checked: state.theme === theme, run: () => {
      state.theme = theme;
      void savePreferences(); renderAll();
    } });
  }
  for (const locale of ['en', 'ja'] as const) {
    actions.push({ label: locale === 'ja' ? 'Language: 日本語' : 'Language: English', checked: state.locale === locale, run: () => {
      state.locale = locale;
      void savePreferences(); renderAll();
    } });
  }
  showWorkspaceMenu(menu, rect.left, rect.bottom + 3, actions, button);
}

function openExplorerMenu(): void {
  const button = app.querySelector<HTMLButtonElement>('#explorer-more')!;
  const rect = button.getBoundingClientRect();
  const menu = app.querySelector<HTMLElement>('#panel-menu')!;
  const t = strings();
  showWorkspaceMenu(menu, rect.left, rect.bottom + 3, [
    { label: t.addFile, run: () => app.querySelector<HTMLInputElement>('#file-input')!.click() },
    { label: t.closeExplorer, run: () => {
      state.explorerOpen = false;
      applyWorkspaceLayout(); saveLayoutNow();
      app.querySelector<HTMLButtonElement>('#activity-explorer')!.focus();
    } },
    { label: t.resetExplorerWidth, run: () => {
      state.explorerWidth = 220;
      applyWorkspaceLayout(); saveLayoutNow();
    } }
  ], button);
}

function openInspectorMenu(): void {
  const button = app.querySelector<HTMLButtonElement>('#inspector-more')!;
  const rect = button.getBoundingClientRect();
  const menu = app.querySelector<HTMLElement>('#panel-menu')!;
  const t = strings();
  showWorkspaceMenu(menu, rect.left, rect.bottom + 3, [
    { label: t.closeInspector, run: () => {
      state.inspectorOpen = false;
      mobileDockOpen = false;
      applyWorkspaceLayout(); saveLayoutNow();
      app.querySelector<HTMLButtonElement>('#toggle-inspector')!.focus();
    } },
    { label: t.resetInspectorWidth, run: () => {
      state.inspectorWidth = 300;
      applyWorkspaceLayout(); saveLayoutNow();
    } }
  ], button);
}

app.querySelector('#close-help')!.addEventListener('click', () => app.querySelector<HTMLDialogElement>('#help-dialog')!.close(), runtimeListenerOptions);
app.querySelector<HTMLDialogElement>('#help-dialog')!.addEventListener('close', () => app.querySelector<HTMLButtonElement>('#help-button')!.focus(), runtimeListenerOptions);
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing
    || workspace.clientWidth > 680 || !mobileDockOpen || !state.inspectorOpen) return;
  event.preventDefault();
  state.inspectorOpen = false;
  mobileDockOpen = false;
  applyWorkspaceLayout(); saveLayoutNow();
  app.querySelector<HTMLButtonElement>(state.rightDockPane === 'tutorial' ? '#toggle-tutorial' : '#toggle-inspector')?.focus();
}, runtimeListenerOptions);
app.addEventListener('keydown', event => {
  if (event.key === 'F2' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>('.drive-library-entry[data-kind="score"]');
    if (row) {
      event.preventDefault();
      const accountId = row.dataset.accountId;
      const generation = Number(row.dataset.driveGeneration);
      const itemId = row.dataset.fileId;
      const parentId = row.dataset.parentId;
      if (accountId && itemId && parentId && Number.isInteger(generation)) {
        void renameDriveLibraryItem(accountId, generation, itemId, 'score', parentId);
      }
      return;
    }
  }
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void trackWorkspaceOperation(() => saveActiveDocument());
  }
}, runtimeListenerOptions);
inspectorTabsHost.addEventListener('focusin', event => {
  const focused = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-inspector-tab]');
  if (!focused) return;
  for (const tab of inspectorTabsHost.querySelectorAll<HTMLButtonElement>('[data-inspector-tab]')) {
    tab.tabIndex = tab === focused ? 0 : -1;
  }
}, runtimeListenerOptions);
inspectorTabsHost.addEventListener('keydown', event => {
  const focused = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-inspector-tab]');
  if (!focused) return;
  const enabled = Array.from(inspectorTabsHost.querySelectorAll<HTMLButtonElement>('[data-inspector-tab]'))
    .filter(tab => !tab.disabled);
  const index = enabled.indexOf(focused);
  if (index < 0) return;
  const next = event.key === 'ArrowRight' ? enabled[(index + 1) % enabled.length]
    : event.key === 'ArrowLeft' ? enabled[(index - 1 + enabled.length) % enabled.length]
      : event.key === 'Home' ? enabled[0]
        : event.key === 'End' ? enabled[enabled.length - 1] : undefined;
  if (next) { event.preventDefault(); next.focus(); }
}, runtimeListenerOptions);
inspectorTabsHost.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-inspector-tab]');
  if (button && button.dataset.inspectorTab) {
    const nextTab = button.dataset.inspectorTab as InspectorTab;
    if (nextTab !== 'progression' && progressionAudioLease.activeLeaseId) void stopCandidateAudition();
    state.inspectorTab = nextTab;
    const tab = activeTab();
    if (nextTab === 'progression' && tab && (!state.lastProgression || state.lastProgression.source !== tab.source || state.lastProgression.revision !== tab.revision)) {
      void suggestProgression(tab);
    } else renderInspector();
  }
}, runtimeListenerOptions);
workspaceResizeObserver = new ResizeObserver(() => updateResponsiveCollapse());
workspaceResizeObserver.observe(workspace);
removePreviewMessageListener = listenForPreviewMessages(scoreFrame, handlePreviewMessage);
window.addEventListener('beforeunload', (event: BeforeUnloadEvent) => {
  if (sourceEditor.hasPendingEdit() || state.tabs.some(hasUnpersistedDraft)
    || Boolean(appDataSyncTimer) || Boolean(state.appDataPending)
    || state.appDataSync === 'pending' || state.appDataSync === 'syncing' || state.appDataSync === 'error') {
    event.preventDefault();
    event.returnValue = '';
  }
}, runtimeListenerOptions);
window.addEventListener('offline', () => {
  if (state.appDataSync !== 'pending') return;
  window.clearTimeout(appDataSyncTimer);
  appDataSyncTimer = 0;
  appDataOfflinePending = true;
  renderStorageStatus();
}, runtimeListenerOptions);
window.addEventListener('online', () => {
  if (!navigator.onLine) return;
  if (reloadPreparationActive || pageCacheSuspended) {
    deferredAppDataSync = deferredAppDataSync || appDataOfflinePending;
    return;
  }
  if (appDataOfflinePending) {
    appDataOfflinePending = false;
    void persistDriveAppData();
  } else if ((appDataUnknownOutcome || deferredAppDataSync) && (appDataUnknownOutcome || state.appDataSync !== 'error')) {
    deferredAppDataSync = false;
    scheduleDriveAppDataSync();
  }
}, runtimeListenerOptions);

async function loadAuxiliaryPreferences(): Promise<void> {
  const welcome = await indexedDb.getValue<unknown>('settings', 'web-welcome-v1').catch(() => undefined);
  if (welcome && typeof welcome === 'object' && typeof (welcome as { suppressOnStartup?: unknown }).suppressOnStartup === 'boolean') {
    state.welcomeSuppressed = (welcome as { suppressOnStartup: boolean }).suppressOnStartup;
  }
  const tutorial = await indexedDb.getValue<unknown>('settings', 'web-tutorial-v1').catch(() => undefined);
  if (!tutorial || typeof tutorial !== 'object') return;
  const saved = tutorial as Partial<TutorialProgressPreference>;
  if (saved.version !== 1 || !Number.isInteger(saved.stepIndex) || saved.stepIndex! < 0 || saved.stepIndex! > 9
    || typeof saved.chordOnlyCompleted !== 'boolean' || typeof saved.melodyCompleted !== 'boolean') return;
  state.tutorialStepIndex = saved.stepIndex!;
  state.tutorialChordOnlyCompleted = saved.chordOnlyCompleted;
  state.tutorialMelodyCompleted = saved.melodyCompleted;
}

async function init(): Promise<void> {
  try {
    await loadPreferences();
    await loadLayoutPreferences();
    await loadAuxiliaryPreferences();
    state.storageReady = true;
    await restoreLocalSession();
  } catch (error) {
    state.storageReady = false;
    const doc: StoredDocument = { identity: { storage: 'local', fileId: crypto.randomUUID() }, name: 'Untitled.guitardsl', source: DEFAULT_SOURCE, revision: 0, createdAt: Date.now(), updatedAt: Date.now() };
    await openDocument(doc, doc.source, undefined, false);
    showMessage(`${strings().unavailable} ${shortError(error)}`, 'error');
  }
  state.welcomeOpen = !state.welcomeSuppressed;
  state.welcomeActive = state.welcomeOpen;
  renderAll();
}

function applyWorkspaceCommand(command: WorkspaceCommand): void | Promise<void> {
  if (runtimeDisposed) return;
  if (command.type === 'lifecycle.pagehide' || command.type === 'lifecycle.pageshow') return dispatchWorkspaceCommand(command);
  if (command.type === 'pwa.update') return pwaRuntime.applyUpdate();
  if (reloadPreparationActive || pageCacheSuspended) return;
  return trackWorkspaceOperation(() => dispatchWorkspaceCommand(command));
}

function dispatchWorkspaceCommand(command: WorkspaceCommand): void | Promise<void> {
  if (runtimeDisposed) return;
  if (command.type === 'lifecycle.pagehide') {
    if (command.persisted) suspendWorkspaceForBfcache();
    return;
  }
  if (command.type === 'lifecycle.pageshow') {
    return command.persisted ? resumeWorkspaceFromBfcache() : undefined;
  }
  if (reloadPreparationActive || pageCacheSuspended) return;
  switch (command.type) {
    case 'document.create': return createNewScore();
    case 'document.open-local': return openLocalDocument(command.identity);
    case 'document.open-drive': {
      const file = driveFileRows.find(row => row.id === command.identity.fileId);
      if (!canOpenDriveFile({
        commandAccountId: command.accountId, currentAccountId: state.account?.accountId,
        commandGeneration: command.driveGeneration, currentGeneration: state.driveGeneration,
        connected: Boolean(state.drive), rowAvailable: Boolean(file)
      })) return;
      if (file && state.drive) return openDriveDocument(file, command.accountId, state.drive, state.driveGeneration);
      return;
    }
    case 'document.activate': return setActive(command.key);
    case 'document.close': {
      const tab = state.tabs.find(candidate => tabKey(candidate) === command.key);
      if (tab) return closeTab(tab);
      return;
    }
    case 'document.save': return saveActiveDocument();
    case 'document.export-pdf': return downloadPdf();
    case 'document.import-local': {
      const input = app.querySelector<HTMLInputElement>('#file-input')!;
      if (!input.files?.length) { input.click(); return; }
      const file = input.files[0];
      input.value = '';
      return importFile(file);
    }
    case 'storage.set-active':
      state.activeStorage = command.storage;
      publishWorkspaceSnapshot();
      return;
    case 'view.set-mode': return setWorkspaceViewMode(command.mode);
    case 'panel.toggle':
      if (command.panel === 'explorer') state.explorerOpen = !state.explorerOpen;
      else if (command.panel === 'inspector') {
        state.inspectorOpen = !state.inspectorOpen;
        mobileDockOpen = workspace.clientWidth <= 680 && state.inspectorOpen;
      }
      else state.problemsOpen = !state.problemsOpen;
      applyWorkspaceLayout(); saveLayoutNow();
      return;
    case 'panel.set-open':
      if (command.panel === 'explorer') state.explorerOpen = command.open;
      else if (command.panel === 'inspector') {
        state.inspectorOpen = command.open;
        mobileDockOpen = workspace.clientWidth <= 680 && command.open;
      }
      else state.problemsOpen = command.open;
      applyWorkspaceLayout(); saveLayoutNow();
      return;
    case 'panel.select-right':
      if (command.mode === 'toggle' && state.inspectorOpen && state.rightDockPane === command.pane) {
        state.inspectorOpen = false;
        mobileDockOpen = false;
      } else {
        state.rightDockPane = command.pane;
        state.inspectorOpen = true;
        mobileDockOpen = workspace.clientWidth <= 680;
      }
      applyWorkspaceLayout(); saveLayoutNow();
      return;
    case 'welcome.open': return showWelcome();
    case 'welcome.close':
      state.welcomeOpen = false; state.welcomeActive = false; publishWorkspaceSnapshot();
      return;
    case 'welcome.set-suppressed': return setWelcomeSuppressed(command.suppressed);
    case 'tutorial.open': return openTutorial();
    case 'tutorial.navigate': return navigateTutorial(command.action);
    case 'about.open': state.aboutOpen = true; publishWorkspaceSnapshot(); return;
    case 'about.close': state.aboutOpen = false; publishWorkspaceSnapshot(); return;
    case 'layout.reset': {
      if (!window.confirm(strings().resetLayoutConfirm)) return;
      state.viewMode = 'split'; state.splitRatio = 0.4; state.explorerOpen = true; state.inspectorOpen = true;
      mobileDockOpen = false;
      state.explorerWidth = 220; state.inspectorWidth = 300; state.problemsOpen = true; state.problemsHeight = 200;
      applyWorkspaceLayout(); saveLayoutNow();
      return;
    }
    case 'drive.connect': return connectDrive({ source: command.source });
    case 'drive.open-picker': return openFromDrivePicker();
    case 'drive.create-folder': return createDriveFolder();
    case 'drive.library.import': return importFromDrivePicker(command.accountId, command.driveGeneration, command.targetFolderId);
    case 'drive.library.create-score': return createDriveLibraryScore(command.accountId, command.driveGeneration, command.targetFolderId);
    case 'drive.library.create-folder': return createDriveLibraryFolder(command.accountId, command.driveGeneration, command.targetFolderId);
    case 'drive.library.toggle-folder': return toggleDriveLibraryFolder(command.accountId, command.driveGeneration, command.folderId);
    case 'drive.library.refresh': return refreshDriveLibraryFolder(command.accountId, command.driveGeneration, command.folderId);
    case 'drive.library.rename': return renameDriveLibraryItem(command.accountId, command.driveGeneration, command.itemId, command.kind, command.parentId);
    case 'drive.library.duplicate': return duplicateDriveLibraryScore(command.accountId, command.driveGeneration, command.itemId, command.parentId);
    case 'drive.library.move': return moveDriveLibraryScore(command.accountId, command.driveGeneration, command.itemId, command.parentId);
    case 'drive.library.trash': return trashDriveLibraryScore(command.accountId, command.driveGeneration, command.itemId, command.parentId);
    case 'drive.library.open-web': return openDriveLibraryItem(command.accountId, command.driveGeneration, command.itemId, command.kind, command.webViewLink);
    case 'settings.set-locale':
      state.locale = command.locale; void savePreferences(); renderAll(); return;
    case 'settings.set-theme':
      state.theme = command.theme; void savePreferences(); renderAll(); return;
    case 'pwa.update': return pwaRuntime.applyUpdate();
    case 'pwa.later': pwaRuntime.dismissUpdate(); return;
    case 'menu.open':
      if (command.menu === 'file') openFileMenu();
      else if (command.menu === 'edit') openEditMenu();
      else if (command.menu === 'view') openViewMenu();
      else if (command.menu === 'help') openHelpMenu();
      else if (command.menu === 'drive') openDriveHeaderMenu();
      else if (command.menu === 'drive-root') openDriveRootMenu();
      else if (command.menu === 'settings') openSettingsMenu();
      else if (command.menu === 'explorer') openExplorerMenu();
      else openInspectorMenu();
      return;
    case 'menu.close': closeWorkspaceMenu(); return;
    case 'menu.activate': {
      const index = workspaceMenuSnapshot?.items.findIndex(item => item.id === command.itemId) ?? -1;
      const action = index >= 0 ? workspaceMenuActions[index] : undefined;
      if (!action || action.disabled || action.separator || action.href) return;
      closeWorkspaceMenu();
      try {
        const result = action.run?.();
        if (result instanceof Promise) return result.catch(error => showMessage(shortError(error), 'error'));
      } catch (error) { showMessage(shortError(error), 'error'); }
      return;
    }
    case 'help.open': return openHelp();
    case 'diagnostic.activate': {
      const diagnostic = workspaceSnapshot().diagnostics[command.index];
      if (!diagnostic) return;
      setWorkspaceViewMode('source');
      sourceEditor.setSelection(diagnostic.from, diagnostic.to);
      return;
    }
    case 'message.dismiss': showMessage(''); return;
    case 'explorer.toggle-expanded':
      if (command.storage === 'local') localExpanded = !localExpanded;
      else {
        driveExpanded = !driveExpanded;
        if (driveExpanded && state.folderId && !driveChildrenByParent.has(state.folderId)) {
          publishWorkspaceSnapshot();
          return loadDriveChildren(state.folderId);
        }
      }
      publishWorkspaceSnapshot(); return;
    case 'splitter.event': return handleSplitterCommand(command);
  }
}

type SplitterName = Extract<WorkspaceCommand, { type: 'splitter.event' }>['splitter'];
let splitterDrag: { splitter: SplitterName; x: number; y: number; width: number; height: number; ratio: number; pointerId?: number } | undefined;
function handleSplitterCommand(command: Extract<WorkspaceCommand, { type: 'splitter.event' }>): void {
  const { splitter, phase } = command;
  if (phase === 'start') {
    splitterDrag = {
      splitter, x: command.clientX ?? 0, y: command.clientY ?? 0,
      width: splitter === 'explorer' ? state.explorerWidth : state.inspectorWidth,
      height: state.problemsHeight, ratio: state.splitRatio, pointerId: command.pointerId
    };
    return;
  }
  if (phase === 'reset') {
    if (splitter === 'explorer') state.explorerWidth = 220;
    else if (splitter === 'inspector') state.inspectorWidth = 300;
    else if (splitter === 'problems') state.problemsHeight = 200;
    else state.splitRatio = 0.4;
    applyWorkspaceLayout(); saveLayoutSoon(); return;
  }
  if (phase === 'keyboard') {
    const delta = command.shiftKey ? 50 : 10;
    if (splitter === 'explorer') {
      if (command.key === 'Home') state.explorerWidth = 180;
      else if (command.key === 'End') state.explorerWidth = 420;
      else if (command.key === 'ArrowLeft') state.explorerWidth -= delta;
      else if (command.key === 'ArrowRight') state.explorerWidth += delta;
      state.explorerWidth = Math.max(180, Math.min(420, state.explorerWidth));
    } else if (splitter === 'inspector') {
      if (command.key === 'Home') state.inspectorWidth = 260;
      else if (command.key === 'End') state.inspectorWidth = 480;
      else if (command.key === 'ArrowLeft') state.inspectorWidth += delta;
      else if (command.key === 'ArrowRight') state.inspectorWidth -= delta;
      state.inspectorWidth = Math.max(260, Math.min(480, state.inspectorWidth));
    } else if (splitter === 'problems') {
      if (command.key === 'Home') state.problemsHeight = 140;
      else if (command.key === 'End') state.problemsHeight = Math.floor(window.innerHeight * 0.45);
      else if (command.key === 'ArrowUp') state.problemsHeight += delta;
      else if (command.key === 'ArrowDown') state.problemsHeight -= delta;
    } else {
      const width = splitView.clientWidth || 1;
      if (command.key === 'Home') state.splitRatio = 0.05;
      else if (command.key === 'End') state.splitRatio = 0.95;
      else if (command.key === 'ArrowLeft') state.splitRatio -= delta / width;
      else if (command.key === 'ArrowRight') state.splitRatio += delta / width;
    }
    applySplitRatio(); applyWorkspaceLayout(); saveLayoutSoon(); return;
  }
  if (phase === 'move' && splitterDrag?.splitter === splitter) {
    const x = command.clientX ?? splitterDrag.x;
    const y = command.clientY ?? splitterDrag.y;
    if (splitter === 'explorer') state.explorerWidth = Math.max(180, Math.min(420, Math.round(splitterDrag.width + x - splitterDrag.x)));
    else if (splitter === 'inspector') state.inspectorWidth = Math.max(260, Math.min(480, Math.round(splitterDrag.width - (x - splitterDrag.x))));
    else if (splitter === 'problems') state.problemsHeight = Math.max(140, Math.min(Math.floor(window.innerHeight * 0.45), Math.round(splitterDrag.height + splitterDrag.y - y)));
    else {
      const bounds = splitView.getBoundingClientRect();
      if (bounds.width > 0) state.splitRatio = Math.max(0.05, Math.min(0.95, (x - bounds.left) / bounds.width));
    }
    applyWorkspaceLayout(); applySplitRatio(); return;
  }
  if (phase === 'cancel' && splitterDrag?.splitter === splitter) {
    if (splitter === 'explorer') state.explorerWidth = splitterDrag.width;
    else if (splitter === 'inspector') state.inspectorWidth = splitterDrag.width;
    else if (splitter === 'problems') state.problemsHeight = splitterDrag.height;
    else state.splitRatio = splitterDrag.ratio;
    splitterDrag = undefined; applyWorkspaceLayout(); applySplitRatio(); return;
  }
  if (phase === 'end' && splitterDrag?.splitter === splitter) {
    splitterDrag = undefined; applyWorkspaceLayout(); applySplitRatio(); saveLayoutSoon();
  }
}

function releaseReloadPreparation(): void {
  if (!reloadPreparationActive) return;
  reloadPreparationActive = false;
  reloadBaselineMatches = undefined;
  if (runtimeDisposed) return;
  releasePreviewAudioLock('reload');
  syncWorkspaceInteractionLock();
  publishWorkspaceSnapshot();
  if (deferredExplorerRefresh && !pageCacheSuspended) {
    deferredExplorerRefresh = false;
    void refreshExplorerSnapshot();
  }
  if (deferredAppDataSync && !pageCacheSuspended && state.appDataSync !== 'error' && navigator.onLine) {
    deferredAppDataSync = false;
    scheduleDriveAppDataSync();
  }
}

async function prepareForReload(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const blocked = (ja: string, en: string) => ({ ok: false as const, reason: state.locale === 'ja' ? ja : en });
  if (reloadPreparationActive) return blocked('更新の準備がすでに進行中です。', 'An update is already being prepared.');
  if (remoteAppDataRestoreInProgress) {
    return blocked('Drive の設定を復元しています。完了後に更新してください。', 'Wait for Drive settings to finish restoring before updating.');
  }
  if (pageCacheSuspended || runtimeDisposed) return blocked('ワークスペース復帰後にもう一度更新してください。', 'Resume the workspace before preparing an update.');

  // Lock synchronously before the first await. Existing actions remain registered until they
  // settle; an update attempt fails closed rather than reloading across an in-flight operation.
  reloadPreparationRemoteRestoreOutcome = undefined;
  updatePreparationGeneration += 1;
  reloadPreparationActive = true;
  syncWorkspaceInteractionLock();
  publishWorkspaceSnapshot();
  const fail = (ja: string, en: string) => {
    releaseReloadPreparation();
    return blocked(ja, en);
  };
  if (activeWorkspaceOperationCount > 0) {
    return fail('進行中のワークスペース操作が完了してから更新してください。', 'Wait for current workspace operations to finish before updating.');
  }
  if (!sourceEditor.flushPendingEdit()) {
    return fail('日本語入力を確定してから更新してください。', 'Finish the current text composition before updating.');
  }

  const baseline = {
    activeKey: state.activeKey,
    tabs: state.tabs.map(tab => ({
      tab, key: tabKey(tab), identity: { ...tab.document.identity }, accountId: tab.accountId,
      source: tab.source, revision: tab.revision
    }))
  };
  const baselineMatches = (): boolean => state.activeKey === baseline.activeKey
    && state.tabs.length === baseline.tabs.length
    && baseline.tabs.every((saved, index) => {
      const tab = state.tabs[index];
      return tab === saved.tab && tabKey(tab) === saved.key && sameTabIdentity(tab, saved.identity, saved.accountId)
        && tab.source === saved.source && tab.revision === saved.revision;
    })
    && (activeTab()
      ? sourceEditor.getText() === activeTab()!.source.replace(/\r\n?/gu, '\n')
      : sourceEditor.getText() === '');
  reloadBaselineMatches = baselineMatches;
  const validate = (requireDrafts: boolean, requireAppDataIdle: boolean): { ok: true } | { ok: false; reason: string } => {
    if (!reloadPreparationActive || runtimeDisposed) return blocked('更新準備が中断されました。', 'Update preparation was interrupted.');
    if (remoteAppDataRestoreInProgress) return blocked('Drive の設定を復元しています。', 'Drive settings are still being restored.');
    if (pageCacheSuspended) return blocked('ページ復帰後にもう一度確認してください。', 'Recheck the workspace after it resumes from browser history.');
    if (!baselineMatches()) return blocked('更新準備中に文書が変わりました。編集状態を確認してから再試行してください。', 'A document changed during update preparation. Review the edits and try again.');
    if (sourceEditor.hasPendingEdit()) return blocked('確定していない編集があります。入力を完了してから再試行してください。', 'An editor change is still pending. Finish the input and try again.');
    if (moveToDriveInProgress || driveConnectInProgress || restoringDriveSession
      || activeDriveOperations > 0 || activeDriveListOperations > 0
      || activeDriveReadOperations > 0 || activeDriveWorkflowOperations > 0) {
      return blocked('Google Drive の処理が完了してから更新してください。', 'Wait for current Google Drive operations to finish before updating.');
    }
    if (requireDrafts && state.tabs.some(tab => hasUnpersistedDraft(tab) || tab.saveStatus === 'saving')) {
      return blocked('未保存の下書きをローカル保存できませんでした。', 'A draft could not be saved locally before updating.');
    }
    if (requireAppDataIdle && (state.appDataSync !== 'idle' || state.appDataPending || appDataSyncTimer || deferredAppDataSync)) {
      return blocked('Google Drive の設定同期が完了するまで更新できません。', 'Wait for Google Drive settings to finish syncing before updating.');
    }
    return { ok: true };
  };

  let check = validate(false, false);
  if (!check.ok) return fail(check.reason, check.reason);
  for (const saved of baseline.tabs) {
    if (!hasUnpersistedDraft(saved.tab)) continue;
    const persisted = await saveDraftNow(saved.tab);
    if (!persisted) return fail('未保存の下書きをローカル保存できませんでした。', 'A draft could not be saved locally before updating.');
    check = validate(false, false);
    if (!check.ok) return fail(check.reason, check.reason);
  }

  const appDataNeedsFlush = state.appDataSync === 'pending' || state.appDataSync === 'syncing'
    || state.appDataSync === 'error' || appDataSyncTimer > 0 || Boolean(state.appDataPending) || deferredAppDataSync;
  if (appDataNeedsFlush) {
    const synced = await flushDriveAppData(() => validate(false, false).ok);
    if (reloadPreparationRemoteRestoreOutcome) {
      const outcome = reloadPreparationRemoteRestoreOutcome;
      reloadPreparationRemoteRestoreOutcome = undefined;
      return outcome === 'restored'
        ? blocked(
          'Drive から設定を復元しました。内容を確認してから更新をもう一度選んでください。',
          'Drive settings were restored. Review the workspace and choose Update again.'
        )
        : blocked(
          'Drive から設定を復元できませんでした。保留中の設定を保持しました。内容を確認して再試行してください。',
          'Drive settings could not be restored. Pending settings were kept; review the workspace before retrying.'
        );
    }
    if (!synced) return fail('Google Drive の設定同期が完了するまで更新できません。', 'Wait for Google Drive settings to finish syncing before updating.');
    deferredAppDataSync = false;
    check = validate(true, true);
    if (!check.ok) return fail(check.reason, check.reason);
  }
  check = validate(true, true);
  if (!check.ok) return fail(check.reason, check.reason);

  if (progressionAudioLease.activeLeaseId) {
    await stopCandidateAudition();
    check = validate(true, true);
    if (!check.ok) return fail(check.reason, check.reason);
  }
  if (progressionAudioLease.activeLeaseId) {
    return fail('試聴を停止できませんでした。停止後に更新してください。', 'Inspector audio could not be stopped. Stop it before updating.');
  }
  const previewStopped = await requestPreviewAudioLock('reload');
  if (!previewStopped) return fail('Preview の再生を停止できませんでした。停止後に更新してください。', 'Preview playback could not be stopped. Stop it before updating.');
  check = validate(true, true);
  if (!check.ok) return fail(check.reason, check.reason);
  return { ok: true };
}

pwaRuntime = registerPwa({
  prepareForReload,
  revalidateForActivation() {
    const blocked = (ja: string, en: string) => ({ ok: false as const, reason: state.locale === 'ja' ? ja : en });
    if (runtimeDisposed) return blocked('ワークスペースが終了しています。', 'The workspace has been disposed.');
    if (!reloadPreparationActive || remoteAppDataRestoreInProgress || pageCacheSuspended) {
      return blocked('更新準備が安全な状態ではありません。', 'The workspace is not in a safe update-preparation state.');
    }
    if (!reloadBaselineMatches?.()) return blocked('更新準備中に文書が変わりました。編集状態を確認してから再試行してください。', 'A document identity or source revision changed during update preparation.');
    const active = activeTab();
    if (sourceEditor.hasPendingEdit() || active && sourceEditor.getText() !== active.source.replace(/\r\n?/gu, '\n')) {
      return blocked('更新準備中にエディターの入力状態が変わりました。内容を確認してから再試行してください。', 'Editor input changed during update preparation.');
    }
    if (moveToDriveInProgress || driveConnectInProgress || restoringDriveSession
      || activeDriveOperations > 0 || activeDriveListOperations > 0
      || activeDriveReadOperations > 0 || activeDriveWorkflowOperations > 0) {
      return blocked('更新準備中にGoogle Driveの処理が始まりました。処理完了後に再試行してください。', 'A Google Drive operation started during update preparation.');
    }
    if (state.tabs.some(tab => hasUnpersistedDraft(tab) || tab.saveStatus === 'saving')) {
      return blocked('ローカルの下書き保存が完了していません。保存完了後に再試行してください。', 'A local draft is not fully persisted.');
    }
    if (state.appDataSync !== 'idle' || state.appDataPending || appDataSyncTimer || deferredAppDataSync) {
      return blocked('Google Driveの設定同期が完了していません。同期完了後に再試行してください。', 'Google Drive application state is still pending.');
    }
    if (active && (!previewAudioLockId || previewAudioLockPurpose !== 'reload' || !previewAudioLockAcknowledged)) {
      return blocked('Previewの再生停止を確認できませんでした。停止後に再試行してください。', 'Preview audio has not confirmed that it stopped.');
    }
    return { ok: true as const };
  },
  cancelPreparation: releaseReloadPreparation
});
unsubscribePwaRuntime = pwaRuntime.subscribe(() => publishWorkspaceSnapshot());
window.addEventListener('online', () => {
  if (reloadPreparationActive || pageCacheSuspended) { deferredExplorerRefresh = true; return; }
  void refreshExplorerSnapshot();
}, runtimeListenerOptions);
window.addEventListener('offline', () => {
  explorerListRequests.invalidate();
  driveFileRows = [];
  publishWorkspaceSnapshot();
}, runtimeListenerOptions);

function disposeWorkspaceRuntime(): void {
  if (runtimeDisposed) return;
  runtimeDisposed = true;
  runtimeLifecycle.abort();
  workspaceResizeObserver?.disconnect();
  workspaceResizeObserver = undefined;
  removePreviewMessageListener();
  removePreviewMessageListener = () => {};
  unsubscribePwaRuntime();
  unsubscribePwaRuntime = () => {};
  pwaRuntime.dispose();
  window.clearTimeout(appDataSyncTimer);
  window.clearTimeout(layoutSaveTimer);
  window.clearTimeout(previewTimer);
  window.clearTimeout(auditionCompletionTimer);
  appDataSyncTimer = 0;
  layoutSaveTimer = 0;
  previewTimer = 0;
  auditionCompletionTimer = 0;
  for (const timer of pendingAudioStopTimers.values()) window.clearTimeout(timer);
  pendingAudioStopTimers.clear();
  for (const waiter of previewAudioStopWaiters.values()) {
    window.clearTimeout(waiter.timeout);
    waiter.resolve(false);
  }
  previewAudioStopWaiters.clear();
  for (const check of previewModeDraftChecks.values()) check.resolve(undefined);
  previewModeDraftChecks.clear();
  if (helpBlobUrl) URL.revokeObjectURL(helpBlobUrl);
  helpBlobUrl = '';
  derivedScoreCache.clear();
  workspaceListeners.clear();
  sourceEditor.destroy();
  progressionAudioLease.dispose();
}

export const workspaceRuntimeController: Omit<WebWorkspaceController, 'start'> & WorkspaceHostBindings = {
  snapshot: workspaceSnapshot,
  subscribe(callback) {
    workspaceListeners.add(callback);
    callback(workspaceSnapshot());
    return () => workspaceListeners.delete(callback);
  },
  dispatch: applyWorkspaceCommand,
  prepareForReload,
  dispose: disposeWorkspaceRuntime,
  mountSourceEditor(container) {
    if (container !== editor) throw new Error('Vue mounted a different source editor host than the workspace runtime.');
  },
  mountScoreFrame(frame) {
    if (frame !== scoreFrame) throw new Error('Vue mounted a different score preview host than the workspace runtime.');
  },
  mountInspectorHosts(hosts) {
    if (hosts.content !== inspectorContent || hosts.tabs !== inspectorTabsHost || hosts.settings !== sharedSettingsHost
      || hosts.settingsLabels !== app.querySelector<HTMLElement>('#settings-labels')) {
      throw new Error('Vue mounted different Inspector hosts than the workspace runtime.');
    }
  },
  requestContextMenu(request) {
    requestWorkspaceContextMenu(request);
  }
};

void init().finally(() => {
  if (runtimeDisposed) return;
  workspaceInitializing = false;
  syncWorkspaceInteractionLock();
  void refreshExplorerSnapshot();
  publishWorkspaceSnapshot();
});
