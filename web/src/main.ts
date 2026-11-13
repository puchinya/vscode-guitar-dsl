import './style.css';
import regularFontUrl from '../../media/fonts/NotoSansJP-Regular.ttf?url';
import boldFontUrl from '../../media/fonts/NotoSansJP-Bold.ttf?url';
import { parseGuitarDsl, type ParsedScore } from '@guitardsl/core/compiler';
import { formatDiagnostic } from '@guitardsl/core/i18n';
import { planVisualEdit } from '@guitardsl/core/visualEditing/planners';
import type { VisualEditOperation } from '@guitardsl/core/visualEditing/model';
import { suggestNextChords } from '@guitardsl/core/progressionSuggestions';
import { buildProgressionAuditionPlaybackData, compileGuitarDslToHtml } from '@guitardsl/ui/previewHtml';
import { ProgressionAudioLeaseCoordinator, type ProgressionAudioStartMessage } from '@guitardsl/ui/progressionAudioLease';
import { renderInspectorTabsMarkup, type InspectorTabId } from '@guitardsl/ui/inspectorTabs';
import type { PageOrientation, PageSize } from '@guitardsl/pdf';
import type { DocumentIdentity, DocumentSnapshot, StorageKind } from '@guitardsl/document';
import { GoogleAuthError, GoogleOAuth, type GoogleAccount } from './auth/googleOAuth';
import { DriveApiError, driveIdentity, GoogleDriveApi, isSupportedDriveFile, type DriveFile } from './storage/googleDrive';
import { indexedDb, keyForDocument, type StoredDocument } from './storage/indexedDb';
import { downloadSource, importLocalFile, moveLocalDocumentToDrive, MoveRecoveryError } from './storage/fileTransfer';

type PreviewMode = 'normal' | 'edit' | 'practice';
type InspectorTab = InspectorTabId;
type MobilePane = 'source' | 'preview';

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
}

interface AppState {
  tabs: OpenTab[];
  activeKey: string | null;
  activeStorage: StorageKind;
  account?: GoogleAccount;
  drive?: GoogleDriveApi;
  folderId?: string;
  driveFiles: DriveFile[];
  inspectorTab: InspectorTab;
  mobilePane: MobilePane;
  locale: 'en' | 'ja';
  theme: 'system' | 'light' | 'dark';
  pageSize: PageSize;
  orientation: PageOrientation;
  expandPageBreakRepeats: boolean;
  storageReady: boolean;
  previewGeneration: number;
  splitRatio: number;
  authExpired: boolean;
  lastProgression?: unknown;
  audioCandidateId?: string;
  audioStatus: string;
}

interface PreviewModeDraftCheck {
  identity: { documentUri: string; documentVersion: number; previewGeneration: number };
  resolve: (hasDraft: boolean | undefined) => void;
}

const DEFAULT_SOURCE = 'title: My song\n\ntempo: 96\n\n[Verse]\nC | G | Am | F |\n';
const WEB_PREVIEW_BRIDGE = `window.guitarDslHost = {
  postMessage: message => window.parent.postMessage({ channel: 'guitardsl-preview', message }, '*'),
  getState: () => null,
  setState: () => {}
};`;
const WEB_PREVIEW_STYLE = `
  :root { color-scheme: light; --vscode-editorWidget-background:#fff; --vscode-editorWidget-border:#dfe2e7;
    --vscode-foreground:#20242b; --vscode-descriptionForeground:#68717e; --vscode-widget-border:#d9dde5;
    --vscode-input-background:#fff; --vscode-input-foreground:#20242b; --vscode-button-background:#5364d9;
    --vscode-button-border:#5364d9; --vscode-button-secondaryBackground:#f2f3f6;
    --vscode-button-secondaryForeground:#343a46; --vscode-button-secondaryHoverBackground:#e7e9f0;
    --vscode-focusBorder:#5364d9; }
  body { padding-top: 102px; background:#f4f5f7; color:#20242b; }
  .toolbar-container,.score-settings-row { box-shadow:none; }
  @media(prefers-color-scheme:dark) { :root { color-scheme:dark; --vscode-editorWidget-background:#242830;
    --vscode-editorWidget-border:#3a3f4a; --vscode-foreground:#e4e7ee; --vscode-descriptionForeground:#aeb5c2;
    --vscode-widget-border:#454c59; --vscode-input-background:#1e2127; --vscode-input-foreground:#e4e7ee;
    --vscode-button-background:#6877eb; --vscode-button-border:#6877eb; --vscode-button-secondaryBackground:#2e333d;
    --vscode-button-secondaryForeground:#e4e7ee; --vscode-button-secondaryHoverBackground:#3b424e;
    --vscode-focusBorder:#8792ea; }
    body { background:#1e2127; color:#e4e7ee; } }
`;

const STRINGS = {
  en: {
    files: 'Files', local: 'On this device', drive: 'Google Drive', newScore: 'New score', connect: 'Connect Drive',
    disconnect: 'Disconnect', folder: 'Choose folder', createFolder: 'Create GuitarDSL folder', openDrive: 'Open from Drive',
    addFile: 'Import file', source: 'Source', preview: 'Preview', inspector: 'Inspector', document: 'Document',
    variables: 'Variables', settings: 'Settings', progression: 'Progression', save: 'Save', saved: 'Saved locally',
    draft: 'Local draft saved', saving: 'Saving draft…', unsaved: 'Unsaved changes', downloadPdf: 'Download PDF',
    exportFile: 'Export .guitardsl', moveDrive: 'Move to Drive', closeTab: 'Close', language: 'Language',
    theme: 'Theme', pageSize: 'Page size', orientation: 'Orientation', portrait: 'Portrait', landscape: 'Landscape',
    narrowSource: 'Source', narrowPreview: 'Score', createFirst: 'Create a score to get started.',
    connectHint: 'Connect Google Drive to show files that this app can access.', noFolder: 'Choose or create a GuitarDSL folder.',
    driveAccess: 'Drive access is limited to files you open with this app or create here.', noDiagnostics: 'No diagnostics.',
    title: 'Title', artist: 'Artist', tempo: 'Tempo', measures: 'Measures', chords: 'Chords', errors: 'Errors',
    suggest: 'Suggest next chords', reload: 'Reload latest', saveCopy: 'Save local version as a new Drive file', cancel: 'Cancel',
    ready: 'Local storage ready', unavailable: 'Local storage is unavailable. Download your work to keep a copy.',
    previewEditGuard: 'Apply the pending Preview edit before changing modes.', noSuggestions: 'No suggestion is available for this score.',
    confirmDelete: 'Delete this local score and its draft?',
    audition: 'Audition', stopAudition: 'Stop audition', audioStarting: 'Starting audition…',
    audioPlaying: 'Audition playing.', audioStopped: 'Audition stopped.', audioUnavailable: 'Audio audition is unavailable.',
  },
  ja: {
    files: 'ファイル', local: 'このデバイス', drive: 'Google Drive', newScore: '新しい楽譜', connect: 'Drive に接続',
    disconnect: '接続を解除', folder: 'フォルダーを選択', createFolder: 'GuitarDSL フォルダーを作成', openDrive: 'Drive から開く',
    addFile: 'ファイルを読み込む', source: 'ソース', preview: 'プレビュー', inspector: 'インスペクター', document: '文書',
    variables: '変数', settings: '設定', progression: 'コード進行', save: '保存', saved: 'ローカルに保存済み',
    draft: '下書きを保存済み', saving: '下書きを保存中…', unsaved: '未保存の変更', downloadPdf: 'PDF をダウンロード',
    exportFile: '.guitardsl を書き出す', moveDrive: 'Drive に移動', closeTab: 'タブを閉じる', language: '言語',
    theme: 'テーマ', pageSize: '用紙サイズ', orientation: '向き', portrait: '縦', landscape: '横',
    narrowSource: 'ソース', narrowPreview: '譜面', createFirst: '新しい楽譜を作成してください。',
    connectHint: 'Drive に接続すると、このアプリがアクセスできるファイルを表示します。', noFolder: 'GuitarDSL フォルダーを選択または作成してください。',
    driveAccess: 'Drive の一覧には、このアプリで開いたファイルと作成したファイルのみ表示されます。', noDiagnostics: '診断はありません。',
    title: 'タイトル', artist: 'アーティスト', tempo: 'テンポ', measures: '小節', chords: 'コード', errors: 'エラー',
    suggest: '次のコードを提案', reload: '最新の内容を読み込む', saveCopy: 'ローカル版を新しい Drive ファイルとして保存', cancel: 'キャンセル',
    ready: 'ローカル保存を利用できます', unavailable: 'ローカル保存を利用できません。作業内容を残すにはダウンロードしてください。',
    previewEditGuard: 'Preview の編集中の内容を適用してからモードを切り替えてください。', noSuggestions: 'この楽譜では提案できません。',
    confirmDelete: 'このローカル楽譜と下書きを削除しますか？',
    audition: '試聴', stopAudition: '試聴を停止', audioStarting: '試聴を開始しています…',
    audioPlaying: '試聴中です。', audioStopped: '試聴を停止しました。', audioUnavailable: '試聴を利用できません。',
  }
} as const;

const app = document.querySelector<HTMLDivElement>('#app')!;
const state: AppState = {
  tabs: [], activeKey: null, activeStorage: 'local', driveFiles: [], inspectorTab: 'document', mobilePane: 'source',
  locale: navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en', theme: 'system', pageSize: 'A4',
    orientation: 'portrait', expandPageBreakRepeats: true, storageReady: false, previewGeneration: 0,
    audioStatus: '',
    splitRatio: 0.48, authExpired: false
};
const auth = new GoogleOAuth();
const draftWrites = new Map<string, Promise<void>>();
const previewModeDraftChecks = new Map<string, PreviewModeDraftCheck>();
let previewModeDraftCheckSequence = 0;
let explorerRenderGeneration = 0;

app.innerHTML = `
  <main class="app-shell" aria-label="GuitarDSL">
    <header class="topbar">
      <div class="brand"><span class="brand-mark" aria-hidden="true">♪</span><strong>GuitarDSL</strong></div>
      <div class="workspace-name" id="workspace-name">My songs</div>
      <div class="top-actions">
        <button type="button" class="quiet-button" id="connect-drive">Connect Drive</button>
        <button type="button" class="quiet-button" id="save-document">Save</button>
        <button type="button" class="primary-button" id="new-score">New score</button>
      </div>
    </header>
    <div class="workspace">
      <aside class="file-list" aria-label="Files">
        <div class="pane-heading"><span id="files-heading">Files</span><button type="button" id="import-file" aria-label="Import file">＋</button></div>
        <div class="storage-switch" role="group" aria-label="File storage">
          <button type="button" data-storage="local" class="selected" id="storage-local">On this device</button>
          <button type="button" data-storage="drive" id="storage-drive">Google Drive</button>
        </div>
        <div class="file-actions" id="file-actions"></div>
        <div class="file-items" id="file-items"></div>
        <p class="drive-scope-note" id="drive-scope-note" hidden></p>
      </aside>
      <section class="editor-workspace" aria-label="Score workspace">
        <div class="tabs" role="tablist" aria-label="Open documents" id="open-tabs"></div>
        <div class="toolbar">
          <button type="button" class="quiet-button" id="mobile-source">Source</button>
          <button type="button" class="quiet-button" id="mobile-preview">Score</button>
          <span class="toolbar-spacer"></span>
          <span class="saved-state" id="saved-state">Local storage ready</span>
          <button type="button" class="quiet-button" id="export-file">Export .guitardsl</button>
          <button type="button" class="quiet-button" id="move-drive" hidden>Move to Drive</button>
          <button type="button" class="primary-button" id="download-pdf">Download PDF</button>
        </div>
        <div class="app-message" id="app-message" role="status" hidden></div>
        <div class="split-view">
          <section class="source-pane" aria-label="GuitarDSL source" id="source-pane">
            <div class="pane-heading"><span>Source</span><span class="language-chip">GuitarDSL</span></div>
            <textarea spellcheck="false" aria-label="GuitarDSL source editor" placeholder="title: My song&#10;&#10;[Verse]&#10;C | G | Am | F |"></textarea>
            <div class="diagnostics" id="diagnostics" aria-live="polite"></div>
          </section>
          <div class="split-divider" role="separator" aria-orientation="vertical" aria-label="Resize source and score panes" tabindex="0"></div>
          <section class="score-pane" aria-label="Score preview" id="score-pane">
            <div class="pane-heading"><span>Preview</span><span class="preview-state" id="preview-state">Loading score</span></div>
            <iframe id="score-frame" title="GuitarDSL score preview" sandbox="allow-scripts"></iframe>
          </section>
        </div>
      </section>
      <aside class="inspector" aria-label="Inspector">
        <div class="pane-heading"><span id="inspector-heading">Inspector</span><button type="button" id="collapse-inspector" aria-label="Collapse Inspector">⌄</button></div>
        <div id="inspector-tabs-host"></div>
        <div class="inspector-content" id="inspector-content" role="tabpanel" tabindex="0"></div>
      </aside>
    </div>
    <footer class="statusbar"><span class="status-dot" aria-hidden="true"></span><span id="storage-status">Local storage ready</span><span class="status-spacer"></span>
      <label class="status-select"><span class="sr-only">Language</span><select id="locale-select" aria-label="Language"><option value="en">English</option><option value="ja">日本語</option></select></label>
      <label class="status-select"><span class="sr-only">Theme</span><select id="theme-select" aria-label="Theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
    </footer>
    <input id="file-input" type="file" accept=".guitardsl,.gdsl,text/plain" hidden />
  </main>
`;

const editor = app.querySelector<HTMLTextAreaElement>('textarea[aria-label="GuitarDSL source editor"]')!;
const fileItems = app.querySelector<HTMLDivElement>('#file-items')!;
const fileActions = app.querySelector<HTMLDivElement>('#file-actions')!;
const tabsElement = app.querySelector<HTMLDivElement>('#open-tabs')!;
const scoreFrame = app.querySelector<HTMLIFrameElement>('#score-frame')!;
const inspectorContent = app.querySelector<HTMLDivElement>('#inspector-content')!;
const diagnosticsElement = app.querySelector<HTMLDivElement>('#diagnostics')!;
const appMessage = app.querySelector<HTMLDivElement>('#app-message')!;
const driveScopeNote = app.querySelector<HTMLParagraphElement>('#drive-scope-note')!;
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
function activeTab(): OpenTab | undefined { return state.tabs.find(tab => tabKey(tab) === state.activeKey); }
function tabKey(tab: Pick<OpenTab, 'document' | 'accountId'>): string {
  return `${keyForDocument(tab.document.identity)}:${tab.document.identity.storage === 'drive' ? tab.accountId ?? '' : ''}`;
}
function sameTabIdentity(tab: OpenTab, identity: DocumentIdentity, accountId?: string): boolean {
  return tab.document.identity.storage === identity.storage && tab.document.identity.fileId === identity.fileId
    && (identity.storage !== 'drive' || tab.accountId === accountId);
}
function esc(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
function shortError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred.';
}
function markDriveAuthState(error: unknown): void {
  if (error instanceof GoogleAuthError && error.code === 'expired' || error instanceof DriveApiError && error.status === 401) {
    state.authExpired = true;
    const button = app.querySelector<HTMLButtonElement>('#connect-drive');
    if (button) button.textContent = state.locale === 'ja' ? 'Drive に再接続' : 'Reconnect Drive';
  }
}
function showMessage(message: string, kind: 'info' | 'error' = 'info'): void {
  appMessage.hidden = !message;
  appMessage.textContent = message;
  appMessage.dataset.kind = kind;
}
function activeIdentityLabel(tab: OpenTab): string {
  return tab.document.identity.storage === 'drive'
    ? `drive:${tab.accountId}:${tab.document.identity.fileId}`
    : `local:${tab.document.identity.fileId}`;
}
function snapshot(tab: OpenTab): DocumentSnapshot {
  return { identity: tab.document.identity, revision: tab.revision, source: tab.source };
}
function currentScore(source: string): ParsedScore | undefined {
  try { return parseGuitarDsl(source, { expandPageBreakRepeats: state.expandPageBreakRepeats }); }
  catch { return undefined; }
}
async function setActive(key: string): Promise<void> {
  const next = state.tabs.find(tab => tabKey(tab) === key);
  if (!next) return;
  if (progressionAudioLease.activeSessionUri && progressionAudioLease.activeSessionUri !== activeIdentityLabel(next)) {
    await stopCandidateAudition();
  }
  state.activeKey = key;
  const tab = activeTab();
  if (!tab) return;
  state.activeStorage = tab.document.identity.storage;
  editor.value = tab.source;
  renderAll();
  void persistSessions();
}

async function persistSessions(): Promise<void> {
  if (!state.storageReady) return;
  const localTabs = state.tabs.filter(tab => tab.document.identity.storage === 'local');
  const localActive = localTabs.find(tab => tabKey(tab) === state.activeKey);
  try {
    await indexedDb.setValue('sessions', 'workspace-local', {
      tabs: localTabs.map(tab => tab.document.identity.fileId), active: localActive?.document.identity.fileId ?? null
    } satisfies WorkspaceSession);
    if (state.account) {
      const remoteTabs = state.tabs.filter(tab => tab.document.identity.storage === 'drive' && tab.accountId === state.account!.accountId);
      const remoteActive = remoteTabs.find(tab => tabKey(tab) === state.activeKey);
      await indexedDb.setValue('sessions', `workspace-drive:${state.account.accountId}`, {
        tabs: remoteTabs.map(tab => tab.document.identity.fileId), active: remoteActive?.document.identity.fileId ?? null
      } satisfies WorkspaceSession);
    }
  } catch { state.storageReady = false; renderStorageStatus(); }
}

function renderStorageStatus(text?: string): void {
  const message = text ?? (state.storageReady ? strings().ready : strings().unavailable);
  app.querySelector('#storage-status')!.textContent = message;
  app.querySelector('#saved-state')!.textContent = state.storageReady ? strings().saved : strings().unavailable;
  app.querySelector('.status-dot')!.classList.toggle('unavailable', !state.storageReady);
}

function scheduleDraft(tab: OpenTab): void {
  const key = tabKey(tab);
  app.querySelector('#saved-state')!.textContent = strings().saving;
  const edit = snapshot(tab);
  const previous = draftWrites.get(key) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(async () => {
    try {
      if (!tab.persistable || !state.storageReady) throw new DOMException('Local storage is unavailable', 'NotSupportedError');
      const saved = await indexedDb.saveDraft(edit, tab.accountId);
      if (!saved) throw new DOMException('A newer edit exists in another tab', 'InvalidStateError');
      if (state.activeKey === key && tab.revision === edit.revision) {
        app.querySelector('#saved-state')!.textContent = strings().draft;
      }
      if (state.activeStorage === 'local') void renderExplorer();
    } catch (error) {
      if (state.storageReady) {
        state.storageReady = false;
        renderStorageStatus(strings().unavailable);
      }
      showMessage(`${strings().unavailable} ${shortError(error)}`, 'error');
    }
  });
  draftWrites.set(key, write);
  void write.finally(() => { if (draftWrites.get(key) === write) draftWrites.delete(key); });
}

function renderDiagnostics(score: ParsedScore | undefined): void {
  diagnosticsElement.replaceChildren();
  const diagnostics = score?.diagnostics ?? [];
  if (!diagnostics.length) {
    diagnosticsElement.textContent = strings().noDiagnostics;
    diagnosticsElement.dataset.kind = 'ok';
    return;
  }
  diagnosticsElement.dataset.kind = diagnostics.some(item => item.severity === 'error') ? 'error' : 'warning';
  const list = document.createElement('ul');
  for (const diagnostic of diagnostics) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `L${diagnostic.line + 1}:${diagnostic.startCol + 1} ${formatDiagnostic(diagnostic.code, diagnostic.args, state.locale)}`;
    button.addEventListener('click', () => {
      editor.focus();
      const lines = editor.value.split('\n');
      const offset = lines.slice(0, diagnostic.line).reduce((total, line) => total + line.length + 1, 0) + diagnostic.startCol;
      editor.setSelectionRange(offset, Math.min(editor.value.length, offset + Math.max(1, diagnostic.endCol - diagnostic.startCol)));
    });
    item.append(button);
    list.append(item);
  }
  diagnosticsElement.append(list);
}

function previewHtml(tab: OpenTab, score: ParsedScore): string {
  const generation = ++state.previewGeneration;
  return compileGuitarDslToHtml(tab.source, {
    locale: state.locale, pageSize: tab.pageSize, orientation: tab.orientation,
    previewUiMode: tab.previewMode, previewEditAvailable: true,
    visualBindings: score.visualSourceBindings ?? [],
    documentUri: activeIdentityLabel(tab), documentVersion: tab.revision, previewGeneration: generation,
    expandPageBreakRepeats: state.expandPageBreakRepeats,
    fontUris: { regular: regularFontUrl, bold: boldFontUrl },
    nonce: crypto.randomUUID().replace(/-/g, ''),
    progressionAudioLeaseId: progressionAudioLease.activeLeaseId,
    cspSource: `${new URL(regularFontUrl, location.href).origin} data: blob:`,
    hostBootstrapScript: WEB_PREVIEW_BRIDGE,
    hostStyle: WEB_PREVIEW_STYLE
  });
}

function renderPreview(tab: OpenTab | undefined): void {
  if (!tab) {
    scoreFrame.srcdoc = '<!doctype html><meta charset="utf-8"><p style="font:14px system-ui;padding:24px;color:#6b7280">Open a score to preview it.</p>';
    app.querySelector('#preview-state')!.textContent = 'No score';
    return;
  }
  const score = currentScore(tab.source);
  renderDiagnostics(score);
  if (!score) {
    app.querySelector('#preview-state')!.textContent = 'Unable to parse source';
    return;
  }
  app.querySelector('#preview-state')!.textContent = score.diagnostics.some(item => item.severity === 'error') ? 'Check diagnostics' : 'Preview ready';
  try { scoreFrame.srcdoc = previewHtml(tab, score); }
  catch (error) {
    app.querySelector('#preview-state')!.textContent = 'Preview failed';
    showMessage(`Preview could not be rendered: ${shortError(error)}`, 'error');
  }
}

function renderTabs(): void {
  tabsElement.replaceChildren();
  for (const tab of state.tabs) {
    const key = tabKey(tab);
    const wrapper = document.createElement('div');
    wrapper.className = `tab${key === state.activeKey ? ' active' : ''}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(key === state.activeKey));
    button.textContent = tab.document.name;
    button.title = tab.document.identity.storage === 'drive' ? `Google Drive · ${tab.document.name}` : tab.document.name;
    button.addEventListener('click', () => setActive(key));
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.setAttribute('aria-label', `${strings().closeTab} ${tab.document.name}`);
    close.textContent = '×';
    close.addEventListener('click', event => {
      event.stopPropagation();
      closeTab(tab);
    });
    wrapper.append(button, close);
    tabsElement.append(wrapper);
  }
}

function renderExplorer(): Promise<void> {
  const renderGeneration = ++explorerRenderGeneration;
  const t = strings();
  const localButton = app.querySelector<HTMLButtonElement>('#storage-local')!;
  const driveButton = app.querySelector<HTMLButtonElement>('#storage-drive')!;
  localButton.textContent = t.local;
  driveButton.textContent = t.drive;
  app.querySelector('#files-heading')!.textContent = t.files;
  localButton.classList.toggle('selected', state.activeStorage === 'local');
  driveButton.classList.toggle('selected', state.activeStorage === 'drive');
  driveScopeNote.hidden = state.activeStorage !== 'drive' || !state.account;
  driveScopeNote.textContent = t.driveAccess;
  fileActions.replaceChildren();
  fileItems.replaceChildren();

  if (state.activeStorage === 'local') {
    const add = actionButton(t.addFile, () => app.querySelector<HTMLInputElement>('#file-input')!.click());
    fileActions.append(add);
    void indexedDb.listDocuments('local').then(async documents => {
      if (renderGeneration !== explorerRenderGeneration || state.activeStorage !== 'local') return;
      if (documents.length === 0) {
        const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = t.createFirst; fileItems.append(empty); return;
      }
      for (const documentRow of documents) {
        const current = await indexedDb.getDocument(documentRow.identity);
        if (renderGeneration !== explorerRenderGeneration || state.activeStorage !== 'local') return;
        appendFileButton(fileItems, current ?? documentRow, () => void openLocalDocument(documentRow.identity));
      }
    }).catch(error => {
      if (renderGeneration !== explorerRenderGeneration || state.activeStorage !== 'local') return;
      state.storageReady = false; renderStorageStatus(strings().unavailable);
      fileItems.textContent = shortError(error);
    });
    const selected = activeTab();
    app.querySelector<HTMLButtonElement>('#move-drive')!.hidden = !selected || selected.document.identity.storage !== 'local' || !state.account || !state.folderId;
    return Promise.resolve();
  }

  app.querySelector<HTMLButtonElement>('#move-drive')!.hidden = true;
  if (!state.account || !state.drive) {
    const hint = document.createElement('div'); hint.className = 'empty-state'; hint.textContent = t.connectHint; fileItems.append(hint);
    return Promise.resolve();
  }
  const folderButton = actionButton(t.folder, () => void chooseDriveFolder());
  const createFolderButton = actionButton(t.createFolder, () => void createDriveFolder());
  const openPickerButton = actionButton(t.openDrive, () => void openFromDrivePicker());
  fileActions.append(folderButton, createFolderButton, openPickerButton);
  if (!state.folderId) {
    const hint = document.createElement('div'); hint.className = 'empty-state'; hint.textContent = t.noFolder; fileItems.append(hint);
    return Promise.resolve();
  }
  const loading = document.createElement('div'); loading.className = 'empty-state'; loading.textContent = 'Loading Drive files…'; fileItems.append(loading);
  return state.drive.listFiles(state.folderId).then(files => {
    if (renderGeneration !== explorerRenderGeneration || state.activeStorage !== 'drive' || !state.account) return;
    state.driveFiles = files;
    fileItems.replaceChildren();
    if (files.length === 0) {
      const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = t.createFirst; fileItems.append(empty);
    }
    for (const file of files) {
      const cached = document.createElement('div');
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'file-item'; button.textContent = file.name;
      button.addEventListener('click', () => void openDriveDocument(file));
      const stamp = document.createElement('span'); stamp.className = 'file-subtitle'; stamp.textContent = new Date(file.modifiedTime).toLocaleString(state.locale);
      cached.append(button, stamp); fileItems.append(cached);
    }
  }).catch(error => {
    if (renderGeneration !== explorerRenderGeneration || state.activeStorage !== 'drive') return;
    markDriveAuthState(error);
    fileItems.replaceChildren();
    const message = document.createElement('div'); message.className = 'empty-state'; message.textContent = shortError(error); fileItems.append(message);
    showMessage(shortError(error), 'error');
  });
}

function actionButton(label: string, callback: () => void): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet-button file-action';
  button.textContent = label; button.addEventListener('click', callback); return button;
}

function appendFileButton(container: HTMLElement, documentRow: StoredDocument, open: () => void): void {
  const wrapper = document.createElement('div');
  const button = document.createElement('button'); button.type = 'button'; button.className = 'file-item';
  button.textContent = documentRow.name; button.addEventListener('click', open);
  const subtitle = document.createElement('span'); subtitle.className = 'file-subtitle';
  subtitle.textContent = documentRow.updatedAt ? new Date(documentRow.updatedAt).toLocaleDateString(state.locale) : '';
  wrapper.append(button, subtitle); container.append(wrapper);
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
  const ready = resume ? await resume : false;
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
    Math.max(1, message.playback.durationSeconds * 1000 / speed + 100));
  return true;
}

function startCandidateAudition(tab: OpenTab, candidate: { chords: string[] }, candidateIndex: number): void {
  if (progressionAudioLease.activeLeaseId) {
    if (state.audioCandidateId === `${candidateIndex}:${candidate.chords.join('|')}`) void stopCandidateAudition();
    return;
  }
  const score = currentScore(tab.source);
  if (!score) return;
  const metadata = tab.source.split(/\r?\n/).filter(line =>
    /^\s*(?:title|artist|bpm|tempo|key|capo|tuning|time|feel|pickup|style_[A-Za-z0-9_]+)\s*:/i.test(line));
  const auditionSource = [...metadata, '', '[Audition]', `| ${candidate.chords.join(' | ')} |`].join('\n');
  const playback = buildProgressionAuditionPlaybackData(auditionSource, {
    startMeasure: 0, bars: candidate.chords.length, mode: 'bars', locale: state.locale
  });
  if (!playback.ok) { state.audioStatus = playback.message; renderInspector(); return; }
  const candidateId = `${candidateIndex}:${candidate.chords.join('|')}`;
  const requestId = `web-audition-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const generation = ++progressionSessionGeneration;
  const request = {
    requestId, generation, sessionUri: activeIdentityLabel(tab), sessionVersion: tab.revision,
    sessionGeneration: generation, candidateId, side: 'B' as const, mode: 'bars' as const, speed: 100 as const
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
  inspectorContent.replaceChildren();
  if (!tab) { inspectorContent.textContent = t.createFirst; return; }
  const score = currentScore(tab.source);
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
    addInspectorHeading(inspectorContent, t.variables);
    const definitions = score?.letDefinitions ?? [];
    if (!definitions.length) { addInspectorParagraph(inspectorContent, state.locale === 'ja' ? '変数定義はありません。' : 'No variable definitions.'); return; }
    const list = document.createElement('ul'); list.className = 'inspector-list';
    for (const definition of definitions) {
      const item = document.createElement('li'); item.textContent = `$${definition.name} = ${definition.value ?? ''}`; list.append(item);
    }
    inspectorContent.append(list);
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
  } else {
    addInspectorHeading(inspectorContent, t.progression);
    const button = actionButton(t.suggest, () => suggestProgression(tab)); inspectorContent.append(button);
    const scoreResult = state.lastProgression as { candidates?: Array<{ chords: string[]; romanNumerals: string[]; rationale: string }> } | undefined;
    if (scoreResult?.candidates?.length) {
      for (const [index, candidate] of scoreResult.candidates.entries()) {
        const candidateId = `${index}:${candidate.chords.join('|')}`;
        const card = document.createElement('article'); card.className = 'progression-card';
        const title = document.createElement('strong'); title.textContent = candidate.romanNumerals.join(' · ');
        const chords = document.createElement('p'); chords.textContent = candidate.chords.join(' | ');
        const rationale = document.createElement('p'); rationale.textContent = candidate.rationale;
        const audition = actionButton(progressionAudioLease.activeLeaseId && state.audioCandidateId === candidateId
          ? t.stopAudition : t.audition, () => {
          if (progressionAudioLease.activeLeaseId) void stopCandidateAudition();
          else startCandidateAudition(tab, candidate, index);
        });
        audition.disabled = Boolean(progressionAudioLease.activeLeaseId && state.audioCandidateId !== candidateId);
        const apply = actionButton(state.locale === 'ja' ? '楽譜に追加' : 'Add to score', () => appendSuggestion(tab, candidate.chords));
        apply.disabled = Boolean(progressionAudioLease.activeLeaseId);
        const actions = document.createElement('div'); actions.className = 'inspector-actions';
        actions.append(audition, apply);
        card.append(title, chords, rationale, actions); inspectorContent.append(card);
      }
    }
    const audioStatus = document.createElement('p'); audioStatus.id = 'progression-audio-status';
    audioStatus.setAttribute('role', 'status'); audioStatus.setAttribute('aria-live', 'polite');
    audioStatus.textContent = state.audioStatus; inspectorContent.append(audioStatus);
  }
}

function applySplitRatio(): void {
  if (!window.matchMedia('(min-width: 681px)').matches) return;
  (app.querySelector('.source-pane') as HTMLElement).style.flexBasis = `${state.splitRatio * 100}%`;
  (app.querySelector('.score-pane') as HTMLElement).style.flexBasis = `${(1 - state.splitRatio) * 100}%`;
  splitDivider?.setAttribute('aria-valuenow', String(Math.round(state.splitRatio * 100)));
}

let splitSaveTimer = 0;
function persistSplitRatioSoon(): void {
  window.clearTimeout(splitSaveTimer);
  splitSaveTimer = window.setTimeout(() => void savePreferences(), 300);
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

function renderAll(): void {
  const t = strings();
  renderTabs();
  renderInspector();
  void renderExplorer();
  renderStorageStatus();
  app.querySelector('#connect-drive')!.textContent = state.account ? t.disconnect : t.connect;
  app.querySelector('#new-score')!.textContent = t.newScore;
  app.querySelector('#save-document')!.textContent = t.save;
  app.querySelector('#export-file')!.textContent = t.exportFile;
  app.querySelector('#download-pdf')!.textContent = t.downloadPdf;
  app.querySelector('#mobile-source')!.textContent = t.narrowSource;
  app.querySelector('#mobile-preview')!.textContent = t.narrowPreview;
  app.querySelector('#inspector-heading')!.textContent = t.inspector;
  app.querySelector('#source-pane .pane-heading > span:first-child')!.textContent = t.source;
  app.querySelector('#score-pane .pane-heading > span:first-child')!.textContent = t.preview;
  app.querySelector('.file-list')!.setAttribute('aria-label', t.files);
  app.querySelector('.inspector')!.setAttribute('aria-label', t.inspector);
  app.querySelector('.source-pane')!.setAttribute('aria-label', state.locale === 'ja' ? 'GuitarDSL ソース' : 'GuitarDSL source');
  app.querySelector('.score-pane')!.setAttribute('aria-label', state.locale === 'ja' ? '譜面プレビュー' : 'Score preview');
  app.querySelector('main')!.setAttribute('aria-label', 'GuitarDSL');
  editor.setAttribute('aria-label', state.locale === 'ja' ? 'GuitarDSL ソースエディター' : 'GuitarDSL source editor');
  app.querySelector('#import-file')!.setAttribute('aria-label', t.addFile);
  app.querySelector('#locale-select')!.setAttribute('aria-label', t.language);
  app.querySelector('#theme-select')!.setAttribute('aria-label', t.theme);
  app.querySelector('#workspace-name')!.textContent = state.activeStorage === 'drive' ? t.drive : t.local;
  app.querySelector('#source-pane')!.classList.toggle('mobile-hidden', state.mobilePane !== 'source');
  app.querySelector('#score-pane')!.classList.toggle('mobile-hidden', state.mobilePane !== 'preview');
  const tab = activeTab();
  if (tab) {
    editor.value = tab.source;
    app.querySelector('#saved-state')!.textContent = state.storageReady ? t.saved : t.unavailable;
    app.querySelector<HTMLButtonElement>('#move-drive')!.hidden = tab.document.identity.storage !== 'local' || !state.account || !state.folderId;
    renderPreview(tab);
  } else {
    editor.value = '';
    renderPreview(undefined);
    app.querySelector<HTMLButtonElement>('#move-drive')!.hidden = true;
  }
  app.dataset.theme = state.theme;
  app.querySelector('#connect-drive')!.textContent = state.authExpired ? (state.locale === 'ja' ? 'Drive に再接続' : 'Reconnect Drive') : state.account ? t.disconnect : t.connect;
  applySplitRatio();
}

async function openDocument(documentRow: StoredDocument, source = documentRow.source, accountId?: string, persistable = true): Promise<OpenTab> {
  const match = state.tabs.find(tab => sameTabIdentity(tab, documentRow.identity, accountId));
  if (match) { await setActive(tabKey(match)); return match; }
  const tab: OpenTab = {
    document: documentRow, source, revision: documentRow.revision, accountId, persistable,
    previewMode: 'normal', pageSize: state.pageSize, orientation: state.orientation
  };
  if (progressionAudioLease.activeSessionUri) await stopCandidateAudition();
  state.tabs.push(tab);
  state.activeKey = tabKey(tab);
  state.activeStorage = tab.document.identity.storage;
  renderAll();
  void persistSessions();
  return tab;
}

async function openLocalDocument(identity: DocumentIdentity): Promise<void> {
  try {
    const documentRow = await indexedDb.getDocument(identity);
    if (!documentRow) throw new DOMException('Document was deleted', 'NotFoundError');
    await openDocument(documentRow, documentRow.source);
  } catch (error) { showMessage(shortError(error), 'error'); }
}

async function closeTab(tab: OpenTab): Promise<void> {
  const key = tabKey(tab);
  const index = state.tabs.indexOf(tab);
  if (index < 0) return;
  if (progressionAudioLease.activeSessionUri === activeIdentityLabel(tab)) await stopCandidateAudition();
  await saveDraftNow(tab);
  state.tabs.splice(index, 1);
  if (state.activeKey === key) {
    const next = state.tabs[Math.max(0, index - 1)] ?? state.tabs[0];
    state.activeKey = next ? tabKey(next) : null;
  }
  renderAll();
  await persistSessions();
}

async function saveDraftNow(tab: OpenTab): Promise<void> {
  if (!tab.persistable || !state.storageReady) return;
  try {
    await draftWrites.get(tabKey(tab));
    const saved = await indexedDb.saveDraft(snapshot(tab), tab.accountId);
    if (!saved) throw new DOMException('A newer edit exists in another tab', 'InvalidStateError');
  }
  catch (error) { showMessage(shortError(error), 'error'); }
}

function onEditorInput(): void {
  const tab = activeTab();
  if (!tab) return;
  if (progressionAudioLease.activeSessionUri === activeIdentityLabel(tab)) void stopCandidateAudition();
  tab.source = editor.value;
  tab.revision += 1;
  scheduleDraft(tab);
  const score = currentScore(tab.source);
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
  const tab = activeTab();
  if (!tab) return;
  if (!tab.persistable || !state.storageReady) { showMessage(strings().unavailable, 'error'); return; }
  await saveDraftNow(tab);
  if (tab.document.identity.storage === 'local') {
    try {
      const saved = await indexedDb.commitLocal(snapshot(tab));
      if (!saved) throw new DOMException('A newer edit exists in another tab', 'InvalidStateError');
      tab.document = saved;
      app.querySelector('#saved-state')!.textContent = strings().saved;
      showMessage(strings().saved);
      void renderExplorer();
    } catch (error) { showMessage(shortError(error), 'error'); }
    return;
  }
  await saveDriveDocument(tab);
}

async function saveDriveDocument(tab: OpenTab): Promise<void> {
  if (!state.drive || !state.account) { showMessage(strings().connectHint, 'error'); return; }
  const file: DriveFile = {
    id: tab.document.identity.fileId, name: tab.document.name,
    version: tab.document.driveVersion ?? '', modifiedTime: tab.document.driveModifiedTime ?? '',
    headRevisionId: tab.document.driveRevisionId,
    ...(tab.document.driveFolderId ? { parents: [tab.document.driveFolderId] } : {})
  };
  try {
    const result = await state.drive.updateFile(file, tab.source, tab.document.driveEtag);
    if (result.kind === 'conflict') {
      await handleDriveConflict(tab, result.latest);
      return;
    }
    if (result.kind === 'unavailable') { showMessage(result.message, 'error'); return; }
    const verified = await state.drive.getFile(result.file.id);
    if (verified.source !== tab.source) throw new Error('Drive did not return the saved source; the local draft was kept.');
    const updated: StoredDocument = {
      ...tab.document, source: verified.source, revision: tab.revision,
      driveVersion: verified.file.version, driveModifiedTime: verified.file.modifiedTime,
      driveRevisionId: verified.file.headRevisionId,
      driveEtag: verified.etag, updatedAt: Date.now()
    };
    const committed = await indexedDb.commitDriveDocument(updated, snapshot(tab));
    if (!committed) throw new DOMException('A newer local draft exists; the Drive copy was saved but the local draft was kept.', 'InvalidStateError');
    tab.document = updated;
    app.querySelector('#saved-state')!.textContent = state.locale === 'ja' ? 'Drive に保存済み' : 'Saved to Drive';
    showMessage(state.locale === 'ja' ? 'Drive に保存しました。' : 'Saved to Google Drive.');
    void renderExplorer();
  } catch (error) { markDriveAuthState(error); showMessage(shortError(error), 'error'); }
}

async function handleDriveConflict(tab: OpenTab, latest: DriveFile): Promise<void> {
  const choice = await conflictDialog();
  if (choice === 'cancel') return;
  if (!state.drive || !state.account) return;
  if (choice === 'reload') {
    try {
      const remote = await state.drive.getFile(latest.id);
      const updated: StoredDocument = {
        ...tab.document, name: remote.file.name, source: remote.source,
        revision: tab.revision + 1, driveVersion: remote.file.version,
        driveRevisionId: remote.file.headRevisionId,
        driveModifiedTime: remote.file.modifiedTime, driveEtag: remote.etag,
        driveFolderId: remote.file.parents?.[0] ?? tab.document.driveFolderId, updatedAt: Date.now()
      };
      const committed = await indexedDb.commitDriveDocument(updated, {
        identity: tab.document.identity, revision: updated.revision, source: remote.source
      });
      if (!committed) throw new Error('A newer local draft exists. It was kept.');
      tab.document = updated; tab.source = remote.source; tab.revision = updated.revision;
      editor.value = tab.source; renderAll();
      showMessage(state.locale === 'ja' ? 'Drive の最新内容を読み込みました。' : 'Reloaded the latest Drive version.');
    } catch (error) { showMessage(shortError(error), 'error'); }
    return;
  }
  try { await saveDriveCopy(tab, latest.parents?.[0] ?? tab.document.driveFolderId ?? state.folderId); }
  catch (error) { showMessage(shortError(error), 'error'); }
}

function conflictDialog(): Promise<'reload' | 'save-as' | 'cancel'> {
  const t = strings();
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'conflict-dialog';
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

async function saveDriveCopy(tab: OpenTab, folderId?: string): Promise<void> {
  if (!state.drive || !state.account || !folderId) throw new Error(strings().noFolder);
  const copyName = `${tab.document.name.replace(/\.(guitardsl|gdsl)$/i, '')} (local copy).guitardsl`;
  const file = await state.drive.createFile(folderId, copyName, tab.source);
  const verified = await state.drive.getFile(file.id);
  if (verified.source !== tab.source) throw new Error('Drive copy verification failed; the original draft was kept.');
  const doc: StoredDocument = {
    identity: driveIdentity(file.id), accountId: state.account.accountId, name: file.name,
    source: verified.source, revision: tab.revision, createdAt: Date.now(), updatedAt: Date.now(),
    driveVersion: verified.file.version, driveModifiedTime: verified.file.modifiedTime, driveRevisionId: verified.file.headRevisionId,
    driveEtag: verified.etag, driveFolderId: verified.file.parents?.[0] ?? folderId
  };
  await indexedDb.upsertDriveDocument(doc);
  const currentIndex = state.tabs.indexOf(tab);
  const existing = state.tabs.find(other => sameTabIdentity(other, doc.identity, state.account!.accountId));
  if (existing) {
    existing.source = tab.source; existing.revision = tab.revision; existing.document = doc; state.tabs.splice(currentIndex, 1); state.activeKey = tabKey(existing);
  } else {
    tab.document = doc; tab.accountId = state.account.accountId; tab.source = verified.source; state.activeKey = tabKey(tab);
  }
  renderAll(); await persistSessions();
  showMessage(state.locale === 'ja' ? 'ローカル版を別の Drive ファイルとして保存しました。' : 'Saved the local version as a new Drive file.');
}

async function downloadPdf(tab = activeTab()): Promise<void> {
  if (!tab) return;
  try {
    const { renderPdfBytes } = await import('@guitardsl/pdf');
    const regular = new Uint8Array(await (await fetch(regularFontUrl)).arrayBuffer());
    const bold = new Uint8Array(await (await fetch(boldFontUrl)).arrayBuffer());
    const bytes = await renderPdfBytes(tab.source, {
      pageSize: tab.pageSize, orientation: tab.orientation, expandPageBreakRepeats: state.expandPageBreakRepeats
    }, { regular, bold });
    const pdfBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blobUrl = URL.createObjectURL(new Blob([pdfBuffer], { type: 'application/pdf' }));
    const link = document.createElement('a'); link.href = blobUrl;
    link.download = `${tab.document.name.replace(/\.(guitardsl|gdsl)$/i, '') || 'score'}.pdf`;
    link.click(); window.setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
  } catch (error) { showMessage(`PDF export failed: ${shortError(error)}`, 'error'); }
}

async function renameLocal(tab: OpenTab, name: string): Promise<void> {
  try {
    await indexedDb.renameLocal(tab.document.identity, name);
    tab.document = { ...tab.document, name };
    renderAll(); await persistSessions();
  } catch (error) { showMessage(shortError(error), 'error'); }
}

async function deleteLocal(tab: OpenTab): Promise<void> {
  if (!window.confirm(strings().confirmDelete)) return;
  try {
    await indexedDb.deleteDocument(tab.document.identity);
    await closeTab(tab);
    await renderExplorer();
  } catch (error) { showMessage(shortError(error), 'error'); }
}

async function createNewScore(): Promise<void> {
  const name = window.prompt(state.locale === 'ja' ? 'ファイル名' : 'File name', 'Untitled.guitardsl') ?? 'Untitled.guitardsl';
  try {
    const documentRow = await indexedDb.createLocal(name, DEFAULT_SOURCE);
    state.storageReady = true;
    await openDocument(documentRow);
    showMessage(state.locale === 'ja' ? 'ローカル楽譜を作成しました。' : 'Created a local score.');
  } catch (error) {
    state.storageReady = false;
    const documentRow: StoredDocument = { identity: { storage: 'local', fileId: crypto.randomUUID() }, name: name || 'Untitled.guitardsl', source: DEFAULT_SOURCE, revision: 0, createdAt: Date.now(), updatedAt: Date.now() };
    const tab: OpenTab = { document: documentRow, source: DEFAULT_SOURCE, revision: 0, previewMode: 'normal', pageSize: state.pageSize, orientation: state.orientation, persistable: false };
    state.tabs.push(tab); state.activeKey = tabKey(tab); renderAll();
    showMessage(`${strings().unavailable} ${shortError(error)}`, 'error');
  }
}

async function importFile(file?: File): Promise<void> {
  if (!file) return;
  try {
    const documentRow = await importLocalFile(file);
    state.storageReady = true; await openDocument(documentRow); showMessage(state.locale === 'ja' ? 'ファイルを読み込みました。' : 'Imported the GuitarDSL file.');
  } catch (error) { showMessage(shortError(error), 'error'); }
}

async function connectDrive(): Promise<void> {
  if (state.account && !state.authExpired) {
    await persistSessions();
    try { await auth.disconnect(); } catch { /* local drafts and tabs remain intact */ }
    state.account = undefined; state.drive = undefined; state.folderId = undefined; state.driveFiles = [];
    renderAll(); await persistSessions(); return;
  }
  try {
    const previousAccount = state.account;
    const account = await auth.connect();
    if (previousAccount && previousAccount.accountId !== account.accountId
      || !previousAccount && state.tabs.some(tab => tab.document.identity.storage === 'drive' && tab.accountId !== account.accountId)) {
      await persistSessions();
      state.tabs = state.tabs.filter(tab => tab.document.identity.storage !== 'drive' || tab.accountId === account.accountId);
      const localActive = state.tabs.find(tab => tab.document.identity.storage === 'local');
      if (!state.tabs.some(tab => tabKey(tab) === state.activeKey)) state.activeKey = localActive ? tabKey(localActive) : null;
      state.folderId = undefined; state.driveFiles = [];
    }
    state.account = account; state.drive = new GoogleDriveApi(auth);
    state.authExpired = false;
    const folderId = await indexedDb.getValue<string>('settings', `drive-folder:${account.accountId}`).catch(() => undefined);
    if (folderId) {
      try {
        const folder = await state.drive.getFolder(folderId) as DriveFile & { trashed?: boolean };
        if (folder.mimeType === 'application/vnd.google-apps.folder' && !folder.trashed) state.folderId = folderId;
        else await indexedDb.setValue('settings', `drive-folder:${account.accountId}`, undefined);
      } catch { state.folderId = undefined; }
    }
    await restoreDriveSession(account.accountId);
    renderAll();
    if (state.activeStorage === 'drive') await renderExplorer();
    showMessage(account.emailAddress ? `Connected to Google Drive (${account.emailAddress}).` : 'Connected to Google Drive.');
  } catch (error) { markDriveAuthState(error); showMessage(shortError(error), 'error'); }
}

async function chooseDriveFolder(): Promise<void> {
  if (!state.drive || !state.account) return;
  try {
    const selected = await state.drive.pickFolder();
    if (!selected) return;
    const folder = await state.drive.getFolder(selected.id) as DriveFile & { trashed?: boolean };
    if (folder.mimeType !== 'application/vnd.google-apps.folder' || folder.trashed) throw new Error('Choose an available Google Drive folder.');
    state.folderId = folder.id;
    await indexedDb.setValue('settings', `drive-folder:${state.account.accountId}`, folder.id);
    await restoreDriveSession(state.account.accountId);
    await renderExplorer(); showMessage(state.locale === 'ja' ? `保存先: ${folder.name}` : `Drive folder: ${folder.name}`);
  } catch (error) { markDriveAuthState(error); showMessage(shortError(error), 'error'); }
}

async function createDriveFolder(): Promise<void> {
  if (!state.drive || !state.account) return;
  try {
    const folder = await state.drive.createFolder();
    state.folderId = folder.id;
    await indexedDb.setValue('settings', `drive-folder:${state.account.accountId}`, folder.id);
    await renderExplorer(); showMessage(state.locale === 'ja' ? 'GuitarDSL フォルダーを作成しました。' : 'Created the GuitarDSL folder.');
  } catch (error) { markDriveAuthState(error); showMessage(shortError(error), 'error'); }
}

async function openFromDrivePicker(): Promise<void> {
  if (!state.drive || !state.account) return;
  try {
    const selection = await state.drive.pickFile();
    if (!selection) return;
    if (!isSupportedDriveFile(selection.name)) throw new Error('Choose a .guitardsl or .gdsl file.');
    const downloaded = await state.drive.getFile(selection.id);
    const doc: StoredDocument = {
      identity: driveIdentity(downloaded.file.id), accountId: state.account.accountId,
      name: downloaded.file.name, source: downloaded.source, revision: 0, createdAt: Date.now(), updatedAt: Date.now(),
      driveVersion: downloaded.file.version, driveModifiedTime: downloaded.file.modifiedTime, driveRevisionId: downloaded.file.headRevisionId, driveEtag: downloaded.etag,
      driveFolderId: downloaded.file.parents?.[0] ?? state.folderId
    };
    await indexedDb.upsertDriveDocument(doc); await openDocument(doc, doc.source, state.account.accountId);
  } catch (error) { markDriveAuthState(error); showMessage(shortError(error), 'error'); }
}

async function openDriveDocument(file: DriveFile): Promise<void> {
  if (!state.drive || !state.account) return;
  const identity = driveIdentity(file.id);
  const open = state.tabs.find(tab => sameTabIdentity(tab, identity, state.account!.accountId));
  if (open) { setActive(tabKey(open)); return; }
  try {
    const [saved, draft, latest] = await Promise.all([
      indexedDb.getSavedDocument(identity, state.account.accountId),
      indexedDb.getDraft(identity, state.account.accountId),
      state.drive.getFile(file.id)
    ]);
    if (draft && saved && (saved.driveVersion !== latest.file.version || saved.driveModifiedTime !== latest.file.modifiedTime
      || saved.driveRevisionId !== latest.file.headRevisionId)) {
      const choice = await conflictDialog();
      if (choice === 'cancel') return;
      if (choice === 'save-as') {
        const oldDoc = { ...saved, source: draft.source, revision: draft.revision };
        const opened = await openDocument(oldDoc, draft.source, state.account.accountId);
        await saveDriveCopy(opened, latest.file.parents?.[0] ?? state.folderId);
        return;
      }
      const refreshed: StoredDocument = {
        ...saved, source: latest.source, revision: Math.max(saved.revision, draft.revision) + 1,
        driveVersion: latest.file.version, driveModifiedTime: latest.file.modifiedTime, driveEtag: latest.etag,
        driveRevisionId: latest.file.headRevisionId,
        driveFolderId: latest.file.parents?.[0] ?? state.folderId, updatedAt: Date.now()
      };
      const committed = await indexedDb.commitDriveDocument(refreshed, { identity, revision: refreshed.revision, source: latest.source });
      if (!committed) throw new Error('A newer local draft exists; it was kept.');
      await openDocument(refreshed, refreshed.source, state.account.accountId); return;
    }
    let documentRow: StoredDocument;
    let source: string;
    if (saved && draft) { documentRow = { ...saved, accountId: state.account.accountId }; source = draft.source; documentRow.revision = draft.revision; }
    else {
      documentRow = {
        identity, accountId: state.account.accountId, name: latest.file.name, source: latest.source,
        revision: saved ? saved.revision + Number(saved.source !== latest.source) : 0,
        createdAt: saved?.createdAt ?? Date.now(), updatedAt: Date.now(), driveVersion: latest.file.version,
        driveModifiedTime: latest.file.modifiedTime, driveRevisionId: latest.file.headRevisionId, driveEtag: latest.etag,
        driveFolderId: latest.file.parents?.[0] ?? state.folderId
      };
      source = latest.source;
      await indexedDb.upsertDriveDocument(documentRow);
    }
    await openDocument(documentRow, source, state.account.accountId);
  } catch (error) { markDriveAuthState(error); showMessage(shortError(error), 'error'); }
}

async function restoreDriveSession(accountId: string): Promise<void> {
  if (!state.storageReady) return;
  try {
    const session = await indexedDb.getValue<WorkspaceSession>('sessions', `workspace-drive:${accountId}`);
    if (!session) return;
    for (const fileId of session.tabs) {
      const identity = driveIdentity(fileId);
      const documentRow = await indexedDb.getDocument(identity, accountId);
      if (documentRow) await openDocument(documentRow, documentRow.source, accountId);
    }
    if (session.active) {
      const tab = state.tabs.find(item => item.document.identity.storage === 'drive' && item.document.identity.fileId === session.active && item.accountId === accountId);
      if (tab) state.activeKey = tabKey(tab);
    }
  } catch (error) { markDriveAuthState(error); showMessage(shortError(error), 'error'); }
}

async function moveToDrive(): Promise<void> {
  const tab = activeTab();
  if (!tab || tab.document.identity.storage !== 'local' || !state.drive || !state.account || !state.folderId) return;
  try {
    await saveDraftNow(tab);
    const remote = await moveLocalDocumentToDrive(snapshot(tab), tab.document.name, state.folderId, state.account.accountId, state.drive);
    const replacement: OpenTab = { ...tab, document: remote, source: remote.source, revision: 0, accountId: state.account.accountId };
    const existing = state.tabs.find(other => other !== tab && sameTabIdentity(other, remote.identity, state.account!.accountId));
    if (existing) { state.tabs.splice(state.tabs.indexOf(tab), 1); existing.document = remote; existing.source = remote.source; state.activeKey = tabKey(existing); }
    else { state.tabs[state.tabs.indexOf(tab)] = replacement; state.activeKey = tabKey(replacement); }
    renderAll(); await persistSessions();
    showMessage(state.locale === 'ja' ? 'Drive への移動が完了しました。' : 'Moved the score to Google Drive.');
  } catch (error) {
    if (error instanceof MoveRecoveryError) showMessage(state.locale === 'ja'
      ? 'Drive 側のコピーは検証済みですが、ローカル原本は残っています。もう一度「Drive に移動」を選ぶと、重複作成せずに完了できます。'
      : 'The Drive copy is verified and the local original remains. Retry Move to Drive to finish without creating a duplicate.', 'error');
    else { markDriveAuthState(error); showMessage(shortError(error), 'error'); }
  }
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
  app.querySelector<HTMLSelectElement>('#locale-select')!.value = state.locale;
  app.querySelector<HTMLSelectElement>('#theme-select')!.value = state.theme;
}

async function restoreLocalSession(): Promise<void> {
  const session = await indexedDb.getValue<WorkspaceSession>('sessions', 'workspace-local').catch(() => undefined);
  if (session?.tabs.length) {
    for (const fileId of session.tabs) {
      const row = await indexedDb.getDocument({ storage: 'local', fileId });
      if (row) await openDocument(row, row.source);
    }
    const selected = session.active && state.tabs.find(tab => tab.document.identity.storage === 'local' && tab.document.identity.fileId === session.active);
    if (selected) state.activeKey = tabKey(selected);
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

async function suggestProgression(tab: OpenTab): Promise<void> {
  const score = currentScore(tab.source);
  if (!score) return;
  const result = suggestNextChords(score, { startMeasure: score.measures.length });
  state.lastProgression = result.ok ? result : undefined;
  if (!result.ok) showMessage(strings().noSuggestions, 'info');
  renderInspector();
}

function appendSuggestion(tab: OpenTab, chords: string[]): void {
  const sectionName = state.locale === 'ja' ? 'Next' : 'Next';
  const source = `${tab.source.trimEnd()}\n\n[${sectionName}]\n${chords.join(' | ')} |\n`;
  editor.value = source;
  if (activeTab() === tab) onEditorInput();
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

function handlePreviewMessage(event: MessageEvent): void {
  const tab = activeTab();
  if (!tab || event.source !== scoreFrame.contentWindow) return;
  const envelope = event.data as { channel?: string; message?: Record<string, unknown> } | undefined;
  if (envelope?.channel !== 'guitardsl-preview' || !envelope.message) return;
  const message = envelope.message;
  if (message.command === 'progressionAudioPreviewStopped' && typeof message.leaseId === 'string') {
    progressionAudioLease.acknowledgePreviewStopped(message.leaseId);
    return;
  }
  const postToFrame = (payload: Record<string, unknown>) => scoreFrame.contentWindow?.postMessage(payload, '*');
  const isCurrent = message.documentUri === activeIdentityLabel(tab)
    && message.documentVersion === tab.revision && message.previewGeneration === state.previewGeneration;
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
    const score = currentScore(tab.source);
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
    const binding = currentScore(tab.source)?.visualSourceBindings?.find(item => item.id === id);
    if (!binding) return;
    const lines = editor.value.split('\n');
    const offset = lines.slice(0, binding.line).reduce((total, line) => total + line.length + 1, 0) + binding.startCol;
    editor.focus(); editor.setSelectionRange(offset, Math.min(editor.value.length, offset + Math.max(1, binding.endCol - binding.startCol)));
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
  if (message.command === 'editChord') { state.inspectorTab = 'variables'; renderInspector(); return; }
  if (message.command === 'temporarySettingsChanged') showMessage(state.locale === 'ja' ? '一時的な楽譜変換はソースで編集してください。' : 'Edit the source to change score transformations.', 'info');
}

function replaceEditorSourceWithUndo(source: string): void {
  const oldSelection = { start: editor.selectionStart, end: editor.selectionEnd };
  editor.focus();
  let replaced = false;
  try {
    document.execCommand('selectAll');
    replaced = document.execCommand('insertText', false, source);
  } catch { replaced = false; }
  if (!replaced) editor.value = source;
  if (activeTab()) onEditorInput();
  if (replaced) editor.setSelectionRange(Math.min(oldSelection.start, source.length), Math.min(oldSelection.end, source.length));
}

editor.addEventListener('input', onEditorInput);
app.querySelector('#new-score')!.addEventListener('click', () => void createNewScore());
app.querySelector('#save-document')!.addEventListener('click', () => void saveActiveDocument());
app.querySelector('#download-pdf')!.addEventListener('click', () => void downloadPdf());
app.querySelector('#export-file')!.addEventListener('click', () => { const tab = activeTab(); if (tab) downloadSource(tab.document.name, tab.source); });
app.querySelector('#move-drive')!.addEventListener('click', () => void moveToDrive());
app.querySelector('#connect-drive')!.addEventListener('click', () => void connectDrive());
app.querySelector('#file-input')!.addEventListener('change', event => {
  const input = event.currentTarget as HTMLInputElement; void importFile(input.files?.[0]); input.value = '';
});
app.querySelector('#import-file')!.addEventListener('click', () => app.querySelector<HTMLInputElement>('#file-input')!.click());
app.querySelector('#storage-local')!.addEventListener('click', () => { state.activeStorage = 'local'; void renderExplorer(); });
app.querySelector('#storage-drive')!.addEventListener('click', () => { state.activeStorage = 'drive'; void renderExplorer(); });
app.querySelector('#mobile-source')!.addEventListener('click', () => { state.mobilePane = 'source'; renderAll(); });
app.querySelector('#mobile-preview')!.addEventListener('click', () => { state.mobilePane = 'preview'; renderAll(); });
app.querySelector('#locale-select')!.addEventListener('change', event => {
  state.locale = (event.currentTarget as HTMLSelectElement).value as 'en' | 'ja'; void savePreferences(); renderAll();
});
app.querySelector('#theme-select')!.addEventListener('change', event => {
  state.theme = (event.currentTarget as HTMLSelectElement).value as AppState['theme']; void savePreferences(); renderAll();
});
app.querySelector('#collapse-inspector')!.addEventListener('click', () => app.querySelector('.workspace')!.classList.toggle('inspector-collapsed'));
app.querySelector('#inspector-tabs-host')!.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-inspector-tab]');
  if (button && button.dataset.inspectorTab) {
    const nextTab = button.dataset.inspectorTab as InspectorTab;
    if (nextTab !== 'progression' && progressionAudioLease.activeLeaseId) void stopCandidateAudition();
    state.inspectorTab = nextTab; renderInspector();
  }
});
const splitDivider = app.querySelector<HTMLDivElement>('.split-divider')!;
const splitView = app.querySelector<HTMLDivElement>('.split-view')!;
let splitPointer: number | undefined;
function updateSplitRatio(clientX: number): void {
  const bounds = splitView.getBoundingClientRect();
  if (bounds.width <= 0) return;
  state.splitRatio = Math.max(0.25, Math.min(0.75, (clientX - bounds.left) / bounds.width));
  applySplitRatio(); persistSplitRatioSoon();
}
splitDivider.addEventListener('pointerdown', event => {
  if (window.matchMedia('(max-width: 680px)').matches) return;
  splitPointer = event.pointerId; splitDivider.setPointerCapture(event.pointerId); event.preventDefault();
});
splitDivider.addEventListener('pointermove', event => { if (splitPointer === event.pointerId) updateSplitRatio(event.clientX); });
splitDivider.addEventListener('pointerup', event => { if (splitPointer === event.pointerId) splitPointer = undefined; });
splitDivider.addEventListener('pointercancel', () => { splitPointer = undefined; });
splitDivider.addEventListener('keydown', event => {
  const delta = event.key === 'ArrowLeft' ? -0.03 : event.key === 'ArrowRight' ? 0.03 : 0;
  if (delta) { event.preventDefault(); state.splitRatio = Math.max(0.25, Math.min(0.75, state.splitRatio + delta)); applySplitRatio(); persistSplitRatioSoon(); }
});
window.addEventListener('resize', applySplitRatio);
window.addEventListener('message', handlePreviewMessage);
window.addEventListener('beforeunload', () => {
  progressionAudioLease.dispose();
  for (const tab of state.tabs) void saveDraftNow(tab);
});

async function init(): Promise<void> {
  try {
    await loadPreferences();
    state.storageReady = true;
    await restoreLocalSession();
  } catch (error) {
    state.storageReady = false;
    const doc: StoredDocument = { identity: { storage: 'local', fileId: crypto.randomUUID() }, name: 'Untitled.guitardsl', source: DEFAULT_SOURCE, revision: 0, createdAt: Date.now(), updatedAt: Date.now() };
    await openDocument(doc, doc.source, undefined, false);
    showMessage(`${strings().unavailable} ${shortError(error)}`, 'error');
  }
  renderAll();
}

void init();
