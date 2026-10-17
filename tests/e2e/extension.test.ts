import * as assert from 'assert';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { activateInspectorControlWithKeyboard, capturePreviewWebviewScreenshot, captureWorkbenchScreenshot, clickPreviewElement, dispatchPreviewKeyboardKey, evaluateInspectorWebview, evaluatePreviewWebview, inspectWorkbenchLayout, resetWorkbenchViewport, resizeActiveEditorGroupToWidth, scrollInspectorToControls, setWorkbenchViewportWidth, waitForPreviewDocument, waitForPreviewIdentity } from './screenshotCapture';
import { getWorkbenchFocusTrace, isDocumentActiveInColumn, recordFocusTrace, showAndFocusDocument } from './workbenchFocus';
import { captureWorkbenchSnapshot, matchesWorkbenchSnapshot, restoreWorkbenchSnapshot, withWorkbenchSnapshotRestored } from './workbenchState';

const settle = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

if (process.env.GUITARDSL_E2E_NATIVE_CAPO_CAPTURE === '1') {
  suite('Native Capo menu evidence capture', () => {
    test('captures the open native Capo menu and restores focus with Escape', async function () {
      this.timeout(90000);
      assert.strictEqual(process.platform, 'darwin', 'native menu screenshots require macOS');
      const outputDir = process.env.GUITARDSL_E2E_NATIVE_CAPO_OUTPUT_DIR;
      assert.ok(outputDir, 'native menu evidence output directory is required');
      const { execFileSync } = require('child_process') as typeof import('child_process');
      const { mkdirSync } = require('fs') as typeof import('fs');
      const dispatchNativeKey = (keyCode: number): void => {
        try {
          execFileSync('/usr/bin/osascript', [
            '-e',
            `tell application "System Events"\n  tell (first process whose frontmost is true)\n    key code ${keyCode}\n  end tell\nend tell`
          ], { stdio: 'pipe', timeout: 10000 });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          console.error(`Native Capo keyboard input is unavailable; report keyboard selection as NOT RUN. ${detail}`);
          this.skip();
        }
      };
      mkdirSync(outputDir, { recursive: true });
      const captureHostWindow = (windowId: string, outputPath: string): void => {
        execFileSync('screencapture', ['-x', '-l', windowId, outputPath]);
      };

      const source = 'bpm: 120\ncapo: 0\n| C | G | Am | F |\n';
      const doc = await vscode.workspace.openTextDocument({
        language: 'guitardsl',
        content: source
      });
      await showAndFocus(doc);
      await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
      await waitForPreviewDocument();
      const preview = require('../../previewCapo').previewLifecycleProbe as {
        generation: number;
        currentDocumentUri?: string;
      };

      const locale = (process.env.GUITARDSL_E2E_LOCALE ?? vscode.env.language).toLowerCase().split('-')[0];
      const theme = process.env.GUITARDSL_E2E_THEME ?? 'Default Dark Modern';
      assert.ok(vscode.env.language.toLowerCase().startsWith(locale), 'host locale matches the requested language');
      await vscode.workspace.getConfiguration('workbench').update('colorTheme', theme, vscode.ConfigurationTarget.Global);
      const initialParts = JSON.parse(await inspectWorkbenchLayout()).parts as {
        sidebar: { visible: boolean };
        auxiliarybar: { visible: boolean };
      };
      if (initialParts.sidebar.visible) await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
      if (initialParts.auxiliarybar.visible) await vscode.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
      await settle(250);
      const windowIdSource = `
        import CoreGraphics
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        for window in windows {
          let owner = window[kCGWindowOwnerName as String] as? String ?? ""
          let title = window[kCGWindowName as String] as? String ?? ""
          if owner.contains("Code") && (title.localizedCaseInsensitiveContains("Extension Development Host") || title.contains("拡張機能開発ホスト")) {
            if let windowId = window[kCGWindowNumber as String] { print(windowId); break }
          }
        }
      `;
      const windowId = execFileSync('/usr/bin/swift', ['-e', windowIdSource], {
        encoding: 'utf8',
        timeout: 20000,
        env: { ...process.env, CLANG_MODULE_CACHE_PATH: path.join(os.tmpdir(), 'issue145-swift-module-cache') }
      }).trim();
      assert.match(windowId, /^\d+$/, 'the Extension Development Host window ID is discoverable for window-only screenshots');

      try {
        for (const width of [421, 600, 840, 1100]) {
          if (width === 1100) await setWorkbenchViewportWidth(2200);
          await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
          await resizeActiveEditorGroupToWidth(width);
          await settle(200);
          const measuredWidth = await evaluatePreviewWebview<number>('window.innerWidth');
          assert.strictEqual(measuredWidth, width, `native menu screenshot uses ${width} Preview CSS px`);

          await evaluatePreviewWebview<void>(`document.getElementById('preview-capo-select').focus()`);
          dispatchNativeKey(49); // Space opens the native menu from the focused select.
          await settle(200);
          const keyboardOpenLabelsMatch = await evaluatePreviewWebview<boolean>(`Array.from(
            document.getElementById('preview-capo-select').options
          ).filter(option => option.value !== '').every(option => option.textContent === option.dataset.openLabel)`);
          assert.strictEqual(keyboardOpenLabelsMatch, true,
            `${width}px Space exposes full candidate details before the native menu opens`);
          const outputPath = path.join(outputDir, `issue145-native-capo-${locale}-${width}.png`);
          captureHostWindow(windowId, outputPath);
          assert.ok((await fs.stat(outputPath)).size > 10000, `OS screenshot was written for ${width}px`);
          const originalValue = await evaluatePreviewWebview<string>(
            `document.getElementById('preview-capo-select').value`
          );
          dispatchNativeKey(125); // ArrowDown highlights the next enabled option in the open AppKit menu.
          dispatchNativeKey(53); // Escape cancels that pending selection.
          await settle(100);
          const cancelledValue = await evaluatePreviewWebview<string>(
            `document.getElementById('preview-capo-select').value`
          );
          const nativeSelectHasFocus = await evaluatePreviewWebview<boolean>(
            `document.activeElement?.id === 'preview-capo-select'`
          );
          assert.strictEqual(cancelledValue, originalValue, `${width}px native Escape cancels the highlighted Capo`);
          assert.strictEqual(nativeSelectHasFocus, true, `${width}px native Escape returns focus to the Capo select`);

          if (width === 421 || width === 1100) {
            const next = JSON.parse(await evaluatePreviewWebview<string>(`JSON.stringify((() => {
              const select = document.getElementById('preview-capo-select');
              const candidates = Array.from(select.options).filter(option => option.value !== '' && !option.disabled);
              const index = candidates.findIndex(option => option.value === select.value);
              return candidates.find((option, candidateIndex) => candidateIndex > index)?.value ?? candidates[0]?.value;
            })())`)) as string;
            assert.ok(next && next !== originalValue, `${width}px has a different supported capo to select`);
            const beforeSelection = preview.generation;
            await evaluatePreviewWebview<void>(`document.getElementById('preview-capo-select').focus()`);
            dispatchNativeKey(49); // Space opens the native menu from the focused select.
            await settle(200);
            const keyboardOpenLabelsMatch = await evaluatePreviewWebview<boolean>(`Array.from(
              document.getElementById('preview-capo-select').options
            ).filter(option => option.value !== '').every(option => option.textContent === option.dataset.openLabel)`);
            assert.strictEqual(keyboardOpenLabelsMatch, true,
              `${width}px Space exposes full candidate details before the native menu opens`);
            const keyboardMenuPath = path.join(outputDir, `issue145-native-capo-keyboard-${locale}-${width}-open.png`);
            captureHostWindow(windowId, keyboardMenuPath);
            dispatchNativeKey(125); // ArrowDown in the actual native menu.
            const downPath = path.join(outputDir, `issue145-native-capo-keyboard-${locale}-${width}-down.png`);
            captureHostWindow(windowId, downPath);
            dispatchNativeKey(36); // Return commits the highlighted option.
            for (let attempt = 0; attempt < 100 && preview.generation === beforeSelection; attempt++) await settle(20);
            const selectedValue = await evaluatePreviewWebview<string>(
              `document.getElementById('preview-capo-select').value`
            );
            assert.strictEqual(preview.generation, beforeSelection + 1,
              `${width}px native keyboard selection rebuilds Preview exactly once (value=${selectedValue}, expected=${next})`);
            await waitForPreviewDocument();
            assert.strictEqual(selectedValue, next, `${width}px ArrowDown + Return selects the next supported Capo`);
            assert.strictEqual(doc.getText(), source, `${width}px keyboard selection leaves source DSL unchanged`);
            const themeTag = theme.toLowerCase().includes('light') ? 'light' : 'dark';
            const selectedPath = path.join(outputDir, `issue145-native-capo-keyboard-${locale}-${themeTag}-${width}-selected.png`);
            captureHostWindow(windowId, selectedPath);
            assert.ok((await fs.stat(selectedPath)).size > 10000, `${width}px selected state screenshot was written`);
          }
        }

        const unsupportedSource = 'chord C@x = x35553\ncapo: 0\n| C@x | G | Am | F |\n';
        const unsupportedDoc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: unsupportedSource });
        await showAndFocus(unsupportedDoc);
        await vscode.commands.executeCommand('guitardsl.showPreview', unsupportedDoc.uri);
        for (let attempt = 0; attempt < 100
          && preview.currentDocumentUri !== unsupportedDoc.uri.toString(); attempt++) await settle(20);
        assert.strictEqual(preview.currentDocumentUri, unsupportedDoc.uri.toString(),
          'Preview switches to the fixture with unsupported Capo candidates');
        await waitForPreviewDocument();
        const disabledGeneration = preview.generation;
        await evaluatePreviewWebview<void>(`document.getElementById('preview-capo-select').focus()`);
        dispatchNativeKey(49);
        await settle(200);
        dispatchNativeKey(125);
        dispatchNativeKey(36);
        await settle(150);
        const disabledResult = await evaluatePreviewWebview<string>(`JSON.stringify({
          value: document.getElementById('preview-capo-select').value,
          disabled: document.getElementById('preview-capo-select').selectedOptions[0]?.disabled,
          label: document.getElementById('preview-capo-select').selectedOptions[0]?.textContent
        })`);
        assert.deepStrictEqual(JSON.parse(disabledResult), { value: '0', disabled: false, label: '0' },
          'native keyboard input cannot select disabled candidates and restores the compact label on close');
        assert.strictEqual(preview.generation, disabledGeneration,
          'native keyboard input on disabled candidates does not rebuild Preview');
        assert.strictEqual(unsupportedDoc.getText(), unsupportedSource,
          'native keyboard input on disabled candidates leaves source DSL unchanged');
      } finally {
        await resetWorkbenchViewport();
      }
    });
  });
}

/**
 * Shows `doc` and waits until it is the active editor and stays so briefly. An editor left open by an earlier
 * test can otherwise still be (or become again) active, and commands such as `undo` or tools that resolve the
 * active editor would target it.
 */
async function showAndFocus(
  doc: vscode.TextDocument,
  column: vscode.ViewColumn = vscode.ViewColumn.One,
  beforeStabilityDecision?: () => Promise<void>
): Promise<vscode.TextEditor> {
  return showAndFocusDocument(doc, column, beforeStabilityDecision);
}

async function setPreviewPracticeEnabled(enabled: boolean): Promise<void> {
  await waitForPreviewDocument();
  const read = () => evaluatePreviewWebview<boolean>(
    `document.getElementById('practice-toggle')?.getAttribute('aria-pressed') === 'true'`
  );
  if (await read() !== enabled) {
    await vscode.commands.executeCommand('guitardsl.practice.toggle');
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    const actual = await read();
    if (actual === enabled) {
      const rowVisible = await evaluatePreviewWebview<boolean>(
        `document.body.classList.contains('has-practice-row')`
      );
      assert.strictEqual(rowVisible, enabled, 'Practice row visibility matches its pressed state');
      return;
    }
    await settle(20);
  }
  assert.fail(`Preview Practice did not become ${enabled ? 'enabled' : 'disabled'}`);
}

/** Runs `undo` in `doc` (focused first) and waits until its text has changed. */
async function undoIn(doc: vscode.TextDocument): Promise<void> {
  const before = doc.getText();
  await showAndFocus(doc);
  await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
  await showAndFocus(doc);
  recordFocusTrace('undo-target-validated');
  assert.strictEqual(vscode.window.state.focused, true, 'Undo runs while the VS Code test window is focused');
  assert.ok(isDocumentActiveInColumn(doc, vscode.ViewColumn.One), 'Undo runs only while the requested document is active in the first editor group');
  await vscode.commands.executeCommand('undo');
  for (let i = 0; i < 100 && doc.getText() === before; i++) await settle(10);
}

/** Closes every editor and waits until none is visible, so a suite starts without leftovers. */
async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  for (let i = 0; i < 100 && (vscode.window.visibleTextEditors.length > 0 || vscode.window.activeTextEditor); i++) await settle(10);
  if (vscode.window.visibleTextEditors.length > 0 || vscode.window.activeTextEditor) {
    recordFocusTrace('close-all-editors-postcondition-failed');
    assert.fail(`closeAllEditors left visible or active editors: ${JSON.stringify({
      visible: vscode.window.visibleTextEditors.map(editor => ({ scheme: editor.document.uri.scheme, column: editor.viewColumn })),
      activeColumn: vscode.window.activeTextEditor?.viewColumn
    })}`);
  }
}

type InspectorAudioMetrics = {
  resumeRequests: number;
  resumeResolutions: number;
  grants: number;
  oscillatorCreations: number;
};

function instrumentInspectorDeferredAudioResume(html: string): string {
  const scriptTag = html.match(/<script nonce="([^"]+)">/);
  assert.ok(scriptTag, 'the Inspector shell includes its nonce-protected runtime script');
  const probe = [
    '(() => {',
    '  const probe = document.createElement("div");',
    '  probe.id = "guitardsl-e2e-audio-probe"; probe.hidden = true;',
    '  const metrics = { resumeRequests: 0, resumeResolutions: 0, grants: 0, oscillatorCreations: 0 };',
    '  const publish = () => { for (const [key, value] of Object.entries(metrics)) probe.dataset[key] = String(value); };',
    '  document.body.append(probe); publish();',
    '  let releaseResume;',
    '  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;',
    '  if (AudioContextConstructor) {',
    '    const prototype = AudioContextConstructor.prototype;',
    '    const originalResume = prototype.resume;',
    '    const originalCreateOscillator = prototype.createOscillator;',
    '    prototype.resume = function(...args) {',
    '      metrics.resumeRequests++; publish();',
    '      return originalResume.apply(this, args).then(() => new Promise(resolve => {',
    '        releaseResume = () => { metrics.resumeResolutions++; publish(); resolve(); };',
    '      }));',
    '    };',
    '    prototype.createOscillator = function(...args) {',
    '      metrics.oscillatorCreations++; publish();',
    '      return originalCreateOscillator.apply(this, args);',
    '    };',
    '  }',
    '  window.addEventListener("message", event => {',
    '    const message = event.data;',
    '    if (message && message.command === "progressionAudioStart") { metrics.grants++; publish(); }',
    '    if (message && message.command === "inspectorE2eResolveResume" && releaseResume) { const release = releaseResume; releaseResume = undefined; release(); }',
    '  });',
    '})();'
  ].join('\n');
  return html.replace(scriptTag[0], `<script nonce="${scriptTag[1]}">${probe}</script>\n${scriptTag[0]}`);
}

async function waitForInspectorAudioMetrics(predicate: (metrics: InspectorAudioMetrics) => boolean): Promise<InspectorAudioMetrics> {
  for (let attempt = 0; attempt < 150; attempt++) {
    const encoded = await evaluateInspectorWebview<string>('(() => { const p = document.getElementById("guitardsl-e2e-audio-probe"); return p ? JSON.stringify({ resumeRequests: Number(p.dataset.resumeRequests), resumeResolutions: Number(p.dataset.resumeResolutions), grants: Number(p.dataset.grants), oscillatorCreations: Number(p.dataset.oscillatorCreations) }) : ""; })()');
    if (encoded) {
      const metrics = JSON.parse(encoded) as InspectorAudioMetrics;
      if (predicate(metrics)) return metrics;
    }
    await settle(20);
  }
  assert.fail('Inspector audio metrics did not reach the expected state');
}

async function openProgressionForSettingsAudioTest(): Promise<{ doc: vscode.TextDocument; source: string }> {
  const source = [
    'key: C',
    'bpm: 120',
    'time: 4/4',
    '| C | Dm | Em | F |',
    'mel: | c6/4 d6/4 e6/4 f6/4 | g6/4 a6/4 b6/4 c7/4 | d6/4 e6/4 f6/4 g6/4 | a6/4 b6/4 c7/4 d7/4 |'
  ].join('\n');
  const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: source });
  const editor = await showAndFocus(doc);
  await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
  await settle(250);
  await showAndFocus(doc);
  editor.selection = new vscode.Selection(new vscode.Position(3, 3), new vscode.Position(3, 3));
  await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
  await settle(250);
  return { doc, source };
}

suite('GuitarDSL Extension E2E Test Suite', () => {
  suiteSetup(async () => {
    const ext =
      vscode.extensions.getExtension('puchinya.vscode-guitar-dsl') ||
      vscode.extensions.all.find(e => e.packageJSON?.name === 'vscode-guitar-dsl');
    assert.ok(ext, 'Extension should be present in extensions list');
    if (!ext.isActive) {
      await ext.activate();
    }
  });

  test('P145 Preview settings and P136 toolbar layout, focus, and transport remain usable', async function () {
    this.timeout(30000);
    const useWideMatrixViewport = Number(process.env.GUITARDSL_E2E_VIEWPORT_WIDTH ?? 1200) >= 2200;
    try {
      await withWorkbenchSnapshotRestored(async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: 'bpm: 120\ncapo: 0\n| C | G | Am | F |\n' });
    await showAndFocus(doc);
    await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const preview = require('../../previewCapo').previewLifecycleProbe as { generation: number; currentDocumentUri?: string };
    for (let attempt = 0; attempt < 100 && preview.currentDocumentUri !== doc.uri.toString(); attempt++) await settle(20);
    assert.strictEqual(preview.currentDocumentUri, doc.uri.toString(), 'the singleton Preview renders the target document');

    const captureScreenshots = process.env.GUITARDSL_E2E_CAPTURE_SCREENSHOTS === '1';
    const requestedLocale = (process.env.GUITARDSL_E2E_LOCALE ?? vscode.env.language).toLowerCase().split('-')[0];
    const requestedTheme = process.env.GUITARDSL_E2E_THEME ?? 'Default Dark Modern';
    const workbenchWidth = Number(process.env.GUITARDSL_E2E_VIEWPORT_WIDTH ?? 1200);
    if (workbenchWidth >= 2200) await setWorkbenchViewportWidth(workbenchWidth);
    const workbenchViewport = JSON.parse(await inspectWorkbenchLayout()).viewport.width as number;
    if (workbenchWidth >= 2200) assert.ok(workbenchViewport >= 1400,
      `the Extension Development Host CSS viewport is ${workbenchViewport}px; at least 1400px is needed to size a 1100px Preview group`);
    if (captureScreenshots) {
      assert.ok(vscode.env.language.toLowerCase().startsWith(requestedLocale), 'screenshot locale matches the Extension Development Host');
      await vscode.workspace.getConfiguration('workbench').update('colorTheme', requestedTheme, vscode.ConfigurationTarget.Global);
    }
    const partsBeforeSizing = JSON.parse(await inspectWorkbenchLayout()).parts as {
      sidebar: { visible: boolean };
      auxiliarybar: { visible: boolean };
    };
    if (partsBeforeSizing.sidebar.visible) await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
    if (partsBeforeSizing.auxiliarybar.visible) await vscode.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
    await settle(250);
    await waitForPreviewDocument();

    await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
    await resizeActiveEditorGroupToWidth(600);
    await settle(200);
    const previewWidth = await evaluatePreviewWebview<number>('window.innerWidth');
    const workbenchLayout = await inspectWorkbenchLayout();
    assert.strictEqual(previewWidth, 600,
      `real Preview Webview acceptance runs at exactly 600 CSS px (measured ${previewWidth}px; workbench layout ${workbenchLayout})`);
    const initial = JSON.parse(await evaluatePreviewWebview<string>(`JSON.stringify((() => {
      const toolbar = document.querySelector('.toolbar-container');
      const settingsRow = document.getElementById('score-settings-row');
      const settings = ['preview-capo-select','preview-playability','toggle-preview-beginner'];
      const ids = ['btn-play','btn-pause','btn-stop','playback-seek','playback-time'];
      return { transport: ids.map(id => !!document.getElementById(id) && document.getElementById(id).closest('.toolbar-container') === toolbar),
        viewport: window.innerWidth,
        toolbarHeight: Math.round(toolbar.getBoundingClientRect().height),
        toolbarFits: toolbar.scrollWidth <= toolbar.clientWidth,
        actionsFit: document.getElementById('toolbar-actions').scrollWidth <= document.getElementById('toolbar-actions').clientWidth,
        practice: document.querySelector('.practice-toolbar') && getComputedStyle(document.querySelector('.practice-toolbar')).display,
        practicePadding: getComputedStyle(document.body).paddingTop,
        settingsRect: { top: settingsRow.getBoundingClientRect().top, height: settingsRow.getBoundingClientRect().height },
        settingsVisible: settings.map(id => document.getElementById(id)?.getClientRects().length > 0),
        settingsRowFits: settingsRow.scrollWidth <= settingsRow.clientWidth,
        settingsText: settingsRow.innerText,
        disclosures: ['playback-options-toggle','view-export-toggle','temporary-score-settings-toggle'].map(id => document.getElementById(id)?.getAttribute('aria-expanded')),
        panelsHidden: ['playback-options-panel','view-export-panel','temporary-score-settings-panel'].map(id => document.getElementById(id)?.hidden),
        moreVisible: document.getElementById('temporary-score-settings-toggle')?.getClientRects().length > 0,
        detailsVisible: document.getElementById('score-settings-details-toggle')?.getClientRects().length > 0,
        noTemporaryTitle: !document.body.innerText.includes('一時楽譜設定') && !document.body.innerText.includes('Temporary Score Settings'),
        noDuplicateSettings: document.querySelectorAll('#score-settings-row').length === 1
          && !document.getElementById('capo-bar') && !document.getElementById('btn-apply-capo'),
        controls: ['select-page-size','orientation-portrait','orientation-landscape','btn-save-pdf'].map(id => !!document.getElementById(id)) };
    })())`));
    assert.ok(initial.transport.every(Boolean), `ordinary playback transport stays in the fixed toolbar: ${JSON.stringify(initial)}`);
    assert.strictEqual(initial.viewport, 600, `toolbar acceptance runs at 600 CSS px: ${initial.viewport}`);
    assert.strictEqual(initial.toolbarHeight, 48, 'playback row is exactly 48px high');
    assert.strictEqual(initial.toolbarFits, true, 'transport and toolbar actions fit on one row');
    assert.strictEqual(initial.actionsFit, true, 'all supplemental actions fit without horizontal scrolling');
    assert.strictEqual(initial.practice, 'none', 'Practice OFF leaves no extra row');
    assert.strictEqual(initial.practicePadding, '110px', 'Practice OFF body content starts after the 110px reserved layout');
    assert.deepStrictEqual(initial.settingsRect, { top: 48, height: 44 }, 'the dedicated settings row immediately follows playback at 44px');
    assert.deepStrictEqual(initial.disclosures, ['false', 'false', 'false']);
    assert.deepStrictEqual(initial.panelsHidden, [true, true, true]);
    assert.deepStrictEqual(initial.settingsVisible, [true, true, true], 'Capo, colored Playability, and Beginner are directly visible at 600 CSS px');
    assert.strictEqual(initial.settingsRowFits, true, 'the primary settings remain within the 44px row at 600px');
    assert.strictEqual(initial.moreVisible, true, 'supplemental controls are reachable through More below 840px');
    assert.strictEqual(initial.detailsVisible, false, 'no details button or blank slot is shown when the host has no substitutions or warning');
    assert.strictEqual(initial.noTemporaryTitle, true, 'the obsolete temporary-settings title is absent from visible Preview text');
    assert.strictEqual(initial.noDuplicateSettings, true, 'one dedicated settings row exists without Apply controls');
    assert.ok(initial.controls.every(Boolean), 'display, paper, orientation, and PDF controls remain available');

    const opened = await evaluatePreviewWebview<boolean>(`(() => {
      const view = document.getElementById('view-export-toggle');
      const viewPanel = document.getElementById('view-export-panel');
      view.focus(); view.click();
      return view.getAttribute('aria-expanded') === 'true' && !viewPanel.hidden && document.activeElement === view;
    })()`);
    assert.strictEqual(opened, true, 'opening a disclosure leaves focus on its trigger');
    await dispatchPreviewKeyboardKey('Tab');
    const tabEntered = JSON.parse(await evaluatePreviewWebview<string>(`JSON.stringify({
      inDisclosure: document.activeElement?.getAttribute('data-mode') === 'single'
        && document.getElementById('view-export-toggle').getAttribute('aria-expanded') === 'true',
      focusVisible: document.activeElement?.matches(':focus-visible') === true
        && getComputedStyle(document.activeElement).outlineStyle !== 'none'
        && getComputedStyle(document.activeElement).outlineWidth !== '0px'
    })`));
    assert.strictEqual(tabEntered.inDisclosure, true, 'Tab from the trigger enters the disclosure content');
    assert.strictEqual(tabEntered.focusVisible, true, 'keyboard focus receives the visible focus outline');
    await dispatchPreviewKeyboardKey('Escape');
    const escaped = await evaluatePreviewWebview<boolean>(`document.getElementById('view-export-toggle').getAttribute('aria-expanded') === 'false'
      && document.getElementById('view-export-panel').hidden && document.activeElement.id === 'view-export-toggle'`);
    assert.strictEqual(escaped, true, 'Escape in the disclosure returns focus to its trigger');

    const triggerEscape = await evaluatePreviewWebview<boolean>(`(() => {
      const view = document.getElementById('view-export-toggle'); view.focus(); view.click();
      view.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return view.getAttribute('aria-expanded') === 'false' && document.activeElement === view;
    })()`);
    assert.strictEqual(triggerEscape, true, 'Escape also closes when focus remains on the trigger');

    const settingsOpened = await evaluatePreviewWebview<boolean>(`(() => {
      const trigger = document.getElementById('temporary-score-settings-toggle');
      const panel = document.getElementById('temporary-score-settings-panel');
      trigger.focus(); trigger.click();
      return trigger.getAttribute('aria-expanded') === 'true' && !panel.hidden;
    })()`);
    assert.strictEqual(settingsOpened, true, 'More opens supplemental score settings');
    await dispatchPreviewKeyboardKey('Tab');
    const settingsTabEntered = await evaluatePreviewWebview<boolean>(`document.getElementById('temporary-score-settings-panel').contains(document.activeElement)
      && document.getElementById('temporary-score-settings-toggle').getAttribute('aria-expanded') === 'true'
      && document.activeElement.matches(':focus-visible') === true
      && getComputedStyle(document.activeElement).outlineStyle !== 'none'
      && getComputedStyle(document.activeElement).outlineWidth !== '0px'`);
    assert.strictEqual(settingsTabEntered, true, 'Tab enters supplemental settings with a visible keyboard focus');
    await dispatchPreviewKeyboardKey('Escape');
    const settingsEscaped = await evaluatePreviewWebview<boolean>(`document.getElementById('temporary-score-settings-toggle').getAttribute('aria-expanded') === 'false'
      && document.getElementById('temporary-score-settings-panel').hidden
      && document.activeElement.id === 'temporary-score-settings-toggle'`);
    assert.strictEqual(settingsEscaped, true, 'Escape closes supplemental settings and returns focus to More');

    const interaction = await evaluatePreviewWebview<string>(`(() => {
      const playback = document.getElementById('playback-options-toggle');
      playback.focus(); playback.click();
      document.getElementById('btn-help').focus();
      const outsideFocusClosed = playback.getAttribute('aria-expanded') === 'false'
        && document.getElementById('playback-options-panel').hidden && document.activeElement.id === 'btn-help';
      const practice = document.getElementById('practice-toggle');
      practice.click();
      const practiceOn = document.body.classList.contains('has-practice-row')
        && getComputedStyle(document.querySelector('.practice-toolbar')).display !== 'none';
      practice.click();
      const practiceOff = !document.body.classList.contains('has-practice-row')
        && getComputedStyle(document.querySelector('.practice-toolbar')).display === 'none';
      return JSON.stringify({ outsideFocusClosed, practiceOn, practiceOff });
    })()`);
    const behavior = JSON.parse(interaction) as Record<string, boolean>;
    for (const [name, passed] of Object.entries(behavior)) assert.strictEqual(passed, true, `${name} behavior works`);

    const waitForPracticeState = async (enabled: boolean): Promise<void> => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const actual = await evaluatePreviewWebview<boolean>(`document.body.classList.contains('has-practice-row')`);
        if (actual === enabled) return;
        await settle(20);
      }
      const state = await evaluatePreviewWebview<string>(`JSON.stringify({
        row: document.body.classList.contains('has-practice-row'),
        pressed: document.getElementById('practice-toggle')?.getAttribute('aria-pressed'),
        rowDisplay: getComputedStyle(document.getElementById('practice-toolbar')).display,
        active: document.activeElement?.id
      })`);
      assert.fail(`Practice did not become ${enabled ? 'enabled' : 'disabled'}: ${state}`);
    };
    await evaluatePreviewWebview<void>(`document.getElementById('practice-toggle').click()`);
    await waitForPracticeState(true);
    for (const controlId of ['practice-speed', 'practice-loop', 'practice-set-a', 'practice-set-b']) {
      await evaluatePreviewWebview<void>(`document.getElementById('${controlId}').focus()`);
      const before = await evaluatePreviewWebview<string>('document.activeElement?.id');
      if (before !== controlId) {
        const focusState = await evaluatePreviewWebview<string>(`JSON.stringify({
          active: document.activeElement?.id,
          disabled: document.getElementById('${controlId}')?.disabled,
          display: getComputedStyle(document.getElementById('${controlId}')).display,
          visibility: getComputedStyle(document.getElementById('${controlId}')).visibility,
          practiceRow: getComputedStyle(document.getElementById('practice-toolbar')).display,
          settingsOpen: document.getElementById('temporary-score-settings-panel')?.hidden === false
        })`);
        assert.strictEqual(before, controlId, `${controlId} receives DOM focus before Practice is turned off: ${focusState}`);
      }
      assert.strictEqual(before, controlId, `${controlId} receives DOM focus before Practice is turned off`);
      await vscode.commands.executeCommand('guitardsl.practice.toggle');
      await waitForPracticeState(false);
      const evacuated = await evaluatePreviewWebview<string>(`JSON.stringify({
        active: document.activeElement?.id,
        hidden: getComputedStyle(document.getElementById('practice-toolbar')).display === 'none'
      })`);
      assert.deepStrictEqual(JSON.parse(evacuated), { active: 'practice-toggle', hidden: true }, `${controlId} focus moves before the Practice row is hidden`);
      await vscode.commands.executeCommand('guitardsl.practice.toggle');
      await waitForPracticeState(true);
    }

    const theme = /light/i.test(requestedTheme) ? 'light' : 'dark';
    const renderedWidth = Math.round(initial.viewport);
    const tag = process.env.GUITARDSL_E2E_TAG;
    const suffix = tag && /^[a-z0-9-]+$/i.test(tag) ? `-${tag}` : '';
    const runTemporarySettingsScenario = async (sourceDoc: vscode.TextDocument): Promise<void> => {
    if (await evaluatePreviewWebview<boolean>(`document.body.classList.contains('has-practice-row')`)) {
      await evaluatePreviewWebview<void>(`document.getElementById('practice-toggle').click()`);
      await waitForPracticeState(false);
    }
    const widths = workbenchWidth >= 2200 ? [421, 600, 840, 1100] : [421, 600];
    const expectedCapoCandidates = require('../../capo').buildCapoPreviewUiModel(sourceDoc.getText(), undefined).candidates as Array<{
      capo: number;
      supported: boolean;
      score?: number;
      level?: 'veryEasy' | 'easy' | 'moderate' | 'hard' | 'veryHard';
      recommended: boolean;
    }>;
    const candidateMessages = require('../../i18n').getMessages(requestedLocale === 'ja' ? 'ja' : 'en');
    const expectedCapoLabels = expectedCapoCandidates.map(candidate => candidate.score === undefined || candidate.level === undefined
      ? `${candidate.capo} · ${candidateMessages.uiPlayabilityUnavailable}`
      : `${candidate.capo} · ${candidate.score}/100 · ${candidateMessages.playabilityLevels[candidate.level]}${candidate.recommended ? ` · ★ ${candidateMessages.uiRecommended}` : ''}`);
    const expectedClosedCapoLabels = expectedCapoCandidates.map(candidate => String(candidate.capo));
    for (const width of widths) {
      if (width === 1100) {
        await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
        await resizeActiveEditorGroupToWidth(340);
        await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
      }
      await resizeActiveEditorGroupToWidth(width);
      await settle(150);
      const state = JSON.parse(await evaluatePreviewWebview<string>(`JSON.stringify((() => {
        const playback = document.querySelector('.toolbar-container');
        const row = document.getElementById('score-settings-row');
        const practice = document.getElementById('practice-toolbar');
        const panel = document.getElementById('temporary-score-settings-panel');
        const more = document.getElementById('temporary-score-settings-toggle');
        const mainIds = ['preview-capo-select','preview-playability','toggle-preview-beginner'];
        const playability = document.getElementById('preview-playability');
        const level = playability.dataset.level;
        const value = playability.querySelector('.score-settings-playability-value');
        const valueStyle = getComputedStyle(value);
        const colors = { veryEasy: 'rgb(46, 125, 50)', easy: 'rgb(46, 125, 50)',
          moderate: 'rgb(141, 110, 0)', hard: 'rgb(183, 28, 28)', veryHard: 'rgb(183, 28, 28)' };
        const supplements = ['select-preview-barre-policy','select-preview-beginner-capo-mode',
          'open-score-settings-capo-from-preview','open-score-settings-beginner-from-preview'];
        const rowBounds = row.getBoundingClientRect();
        const visibleSettingsFitVertically = [...mainIds, ...supplements].every(id => {
          const element = document.getElementById(id);
          if (!element || element.getClientRects().length === 0) return true;
          const bounds = element.getBoundingClientRect();
          return bounds.top >= rowBounds.top - 1 && bounds.bottom <= rowBounds.bottom + 1;
        });
        const practiceStyle = getComputedStyle(practice);
        return { width: window.innerWidth,
          capoSelectWidth: Math.round(document.getElementById('preview-capo-select').getBoundingClientRect().width),
          playback: { top: playback.getBoundingClientRect().top, height: playback.getBoundingClientRect().height },
          row: { top: row.getBoundingClientRect().top, height: row.getBoundingClientRect().height,
            fits: row.scrollWidth <= row.clientWidth, contentsFitVertically: visibleSettingsFitVertically },
          mainVisible: mainIds.map(id => document.getElementById(id)?.getClientRects().length > 0),
          moreVisible: more.getClientRects().length > 0,
          detailsVisible: document.getElementById('score-settings-details-toggle')?.getClientRects().length > 0,
          moreExpanded: more.getAttribute('aria-expanded'),
          inline: panel.dataset.inline,
          panelHidden: panel.hidden,
          supplementsVisible: supplements.map(id => document.getElementById(id)?.getClientRects().length > 0),
          playability: { level, text: playability.innerText, backgroundColor: valueStyle.backgroundColor,
            foregroundColor: valueStyle.color, borderRadius: valueStyle.borderRadius,
            columnGap: valueStyle.columnGap,
            separatorDisplay: getComputedStyle(playability.querySelector('.score-settings-playability-separator')).display,
            colorMatches: level === 'unavailable' ? valueStyle.backgroundColor === 'rgba(0, 0, 0, 0)' : valueStyle.backgroundColor === colors[level],
            foregroundMatches: level === 'unavailable' ? valueStyle.color !== 'rgb(255, 255, 255)' : valueStyle.color === 'rgb(255, 255, 255)' },
          practice: { display: practiceStyle.display, bodyPadding: getComputedStyle(document.body).paddingTop },
          noTemporaryTitle: !document.body.innerText.includes('一時楽譜設定')
            && !document.body.innerText.includes('Temporary Score Settings'),
          transportVisible: ['btn-play','btn-pause','btn-stop','playback-seek','playback-time']
            .every(id => document.getElementById(id)?.getClientRects().length > 0) };
      })())`));
      assert.strictEqual(state.width, width, `Preview measures exactly ${width} CSS px`);
      assert.deepStrictEqual(state.playback, { top: 0, height: 48 }, `${width}px playback row keeps its 48px geometry`);
      assert.deepStrictEqual(state.row, { top: 48, height: 44, fits: true, contentsFitVertically: true },
        `${width}px settings row is 44px directly below playback and all visible controls fit within it`);
      assert.deepStrictEqual(state.mainVisible, [true, true, true], `${width}px keeps direct Capo, Playability, and Beginner controls visible`);
      assert.strictEqual(state.transportVisible, true, `${width}px keeps every playback control visible`);
      assert.ok(state.capoSelectWidth > 50 && state.capoSelectWidth <= 112,
        `${width}px keeps the closed native capo select compact (${state.capoSelectWidth}px)`);
      assert.strictEqual(state.moreVisible, width < 840, `${width}px shows More only below the full-settings breakpoint`);
      assert.strictEqual(state.detailsVisible, false, `${width}px reserves no details button when there are no substitutions or warning`);
      assert.strictEqual(state.inline, String(width >= 840), `${width}px selects the correct supplemental settings layout`);
      assert.strictEqual(state.panelHidden, width < 840, `${width}px keeps overflow closed and inline settings visible`);
      if (width >= 840) assert.deepStrictEqual(state.supplementsVisible, [true, true, true, true], `${width}px exposes all supplemental controls`);
      assert.strictEqual(state.playability.colorMatches, true,
        `${width}px uses the restored level palette as a filled badge: ${JSON.stringify(state.playability)}`);
      assert.strictEqual(state.playability.foregroundMatches, true,
        `${width}px keeps rated badge text white and unavailable values neutral: ${JSON.stringify(state.playability)}`);
      assert.strictEqual(state.playability.borderRadius, '999px', `${width}px renders the score as a rounded badge`);
      assert.strictEqual(state.playability.columnGap, width <= 600 ? '4px' : '0px',
        `${width}px maintains score/level spacing when the compact design hides its separator`);
      assert.strictEqual(state.playability.separatorDisplay, width <= 600 ? 'none' : 'block',
        `${width}px follows the design's compact score and level spacing`);
      assert.ok(state.playability.text.includes('/100') || /Not available|評価できません/.test(state.playability.text),
        `${width}px presents a numeric score or an explicit unavailable label`);
      assert.strictEqual(state.practice.display, 'none', `${width}px Practice OFF hides its row`);
      assert.strictEqual(state.practice.bodyPadding, '110px', `${width}px Practice OFF content starts at 110px`);
      assert.strictEqual(state.noTemporaryTitle, true, `${width}px does not display the retired title`);
      const candidateOptions = JSON.parse(await evaluatePreviewWebview<string>(`JSON.stringify(Array.from(
        document.getElementById('preview-capo-select').options
      ).filter(option => option.value !== '').map(option => ({ value: option.value, label: option.textContent,
        openLabel: option.dataset.openLabel, disabled: option.disabled })))`)) as Array<{ value: string; label: string; openLabel: string; disabled: boolean }>;
      assert.deepStrictEqual(candidateOptions.map(option => Number(option.value)), expectedCapoCandidates.map(candidate => candidate.capo),
        `${width}px keeps all 13 numeric host capo values in order`);
      assert.deepStrictEqual(candidateOptions.map(option => option.label), expectedClosedCapoLabels,
        `${width}px closed capo select labels remain compact to avoid overlap`);
      assert.deepStrictEqual(candidateOptions.map(option => option.disabled), expectedCapoCandidates.map(candidate => !candidate.supported),
        `${width}px preserves host-supported state in the native options`);
      assert.deepStrictEqual(candidateOptions.map(option => option.openLabel), expectedCapoLabels,
        `${width}px keeps the full host score, level, and recommendation for the expanded list`);
      if (captureScreenshots) await capturePreviewWebviewScreenshot(
        `preview-${requestedLocale}-${theme}-${width}-score-settings.png`, 145);
      await clickPreviewElement('#preview-capo-select');
      await settle(50);
      const expandedCapoOptions = JSON.parse(await evaluatePreviewWebview<string>(`JSON.stringify(Array.from(
        document.getElementById('preview-capo-select').options
      ).filter(option => option.value !== '').map(option => option.textContent))`)) as string[];
      assert.deepStrictEqual(expandedCapoOptions, expectedCapoLabels,
        `${width}px native list interaction expands candidate details only while choosing`);
      await dispatchPreviewKeyboardKey('Escape');
      await settle(50);
      const collapsedCapoOptions = JSON.parse(await evaluatePreviewWebview<string>(`JSON.stringify(Array.from(
        document.getElementById('preview-capo-select').options
      ).filter(option => option.value !== '').map(option => option.textContent))`)) as string[];
      assert.deepStrictEqual(collapsedCapoOptions, expectedClosedCapoLabels,
        `${width}px closing the capo list hides candidate scores and levels`);

      await evaluatePreviewWebview<void>(`document.getElementById('practice-toggle').click()`);
      await waitForPracticeState(true);
      const practiceOn = JSON.parse(await evaluatePreviewWebview<string>(`JSON.stringify({
        top: document.getElementById('practice-toolbar').getBoundingClientRect().top,
        height: document.getElementById('practice-toolbar').getBoundingClientRect().height,
        bodyPadding: getComputedStyle(document.body).paddingTop,
        settingsBottom: document.getElementById('score-settings-row').getBoundingClientRect().bottom
      })`));
      assert.deepStrictEqual(practiceOn, { top: 92, height: 42, bodyPadding: '152px', settingsBottom: 92 },
        `${width}px Practice ON adds only the 42px row after settings`);
      await evaluatePreviewWebview<void>(`document.getElementById('practice-toggle').click()`);
      await waitForPracticeState(false);
    }
    await resizeActiveEditorGroupToWidth(600);
    await settle(150);
    const waitForSettings = async (predicate: string, name: string, previousGeneration?: number): Promise<void> => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluatePreviewWebview<boolean>(predicate)
          && (previousGeneration === undefined || preview.generation === previousGeneration + 1)) {
          if (previousGeneration !== undefined) assert.strictEqual(preview.generation, previousGeneration + 1, `${name} renders once`);
          if (previousGeneration !== undefined) await waitForPreviewIdentity({
            documentUri: doc.uri.toString(), documentVersion: doc.version,
            previewGeneration: preview.generation
          });
          await waitForPreviewDocument();
          return;
        }
        await settle(20);
      }
      const state = await evaluatePreviewWebview<string>(`JSON.stringify({
        beginner: document.getElementById('toggle-preview-beginner')?.checked,
        policy: document.getElementById('select-preview-barre-policy')?.value,
        mode: document.getElementById('select-preview-beginner-capo-mode')?.value,
        capoValue: document.getElementById('preview-capo-select')?.value,
        capoDisabled: document.getElementById('preview-capo-select')?.disabled,
        active: document.activeElement?.id,
        settingsExpanded: document.getElementById('temporary-score-settings-toggle')?.getAttribute('aria-expanded'),
        renderGeneration: ${preview.generation}
      })`);
      assert.fail(`Preview settings did not reach ${name}: ${state}`);
    };
    const beforeBeginnerOn = preview.generation;
    await evaluatePreviewWebview<void>(`(() => {
      const control = document.getElementById('toggle-preview-beginner');
      control.checked = true; control.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitForSettings(`document.getElementById('toggle-preview-beginner')?.checked === true
      && document.getElementById('select-preview-beginner-capo-mode')?.value === 'auto'
      && document.getElementById('preview-capo-select')?.disabled === true`, 'Beginner automatic capo', beforeBeginnerOn);
    const beginnerFocusRestored = await evaluatePreviewWebview<boolean>(`document.activeElement.id === 'toggle-preview-beginner'
      && document.getElementById('temporary-score-settings-panel').hidden === true`);
    assert.strictEqual(beginnerFocusRestored, true, 'a direct Beginner action restores focus without opening overflow');

    // Put the host's existing warning field in the active Beginner snapshot so the actual Preview
    // render path exercises both substitution and capo-warning details in one Webview model.
    const beginnerController = require('../../previewBeginner').getPreviewBeginnerController();
    const beginnerSnapshot = beginnerController.captureSettingsSnapshot(sourceDoc.uri.toString());
    assert.ok(beginnerSnapshot.state, 'the host Beginner controller has the active temporary settings');
    const beforeWarningRender = preview.generation;
    beginnerController.restoreSettingsSnapshot(sourceDoc, { ...beginnerSnapshot, notice: 'Preview detail E2E warning' }, true);
    await waitForSettings(`document.getElementById('score-settings-details-toggle')?.dataset.hasDetails === 'true'
      && document.querySelector('.settings-warning[role="status"]')?.textContent === 'Preview detail E2E warning'`,
      'Preview warning details', beforeWarningRender);

    const detailWidths = useWideMatrixViewport ? [421, 600, 840, 1100] : [421, 600];
    for (const width of detailWidths) {
      await resizeActiveEditorGroupToWidth(width);
      await settle(150);
      const triggerId = width >= 840 ? 'score-settings-details-toggle' : 'temporary-score-settings-toggle';
      const beforeOpen = JSON.parse(await evaluatePreviewWebview<string>(`JSON.stringify({
        width: window.innerWidth,
        moreVisible: document.getElementById('temporary-score-settings-toggle').getClientRects().length > 0,
        detailsVisible: document.getElementById('score-settings-details-toggle').getClientRects().length > 0,
        row: { top: document.getElementById('score-settings-row').getBoundingClientRect().top,
          height: document.getElementById('score-settings-row').getBoundingClientRect().height }
      })`));
      assert.strictEqual(beforeOpen.width, width, `detail route is checked at ${width} CSS px`);
      assert.strictEqual(beforeOpen.moreVisible, width < 840, `${width}px selects the existing More route only below the breakpoint`);
      assert.strictEqual(beforeOpen.detailsVisible, width >= 840, `${width}px exposes a details button only when wide enough and details exist`);
      assert.deepStrictEqual(beforeOpen.row, { top: 48, height: 44 }, `${width}px keeps the 44px row fixed before opening details`);
      await evaluatePreviewWebview<void>(`document.getElementById('${triggerId}').focus()`);
      await dispatchPreviewKeyboardKey('Enter');
      const openedDetails = JSON.parse(await evaluatePreviewWebview<string>(`JSON.stringify((() => {
        const panel = document.getElementById('temporary-score-settings-panel');
        const trigger = document.getElementById('${triggerId}');
        const warning = panel.querySelector('.settings-warning[role="status"]');
        const row = document.getElementById('score-settings-row').getBoundingClientRect();
        return { open: !panel.hidden,
          expanded: trigger.getAttribute('aria-expanded'),
          controls: trigger.getAttribute('aria-controls'),
          detailsMode: panel.dataset.detailsOpen,
          role: panel.getAttribute('role'),
          label: panel.getAttribute('aria-label'),
          substitutions: panel.querySelector('.settings-substitutions')?.textContent?.includes('F → Fmaj7'),
          substitutionsVisible: panel.querySelector('.settings-substitutions')?.getClientRects().length > 0,
          warningText: warning?.textContent,
          warningVisible: warning?.getClientRects().length > 0,
          warningRole: warning?.getAttribute('role'),
          editingControlsVisible: document.getElementById('select-preview-barre-policy').getClientRects().length > 0,
          row: { top: row.top, height: row.height } };
      })())`));
      assert.strictEqual(openedDetails.open, true, `${width}px keyboard activation opens a visible route: ${JSON.stringify(openedDetails)}`);
      assert.strictEqual(openedDetails.expanded, 'true', `${width}px details route reports expanded state`);
      assert.strictEqual(openedDetails.controls, 'temporary-score-settings-panel', `${width}px trigger identifies its controlled panel`);
      assert.strictEqual(openedDetails.substitutions, true, `${width}px displays the host's F → Fmaj7 substitution`);
      assert.strictEqual(openedDetails.substitutionsVisible, true, `${width}px substitution text is visible`);
      assert.strictEqual(openedDetails.warningText, 'Preview detail E2E warning', `${width}px displays the host capo warning`);
      assert.strictEqual(openedDetails.warningVisible, true, `${width}px warning text is visible`);
      assert.strictEqual(openedDetails.warningRole, 'status', `${width}px warning text is exposed as an ARIA status`);
      assert.deepStrictEqual(openedDetails.row, { top: 48, height: 44 }, `${width}px details do not change the fixed row geometry`);
      if (width >= 840) {
        assert.strictEqual(openedDetails.detailsMode, 'true', `${width}px uses the information-only details panel`);
        assert.strictEqual(openedDetails.role, 'region', `${width}px exposes details as a named region`);
        assert.strictEqual(openedDetails.label, vscode.env.language.toLowerCase().startsWith('ja') ? '置き換えと警告を表示' : 'Show substitutions and warnings');
        assert.strictEqual(openedDetails.editingControlsVisible, false, `${width}px details do not duplicate inline editing controls`);
      } else {
        assert.strictEqual(openedDetails.detailsMode, 'false', `${width}px More opens the full supplemental panel`);
        assert.strictEqual(openedDetails.role, 'group', `${width}px keeps the existing settings group semantics`);
        assert.strictEqual(openedDetails.editingControlsVisible, true, `${width}px More retains the existing supplemental controls`);
      }
      await dispatchPreviewKeyboardKey('Tab');
      const tabbedDetails = JSON.parse(await evaluatePreviewWebview<string>(`JSON.stringify({
        active: document.activeElement?.id,
        inside: document.getElementById('temporary-score-settings-panel').contains(document.activeElement),
        focusVisible: document.activeElement?.matches(':focus-visible') === true
          && getComputedStyle(document.activeElement).outlineStyle !== 'none'
          && getComputedStyle(document.activeElement).outlineWidth !== '0px'
      })`));
      assert.strictEqual(tabbedDetails.inside && tabbedDetails.focusVisible, true, `${width}px Tab enters the visible route with a focus outline: ${JSON.stringify(tabbedDetails)}`);
      if (width >= 840) assert.strictEqual(tabbedDetails.active, 'close-score-settings-details', `${width}px first Tab reaches the details close control`);
      if (captureScreenshots) await capturePreviewWebviewScreenshot(
        `preview-${requestedLocale}-${theme}-${width}-score-settings-details${suffix}.png`, 145);
      await dispatchPreviewKeyboardKey('Escape');
      const closedDetails = await evaluatePreviewWebview<boolean>(`(() => {
        const panel = document.getElementById('temporary-score-settings-panel');
        return document.activeElement?.id === '${triggerId}'
          && document.getElementById('${triggerId}').getAttribute('aria-expanded') === 'false'
          && panel.dataset.detailsOpen === 'false'
          && panel.hidden === ${width < 840};
      })()`);
      assert.strictEqual(closedDetails, true, `${width}px Escape closes the route and restores focus to its trigger`);
    }
    if (captureScreenshots && workbenchWidth < 2200) {
      await captureWorkbenchScreenshot(`preview-${requestedLocale}-${theme}-${renderedWidth}-temporary-score-settings${suffix}.png`, 145, workbenchWidth);
    }

    const beforeFixedMode = preview.generation;
    await evaluatePreviewWebview<void>(`(() => {
      const more = document.getElementById('temporary-score-settings-toggle');
      if (more.getAttribute('aria-expanded') !== 'true') more.click();
      const control = document.getElementById('select-preview-beginner-capo-mode');
      control.value = 'fixed'; control.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitForSettings(`document.getElementById('select-preview-beginner-capo-mode')?.value === 'fixed'
      && document.getElementById('preview-capo-select')?.disabled === false`, 'Beginner fixed capo', beforeFixedMode);

    const beforeCapoChange = preview.generation;
    const capoKeyboardTarget = JSON.parse(await evaluatePreviewWebview<string>(`JSON.stringify((() => {
      const control = document.getElementById('preview-capo-select');
      const options = Array.from(control.options).filter(option => !option.disabled && option.value !== '');
      const currentIndex = options.findIndex(option => option.value === control.value);
      const candidate = options.find((option, index) => index > currentIndex) || options[0];
      control.focus();
      return { current: control.value, next: candidate?.value ?? '' };
    })())`)) as { current: string; next: string };
    assert.ok(capoKeyboardTarget.next && capoKeyboardTarget.next !== capoKeyboardTarget.current,
      'the current score has a second supported capo candidate');
    await evaluatePreviewWebview<void>(`(() => {
      const control = document.getElementById('preview-capo-select');
      control.value = ${JSON.stringify(capoKeyboardTarget.next)};
      control.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitForSettings(`document.getElementById('preview-capo-select')?.value === ${JSON.stringify(capoKeyboardTarget.next)}
      && document.activeElement?.id === 'preview-capo-select'`,
      `the selected Beginner capo ${capoKeyboardTarget.next} from ${capoKeyboardTarget.current}`, beforeCapoChange);

    const beforePolicyChange = preview.generation;
    await evaluatePreviewWebview<void>(`(() => {
      const more = document.getElementById('temporary-score-settings-toggle');
      if (more.getAttribute('aria-expanded') !== 'true') more.click();
      const control = document.getElementById('select-preview-barre-policy');
      control.value = 'allow'; control.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitForSettings(`document.getElementById('select-preview-barre-policy')?.value === 'allow'
      && document.getElementById('select-preview-beginner-capo-mode')?.value === 'auto'
      && document.getElementById('preview-capo-select')?.disabled === true`, 'automatic capo after barre policy changes', beforePolicyChange);
    const beforeBeginnerOff = preview.generation;
    await evaluatePreviewWebview<void>(`(() => {
      const control = document.getElementById('toggle-preview-beginner');
      control.checked = false; control.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitForSettings(`document.getElementById('toggle-preview-beginner')?.checked === false`, 'Beginner mode OFF', beforeBeginnerOff);
    assert.strictEqual(sourceDoc.getText(), 'bpm: 120\ncapo: 0\n| C | G | Am | F |\n', 'temporary Preview settings leave source DSL unchanged');
    };

    if (captureScreenshots && workbenchWidth < 2200) {
      await evaluatePreviewWebview<void>(`(() => { const button=document.getElementById('view-export-toggle'); button.focus(); button.click();
        if (document.body.classList.contains('has-practice-row')) document.getElementById('practice-toggle').click(); })()`);
      await waitForPracticeState(false);
      await captureWorkbenchScreenshot(`preview-${requestedLocale}-${theme}-${renderedWidth}-practice-off-view-open${suffix}.png`, 136, workbenchWidth);
      await evaluatePreviewWebview<void>(`document.getElementById('practice-toggle').click()`);
      await waitForPracticeState(true);
      await captureWorkbenchScreenshot(`preview-${requestedLocale}-${theme}-${renderedWidth}-practice-on-view-open${suffix}.png`, 136, workbenchWidth);
    }

    const waitForGeneration = async (before: number, action: string): Promise<void> => {
      recordFocusTrace(`preview-rebuild-requested:${action}`);
      for (let attempt = 0; attempt < 100 && preview.generation === before; attempt++) await settle(20);
      recordFocusTrace(preview.generation === before + 1 ? `preview-rebuild-observed:${action}` : `preview-rebuild-missing:${action}`);
      assert.strictEqual(preview.generation, before + 1, `${action} uses one Preview rebuild`);
      await waitForPreviewDocument();
    };
    const readLayoutFocus = async () => JSON.parse(await evaluatePreviewWebview<string>(`JSON.stringify({
      active: document.activeElement?.id,
      viewExpanded: document.getElementById('view-export-toggle')?.getAttribute('aria-expanded'),
      viewVisible: !document.getElementById('view-export-panel')?.hidden,
      paper: document.getElementById('select-page-size')?.value,
      orientation: document.body.getAttribute('data-orientation')
    })`));

    const initialLayout = await readLayoutFocus();
    const selectedPaper = initialLayout.paper === 'A5' ? 'A4' : 'A5';
    const beforePaperSelection = preview.generation;
    await evaluatePreviewWebview<void>(`(() => {
      const view = document.getElementById('view-export-toggle');
      if (view.getAttribute('aria-expanded') !== 'true') view.click();
      const select = document.getElementById('select-page-size');
      select.focus(); select.value = '${selectedPaper}'; select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    recordFocusTrace('preview-paper-selection-dispatched');
    await waitForGeneration(beforePaperSelection, 'paper selection');
    let focusState = await readLayoutFocus();
    for (let attempt = 0; attempt < 100 && focusState.active !== 'select-page-size'; attempt++) {
      await settle(20);
      focusState = await readLayoutFocus();
    }
    assert.deepStrictEqual(focusState, { active: 'select-page-size', viewExpanded: 'true', viewVisible: true, paper: selectedPaper, orientation: 'portrait' });

    const changeOrientation = async (controlId: 'orientation-landscape' | 'orientation-portrait', orientation: 'landscape' | 'portrait') => {
      const before = preview.generation;
      await evaluatePreviewWebview<void>(`(() => {
        const button = document.getElementById('${controlId}'); button.focus(); button.click();
      })()`);
      await waitForGeneration(before, `${orientation} orientation`);
      let state = await readLayoutFocus();
      for (let attempt = 0; attempt < 100 && state.active !== controlId; attempt++) {
        await settle(20);
        state = await readLayoutFocus();
      }
      assert.deepStrictEqual(state, {
        active: controlId, viewExpanded: 'true', viewVisible: true, paper: selectedPaper, orientation
      }, `${orientation} restores focus to its orientation button without reviving an earlier hint`);
    };
    await changeOrientation('orientation-landscape', 'landscape');
    await changeOrientation('orientation-portrait', 'portrait');

    await resizeActiveEditorGroupToWidth(421);
    await settle(150);
    const narrow = JSON.parse(await evaluatePreviewWebview<string>(`JSON.stringify((() => {
      const toolbar = document.querySelector('.toolbar-container');
      const transportIds = ['btn-play','btn-pause','btn-stop','playback-seek','playback-time','practice-toggle'];
      return { width: window.innerWidth,
        transportVisible: transportIds.every(id => document.getElementById(id)?.getClientRects().length > 0),
        toolbarFits: toolbar.scrollWidth <= toolbar.clientWidth };
    })())`));
    assert.deepStrictEqual(narrow, { width: 421, transportVisible: true, toolbarFits: true }, 'transport remains visible and usable in a narrower split');
    await evaluatePreviewWebview<void>(`(() => { const view=document.getElementById('view-export-toggle'); view.focus(); if (view.getAttribute('aria-expanded') !== 'true') view.click(); })()`);
    await dispatchPreviewKeyboardKey('Tab');
    const narrowTab = JSON.parse(await evaluatePreviewWebview<string>(`JSON.stringify({
      active: document.activeElement?.id,
      activeInPanel: document.getElementById('view-export-panel').contains(document.activeElement),
      focusVisible: document.activeElement?.matches(':focus-visible') === true
        && getComputedStyle(document.activeElement).outlineStyle !== 'none'
        && getComputedStyle(document.activeElement).outlineWidth !== '0px',
      panelOpen: !document.getElementById('view-export-panel').hidden
    })`));
    assert.strictEqual(narrowTab.panelOpen && narrowTab.activeInPanel && narrowTab.focusVisible, true,
      `Tab reaches View & Export controls in a narrower split: ${JSON.stringify(narrowTab)}`);
    await dispatchPreviewKeyboardKey('Escape');
    const narrowEscape = await evaluatePreviewWebview<boolean>(`document.getElementById('view-export-panel').hidden
      && document.activeElement?.id === 'view-export-toggle'`);
    assert.strictEqual(narrowEscape, true, 'Escape restores focus at a narrower split');
    await resizeActiveEditorGroupToWidth(600);

    await runTemporarySettingsScenario(doc);

    const unsupportedSource = 'chord C@x = x35553\ncapo: 0\n| C@x | G | Am | F |\n';
    const unsupportedDoc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: unsupportedSource });
    await showAndFocus(unsupportedDoc);
    const beforeUnsupportedPreview = preview.generation;
    await vscode.commands.executeCommand('guitardsl.showPreview', unsupportedDoc.uri);
    for (let attempt = 0; attempt < 100
      && preview.currentDocumentUri !== unsupportedDoc.uri.toString(); attempt++) await settle(20);
    assert.strictEqual(preview.currentDocumentUri, unsupportedDoc.uri.toString(),
      'the Preview finishes switching to the unsupported-candidate document');
    assert.ok(preview.generation > beforeUnsupportedPreview,
      'switching documents completes a new Preview generation before candidate assertions');
    await waitForPreviewIdentity({
      documentUri: unsupportedDoc.uri.toString(), documentVersion: unsupportedDoc.version,
      previewGeneration: preview.generation
    });
    await waitForPreviewDocument();
    const unsupportedState = JSON.parse(await evaluatePreviewWebview<string>(`JSON.stringify(Array.from(
      document.getElementById('preview-capo-select').options
    ).filter(option => option.value !== '').map(option => ({ value: option.value, disabled: option.disabled })))`)) as Array<{ value: string; disabled: boolean }>;
    assert.strictEqual(unsupportedState.length, 13, 'unsupported host candidates remain in the native capo list');
    assert.strictEqual(unsupportedState[0].value, '0');
    assert.strictEqual(unsupportedState[0].disabled, false, 'the source capo remains selectable');
    assert.ok(unsupportedState.slice(1).every(option => option.disabled),
      `untransposable capo choices are disabled in the real Webview: ${JSON.stringify(unsupportedState)}`);
    const unsupportedGeneration = preview.generation;
    await evaluatePreviewWebview<void>(`document.getElementById('preview-capo-select').focus()`);
    await dispatchPreviewKeyboardKey('ArrowDown');
    await dispatchPreviewKeyboardKey('Enter');
    await settle(100);
    const unsupportedAfterKeyboard = JSON.parse(await evaluatePreviewWebview<string>(`JSON.stringify({
      value: document.getElementById('preview-capo-select').value,
      label: document.getElementById('preview-capo-select').selectedOptions[0]?.textContent
    })`)) as { value: string; label: string };
    assert.deepStrictEqual(unsupportedAfterKeyboard, { value: '0', label: '0' },
      'keyboard interaction cannot select disabled capo candidates');
    assert.strictEqual(preview.generation, unsupportedGeneration, 'disabled keyboard choices do not dispatch a Preview rebuild');
    assert.strictEqual(unsupportedDoc.getText(), unsupportedSource, 'disabled keyboard choices do not edit source DSL');

    const nextDoc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: 'bpm: 96\n| D | A | Bm | G |\n' });
    await showAndFocus(nextDoc);
    await vscode.commands.executeCommand('guitardsl.showPreview', nextDoc.uri);
    for (let attempt = 0; attempt < 100 && preview.currentDocumentUri !== nextDoc.uri.toString(); attempt++) await settle(20);
    assert.strictEqual(preview.currentDocumentUri, nextDoc.uri.toString(), 'switching the source document rebuilds the Preview');
    await waitForPreviewIdentity({
      documentUri: nextDoc.uri.toString(), documentVersion: nextDoc.version,
      previewGeneration: preview.generation
    });
    await waitForPreviewDocument();
    const switchedFocus = await evaluatePreviewWebview<string>('document.activeElement?.id ?? ""');
    assert.notStrictEqual(switchedFocus, 'orientation-portrait', 'document switch does not restore stale focus from the previous document');
      });
    } finally {
      if (useWideMatrixViewport) await resetWorkbenchViewport();
    }
  });

  test('P145 Preview detail links open their matching Inspector sections', async () => withWorkbenchSnapshotRestored(async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: 'bpm: 120\n| C | G | Am | F |\n' });
    await showAndFocus(doc);
    await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
    await waitForPreviewDocument();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const inspector = require('../../inspector/inspectorView').inspectorViewTestProbe;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const settings = require('../../scoreSettingsInspectorController').scoreSettingsInspectorProbe;
    const clickDetailLink = async (id: string, section: 'capo' | 'beginner'): Promise<void> => {
      await evaluatePreviewWebview<void>(`(() => {
        const more = document.getElementById('temporary-score-settings-toggle');
        if (more.getClientRects().length > 0 && more.getAttribute('aria-expanded') !== 'true') more.click();
        document.getElementById('${id}').click();
      })()`);
      for (let attempt = 0; attempt < 100 && inspector.getContext?.()?.section !== section; attempt++) await settle(20);
      assert.strictEqual(inspector.getContext?.()?.kind, 'settings');
      assert.strictEqual(inspector.getContext?.()?.section, section, `${id} routes to Inspector section ${section}`);
      assert.strictEqual(settings.hasSession?.(), true);
    };

    try {
      await clickDetailLink('open-score-settings-capo-from-preview', 'capo');
      await clickDetailLink('open-score-settings-beginner-from-preview', 'beginner');
    } finally {
      if (settings.hasSession?.()) await settings.dispatchMessage?.('settingsCancel');
    }
  }));

  test('P145 rejects unsupported Preview capo messages without ending Inspector drafts or changing overrides', async function () {
    this.timeout(30000);
    await withWorkbenchSnapshotRestored(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const preview = require('../../previewCapo');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const inspector = require('../../inspector/inspectorView').inspectorViewTestProbe;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const settings = require('../../scoreSettingsInspectorController').scoreSettingsInspectorProbe;
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: 'chord A = x02220\n| B |\n' });
    await showAndFocus(doc);
    await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
    await waitForPreviewDocument();
    const capoController = preview.getPreviewCapoController();
    assert.strictEqual(capoController.setTarget(doc, 1), true, 'a supported Preview capo override is established');
    for (let attempt = 0; attempt < 100 && capoController.getState()?.targetCapo !== 1; attempt++) await settle(20);
    const source = doc.getText();
    const overriddenPreview = preview.effectiveDslProbe.previewInput;
    const overrideState = capoController.getState();

    await vscode.commands.executeCommand('guitardsl.editScoreSettings', doc.uri);
    for (let attempt = 0; attempt < 100 && inspector.getContext?.()?.kind !== 'settings'; attempt++) await settle(20);
    assert.strictEqual(settings.hasSession?.(), true, 'the Inspector Settings session is active');
    const beforeSectionChange = preview.previewLifecycleProbe.generation;
    await settings.dispatchMessage!('settingsSelectSection', { nextSection: 'transpose' });
    for (let attempt = 0; attempt < 100 && preview.previewLifecycleProbe.generation === beforeSectionChange; attempt++) await settle(20);
    assert.strictEqual(preview.previewLifecycleProbe.generation, beforeSectionChange + 1, 'changing Inspector section restores its Preview snapshot once');
    await waitForPreviewIdentity({
      documentUri: doc.uri.toString(), documentVersion: doc.version,
      previewGeneration: beforeSectionChange + 1
    });
    const beforeDraft = inspector.getContext?.();
    await settings.dispatchMessage!('settingsSetSemitones', { semitones: 1 });
    const draft = inspector.getContext?.();
    assert.strictEqual(draft.section, 'transpose');
    assert.strictEqual(draft.revision, beforeDraft.revision + 1, 'the Inspector owns a changed, uncommitted Transpose draft');

    const beforeGeneration = preview.previewLifecycleProbe.generation;
    const unsupportedIntent = await evaluatePreviewWebview<string>(`(() => {
      const select = document.getElementById('preview-capo-select');
      const option = Array.from(select.options).find(item => item.value === '2');
      if (!option) return 'missing';
      select.value = '2'; select.dispatchEvent(new Event('change', { bubbles: true }));
      return String(option.disabled);
    })()`);
    assert.strictEqual(unsupportedIntent, 'true', 'the injected capo 2 candidate is host-marked unsupported');
    await settle(150);
    assert.strictEqual(preview.previewLifecycleProbe.generation, beforeGeneration, 'rejecting the unsupported candidate does not rebuild Preview');
    assert.deepStrictEqual(capoController.getState(), overrideState, 'the existing Preview capo override remains unchanged');
    assert.strictEqual(preview.effectiveDslProbe.previewInput, overriddenPreview, 'the effective Preview score remains unchanged');
    assert.strictEqual(settings.hasSession?.(), true, 'the unsupported intent does not invalidate the Inspector draft');
    assert.strictEqual(inspector.getContext?.()?.revision, draft.revision);
    assert.strictEqual(doc.getText(), source, 'neither Preview nor Inspector touches the source DSL');
    await settings.dispatchMessage!('settingsCancel');
    });
  });

  test('P145 accepted Preview intent supersedes a draft and rejects its duplicate stale generation', async function () {
    this.timeout(30000);
    await withWorkbenchSnapshotRestored(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const preview = require('../../previewCapo');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const inspector = require('../../inspector/inspectorView').inspectorViewTestProbe;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const settings = require('../../scoreSettingsInspectorController').scoreSettingsInspectorProbe;
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: 'bpm: 120\n| C | G | Am | F |\n' });
    await showAndFocus(doc);
    await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
    await waitForPreviewDocument();
    await vscode.commands.executeCommand('guitardsl.editScoreSettings', doc.uri);
    for (let attempt = 0; attempt < 100 && inspector.getContext?.()?.kind !== 'settings'; attempt++) await settle(20);
    assert.strictEqual(settings.hasSession?.(), true);
    const beforeSectionChange = preview.previewLifecycleProbe.generation;
    await settings.dispatchMessage!('settingsSelectSection', { nextSection: 'transpose' });
    for (let attempt = 0; attempt < 100 && preview.previewLifecycleProbe.generation === beforeSectionChange; attempt++) await settle(20);
    assert.strictEqual(preview.previewLifecycleProbe.generation, beforeSectionChange + 1);
    await waitForPreviewIdentity({
      documentUri: doc.uri.toString(), documentVersion: doc.version,
      previewGeneration: beforeSectionChange + 1
    });
    await settings.dispatchMessage!('settingsSetSemitones', { semitones: 1 });
    assert.strictEqual(inspector.getContext?.()?.section, 'transpose');
    const beforeGeneration = preview.previewLifecycleProbe.generation;
    const source = doc.getText();
    const acceptedCapo = await evaluatePreviewWebview<string>(`(() => {
      const select = document.getElementById('preview-capo-select');
      const option = Array.from(select.options).find(item => !item.disabled && item.value !== select.value);
      if (!option) return '';
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return option.value;
    })()`);
    assert.ok(acceptedCapo, 'a different supported capo candidate is available');
    for (let attempt = 0; attempt < 100 && preview.previewLifecycleProbe.generation === beforeGeneration; attempt++) await settle(20);
    assert.strictEqual(preview.previewLifecycleProbe.generation, beforeGeneration + 1,
      `the accepted action renders once; its duplicate uses a stale identity (before=${beforeGeneration}, after=${preview.previewLifecycleProbe.generation}, candidate=${acceptedCapo}, state=${JSON.stringify(preview.getPreviewCapoController().getState())}, session=${settings.hasSession?.()})`);
    await waitForPreviewIdentity({
      documentUri: doc.uri.toString(), documentVersion: doc.version,
      previewGeneration: beforeGeneration + 1
    });
    const acceptedControlFocusRestored = await evaluatePreviewWebview<boolean>(`document.activeElement?.id === 'preview-capo-select'`);
    assert.strictEqual(acceptedControlFocusRestored, true,
      'the stale duplicate is a no-op and does not discard the accepted action focus-restoration hint');
    assert.strictEqual(settings.hasSession?.(), false, 'a valid independent Preview action supersedes the Inspector draft');
    assert.strictEqual(preview.getPreviewCapoController().getState()?.targetCapo, Number(acceptedCapo));
    assert.notStrictEqual(preview.effectiveDslProbe.previewInput, source, 'the accepted capo becomes the effective Preview score');
    assert.strictEqual(doc.getText(), source, 'the accepted Preview action leaves source DSL unchanged');
    });
  });

  test('Extension should be active', () => {
    const ext =
      vscode.extensions.getExtension('puchinya.vscode-guitar-dsl') ||
      vscode.extensions.all.find(e => e.packageJSON?.name === 'vscode-guitar-dsl');
    assert.ok(ext, 'Extension should be present');
    assert.strictEqual(ext.isActive, true, 'Extension should be active');
  });

  test('Registered commands should be present', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('guitardsl.showPreview'),
      'Command guitardsl.showPreview should be registered'
    );
    assert.ok(
      commands.includes('guitardsl.exportPdf'),
      'Command guitardsl.exportPdf should be registered'
    );
    assert.ok(
      commands.includes('guitardsl.importGuitarPro'),
      'Command guitardsl.importGuitarPro should be registered'
    );
    assert.ok(
      commands.includes('guitardsl.exportGuitarPro'),
      'Command guitardsl.exportGuitarPro should be registered'
    );
    const extension = vscode.extensions.getExtension('puchinya.vscode-guitar-dsl');
    assert.ok(extension, 'Extension should expose its package contributions');
    const menus = extension.packageJSON.contributes?.menus as Record<string, Array<{ command: string }>>;
    assert.ok(
      !(menus['editor/title'] ?? []).some(item => item.command === 'guitardsl.exportGuitarPro'),
      'Guitar Pro export must not add an editor title toolbar button'
    );
    assert.ok(
      (menus['explorer/context'] ?? []).some(item => item.command === 'guitardsl.exportGuitarPro'),
      'Guitar Pro export should remain available from the Explorer context menu'
    );
    assert.ok(
      commands.includes('guitardsl.editChordDiagram'),
      'Command guitardsl.editChordDiagram should be registered'
    );
    assert.ok(
      commands.includes('guitardsl.transcribeYouTube'),
      'Command guitardsl.transcribeYouTube should be registered'
    );
    assert.ok(
      commands.includes('guitardsl.transcribeAudio'),
      'Command guitardsl.transcribeAudio should be registered'
    );
    assert.ok(
      commands.includes('guitardsl.setGeminiApiKey'),
      'Command guitardsl.setGeminiApiKey should be registered'
    );
    assert.ok(
      commands.includes('guitardsl.clearGeminiApiKey'),
      'Command guitardsl.clearGeminiApiKey should be registered'
    );
    assert.ok(
      commands.includes('guitardsl.applyStrummingPattern'),
      'Command guitardsl.applyStrummingPattern should be registered'
    );
    assert.ok(commands.includes('guitardsl.openHelp'), 'Command guitardsl.openHelp should be registered');
    assert.ok(commands.includes('guitardsl.suggestChordProgression'), 'Chord progression suggestions should be registered');
    for (const command of [
      'guitardsl.progression.chooseCandidate', 'guitardsl.progression.play', 'guitardsl.progression.stop',
      'guitardsl.progression.showOriginal', 'guitardsl.progression.showCandidate',
      'guitardsl.progression.apply', 'guitardsl.progression.close'
    ]) assert.ok(commands.includes(command), `${command} should be registered as an independent editor action`);
    assert.ok(commands.includes('guitardsl.newDocumentFromTemplate'), 'Command guitardsl.newDocumentFromTemplate should be registered');
    assert.ok(commands.includes('guitardsl.openSample'), 'Command guitardsl.openSample should be registered');
  });

  test('ED-05 empty chord completion and editor command use the target key after @key', async () => {
    const source = 'key: C\n| C | Dm | Em | F |\n@key: D\n|   |';
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: source });
    const editor = await showAndFocus(doc);
    const completion = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(3, 3)
    );
    const items = completion?.items.filter(item => /^0[0-4]$/.test(item.sortText ?? '') && item.documentation instanceof vscode.MarkdownString) ?? [];
    assert.ok(items.length > 0, 'an empty chord cell after @key still offers completions');
    assert.ok(items.every(item => (item.documentation as vscode.MarkdownString).value.startsWith('D')),
      'completion rationale uses the target measure D key, not the previous C key');

    editor.selection = new vscode.Selection(new vscode.Position(3, 2), new vscode.Position(3, 2));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const progressionAssistant = require('../../progressionAssistant');
    await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
    const session = progressionAssistant.progressionAssistantProbe.getSession();
    assert.strictEqual(progressionAssistant.progressionAssistantProbe.getLastResolvedTarget().key, 'D',
      'the editor command passes the current target measure key to candidate generation');
    assert.strictEqual(session.target.operation, 'append');
    assert.ok(session.candidates.length > 0 && session.candidates.every((candidate: { key: string }) => candidate.key === 'D'),
      'the Inspector model also uses the pending D key after @key');
    assert.strictEqual(doc.getText(), source, 'target resolution does not change the source');
  });

  test('ED-05 editor command accepts whitespace after a sharp chord and rejects a real trailing comment', async () => {
    const progressionAssistant = require('../../progressionAssistant');
    const source = 'key: C\n| F#   | G | Am | F |';
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: source });
    const editor = await showAndFocus(doc);
    editor.selection = new vscode.Selection(new vscode.Position(1, 5), new vscode.Position(1, 5));
    await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
    const session = progressionAssistant.progressionAssistantProbe.getSession();
    assert.ok(session, 'a cursor in whitespace after F# still resolves the first chord cell');
    assert.strictEqual(session.target.startMeasure, 0);
    await vscode.commands.executeCommand('guitardsl.progression.close');

    const commentSource = 'key: C\n| F#   # comment | G | Am | F |';
    const commentDoc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: commentSource });
    const commentEditor = await showAndFocus(commentDoc);
    const commentOffset = commentSource.indexOf('# comment') + 2;
    commentEditor.selection = new vscode.Selection(commentDoc.positionAt(commentOffset), commentDoc.positionAt(commentOffset));
    await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
    assert.strictEqual(progressionAssistant.progressionAssistantProbe.getSession(), undefined,
      'a real trailing comment does not create an assistant session');
    assert.strictEqual(commentDoc.getText(), commentSource, 'target checks do not edit the score');
    await vscode.commands.executeCommand('guitardsl.progression.close');
  });

  test('ED-01/ED-02 CodeLens opens the Inspector and candidate selection only decorates the editor', async () => {
    const source = 'key: C\n[Verse]\n| C | Dm | Em | F |\n[Chorus]\n| G | Am | F | C |';
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: source });
    const editor = await showAndFocus(doc, vscode.ViewColumn.One);
    assert.ok(await editor.edit(edit => edit.insert(doc.positionAt(doc.getText().length), '\n# pre-existing edit')));
    await settle(50);
    const codeLenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', doc.uri);
    const progressionLenses = (codeLenses ?? []).filter(lens => lens.command?.command === 'guitardsl.suggestChordProgression');
    assert.ok(progressionLenses.some(lens => lens.range.start.line === 2), 'a chord-measure line has a Suggest progression CodeLens');
    assert.ok(progressionLenses.some(lens => lens.range.start.line === 4), 'another chord-measure line has a CodeLens');
    assert.ok(progressionLenses.every(lens => [2, 4].includes(lens.range.start.line)), 'unrelated section and key lines have no action');

    editor.selection = new vscode.Selection(new vscode.Position(2, 3), new vscode.Position(2, 3));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const previewCapo = require('../../previewCapo');
    const generationBeforeSelection = previewCapo.previewLifecycleProbe.generation;
    const previewDocumentBeforeSelection = previewCapo.previewLifecycleProbe.currentDocumentUri;
    const originalText = doc.getText();
    const originalVersion = doc.version;
    const entry = progressionLenses.find(lens => lens.range.start.line === 2)!;
    await vscode.commands.executeCommand(entry.command!.command, ...(entry.command!.arguments ?? []));
    assert.strictEqual(doc.getText(), originalText, 'candidate selection leaves the score bytes unchanged');
    assert.strictEqual(doc.version, originalVersion, 'selection leaves document version unchanged');
    assert.strictEqual(previewCapo.previewLifecycleProbe.generation, generationBeforeSelection,
      'selection does not open or rebuild Preview');
    assert.strictEqual(previewCapo.previewLifecycleProbe.currentDocumentUri, previewDocumentBeforeSelection,
      'selection does not redirect Preview to the selected editor');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const progressionAssistant = require('../../progressionAssistant');
    const session = progressionAssistant.progressionAssistantProbe.getSession();
    const inspector = progressionAssistant.progressionAssistantProbe.getInspectorContext();
    assert.strictEqual(session.source, originalText);
    assert.strictEqual(session.uri, doc.uri.toString());
    assert.strictEqual(inspector.kind, 'progression');
    assert.strictEqual(inspector.auditionMode, 'melody', 'the default audition mode is the melody accompaniment');
    assert.deepStrictEqual(inspector.target, { startMeasure: 0, bars: 4, operation: 'replace' });
    assert.ok(inspector.candidates.length > 0 && inspector.candidates.length <= 5, 'Inspector shows up to five candidates');
    assert.ok(inspector.candidates.every((candidate: { chords: string[]; scoreText: string; rationale: string }) =>
      candidate.chords.length > 0 && !!candidate.scoreText && !!candidate.rationale),
    'each Inspector row includes a chord sequence, score, and tonal rationale');
    const nextCandidate = session.candidates.find((candidate: { id: string }) => candidate.id !== session.activeCandidateId);
    assert.ok(nextCandidate, 'at least one alternate candidate is available');
    progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage({
      command: 'progressionCandidateChanged', candidateId: nextCandidate.id, selectedCandidateId: nextCandidate.id
    });
    await settle(50);
    assert.strictEqual(progressionAssistant.progressionAssistantProbe.getSession().activeCandidateId, nextCandidate.id,
      'selecting a candidate updates the host session');
    if (process.env.GUITARDSL_E2E_CAPTURE_SCREENSHOTS === '1') {
      const requestedLocale = process.env.GUITARDSL_E2E_LOCALE;
      if (requestedLocale) {
        const requestedLanguagePack = requestedLocale.toLowerCase().startsWith('ja')
          ? vscode.extensions.getExtension('MS-CEINTL.vscode-language-pack-ja')
          : undefined;
        const nlsLocale = (() => {
          try {
            return JSON.parse(process.env.VSCODE_NLS_CONFIG ?? '{}').locale ?? '<unset>';
          } catch {
            return '<invalid>';
          }
        })();
        assert.ok(vscode.env.language.toLowerCase().startsWith(requestedLocale.toLowerCase()),
          `screenshot locale ${requestedLocale} must match VS Code locale ${vscode.env.language}; NLS locale ${nlsLocale}; portable profile ${process.env.VSCODE_PORTABLE ?? '<unset>'}; Japanese language pack ${requestedLanguagePack?.packageJSON.version ?? 'not visible to the Extension Host'}`);
      }
      const requestedTheme = process.env.GUITARDSL_E2E_THEME;
      if (requestedTheme) {
        await vscode.workspace.getConfiguration('workbench').update('colorTheme', requestedTheme, vscode.ConfigurationTarget.Global);
        await settle(300);
      }
      const captureWaitMs = Number(process.env.GUITARDSL_E2E_CAPTURE_WAIT_MS ?? 0);
      if (Number.isFinite(captureWaitMs) && captureWaitMs > 0) await settle(Math.min(captureWaitMs, 5000));
      const locale = (requestedLocale ?? vscode.env.language).toLowerCase().split('-')[0];
      const theme = /light/i.test(requestedTheme ?? '') ? 'light' : 'dark';
      const tag = process.env.GUITARDSL_E2E_SCREENSHOT_TAG;
      const suffix = tag && /^[a-z0-9-]+$/i.test(tag) ? `-${tag}` : '';
      const screenshotName = `inspector-${locale}-${theme}-narrow${suffix}`;
      await vscode.commands.executeCommand('guitardsl.openInspector');
      await settle(200);
      await captureWorkbenchScreenshot(`${screenshotName}.png`);
      await vscode.commands.executeCommand('workbench.action.focusAuxiliaryBar');
      const keyboardCandidate = session.candidates.find((candidate: { id: string }) => candidate.id !== session.activeCandidateId);
      assert.ok(keyboardCandidate, 'keyboard selection has an alternate candidate');
      const candidateFocusRetained = await activateInspectorControlWithKeyboard('candidate', keyboardCandidate.id);
      assert.ok(candidateFocusRetained, 'Tab and Space select a candidate and retain focus on its keyed button after the host update');
      await settle(100);
      assert.strictEqual(session.activeCandidateId, keyboardCandidate.id,
        'Space selects the focused candidate without mouse input');
      const sequentialCandidate = session.candidates.find((candidate: { id: string }) => candidate.id !== keyboardCandidate.id);
      assert.ok(sequentialCandidate, 'a second candidate is available for a sequential keyboard action');
      const sequentialFocusRetained = await activateInspectorControlWithKeyboard('candidate', sequentialCandidate.id);
      assert.ok(sequentialFocusRetained, 'a second Tab and Space action remains usable after the first candidate update');
      await settle(100);
      assert.strictEqual(session.activeCandidateId, sequentialCandidate.id,
        'the second sequential keyboard action updates the host candidate');
      assert.strictEqual(progressionAssistant.progressionAssistantProbe.getInspectorContext().target.bars, 4,
        'the keyboard regression begins at the default four-bar target');
      const barsFocusRetained = await activateInspectorControlWithKeyboard('bars', '8');
      assert.ok(barsFocusRetained, 'Space changes four bars to eight and retains focus on the updated choice');
      await settle(100);
      assert.strictEqual(progressionAssistant.progressionAssistantProbe.getInspectorContext().target.bars, 8,
        'the keyboard action updates the host target to eight bars');
      await captureWorkbenchScreenshot(`${screenshotName}-kbd.png`);
      await scrollInspectorToControls();
      await settle(200);
      await captureWorkbenchScreenshot(`${screenshotName}-kbd-controls.png`);
    }
    await undoIn(doc);
    assert.strictEqual(doc.getText(), source, 'candidate selection adds no undo step ahead of a pre-existing edit');
  });

  test('ED-02/ED-03 Inspector controls recompute candidates and preserve audition speed', async () => {
    const source = 'key: C\n| C | Dm | Em | F |';
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: source });
    const editor = await showAndFocus(doc, vscode.ViewColumn.One);
    editor.selection = new vscode.Selection(new vscode.Position(1, 3), new vscode.Position(1, 3));
    await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const progressionAssistant = require('../../progressionAssistant');
    const currentSession = progressionAssistant.progressionAssistantProbe.getSession();
    assert.ok(currentSession, 'the Inspector candidate session is active immediately');
    const originalVersion = doc.version;
    const originalText = doc.getText();

    progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage({ command: 'progressionSpeedChanged', speed: 75 });
    await settle(50);
    progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage({ command: 'progressionSideChanged', side: 'A' });
    await settle(50);
    assert.strictEqual(progressionAssistant.progressionAssistantProbe.getSession().auditionSpeed, 75,
      'Inspector A/B updates retain the selected 75% speed in the host session');
    assert.strictEqual(progressionAssistant.progressionAssistantProbe.getSession().side, 'A');
    const nextCandidate = currentSession.candidates.find((candidate: { id: string }) => candidate.id !== currentSession.activeCandidateId);
    assert.ok(nextCandidate);
    progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage({
      command: 'progressionCandidateChanged', candidateId: nextCandidate.id, selectedCandidateId: nextCandidate.id
    });
    await settle(50);
    const nextSession = progressionAssistant.progressionAssistantProbe.getSession();
    assert.strictEqual(nextSession.auditionSpeed, 75, 'candidate rerender retains 75% speed');
    assert.strictEqual(nextSession.activeCandidateId, nextCandidate.id);
    assert.strictEqual(nextSession.side, 'B', 'a newly selected candidate is shown as B');
    progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage({ command: 'progressionSetOperation', operation: 'append' });
    await settle(50);
    assert.strictEqual(nextSession.target.operation, 'append', 'operation changes are recomputed by the host');
    assert.strictEqual(nextSession.target.startMeasure, 4, 'append targets the safe body end');
    progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage({ command: 'progressionSetBars', bars: 8 });
    await settle(50);
    assert.strictEqual(nextSession.target.bars, 8, 'bar-length changes are recomputed by the host');
    assert.ok(progressionAssistant.progressionAssistantProbe.getInspectorContext().candidates.length <= 5);
    assert.strictEqual(doc.getText(), originalText, 'A/B and candidate changes do not edit the source');
    assert.strictEqual(doc.version, originalVersion, 'control changes do not alter document version');
    await vscode.commands.executeCommand('guitardsl.progression.close');
  });

  const audioE2eTest = process.env.GUITARDSL_E2E_CAPTURE_SCREENSHOTS === '1' ? test : test.skip;
  audioE2eTest('ED-08 Inspector Play starts local audio after locking Preview and Stop releases the lease', async () => {
    const source = [
      'key: C',
      'bpm: 120',
      'time: 4/4',
      '| C | Dm | Em | F |',
      'mel: | c6/4 d6/4 e6/4 f6/4 | g6/4 a6/4 b6/4 c7/4 | d6/4 e6/4 f6/4 g6/4 | a6/4 b6/4 c7/4 d7/4 |'
    ].join('\n');
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: source });
    const editor = await showAndFocus(doc);
    await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
    await settle(250);
    await showAndFocus(doc);
    editor.selection = new vscode.Selection(new vscode.Position(3, 3), new vscode.Position(3, 3));
    await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
    await settle(250);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const session = require('../../progressionAssistant').progressionAssistantProbe.getSession();
    assert.strictEqual(session?.uri, doc.uri.toString(), 'Inspector opened a session for this test document');
    assert.strictEqual(session?.version, doc.version, 'Inspector session matches the current source version');

    assert.strictEqual(await activateInspectorControlWithKeyboard('play', 'play'), true,
      'a real keyboard activation in the Inspector starts its local AudioContext');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const audioLeaseCoordinator = require('../../extension').progressionAudioLeaseProbe.coordinator;
    assert.ok(audioLeaseCoordinator.activeLeaseId,
      'Inspector playback begins only after the open Preview acknowledges that it stopped and locked');
    const requestedLocale = (process.env.GUITARDSL_E2E_LOCALE ?? vscode.env.language).toLowerCase().split('-')[0];
    const requestedTheme = process.env.GUITARDSL_E2E_THEME ?? '';
    const theme = /light/i.test(requestedTheme) ? 'light' : 'dark';
    await vscode.commands.executeCommand('notifications.clearAll');
    await scrollInspectorToControls();
    await settle(100);
    await captureWorkbenchScreenshot(`inspector-${requestedLocale}-${theme}-audio-playing.png`);

    assert.strictEqual(await activateInspectorControlWithKeyboard('stop', 'stop'), true,
      'Inspector Stop terminates its local audio scheduler');
    await settle(100);
    assert.strictEqual(audioLeaseCoordinator.activeLeaseId, undefined,
      'Preview unlocks after Inspector acknowledges that audio has stopped');
    await vscode.commands.executeCommand('guitardsl.progression.close');
  });

  audioE2eTest('S135-11 opening Settings waits for the real Inspector Stop acknowledgement', async () => {
    const { doc, source } = await openProgressionForSettingsAudioTest();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const inspectorView = require('../../inspector/inspectorView').inspectorViewTestProbe.resolvedView as vscode.WebviewView;
    assert.ok(inspectorView, 'the real Inspector Webview is active');
    const acknowledgements: Array<{ command?: unknown; leaseId?: unknown }> = [];
    const subscription = inspectorView.webview.onDidReceiveMessage(message => {
      const value = message as { command?: unknown; leaseId?: unknown };
      if (value.command === 'progressionAudioStopped') acknowledgements.push(value);
    });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const audioLease = require('../../extension').progressionAudioLeaseProbe.coordinator;
    try {
      assert.strictEqual(await activateInspectorControlWithKeyboard('play', 'play'), true,
        'a real Inspector gesture starts the local audition');
      const leaseId = audioLease.activeLeaseId as string | undefined;
      assert.ok(leaseId, 'the audition owns the Preview exclusion lease');
      await vscode.commands.executeCommand('guitardsl.editScoreSettings', doc.uri);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const inspector = require('../../inspector/inspectorView').inspectorViewTestProbe;
      for (let attempt = 0; attempt < 100 && inspector.getContext?.()?.kind !== 'settings'; attempt++) await settle(20);
      assert.strictEqual(inspector.getContext?.()?.kind, 'settings', 'Settings opens after the Inspector stops');
      assert.ok(acknowledgements.some(message => message.leaseId === leaseId),
        'the real Inspector delivered its Stopped acknowledgement before Settings opened');
      assert.strictEqual(audioLease.activeLeaseId, undefined, 'the exclusive lease releases only after local silence is confirmed');
      assert.strictEqual(doc.getText(), source, 'opening Settings leaves the document unchanged');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      await require('../../scoreSettingsInspectorController').scoreSettingsInspectorProbe.dispatchMessage('settingsCancel');
    } finally {
      subscription.dispose();
      await vscode.commands.executeCommand('guitardsl.progression.close');
    }
  });

  audioE2eTest('S135-11 a failed Stop message delivery keeps Settings closed and Preview locked', async () => {
    const { doc, source } = await openProgressionForSettingsAudioTest();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const inspectorViewProbe = require('../../inspector/inspectorView').inspectorViewTestProbe;
    const inspectorView = inspectorViewProbe.resolvedView as vscode.WebviewView | undefined;
    assert.ok(inspectorView, 'the real Inspector Webview is active');
    const originalPostMessage = inspectorView.webview.postMessage;
    const postMessage = originalPostMessage.bind(inspectorView.webview);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const audioLease = require('../../extension').progressionAudioLeaseProbe.coordinator;
    let rejectedStopMessages = 0;
    inspectorView.webview.postMessage = message => {
      if ((message as { command?: unknown }).command === 'progressionAudioStop') {
        rejectedStopMessages++;
        return Promise.resolve(false);
      }
      return postMessage(message);
    };

    try {
      assert.strictEqual(await activateInspectorControlWithKeyboard('play', 'play'), true,
        'a real Inspector gesture starts the local audition');
      const leaseId = audioLease.activeLeaseId as string | undefined;
      assert.ok(leaseId, 'the active audition owns the Preview exclusion lease');

      await vscode.commands.executeCommand('guitardsl.editScoreSettings', doc.uri);

      assert.strictEqual(rejectedStopMessages, 1, 'the Settings transition attempted a Stop message');
      assert.strictEqual(audioLease.activeLeaseId, leaseId,
        'a false delivery result retains the active lease and Preview exclusion');
      assert.strictEqual(inspectorViewProbe.getContext?.().kind, 'progression',
        'Settings stays closed when Stop delivery fails');
      assert.strictEqual(await evaluateInspectorWebview<boolean>(
        'document.getElementById("progression-stop")?.disabled === false'
      ), true, 'the Inspector continues the active audition until it acknowledges Stop');
      assert.strictEqual(doc.getText(), source, 'the failed transition leaves the document unchanged');

      inspectorView.webview.postMessage = originalPostMessage;
      assert.strictEqual(await activateInspectorControlWithKeyboard('stop', 'stop'), true,
        'the active Inspector audition can still be stopped after restoring message delivery');
      for (let attempt = 0; attempt < 100 && audioLease.activeLeaseId; attempt++) await settle(20);
      assert.strictEqual(audioLease.activeLeaseId, undefined, 'the real Stopped acknowledgement releases the lease');
    } finally {
      inspectorView.webview.postMessage = originalPostMessage;
      await vscode.commands.executeCommand('guitardsl.progression.close');
    }
  });

  audioE2eTest('S135-11 a Stop acknowledgement timeout keeps Settings closed and Preview locked', async () => {
    const { doc, source } = await openProgressionForSettingsAudioTest();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const inspectorViewProbe = require('../../inspector/inspectorView').inspectorViewTestProbe;
    const inspectorView = inspectorViewProbe.resolvedView as vscode.WebviewView | undefined;
    assert.ok(inspectorView, 'the real Inspector Webview is active');
    const originalPostMessage = inspectorView.webview.postMessage;
    const postMessage = originalPostMessage.bind(inspectorView.webview);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const audioLease = require('../../extension').progressionAudioLeaseProbe.coordinator;
    let suppressedStopMessages = 0;
    inspectorView.webview.postMessage = message => {
      if ((message as { command?: unknown }).command === 'progressionAudioStop') {
        suppressedStopMessages++;
        return Promise.resolve(true);
      }
      return postMessage(message);
    };

    try {
      assert.strictEqual(await activateInspectorControlWithKeyboard('play', 'play'), true,
        'a real Inspector gesture starts the local audition');
      const leaseId = audioLease.activeLeaseId as string | undefined;
      assert.ok(leaseId, 'the active audition owns the Preview exclusion lease');

      const stopStartedAt = Date.now();
      await vscode.commands.executeCommand('guitardsl.editScoreSettings', doc.uri);

      assert.strictEqual(suppressedStopMessages, 1, 'the Settings transition attempted one Stop message');
      assert.ok(Date.now() - stopStartedAt >= 2000, 'Settings waited for the bounded Stop acknowledgement timeout');
      assert.strictEqual(audioLease.activeLeaseId, leaseId,
        'an unacknowledged Stop retains the active lease and Preview exclusion');
      assert.strictEqual(inspectorViewProbe.getContext?.().kind, 'progression',
        'Settings stays closed without proof that the Inspector stopped');
      assert.strictEqual(await evaluateInspectorWebview<boolean>(
        'document.getElementById("progression-stop")?.disabled === false'
      ), true, 'the Inspector continues the active audition until it acknowledges Stop');
      assert.strictEqual(doc.getText(), source, 'the timed-out transition leaves the document unchanged');

      inspectorView.webview.postMessage = originalPostMessage;
      assert.strictEqual(await activateInspectorControlWithKeyboard('stop', 'stop'), true,
        'the Inspector can still send a real Stop acknowledgement after the timeout');
      for (let attempt = 0; attempt < 100 && audioLease.activeLeaseId; attempt++) await settle(20);
      assert.strictEqual(audioLease.activeLeaseId, undefined, 'the late real Stopped acknowledgement releases the lease');
    } finally {
      inspectorView.webview.postMessage = originalPostMessage;
      await vscode.commands.executeCommand('guitardsl.progression.close');
    }
  });

  audioE2eTest('ED-09 Stop cancels a granted audition while AudioContext resume is pending', async () => {
    const source = [
      'key: C',
      'bpm: 120',
      'time: 4/4',
      '| C | Dm | Em | F |',
      'mel: | c6/4 d6/4 e6/4 f6/4 | g6/4 a6/4 b6/4 c7/4 | d6/4 e6/4 f6/4 g6/4 | a6/4 b6/4 c7/4 d7/4 |'
    ].join('\n');
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: source });
    const editor = await showAndFocus(doc);
    await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
    await settle(250);
    await showAndFocus(doc);
    editor.selection = new vscode.Selection(new vscode.Position(3, 3), new vscode.Position(3, 3));
    await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
    await settle(250);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const inspectorViewProbe = require('../../inspector/inspectorView').inspectorViewTestProbe;
    const inspectorView = inspectorViewProbe.resolvedView as vscode.WebviewView | undefined;
    assert.ok(inspectorView, 'the progression session resolves its production Inspector Webview');
    const originalHtml = inspectorView.webview.html;
    const protocolMessages: Array<{ command?: unknown; leaseId?: unknown; requestId?: unknown }> = [];
    const subscription = inspectorView.webview.onDidReceiveMessage((message: unknown) => {
      const candidate = message as { command?: unknown; leaseId?: unknown; requestId?: unknown };
      if (typeof candidate.command === 'string' && candidate.command.startsWith('progressionAudio')) protocolMessages.push(candidate);
    });

    try {
      inspectorView.webview.html = instrumentInspectorDeferredAudioResume(originalHtml);
      await settle(150);
      assert.strictEqual(await evaluateInspectorWebview<boolean>('Boolean(document.getElementById("guitardsl-e2e-audio-probe"))'), true,
        'the selected Inspector renderer installed its deferred-resume probe');
      assert.strictEqual(await activateInspectorControlWithKeyboard('play', 'play', false), true,
        'Play is activated by a real keyboard gesture while the test shim holds resume completion');
      await waitForInspectorAudioMetrics(metrics => metrics.resumeRequests > 0);
      const grant = await waitForInspectorAudioMetrics(metrics => metrics.grants > 0);
      assert.strictEqual(grant.oscillatorCreations, 0, 'the grant is waiting for resume and has not scheduled audio');

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const audioLeaseCoordinator = require('../../extension').progressionAudioLeaseProbe.coordinator;
      const cancelledLeaseId = audioLeaseCoordinator.activeLeaseId;
      assert.ok(cancelledLeaseId, 'the Host granted an exclusive lease before the deferred resume resolves');
      assert.strictEqual(await activateInspectorControlWithKeyboard('stop', 'stop'), true,
        'Stop reaches the Inspector while the granted start is awaiting resume');
      for (let attempt = 0; attempt < 100 && !protocolMessages.some(message => message.command === 'progressionAudioStopped'); attempt++) await settle(20);
      assert.strictEqual(protocolMessages.filter(message => message.command === 'progressionAudioStopped').length, 1,
        'the Inspector acknowledges local silence for the pending grant');
      assert.strictEqual(audioLeaseCoordinator.activeLeaseId, undefined,
        'the Host releases the lease after the stop acknowledgement');

      // The Host must now accept Preview commands; Stop is harmless and proves the lease no longer blocks Preview.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const previewLifecycleProbe = require('../../previewCapo').previewLifecycleProbe;
      previewLifecycleProbe.lastPlaybackAction = undefined;
      await vscode.commands.executeCommand('guitardsl.playback.stop');
      assert.strictEqual(previewLifecycleProbe.lastPlaybackAction, 'stop', 'Preview accepts commands after the lease is released');

      await inspectorView.webview.postMessage({ command: 'inspectorE2eResolveResume' });
      const resumed = await waitForInspectorAudioMetrics(metrics => metrics.resumeResolutions === 1);
      await settle(100);
      assert.strictEqual(resumed.oscillatorCreations, 0, 'resolving the stale resume does not create any audio nodes');
      assert.strictEqual(protocolMessages.some(message => message.command === 'progressionAudioStarted'), false,
        'the cancelled start never acknowledges that audio began');
      assert.strictEqual(audioLeaseCoordinator.activeLeaseId, undefined);

      assert.strictEqual(await activateInspectorControlWithKeyboard('play', 'play', false), true,
        'a fresh audition can start after the cancelled lease has been released');
      await waitForInspectorAudioMetrics(metrics => metrics.resumeRequests >= 2 && metrics.grants >= 2);
      const newerLeaseId = audioLeaseCoordinator.activeLeaseId;
      assert.ok(newerLeaseId && newerLeaseId !== cancelledLeaseId, 'the second audition owns a different lease');
      await inspectorView.webview.postMessage({ command: 'inspectorE2eResolveResume' });
      await waitForInspectorAudioMetrics(metrics => metrics.resumeResolutions === 2 && metrics.oscillatorCreations > 0);
      for (let attempt = 0; attempt < 100 && !protocolMessages.some(message => message.command === 'progressionAudioStarted' && message.leaseId === newerLeaseId); attempt++) await settle(20);
      assert.ok(protocolMessages.some(message => message.command === 'progressionAudioStarted' && message.leaseId === newerLeaseId),
        'the newer audition becomes active after its own resume resolves');

      const stopEnabledBeforeStaleStart = await evaluateInspectorWebview<boolean>(
        'document.getElementById("progression-stop")?.disabled === false'
      );
      assert.strictEqual(stopEnabledBeforeStaleStart, true, 'the current audition exposes an enabled Stop control');
      await inspectorView.webview.postMessage({
        command: 'progressionAudioStart',
        leaseId: cancelledLeaseId,
        requestId: 'stale-request-from-cancelled-session',
        playback: { events: [{ kind: 'pitched', source: 'melody', timeSeconds: 0, durationSeconds: 1, midiNotes: [60] }] }
      });
      for (let attempt = 0; attempt < 100 && !protocolMessages.some(message =>
        message.command === 'progressionAudioFailed' && message.leaseId === cancelledLeaseId && message.requestId === 'stale-request-from-cancelled-session'); attempt++) await settle(20);
      assert.ok(protocolMessages.some(message =>
        message.command === 'progressionAudioFailed' && message.leaseId === cancelledLeaseId && message.requestId === 'stale-request-from-cancelled-session'),
      'the delayed stale start is rejected and acknowledged against its old lease');
      assert.strictEqual(audioLeaseCoordinator.activeLeaseId, newerLeaseId,
        'the stale start acknowledgement cannot release the newer lease');
      assert.strictEqual(await evaluateInspectorWebview<boolean>(
        'document.getElementById("progression-stop")?.disabled === false'
      ), true, 'the stale start does not cancel the newer local audition');

      assert.strictEqual(await activateInspectorControlWithKeyboard('stop', 'stop'), true,
        'the newer audition can still be stopped normally');
      for (let attempt = 0; attempt < 100 && !protocolMessages.some(message =>
        message.command === 'progressionAudioStopped' && message.leaseId === newerLeaseId); attempt++) await settle(20);
      assert.ok(protocolMessages.some(message => message.command === 'progressionAudioStopped' && message.leaseId === newerLeaseId),
        'the newer lease receives its own Stopped acknowledgement');
      assert.strictEqual(audioLeaseCoordinator.activeLeaseId, undefined, 'the newer lease is released after its own Stop');
    } finally {
      subscription.dispose();
      await inspectorView.webview.postMessage({ command: 'inspectorE2eResolveResume' });
      await vscode.commands.executeCommand('guitardsl.progression.close');
      inspectorView.webview.html = originalHtml;
      await settle(100);
    }
  });

  audioE2eTest('ED-10 changing documents updates Inspector context before invalidation and still releases its lease', async () => {
    const source = [
      'key: C',
      'bpm: 120',
      'time: 4/4',
      '| C | Dm | Em | F |',
      'mel: | c6/4 d6/4 e6/4 f6/4 | g6/4 a6/4 b6/4 c7/4 | d6/4 e6/4 f6/4 g6/4 | a6/4 b6/4 c7/4 d7/4 |'
    ].join('\n');
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: source });
    const editor = await showAndFocus(doc);
    await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
    await settle(250);
    await showAndFocus(doc);
    editor.selection = new vscode.Selection(new vscode.Position(3, 3), new vscode.Position(3, 3));
    await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
    await settle(250);
    assert.strictEqual(await activateInspectorControlWithKeyboard('play', 'play'), true);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const progressionProbe = require('../../progressionAssistant').progressionAssistantProbe;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const audioLeaseCoordinator = require('../../extension').progressionAudioLeaseProbe.coordinator;
    const controller = progressionProbe.controller;
    const previewController = controller.preview;
    const originalStop = previewController.stop;
    let contextAtStop: { kind: string; uri?: string } | undefined;
    previewController.stop = (uri: string) => {
      if (uri === doc.uri.toString() && !contextAtStop) contextAtStop = progressionProbe.getInspectorContext();
      return originalStop.call(previewController, uri);
    };

    try {
      assert.strictEqual(audioLeaseCoordinator.activeSessionUri, doc.uri.toString(), 'the active lease records its owning document');
      const nextDoc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: 'key: G\n| G | D | Em | C |' });
      await showAndFocus(nextDoc);
      for (let attempt = 0; attempt < 100 && progressionProbe.getSession(); attempt++) await settle(20);
      for (let attempt = 0; attempt < 100 && audioLeaseCoordinator.activeLeaseId; attempt++) await settle(20);

      assert.strictEqual(contextAtStop?.kind, 'document', 'the Inspector already shows the new document when session invalidation calls Preview.stop');
      assert.strictEqual(contextAtStop?.uri, nextDoc.uri.toString());
      assert.strictEqual(progressionProbe.getSession(), undefined, 'switching documents clears the old progression session');
      assert.strictEqual(progressionProbe.getInspectorContext().kind, 'document');
      assert.strictEqual(progressionProbe.getInspectorContext().uri, nextDoc.uri.toString());
      assert.strictEqual(audioLeaseCoordinator.activeLeaseId, undefined, 'the pending stop acknowledgement releases the old document lease');

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const previewLifecycleProbe = require('../../previewCapo').previewLifecycleProbe;
      previewLifecycleProbe.lastPlaybackAction = undefined;
      await vscode.commands.executeCommand('guitardsl.playback.stop');
      assert.strictEqual(previewLifecycleProbe.lastPlaybackAction, 'stop', 'Preview accepts commands after context-first invalidation');
    } finally {
      previewController.stop = originalStop;
      await vscode.commands.executeCommand('guitardsl.progression.close');
    }
  });

  test('Inspector messages from an earlier session are ignored when URI and version are unchanged', async () => {
    const source = 'key: C\n| C | Dm | Em | F |\n| G | Am | C | G |';
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: source });
    const editor = await showAndFocus(doc);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const progressionAssistant = require('../../progressionAssistant');
    const controller = progressionAssistant.progressionAssistantProbe.controller;
    const originalPreview = controller.preview;
    let renderCount = 0;
    let restoreCount = 0;
    controller.preview = {
      render: () => { renderCount++; },
      stop: () => undefined,
      restore: () => { restoreCount++; }
    };
    try {
      editor.selection = new vscode.Selection(new vscode.Position(1, 3), new vscode.Position(1, 3));
      await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
      const session1 = progressionAssistant.progressionAssistantProbe.getSession();
      assert.ok(session1, 'the first target creates session S1');
      const inspectorGeneration1 = controller.inspector.currentGeneration;
      const delayedS1Messages = [
        { command: 'progressionSideChanged', side: 'A' },
        { command: 'progressionSpeedChanged', speed: 50 },
        { command: 'progressionCandidateChanged', candidateId: session1.activeCandidateId, selectedCandidateId: session1.activeCandidateId },
        { command: 'progressionDismiss' }
      ].map(message => ({
        ...message, generation: inspectorGeneration1,
        sessionUri: session1.uri, sessionVersion: session1.version,
        sessionGeneration: session1.sessionGeneration
      }));

      editor.selection = new vscode.Selection(new vscode.Position(2, 3), new vscode.Position(2, 3));
      await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
      const session2 = progressionAssistant.progressionAssistantProbe.getSession();
      assert.ok(session2, 'the second target creates session S2');
      assert.strictEqual(session2.uri, session1.uri, 'S1 and S2 use the same document URI');
      assert.strictEqual(session2.version, session1.version, 'S1 and S2 use the same unchanged document version');
      assert.strictEqual(session2.target.operation, 'replace', 'S2 prefers the safe four-bar replacement at the cursor');
      assert.strictEqual(session2.target.startMeasure, 4, 'S2 targets the second four-bar block');
      assert.notStrictEqual(session2.sessionGeneration, session1.sessionGeneration, 'each host session has a distinct generation');

      progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage({ command: 'progressionSpeedChanged', speed: 125 });
      await settle(50);
      const activeCandidateId = session2.activeCandidateId;
      const renderCountBeforeStaleMessages = renderCount;
      for (const message of delayedS1Messages) progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage(message);
      await settle(50);

      assert.strictEqual(progressionAssistant.progressionAssistantProbe.getSession(), session2,
        'delayed S1 dismiss does not clear active session S2');
      assert.strictEqual(controller.hasActiveSession(doc.uri.toString()), true, 'S2 remains active for its document');
      assert.strictEqual(session2.activeCandidateId, activeCandidateId, 'S2 candidate selection is unchanged');
      assert.strictEqual(session2.side, 'B', 'S1 A/B message cannot change S2 side');
      assert.strictEqual(session2.auditionSpeed, 125, 'S1 speed message cannot change S2 audition speed');
      assert.strictEqual(renderCount, renderCountBeforeStaleMessages, 'stale messages do not rerender the current Preview');
      assert.strictEqual(restoreCount, 0, 'stale dismiss does not restore or close the Preview');
      assert.strictEqual(doc.getText(), source, 'session identity checks leave source unchanged');
    } finally {
      controller.preview = originalPreview;
      await vscode.commands.executeCommand('guitardsl.progression.close');
    }
  });

  test('Late Preview initialization cannot replace a newer progression session', async () => {
    await closeAllEditors();
    const source = 'key: C\n| C | Dm | Em | F |';
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: source });
    const editor = await showAndFocus(doc);
    const progressionAssistant = require('../../progressionAssistant');
    const previewCapo = require('../../previewCapo');
    const { parseGuitarDsl } = require('../../compiler');
    const { planProgressionEdit } = require('../../progressionSourceEdits');
    const controller = progressionAssistant.progressionAssistantProbe.controller;
    const commands = vscode.commands as unknown as {
      executeCommand: (command: string, ...args: unknown[]) => Promise<unknown>;
    };
    const originalExecuteCommand = commands.executeCommand;
    const executeCommand = originalExecuteCommand.bind(vscode.commands);

    let resolveShowStarted!: () => void;
    const showStarted = new Promise<void>(resolve => { resolveShowStarted = resolve; });
    let releaseShowPreview!: () => void;
    const showPreviewGate = new Promise<void>(resolve => { releaseShowPreview = resolve; });
    let holdNextShowPreview = false;
    try {
      editor.selection = new vscode.Selection(new vscode.Position(1, 3), new vscode.Position(1, 3));
      await executeCommand('guitardsl.suggestChordProgression');
      const session1 = progressionAssistant.progressionAssistantProbe.getSession();
      assert.ok(session1, 'the first candidate session is active');
      const firstCandidate = session1.candidates.find((candidate: { id: string }) => candidate.id === session1.activeCandidateId);
      const firstPlan = planProgressionEdit(source, parseGuitarDsl(source), session1.target, firstCandidate);
      assert.ok(firstPlan.ok, 'the first candidate has a renderable edit plan');

      commands.executeCommand = async (command, ...args) => {
        const result = await executeCommand(command, ...args);
        if (command === 'guitardsl.showPreview' && holdNextShowPreview) {
          holdNextShowPreview = false;
          resolveShowStarted();
          await showPreviewGate;
        }
        return result;
      };
      holdNextShowPreview = true;
      const firstPlay = executeCommand('guitardsl.progression.play');
      await showStarted;

      await executeCommand('guitardsl.suggestChordProgression');
      const session2 = progressionAssistant.progressionAssistantProbe.getSession();
      assert.ok(session2, 'the newer candidate session is active while S1 waits for Preview initialization');
      assert.strictEqual(session2.uri, session1.uri);
      assert.strictEqual(session2.version, session1.version);
      assert.notStrictEqual(session2.sessionGeneration, session1.sessionGeneration);
      const alternate = session2.candidates.find((candidate: { id: string }) => candidate.id !== session2.activeCandidateId);
      assert.ok(alternate, 'the second session has a distinct candidate available');
      progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage({
        command: 'progressionCandidateChanged', candidateId: alternate.id, selectedCandidateId: alternate.id
      });
      await settle(50);
      assert.notStrictEqual(session2.activeCandidateId, session1.activeCandidateId);
      const secondCandidate = session2.candidates.find((candidate: { id: string }) => candidate.id === session2.activeCandidateId);
      const secondPlan = planProgressionEdit(source, parseGuitarDsl(source), session2.target, secondCandidate);
      assert.ok(secondPlan.ok, 'the second candidate has a renderable edit plan');
      assert.notStrictEqual(secondPlan.previewSource, firstPlan.previewSource,
        'the selected candidates produce distinct Preview sources so a stale overwrite is observable');

      const generationAfterSecondRender = previewCapo.previewLifecycleProbe.generation;
      assert.strictEqual(previewCapo.effectiveDslProbe.previewInput, secondPlan.previewSource,
        'S2 is the current Preview after its render completes');
      releaseShowPreview();
      await firstPlay;

      assert.strictEqual(progressionAssistant.progressionAssistantProbe.getSession(), session2,
        'late S1 completion leaves S2 as the focused assistant session');
      assert.strictEqual(previewCapo.effectiveDslProbe.previewInput, secondPlan.previewSource,
        'late S1 completion cannot replace S2 Preview content');
      assert.strictEqual(previewCapo.previewLifecycleProbe.generation, generationAfterSecondRender,
        'late S1 completion does not render HTML or schedule its autoplay');
      assert.strictEqual(doc.getText(), source, 'switching sessions and releasing a stale render leave source unchanged');
    } finally {
      releaseShowPreview();
      commands.executeCommand = originalExecuteCommand;
      await executeCommand('guitardsl.progression.close');
      await closeAllEditors();
    }
  });

  test('Late showPreview document resolution cannot replace a newer progression session', async () => {
    await closeAllEditors();
    const source = 'key: C\n| C | Dm | Em | F |';
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: source });
    const editor = await showAndFocus(doc);
    const progressionAssistant = require('../../progressionAssistant');
    const documentResolver = require('../../documentResolver');
    const previewCapo = require('../../previewCapo');
    const { parseGuitarDsl } = require('../../compiler');
    const { planProgressionEdit } = require('../../progressionSourceEdits');
    const originalResolveDocument = documentResolver.resolveGuitarDslDocument;

    let resolveDocumentResolutionStarted!: () => void;
    const documentResolutionStarted = new Promise<void>(resolve => { resolveDocumentResolutionStarted = resolve; });
    let releaseDocumentResolution!: () => void;
    const documentResolutionGate = new Promise<void>(resolve => { releaseDocumentResolution = resolve; });
    let holdFirstResolution = true;
    documentResolver.resolveGuitarDslDocument = async (uri: vscode.Uri | undefined, fallback: vscode.TextDocument | undefined) => {
      if (holdFirstResolution && uri?.toString() === doc.uri.toString()) {
        holdFirstResolution = false;
        resolveDocumentResolutionStarted();
        await documentResolutionGate;
      }
      return originalResolveDocument(uri, fallback);
    };

    try {
      editor.selection = new vscode.Selection(new vscode.Position(1, 3), new vscode.Position(1, 3));
      await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
      const session1 = progressionAssistant.progressionAssistantProbe.getSession();
      assert.ok(session1, 'S1 is the current assistant session before opening Preview');

      const firstPlay = vscode.commands.executeCommand('guitardsl.progression.play');
      await documentResolutionStarted;

      await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
      const session2 = progressionAssistant.progressionAssistantProbe.getSession();
      assert.ok(session2, 'S2 replaces S1 while S1 is resolving its Preview document');
      assert.strictEqual(session2.uri, session1.uri);
      assert.strictEqual(session2.version, session1.version);
      assert.notStrictEqual(session2.sessionGeneration, session1.sessionGeneration);
      const alternate = session2.candidates.find((candidate: { id: string }) => candidate.id !== session2.activeCandidateId);
      assert.ok(alternate);
      progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage({
        command: 'progressionCandidateChanged', candidateId: alternate.id, selectedCandidateId: alternate.id
      });
      await settle(50);
      assert.notStrictEqual(session2.activeCandidateId, session1.activeCandidateId);

      const secondCandidate = session2.candidates.find((candidate: { id: string }) => candidate.id === session2.activeCandidateId);
      const secondPlan = planProgressionEdit(source, parseGuitarDsl(source), session2.target, secondCandidate);
      assert.ok(secondPlan.ok, 'S2 has a renderable Preview plan');
      await vscode.commands.executeCommand('guitardsl.progression.play');
      const generationAfterSecondRender = previewCapo.previewLifecycleProbe.generation;
      assert.strictEqual(previewCapo.effectiveDslProbe.previewInput, secondPlan.previewSource,
        'S2 is rendered while S1 remains inside document resolution');

      releaseDocumentResolution();
      await firstPlay;

      assert.strictEqual(progressionAssistant.progressionAssistantProbe.getSession(), session2,
        'late S1 document resolution cannot replace current session S2');
      assert.strictEqual(previewCapo.effectiveDslProbe.previewInput, secondPlan.previewSource,
        'late S1 document resolution cannot update the Preview with stale DSL');
      assert.strictEqual(previewCapo.previewLifecycleProbe.generation, generationAfterSecondRender,
        'stale showPreview returns before rebuilding webview HTML');
      assert.strictEqual(doc.getText(), source, 'the race does not change source');
    } finally {
      releaseDocumentResolution();
      documentResolver.resolveGuitarDslDocument = originalResolveDocument;
      await vscode.commands.executeCommand('guitardsl.progression.close');
      await closeAllEditors();
    }
  });

  test('ED-03 editor Play, Stop, A/B, Apply and Close stay independent operations', async () => {
    const source = 'key: C\n| C | Dm | Em | F |';
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: source });
    const editor = await showAndFocus(doc, vscode.ViewColumn.One);
    editor.selection = new vscode.Selection(new vscode.Position(1, 3), new vscode.Position(1, 3));
    const window = vscode.window as unknown as {
      showWarningMessage: (...args: unknown[]) => Promise<unknown>;
    };
    await vscode.commands.executeCommand('guitardsl.suggestChordProgression');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const progressionAssistant = require('../../progressionAssistant');
    const controller = progressionAssistant.progressionAssistantProbe.controller;
    const session = progressionAssistant.progressionAssistantProbe.getSession();
    assert.ok(session);
    const calls: Array<{ action: string; options?: Record<string, unknown>; uri?: string }> = [];
    const originalPreview = controller.preview;
    let holdNextRender = false;
    let releaseHeldRender: (() => void) | undefined;
    controller.preview = {
      render: async (_activeSession: unknown, options?: Record<string, unknown>) => {
        calls.push({ action: 'render', options });
        if (holdNextRender) {
          holdNextRender = false;
          await new Promise<void>(resolve => { releaseHeldRender = resolve; });
        }
      },
      stop: (uri: string) => { calls.push({ action: 'stop', uri }); },
      restore: async (uri: string) => { calls.push({ action: 'restore', uri }); }
    };
    const originalWarningMessage = window.showWarningMessage;
    window.showWarningMessage = async () => undefined;
    try {
      await vscode.commands.executeCommand('guitardsl.progression.play');
      assert.deepStrictEqual(calls.pop(), {
        action: 'render', options: { openIfNeeded: true }
      }, 'the command opens the score Preview without bypassing Inspector user activation');
      await progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage({
        command: 'progressionAuditionModeChanged', mode: 'bars'
      });
      assert.strictEqual(progressionAssistant.progressionAssistantProbe.getSession().auditionMode, 'bars',
        'the Inspector stores the selected audition mode in the host session');
      assert.deepStrictEqual(calls.pop(), { action: 'stop', uri: doc.uri.toString() },
        'changing audition mode stops audio without starting playback');
      await vscode.commands.executeCommand('guitardsl.progression.play');
      assert.deepStrictEqual(calls.pop(), {
        action: 'render', options: { openIfNeeded: true }
      }, 'the command does not auto-start the Preview transport');
      await vscode.commands.executeCommand('guitardsl.progression.stop');
      assert.deepStrictEqual(calls.pop(), { action: 'stop', uri: doc.uri.toString() });
      holdNextRender = true;
      const switchingToOriginal = progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage({
        command: 'progressionSideChanged', side: 'A'
      });
      assert.deepStrictEqual(calls.splice(0), [
        { action: 'stop', uri: doc.uri.toString() },
        { action: 'render', options: undefined }
      ], 'the current audition is stopped before the A-side render begins');
      assert.ok(releaseHeldRender, 'the A-side render remains pending for the ordering assertion');
      releaseHeldRender();
      await switchingToOriginal;
      assert.strictEqual(progressionAssistant.progressionAssistantProbe.getSession().side, 'A');
      releaseHeldRender = undefined;
      holdNextRender = true;
      const switchingToCandidate = vscode.commands.executeCommand('guitardsl.progression.showCandidate');
      for (let attempt = 0; attempt < 20 && !releaseHeldRender; attempt++) await settle(10);
      assert.deepStrictEqual(calls.splice(0), [
        { action: 'stop', uri: doc.uri.toString() },
        { action: 'render', options: undefined }
      ], 'the legacy B-side command stops audio before its delayed render completes');
      const releaseLegacyRender = releaseHeldRender as (() => void) | undefined;
      assert.ok(releaseLegacyRender, 'the legacy B-side render remains pending for the ordering assertion');
      releaseLegacyRender();
      await switchingToCandidate;
      assert.strictEqual(progressionAssistant.progressionAssistantProbe.getSession().side, 'B');
      await vscode.commands.executeCommand('guitardsl.progression.apply');
      assert.strictEqual(doc.getText(), source, 'Apply is separately confirmed and cancellation writes nothing');
      assert.ok(progressionAssistant.progressionAssistantProbe.getSession(), 'canceling Apply keeps the session open');
      await vscode.commands.executeCommand('guitardsl.progression.close');
      assert.strictEqual(progressionAssistant.progressionAssistantProbe.getSession(), undefined);
      assert.ok(calls.some(call => call.action === 'restore' && call.uri === doc.uri.toString()),
        'Close clears the session and restores the ordinary Preview');
      assert.strictEqual(doc.getText(), source, 'all independent controls leave source unchanged until Apply is confirmed');
    } finally {
      controller.preview = originalPreview;
      window.showWarningMessage = originalWarningMessage;
      await vscode.commands.executeCommand('guitardsl.progression.close');
    }
  });

  test('ED-03 Apply confirmation is discarded after dismissal, candidate switch, or session replacement', async () => {
    const source = 'key: C\n| C | Dm | Em | F |\n| G | Am | C | G |';
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: source });
    const editor = await showAndFocus(doc, vscode.ViewColumn.One);
    editor.selection = new vscode.Selection(new vscode.Position(1, 3), new vscode.Position(1, 3));
    const window = vscode.window as unknown as {
      showWarningMessage: (...args: unknown[]) => Promise<unknown>;
    };
    const workspace = vscode.workspace as unknown as { applyEdit: unknown };
    const originalWarningMessage = window.showWarningMessage;
    const originalApplyEdit = workspace.applyEdit;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const progressionAssistant = require('../../progressionAssistant');
    const controller = progressionAssistant.progressionAssistantProbe.controller;
    const originalPreview = controller.preview;
    controller.preview = { render: () => undefined, stop: () => undefined, restore: () => undefined };
    let applyCount = 0;
    workspace.applyEdit = async (edit: vscode.WorkspaceEdit) => {
      applyCount++;
      return (originalApplyEdit as (this: typeof vscode.workspace, edit: vscode.WorkspaceEdit) => Promise<boolean>)
        .call(vscode.workspace, edit);
    };
    let resolveConfirmation: (() => void) | undefined;
    window.showWarningMessage = (...args: unknown[]) => new Promise(resolve => {
      const affirmative = args[args.length - 1];
      resolveConfirmation = () => resolve(affirmative);
    });
    const beginApply = () => {
      resolveConfirmation = undefined;
      const pending = progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage({ command: 'progressionApply' });
      assert.ok(resolveConfirmation, 'the modal confirmation is pending');
      return { pending, confirm: resolveConfirmation as () => void };
    };
    try {
      await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
      const firstSession = progressionAssistant.progressionAssistantProbe.getSession();
      const alternate = firstSession.candidates.find((candidate: { id: string }) => candidate.id !== firstSession.activeCandidateId);
      assert.ok(alternate, 'the first session offers another candidate');
      const switchedApply = beginApply();
      await progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage({
        command: 'progressionCandidateChanged', candidateId: alternate.id, selectedCandidateId: alternate.id
      });
      switchedApply.confirm();
      await switchedApply.pending;
      assert.strictEqual(applyCount, 0, 'a candidate switch invalidates the pending confirmation');

      const dismissedApply = beginApply();
      await progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage({ command: 'progressionDismiss' });
      dismissedApply.confirm();
      await dismissedApply.pending;
      assert.strictEqual(applyCount, 0, 'dismissing the session invalidates the pending confirmation');

      editor.selection = new vscode.Selection(new vscode.Position(1, 3), new vscode.Position(1, 3));
      await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
      const replacedApply = beginApply();
      editor.selection = new vscode.Selection(new vscode.Position(2, 3), new vscode.Position(2, 3));
      await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
      replacedApply.confirm();
      await replacedApply.pending;
      assert.strictEqual(applyCount, 0, 'replacing the session invalidates the pending confirmation');
      assert.strictEqual(doc.getText(), source, 'all stale confirmations leave the document unchanged');
    } finally {
      resolveConfirmation?.();
      window.showWarningMessage = originalWarningMessage;
      workspace.applyEdit = originalApplyEdit;
      controller.preview = originalPreview;
      await vscode.commands.executeCommand('guitardsl.progression.close');
    }
  });

  test('ED-03/ED-04 progression actions keep Apply separate and preserve one-undo, stale and cancellation guards', async () => {
    await closeAllEditors();
    const source = 'key: C\n| C | Dm | Em | F |';
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: source });
    const editor = await showAndFocus(doc, vscode.ViewColumn.One);
    const completionPosition = new vscode.Position(1, 3);
    const completionList = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider', doc.uri, completionPosition
    );
    assert.ok(completionList && completionList.items.length > 0, 'a chord cell offers deterministic suggestions');
    assert.ok(completionList!.items.length <= 5, 'completion shows at most five candidates');
    assert.ok(completionList!.items.every(item => item.range instanceof vscode.Range
      && item.range.start.character === 2 && item.range.end.character === 3), 'completion replaces exactly the chord token');

    editor.selection = new vscode.Selection(new vscode.Position(1, 3), new vscode.Position(1, 3));
    const window = vscode.window as unknown as {
      showWarningMessage: (...args: unknown[]) => Promise<unknown>;
    };
    const originalWarningMessage = window.showWarningMessage;
    await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const previewCapo = require('../../previewCapo');
    const generationBeforeSelection = previewCapo.previewLifecycleProbe.generation;
    await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
    assert.strictEqual(doc.getText(), source, 'candidate selection leaves the source untouched');
    const candidatePreview = previewCapo.effectiveDslProbe.previewInput as string;
    assert.ok(candidatePreview !== source, 'an already-open Preview mirrors the selected candidate');
    assert.ok(previewCapo.previewLifecycleProbe.generation > generationBeforeSelection,
      'the existing Preview rerenders as a synchronized secondary surface');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const progressionAssistant = require('../../progressionAssistant');
    const controller = progressionAssistant.progressionAssistantProbe.controller;
    const activeSession = progressionAssistant.progressionAssistantProbe.getSession();
    assert.ok(controller, 'the active progression assistant controller is registered');
    assert.ok(activeSession.activeCandidateId, 'the selected Inspector candidate has an ID for the Apply action');
    const generationWithCandidate = previewCapo.previewLifecycleProbe.generation;
    await showAndFocus(doc, vscode.ViewColumn.One);
    assert.strictEqual(previewCapo.previewLifecycleProbe.generation, generationWithCandidate,
      'returning focus to the same source document keeps the assistant Preview generation');
    assert.strictEqual(previewCapo.effectiveDslProbe.previewInput, candidatePreview,
      'same-document focus does not replace the candidate Preview with normal source');
    await vscode.commands.executeCommand('workbench.action.focusNextGroup');
    await settle(30);
    assert.strictEqual(previewCapo.previewLifecycleProbe.generation, generationWithCandidate,
      'returning focus to Preview keeps the same assistant session');

    await progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage({ command: 'progressionSideChanged', side: 'A' });
    assert.strictEqual(previewCapo.effectiveDslProbe.previewInput, source,
      'A re-renders the Preview from the original DSL');
    const aGeneration = previewCapo.previewLifecycleProbe.generation;
    await progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage({ command: 'progressionSideChanged', side: 'B' });
    assert.strictEqual(previewCapo.effectiveDslProbe.previewInput, candidatePreview,
      'B re-renders the Preview from the selected candidate DSL');
    assert.ok(previewCapo.previewLifecycleProbe.generation > aGeneration, 'each A/B transition rebuilds the Preview');

    const workspace = vscode.workspace as unknown as { applyEdit: unknown };
    const originalApplyEdit = workspace.applyEdit;
    let applyCount = 0;
    const trackingApplyEdit = async (edit: vscode.WorkspaceEdit) => {
      applyCount++;
      return (originalApplyEdit as (this: typeof vscode.workspace, edit: vscode.WorkspaceEdit) => Promise<boolean>)
        .call(vscode.workspace, edit);
    };
    try {
      workspace.applyEdit = trackingApplyEdit;
      window.showWarningMessage = async () => undefined;
      const applyMessage = { command: 'progressionApply' };
      await progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage(applyMessage);
      assert.strictEqual(doc.getText(), source, 'cancelling confirmation leaves the source untouched');
      assert.strictEqual(applyCount, 0, 'confirmation cancellation does not call applyEdit');

      window.showWarningMessage = async (...args) => args[args.length - 1];
      await Promise.all([
        progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage(applyMessage),
        progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage(applyMessage)
      ]);
    } finally {
      window.showWarningMessage = originalWarningMessage;
      workspace.applyEdit = originalApplyEdit;
    }
    assert.strictEqual(applyCount, 1, 'concurrent confirmations still perform exactly one applyEdit');
    assert.strictEqual(doc.getText(), candidatePreview,
      'confirmation applies exactly the candidate source shown in Preview');
    await undoIn(doc);
    assert.strictEqual(doc.getText(), source, 'one undo restores the exact original source');

    await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
    assert.ok(progressionAssistant.progressionAssistantProbe.getSession(), 'a second preview session is created for stale-source validation');
    applyCount = 0;
    window.showWarningMessage = async (...args) => args[args.length - 1];
    workspace.applyEdit = async () => { applyCount++; return false; };
    try {
      await progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage({ command: 'progressionApply' });
    } finally {
      window.showWarningMessage = originalWarningMessage;
      workspace.applyEdit = originalApplyEdit;
    }
    assert.strictEqual(doc.getText(), source, 'an applyEdit=false result leaves the source untouched');
    assert.strictEqual(applyCount, 1, 'the candidate is submitted once to the failing applyEdit');

    const userEdit = new vscode.WorkspaceEdit();
    userEdit.insert(doc.uri, doc.positionAt(doc.getText().length), '\n# user edit');
    assert.ok(await (originalApplyEdit as (this: typeof vscode.workspace, edit: vscode.WorkspaceEdit) => Promise<boolean>)
      .call(vscode.workspace, userEdit));
    const editedSource = doc.getText();
    await settle(30);
    applyCount = 0;
    workspace.applyEdit = trackingApplyEdit;
    try {
      await progressionAssistant.progressionAssistantProbe.dispatchInspectorMessage({ command: 'progressionApply' });
      assert.strictEqual(doc.getText(), editedSource, 'an edit after candidate preview invalidates the candidate without overwriting the user');
      assert.strictEqual(applyCount, 0, 'stale source is rejected before applyEdit');
    } finally {
      workspace.applyEdit = originalApplyEdit;
    }
    await closeAllEditors();
  });

  test('Issue #129 completions ignore non-chord contexts and unrelated parser errors', async () => {
    const cases = [
      { label: 'melody', source: 'key: C\nmel: | c4/4 |', needle: 'c4', after: 2 },
      { label: 'lyrics', source: 'key: C\nlyr: | "words" |', needle: 'words', after: 2 },
      { label: 'TAB', source: 'key: C\ntab: 6:0/4', needle: '6:0', after: 1 },
      { label: 'chord definition', source: 'key: C\nchord C@barre = x35553', needle: 'x35553', after: 2 },
      { label: 'comment', source: 'key: C\n# | C |', needle: 'C |', after: 1 },
      { label: 'header', source: 'key: C\n| C |', needle: 'key: C', after: 6 },
      { label: 'explicit duration', source: 'key: C\n| C:2 |', needle: 'C:2', after: 1 },
      {
        label: 'custom voicing label',
        source: 'key: C\nchord C@barre = x35553\n| C@barre |',
        needle: 'C@barre', after: 'C@barre'.length
      },
      { label: 'unrelated parse error', source: 'key: C\n| C bogus |', needle: 'C bogus', after: 1 }
    ];
    for (const item of cases) {
      const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: item.source });
      const offset = item.source.indexOf(item.needle) + item.after;
      const result = await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider', doc.uri, doc.positionAt(offset)
      );
      const progressionItems = result?.items.filter(completion =>
        /^0[0-4]$/.test(completion.sortText ?? '') && typeof completion.detail === 'string'
      ) ?? [];
      assert.strictEqual(progressionItems.length, 0, `${item.label} must not offer chord suggestions`);
    }
  });

  test('Issue #129 completions accept sharp chord roots and stop at whitespace-prefixed comments', async () => {
    const cases = [
      { label: 'F# chord', source: 'key: C\n| F# |', needle: 'F#', offers: true },
      { label: 'C# chord', source: 'key: C\n| C# |', needle: 'C#', offers: true },
      { label: 'real trailing comment', source: 'key: C\n| F# | # comment', needle: 'comment', offers: false }
    ];
    for (const item of cases) {
      const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: item.source });
      const offset = item.source.indexOf(item.needle) + item.needle.length;
      const result = await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider', doc.uri, doc.positionAt(offset)
      );
      const progressionItems = result?.items.filter(completion =>
        /^0[0-4]$/.test(completion.sortText ?? '') && typeof completion.detail === 'string'
      ) ?? [];
      assert.strictEqual(progressionItems.length > 0, item.offers, `${item.label} completion behavior`);
      if (item.offers) {
        assert.ok(progressionItems.every(completion => completion.range instanceof vscode.Range
          && completion.range.start.character === 2 && completion.range.end.character === 4),
        `${item.label} replaces only the sharp chord token`);
      }
    }
  });

  test('GP import opens an Untitled GuitarDSL source that can be exported, with safe cancel and edit handling', async () => {
    const fixturePath = path.resolve(__dirname, '../../../tests/fixtures/gp78/F01-standard-4-4.gp');
    const optimizedFixturePath = path.resolve(__dirname, '../../../tests/fixtures/gp78/F11-chord-strum-gp8.gp');
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guitardsl-gp78-e2e-'));
    const successfulTarget = path.join(tempDir, 'roundtrip.gp');
    const cancelledTarget = path.join(tempDir, 'cancelled.gp');
    const changedTarget = path.join(tempDir, 'changed.gp');
    const windowApi = vscode.window as unknown as Record<string, unknown>;
    const originalShowOpenDialog = windowApi.showOpenDialog;
    const originalShowQuickPick = windowApi.showQuickPick;
    const originalShowSaveDialog = windowApi.showSaveDialog;
    const originalShowWarningMessage = windowApi.showWarningMessage;
    const originalShowErrorMessage = windowApi.showErrorMessage;
    const warnings: string[] = [];
    const errors: string[] = [];
    const importModesSeen: string[][] = [];
    let nextImportMode: 'faithful' | 'optimize' | 'cancel' = 'cancel';
    let warningChoiceIndex = 0;
    const newDocs = () => vscode.workspace.textDocuments.filter(document => document.isUntitled && document.languageId === 'guitardsl');
    try {
      windowApi.showOpenDialog = async () => undefined;
      const beforeCancelledImport = new Set(newDocs().map(document => document.uri.toString()));
      await vscode.commands.executeCommand('guitardsl.importGuitarPro');
      assert.deepStrictEqual(newDocs().map(document => document.uri.toString()).filter(uri => !beforeCancelledImport.has(uri)), []);

      windowApi.showWarningMessage = async (...args: unknown[]) => {
        warnings.push(String(args[0] ?? ''));
        const choices = args.slice(1).filter((value): value is string => typeof value === 'string');
        return choices[warningChoiceIndex];
      };
      windowApi.showQuickPick = async (items: unknown) => {
        const choices = Array.isArray(items) ? items as Array<{ label: string; mode?: 'faithful' | 'optimize' }> : [];
        if (!choices.some(choice => choice.mode)) return undefined;
        importModesSeen.push(choices.filter(choice => choice.mode).map(choice => choice.mode!));
        if (nextImportMode === 'cancel') return undefined;
        return choices.find(choice => choice.mode === nextImportMode);
      };
      windowApi.showErrorMessage = async (...args: unknown[]) => {
        errors.push(String(args[0] ?? ''));
        return undefined;
      };
      const beforeModeCancel = new Set(newDocs().map(document => document.uri.toString()));
      await vscode.commands.executeCommand('guitardsl.importGuitarPro', vscode.Uri.file(fixturePath));
      assert.deepStrictEqual(newDocs().map(document => document.uri.toString()).filter(uri => !beforeModeCancel.has(uri)), [], 'Cancelling the mode QuickPick must not create a document');
      assert.deepStrictEqual(importModesSeen[0], ['faithful', 'optimize'], 'Faithful import must be the first/default option');

      nextImportMode = 'optimize';
      warningChoiceIndex = 1;
      const beforeFallbackCancel = new Set(newDocs().map(document => document.uri.toString()));
      await vscode.commands.executeCommand('guitardsl.importGuitarPro', vscode.Uri.file(fixturePath));
      assert.deepStrictEqual(newDocs().map(document => document.uri.toString()).filter(uri => !beforeFallbackCancel.has(uri)), [], 'Cancelling an unavailable optimization must not create a document');
      assert.ok(warnings.some(message => message.includes('optimization is unavailable') || message.includes('最適化を利用できません')), 'Unavailable optimization should explain the failed preflight');

      warningChoiceIndex = 0;
      const beforeImport = new Set(newDocs().map(document => document.uri.toString()));
      await vscode.commands.executeCommand('guitardsl.importGuitarPro', vscode.Uri.file(fixturePath));
      const imported = newDocs().find(document => !beforeImport.has(document.uri.toString()));
      assert.ok(imported, 'Explicitly choosing faithful import after an unavailable plan should open one Untitled GuitarDSL document');

      let resolvePendingMode: ((mode: 'faithful' | 'optimize') => void) | undefined;
      let signalModePicker: (() => void) | undefined;
      const modePickerStarted = new Promise<void>(resolve => { signalModePicker = resolve; });
      const quickPickHandler = windowApi.showQuickPick;
      windowApi.showQuickPick = async (items: unknown) => new Promise(resolve => {
        const choices = Array.isArray(items) ? items as Array<{ mode?: 'faithful' | 'optimize' }> : [];
        resolvePendingMode = mode => resolve(choices.find(choice => choice.mode === mode));
        signalModePicker?.();
      });
      const pendingImport = vscode.commands.executeCommand('guitardsl.importGuitarPro', vscode.Uri.file(fixturePath));
      await modePickerStarted;
      const warningCountBeforeImportReentry = warnings.length;
      await vscode.commands.executeCommand('guitardsl.importGuitarPro', vscode.Uri.file(fixturePath));
      assert.strictEqual(warnings.length, warningCountBeforeImportReentry + 1, 'A concurrent import while mode selection is open should be rejected as busy');
      assert.ok(warnings.at(-1)?.includes('already running') || warnings.at(-1)?.includes('実行中'), 'The reentrant import should show the busy explanation');
      resolvePendingMode?.('faithful');
      await pendingImport;
      windowApi.showQuickPick = quickPickHandler;

      let resolveSaveDialog: ((uri: vscode.Uri | undefined) => void) | undefined;
      let signalSaveDialog: (() => void) | undefined;
      const saveDialogStarted = new Promise<void>(resolve => { signalSaveDialog = resolve; });
      windowApi.showSaveDialog = () => new Promise<vscode.Uri | undefined>(resolve => {
        resolveSaveDialog = resolve;
        signalSaveDialog?.();
      });
      const firstExport = vscode.commands.executeCommand('guitardsl.exportGuitarPro', imported.uri);
      await saveDialogStarted;
      const warningCountBeforeReentry = warnings.length;
      await vscode.commands.executeCommand('guitardsl.exportGuitarPro', imported.uri);
      assert.strictEqual(warnings.length, warningCountBeforeReentry + 1, 'A concurrent export should be rejected as busy');
      resolveSaveDialog?.(vscode.Uri.file(successfulTarget));
      await firstExport;
      const bytes = await fs.readFile(successfulTarget);
      assert.strictEqual(bytes.subarray(0, 2).toString('ascii'), 'PK', 'Untitled source should export as a GP ZIP');

      windowApi.showSaveDialog = async () => undefined;
      await vscode.commands.executeCommand('guitardsl.exportGuitarPro', imported.uri);
      await assert.rejects(fs.stat(cancelledTarget));

      windowApi.showSaveDialog = async () => {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(imported.uri, imported.positionAt(imported.getText().length), '\n');
        assert.ok(await vscode.workspace.applyEdit(edit), 'The source edit should be applied during the save dialog');
        return vscode.Uri.file(changedTarget);
      };
      await vscode.commands.executeCommand('guitardsl.exportGuitarPro', imported.uri);
      await assert.rejects(fs.stat(changedTarget));
      assert.ok(errors.some(message => message.includes('changed while export was waiting')));

      nextImportMode = 'optimize';
      warningChoiceIndex = 1;
      const optimizedSourceBefore = await fs.readFile(optimizedFixturePath);
      const beforeLossCancel = new Set(newDocs().map(document => document.uri.toString()));
      await vscode.commands.executeCommand('guitardsl.importGuitarPro', vscode.Uri.file(optimizedFixturePath));
      assert.deepStrictEqual(newDocs().map(document => document.uri.toString()).filter(uri => !beforeLossCancel.has(uri)), [], 'Cancelling combined optimization losses must not create a document');

      warningChoiceIndex = 0;
      const beforeOptimizedImport = new Set(newDocs().map(document => document.uri.toString()));
      await vscode.commands.executeCommand('guitardsl.importGuitarPro', vscode.Uri.file(optimizedFixturePath));
      const optimized = newDocs().find(document => !beforeOptimizedImport.has(document.uri.toString()));
      assert.ok(optimized, 'Approved optimized import should open one Untitled GuitarDSL document');
      assert.ok(optimized?.getText().includes('| C 4 4 4 4 |'), 'Optimized output should contain one generated C label and four exact rhythm attacks');
      assert.ok(!optimized?.getText().includes('TAB'), 'Optimized output should not retain the source TAB staff');
      assert.ok(warnings.some(message => message.includes('Import will omit or infer') || message.includes('インポート時に')), 'Optimized import must show the combined loss summary before creating the document');
      assert.deepStrictEqual(await fs.readFile(optimizedFixturePath), optimizedSourceBefore, 'The GP8 source fixture must remain byte-identical');
    } finally {
      windowApi.showOpenDialog = originalShowOpenDialog;
      windowApi.showQuickPick = originalShowQuickPick;
      windowApi.showSaveDialog = originalShowSaveDialog;
      windowApi.showWarningMessage = originalShowWarningMessage;
      windowApi.showErrorMessage = originalShowErrorMessage;
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('optimized serialization and postparse failures offer explicit faithful fallback or cancel', async () => {
    const fixturePath = path.resolve(__dirname, '../../../tests/fixtures/gp78/F11-chord-strum-gp8.gp');
    const windowApi = vscode.window as unknown as Record<string, unknown>;
    const originalShowQuickPick = windowApi.showQuickPick;
    const originalShowWarningMessage = windowApi.showWarningMessage;
    const originalShowErrorMessage = windowApi.showErrorMessage;
    type SerializeSuccess = { ok: true; value: string };
    type SerializeFailure = { ok: false; code: string; diagnostics: unknown[]; errors: Array<{ code: string; path: string; detail: string }>; loss: unknown };
    type SerializeResult = SerializeSuccess | SerializeFailure;
    type ParseResult = { diagnostics: Array<{ severity: string }>; [key: string]: unknown };
    type Gp78Inspection = { ok: true; value: { tracks: Array<{ id: string; eligible: boolean }> } } | { ok: false };
    type Gp78Import = { ok: true; value: unknown; loss: unknown } | { ok: false };
    const interchangeModule = require(path.resolve(__dirname, '../../../out/interchange/toGuitarDsl.js')) as {
      interchangeToGuitarDsl: (score: unknown, loss: unknown) => SerializeResult;
    };
    const compilerModule = require(path.resolve(__dirname, '../../../out/compiler.js')) as {
      parseGuitarDsl: (source: string) => ParseResult;
    };
    const gp78Module = require(path.resolve(__dirname, '../../../out/gp78/index.js')) as {
      inspectGp78: (bytes: Uint8Array) => Gp78Inspection;
      importGp78: (bytes: Uint8Array, trackId: string) => Gp78Import;
    };
    const gp78ImportModule = require(path.resolve(__dirname, '../../../out/gp78/import.js')) as {
      importGp78: (bytes: Uint8Array, trackId: number) => Gp78Import;
    };
    const originalSerialize = interchangeModule.interchangeToGuitarDsl;
    const originalParse = compilerModule.parseGuitarDsl;
    const originalGp78Import = gp78ImportModule.importGp78;
    const bytes = new Uint8Array(await fs.readFile(fixturePath));
    const inspection = gp78Module.inspectGp78(bytes);
    assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
    if (!inspection.ok) return;
    const track = inspection.value.tracks.find(candidate => candidate.eligible);
    assert.ok(track);
    if (!track) return;
    const imported = gp78Module.importGp78(bytes, track.id);
    assert.strictEqual(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;
    const faithfulOutput = originalSerialize(imported.value, imported.loss);
    assert.strictEqual(faithfulOutput.ok, true, JSON.stringify(faithfulOutput));
    if (!faithfulOutput.ok) return;

    const newDocs = () => vscode.workspace.textDocuments.filter(document => document.isUntitled && document.languageId === 'guitardsl');
    const warnings: string[] = [];
    let fallbackChoice: 'faithful' | 'cancel' = 'cancel';
    let injectedFailure: 'serialization' | 'postparse' | undefined;
    let parseCalls = 0;
    let gp78ImportCalls = 0;
    try {
      windowApi.showQuickPick = async (items: unknown) => {
        const choices = Array.isArray(items) ? items as Array<{ mode?: 'faithful' | 'optimize' }> : [];
        return choices.find(choice => choice.mode === 'optimize') ?? choices[0];
      };
      windowApi.showWarningMessage = async (...args: unknown[]) => {
        const message = String(args[0] ?? '');
        warnings.push(message);
        const choices = args.slice(1).filter((value): value is string => typeof value === 'string');
        if (message.includes('output could not be validated') || message.includes('出力を検証できません')) {
          return choices[fallbackChoice === 'faithful' ? 0 : 1];
        }
        return choices[0];
      };
      windowApi.showErrorMessage = async (...args: unknown[]) => {
        throw new Error(`Unexpected import error: ${String(args[0] ?? '')}`);
      };
      gp78ImportModule.importGp78 = ((sourceBytes, trackId) => {
        gp78ImportCalls += 1;
        return originalGp78Import(sourceBytes, trackId);
      }) as typeof originalGp78Import;
      interchangeModule.interchangeToGuitarDsl = ((score, loss) => {
        if (injectedFailure === 'serialization') {
          injectedFailure = undefined;
          return {
            ok: false,
            code: 'unrepresentableValue',
            diagnostics: [],
            errors: [{ code: 'injectedSerializationFailure', path: '/test', detail: 'Injected serialization failure' }],
            loss: imported.loss,
          } as SerializeResult;
        }
        return originalSerialize(score, loss);
      }) as typeof originalSerialize;
      compilerModule.parseGuitarDsl = ((source: string) => {
        const parsed = originalParse(source);
        parseCalls += 1;
        if (injectedFailure === 'postparse' && parseCalls === 2) {
          injectedFailure = undefined;
          const injectedDiagnostic = { severity: 'error' } as ParseResult['diagnostics'][number];
          return { ...parsed, diagnostics: [...parsed.diagnostics, injectedDiagnostic] };
        }
        return parsed;
      }) as typeof originalParse;

      const beforeSerializationCancel = new Set(newDocs().map(document => document.uri.toString()));
      gp78ImportCalls = 0;
      injectedFailure = 'serialization';
      fallbackChoice = 'cancel';
      await vscode.commands.executeCommand('guitardsl.importGuitarPro', vscode.Uri.file(fixturePath));
      assert.deepStrictEqual(newDocs().map(document => document.uri.toString()).filter(uri => !beforeSerializationCancel.has(uri)), []);
      assert.strictEqual(gp78ImportCalls, 1, 'Serialization failure must import the selected track only once');

      const beforeFaithfulFallback = new Set(newDocs().map(document => document.uri.toString()));
      gp78ImportCalls = 0;
      injectedFailure = 'serialization';
      fallbackChoice = 'faithful';
      await vscode.commands.executeCommand('guitardsl.importGuitarPro', vscode.Uri.file(fixturePath));
      const faithfulFallback = newDocs().find(document => !beforeFaithfulFallback.has(document.uri.toString()));
      assert.ok(faithfulFallback, 'Choosing Faithful after optimized serialization failure should open one document');
      assert.strictEqual(faithfulFallback?.getText(), faithfulOutput.value);
      assert.strictEqual(gp78ImportCalls, 1, 'Faithful fallback must reuse the imported IR without re-importing the GP track');

      const beforePostparseCancel = new Set(newDocs().map(document => document.uri.toString()));
      gp78ImportCalls = 0;
      parseCalls = 0;
      injectedFailure = 'postparse';
      fallbackChoice = 'cancel';
      await vscode.commands.executeCommand('guitardsl.importGuitarPro', vscode.Uri.file(fixturePath));
      assert.deepStrictEqual(newDocs().map(document => document.uri.toString()).filter(uri => !beforePostparseCancel.has(uri)), []);
      assert.strictEqual(gp78ImportCalls, 1, 'Postparse failure must import the selected track only once');

      const beforePostparseFallback = new Set(newDocs().map(document => document.uri.toString()));
      gp78ImportCalls = 0;
      parseCalls = 0;
      injectedFailure = 'postparse';
      fallbackChoice = 'faithful';
      await vscode.commands.executeCommand('guitardsl.importGuitarPro', vscode.Uri.file(fixturePath));
      const postparseFallback = newDocs().find(document => !beforePostparseFallback.has(document.uri.toString()));
      assert.ok(postparseFallback, 'Choosing Faithful after postparse validation failure should open one document');
      assert.strictEqual(postparseFallback?.getText(), faithfulOutput.value);
      assert.strictEqual(gp78ImportCalls, 1, 'Postparse Faithful fallback must reuse the imported IR without re-importing the GP track');
      assert.ok(warnings.filter(message => message.includes('output could not be validated') || message.includes('出力を検証できません')).length >= 4);
    } finally {
      interchangeModule.interchangeToGuitarDsl = originalSerialize;
      compilerModule.parseGuitarDsl = originalParse;
      gp78ImportModule.importGp78 = originalGp78Import;
      windowApi.showQuickPick = originalShowQuickPick;
      windowApi.showWarningMessage = originalShowWarningMessage;
      windowApi.showErrorMessage = originalShowErrorMessage;
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });

  test('the GuitarDSL sidebar view is contributed and can be focused', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('guitardsl.sidebar.focus'), 'the guitardsl.sidebar view exists');
    await vscode.commands.executeCommand('guitardsl.sidebar.focus');
    // Give focus back to the editor: later tests run focus-dependent commands such as `undo`.
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  });

  test('Every contributed command is registered (T016)', async () => {
    const ext = vscode.extensions.all.find(e => e.packageJSON?.name === 'vscode-guitar-dsl');
    assert.ok(ext);
    const registered = new Set(await vscode.commands.getCommands(true));
    for (const c of ext.packageJSON.contributes.commands as { command: string }[]) {
      assert.ok(registered.has(c.command), `${c.command} should be registered`);
    }
  });

  test('guitardsl.openHelp opens Help without a GuitarDSL document and changes no document (T017)', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const guitarDocs = () => vscode.workspace.textDocuments.filter(d => d.languageId === 'guitardsl');
    const before = guitarDocs().map(d => d.uri.toString());
    const dirtyBefore = vscode.workspace.textDocuments.filter(d => d.isDirty).length;

    await vscode.commands.executeCommand('guitardsl.openHelp');
    await vscode.commands.executeCommand('guitardsl.openHelp');

    assert.deepStrictEqual(guitarDocs().map(d => d.uri.toString()), before, 'no GuitarDSL document is opened or created');
    assert.strictEqual(vscode.workspace.textDocuments.filter(d => d.isDirty).length, dirtyBefore, 'no document is modified');
    const ext = vscode.extensions.all.find(e => e.packageJSON?.name === 'vscode-guitar-dsl');
    for (const locale of ['ja', 'en']) {
      const uri = vscode.Uri.joinPath(ext!.extensionUri, 'media', 'help', `guitardsl-help.${locale}.md`);
      const stat = await vscode.workspace.fs.stat(uri);
      assert.ok(stat.size > 0, `packaged Help ${locale} exists`);
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('CodeLens should offer the chord editor on chord definition lines', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'guitardsl',
      content: ['title: Chords', 'chord C@barre = x35553 base:3', 'chord D = nope', '| C@barre |'].join('\n')
    });
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', doc.uri);
    assert.ok(lenses, 'CodeLenses should be returned');
    const chordLenses = lenses.filter(l => l.command?.command === 'guitardsl.editChordDiagram');
    assert.strictEqual(chordLenses.length, 1, 'Only the valid chord line gets a CodeLens');
    assert.strictEqual(chordLenses[0].range.start.line, 1);
    assert.strictEqual(chordLenses[0].command!.arguments![1], 'C@barre');
  });

  test('Saving from the chord editor inserts, replaces and rejects duplicates', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { applyChordSave } = require('../../chordEditor');
    const doc = await vscode.workspace.openTextDocument({
      language: 'guitardsl',
      content: ['title: Save Test', '', '[Intro]', '| C@barre | G |'].join('\n')
    });
    const state = { name: 'C', label: 'barre', frets: ['x', 3, 5, 5, 5, 3], windowBase: 3, fingers: [null, '1', '3', '3', '3', '1'], barres: [{ fret: 3, from: 1, to: 5 }] };

    const inserted = await applyChordSave(doc.uri, state, undefined, false);
    assert.deepStrictEqual(inserted, { ok: true, applied: true, key: 'C@barre', line: 1 });
    assert.strictEqual(doc.lineAt(1).text, 'chord C@barre = x35553 base:3 fingers:-13331 barre:3');
    assert.strictEqual(doc.lineAt(2).text, '', 'blank line before the score is kept');

    const duplicate = await applyChordSave(doc.uri, state, undefined, true);
    assert.deepStrictEqual(duplicate, { ok: false, error: 'duplicate', detail: 'C@barre' });

    const replaced = await applyChordSave(doc.uri, { ...state, frets: ['x', 3, 5, 5, 5, 'x'], fingers: new Array(6).fill(null), barres: [] }, 1, false);
    assert.strictEqual(replaced.ok && replaced.line, 1);
    assert.strictEqual(doc.lineAt(1).text, 'chord C@barre = x3555x base:3');
    assert.strictEqual(doc.lineCount, 5);

    const invalid = await applyChordSave(doc.uri, { ...state, name: 'Hm' }, 1, false);
    assert.deepStrictEqual(invalid, { ok: false, error: 'name', detail: 'Hm' });
  });

  test('Edit chord diagram command should open the editor panel', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'guitardsl',
      content: ['chord C@barre = x35553 base:3', '| C@barre |'].join('\n')
    });
    await showAndFocus(doc);
    await vscode.commands.executeCommand('guitardsl.editChordDiagram', doc.uri, 'C@barre');
    let tabs: vscode.Tab[] = [];
    let editorTab: vscode.Tab | undefined;
    for (let i = 0; i < 50 && !editorTab; i++) {
      tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
      editorTab = tabs.find(t => t.input instanceof vscode.TabInputWebview && t.label.endsWith(': C@barre'));
      if (!editorTab) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(editorTab, `Chord editor tab should be open (tabs: ${tabs.map(t => t.label).join(', ')})`);
  });

  test('Document symbol provider should provide symbols for guitardsl document', async () => {
    const sampleDsl = [
      'title: E2E Test Score',
      'artist: Tester',
      'bpm: 120',
      '',
      '[Intro]',
      '| C G | Am Em | l:"テスト歌詞"',
      '| F C | Dm G |'
    ].join('\n');

    const doc = await vscode.workspace.openTextDocument({
      language: 'guitardsl',
      content: sampleDsl
    });

    assert.strictEqual(doc.languageId, 'guitardsl', 'Document language should be guitardsl');

    // Execute DocumentSymbolProvider
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      doc.uri
    );

    assert.ok(symbols, 'Symbols should be returned');
    assert.ok(symbols.length >= 2, 'Should have Metadata and Intro section symbols');

    const metaSymbol = symbols.find(s => s.name === 'Metadata');
    assert.ok(metaSymbol, 'Metadata symbol should exist');
    assert.ok(metaSymbol.children.some(c => c.name === 'title' && c.detail === 'E2E Test Score'));

    const introSymbol = symbols.find(s => s.name === 'Intro');
    assert.ok(introSymbol, 'Intro section symbol should exist');
    assert.ok(introSymbol.children.length >= 1, 'Intro should have measure symbols');
  });

  test('Diagnostics should be published for invalid melody lines and cleared on fix', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'guitardsl',
      content: ['| C | 4.d 4.d 4.d 4.d |', 'mel: | E4/4 d e f |'].join('\n')
    });
    await showAndFocus(doc);

    const waitFor = async (predicate: (d: readonly vscode.Diagnostic[]) => boolean) => {
      for (let i = 0; i < 50; i++) {
        const diags = vscode.languages.getDiagnostics(doc.uri);
        if (predicate(diags)) return diags;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return vscode.languages.getDiagnostics(doc.uri);
    };

    const diags = await waitFor(d => d.length > 0);
    const upper = diags.find(d => d.code === 'upperCaseNoteName');
    assert.ok(upper, 'upperCaseNoteName diagnostic should be published');
    assert.strictEqual(upper.severity, vscode.DiagnosticSeverity.Error);
    assert.strictEqual(upper.range.start.line, 1);
    assert.strictEqual(doc.getText(upper.range), 'E4/4');

    const editor = vscode.window.activeTextEditor!;
    await editor.edit(edit => edit.replace(upper.range, 'c5/4'));
    const cleared = await waitFor(d => d.length === 0);
    assert.strictEqual(cleared.length, 0, 'Diagnostics should be cleared after fixing the note');
  });

  test('Tuning diagnostics highlight the invalid pitch and clear after correction', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'guitardsl',
      content: 'tuning: E2 A2 H3 G3 B3 E4\n[Intro]\n| C |\n'
    });
    const editor = await showAndFocus(doc);
    const waitFor = async (predicate: (items: readonly vscode.Diagnostic[]) => boolean) => {
      for (let i = 0; i < 50; i++) {
        const items = vscode.languages.getDiagnostics(doc.uri);
        if (predicate(items)) return items;
        await settle(100);
      }
      return vscode.languages.getDiagnostics(doc.uri);
    };
    const invalid = (await waitFor(items => items.some(d => d.code === 'invalidTuningPitch')))
      .find(d => d.code === 'invalidTuningPitch');
    assert.ok(invalid, 'invalidTuningPitch diagnostic should be published');
    assert.strictEqual(invalid.severity, vscode.DiagnosticSeverity.Error);
    assert.strictEqual(invalid.range.start.line, 0);
    assert.strictEqual(doc.getText(invalid.range), 'H3');
    await editor.edit(edit => edit.replace(invalid.range, 'D3'));
    assert.strictEqual((await waitFor(items => items.length === 0)).length, 0, 'diagnostics should clear after correction');
  });

  test('Transcribe YouTube command should lazily open transcribe panel', async () => {
    await vscode.commands.executeCommand('guitardsl.transcribeYouTube');
    let transcribeTab: vscode.Tab | undefined;
    for (let i = 0; i < 50 && !transcribeTab; i++) {
      const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
      transcribeTab = tabs.find(t => t.input instanceof vscode.TabInputWebview && (t.label.includes('採譜') || t.label.includes('Transcribe')));
      if (!transcribeTab) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(transcribeTab, 'Transcribe webview tab should be open');
    assert.ok(transcribeTab.label.includes('Experimental') || transcribeTab.label.includes('実験的'), 'the opened webview tab identifies the feature as Experimental');
  });
});



suite('Practice Mode host commands (Issue #93)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const previewCapo = () => require('../../previewCapo');
  const commandActions = [
    ['guitardsl.playback.togglePlayPause', 'togglePlayPause'],
    ['guitardsl.playback.stop', 'stop'],
    ['guitardsl.practice.toggle', 'practiceToggle'],
    ['guitardsl.practice.setLoopStart', 'practiceSetLoopStart'],
    ['guitardsl.practice.setLoopEnd', 'practiceSetLoopEnd'],
    ['guitardsl.practice.clearLoop', 'practiceClearLoop'],
    ['guitardsl.practice.slower', 'practiceSlower'],
    ['guitardsl.practice.faster', 'practiceFaster']
  ] as const;
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(check: () => boolean, message: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
      if (check()) return;
      await sleep(100);
    }
    assert.fail(message);
  }
  const previewTabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs)
    .filter(tab => tab.input instanceof vscode.TabInputWebview && tab.label.includes('GuitarDSL'));

  test('E2E-PM01 no-Preview warning and all eight command-to-action mappings', async () => {
    await closeAllEditors();
    const probe = previewCapo().previewLifecycleProbe;
    const previousGeneration = probe.generation;
    if (previousGeneration > 0) {
      await waitFor(() => probe.disposedGeneration === previousGeneration, 'previous Preview should be disposed');
    }
    assert.strictEqual(previewTabs().length, 0, 'start without a Preview');
    assert.strictEqual(probe.lastPlaybackAction, undefined, 'disposing the prior Preview clears the observation');

    const window = vscode.window as unknown as { showWarningMessage: (message: string) => unknown };
    const originalWarning = window.showWarningMessage;
    const warnings: string[] = [];
    try {
      window.showWarningMessage = async (message: string) => { warnings.push(message); return undefined; };
      for (const [command] of commandActions) await vscode.commands.executeCommand(command);
      assert.strictEqual(warnings.length, commandActions.length, 'every host command warns when Preview is absent');
      assert.strictEqual(probe.generation, previousGeneration, 'Practice commands do not open or render Preview');
      assert.strictEqual(probe.lastPlaybackAction, undefined, 'commands without Preview send no playback message');
      assert.strictEqual(previewTabs().length, 0, 'no Preview webview tab is opened');
    } finally {
      window.showWarningMessage = originalWarning;
    }

    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: '| C |\nmel: | c4/1 |\n' });
    await showAndFocus(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
    await waitFor(() => probe.generation > previousGeneration && probe.currentDocumentUri === doc.uri.toString(),
      'Preview should be created for the current GuitarDSL document');
    assert.strictEqual(probe.lastPlaybackAction, undefined, 'creating Preview starts with a cleared action observation');

    for (const [command, expectedAction] of commandActions) {
      await vscode.commands.executeCommand(command);
      assert.strictEqual(probe.lastPlaybackAction, expectedAction, `${command} posts action ${expectedAction}`);
    }
    await closeAllEditors();
    await waitFor(() => probe.disposedGeneration === probe.generation, 'closing Preview resets the action observation');
    assert.strictEqual(probe.lastPlaybackAction, undefined);
  });
});

suite('Capo / playability (Issue #62)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const previewCapo = () => require('../../previewCapo');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const scoreSettings = () => require('../../scoreSettingsEditor');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('os');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodePath = require('path');

  const SOURCE = ['title: Capo Test', 'key: B', '', '[Intro]', '| B | E | F#m7 | E/G# |', ''].join('\n');
  const AT_CAPO_2 = ['title: Capo Test', 'capo: 2', 'key: B', '', '[Intro]', '| A | D | Em7 | D/F# |', ''].join('\n');

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(check: () => boolean, message: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
      if (check()) return;
      await sleep(100);
    }
    assert.fail(message);
  }
  async function openPreviewed(content: string): Promise<vscode.TextDocument> {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content });
    await showAndFocus(doc, vscode.ViewColumn.One);
    previewCapo().effectiveDslProbe.previewInput = undefined;
    await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
    await waitFor(() => previewCapo().effectiveDslProbe.previewInput === doc.getText(), 'preview should render the source');
    return doc;
  }
  function tmpPdf(name: string): vscode.Uri {
    return vscode.Uri.file(nodePath.join(os.tmpdir(), `guitardsl-e2e-${process.pid}-${name}.pdf`));
  }
  async function replaceAll(doc: vscode.TextDocument, text: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
    assert.ok(await vscode.workspace.applyEdit(edit));
  }

  suiteSetup(async () => {
    const ext = vscode.extensions.all.find(e => e.packageJSON?.name === 'vscode-guitar-dsl');
    if (ext && !ext.isActive) await ext.activate();
  });

  test('E2E-01 capo and score settings commands are registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('guitardsl.editCapo'));
    assert.ok(commands.includes('guitardsl.editScoreSettings'));
  });

  test('E2E-02 opening score settings reuses the Inspector and does not mutate the source', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    const version = doc.version;
    await vscode.commands.executeCommand('guitardsl.editCapo', doc.uri);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { inspectorViewTestProbe } = require('../../inspector/inspectorView') as {
      inspectorViewTestProbe: { getContext?: () => any };
    };
    await waitFor(() => {
      return inspectorViewTestProbe.getContext?.()?.kind === 'settings';
    }, 'score settings should open in the shared Inspector');
    assert.strictEqual(doc.getText(), SOURCE);
    assert.strictEqual(doc.version, version);
    assert.ok(!vscode.window.tabGroups.all.flatMap(g => g.tabs)
      .some(t => t.input instanceof vscode.TabInputWebview && /^(Score Settings|楽譜設定)/.test(t.label)),
    'score settings must not open a second webview panel');
  });

  test('EDITOR-01 apply recomputes from the latest source', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: '| B |\n' });
    await showAndFocus(doc);
    await vscode.commands.executeCommand('guitardsl.editCapo', doc.uri);
    await replaceAll(doc, '| B | E |\n');
    const result = await scoreSettings().applyCapoTransform(doc.uri, 2);
    assert.ok(result.ok && result.changed);
    assert.strictEqual(doc.getText(), 'capo: 2\n| A | D |\n');
  });

  test('EDITOR-02 a single undo restores the previous DSL', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    const result = await scoreSettings().applyCapoTransform(doc.uri, 2);
    assert.ok(result.ok);
    assert.strictEqual(doc.getText(), AT_CAPO_2);
    await undoIn(doc);
    assert.strictEqual(doc.getText(), SOURCE);
  });

  test('PREVIEW-01/02 transient override without drift; PDF-01/02/03 PDF uses the same effective DSL', async () => {
    const doc = await openPreviewed(SOURCE);
    const controller = previewCapo().getPreviewCapoController();
    const probe = previewCapo().effectiveDslProbe;

    for (const target of [2, 5, 1]) assert.ok(controller.setTarget(doc, target));
    assert.strictEqual(doc.getText(), SOURCE, 'PREVIEW-01 the document is not mutated');
    assert.strictEqual(probe.previewInput, ['title: Capo Test', 'capo: 1', 'key: B', '', '[Intro]', '| Bb | Eb | Fm7 | Eb/G |', ''].join('\n'), 'PREVIEW-02 computed from source');

    assert.ok(controller.setTarget(doc, 2));
    assert.strictEqual(probe.previewInput, AT_CAPO_2);
    const target = tmpPdf('override');
    await vscode.commands.executeCommand('guitardsl.exportPdf', doc.uri, target);
    assert.strictEqual(probe.pdfInput, probe.previewInput, 'PDF-01 identical effective DSL');
    assert.ok(probe.pdfInput.includes('capo: 2') && probe.pdfInput.includes('key: B') && probe.pdfInput.includes('| A |'), 'PDF-02');
    assert.ok(fs.existsSync(target.fsPath) && fs.statSync(target.fsPath).size > 0, 'PDF-03 file written');
    fs.unlinkSync(target.fsPath);
    assert.strictEqual(doc.getText(), SOURCE);
  });

  test('Issue #84 alternate tuning reaches Preview and PDF while key and melody stay unchanged', async () => {
    const source = [
      'title: Alternate Tuning',
      'tuning: Drop D',
      'capo: 0',
      'key: C',
      '',
      '[Intro]',
      '| C |',
      'mel: | c4/1 |',
      ''
    ].join('\n');
    const doc = await openPreviewed(source);
    const controller = previewCapo().getPreviewCapoController();
    const probe = previewCapo().effectiveDslProbe;
    assert.ok(controller.setTarget(doc, 2));
    const expected = source.replace('capo: 0', 'capo: 2').replace('| C |', '| Bb |');
    await waitFor(() => probe.previewInput === expected, 'Preview should retain tuning and transform only capo-relative chord names');
    const target = tmpPdf('alternate-tuning');
    await vscode.commands.executeCommand('guitardsl.exportPdf', doc.uri, target);
    assert.strictEqual(probe.pdfInput, probe.previewInput, 'PDF must use the same effective DSL as Preview');
    assert.ok(probe.pdfInput.includes('tuning: Drop D') && probe.pdfInput.includes('key: C') && probe.pdfInput.includes('mel: | c4/1 |'));
    assert.ok(fs.existsSync(target.fsPath) && fs.statSync(target.fsPath).size > 0);
    fs.unlinkSync(target.fsPath);
    assert.strictEqual(doc.getText(), source, 'the temporary capo preview must not edit the document');
  });

  test('PREVIEW-03 source edits recompute the override; PREVIEW-04 unsupported source clears it', async () => {
    const doc = await openPreviewed(SOURCE);
    const controller = previewCapo().getPreviewCapoController();
    const probe = previewCapo().effectiveDslProbe;
    assert.ok(controller.setTarget(doc, 2));

    await replaceAll(doc, SOURCE.replace('| B | E |', '| B | C# |'));
    await waitFor(() => probe.previewInput?.includes('| A | B |') === true, 'PREVIEW-03 transformed preview follows the source');
    assert.deepStrictEqual(controller.getState(), { documentUri: doc.uri.toString(), targetCapo: 2 });

    const unsupported = 'chord C@special = x35553\n' + doc.getText().replace('| B |', '| C@special |');
    await replaceAll(doc, unsupported);
    await waitFor(() => probe.previewInput === unsupported, 'PREVIEW-04 source is rendered');
    assert.strictEqual(controller.getState(), undefined);
    assert.ok(controller.resolve(doc).capo.warning, 'a warning is shown in the capo bar');

    const target = tmpPdf('invalidated');
    await vscode.commands.executeCommand('guitardsl.exportPdf', doc.uri, target);
    assert.strictEqual(probe.pdfInput, unsupported, 'no stale transformed PDF');
    fs.unlinkSync(target.fsPath);
  });

  test('PDF-04 without an override the PDF input is exactly doc.getText(); state resets on switch and close', async () => {
    const doc = await openPreviewed(SOURCE);
    const controller = previewCapo().getPreviewCapoController();
    const probe = previewCapo().effectiveDslProbe;
    const target = tmpPdf('plain');
    await vscode.commands.executeCommand('guitardsl.exportPdf', doc.uri, target);
    assert.strictEqual(probe.pdfInput, doc.getText());
    fs.unlinkSync(target.fsPath);

    assert.ok(controller.setTarget(doc, 3));
    const other = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: '| G |\n' });
    await showAndFocus(other, vscode.ViewColumn.One);
    await waitFor(() => controller.getState() === undefined, 'switching documents resets the override');

    await showAndFocus(doc, vscode.ViewColumn.One);
    assert.ok(controller.setTarget(doc, 3));
    const previewTab = vscode.window.tabGroups.all.flatMap(g => g.tabs).find(t => t.input instanceof vscode.TabInputWebview && t.label.includes('GuitarDSL'));
    assert.ok(previewTab, 'preview tab');
    await vscode.window.tabGroups.close(previewTab!);
    await waitFor(() => controller.getState() === undefined, 'closing the preview resets the override');
  });

  test('E2E-PB01 source edits rebuild Preview HTML for the same document', async () => {
    const doc = await openPreviewed(SOURCE);
    const probe = previewCapo().previewLifecycleProbe;
    const generation = probe.generation;

    await replaceAll(doc, SOURCE.replace('Capo Test', 'Edited Capo Test'));
    await waitFor(() => probe.generation > generation && probe.currentDocumentUri === doc.uri.toString(),
      'editing the source should generate new Preview HTML for the same document');
    assert.ok(probe.generation > generation);
  });

  test('E2E-PB02 switching documents rebuilds Preview for the newly active document', async () => {
    await openPreviewed(SOURCE);
    const probe = previewCapo().previewLifecycleProbe;
    const generation = probe.generation;
    const docB = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: '| G |\n' });

    await showAndFocus(docB, vscode.ViewColumn.One);
    await waitFor(() => probe.generation > generation && probe.currentDocumentUri === docB.uri.toString(),
      'document switch should generate Preview HTML for document B');
  });

  test('E2E-PB03 closing the Preview webview disposes its current HTML generation', async () => {
    await openPreviewed(SOURCE);
    const probe = previewCapo().previewLifecycleProbe;
    const generation = probe.generation;
    let previewTab: vscode.Tab | undefined;
    await waitFor(() => {
      previewTab = vscode.window.tabGroups.all.flatMap(group => group.tabs)
        .find(tab => tab.input instanceof vscode.TabInputWebview && tab.label.includes('GuitarDSL'));
      return previewTab !== undefined;
    }, 'Preview Webview tab should be open');

    await vscode.window.tabGroups.close(previewTab!);
    await waitFor(() => probe.disposedGeneration === generation,
      'closing the Preview tab should dispose the current generation');
  });
});

suite('Beginner Mode (Issue #65)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const previewCapo = () => require('../../previewCapo');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const previewBeginner = () => require('../../previewBeginner');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const beginnerMode = () => require('../../beginnerMode');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const scoreSettings = () => require('../../scoreSettingsEditor');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const i18n = () => require('../../i18n');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('os');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodePath = require('path');

  const SOURCE = ['title: Beginner Test', 'key: C', '', '[Intro]', '| F | C | G | Am |', ''].join('\n');
  const FORBID_AT_0 = SOURCE.replace('| F |', '| Fmaj7 |');

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(check: () => boolean, message: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
      if (check()) return;
      await sleep(100);
    }
    assert.fail(message);
  }
  const probe = () => previewCapo().effectiveDslProbe;
  const beginner = () => previewBeginner().getPreviewBeginnerController();
  const capo = () => previewCapo().getPreviewCapoController();
  async function openPreviewed(content: string): Promise<vscode.TextDocument> {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content });
    await showAndFocus(doc, vscode.ViewColumn.One);
    probe().previewInput = undefined;
    await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
    await waitFor(() => probe().previewInput === doc.getText(), 'preview should render the source');
    return doc;
  }
  function tmpPdf(name: string): vscode.Uri {
    return vscode.Uri.file(nodePath.join(os.tmpdir(), `guitardsl-e2e-${process.pid}-beginner-${name}.pdf`));
  }
  async function exportPdf(doc: vscode.TextDocument, name: string): Promise<string> {
    const target = tmpPdf(name);
    await vscode.commands.executeCommand('guitardsl.exportPdf', doc.uri, target);
    assert.ok(fs.existsSync(target.fsPath) && fs.statSync(target.fsPath).size > 0, 'PDF written');
    fs.unlinkSync(target.fsPath);
    return probe().pdfInput;
  }
  async function replaceAll(doc: vscode.TextDocument, text: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
    assert.ok(await vscode.workspace.applyEdit(edit));
  }

  suiteSetup(async () => {
    const ext = vscode.extensions.all.find(e => e.packageJSON?.name === 'vscode-guitar-dsl');
    if (ext && !ext.isActive) await ext.activate();
  });

  test('BEG-E2E-01 ON clears the capo override and uses forbid + auto; Preview and PDF are identical; OFF shows the source', async () => {
    const doc = await openPreviewed(SOURCE);
    assert.ok(capo().setTarget(doc, 2));
    assert.ok(beginner().enable(doc));
    assert.strictEqual(capo().getState(), undefined, 'the capo override is cleared');
    assert.deepStrictEqual(beginner().getState(), { documentUri: doc.uri.toString(), barrePolicy: 'forbid' });
    const expected = beginnerMode().planBeginnerTransform(SOURCE, { barrePolicy: 'forbid' });
    assert.ok(expected.ok);
    assert.strictEqual(expected.text, FORBID_AT_0);
    assert.strictEqual(probe().previewInput, expected.text);
    assert.strictEqual(await exportPdf(doc, 'on'), probe().previewInput, 'Beginner Mode PDF input equals the preview input');
    assert.strictEqual(doc.getText(), SOURCE, 'the document is not mutated');

    beginner().disable(doc);
    assert.strictEqual(beginner().getState(), undefined);
    assert.strictEqual(capo().getState(), undefined, 'the previous capo override is not restored');
    assert.strictEqual(probe().previewInput, SOURCE);
    assert.strictEqual(await exportPdf(doc, 'off'), SOURCE, 'inactive: the existing capo behavior (source text)');

    // Repeated ON/OFF does not drift.
    for (let i = 0; i < 3; i++) {
      assert.ok(beginner().enable(doc));
      assert.strictEqual(probe().previewInput, FORBID_AT_0);
      beginner().disable(doc);
      assert.strictEqual(probe().previewInput, SOURCE);
    }
  });

  test('BEG-E2E-02 manual capo fixes the target; a policy change returns to auto', async () => {
    const doc = await openPreviewed(SOURCE);
    assert.ok(beginner().enable(doc));
    assert.ok(beginner().setTargetCapo(doc, 5));
    assert.strictEqual(beginner().getState().targetCapo, 5);
    const at5 = beginnerMode().planBeginnerTransform(SOURCE, { barrePolicy: 'forbid', targetCapo: 5 });
    assert.ok(at5.ok);
    assert.strictEqual(probe().previewInput, at5.text);
    assert.strictEqual(capo().getState(), undefined, 'the capo selector drives Beginner Mode, not the capo override');

    assert.ok(beginner().setBarrePolicy(doc, 'allow'));
    assert.deepStrictEqual(beginner().getState(), { documentUri: doc.uri.toString(), barrePolicy: 'allow' });
    const auto = beginnerMode().planBeginnerTransform(SOURCE, { barrePolicy: 'allow' });
    assert.ok(auto.ok && auto.autoCapo);
    assert.strictEqual(probe().previewInput, auto.text);
    assert.strictEqual(await exportPdf(doc, 'allow'), probe().previewInput);
    beginner().disable(doc);
  });

  test('BEG-E2E-03 source edits recompute; an unsolvable edit clears the state with a warning and no stale PDF', async () => {
    const doc = await openPreviewed(SOURCE);
    assert.ok(beginner().enable(doc));
    assert.ok(beginner().setTargetCapo(doc, 0));
    await replaceAll(doc, SOURCE.replace('| G |', '| Cmaj9 |'));
    await waitFor(() => probe().previewInput?.includes('| Fmaj7 | C | Cmaj7 | Am |') === true, 'preview follows the edited source');
    assert.strictEqual(beginner().getState().targetCapo, 0);

    const unsolvable = doc.getText().replace('| Am |', '| Bm |');
    await replaceAll(doc, unsolvable);
    await waitFor(() => probe().previewInput === unsolvable, 'the source is rendered');
    assert.strictEqual(beginner().getState(), undefined);
    assert.ok(beginner().currentNotice(), 'a warning is kept for the capo bar');
    assert.strictEqual(await exportPdf(doc, 'cleared'), unsolvable, 'no stale transformed PDF');
  });

  test('TAB-E2E-01 transform guards reset Preview overrides and keep Preview and PDF on source', async () => {
    const tabSource = [
      'title: Beginner TAB Test',
      'key: C',
      '',
      '[Intro]',
      '| C | G | Am | F |',
      'tab: | 6f0/1 | 6f2/1 | 5f0/1 | 5f2/1 |',
      ''
    ].join('\n');

    const capoDoc = await openPreviewed(SOURCE);
    assert.ok(capo().setTarget(capoDoc, 2));
    await replaceAll(capoDoc, tabSource);
    await waitFor(() => probe().previewInput === tabSource, 'TAB source is rendered after capo override reset');
    assert.strictEqual(capo().getState(), undefined);
    assert.strictEqual(capo().resolve(capoDoc).text, tabSource, 'capo failure does not return a partial rewrite');
    assert.ok(capo().resolve(capoDoc).capo.warning, 'capo reset warning is retained');
    assert.strictEqual(await exportPdf(capoDoc, 'tab-capo-reset'), tabSource, 'PDF uses the unmodified TAB source');

    const beginnerDoc = await openPreviewed(SOURCE);
    assert.ok(beginner().enable(beginnerDoc));
    await replaceAll(beginnerDoc, tabSource);
    await waitFor(() => probe().previewInput === tabSource, 'TAB source is rendered after Beginner Mode reset');
    assert.strictEqual(beginner().getState(), undefined);
    assert.ok(beginner().currentNotice(), 'Beginner Mode reset warning is retained');
    const effective = previewBeginner().resolvePreviewEffectiveDsl(beginnerDoc, beginner(), capo());
    assert.strictEqual(effective.text, tabSource, 'effective DSL never contains a partial Beginner Mode rewrite');
    assert.strictEqual(await exportPdf(beginnerDoc, 'tab-beginner-reset'), tabSource, 'PDF uses the unmodified TAB source');
  });

  test('BEG-E2E-04 switching documents, closing the document and closing the preview clear the state', async () => {
    const doc = await openPreviewed(SOURCE);
    assert.ok(beginner().enable(doc));
    const other = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: '| G |\n' });
    await showAndFocus(other, vscode.ViewColumn.One);
    await waitFor(() => beginner().getState() === undefined, 'switching documents clears Beginner Mode');
    assert.strictEqual(await exportPdf(doc, 'switched'), SOURCE);

    await showAndFocus(doc, vscode.ViewColumn.One);
    assert.ok(beginner().enable(doc));
    const previewTab = vscode.window.tabGroups.all.flatMap(g => g.tabs).find(t => t.input instanceof vscode.TabInputWebview && t.label.includes('GuitarDSL'));
    assert.ok(previewTab, 'preview tab');
    await vscode.window.tabGroups.close(previewTab!);
    await waitFor(() => beginner().getState() === undefined, 'closing the preview clears Beginner Mode');

    const closing = await openPreviewed(SOURCE);
    assert.ok(beginner().enable(closing));
    await showAndFocus(closing, vscode.ViewColumn.One);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await waitFor(() => beginner().getState() === undefined, 'closing the document clears Beginner Mode');
  });

  test('BEG-E2E-05 apply recomputes from the latest source in one WorkspaceEdit and one undo restores it', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    const edited = SOURCE.replace('| G |', '| G | F |');
    await replaceAll(doc, edited);
    const versionBefore = doc.version;
    const result = await scoreSettings().applyBeginnerTransform(doc.uri, { barrePolicy: 'forbid', targetCapo: 0 });
    assert.ok(result.ok && result.changed);
    assert.strictEqual(doc.getText(), edited.replace(/\| F \|/g, '| Fmaj7 |'), 'computed from the latest source');
    assert.strictEqual(doc.version, versionBefore + 1, 'a single edit');
    await undoIn(doc);
    assert.strictEqual(doc.getText(), edited, 'one undo restores the whole DSL');

    await replaceAll(doc, '| Bm |\n');
    const none = await scoreSettings().applyBeginnerTransform(doc.uri, { barrePolicy: 'forbid', targetCapo: 0 });
    assert.ok(!none.ok && none.code === 'noPlayableAlternative');
    assert.strictEqual(doc.getText(), '| Bm |\n', 'a failed apply does not modify the source');
  });

  test('BEG-E2E-06 the Beginner section model shows mapping but never applies edits itself', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    const section = new (scoreSettings().BeginnerSection)();
    let refreshed = 0;
    const statuses: string[] = [];
    const ctx = {
      doc,
      messages: i18n().getMessages('ja'),
      editorMessages: i18n().getScoreSettingsEditorMessages('ja'),
      refresh: () => { refreshed++; },
      status: (text: string) => { statuses.push(text); }
    };
    assert.strictEqual(section.id, 'beginner');
    const model = section.buildModel(ctx);
    assert.strictEqual(model.barrePolicy, 'forbid');
    assert.strictEqual(model.selectedCapo, null);
    assert.strictEqual(model.candidates.length, 13);
    assert.deepStrictEqual(model.mapping.find((r: any) => r.source === 'F'), { source: 'F', capoChord: 'F', target: 'Fmaj7', substituted: true });
    assert.ok(model.canApply);

    await section.onMessage(ctx, { command: 'setPolicy', policy: 'allow' });
    assert.strictEqual(section.buildModel(ctx).barrePolicy, 'allow');
    await section.onMessage(ctx, { command: 'select', capo: 0 });
    assert.strictEqual(section.buildModel(ctx).selectedCapo, 0);
    assert.strictEqual(section.buildModel(ctx).canApply, false, 'allow at capo 0 keeps the source');
    await section.onMessage(ctx, { command: 'setPolicy', policy: 'forbid' });
    assert.strictEqual(section.buildModel(ctx).selectedCapo, null, 'a policy change returns to auto');
    await section.onMessage(ctx, { command: 'select', capo: 0 });
    // The settings controller alone owns Apply; a section message cannot edit the document.
    const sourceBeforeApplyMessage = doc.getText();
    await section.onMessage(ctx, { command: 'apply', text: 'stale webview text' });
    assert.strictEqual(doc.getText(), sourceBeforeApplyMessage);
    assert.strictEqual(section.buildModel(ctx).canApply, true);
    assert.strictEqual(statuses.length, 0);
    assert.ok(refreshed > 0);
  });
});

suite('Advanced notation / sounding transposition (Issue #68)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const previewCapo = () => require('../../previewCapo');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const previewBeginner = () => require('../../previewBeginner');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const beginnerMode = () => require('../../beginnerMode');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const scoreSettings = () => require('../../scoreSettingsEditor');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const i18n = () => require('../../i18n');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('os');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodePath = require('path');

  const SOURCE = ['title: Transpose Test', 'capo: 0', 'key: C', '', '| C | F |', 'mel: | c5/1 | a4/1 |', ''].join('\n');

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(check: () => boolean, message: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
      if (check()) return;
      await sleep(100);
    }
    assert.fail(message);
  }
  const probe = () => previewCapo().effectiveDslProbe;
  async function replaceAll(doc: vscode.TextDocument, text: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
    assert.ok(await vscode.workspace.applyEdit(edit));
  }
  function sectionContext(doc: vscode.TextDocument, statuses: string[]) {
    return {
      doc,
      messages: i18n().getMessages('en'),
      editorMessages: i18n().getScoreSettingsEditorMessages('en'),
      refresh: () => undefined,
      status: (text: string) => { statuses.push(text); }
    };
  }
  function tmpPdf(name: string): vscode.Uri {
    return vscode.Uri.file(nodePath.join(os.tmpdir(), `guitardsl-e2e-${process.pid}-transpose-${name}.pdf`));
  }

  suiteSetup(async () => {
    const ext = vscode.extensions.all.find(e => e.packageJSON?.name === 'vscode-guitar-dsl');
    if (ext && !ext.isActive) await ext.activate();
  });

  test('TR-E2E-01 settings sections cannot edit; a stale expected source is rejected (T042)', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    const statuses: string[] = [];
    const ctx = sectionContext(doc, statuses);
    const section = new (scoreSettings().TransposeSection)();
    await section.onMessage(ctx, { command: 'setSemitones', semitones: 2 });
    const model = section.buildModel(ctx);
    const expected = { version: doc.version, source: doc.getText() };
    assert.strictEqual(model.targetKey, 'D');
    assert.deepStrictEqual(model.mapping, [['C', 'D'], ['F', 'G']]);
    assert.ok(model.canApply);
    // The document changes after the model was shown; the approved session cannot edit that newer source.
    await replaceAll(doc, SOURCE.replace('| C | F |', '| C | F | G |').replace('| a4/1 |', '| a4/1 | b4/1 |'));
    const stale = await scoreSettings().applyTransposeTransform(doc.uri, { semitones: 2, capoMode: { kind: 'keep' } }, expected);
    assert.ok(!stale.ok && stale.code === 'staleDocument');
    const changedSource = doc.getText();
    await section.onMessage(ctx, { command: 'apply', text: 'stale webview text', model });
    assert.strictEqual(doc.getText(), changedSource, 'section messages never apply edits directly');
    const result = await scoreSettings().applyTransposeTransform(doc.uri, { semitones: 2, capoMode: { kind: 'keep' } }, {
      version: doc.version,
      source: doc.getText()
    });
    assert.ok(result.ok && result.changed);
    assert.strictEqual(doc.getText(), ['title: Transpose Test', 'capo: 0', 'key: D', '', '| D | G | A |', 'mel: | d5/1 | b4/1 | c#5/1 |', ''].join('\n'));
    assert.strictEqual(statuses.length, 0, 'section models do not own apply status or document edits');
    assert.strictEqual(section.buildModel(ctx).semitones, 2, 'only the settings controller resets a session after apply');
  });

  test('TR-E2E-02 transpose + explicit capo is one WorkspaceEdit and one undo (T043)', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    const version = doc.version;
    const result = await scoreSettings().applyTransposeTransform(doc.uri, { semitones: 2, capoMode: { kind: 'explicit', capo: 2 } });
    assert.ok(result.ok && result.changed);
    assert.strictEqual(doc.getText(), SOURCE.replace('capo: 0', 'capo: 2').replace('key: C', 'key: D').replace('mel: | c5/1 | a4/1 |', 'mel: | d5/1 | b4/1 |'));
    assert.strictEqual(doc.version, version + 1, 'a single edit');
    await undoIn(doc);
    assert.strictEqual(doc.getText(), SOURCE, 'one undo restores the exact original');

    // A failing plan never edits the document.
    await replaceAll(doc, 'chord C@x = x32010\n| C@x |\n');
    const failed = await scoreSettings().applyTransposeTransform(doc.uri, { semitones: 1, capoMode: { kind: 'keep' } });
    assert.ok(!failed.ok && failed.code === 'labeledChordVariant');
    assert.strictEqual(doc.getText(), 'chord C@x = x32010\n| C@x |\n');
  });

  test('TR-E2E-03 score settings use the single Inspector and keep all three host-owned section models (T044)', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { inspectorViewTestProbe } = require('../../inspector/inspectorView') as {
      inspectorViewTestProbe: { resolvedView?: vscode.WebviewView; getContext?: () => any };
    };
    await vscode.commands.executeCommand('guitardsl.editScoreSettings', doc.uri);
    await waitFor(() => inspectorViewTestProbe.getContext?.()?.kind === 'settings' && !!inspectorViewTestProbe.resolvedView,
      'settings context is shown in the resolved Inspector view');
    const inspectorView = inspectorViewTestProbe.resolvedView;
    assert.ok(inspectorView, 'the registered Inspector view is reused');
    const settingsContext = inspectorViewTestProbe.getContext?.();
    assert.strictEqual(settingsContext.section, 'capo');
    assert.deepStrictEqual(settingsContext.sections.map((s: any) => s.id), ['capo', 'beginner', 'transpose']);
    if (process.env.GUITARDSL_E2E_CAPTURE_SCREENSHOTS === '1') {
      const requestedLocale = (process.env.GUITARDSL_E2E_LOCALE ?? vscode.env.language).toLowerCase().split('-')[0];
      assert.ok(vscode.env.language.toLowerCase().startsWith(requestedLocale),
        `screenshot locale ${requestedLocale} must match VS Code locale ${vscode.env.language}`);
      const requestedTheme = process.env.GUITARDSL_E2E_THEME ?? 'Default Dark Modern';
      await vscode.workspace.getConfiguration('workbench').update('colorTheme', requestedTheme, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('notifications.clearAll');
      await vscode.commands.executeCommand('workbench.action.focusAuxiliaryBar');
      const captureWaitMs = Number(process.env.GUITARDSL_E2E_CAPTURE_WAIT_MS ?? 500);
      if (Number.isFinite(captureWaitMs) && captureWaitMs > 0) await settle(Math.min(captureWaitMs, 5000));
      const theme = /light/i.test(requestedTheme) ? 'light' : 'dark';

      assert.strictEqual(await evaluateInspectorWebview<boolean>('!document.getElementById("settings-state").hidden'), true,
        'the production Inspector renders settings without a second panel');
      assert.strictEqual(await activateInspectorControlWithKeyboard('section', 'beginner'), true,
        'section navigation is available by keyboard');
      await waitFor(() => inspectorViewTestProbe.getContext?.()?.section === 'beginner', 'Beginner section switch reaches the host');
      const sourceBeforeSelection = doc.getText();
      const beginnerModel = inspectorViewTestProbe.getContext?.()?.model;
      const candidate = beginnerModel?.candidates?.find((item: any) => item.supported);
      assert.ok(candidate, 'the Beginner model exposes a supported capo candidate');
      const candidateActivated = await activateInspectorControlWithKeyboard('candidate', String(candidate.capo));
      if (!candidateActivated) {
        const state = await evaluateInspectorWebview<string>(
          'JSON.stringify({active:{tag:document.activeElement?.tagName,control:document.activeElement?.dataset?.inspectorControl,key:document.activeElement?.dataset?.inspectorKey,pressed:document.activeElement?.getAttribute("aria-pressed")},section:window.guitarDslInspectorContext?.section,candidates:Array.from(document.querySelectorAll("[data-inspector-control=candidate]")).map(node=>({key:node.dataset.inspectorKey,disabled:node.disabled,pressed:node.getAttribute("aria-pressed"),name:node.getAttribute("aria-label")}))})'
        );
        assert.fail(`candidate selection is not reachable by keyboard: ${state}`);
      }
      await waitFor(() => inspectorViewTestProbe.getContext?.()?.model?.selectedCapo === candidate.capo,
        'candidate selection updates the host model');
      assert.strictEqual(doc.getText(), sourceBeforeSelection, 'candidate selection never edits the DSL');
      await captureWorkbenchScreenshot(`settings-${requestedLocale}-${theme}-narrow-beginner.png`, 135);
      await vscode.commands.executeCommand('workbench.action.focusAuxiliaryBar');

      assert.strictEqual(await activateInspectorControlWithKeyboard('section', 'transpose'), true,
        'Transpose navigation is available by keyboard');
      await waitFor(() => inspectorViewTestProbe.getContext?.()?.section === 'transpose', 'Transpose section switch reaches the host');
      await captureWorkbenchScreenshot(`settings-${requestedLocale}-${theme}-narrow-transpose.png`, 135);
      await vscode.commands.executeCommand('workbench.action.focusAuxiliaryBar');

      assert.strictEqual(await activateInspectorControlWithKeyboard('section', 'capo'), true,
        'Capo navigation remains available after changing settings');
      await waitFor(() => inspectorViewTestProbe.getContext?.()?.section === 'capo', 'Capo section returns from the keyboard');
      const capoModel = inspectorViewTestProbe.getContext?.()?.model;
      const capoCandidate = capoModel?.candidates?.find((item: any) => item.supported && item.capo !== capoModel.selectedCapo);
      assert.ok(capoCandidate, 'the Capo model exposes a different supported candidate');
      const sourceBeforeCapoSelection = doc.getText();
      assert.strictEqual(await activateInspectorControlWithKeyboard('candidate', String(capoCandidate.capo)), true,
        'a Capo candidate is selectable by keyboard');
      await waitFor(() => inspectorViewTestProbe.getContext?.()?.model?.selectedCapo === capoCandidate.capo,
        'Capo candidate selection updates the host model');
      assert.strictEqual(doc.getText(), sourceBeforeCapoSelection, 'Capo preview selection never edits the DSL');
      assert.strictEqual(inspectorViewTestProbe.getContext?.()?.model?.canApply, true,
        'a valid Capo selection enables Apply');
      await captureWorkbenchScreenshot(`settings-${requestedLocale}-${theme}-narrow-capo.png`, 135);
      const previewProbe = previewCapo().effectiveDslProbe;
      previewProbe.previewInput = undefined;
      const capoPlan = require('../../capo').planCapoTransform(doc.getText(), capoCandidate.capo);
      assert.ok(capoPlan.ok);
      await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
      await waitFor(() => previewProbe.previewInput === capoPlan.text,
        'an explicit Preview opened after settings projects the current Capo draft');
      assert.strictEqual(doc.getText(), sourceBeforeCapoSelection, 'opening Preview and comparing a draft never edits the DSL');
      await vscode.commands.executeCommand('workbench.action.focusAuxiliaryBar');
      const applyReachable = await activateInspectorControlWithKeyboard('action', 'apply', true, false);
      if (!applyReachable) {
        const state = await evaluateInspectorWebview<string>(
          'JSON.stringify({active:{tag:document.activeElement?.tagName,control:document.activeElement?.dataset?.inspectorControl,key:document.activeElement?.dataset?.inspectorKey,label:document.activeElement?.getAttribute("aria-label"),text:document.activeElement?.textContent},apply:{disabled:document.getElementById("settings-apply")?.disabled,label:document.getElementById("settings-apply")?.getAttribute("aria-label"),text:document.getElementById("settings-apply")?.textContent},controls:Array.from(document.querySelectorAll("#settings-tabs button,#settings-content button,#settings-actions button")).map(node=>({control:node.dataset.inspectorControl,key:node.dataset.inspectorKey,disabled:node.disabled,label:node.getAttribute("aria-label"),text:node.textContent}))})'
        );
        assert.fail(`the enabled Apply action is not reachable by keyboard or exposed as a named button: ${state}`);
      }
      assert.strictEqual(await activateInspectorControlWithKeyboard('action', 'close'), true,
        'Close is reachable and activates from the keyboard');
      await waitFor(() => inspectorViewTestProbe.getContext?.()?.kind !== 'settings', 'keyboard Close ends the settings session');
      assert.strictEqual(doc.getText(), sourceBeforeCapoSelection, 'keyboard Close applies no source edit');
      await waitFor(() => previewProbe.previewInput === doc.getText(),
        'Close restores the Preview state that existed before the explicit Preview was opened');
    }

    await vscode.commands.executeCommand('guitardsl.editCapo', doc.uri);
    await waitFor(() => inspectorViewTestProbe.getContext?.()?.kind === 'settings', 'the capo command routes to the Inspector');
    assert.strictEqual(inspectorViewTestProbe.resolvedView, inspectorView, 'both commands reuse one Inspector view');
    assert.strictEqual(inspectorViewTestProbe.getContext?.()?.section, 'capo');

    const ctx = sectionContext(doc, []);
    const capoSection = new (scoreSettings().CapoSection)();
    const beginnerSection = new (scoreSettings().BeginnerSection)();
    const transposeSection = new (scoreSettings().TransposeSection)();
    assert.strictEqual(capoSection.selectCapo(2), true);
    assert.strictEqual(beginnerSection.setBarrePolicy('allow'), true);
    assert.strictEqual(beginnerSection.selectCapo(3), true);
    assert.strictEqual(transposeSection.setSemitones(5), true);
    assert.strictEqual(transposeSection.setCapoMode('recommended'), true);
    assert.strictEqual(beginnerSection.buildModel(ctx).barrePolicy, 'allow');
    assert.deepStrictEqual(beginnerSection.getOptions(), { barrePolicy: 'allow', targetCapo: 3 });
    assert.strictEqual(transposeSection.buildModel(ctx).semitones, 5, 'sections keep their own state');
    assert.strictEqual(transposeSection.buildModel(ctx).capoMode, 'recommended');
    const titles = [capoSection, beginnerSection, transposeSection].map((s: any) => s.title(i18n().getScoreSettingsEditorMessages('ja')));
    assert.deepStrictEqual(titles, ['カポ / 弾きやすさ', '初心者モード', '移調']);
  });

  test('S135-07 a pending settings Apply validates input before invalidating and applies valid selections', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    const preview = previewCapo();
    await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
    await waitFor(() => preview.effectiveDslProbe.previewInput === SOURCE, 'the source Preview is open before Settings');
    await vscode.commands.executeCommand('guitardsl.editCapo', doc.uri);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const inspector = require('../../inspector/inspectorView').inspectorViewTestProbe;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const settings = require('../../scoreSettingsInspectorController').scoreSettingsInspectorProbe;
    const dispatch = (command: string, fields?: Record<string, unknown>) => settings.dispatchMessage!(command, fields);
    await waitFor(() => inspector.getContext?.()?.kind === 'settings', 'the Settings session is open');

    const windowApi = vscode.window as unknown as { showWarningMessage: (...args: unknown[]) => Promise<unknown> };
    const workspaceApi = vscode.workspace as unknown as { applyEdit: unknown };
    const originalWarning = windowApi.showWarningMessage;
    const originalApplyEdit = workspaceApi.applyEdit;
    let applyCount = 0;
    let confirmations: Array<(accept?: boolean) => void> = [];
    workspaceApi.applyEdit = async (edit: vscode.WorkspaceEdit) => {
      applyCount++;
      return (originalApplyEdit as (this: typeof vscode.workspace, edit: vscode.WorkspaceEdit) => Promise<boolean>)
        .call(vscode.workspace, edit);
    };
    windowApi.showWarningMessage = (...args: unknown[]) => new Promise(resolve => {
      const affirmative = args[args.length - 1];
      confirmations.push((accept = true) => resolve(accept ? affirmative : undefined));
    });
    const selectDifferentCapo = async () => {
      const context = inspector.getContext?.();
      if (context?.model?.canApply) return;
      const candidate = context?.model?.candidates?.find((item: any) => item.supported && item.capo !== context.model.sourceCapo);
      assert.ok(candidate, 'a different supported Capo candidate is available');
      await dispatch('settingsSelectCapo', { capo: candidate.capo });
      await waitFor(() => inspector.getContext?.()?.model?.selectedCapo === candidate.capo
          && inspector.getContext?.()?.model?.canApply === true,
        'the candidate is selected before Apply');
    };
    const beginApply = async () => {
      confirmations = [];
      const context = inspector.getContext?.();
      assert.strictEqual(context?.model?.canApply, true,
        `Apply must be enabled before the test opens its modal: ${JSON.stringify(context?.model)}`);
      const pending = dispatch('settingsApply');
      for (let attempt = 0; attempt < 50 && confirmations.length === 0; attempt++) await settle(20);
      assert.ok(confirmations.length > 0,
        `the modal Apply confirmation is pending: ${JSON.stringify(inspector.getContext?.())}`);
      const confirm = confirmations.shift();
      if (!confirm) throw new Error('the modal Apply confirmation did not open');
      return { pending, confirm };
    };
    try {
      await selectDifferentCapo();
      const beforeReopen = inspector.getContext?.();
      const reopened = await beginApply();
      await vscode.commands.executeCommand('guitardsl.editCapo', doc.uri);
      await waitFor(() => inspector.getContext?.()?.sessionGeneration !== beforeReopen.sessionGeneration,
        'explicitly reopening the same document creates a new settings generation');
      reopened.confirm();
      await reopened.pending;
      assert.strictEqual(applyCount, 0, 'the old confirmation cannot edit after explicit reopen');

      await selectDifferentCapo();
      const beforeSelection = inspector.getContext?.();
      const changedSelection = await beginApply();
      const next = beforeSelection.model.candidates.find((item: any) => item.supported
        && item.capo !== beforeSelection.model.selectedCapo && item.capo !== beforeSelection.model.sourceCapo);
      assert.ok(next, 'another supported Capo candidate is available');
      const expectedPreview = require('../../capo').planCapoTransform(SOURCE, next.capo);
      assert.ok(expectedPreview.ok, 'the selected supported Capo has a valid Preview transform');
      await dispatch('settingsSelectCapo', { capo: next.capo });
      await waitFor(() => inspector.getContext?.()?.revision !== beforeSelection.revision
          && inspector.getContext?.()?.model?.selectedCapo === next.capo,
        'a valid candidate request advances the revision and changes the selection while confirmation is pending');
      await waitFor(() => preview.effectiveDslProbe.previewInput === expectedPreview.text,
        'the valid candidate updates the Preview while invalidating the pending confirmation');
      changedSelection.confirm();
      await changedSelection.pending;
      assert.strictEqual(applyCount, 0, 'the old confirmation cannot edit after a candidate request');
      assert.strictEqual(inspector.getContext?.()?.kind, 'settings', 'the current settings session remains available');

      const beforeInvalidCandidate = inspector.getContext?.();
      const invalidCandidateApply = await beginApply();
      const invalidRevision = inspector.getContext?.()?.revision;
      await dispatch('settingsSelectCapo', { capo: 999 });
      assert.strictEqual(inspector.getContext?.()?.revision, invalidRevision,
        'an unsupported candidate leaves the session revision unchanged');
      assert.strictEqual(inspector.getContext?.()?.model?.selectedCapo, beforeInvalidCandidate.model.selectedCapo,
        'an unsupported candidate leaves the current selection unchanged');
      invalidCandidateApply.confirm(false);
      await invalidCandidateApply.pending;
      assert.strictEqual(applyCount, 0, 'an invalid candidate cannot invalidate Apply or edit the source');

      const invalidSectionApply = await beginApply();
      const beforeInvalidSection = inspector.getContext?.();
      await dispatch('settingsSelectSection', { nextSection: 'unknown' });
      assert.strictEqual(inspector.getContext?.()?.revision, beforeInvalidSection.revision,
        'an invalid section leaves the session revision unchanged');
      assert.strictEqual(inspector.getContext?.()?.section, beforeInvalidSection.section,
        'an invalid section leaves the current section unchanged');
      invalidSectionApply.confirm(false);
      await invalidSectionApply.pending;
      assert.strictEqual(applyCount, 0, 'an invalid section cannot invalidate Apply or edit the source');

      await selectDifferentCapo();
      const beforeSection = inspector.getContext?.();
      const changedSection = await beginApply();
      await dispatch('settingsSelectSection', { nextSection: 'beginner' });
      await waitFor(() => inspector.getContext?.()?.revision !== beforeSection.revision
          && inspector.getContext?.()?.section === 'beginner',
        'a valid section request changes section and advances revision while confirmation is pending');
      changedSection.confirm();
      await changedSection.pending;
      assert.strictEqual(applyCount, 0, 'the old confirmation cannot edit after a section request');
      assert.strictEqual(doc.getText(), SOURCE, 'all stale confirmations preserve the DSL');
    } finally {
      confirmations.shift()?.();
      await dispatch('settingsCancel');
      windowApi.showWarningMessage = originalWarning;
      workspaceApi.applyEdit = originalApplyEdit;
    }
  });

  test('S135-06 one Capo or Beginner candidate change rebuilds Preview only once', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    const preview = previewCapo();
    await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
    await waitFor(() => preview.previewLifecycleProbe.currentDocumentUri === doc.uri.toString(), 'Preview is open for the test document');
    await vscode.commands.executeCommand('guitardsl.editScoreSettings', doc.uri);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const inspector = require('../../inspector/inspectorView').inspectorViewTestProbe;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const settings = require('../../scoreSettingsInspectorController').scoreSettingsInspectorProbe;
    await waitFor(() => inspector.getContext?.()?.kind === 'settings', 'the Settings session is open');

    const capoContext = inspector.getContext?.();
    const capoCandidate = capoContext.model.candidates.find((item: any) => item.supported && item.capo !== capoContext.model.selectedCapo);
    assert.ok(capoCandidate, 'a different supported Capo candidate is available');
    let generation = preview.previewLifecycleProbe.generation;
    await settings.dispatchMessage!('settingsSelectCapo', { capo: capoCandidate.capo });
    await waitFor(() => preview.previewLifecycleProbe.generation > generation, 'Preview receives the Capo comparison');
    assert.strictEqual(preview.previewLifecycleProbe.generation, generation + 1,
      'one Capo selection causes exactly one Preview HTML generation');

    await settings.dispatchMessage!('settingsSelectSection', { nextSection: 'beginner' });
    await waitFor(() => inspector.getContext?.()?.section === 'beginner', 'Beginner settings are selected');
    const beginnerContext = inspector.getContext?.();
    const beginnerCandidate = beginnerContext.model.candidates.find((item: any) => item.supported);
    assert.ok(beginnerCandidate, 'a supported Beginner candidate is available');
    generation = preview.previewLifecycleProbe.generation;
    await settings.dispatchMessage!('settingsSelectBeginnerCapo', { capo: beginnerCandidate.capo });
    await waitFor(() => preview.previewLifecycleProbe.generation > generation, 'Preview receives the Beginner comparison');
    assert.strictEqual(preview.previewLifecycleProbe.generation, generation + 1,
      'one Beginner selection causes exactly one Preview HTML generation');
    assert.strictEqual(doc.getText(), SOURCE, 'temporary comparison does not edit the DSL');
    await settings.dispatchMessage!('settingsCancel');
  });

  test('S135-12 openInspector ends Settings and restores the effective Preview and PDF DSL', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    const preview = previewCapo();
    await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
    await waitFor(() => preview.effectiveDslProbe.previewInput === SOURCE, 'Preview starts from the source DSL');
    await vscode.commands.executeCommand('guitardsl.editCapo', doc.uri);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const inspector = require('../../inspector/inspectorView').inspectorViewTestProbe;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const settings = require('../../scoreSettingsInspectorController').scoreSettingsInspectorProbe;
    await waitFor(() => inspector.getContext?.()?.kind === 'settings', 'the Settings session is open');
    const context = inspector.getContext?.();
    const candidate = context.model.candidates.find((item: any) => item.supported && item.capo !== context.model.selectedCapo);
    assert.ok(candidate, 'a different supported Capo candidate is available');
    await settings.dispatchMessage!('settingsSelectCapo', { capo: candidate.capo });
    await waitFor(() => preview.effectiveDslProbe.previewInput !== SOURCE, 'Preview shows the temporary Capo comparison');

    await vscode.commands.executeCommand('guitardsl.openInspector');
    await waitFor(() => inspector.getContext?.()?.kind === 'document', 'openInspector replaces Settings with the active document');
    await waitFor(() => preview.effectiveDslProbe.previewInput === SOURCE, 'leaving Settings restores its Preview snapshot');
    assert.strictEqual(inspector.getContext?.()?.kind, 'document', 'the Settings session no longer accepts edits after context replacement');

    const pdfUri = tmpPdf(`settings-context-restore-${Date.now()}.pdf`);
    preview.effectiveDslProbe.pdfInput = undefined;
    await vscode.commands.executeCommand('guitardsl.exportPdf', doc.uri, pdfUri);
    assert.strictEqual(preview.effectiveDslProbe.pdfInput, SOURCE, 'PDF export uses the restored source DSL');
    await fs.promises.unlink(pdfUri.fsPath).catch(() => undefined);
  });

  test('S135-01 later settings command wins when an earlier document resolution completes last', async () => {
    const docA = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    const docB = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: `${SOURCE}\n# B` });
    await showAndFocus(docB);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const documentResolver = require('../../documentResolver') as {
      resolveGuitarDslDocument: (uri?: vscode.Uri, fallback?: vscode.TextDocument) => Promise<vscode.TextDocument | undefined>;
    };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const inspector = require('../../inspector/inspectorView').inspectorViewTestProbe;
    const originalResolve = documentResolver.resolveGuitarDslDocument;
    let releaseA: ((document: vscode.TextDocument) => void) | undefined;
    let signalAStarted!: () => void;
    const aStarted = new Promise<void>(resolve => { signalAStarted = resolve; });
    documentResolver.resolveGuitarDslDocument = (uri?: vscode.Uri) => {
      if (uri?.toString() === docA.uri.toString()) {
        signalAStarted();
        return new Promise(resolve => { releaseA = resolve; });
      }
      if (uri?.toString() === docB.uri.toString()) return Promise.resolve(docB);
      return Promise.resolve(undefined);
    };
    try {
      const openingA = vscode.commands.executeCommand('guitardsl.editCapo', docA.uri);
      await aStarted;
      await vscode.commands.executeCommand('guitardsl.editCapo', docB.uri);
      await waitFor(() => inspector.getContext?.()?.kind === 'settings' && inspector.getContext()?.uri === docB.uri.toString(),
        'the later B request opens its settings context');
      releaseA!(docA);
      await openingA;
      assert.strictEqual(inspector.getContext?.()?.uri, docB.uri.toString(),
        'the stale A request cannot steal the Inspector after B opens');
    } finally {
      documentResolver.resolveGuitarDslDocument = originalResolve;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const settings = require('../../scoreSettingsInspectorController').scoreSettingsInspectorProbe;
      await settings.dispatchMessage?.('settingsCancel');
    }
  });

  test('S135-13 a new progression context supersedes a pending Settings document resolution', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    const editor = await showAndFocus(doc);
    editor.selection = new vscode.Selection(new vscode.Position(4, 2), new vscode.Position(4, 2));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const documentResolver = require('../../documentResolver') as {
      resolveGuitarDslDocument: (uri?: vscode.Uri, fallback?: vscode.TextDocument) => Promise<vscode.TextDocument | undefined>;
    };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const inspector = require('../../inspector/inspectorView').inspectorViewTestProbe;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const progression = require('../../progressionAssistant').progressionAssistantProbe;
    const originalResolve = documentResolver.resolveGuitarDslDocument;
    let releaseSettings: ((document: vscode.TextDocument) => void) | undefined;
    let signalStarted!: () => void;
    const settingsStarted = new Promise<void>(resolve => { signalStarted = resolve; });
    documentResolver.resolveGuitarDslDocument = (uri?: vscode.Uri) => {
      if (uri?.toString() === doc.uri.toString()) {
        signalStarted();
        return new Promise(resolve => { releaseSettings = resolve; });
      }
      return Promise.resolve(undefined);
    };
    try {
      const openingSettings = vscode.commands.executeCommand('guitardsl.editScoreSettings', doc.uri);
      await settingsStarted;

      await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
      const progressionB = progression.getSession();
      assert.ok(progressionB, 'the new explicit command opens a progression session');
      await waitFor(() => inspector.getContext?.()?.kind === 'progression'
          && inspector.getContext?.()?.sessionGeneration === progressionB.sessionGeneration,
        'the Inspector shows the new progression session before the older document resolution completes');

      releaseSettings!(doc);
      await openingSettings;
      assert.strictEqual(progression.getSession(), progressionB,
        'the stale Settings resolver does not invalidate the new progression session');
      assert.strictEqual(inspector.getContext?.()?.kind, 'progression',
        'the stale Settings resolver does not replace the new progression context');
      assert.strictEqual(inspector.getContext?.()?.sessionGeneration, progressionB.sessionGeneration);
    } finally {
      documentResolver.resolveGuitarDslDocument = originalResolve;
      releaseSettings?.(doc);
      await vscode.commands.executeCommand('guitardsl.progression.close');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      await require('../../scoreSettingsInspectorController').scoreSettingsInspectorProbe.dispatchMessage?.('settingsCancel');
    }
  });

  test('S135-14 a new progression session survives a pending Settings Stop acknowledgement', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    const editor = await showAndFocus(doc);
    editor.selection = new vscode.Selection(new vscode.Position(4, 2), new vscode.Position(4, 2));
    await vscode.commands.executeCommand('guitardsl.suggestChordProgression');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const inspector = require('../../inspector/inspectorView').inspectorViewTestProbe;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const progression = require('../../progressionAssistant').progressionAssistantProbe;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const audioLease = require('../../extension').progressionAudioLeaseProbe.coordinator;
    const port = (audioLease as any).port as {
      hasPreview: () => boolean;
      lockPreview: (leaseId: string) => Promise<boolean>;
      startInspector: (message: any) => Promise<boolean>;
      stopInspector: (leaseId: string, requestId: string) => Promise<boolean>;
    };
    assert.strictEqual(audioLease.activeLeaseId, undefined, 'the audio coordinator starts without an active lease');
    const originalPort = {
      hasPreview: port.hasPreview,
      lockPreview: port.lockPreview,
      startInspector: port.startInspector,
      stopInspector: port.stopInspector
    };
    let stopRequest: { leaseId: string; requestId: string } | undefined;
    let signalStopStarted!: () => void;
    const stopStarted = new Promise<void>(resolve => { signalStopStarted = resolve; });
    let openingSettings: Thenable<unknown> | undefined;
    port.hasPreview = () => false;
    port.lockPreview = async () => true;
    port.startInspector = async message => {
      audioLease.acknowledge({ command: 'progressionAudioStarted', leaseId: message.leaseId, requestId: message.requestId });
      return true;
    };
    port.stopInspector = async (leaseId, requestId) => {
      stopRequest = { leaseId, requestId };
      signalStopStarted();
      return true;
    };
    try {
      const sessionA = progression.getSession();
      const started = await audioLease.start({
        requestId: `s135-14-${Date.now()}`,
        generation: inspector.getContext?.().kind === 'progression' ? inspector.getContext().generation : 0,
        sessionUri: sessionA.uri,
        sessionVersion: sessionA.version,
        sessionGeneration: sessionA.sessionGeneration,
        candidateId: sessionA.activeCandidateId,
        side: 'B',
        mode: 'melody',
        speed: 100
      }, {} as any, () => true, 'unavailable');
      assert.strictEqual(started, true, 'the test coordinator holds an active acknowledged lease');
      const leaseId = audioLease.activeLeaseId as string;
      openingSettings = vscode.commands.executeCommand('guitardsl.editScoreSettings', doc.uri);
      await stopStarted;
      assert.strictEqual(audioLease.activeLeaseId, leaseId, 'Settings is waiting while the audio lease remains active');

      await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
      const progressionB = progression.getSession();
      assert.ok(progressionB && progressionB.sessionGeneration !== sessionA.sessionGeneration,
        'the new command installs a distinct progression session while Stop is pending');
      assert.strictEqual(inspector.getContext?.()?.kind, 'progression');
      assert.strictEqual(inspector.getContext?.()?.sessionGeneration, progressionB.sessionGeneration);

      audioLease.acknowledge({
        command: 'progressionAudioStopped',
        leaseId: stopRequest!.leaseId,
        requestId: stopRequest!.requestId
      });
      await openingSettings;
      assert.strictEqual(progression.getSession(), progressionB,
        'the older Settings request does not invalidate the new session after Stop acknowledgement');
      assert.strictEqual(inspector.getContext?.()?.kind, 'progression',
        'the older Settings request does not replace the new Inspector context after Stop acknowledgement');
      assert.strictEqual(audioLease.activeLeaseId, undefined, 'the acknowledged Stop releases the old lease');
    } finally {
      if (audioLease.activeLeaseId && stopRequest) {
        audioLease.acknowledge({ command: 'progressionAudioStopped', ...stopRequest });
      }
      if (openingSettings) await openingSettings;
      port.hasPreview = originalPort.hasPreview;
      port.lockPreview = originalPort.lockPreview;
      port.startInspector = originalPort.startInspector;
      port.stopInspector = originalPort.stopInspector;
      await vscode.commands.executeCommand('guitardsl.progression.close');
    }
  });

  test('S135-15 explicit openInspector supersedes a pending Settings resolution in the same document context', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    await vscode.commands.executeCommand('guitardsl.openInspector');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const inspector = require('../../inspector/inspectorView').inspectorViewTestProbe;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const settings = require('../../scoreSettingsInspectorController').scoreSettingsInspectorProbe;
    await waitFor(() => inspector.getContext?.()?.kind === 'document'
      && inspector.getContext?.()?.uri === doc.uri.toString(), 'the active document is the Inspector context');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const documentResolver = require('../../documentResolver') as {
      resolveGuitarDslDocument: (uri?: vscode.Uri, fallback?: vscode.TextDocument) => Promise<vscode.TextDocument | undefined>;
    };
    const originalResolve = documentResolver.resolveGuitarDslDocument;
    let releaseSettings: ((document: vscode.TextDocument) => void) | undefined;
    let signalStarted!: () => void;
    const settingsStarted = new Promise<void>(resolve => { signalStarted = resolve; });
    documentResolver.resolveGuitarDslDocument = (uri?: vscode.Uri) => {
      if (uri?.toString() === doc.uri.toString()) {
        signalStarted();
        return new Promise(resolve => { releaseSettings = resolve; });
      }
      return Promise.resolve(undefined);
    };
    let openingSettings: Thenable<unknown> | undefined;
    try {
      openingSettings = vscode.commands.executeCommand('guitardsl.editScoreSettings', doc.uri);
      await settingsStarted;

      await vscode.commands.executeCommand('guitardsl.openInspector');
      assert.strictEqual(inspector.getContext?.()?.kind, 'document',
        'the repeated public open keeps the existing document context');
      releaseSettings!(doc);
      await openingSettings;

      assert.strictEqual(inspector.getContext?.()?.kind, 'document',
        'the older Settings request cannot replace a later same-context open');
      assert.strictEqual(inspector.getContext?.()?.uri, doc.uri.toString());
      assert.strictEqual(settings.hasSession?.(), false, 'no hidden Settings session was created');
    } finally {
      documentResolver.resolveGuitarDslDocument = originalResolve;
      releaseSettings?.(doc);
      if (openingSettings) await openingSettings;
      if (settings.hasSession?.()) await settings.dispatchMessage?.('settingsCancel');
    }
  });

  test('S135-16 a validated Settings Close supersedes a pending newer Settings request', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    await vscode.commands.executeCommand('guitardsl.editCapo', doc.uri);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const inspector = require('../../inspector/inspectorView').inspectorViewTestProbe;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const settings = require('../../scoreSettingsInspectorController').scoreSettingsInspectorProbe;
    await waitFor(() => inspector.getContext?.()?.kind === 'settings', 'the first Settings session is open');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const documentResolver = require('../../documentResolver') as {
      resolveGuitarDslDocument: (uri?: vscode.Uri, fallback?: vscode.TextDocument) => Promise<vscode.TextDocument | undefined>;
    };
    const originalResolve = documentResolver.resolveGuitarDslDocument;
    let releaseSettings: ((document: vscode.TextDocument) => void) | undefined;
    let signalStarted!: () => void;
    const settingsStarted = new Promise<void>(resolve => { signalStarted = resolve; });
    documentResolver.resolveGuitarDslDocument = (uri?: vscode.Uri) => {
      if (uri?.toString() === doc.uri.toString()) {
        signalStarted();
        return new Promise(resolve => { releaseSettings = resolve; });
      }
      return Promise.resolve(undefined);
    };
    let openingSettings: Thenable<unknown> | undefined;
    try {
      openingSettings = vscode.commands.executeCommand('guitardsl.editScoreSettings', doc.uri);
      await settingsStarted;
      await settings.dispatchMessage?.('settingsCancel');
      assert.strictEqual(inspector.getContext?.()?.kind, 'document', 'the validated Close restores the document context');

      releaseSettings!(doc);
      await openingSettings;
      assert.strictEqual(inspector.getContext?.()?.kind, 'document',
        'a request started before Close cannot reopen the dismissed Settings context');
      assert.strictEqual(settings.hasSession?.(), false, 'Close leaves no Settings session behind');
    } finally {
      documentResolver.resolveGuitarDslDocument = originalResolve;
      releaseSettings?.(doc);
      if (openingSettings) await openingSettings;
      if (settings.hasSession?.()) await settings.dispatchMessage?.('settingsCancel');
    }
  });

  test('S135-17 unknown and invalid progression messages do not supersede pending Settings', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    const editor = await showAndFocus(doc);
    editor.selection = new vscode.Selection(new vscode.Position(4, 2), new vscode.Position(4, 2));
    await vscode.commands.executeCommand('guitardsl.suggestChordProgression');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const inspector = require('../../inspector/inspectorView').inspectorViewTestProbe;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const progression = require('../../progressionAssistant').progressionAssistantProbe;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const settings = require('../../scoreSettingsInspectorController').scoreSettingsInspectorProbe;
    assert.strictEqual(inspector.getContext?.()?.kind, 'progression');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const documentResolver = require('../../documentResolver') as {
      resolveGuitarDslDocument: (uri?: vscode.Uri, fallback?: vscode.TextDocument) => Promise<vscode.TextDocument | undefined>;
    };
    const originalResolve = documentResolver.resolveGuitarDslDocument;
    let releaseSettings: ((document: vscode.TextDocument) => void) | undefined;
    let signalStarted!: () => void;
    const settingsStarted = new Promise<void>(resolve => { signalStarted = resolve; });
    documentResolver.resolveGuitarDslDocument = (uri?: vscode.Uri) => {
      if (uri?.toString() === doc.uri.toString()) {
        signalStarted();
        return new Promise(resolve => { releaseSettings = resolve; });
      }
      return Promise.resolve(undefined);
    };
    let openingSettings: Thenable<unknown> | undefined;
    try {
      openingSettings = vscode.commands.executeCommand('guitardsl.editScoreSettings', doc.uri);
      await settingsStarted;

      await progression.dispatchInspectorMessage?.({ command: 'progressionBogus' });
      await progression.dispatchInspectorMessage?.({ command: 'progressionSetBars', bars: 999 });
      releaseSettings!(doc);
      await openingSettings;

      assert.strictEqual(inspector.getContext?.()?.kind, 'settings',
        'rejected progression messages leave the valid pending Settings request current');
      assert.strictEqual(inspector.getContext?.()?.uri, doc.uri.toString());
      assert.strictEqual(settings.hasSession?.(), true, 'the valid Settings request opens its host session');
    } finally {
      documentResolver.resolveGuitarDslDocument = originalResolve;
      releaseSettings?.(doc);
      if (openingSettings) await openingSettings;
      if (settings.hasSession?.()) await settings.dispatchMessage?.('settingsCancel');
      await vscode.commands.executeCommand('guitardsl.progression.close');
    }
  });

  test('TR-E2E-04 Preview / PDF re-resolve from the transposed source, including Beginner Mode (T045)', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc, vscode.ViewColumn.One);
    probe().previewInput = undefined;
    await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
    await waitFor(() => probe().previewInput === doc.getText(), 'preview renders the source');

    const beginner = previewBeginner().getPreviewBeginnerController();
    assert.ok(beginner.enable(doc));
    const result = await scoreSettings().applyTransposeTransform(doc.uri, { semitones: -2, capoMode: { kind: 'keep' } });
    assert.ok(result.ok && result.changed);
    const transposed = doc.getText();
    assert.ok(transposed.includes('key: Bb') && transposed.includes('| Bb | Eb |'));
    const expected = beginnerMode().planBeginnerTransform(transposed, { barrePolicy: 'forbid' });
    const expectedInput = expected.ok ? expected.text : transposed;
    await waitFor(() => probe().previewInput === expectedInput, 'Beginner Mode re-resolves from the new source');
    const target = tmpPdf('after');
    await vscode.commands.executeCommand('guitardsl.exportPdf', doc.uri, target);
    assert.strictEqual(probe().pdfInput, probe().previewInput, 'PDF uses the same effective DSL');
    assert.ok(!probe().pdfInput.includes('key: C\n'), 'no stale pre-transform source');
    fs.unlinkSync(target.fsPath);
    beginner.disable(doc);
    await waitFor(() => probe().previewInput === transposed, 'without Beginner Mode the preview shows the source');
  });

  test('TR-E2E-06 the outline lists score events as Event symbols next to the existing symbols (T047)', async () => {
    const content = ['title: Outline', 'time: 6/8', '@tempo: 132', '| C |', '[Verse]', '@key: D  # modulate', '@mark: B', '| D |', '@time: 7/8(2+2+3)', '| D |', ''].join('\n');
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content });
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', doc.uri);
    assert.ok(symbols);
    const flat = (list: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] => list.flatMap(s => [s, ...flat(s.children)]);
    const events = flat(symbols).filter(s => s.kind === vscode.SymbolKind.Event).map(s => s.name);
    assert.deepStrictEqual(events, ['@tempo: 132', '@key: D', '@mark: B', '@time: 7/8(2+2+3)']);
    const verse = symbols.find(s => s.name === 'Verse');
    assert.ok(verse && verse.kind === vscode.SymbolKind.Namespace);
    assert.deepStrictEqual(verse.children.filter(c => c.kind === vscode.SymbolKind.Event).map(c => c.name), ['@key: D', '@mark: B', '@time: 7/8(2+2+3)']);
    const metadata = symbols.find(s => s.name === 'Metadata');
    assert.ok(metadata && metadata.children.some(c => c.name === 'time' && c.detail === '6/8'));
  });

  test('TR-E2E-05 the advanced notation sample exports to PDF (T048)', async () => {
    const sample = nodePath.join(__dirname, '../../../samples/sample_advanced_notation.guitardsl');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(sample));
    await showAndFocus(doc);
    const target = tmpPdf('advanced');
    await vscode.commands.executeCommand('guitardsl.exportPdf', doc.uri, target);
    assert.ok(fs.existsSync(target.fsPath) && fs.statSync(target.fsPath).size > 0, 'PDF written');
    assert.strictEqual(probe().pdfInput, doc.getText());
    fs.unlinkSync(target.fsPath);
    const diagnostics = vscode.languages.getDiagnostics(doc.uri).filter(d => d.severity === vscode.DiagnosticSeverity.Error);
    assert.deepStrictEqual(diagnostics, []);
  });
});

suite('AI integration: language model tools (Issue #80)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const aiTools = () => require('../../ai/tools');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const capoModule = () => require('../../capo');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const compiler = () => require('../../compiler');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const scoreSettings = () => require('../../scoreSettingsEditor');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('os');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodePath = require('path');

  const TOOL_NAMES = [
    'guitardsl_validate_dsl',
    'guitardsl_analyze_playability',
    'guitardsl_apply_capo',
    'guitardsl_apply_beginner_mode',
    'guitardsl_apply_transpose',
    'guitardsl_analyze_accompaniment',
    'guitardsl_apply_accompaniment'
  ];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const strumming = () => require('../../strummingCodeLens');
  // The deterministic capo fixture of the Capo / playability suite.
  const CAPO_SOURCE = ['title: Capo Test', 'key: B', '', '[Intro]', '| B | E | F#m7 | E/G# |', ''].join('\n');
  const CAPO_AT_2 = ['title: Capo Test', 'capo: 2', 'key: B', '', '[Intro]', '| A | D | Em7 | D/F# |', ''].join('\n');
  const BEGINNER_SOURCE = ['title: Beginner Test', 'key: C', '', '[Intro]', '| F | C | G | Am |', ''].join('\n');
  const INVALID_SOURCE = 'title: X\n| C |\nmel: C4\n';

  const tmpDir: string = fs.mkdtempSync(nodePath.join(os.tmpdir(), `guitardsl-e2e-ai-${process.pid}-`));
  const never = new vscode.CancellationTokenSource().token;
  const parse = (r: vscode.LanguageModelToolResult) => {
    assert.strictEqual(r.content.length, 1, 'one text part');
    return JSON.parse((r.content[0] as vscode.LanguageModelTextPart).value);
  };
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(check: () => boolean, message: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
      if (check()) return;
      await sleep(20);
    }
    assert.fail(message);
  }
  function writeFixture(name: string, content: string): string {
    const file = nodePath.join(tmpDir, name);
    fs.writeFileSync(file, content, 'utf8');
    return file;
  }
  async function openUntitled(content: string, show = true): Promise<vscode.TextDocument> {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content });
    if (show) await showAndFocus(doc, vscode.ViewColumn.One);
    return doc;
  }
  function makeTools(overrides: Record<string, unknown> = {}) {
    const guard = new (aiTools().MutationGuard)();
    const tools = aiTools().createGuitarDslAiTools({
      locale: 'en',
      getLastDoc: () => undefined,
      applyCapo: scoreSettings().applyCapoTransform,
      applyBeginner: scoreSettings().applyBeginnerTransform,
      applyTranspose: scoreSettings().applyTransposeTransform,
      applyAccompaniment: strumming().applyAccompanimentTransform,
      guard,
      ...overrides
    });
    return { tools, guard };
  }
  const u = (doc: vscode.TextDocument) => doc.uri.toString();
  /** Invokes without prepareInvocation (no confirmation). */
  async function invokeOnly(tool: vscode.LanguageModelTool<object>, input: object, token: vscode.CancellationToken = never) {
    return parse((await tool.invoke({ input, toolInvocationToken: undefined }, token)) as vscode.LanguageModelToolResult);
  }
  /** Like VS Code: prepareInvocation (confirmation) first, then invoke. */
  async function call(tool: vscode.LanguageModelTool<object>, input: object, token: vscode.CancellationToken = never) {
    await tool.prepareInvocation?.({ input }, never);
    return invokeOnly(tool, input, token);
  }
  const invokeRegistered = async (name: string, input: object) =>
    parse(await vscode.lm.invokeTool(name, { input, toolInvocationToken: undefined }, never));
  /** Removes the tool-only fields so a result can be compared with the apply helper's result. */
  const summaryOf = (result: Record<string, unknown>) => {
    const { schemaVersion, operation, document, postValidationPassed, postErrorCount, ...rest } = result;
    return rest;
  };

  suiteSetup(async () => {
    const ext = vscode.extensions.all.find(e => e.packageJSON?.name === 'vscode-guitar-dsl');
    if (ext && !ext.isActive) await ext.activate();
    // Editors of earlier suites (e.g. the advanced notation sample) must not be the active editor here.
    await closeAllEditors();
  });
  suiteTeardown(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  test('T012/T028 activation without any model: commands, language and the seven tools are registered', async () => {
    const ext = vscode.extensions.all.find(e => e.packageJSON?.name === 'vscode-guitar-dsl');
    assert.ok(ext?.isActive);
    const commands = await vscode.commands.getCommands(true);
    for (const c of ['guitardsl.showPreview', 'guitardsl.editCapo', 'guitardsl.openHelp', 'guitardsl.transcribeYouTube']) assert.ok(commands.includes(c), c);
    assert.ok((await vscode.languages.getLanguages()).includes('guitardsl'));
    const registered = vscode.lm.tools.map(t => t.name).filter(n => n.startsWith('guitardsl_'));
    assert.deepStrictEqual([...registered].sort(), [...TOOL_NAMES].sort());
    const doc = await openUntitled(CAPO_SOURCE);
    const diagnostics = vscode.languages.getDiagnostics(doc.uri);
    assert.strictEqual(diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length, 0, 'normal language support works');
  });

  test('T005 validate via vscode.lm.invokeTool: valid fixture, invalid fixture with 1-based location', async () => {
    const valid = await invokeRegistered('guitardsl_validate_dsl', { path: writeFixture('valid.guitardsl', CAPO_SOURCE) });
    assert.strictEqual(valid.schemaVersion, 1);
    assert.strictEqual(valid.ok, true);
    assert.strictEqual(valid.valid, true);
    assert.strictEqual(valid.errorCount, 0);

    const invalidPath = writeFixture('invalid.guitardsl', INVALID_SOURCE);
    const invalid = await invokeRegistered('guitardsl_validate_dsl', { path: invalidPath });
    assert.strictEqual(invalid.ok, true, 'parser errors are data, not a tool failure');
    assert.strictEqual(invalid.valid, false);
    assert.strictEqual(invalid.errorCount, 1);
    assert.strictEqual(invalid.document.path, invalidPath);
    assert.deepStrictEqual(invalid.diagnostics, [{ severity: 'error', code: 'upperCaseNoteName', args: { token: 'C4' }, line: 3, startColumn: 6, endColumn: 8 }]);
    assert.strictEqual(fs.readFileSync(invalidPath, 'utf8'), INVALID_SOURCE, 'no repair');

    // path omitted: the active untitled GuitarDSL document.
    const doc = await openUntitled(INVALID_SOURCE);
    const active = await invokeRegistered('guitardsl_validate_dsl', {});
    assert.strictEqual(active.document.uri, doc.uri.toString());
    assert.strictEqual(active.valid, false);
  });

  test('T006 playability via vscode.lm.invokeTool equals inferCapoForDsl exactly', async () => {
    const result = await invokeRegistered('guitardsl_analyze_playability', { path: writeFixture('capo.guitardsl', CAPO_SOURCE) });
    const expected = capoModule().inferCapoForDsl(CAPO_SOURCE);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.sourceCapo, expected.sourceCapo);
    assert.strictEqual(result.recommendedCapo, expected.recommendedCapo ?? null);
    assert.strictEqual(result.candidates.length, 13);
    assert.deepStrictEqual(result.candidates, expected.candidates.map((c: any) => ({
      capo: c.capo, supported: c.supported, score: c.playability?.score ?? null, level: c.playability?.level ?? null, reason: c.reason ?? null
    })));
    const current = expected.candidates[expected.sourceCapo].playability;
    assert.deepStrictEqual(result.currentPlayability, { score: current.score, level: current.level, unresolvedChords: current.unresolvedChords });
  });

  test('R010 read-only tools and prepareInvocation do not change the document; mutation confirmations come from the input only', async () => {
    const doc = await openUntitled(CAPO_SOURCE);
    const version = doc.version;
    const { tools } = makeTools();
    await call(tools.guitardsl_validate_dsl, {});
    await call(tools.guitardsl_analyze_playability, {});
    const prepared = await tools.guitardsl_apply_capo.prepareInvocation({ input: { uri: u(doc), targetCapo: 2 } }, never);
    assert.ok(prepared.confirmationMessages, 'mutation tools ask for confirmation');
    assert.ok(String(prepared.confirmationMessages.message).includes(doc.uri.toString(true)), String(prepared.confirmationMessages.message));
    assert.ok(String(prepared.confirmationMessages.message).includes('2'));
    const other = await openUntitled('| G |\n');
    const again = await tools.guitardsl_apply_capo.prepareInvocation({ input: { uri: u(doc), targetCapo: 2 } }, never);
    assert.deepStrictEqual(again, prepared, 'independent of the active editor and of earlier calls');
    const preparedPath = await tools.guitardsl_apply_transpose.prepareInvocation({ input: { path: '/x/song.guitardsl', semitones: 2, capoMode: 'keep' } }, never);
    assert.ok(String(preparedPath.confirmationMessages.message).includes(vscode.Uri.file('/x/song.guitardsl').fsPath));
    const noTarget = await tools.guitardsl_apply_capo.prepareInvocation({ input: { targetCapo: 2 } }, never);
    assert.strictEqual(noTarget.confirmationMessages, undefined, 'invalid input (no target) has nothing to confirm');
    assert.strictEqual(doc.version, version);
    assert.strictEqual(doc.getText(), CAPO_SOURCE);
    assert.strictEqual(other.getText(), '| G |\n');
  });

  test('T007 apply capo: one change, expected transform, post-validation; unsupported input makes no edit', async () => {
    const doc = await openUntitled(CAPO_SOURCE);
    const version = doc.version;
    const { tools } = makeTools();
    const result = await call(tools.guitardsl_apply_capo, { uri: u(doc), targetCapo: 2 });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.operation, 'applyCapo');
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.targetCapo, 2);
    assert.strictEqual(result.postValidationPassed, true);
    assert.strictEqual(result.text, undefined, 'the transformed DSL is not returned');
    assert.strictEqual(doc.getText(), CAPO_AT_2);
    assert.strictEqual(doc.version, version + 1, 'exactly one document change');
    await undoIn(doc);
    assert.strictEqual(doc.getText(), CAPO_SOURCE, 'one undo restores the source');

    for (const targetCapo of [13, -1, 2.5]) {
      const bad = await call(tools.guitardsl_apply_capo, { uri: u(doc), targetCapo });
      assert.strictEqual(bad.ok, false);
      assert.strictEqual(bad.code, 'invalidInput');
    }
    for (const input of [{ targetCapo: 2 }, { uri: u(doc), path: '/x/a.guitardsl', targetCapo: 2 }, { uri: 'Untitled-1', targetCapo: 2 }]) {
      assert.strictEqual((await call(tools.guitardsl_apply_capo, input)).code, 'invalidInput', JSON.stringify(input));
    }
    assert.strictEqual(doc.getText(), CAPO_SOURCE, 'no target means no edit (never the active editor)');
    const broken = await openUntitled(INVALID_SOURCE);
    const failed = await call(tools.guitardsl_apply_capo, { uri: u(broken), targetCapo: 2 });
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(failed.code, 'sourceParseError', 'existing failure code');
    assert.strictEqual(broken.getText(), INVALID_SOURCE);
    assert.strictEqual(doc.getText(), CAPO_SOURCE);

    const missing = await call(tools.guitardsl_apply_capo, { targetCapo: 2, path: writeFixture('notes.txt', 'hello') });
    assert.strictEqual(missing.code, 'documentNotFound');
    const unknownUntitled = 'untitled:NoSuchDocument-999';
    assert.strictEqual((await call(tools.guitardsl_apply_capo, { uri: unknownUntitled, targetCapo: 2 })).code, 'documentNotFound');
    assert.ok(!vscode.workspace.textDocuments.some(d => d.uri.toString() === vscode.Uri.parse(unknownUntitled).toString()), 'no untitled document is created');
  });

  test('T008 Beginner Mode matches applyBeginnerTransform for allow and forbid (auto capo); failure leaves the source unchanged', async () => {
    const { tools } = makeTools();
    for (const barrePolicy of ['allow', 'forbid']) {
      const twin = await openUntitled(BEGINNER_SOURCE, false);
      const expected = await scoreSettings().applyBeginnerTransform(twin.uri, { barrePolicy });
      const doc = await openUntitled(BEGINNER_SOURCE);
      const result = await call(tools.guitardsl_apply_beginner_mode, { uri: u(doc), barrePolicy });
      assert.strictEqual(result.ok, true, barrePolicy);
      assert.strictEqual(result.operation, 'applyBeginnerMode');
      const { ok, ...expectedSummary } = expected;
      assert.deepStrictEqual(summaryOf(result), { ok: true, ...expectedSummary });
      assert.strictEqual(doc.getText(), twin.getText());
      assert.strictEqual(result.postValidationPassed, true);
    }
    const explicitTwin = await openUntitled(BEGINNER_SOURCE, false);
    const explicitExpected = await scoreSettings().applyBeginnerTransform(explicitTwin.uri, { barrePolicy: 'allow', targetCapo: 0 });
    const explicitDoc = await openUntitled(BEGINNER_SOURCE);
    await call(tools.guitardsl_apply_beginner_mode, { uri: u(explicitDoc), barrePolicy: 'allow', targetCapo: 0 });
    assert.strictEqual(explicitDoc.getText(), explicitTwin.getText());
    assert.ok(explicitExpected.ok);

    const broken = await openUntitled(INVALID_SOURCE);
    const failed = await call(tools.guitardsl_apply_beginner_mode, { uri: u(broken), barrePolicy: 'allow' });
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(broken.getText(), INVALID_SOURCE);
  });

  test('T009 transpose keep / recommended / explicit match applyTransposeTransform; explicit without capo fails before mutation', async () => {
    const { tools } = makeTools();
    const modes: [object, any][] = [
      [{ semitones: 2, capoMode: 'keep' }, { kind: 'keep' }],
      [{ semitones: -3, capoMode: 'recommended' }, { kind: 'recommended' }],
      [{ semitones: 5, capoMode: 'explicit', capo: 3 }, { kind: 'explicit', capo: 3 }]
    ];
    for (const [input, capoMode] of modes) {
      const twin = await openUntitled(CAPO_SOURCE, false);
      const expected = await scoreSettings().applyTransposeTransform(twin.uri, { semitones: (input as any).semitones, capoMode });
      const doc = await openUntitled(CAPO_SOURCE);
      const result = await call(tools.guitardsl_apply_transpose, { uri: u(doc), ...input });
      assert.strictEqual(result.ok, expected.ok, JSON.stringify(input));
      const { ok, ...expectedSummary } = expected;
      assert.deepStrictEqual(summaryOf(result), { ok: expected.ok, ...expectedSummary });
      assert.strictEqual(doc.getText(), twin.getText());
      assert.strictEqual(result.postValidationPassed, true);
      assert.strictEqual(compiler().parseGuitarDsl(doc.getText()).diagnostics.filter((d: any) => d.severity === 'error').length, 0);
    }
    const doc = await openUntitled(CAPO_SOURCE);
    const version = doc.version;
    for (const input of [{ semitones: 2, capoMode: 'explicit' }, { semitones: 2, capoMode: 'explicit', capo: 13 }, { semitones: 12, capoMode: 'keep' }]) {
      const bad = await call(tools.guitardsl_apply_transpose, { uri: u(doc), ...input });
      assert.strictEqual(bad.code, 'invalidInput', JSON.stringify(input));
    }
    assert.strictEqual(doc.version, version);
  });

  test('T010 concurrent mutation on the same document fails fast with documentBusy; the guard is always released', async () => {
    const doc = await openUntitled(CAPO_SOURCE);
    const key = doc.uri.toString();
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    let applyCalls = 0;
    const { tools, guard } = makeTools({
      applyCapo: async (uri: vscode.Uri, capo: number) => {
        applyCalls++;
        await gate;
        return scoreSettings().applyCapoTransform(uri, capo);
      }
    });
    const first = call(tools.guitardsl_apply_capo, { uri: key, targetCapo: 2 });
    await waitFor(() => guard.isHeld(key), 'the first call should own the guard');
    const second = await call(tools.guitardsl_apply_beginner_mode, { uri: key, barrePolicy: 'allow' });
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.code, 'documentBusy');
    assert.strictEqual(doc.getText(), CAPO_SOURCE, 'the busy call does not edit');
    const readOnly = await call(tools.guitardsl_validate_dsl, {});
    assert.strictEqual(readOnly.ok, true, 'read-only tools still run');
    release();
    assert.strictEqual((await first).ok, true);
    assert.strictEqual(applyCalls, 1);
    assert.strictEqual(guard.isHeld(key), false, 'released after success');

    const failing = makeTools({ applyCapo: async () => ({ ok: false, code: 'untransposableChord' }) });
    assert.strictEqual((await call(failing.tools.guitardsl_apply_capo, { uri: key, targetCapo: 3 })).code, 'untransposableChord');
    assert.strictEqual(failing.guard.isHeld(key), false, 'released after failure');

    const throwing = makeTools({ applyCapo: async () => { throw new Error('boom'); } });
    await assert.rejects(() => call(throwing.tools.guitardsl_apply_capo, { uri: key, targetCapo: 3 }), /boom/);
    assert.strictEqual(throwing.guard.isHeld(key), false, 'released after an exception');
  });

  test('T011 cancellation before mutation makes no edit and leaves no background work', async () => {
    const doc = await openUntitled(CAPO_SOURCE);
    let applyCalls = 0;
    const { tools, guard } = makeTools({ applyCapo: async () => { applyCalls++; return { ok: true, changed: false }; } });
    const source = new vscode.CancellationTokenSource();
    source.cancel();
    assert.strictEqual((await call(tools.guitardsl_apply_capo, { uri: u(doc), targetCapo: 2 }, source.token)).code, 'cancelled');

    // Cancelled after resolution, immediately before the mutation.
    let checks = 0;
    const lateToken = { get isCancellationRequested() { return ++checks > 1; }, onCancellationRequested: source.token.onCancellationRequested } as vscode.CancellationToken;
    assert.strictEqual((await call(tools.guitardsl_apply_capo, { uri: u(doc), targetCapo: 2 }, lateToken)).code, 'cancelled');
    assert.strictEqual(guard.isHeld(doc.uri.toString()), false);
    await sleep(200);
    assert.strictEqual(applyCalls, 0);
    assert.strictEqual(doc.getText(), CAPO_SOURCE);
  });

  test('B-1 the edited document is exactly the one the input names, even if the active editor changes after confirmation', async () => {
    const { tools } = makeTools();
    const docA = await openUntitled(CAPO_SOURCE);
    const input = { uri: u(docA), targetCapo: 2 };
    const prepared = await tools.guitardsl_apply_capo.prepareInvocation({ input }, never);
    assert.ok(String(prepared.confirmationMessages.message).includes(docA.uri.toString(true)));
    const docB = await openUntitled(CAPO_SOURCE);
    assert.strictEqual(vscode.window.activeTextEditor?.document, docB, 'the active editor changed after confirmation');
    const result = await invokeOnly(tools.guitardsl_apply_capo, input);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.document.uri, u(docA));
    assert.strictEqual(docA.getText(), CAPO_AT_2, 'the confirmed document is edited');
    assert.strictEqual(docB.getText(), CAPO_SOURCE, 'the active document is not');

    // prepareInvocation is not required before invoke (VS Code does not guarantee the pairing either way).
    const file = writeFixture('explicit.guitardsl', CAPO_SOURCE);
    const explicit = await invokeOnly(tools.guitardsl_apply_capo, { targetCapo: 2, path: file });
    assert.strictEqual(explicit.ok, true);
    assert.strictEqual((await vscode.workspace.openTextDocument(vscode.Uri.file(file))).getText(), CAPO_AT_2);
    assert.strictEqual(docB.getText(), CAPO_SOURCE);
  });

  test('B-1 read-only result document.uri targets an untitled document through vscode.lm.invokeTool', async () => {
    const doc = await openUntitled(CAPO_SOURCE);
    const validated = await invokeRegistered('guitardsl_validate_dsl', {});
    assert.strictEqual(validated.document.uri, u(doc));
    const outcome = await Promise.race([
      invokeRegistered('guitardsl_apply_capo', { uri: validated.document.uri, targetCapo: 2 }),
      sleep(5000).then(() => 'timeout')
    ]);
    assert.notStrictEqual(outcome, 'timeout', 'invokeTool should not wait for interactive confirmation outside a chat request');
    const result = outcome as any;
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(doc.getText(), CAPO_AT_2);
  });

  const SONG = ['title: Song', '', '[Verse]', '| C | 4.d 4.d 4.d 4.d | G | 4.d 4.d 4.d 4.d |', '[Chorus]', '| F | 4.d 4.d 4.d 4.d | C | 4.d 4.d 4.d 4.d |]', ''].join('\n');
  const intentPlan = (sectionIndex: number, patch: object = {}) => ({
    sectionIndex, mode: 'intent', style: 'strum', subdivision: 'auto', energy: 'medium', density: 'medium', syncopation: 'none', emphasis: 'none', operation: 'replace', ...patch
  });

  test('T027A analyze accompaniment through vscode.lm.invokeTool: structure, then one family', async () => {
    const file = writeFixture('accompaniment.guitardsl', SONG);
    const structure = await invokeRegistered('guitardsl_analyze_accompaniment', { path: file });
    assert.strictEqual(structure.schemaVersion, 1);
    assert.strictEqual(structure.ok, true);
    assert.strictEqual(structure.document.path, file);
    assert.deepStrictEqual(structure.sections.map((s: any) => [s.sectionIndex, s.name]), [[0, 'Verse'], [1, 'Chorus']]);
    assert.ok(structure.sections[0].availableFamilies.includes('eighth'));
    assert.strictEqual(structure.sections[0].availablePresets, undefined);
    const family = await invokeRegistered('guitardsl_analyze_accompaniment', { path: file, sectionIndex: 1, family: 'shuffle' });
    assert.deepStrictEqual(family.selectedSection.availablePresets.map((p: any) => p.id), ['blues_4_4_shuffle_basic', 'bluesrock_4_4_shuffle_backbeat', 'blues_4_4_shuffle_all_down']);
    assert.strictEqual((await invokeRegistered('guitardsl_analyze_accompaniment', { path: file, family: 'shuffle' })).code, 'invalidInput');
    assert.strictEqual((await invokeRegistered('guitardsl_analyze_accompaniment', { path: file, sectionIndex: 7 })).code, 'sectionNotFound');
  });

  test('T031/T032 apply accompaniment: several sections in one WorkspaceEdit, one undo, compact result with post-validation', async () => {
    const doc = await openUntitled(SONG);
    const version = doc.version;
    const { tools } = makeTools();
    const result = await call(tools.guitardsl_apply_accompaniment, {
      uri: u(doc),
      plans: [intentPlan(0, { energy: 'low', density: 'sparse', style: 'sustain' }), intentPlan(1, { energy: 'high', density: 'dense', emphasis: 'backbeat' })]
    });
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(result.operation, 'applyAccompaniment');
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(result.appliedSections.map((s: any) => s.selectedPresetId), ['sustain_4_4_whole', 'rock_4_4_eighth_backbeat']);
    assert.strictEqual(result.postValidationPassed, true);
    assert.strictEqual(result.postErrorCount, 0);
    assert.strictEqual(result.text, undefined, 'the DSL is not returned');
    assert.strictEqual(doc.version, version + 1, 'one document change');
    assert.ok(doc.getText().includes('| C | 1.d | G | 1.d |'));
    assert.ok(doc.getText().includes('| F | 8.d 8.u 8.d.a 8.u 8.d 8.u 8.d.a 8.u |'));
    await undoIn(doc);
    assert.strictEqual(doc.getText(), SONG, 'one undo restores every section');
  });

  const NEW_SONG_DRAFT = ['title: New Song', 'time: 4/4', '', '[Verse]', '| C | G |', 'mel: | c4/2 d4/2 | e4/1 |', 'lyr: la la la', '', '[Chorus]', '| F | C |', 'mel: | f4/2 e4/2 | c4/1 |', 'lyr: la la la', ''].join('\n');
  const newSongPlans = [
    intentPlan(0, { energy: 'low', density: 'sparse', arrangementGroup: 'verse' }),
    intentPlan(1, { energy: 'high', density: 'dense', emphasis: 'backbeat', arrangementGroup: 'chorus' })
  ];
  const strokes = /\b\d+\.[du]\b/;

  // Tool mechanics only: this test starts after the new target already exists (an active untitled document).
  // It does not prove Agent target selection; the model's new-target policy is covered by the AI asset gate.
  test('#104 new score mechanics (target already established): structural draft -> validate -> analyze -> one apply -> validate; one undo restores the draft', async () => {
    const DRAFT = NEW_SONG_DRAFT;
    const doc = await openUntitled(DRAFT);
    assert.ok(!strokes.test(doc.getText()), 'the draft has no explicit accompaniment rhythm');

    const first = await invokeRegistered('guitardsl_validate_dsl', {});
    assert.strictEqual(first.document.uri, u(doc));
    assert.strictEqual(first.valid, true, JSON.stringify(first));
    assert.strictEqual(first.errorCount, 0);
    assert.strictEqual(first.warningCount, 0);

    const analysis = await invokeRegistered('guitardsl_analyze_accompaniment', {});
    assert.strictEqual(analysis.ok, true, JSON.stringify(analysis));
    assert.strictEqual(analysis.document.uri, u(doc));
    assert.deepStrictEqual(analysis.sections.map((s: any) => [s.sectionIndex, s.name]), [[0, 'Verse'], [1, 'Chorus']]);

    const version = doc.version;
    const outcome = await Promise.race([
      invokeRegistered('guitardsl_apply_accompaniment', {
        uri: first.document.uri,
        plans: newSongPlans
      }),
      sleep(5000).then(() => 'timeout')
    ]);
    assert.notStrictEqual(outcome, 'timeout');
    const applied = outcome as any;
    assert.strictEqual(applied.ok, true, JSON.stringify(applied));
    assert.deepStrictEqual(applied.appliedSections.map((s: any) => s.selectedPresetId), ['strum_4_4_quarter_basic', 'rock_4_4_eighth_backbeat']);
    assert.strictEqual(applied.postValidationPassed, true);
    assert.strictEqual(doc.version, version + 1, 'one document change');
    assert.ok(strokes.test(doc.getText()), 'engine-generated rhythm appears only after apply');
    assert.ok(doc.getText().includes('| F 8.d 8.u 8.d.a 8.u 8.d 8.u 8.d.a 8.u |'));
    assert.ok(doc.getText().includes('mel: | c4/2 d4/2 | e4/1 |') && doc.getText().includes('lyr: la la la'), 'melody and lyrics are kept');

    const last = await invokeRegistered('guitardsl_validate_dsl', {});
    assert.strictEqual(last.errorCount, 0, JSON.stringify(last));

    await undoIn(doc);
    assert.strictEqual(doc.getText(), DRAFT, 'one undo restores the exact structural draft');
  });

  // Mechanical target-pinning regression (not a substitute for the Agent policy): with an existing score A active,
  // every new-score step on a distinct new document B by explicit path edits only B.
  test('#104 new-target pinning: validate/analyze/apply/validate by path edit only the new document; the open existing score is byte-for-byte unchanged', async () => {
    const existingText = SONG;
    const existingPath = writeFixture('existing-song.guitardsl', existingText);
    const existing = await vscode.workspace.openTextDocument(vscode.Uri.file(existingPath));
    await showAndFocus(existing, vscode.ViewColumn.One);
    const newPath = writeFixture('new-song.guitardsl', NEW_SONG_DRAFT);
    assert.notStrictEqual(newPath, existingPath);
    assert.strictEqual(vscode.window.activeTextEditor?.document, existing, 'the existing score is the active editor throughout');

    const first = await invokeRegistered('guitardsl_validate_dsl', { path: newPath });
    assert.deepStrictEqual([first.document.path, first.errorCount], [newPath, 0], JSON.stringify(first));
    const analysis = await invokeRegistered('guitardsl_analyze_accompaniment', { path: newPath });
    assert.strictEqual(analysis.document.path, newPath);
    assert.deepStrictEqual(analysis.sections.map((s: any) => s.name), ['Verse', 'Chorus']);
    const outcome = await Promise.race([invokeRegistered('guitardsl_apply_accompaniment', { path: newPath, plans: newSongPlans }), sleep(5000).then(() => 'timeout')]);
    assert.notStrictEqual(outcome, 'timeout');
    const applied = outcome as any;
    assert.strictEqual(applied.ok, true, JSON.stringify(applied));
    assert.strictEqual(applied.document.path, newPath);
    const last = await invokeRegistered('guitardsl_validate_dsl', { path: newPath });
    assert.deepStrictEqual([last.document.path, last.errorCount], [newPath, 0]);

    const created = await vscode.workspace.openTextDocument(vscode.Uri.file(newPath));
    assert.ok(strokes.test(created.getText()), 'only the new document received accompaniment');
    assert.strictEqual(existing.getText(), existingText, 'the open existing score is unchanged');
    assert.strictEqual(existing.isDirty, false);
    assert.strictEqual(fs.readFileSync(existingPath, 'utf8'), existingText, 'the existing file on disk is byte-for-byte unchanged');
    assert.strictEqual(vscode.window.activeTextEditor?.document, existing);
  });

  test('T029/T030 accompaniment failures edit nothing; the target is the named document; guard and cancellation hold', async () => {
    const doc = await openUntitled(SONG);
    const { tools } = makeTools();
    const bad = await call(tools.guitardsl_apply_accompaniment, { uri: u(doc), plans: [{ sectionIndex: 0, mode: 'preset', presetId: 'waltz_3_4_eighth_flow' }] });
    assert.deepStrictEqual([bad.ok, bad.code], [false, 'invalidPresetForContext']);
    const noTarget = await call(tools.guitardsl_apply_accompaniment, { plans: [intentPlan(0)] });
    assert.strictEqual(noTarget.code, 'invalidInput', 'never the active editor');
    const partial = await call(tools.guitardsl_apply_accompaniment, { uri: u(doc), plans: [intentPlan(0), { sectionIndex: 1, mode: 'dsl', style: 'strum', pattern: '8.d 8.d 8.u 8.u 8.d 8.u 8.d 8.u' }] });
    assert.strictEqual(partial.code, 'unnaturalStrokeDirection', 'one failing plan fails the whole request');
    assert.strictEqual(doc.getText(), SONG);

    const input = { uri: u(doc), plans: [{ sectionIndex: 0, mode: 'preset', presetId: 'arp_4_4_eighth' }] };
    const prepared = await tools.guitardsl_apply_accompaniment.prepareInvocation({ input }, never);
    assert.ok(String(prepared.confirmationMessages.message).includes(doc.uri.toString(true)));
    const other = await openUntitled(SONG);
    assert.strictEqual(vscode.window.activeTextEditor?.document, other);
    assert.strictEqual((await invokeOnly(tools.guitardsl_apply_accompaniment, input)).ok, true);
    assert.ok(doc.getText().includes('| C | 8 8 8 8 8 8 8 8 |'));
    assert.strictEqual(other.getText(), SONG, 'the active editor is not edited');

    const key = u(other);
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    const slow = makeTools({ applyAccompaniment: async (uri: vscode.Uri, request: object) => { await gate; return strumming().applyAccompanimentTransform(uri, request); } });
    const first = call(slow.tools.guitardsl_apply_accompaniment, { uri: key, plans: [intentPlan(0)] });
    await waitFor(() => slow.guard.isHeld(key), 'the first call should own the guard');
    assert.strictEqual((await call(slow.tools.guitardsl_apply_capo, { uri: key, targetCapo: 2 })).code, 'documentBusy');
    release();
    assert.strictEqual((await first).ok, true);
    assert.strictEqual(slow.guard.isHeld(key), false);

    const source = new vscode.CancellationTokenSource();
    source.cancel();
    const before = other.getText();
    assert.strictEqual((await call(tools.guitardsl_apply_accompaniment, { uri: key, plans: [intentPlan(1, { style: 'arpeggio' })] }, source.token)).code, 'cancelled');
    assert.strictEqual(other.getText(), before);
  });

  test('T027 manual QuickPick: meter categories, usage-group separators, no flat 58-item list', async () => {
    const doc = await openUntitled(SONG);
    const window = vscode.window as unknown as { showQuickPick: unknown; showInformationMessage: unknown };
    const original = { pick: window.showQuickPick, info: window.showInformationMessage };
    const shown: vscode.QuickPickItem[][] = [];
    const messages: string[] = [];
    try {
      window.showQuickPick = async (items: vscode.QuickPickItem[]) => {
        shown.push(items);
        if (shown.length === 1) return items.find(i => i.label.includes('16'));
        return items.find(i => (i as any).preset?.id === 'jpop_4_4_sixteenth_bright_drive');
      };
      window.showInformationMessage = async (message: string) => {
        messages.push(message);
        return undefined;
      };
      await strumming().promptAndApplyStrummingPattern(doc, 1, 'en');
    } finally {
      window.showQuickPick = original.pick;
      window.showInformationMessage = original.info;
    }
    assert.strictEqual(shown.length, 2);
    const categories = shown[0].map(i => i.label);
    assert.ok(categories.every(l => l.startsWith('4/4') || l.includes('Close to the current')), categories.join(', '));
    assert.ok(categories.length <= 10);
    const patterns = shown[1];
    assert.ok(patterns.some(i => i.kind === vscode.QuickPickItemKind.Separator && i.label === 'Pop / J-POP'));
    assert.ok(patterns.filter(i => (i as any).preset).every(i => (i as any).preset.family === 'sixteenth'));
    assert.ok(patterns.length < 58);
    assert.ok(doc.getText().includes('| F | 8.d 8.d 16.d 16.u 16.d 16.u 8.d 8.d 16.d 16.u 16.d 16.u |'));
    assert.ok(doc.getText().includes('| C | 4.d 4.d 4.d 4.d | G | 4.d 4.d 4.d 4.d |'), 'the verse is untouched');
    assert.ok(messages.some(m => m.includes('J-POP 16th Bright Drive')));
  });

  test('R-CL same-name sections: the CodeLens identity targets only its section; a stale identity changes nothing', async () => {
    const source = ['[Chorus]', '| C | 4.d 4.d 4.d 4.d |', '', '[Verse]', '| G | 4.d 4.d 4.d 4.d |', '', '[Chorus]', '| F | 4.d 4.d 4.d 4.d |', ''].join('\n');
    const doc = await openUntitled(source);
    const lenses = new (strumming().StrummingCodeLensProvider)('en').provideCodeLenses(doc) as vscode.CodeLens[];
    const targets = lenses.map(l => l.command?.arguments?.[1]);
    assert.deepStrictEqual(targets, [
      { sectionIndex: 0, sectionName: 'Chorus', labelLine: 0 },
      { sectionIndex: 1, sectionName: 'Verse', labelLine: 3 },
      { sectionIndex: 2, sectionName: 'Chorus', labelLine: 6 }
    ]);
    const window = vscode.window as unknown as { showQuickPick: unknown; showInformationMessage: unknown; showWarningMessage: unknown };
    const original = { pick: window.showQuickPick, info: window.showInformationMessage, warn: window.showWarningMessage };
    const warnings: string[] = [];
    let picks = 0;
    try {
      window.showQuickPick = async (items: vscode.QuickPickItem[]) => {
        picks++;
        return picks % 2 === 1 ? items.find(i => i.label.includes('8-beat')) : items.find(i => (i as any).preset?.id === 'rock_4_4_eighth_full');
      };
      window.showInformationMessage = async () => undefined;
      window.showWarningMessage = async (message: string) => {
        warnings.push(message);
        return undefined;
      };
      await vscode.commands.executeCommand('guitardsl.applyStrummingPattern', doc.uri, targets[2]);
      const lines = doc.getText().split('\n');
      assert.strictEqual(lines[1], '| C | 4.d 4.d 4.d 4.d |', 'the first Chorus is untouched');
      assert.strictEqual(lines[7], '| F | 8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u |', 'the second Chorus changes');
      const after = doc.getText();
      // Stale identities: a moved label line, and an index now pointing at another section. No fallback to the first Chorus.
      for (const stale of [{ sectionIndex: 2, sectionName: 'Chorus', labelLine: 5 }, { sectionIndex: 1, sectionName: 'Chorus', labelLine: 6 }]) {
        await vscode.commands.executeCommand('guitardsl.applyStrummingPattern', doc.uri, stale);
        assert.strictEqual(doc.getText(), after, JSON.stringify(stale));
      }
      assert.deepStrictEqual(warnings, ['The section has changed. Refresh the CodeLens and try again.', 'The section has changed. Refresh the CodeLens and try again.']);
      assert.strictEqual(picks, 2, 'a stale identity opens no picker');
    } finally {
      window.showQuickPick = original.pick;
      window.showInformationMessage = original.info;
      window.showWarningMessage = original.warn;
    }
  });

  test('R012 repeated calls recompute from the latest source', async () => {
    const doc = await openUntitled('| B |\n');
    const { tools } = makeTools();
    assert.strictEqual((await call(tools.guitardsl_apply_capo, { uri: u(doc), targetCapo: 2 })).changed, true);
    assert.strictEqual(doc.getText(), 'capo: 2\n| A |\n');
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, doc.positionAt(doc.getText().length), '| E |\n');
    assert.ok(await vscode.workspace.applyEdit(edit));
    const again = await call(tools.guitardsl_apply_capo, { uri: u(doc), targetCapo: 2 });
    assert.strictEqual(again.ok, true);
    assert.strictEqual(again.changed, false, 'same capo again is a no-op decided by the existing helper');
    const latest = doc.getText();
    assert.strictEqual((await call(tools.guitardsl_apply_capo, { uri: u(doc), targetCapo: 0 })).changed, true);
    assert.strictEqual(doc.getText(), capoModule().planCapoTransform(latest, 0).text, 'the edit made in between is transformed too');
  });

  test('R013 code action extraction targets an untitled URI and one Undo restores every edit', async () => {
    const source = 'key: C\n| C 4.d 4.d 8.u |\n';
    const doc = await openUntitled(source);
    assert.strictEqual(doc.uri.scheme, 'untitled');
    const start = source.indexOf('4.d');
    const end = source.lastIndexOf('4.d') + '4.d'.length;
    const range = new vscode.Range(doc.positionAt(start), doc.positionAt(end));
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider', doc.uri, range, vscode.CodeActionKind.RefactorExtract.value
    );
    const extract = actions?.find(action => action.command?.command === 'guitardsl.applyMusicCodeAction'
      && (action.command.arguments?.[0] as { kind?: string } | undefined)?.kind === 'extractLet');
    assert.ok(extract?.command, 'the provider offers the extract action for the selected tokens');
    const workspaceApi = vscode.workspace as unknown as { applyEdit: unknown };
    const originalApplyEdit = workspaceApi.applyEdit;
    let applyCount = 0;
    try {
      workspaceApi.applyEdit = async (edit: vscode.WorkspaceEdit) => {
        applyCount++;
        return (originalApplyEdit as (this: typeof vscode.workspace, edit: vscode.WorkspaceEdit) => Promise<boolean>).call(vscode.workspace, edit);
      };
      await vscode.commands.executeCommand(extract.command!.command, ...(extract.command!.arguments ?? []));
    } finally {
      workspaceApi.applyEdit = originalApplyEdit;
    }
    assert.strictEqual(applyCount, 1, 'one Code Action uses one WorkspaceEdit application');
    assert.match(doc.getText(), /let fragment1 = 4\.d 4\.d/);
    assert.match(doc.getText(), /\$fragment1/);
    await undoIn(doc);
    assert.strictEqual(doc.getText(), source, 'one undo reverses the definition insertion and token replacement');
  });

  test('R019 transposing an explicit octave rejects changed unselected inherited pitches without applying an edit', async () => {
    const source = '| C |\nmel: | b4/4 d e f |\n';
    const doc = await openUntitled(source);
    const start = source.indexOf('b4');
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider', doc.uri,
      new vscode.Range(doc.positionAt(start), doc.positionAt(start + 2)), vscode.CodeActionKind.RefactorRewrite.value
    );
    const transpose = actions?.find(action => (action.command?.arguments?.[0] as { kind?: string } | undefined)?.kind === 'transpose');
    assert.ok(transpose?.command, 'a valid transpose action remains available for the selected B4');

    const workspaceApi = vscode.workspace as unknown as { applyEdit: unknown };
    const windowApi = vscode.window as unknown as { showQuickPick: unknown; showWarningMessage: unknown };
    const originalApply = workspaceApi.applyEdit;
    const originalPick = windowApi.showQuickPick;
    const originalWarn = windowApi.showWarningMessage;
    let applyCalls = 0;
    let warnings = 0;
    try {
      windowApi.showQuickPick = async (items: vscode.QuickPickItem[]) =>
        (items as (vscode.QuickPickItem & { semitones: number })[]).find(item => item.semitones === 2);
      workspaceApi.applyEdit = async () => { applyCalls++; return true; };
      windowApi.showWarningMessage = async () => { warnings++; return undefined; };
      await vscode.commands.executeCommand(transpose.command!.command, ...(transpose.command!.arguments ?? []));
    } finally {
      workspaceApi.applyEdit = originalApply;
      windowApi.showQuickPick = originalPick;
      windowApi.showWarningMessage = originalWarn;
    }
    assert.strictEqual(doc.getText(), source, 'the failed semantic validation leaves the source untouched');
    assert.strictEqual(applyCalls, 0, 'no WorkspaceEdit is applied for a transpose that changes unselected pitches');
    assert.strictEqual(warnings, 1, 'the rejected plan reports a user-facing failure');
  });

  test('R014 Code Action Hints expose bounded Quick Fixes and refresh and clear with the document', async () => {
    const source = 'chord C@unused = x32010\n| G 4.d 8.u 4.d 8.u |\n| D 4.d 8.u 4.d 8.u |\n';
    const file = writeFixture('r014-code-action-hints.guitardsl', source);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await showAndFocus(doc);
    const hintDiagnostics = () => vscode.languages.getDiagnostics(doc.uri)
      .filter(diagnostic => String(diagnostic.code).startsWith('guitardsl.'));
    await waitFor(() => {
      const codes = hintDiagnostics().map(diagnostic => String(diagnostic.code));
      return codes.includes('guitardsl.unusedChordDefinition') && codes.includes('guitardsl.repeatedFragmentCandidate');
    }, 'both music-aware Hints should appear for their source locations');
    const diagnostics = hintDiagnostics();
    const unused = diagnostics.find(diagnostic => diagnostic.code === 'guitardsl.unusedChordDefinition')!;
    const repeated = diagnostics.find(diagnostic => diagnostic.code === 'guitardsl.repeatedFragmentCandidate')!;
    assert.deepStrictEqual(unused.tags, [vscode.DiagnosticTag.Unnecessary]);

    const quickFixes = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider', doc.uri, unused.range, vscode.CodeActionKind.QuickFix.value
    );
    assert.ok(quickFixes?.some(action => (action.command?.arguments?.[0] as { kind?: string } | undefined)?.kind === 'removeUnusedChordDefinition'));
    const refactors = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider', doc.uri, repeated.range, vscode.CodeActionKind.RefactorExtract.value
    );
    assert.ok(refactors?.some(action => (action.command?.arguments?.[0] as { kind?: string } | undefined)?.kind === 'extractLet'));

    const updated = source.replace('| G 4.d 8.u 4.d 8.u |', '| C@unused 4.d 8.u 16.d 8.u |');
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(source.length)), updated);
    assert.ok(await vscode.workspace.applyEdit(edit));
    await waitFor(() => hintDiagnostics().length === 0, 'Hints should recompute away when the chord is used and rhythm no longer repeats');
    assert.ok(await doc.save(), 'the saved temporary document can close without a prompt');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await waitFor(() => !vscode.languages.getDiagnostics(doc.uri).some(diagnostic => String(diagnostic.code).startsWith('guitardsl.')),
      'closing the document clears Code Action Hint diagnostics');
  });

  test('R015 cursor Code Actions use extract and inline kinds and support the token cursor', async () => {
    const source = 'let riff = 4.d 4.d\nkey: C\n| C $riff |\n| G 4.d 4.d 8.u |\n';
    const doc = await openUntitled(source);
    const refStart = source.indexOf('$riff');
    const cursor = doc.positionAt(refStart + 2);
    const inlineActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider', doc.uri, new vscode.Range(cursor, cursor), vscode.CodeActionKind.RefactorInline.value
    );
    assert.strictEqual(inlineActions?.length, 1, 'the cursor inside a let reference discovers its inline refactor');
    assert.strictEqual(inlineActions?.[0].kind?.value, vscode.CodeActionKind.RefactorInline.value);
    assert.strictEqual((inlineActions?.[0].command?.arguments?.[0] as { kind?: string } | undefined)?.kind, 'inlineLet');

    const selectedStart = source.indexOf('4.d', source.indexOf('| G'));
    const selectedEnd = source.lastIndexOf('4.d') + '4.d'.length;
    const extractActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider', doc.uri,
      new vscode.Range(doc.positionAt(selectedStart), doc.positionAt(selectedEnd)),
      vscode.CodeActionKind.RefactorExtract.value
    );
    assert.ok(extractActions?.some(action => action.kind?.value === vscode.CodeActionKind.RefactorExtract.value
      && (action.command?.arguments?.[0] as { kind?: string } | undefined)?.kind === 'extractLet'),
    'the selected fragment is offered under refactor.extract when context.only requests it');

    const names = await openUntitled('| C# Cmin/A# |\n');
    const sharp = names.getText().indexOf('C#') + 1;
    const sharpCursor = names.positionAt(sharp);
    const enharmonic = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider', names.uri, new vscode.Range(sharpCursor, sharpCursor), vscode.CodeActionKind.RefactorRewrite.value
    );
    assert.ok(enharmonic?.some(action => (action.command?.arguments?.[0] as { kind?: string } | undefined)?.kind === 'enharmonic'),
      'a cursor inside a chord name offers enharmonic spelling');
    const alias = names.getText().indexOf('Cmin/A#') + 2;
    const aliasCursor = names.positionAt(alias);
    const normalized = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider', names.uri, new vscode.Range(aliasCursor, aliasCursor), vscode.CodeActionKind.RefactorRewrite.value
    );
    assert.ok(normalized?.some(action => (action.command?.arguments?.[0] as { kind?: string } | undefined)?.kind === 'normalizePitchNames'),
      'a cursor inside an alias offers normalization');
  });

  test('R016 stale and cancelled Code Actions make no edits', async () => {
    const staleSource = '| C 4.d 4.d |\n';
    const staleDoc = await openUntitled(staleSource);
    const staleStart = staleSource.indexOf('C');
    const staleActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider', staleDoc.uri,
      new vscode.Range(staleDoc.positionAt(staleStart), staleDoc.positionAt(staleStart + 1)),
      vscode.CodeActionKind.RefactorRewrite.value
    );
    const staleTranspose = staleActions?.find(action => (action.command?.arguments?.[0] as { kind?: string } | undefined)?.kind === 'transpose');
    assert.ok(staleTranspose?.command);
    const mutate = new vscode.WorkspaceEdit();
    mutate.insert(staleDoc.uri, staleDoc.positionAt(staleDoc.getText().length), '# changed\n');
    assert.ok(await vscode.workspace.applyEdit(mutate));
    const staleText = staleDoc.getText();

    const windowApi = vscode.window as unknown as { showWarningMessage: unknown; showQuickPick: unknown };
    const workspaceApi = vscode.workspace as unknown as { applyEdit: unknown };
    const originalWarn = windowApi.showWarningMessage;
    const originalPick = windowApi.showQuickPick;
    const originalApply = workspaceApi.applyEdit;
    let applyCount = 0;
    try {
      windowApi.showWarningMessage = async () => undefined;
      workspaceApi.applyEdit = async (edit: vscode.WorkspaceEdit) => {
        applyCount++;
        return (originalApply as (this: typeof vscode.workspace, edit: vscode.WorkspaceEdit) => Promise<boolean>).call(vscode.workspace, edit);
      };
      await vscode.commands.executeCommand(staleTranspose.command!.command, ...(staleTranspose.command!.arguments ?? []));
      assert.strictEqual(staleDoc.getText(), staleText, 'a command created for an older document version is rejected');
      assert.strictEqual(applyCount, 0, 'a stale action never calls applyEdit');

      const cancelSource = '| C |\n';
      const cancelDoc = await openUntitled(cancelSource);
      const cancelOffset = cancelSource.indexOf('C');
      const cancelActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider', cancelDoc.uri,
        new vscode.Range(cancelDoc.positionAt(cancelOffset), cancelDoc.positionAt(cancelOffset + 1)),
        vscode.CodeActionKind.RefactorRewrite.value
      );
      const transpose = cancelActions?.find(action => (action.command?.arguments?.[0] as { kind?: string } | undefined)?.kind === 'transpose');
      assert.ok(transpose?.command);
      windowApi.showQuickPick = async () => undefined;
      applyCount = 0;
      await vscode.commands.executeCommand(transpose.command!.command, ...(transpose.command!.arguments ?? []));
      assert.strictEqual(cancelDoc.getText(), cancelSource, 'cancelling the transpose QuickPick makes no edit');
      assert.strictEqual(applyCount, 0, 'QuickPick cancellation never calls applyEdit');
    } finally {
      windowApi.showWarningMessage = originalWarn;
      windowApi.showQuickPick = originalPick;
      workspaceApi.applyEdit = originalApply;
    }
  });

  test('R017 QuickPick version changes and concurrent applies are rejected safely', async () => {
    const source = '| C |\n';
    const doc = await openUntitled(source);
    const start = source.indexOf('C');
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider', doc.uri,
      new vscode.Range(doc.positionAt(start), doc.positionAt(start + 1)), vscode.CodeActionKind.RefactorRewrite.value
    );
    const transpose = actions?.find(action => (action.command?.arguments?.[0] as { kind?: string } | undefined)?.kind === 'transpose');
    assert.ok(transpose?.command);

    const windowApi = vscode.window as unknown as { showQuickPick: unknown; showWarningMessage: unknown };
    const workspaceApi = vscode.workspace as unknown as { applyEdit: unknown };
    const originalPick = windowApi.showQuickPick;
    const originalWarn = windowApi.showWarningMessage;
    const originalApply = workspaceApi.applyEdit;
    let resolvePick: ((item: vscode.QuickPickItem | undefined) => void) | undefined;
    let pickCalls = 0;
    let applyCalls = 0;
    try {
      windowApi.showWarningMessage = async () => undefined;
      windowApi.showQuickPick = (items: vscode.QuickPickItem[]) => {
        pickCalls++;
        return new Promise<vscode.QuickPickItem | undefined>(resolve => { resolvePick = resolve; });
      };
      workspaceApi.applyEdit = async (edit: vscode.WorkspaceEdit) => {
        applyCalls++;
        return (originalApply as (this: typeof vscode.workspace, edit: vscode.WorkspaceEdit) => Promise<boolean>).call(vscode.workspace, edit);
      };
      const pending = vscode.commands.executeCommand(transpose.command!.command, ...(transpose.command!.arguments ?? []));
      for (let i = 0; i < 100 && pickCalls === 0; i++) await settle(5);
      assert.strictEqual(pickCalls, 1, 'the first transpose action opens one picker');
      const changed = new vscode.WorkspaceEdit();
      changed.insert(doc.uri, doc.positionAt(doc.getText().length), '# changed\n');
      assert.ok(await (originalApply as (this: typeof vscode.workspace, edit: vscode.WorkspaceEdit) => Promise<boolean>).call(vscode.workspace, changed));
      const updatedText = doc.getText();
      applyCalls = 0;
      resolvePick?.({ label: 'one semitone', semitones: 1 } as vscode.QuickPickItem);
      await pending;
      assert.strictEqual(doc.getText(), updatedText, 'the picker result is discarded after the document version changes');
      assert.strictEqual(applyCalls, 0, 'a stale QuickPick result never calls applyEdit');
    } finally {
      windowApi.showQuickPick = originalPick;
      windowApi.showWarningMessage = originalWarn;
      workspaceApi.applyEdit = originalApply;
    }

    const concurrentDoc = await openUntitled(source);
    const concurrentActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider', concurrentDoc.uri,
      new vscode.Range(concurrentDoc.positionAt(start), concurrentDoc.positionAt(start + 1)), vscode.CodeActionKind.RefactorRewrite.value
    );
    const concurrentTranspose = concurrentActions?.find(action => (action.command?.arguments?.[0] as { kind?: string } | undefined)?.kind === 'transpose');
    assert.ok(concurrentTranspose?.command);
    let finishPick: ((item: vscode.QuickPickItem | undefined) => void) | undefined;
    let concurrentPicks = 0;
    let concurrentApplies = 0;
    const before = concurrentDoc.getText();
    try {
      windowApi.showQuickPick = () => {
        concurrentPicks++;
        return new Promise<vscode.QuickPickItem | undefined>(resolve => { finishPick = resolve; });
      };
      workspaceApi.applyEdit = async (edit: vscode.WorkspaceEdit) => {
        concurrentApplies++;
        return (originalApply as (this: typeof vscode.workspace, edit: vscode.WorkspaceEdit) => Promise<boolean>).call(vscode.workspace, edit);
      };
      const first = vscode.commands.executeCommand(concurrentTranspose.command!.command, ...(concurrentTranspose.command!.arguments ?? []));
      for (let i = 0; i < 100 && concurrentPicks === 0; i++) await settle(5);
      await vscode.commands.executeCommand(concurrentTranspose.command!.command, ...(concurrentTranspose.command!.arguments ?? []));
      assert.strictEqual(concurrentPicks, 1, 'a concurrent apply for the same URI does not open a second picker');
      finishPick?.({ label: 'one semitone', semitones: 1 } as vscode.QuickPickItem);
      await first;
      assert.strictEqual(concurrentApplies, 1, 'the guarded invocation applies exactly once');
      assert.notStrictEqual(concurrentDoc.getText(), before);
    } finally {
      windowApi.showQuickPick = originalPick;
      windowApi.showWarningMessage = originalWarn;
      workspaceApi.applyEdit = originalApply;
    }
    await undoIn(concurrentDoc);
    assert.strictEqual(concurrentDoc.getText(), before, 'the one accepted invocation is one Undo step');
  });

  test('R018 applyEdit rejection leaves source unchanged and reports failure', async () => {
    const source = '| C# |\n';
    const doc = await openUntitled(source);
    const start = source.indexOf('C#');
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider', doc.uri,
      new vscode.Range(doc.positionAt(start), doc.positionAt(start + 2)), vscode.CodeActionKind.RefactorRewrite.value
    );
    const enharmonic = actions?.find(action => (action.command?.arguments?.[0] as { kind?: string } | undefined)?.kind === 'enharmonic');
    assert.ok(enharmonic?.command);
    const workspaceApi = vscode.workspace as unknown as { applyEdit: unknown };
    const windowApi = vscode.window as unknown as { showWarningMessage: unknown };
    const originalApply = workspaceApi.applyEdit;
    const originalWarn = windowApi.showWarningMessage;
    let applyCalls = 0;
    let warnings = 0;
    try {
      workspaceApi.applyEdit = async () => { applyCalls++; return false; };
      windowApi.showWarningMessage = async () => { warnings++; return undefined; };
      await vscode.commands.executeCommand(enharmonic.command!.command, ...(enharmonic.command!.arguments ?? []));
      assert.strictEqual(doc.getText(), source, 'an applyEdit=false result does not mutate the document');
      assert.strictEqual(applyCalls, 1);
      assert.strictEqual(warnings, 1, 'rejected edits report a user-facing failure');
    } finally {
      workspaceApi.applyEdit = originalApply;
      windowApi.showWarningMessage = originalWarn;
    }
  });
});

suite('GuitarDSL Inspector foundation (Issue #133)', () => {
  test('normal typing and selection changes do not reveal the hidden Inspector', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
    const source = 'key: C\n| C | G | Am | F |';
    const document = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: source });
    const editor = await showAndFocus(document);
    const commands = vscode.commands as unknown as {
      executeCommand: (command: string, ...args: unknown[]) => Promise<unknown>;
    };
    const originalExecuteCommand = commands.executeCommand;
    let inspectorFocusCalls = 0;
    commands.executeCommand = async (command, ...args) => {
      if (command === 'guitardsl.inspector.focus') inspectorFocusCalls++;
      return originalExecuteCommand.call(vscode.commands, command, ...args);
    };

    try {
      await editor.edit(edit => edit.insert(new vscode.Position(1, 0), '  '));
      editor.selection = new vscode.Selection(new vscode.Position(1, 3), new vscode.Position(1, 3));
      await settle(100);
      assert.strictEqual(inspectorFocusCalls, 0, 'background context refresh never invokes the view focus command');
    } finally {
      commands.executeCommand = originalExecuteCommand;
      await closeAllEditors();
    }
  });

  test('the production Inspector WebviewView restores its latest state on repeated hide and reveal', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
    const sourceA = 'key: C\n| C | G | Am | F |';
    const documentA = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: sourceA });
    await showAndFocus(documentA);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { inspectorViewTestProbe } = require('../../inspector/inspectorView') as {
      inspectorViewTestProbe: {
        resolvedView?: vscode.WebviewView;
        transformHtml?: (html: string) => string;
      };
    };
    const transformHtml = (html: string): string => {
      const apiBinding = 'const vscodeApi = acquireVsCodeApi();';
      const testApiBinding = 'window.__guitardslInspectorTestApi = vscodeApi;';
      const instrumented = html.includes(testApiBinding)
        ? html
        : html.replace(apiBinding, `${apiBinding}\n      ${testApiBinding}`);
      const probeMarker = '<!-- guitardsl-inspector-e2e-probe -->';
      if (instrumented.includes(probeMarker)) return instrumented;
      const nonce = instrumented.match(/<script nonce="([^"]+)">/)?.[1];
      assert.ok(nonce, 'the production Inspector HTML contains its CSP nonce');
      const probe = [
        '(() => {',
        '  const state = document.getElementById("inspector-state");',
        '  const status = document.getElementById("inspector-status");',
        '  const description = document.getElementById("inspector-description");',
        '  const vscode = window.__guitardslInspectorTestApi;',
        '  const report = () => vscode.postMessage({',
        '    command: "inspectorTestSnapshot",',
        '    generation: Number(state.dataset.generation),',
        '    kind: state.dataset.contextKind,',
        '    status: status.textContent,',
        '    description: description.textContent',
        '  });',
        '  window.addEventListener("message", event => { if (event.data?.command === "setContext") report(); });',
        '  report();',
        '})();'
      ].join('\n');
      return instrumented.replace('</body>', `${probeMarker}<script nonce="${nonce}">${probe}</script>\n</body>`);
    };
    inspectorViewTestProbe.transformHtml = transformHtml;

    let messageSubscription: vscode.Disposable | undefined;
    try {
      await vscode.commands.executeCommand('guitardsl.openInspector');
      for (let attempt = 0; attempt < 100 && !inspectorViewTestProbe.resolvedView; attempt++) await settle(20);
      const inspectorView = inspectorViewTestProbe.resolvedView;
      assert.ok(inspectorView, 'the explicit command resolves the registered production WebviewView');

      type Snapshot = { generation: number; kind: string; status: string; description: string };
      const snapshots: Snapshot[] = [];
      messageSubscription = inspectorView.webview.onDidReceiveMessage((message: unknown) => {
        const candidate = message as { command?: unknown; generation?: number; kind?: string; status?: string; description?: string };
        if (candidate.command !== 'inspectorTestSnapshot' || !Number.isSafeInteger(candidate.generation)) return;
        snapshots.push(candidate as Snapshot);
      });

      const currentHtml = inspectorView.webview.html;
      assert.ok(currentHtml.includes('id="inspector-state"'), 'the resolved Inspector renders its production shell');
      const instrumentedHtml = transformHtml(currentHtml);
      assert.ok(instrumentedHtml.includes('inspectorTestSnapshot'), 'the production shell accepts the E2E DOM probe');
      if (instrumentedHtml !== currentHtml) inspectorView.webview.html = instrumentedHtml;

      const waitForNextSnapshot = async (index: number): Promise<Snapshot> => {
        for (let attempt = 0; attempt < 150; attempt++) {
          if (snapshots[index]) return snapshots[index];
          await settle(20);
        }
        throw new Error(`Inspector Webview did not report DOM snapshot ${index + 1}`);
      };

      const initial = await waitForNextSnapshot(0);
      assert.strictEqual(initial.kind, 'document');
      assert.ok(initial.status.length > 0);
      assert.ok(initial.description.length > 0);
      assert.doesNotMatch(initial.status + initial.description, /A\.guitardsl|version/i,
        'the initial DOM does not expose the host-owned URI/version');

      await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
      for (let attempt = 0; attempt < 100 && inspectorView.visible; attempt++) await settle(20);
      assert.strictEqual(inspectorView.visible, false, 'the first hide transition completes before changing editors');

      const unrelatedDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'not GuitarDSL' });
      await showAndFocus(unrelatedDocument);
      const emptyStart = snapshots.length;
      await vscode.commands.executeCommand('guitardsl.openInspector');
      const empty = await waitForNextSnapshot(emptyStart);
      assert.strictEqual(empty.kind, 'empty');
      assert.ok(empty.generation > initial.generation,
        'the first stable DOM after reveal reflects the plaintext editor selected while hidden');
      assert.notStrictEqual(empty.status, initial.status, 'switching to a non-GuitarDSL editor changes visible status text');
      assert.strictEqual(inspectorViewTestProbe.resolvedView, inspectorView,
        'hide and reveal reuse the same registered WebviewView');

      await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
      for (let attempt = 0; attempt < 100 && inspectorView.visible; attempt++) await settle(20);
      assert.strictEqual(inspectorView.visible, false, 'the second hide transition completes before editing document B');
      const documentB = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: 'key: G\n| G | D | Em | C |' });
      const editorB = await showAndFocus(documentB);
      const previousVersion = documentB.version;
      await editorB.edit(edit => edit.insert(new vscode.Position(1, 0), '  '));
      assert.ok(documentB.version > previousVersion, 'the source edit advances the document version');
      const documentBStart = snapshots.length;
      await vscode.commands.executeCommand('guitardsl.openInspector');
      const documentBFirst = await waitForNextSnapshot(documentBStart);
      assert.strictEqual(documentBFirst.kind, 'document',
        'the first stable DOM after reveal reflects the edited GuitarDSL document selected while hidden');
      assert.ok(documentBFirst.generation > empty.generation,
        'hidden document switch and source edit advance the host generation before rendering');
      assert.strictEqual(documentBFirst.status, initial.status);
      assert.strictEqual(documentBFirst.description, initial.description);
      assert.doesNotMatch(documentBFirst.description, /A\.guitardsl|B\.guitardsl|version/i,
        'URI and version remain host-owned and are not rendered into the Webview');

      await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
      for (let attempt = 0; attempt < 100 && inspectorView.visible; attempt++) await settle(20);
      assert.strictEqual(inspectorView.visible, false);
      const repeatedRevealStart = snapshots.length;
      await vscode.commands.executeCommand('guitardsl.openInspector');
      const repeatedReveal = await waitForNextSnapshot(repeatedRevealStart);
      assert.strictEqual(repeatedReveal.kind, 'document',
        'a repeated hide and reveal without a later editor event still renders the current document');
      assert.ok(repeatedReveal.generation > documentBFirst.generation);

      const liveEditStart = snapshots.length;
      const liveVersion = documentB.version;
      await editorB.edit(edit => edit.insert(new vscode.Position(1, 0), '  '));
      assert.ok(documentB.version > liveVersion);
      const liveUpdate = await waitForNextSnapshot(liveEditStart);
      assert.strictEqual(liveUpdate.kind, 'document');
      assert.ok(liveUpdate.generation > repeatedReveal.generation,
        'visible source edits continue to update the DOM through the live message path');
    } finally {
      messageSubscription?.dispose();
      inspectorViewTestProbe.transformHtml = undefined;
      await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      await closeAllEditors();
    }
  });

  test('one explicit Secondary Sidebar view opens without editing or falling back to another file', async () => {
    const ext = vscode.extensions.all.find(e => e.packageJSON?.name === 'vscode-guitar-dsl');
    assert.ok(ext);
    const packageJson = ext.packageJSON;
    const inspectorViews = packageJson.contributes.views.guitardslInspector as Array<{ id: string; type: string }>;
    assert.deepStrictEqual(inspectorViews.map(view => view.id), ['guitardsl.inspector']);
    assert.strictEqual(inspectorViews[0].type, 'webview');
    assert.strictEqual(packageJson.contributes.viewsContainers.secondarySidebar[0].id, 'guitardslInspector');
    assert.ok(packageJson.contributes.commands.some((command: { command: string }) => command.command === 'guitardsl.openInspector'));

    const source = 'key: C\n| C | G | Am | F |';
    const document = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: source });
    await showAndFocus(document);
    try {
      const before = document.getText();
      await vscode.commands.executeCommand('guitardsl.openInspector');
      assert.strictEqual(ext.isActive, true, 'the contributed command activates the extension');
      const registeredCommands = await vscode.commands.getCommands(true);
      assert.ok(registeredCommands.includes('guitardsl.openInspector'));
      assert.ok(registeredCommands.includes('guitardsl.inspector.focus'));
      await vscode.commands.executeCommand('guitardsl.openInspector');
      assert.strictEqual(document.getText(), before, 'explicit open is read-only and repeatable');
      await showAndFocus(document);
      await vscode.commands.executeCommand('guitardsl.openInspector', true);
      assert.strictEqual(vscode.window.activeTextEditor?.document, document, 'a resolved view can preserve editor focus');

      const other = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'leave this alone' });
      await showAndFocus(other);
      await vscode.commands.executeCommand('guitardsl.openInspector');
      assert.strictEqual(other.getText(), 'leave this alone', 'an unrelated active editor stays unchanged');
      assert.strictEqual(document.getText(), before, 'the Inspector does not fall back to another open file');
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      await closeAllEditors();
    }
  });

  test('E2E workbench restoration preserves an inactive tab and Preview Practice ON after success and failure', async () => withWorkbenchSnapshotRestored(async () => {
    const inactiveDocument = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: 'key: C\n| C | F | G | C |' });
    await showAndFocus(inactiveDocument);
    const previewDocument = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: 'key: G\n| G | C | D | G |' });
    await showAndFocus(previewDocument);
    await vscode.commands.executeCommand('guitardsl.showPreview', previewDocument.uri);
    await setPreviewPracticeEnabled(true);

    const initial = await captureWorkbenchSnapshot();
    const initialInactiveTab = initial.tabs.find(tab => tab.key.includes(inactiveDocument.uri.toString()));
    assert.ok(initialInactiveTab, 'the snapshot includes the pre-existing inactive text tab');
    assert.strictEqual(initialInactiveTab.active, false, 'the pre-existing text tab is inactive in the snapshot');
    assert.strictEqual(initial.previewPracticeEnabled, true, 'the snapshot records Preview Practice ON');

    await withWorkbenchSnapshotRestored(async () => {
      await setPreviewPracticeEnabled(false);
      const added = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: 'key: D\n| D | A | Bm | G |' });
      await showAndFocus(added);
    });
    assert.strictEqual(await matchesWorkbenchSnapshot(initial), true, 'normal cleanup restores the inactive tab inventory and Preview Practice ON');

    let caught: unknown;
    try {
      await withWorkbenchSnapshotRestored(async () => {
        await setPreviewPracticeEnabled(false);
        const added = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: 'key: A\n| A | D | E | A |' });
        await showAndFocus(added);
        throw new Error('intentional Practice and inactive-tab cleanup probe');
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof Error && caught.message.includes('intentional Practice and inactive-tab cleanup probe'), 'the original test failure remains observable after cleanup');
    assert.strictEqual(await matchesWorkbenchSnapshot(initial), true, 'failure cleanup restores the inactive tab inventory and Preview Practice ON');
  }));

  test('E2E workbench restoration reports a closed pre-existing inactive tab', async () => withWorkbenchSnapshotRestored(async () => {
    const inactiveDocument = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: 'key: C\n| C | F | G | C |' });
    await showAndFocus(inactiveDocument);
    const activeDocument = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: 'key: G\n| G | C | D | G |' });
    await showAndFocus(activeDocument);
    const snapshot = await captureWorkbenchSnapshot();
    const group = vscode.window.tabGroups.all.find(candidate => candidate.tabs.some(tab =>
      tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === inactiveDocument.uri.toString()));
    const inactiveTab = group?.tabs.find(tab => tab.input instanceof vscode.TabInputText
      && tab.input.uri.toString() === inactiveDocument.uri.toString());
    assert.ok(group && inactiveTab, 'the pre-existing inactive tab is present before restoration');
    assert.notStrictEqual(group.activeTab, inactiveTab, 'the tab-loss probe targets an inactive tab');
    const snapshotTab = snapshot.tabs.find(tab => tab.key.includes(inactiveDocument.uri.toString()));
    assert.ok(snapshotTab, 'the snapshot contains the tab identity used by the diagnostic');
    const tabIdentity = createHash('sha256').update(snapshotTab.key).digest('hex');
    const tabPosition = group.tabs.indexOf(inactiveTab);
    assert.strictEqual(await vscode.window.tabGroups.close(inactiveTab, true), true, 'the probe closes the pre-existing inactive tab');
    await assert.rejects(
      restoreWorkbenchSnapshot(snapshot),
      error => error instanceof Error && error.message === `P136 closed pre-existing tab(s): column ${group.viewColumn}, position ${tabPosition}, identity sha256:${tabIdentity}`
    );
  }));

  test('E2E focus recovery activates the competing Webview before the stability decision', async () => withWorkbenchSnapshotRestored(async () => {
    if (process.platform === 'darwin') {
      assert.strictEqual(vscode.window.state.focused, true, 'macOS E2E hooks foreground the isolated VS Code test app before each test');
    }
    const target = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: 'key: C\n| C | G | Am | F |' });
    await showAndFocus(target, vscode.ViewColumn.One);
    await vscode.commands.executeCommand('workbench.action.splitEditorRight');
    assert.ok(vscode.window.tabGroups.all.some(group => group.viewColumn === vscode.ViewColumn.Two), 'the workbench has a second editor group before the race');
    const panel = vscode.window.createWebviewPanel(
      'issue144.focusRace',
      'Issue 144 Focus Race',
      vscode.ViewColumn.Two,
      { enableScripts: false }
    );
    panel.webview.html = '<!doctype html><html><body>Focus race probe</body></html>';
    const competingTabReady = () => vscode.window.tabGroups.all.some(group => group.viewColumn === vscode.ViewColumn.Two
      && group.tabs.some(tab => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes('issue144.focusRace')));
    try {
      for (let attempt = 0; attempt < 100 && !competingTabReady(); attempt++) await settle(20);
      assert.strictEqual(competingTabReady(), true, 'the competing Webview is ready in the second editor group');
      panel.reveal(vscode.ViewColumn.Two, false);
      await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
      assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview, 'the competing Webview is active before the requested editor is shown');

      let barrierCompleted = false;
      await showAndFocus(target, vscode.ViewColumn.One, async () => {
        assert.ok(isDocumentActiveInColumn(target, vscode.ViewColumn.One), 'the test barrier runs after target activation');
        await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
        assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview, 'the barrier completes the competing Webview activation');
        barrierCompleted = true;
      });
      const trace = getWorkbenchFocusTrace();
      const barrierCompletedAt = trace.findIndex(entry => entry.trigger === 'focus-stability-test-barrier-completed');
      const recoveryStartedAt = trace.findIndex(entry => entry.trigger === 'focus-recovery-started');
      assert.strictEqual(barrierCompleted, true, 'the focus-stealing operation completes synchronously at the helper barrier');
      assert.ok(barrierCompletedAt >= 0 && recoveryStartedAt > barrierCompletedAt, 'the helper observes the completed focus steal before deciding whether the target is stable');
      assert.strictEqual(trace.filter(entry => entry.trigger === 'focus-recovery-started').length, 1, 'the helper performs exactly one target-group recovery');
      assert.ok(trace.some(entry => {
        const activeGroup = entry.activeTabGroup as { column?: string; tab?: string } | undefined;
        return activeGroup?.column === 'two' && activeGroup.tab?.includes('issue144.focusRace') === true;
      }), 'the bounded trace records the competing Webview and its editor group');
      assert.ok(isDocumentActiveInColumn(target, vscode.ViewColumn.One), 'the requested document is the stable active tab after recovery');
    } finally {
      panel.dispose();
    }
  }));

  test('E2E focus changes after acquisition returns are external to the completed request', async () => withWorkbenchSnapshotRestored(async () => {
    const target = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: 'key: C\n| C | G | Am | F |' });
    await showAndFocus(target, vscode.ViewColumn.One);
    await vscode.commands.executeCommand('workbench.action.splitEditorRight');
    const panel = vscode.window.createWebviewPanel(
      'issue144.postReturnFocus',
      'Issue 144 Post-Return Focus',
      vscode.ViewColumn.Two,
      { enableScripts: false }
    );
    panel.webview.html = '<!doctype html><html><body>Post-return focus probe</body></html>';
    try {
      const competingTabReady = () => vscode.window.tabGroups.all.some(group => group.viewColumn === vscode.ViewColumn.Two
        && group.tabs.some(tab => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes('issue144.postReturnFocus')));
      for (let attempt = 0; attempt < 100 && !competingTabReady(); attempt++) await settle(20);
      assert.strictEqual(competingTabReady(), true, 'the external focus target is ready in the second editor group');
      panel.reveal(vscode.ViewColumn.Two, false);
      await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
      assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview, 'the Webview is active before acquiring the requested editor');

      const targetEditor = await showAndFocus(target, vscode.ViewColumn.One);
      assert.strictEqual(targetEditor.document, target, 'focus acquisition returns the requested editor');
      recordFocusTrace('focus-acquisition-returned');
      await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
      assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview, 'a later external action activates the other group');
      assert.strictEqual(isDocumentActiveInColumn(target, vscode.ViewColumn.One), false, 'the later focus change does not retroactively invalidate the completed acquisition');
      const trace = getWorkbenchFocusTrace();
      const returnedAt = trace.findIndex(entry => entry.trigger === 'focus-acquisition-returned');
      assert.ok(returnedAt >= 0, 'the trace marks the completed acquisition');
      assert.strictEqual(trace.slice(returnedAt + 1).filter(entry => entry.trigger === 'focus-recovery-started').length, 0, 'no recovery is scheduled after the helper has returned');
    } finally {
      panel.dispose();
    }
  }));

  test('E2E workbench restoration runs after an assertion failure', async () => {
    const initial = await captureWorkbenchSnapshot();
    let caught: unknown;
    try {
      await withWorkbenchSnapshotRestored(async () => {
        await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
        const document = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: 'key: D\n| D | A | Bm | G |' });
        await showAndFocus(document);
        throw new Error('intentional E2E cleanup probe');
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof Error && caught.message.includes('intentional E2E cleanup probe'), 'the original assertion failure remains observable');
    assert.strictEqual(await matchesWorkbenchSnapshot(initial), true, 'tabs, groups, width, visibility, theme, Preview, and focus return to their initial state');
  });
});
