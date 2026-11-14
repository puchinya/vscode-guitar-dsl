import { spawn } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readlink, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Builder, By, Key } from 'selenium-webdriver';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(webRoot, 'test-results/safari');
const screenshotPath = resolve(outputDir, 'safari-smoke-failure.png');
const port = Number(process.env.GUITARDSL_SAFARI_PORT ?? 4180);
const baseUrl = `http://127.0.0.1:${port}`;
const report = {
  schemaVersion: 1,
  target: 'Apple Safari via SafariDriver',
  status: 'RUNNING',
  startedAt: new Date().toISOString(),
  browserVersion: null,
  checks: [],
  notRun: ['iOS/iPadOS Safari', 'production Google OAuth', 'production Google Drive', 'physical audio output']
};

let server;
let driver;
let isolatedSafariDownloads;
let failed = false;
let nativeKeyRoute = 'element.sendKeys';
let terminationRequested = false;

function emit(message) {
  if (process.send) process.send(message);
}

function startStep(stepName) {
  emit({ type: 'step-start', step: stepName });
}

class BlockedCheckError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlockedCheckError';
    this.status = 'BLOCKED';
  }
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite server exited with code ${server.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/test/safari/fixture.html`);
      if (response.ok) return;
      lastError = new Error(`Vite returned HTTP ${response.status}.`);
    } catch (error) { lastError = error; }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Vite server did not become ready: ${lastError?.message ?? 'timeout'}`);
}

async function waitUntil(check, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await check()) return; }
    catch (error) { lastError = error; }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
  throw new Error(`${message}${lastError ? ` (${lastError.message})` : ''}`);
}

async function pageDiagnostics() {
  if (!driver) return undefined;
  return driver.executeScript(() => ({
    url: location.href,
    language: navigator.language,
    documentTitle: document.title,
    visibilityState: document.visibilityState,
    bodyText: document.body?.innerText?.slice(0, 1200),
    appMessage: document.querySelector('#app-message')?.textContent?.trim(),
    savedState: document.querySelector('#saved-state')?.textContent?.trim(),
    previewState: document.querySelector('#preview-state')?.textContent?.trim(),
    diagnostics: document.querySelector('#diagnostics')?.textContent?.trim(),
    editorFound: Boolean(document.querySelector('#source-pane textarea')),
    editorValue: document.querySelector('#source-pane textarea')?.value,
    appInert: document.querySelector('#app')?.inert,
    ariaBusy: document.querySelector('#app')?.getAttribute('aria-busy'),
    previewFrame: (() => {
      const frame = document.querySelector('#score-frame');
      try {
        return {
          srcdocLength: frame?.srcdoc?.length ?? 0,
          readyState: frame?.contentDocument?.readyState,
          svgCount: frame?.contentDocument?.querySelectorAll('.spread-sheet svg').length ?? null
        };
      } catch (error) { return { error: String(error) }; }
    })(),
    activeElement: document.activeElement?.id || document.activeElement?.tagName,
    inspectorTabs: Array.from(document.querySelectorAll('#inspector-tabs-host [role="tab"]'), tab => ({
      id: tab.id, label: tab.textContent?.trim(), selected: tab.getAttribute('aria-selected')
    })),
    buttons: Array.from(document.querySelectorAll('button'), button => ({
      id: button.id, text: button.textContent?.trim(), disabled: button.disabled
    })),
    smoke: window.__guitardslSafariSmoke ? {
      tokenRequests: window.__guitardslSafariSmoke.tokenRequests,
      pickerOpened: window.__guitardslSafariSmoke.pickerOpened,
      driveRequests: window.__guitardslSafariSmoke.driveRequests.length,
      pdfBlobSize: window.__guitardslSafariSmoke.pdfBlob?.size,
      download: window.__guitardslSafariSmoke.download,
      nativeEditorEvents: window.__guitardslSafariSmoke.nativeEditorEvents?.slice(-20)
    } : undefined
  }));
}

async function recordCheck(id, action) {
  const started = Date.now();
  emit({ type: 'check-start', id, startedAt: new Date(started).toISOString() });
  try {
    const details = await action();
    const check = { id, status: 'PASS', durationMs: Date.now() - started, ...(details ?? {}) };
    report.checks.push(check);
    emit({ type: 'check-result', check });
  } catch (error) {
    const status = error?.status === 'BLOCKED' ? 'BLOCKED' : 'FAIL';
    failed ||= status !== 'PASS';
    const check = { id, status, durationMs: Date.now() - started, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    try { check.diagnostics = await pageDiagnostics(); } catch { /* retain the original failure */ }
    try {
      const path = resolve(outputDir, `${id}-failure.png`);
      await writeFile(path, Buffer.from(await driver.takeScreenshot(), 'base64'));
      check.screenshot = path;
    } catch { /* screenshot is best effort */ }
    report.checks.push(check);
    emit({ type: 'check-result', check });
    console.error(`Safari smoke failed: ${id}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
}

function monitorWebDriverCommands() {
  const executor = driver.getExecutor();
  const execute = executor.execute.bind(executor);
  executor.execute = async (command) => {
    const commandName = command.getName?.() ?? 'unknown';
    emit({ type: 'webdriver-command-start', command: commandName });
    let status = 'COMPLETED';
    try {
      return await execute(command);
    } catch (error) {
      status = 'FAIL';
      throw error;
    } finally {
      emit({ type: 'webdriver-command-end', command: commandName, status });
    }
  };
}

async function click(selector) {
  const element = await driver.findElement(By.css(selector));
  await driver.wait(async () => element.isDisplayed().catch(() => false), 10_000);
  await driver.executeScript(target => target.scrollIntoView({ block: 'center', inline: 'center' }), element);
  await element.click();
  return element;
}

async function editorValue() {
  return driver.executeScript(() => document.querySelector('#source-pane textarea')?.value ?? null);
}

async function waitForSavedDraft() {
  await waitUntil(async () => await driver.executeScript(() => document.querySelector('#saved-state')?.textContent?.trim() === 'Local draft saved'),
    'The local draft was not saved.');
}

async function appTabSnapshot() {
  return driver.executeScript(() => Array.from(document.querySelectorAll('#open-tabs [role="tab"]'), tab => ({
    name: tab.textContent?.trim(),
    selected: tab.getAttribute('aria-selected') === 'true'
  })));
}

async function installAppEditorEventRecorder() {
  await driver.executeScript(() => {
    const smoke = window.__guitardslSafariSmoke;
    if (!smoke) throw new Error('Safari smoke fixture state is missing.');
    if (smoke.nativeEditorEventRecorderInstalled) return;
    smoke.nativeEditorEvents = [];
    for (const type of ['beforeinput', 'input', 'keydown', 'keyup']) {
      document.addEventListener(type, event => {
        if (!(event.target instanceof HTMLTextAreaElement) || !event.target.matches('#source-pane textarea')) return;
        smoke.nativeEditorEvents.push({
          type, inputType: event.inputType, data: event.data, key: event.key,
          metaKey: event.metaKey, shiftKey: event.shiftKey,
          trusted: event.isTrusted, defaultPrevented: event.defaultPrevented
        });
      }, true);
    }
    smoke.nativeEditorEventRecorderInstalled = true;
  });
}

async function prepareIsolatedSafariDownloads() {
  if (process.env.GITHUB_ACTIONS !== 'true') return null;
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp) throw new Error('RUNNER_TEMP is required to isolate Safari downloads in CI.');

  const downloadDirectory = await mkdtemp(join(runnerTemp, 'guitardsl-safari-downloads-'));
  const downloadsPath = join(homedir(), 'Downloads');
  const backupPath = `${downloadsPath}.guitardsl-safari-${process.pid}.backup`;
  let backupCreated = false;
  let linkCreated = false;
  try {
    let existing;
    try { existing = await lstat(downloadsPath); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) {
        throw new Error('Safari Downloads must be a real directory before CI isolation.');
      }
      const entries = await readdir(downloadsPath);
      if (entries.length > 0) throw new Error('Safari Downloads is not empty; refusing to change it.');
      try {
        await lstat(backupPath);
        throw new Error('A Safari Downloads backup path already exists; refusing to replace it.');
      } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      await rename(downloadsPath, backupPath);
      backupCreated = true;
    }
    await symlink(downloadDirectory, downloadsPath, 'dir');
    linkCreated = true;
    return { directory: downloadDirectory, downloadsPath, backupPath, backupCreated };
  } catch (error) {
    if (linkCreated) await unlink(downloadsPath).catch(() => {});
    if (backupCreated) await rename(backupPath, downloadsPath).catch(() => {});
    await rm(downloadDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function restoreSafariDownloads(isolation) {
  if (!isolation) return;
  const current = await lstat(isolation.downloadsPath).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (current) {
    if (!current.isSymbolicLink()) throw new Error('Safari Downloads isolation link changed; refusing to remove it.');
    const linkTarget = await readlink(isolation.downloadsPath);
    if (resolve(dirname(isolation.downloadsPath), linkTarget) !== isolation.directory) {
      throw new Error('Safari Downloads isolation link target changed; refusing to remove it.');
    }
    await unlink(isolation.downloadsPath);
  }
  if (isolation.backupCreated) await rename(isolation.backupPath, isolation.downloadsPath);
  await rm(isolation.directory, { recursive: true, force: true });
}

async function waitForDownloadedFile(filePath, timeoutMs = 25_000) {
  await waitUntil(async () => {
    try {
      const info = await lstat(filePath);
      return info.isFile() && info.size > 0;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }, `Safari did not save the PDF file at ${filePath}.`, timeoutMs);
  return readFile(filePath);
}

async function setEditorFixtureText(source) {
  await driver.executeScript(value => {
    const editor = document.querySelector('#source-pane textarea');
    if (!editor) throw new Error('Source textarea is missing.');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(editor, value);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
  }, source);
  await waitUntil(async () => await editorValue() === source, 'The textarea did not accept the fixture source.');
}

async function sendNativeShortcut(element, redo = false) {
  if (nativeKeyRoute === 'actions') {
    const actions = driver.actions().keyDown(Key.COMMAND);
    if (redo) actions.keyDown(Key.SHIFT);
    actions.keyDown('z').keyUp('z');
    if (redo) actions.keyUp(Key.SHIFT);
    actions.keyUp(Key.COMMAND);
    await actions.perform();
    return;
  }
  await element.sendKeys(Key.chord(Key.COMMAND, ...(redo ? [Key.SHIFT] : []), 'z'));
}

async function nativeProbeSnapshot() {
  return driver.executeScript(() => {
    const editor = document.querySelector('#native-textarea-probe');
    return {
      value: editor?.value ?? null,
      focused: document.activeElement === editor,
      activeElementId: document.activeElement?.id || null,
      activeElementTagName: document.activeElement?.tagName || null,
      selectionStart: editor?.selectionStart ?? null,
      selectionEnd: editor?.selectionEnd ?? null,
      selectionDirection: editor?.selectionDirection ?? null,
      events: window.__nativeTextareaProbe.events
    };
  });
}

async function releaseNativeProbeKeys() {
  try {
    const probe = await driver.findElement(By.id('native-textarea-probe'));
    await probe.sendKeys(Key.NULL);
    return await nativeProbeSnapshot();
  } catch (error) {
    return { releaseError: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

function hasTrustedHistory(snapshot, inputType) {
  return snapshot.events.some(event => event.type === 'input' && event.inputType === inputType && event.trusted);
}

process.on('SIGTERM', () => {
  if (terminationRequested) return;
  terminationRequested = true;
  if (server && server.exitCode === null) server.kill('SIGTERM');
  const forceExit = setTimeout(() => process.exit(143), 1_500);
  void restoreSafariDownloads(isolatedSafariDownloads)
    .catch(error => { report.downloadIsolationCleanupError = error instanceof Error ? error.message : String(error); })
    .finally(() => {
      clearTimeout(forceExit);
      process.exit(143);
    });
});

async function activateInspectorTab(tab) {
  await driver.executeScript(key => document.querySelector(`#inspector-tab-${key}`)?.click(), tab);
  await waitUntil(async () => await driver.executeScript(key => document.querySelector(`#inspector-tab-${key}`)?.getAttribute('aria-selected') === 'true', tab),
    `Inspector ${tab} tab did not activate.`);
}

async function inspectPreviewSvg() {
  await driver.switchTo().frame(await driver.findElement(By.css('#score-frame')));
  try {
    await waitUntil(async () => (await driver.findElements(By.css('.spread-sheet svg'))).length > 0,
      'The Preview iframe did not render its score SVG.', 15_000);
    return (await driver.findElements(By.css('.spread-sheet svg'))).length;
  } finally {
    await driver.switchTo().defaultContent();
  }
}

try {
  await mkdir(outputDir, { recursive: true });
  startStep('isolate-ci-safari-download-folder');
  isolatedSafariDownloads = await prepareIsolatedSafariDownloads();
  startStep('start-vite-server');
  server = spawn(process.execPath, [resolve(webRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: webRoot,
    env: {
      ...process.env,
      VITE_GOOGLE_CLIENT_ID: process.env.VITE_GOOGLE_CLIENT_ID ?? 'safari-smoke-client',
      VITE_GOOGLE_API_KEY: process.env.VITE_GOOGLE_API_KEY ?? 'safari-smoke-api-key',
      VITE_GOOGLE_APP_ID: process.env.VITE_GOOGLE_APP_ID ?? '123456789',
      VITE_SAFARI_REAL_PDF_DOWNLOAD: process.env.GITHUB_ACTIONS === 'true' ? 'true' : 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', chunk => process.stdout.write(chunk));
  server.stderr.on('data', chunk => process.stderr.write(chunk));
  startStep('wait-for-vite-server');
  await waitForServer();

  console.log('Starting SafariDriver session.');
  startStep('create-safari-webdriver-session');
  emit({ type: 'webdriver-command-start', command: 'newSession', step: 'create-safari-webdriver-session' });
  try {
    driver = await new Builder().forBrowser('safari').build();
  } finally {
    emit({ type: 'webdriver-command-end', command: 'newSession', status: driver ? 'COMPLETED' : 'FAIL' });
  }
  monitorWebDriverCommands();
  console.log('SafariDriver session started.');
  startStep('configure-safari-webdriver');
  await driver.manage().setTimeouts({ implicit: 0, pageLoad: 30_000, script: 30_000 });
  console.log('SafariDriver timeouts configured.');
  report.browserVersion = await driver.executeScript(() => navigator.userAgent).catch(() => null);
  const capabilities = await driver.getCapabilities();
  report.browserCapabilitiesVersion = capabilities.get('browserVersion') ?? null;
  emit({ type: 'report-metadata', metadata: {
    browserVersion: report.browserVersion,
    browserCapabilitiesVersion: report.browserCapabilitiesVersion
  } });
  console.log(`SafariDriver browser version: ${report.browserCapabilitiesVersion ?? 'unavailable'}.`);

  let nativeUndoRedoProbePassed = false;
  startStep('load-native-textarea-probe');
  await driver.get(`${baseUrl}/test/safari/native-textarea-probe.html`);
  await driver.wait(async () => await driver.executeScript(() => Boolean(document.querySelector('#native-textarea-probe'))), 10_000);
  await recordCheck('webdriver-native-textarea-undo-redo-probe', async () => {
    try {
      const probe = await driver.findElement(By.id('native-textarea-probe'));
      const initialFocusSelection = await driver.executeScript(() => {
        const editor = document.querySelector('#native-textarea-probe');
        editor.focus();
        editor.setSelectionRange(editor.value.length, editor.value.length);
        return {
          focused: document.activeElement === editor,
          activeElementId: document.activeElement?.id || null,
          selectionStart: editor.selectionStart,
          selectionEnd: editor.selectionEnd,
          selectionDirection: editor.selectionDirection
        };
      });
      await probe.sendKeys('x');
      const afterInsert = await driver.executeScript(() => document.querySelector('#native-textarea-probe')?.value ?? null);
      await probe.sendKeys(Key.chord(Key.COMMAND, 'z'));
      const elementSendKeysUndo = await nativeProbeSnapshot();
      if (elementSendKeysUndo.value !== 'seed' || !hasTrustedHistory(elementSendKeysUndo, 'historyUndo')) {
        nativeKeyRoute = 'actions';
        await driver.actions().keyUp(Key.COMMAND).perform();
        await sendNativeShortcut(probe);
      }
      const undo = await nativeProbeSnapshot();
      if (afterInsert !== 'seedx' || undo.value !== 'seed' || !hasTrustedHistory(undo, 'historyUndo')) {
        throw new BlockedCheckError(`SafariDriver could not prove trusted native textarea undo through WebDriver: ${JSON.stringify({ initialFocusSelection, afterInsert, elementSendKeysUndo, actionUndo: nativeKeyRoute === 'actions' ? undo : undefined, nativeKeyRoute })}`);
      }
      await sendNativeShortcut(probe, true);
      const redo = await nativeProbeSnapshot();
      if (redo.value !== 'seedx' || !hasTrustedHistory(redo, 'historyRedo')) {
        throw new BlockedCheckError(`SafariDriver could not prove trusted native textarea redo through WebDriver: ${JSON.stringify({ initialFocusSelection, nativeKeyRoute, undo, redo })}`);
      }
      nativeUndoRedoProbePassed = true;
      return {
        afterInsert,
        afterUndo: undo.value,
        afterRedo: redo.value,
        undoInputType: 'historyUndo',
        redoInputType: 'historyRedo',
        trustedNativeInput: true,
        nativeKeyRoute,
        initialFocusSelection,
        undoFocusSelection: { focused: undo.focused, activeElementId: undo.activeElementId, selectionStart: undo.selectionStart, selectionEnd: undo.selectionEnd },
        redoFocusSelection: { focused: redo.focused, activeElementId: redo.activeElementId, selectionStart: redo.selectionStart, selectionEnd: redo.selectionEnd },
        keyboardEvents: redo.events.filter(event => event.type === 'keydown' || event.type === 'keyup')
      };
    } catch (error) {
      if (error?.status === 'BLOCKED') throw error;
      throw new BlockedCheckError(`SafariDriver native textarea undo/redo probe could not complete: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    }
  });
  report.nativeProbeKeyRelease = await releaseNativeProbeKeys();

  startStep('load-guitardsl-safari-fixture');
  await driver.get(`${baseUrl}/test/safari/fixture.html`);
  console.log('Safari smoke fixture loaded.');
  await driver.wait(async () => await driver.executeScript(() => Boolean(document.querySelector('#saved-state') && document.querySelector('#source-pane textarea'))), 20_000);
  await driver.manage().window().setRect({ width: 1280, height: 900, x: 0, y: 0 });
  await waitUntil(async () => await driver.executeScript(() => window.innerWidth >= 1200), 'Safari smoke did not enter the wide layout.');
  await installAppEditorEventRecorder();
  report.initialPageDiagnostics = await driver.executeScript(() => ({
    language: navigator.language,
    appLoaded: Boolean(document.querySelector('#saved-state')),
    editorSelectorFound: Boolean(document.querySelector('#source-pane textarea')),
    ids: Array.from(document.querySelectorAll('[id]'), element => element.id)
  }));

  await recordCheck('local-create-edit-draft-refresh-restore', async () => {
    const priorTabs = await appTabSnapshot();
    await click('#new-score');
    await waitUntil(async () => await driver.executeScript(() => window.__guitardslSafariSmoke?.localScoreCreationCount === 1)
      && (await appTabSnapshot()).some(tab => tab.name === 'Safari recovery.guitardsl' && tab.selected),
    'A new local score was not created and selected.');
    const initialSource = await editorValue();
    if (typeof initialSource !== 'string') throw new Error('The newly created local score source is missing.');
    const editor = await driver.findElement(By.css('#source-pane textarea'));
    const eventStart = await driver.executeScript(() => window.__guitardslSafariSmoke.nativeEditorEvents.length);
    await driver.executeScript(target => {
      target.focus();
      target.setSelectionRange(target.value.length, target.value.length);
    }, editor);
    await editor.sendKeys('\n');
    const saved = `${initialSource}\n`;
    await waitUntil(async () => await editorValue() === saved, 'Trusted WebDriver text input was not applied to the new local score.');
    const nativeEditorEvents = await driver.executeScript(start => window.__guitardslSafariSmoke.nativeEditorEvents.slice(start), eventStart);
    const trustedInput = nativeEditorEvents.some(event => event.type === 'input' && event.trusted);
    if (!trustedInput) throw new BlockedCheckError('The local score edit did not produce a trusted native input event.');
    await waitForSavedDraft();
    const tabsBeforeRefresh = await appTabSnapshot();
    await driver.navigate().refresh();
    await waitUntil(async () => await editorValue() === saved, 'IndexedDB draft and open tab were not restored after refresh.', 20_000);
    await waitForSavedDraft();
    await installAppEditorEventRecorder();
    const tabsAfterRefresh = await appTabSnapshot();
    if (JSON.stringify(tabsAfterRefresh) !== JSON.stringify(tabsBeforeRefresh)) {
      throw new Error(`Open tabs did not restore exactly: ${JSON.stringify({ before: tabsBeforeRefresh, after: tabsAfterRefresh })}`);
    }
    return {
      restoredSourceLength: saved.length,
      createdLocalScore: 'Safari recovery.guitardsl',
      priorOpenTabCount: priorTabs.length,
      restoredTabs: tabsAfterRefresh,
      trustedNativeInput: trustedInput,
      restoredAfterRefresh: true,
      nativeEditorEvents
    };
  });

  await recordCheck('native-editor-undo-redo', async () => {
    if (!nativeUndoRedoProbePassed) {
      throw new BlockedCheckError('The dependency-free native textarea probe did not prove trusted undo/redo; the app editor shortcut check remains BLOCKED.');
    }
    const base = await editorValue();
    if (typeof base !== 'string') throw new Error('The local score source is missing before the native undo check.');
    const editor = await driver.findElement(By.css('#source-pane textarea'));
    const eventStart = await driver.executeScript(() => window.__guitardslSafariSmoke.nativeEditorEvents.length);
    await driver.executeScript(target => {
      target.focus();
      target.setSelectionRange(target.value.length, target.value.length);
    }, editor);
    await editor.sendKeys('!');
    const edited = `${base}!`;
    await waitUntil(async () => await editorValue() === edited, 'Native text input was not applied before undo.');
    await sendNativeShortcut(editor);
    await waitUntil(async () => await editorValue() === base, 'Command-Z did not undo the native textarea edit.');
    await sendNativeShortcut(editor, true);
    await waitUntil(async () => await editorValue() === edited, 'Command-Shift-Z did not redo the native textarea edit.');
    const nativeEditorEvents = await driver.executeScript(start => window.__guitardslSafariSmoke.nativeEditorEvents.slice(start), eventStart);
    const trustedUndo = nativeEditorEvents.some(event => event.type === 'input' && event.inputType === 'historyUndo' && event.trusted);
    const trustedRedo = nativeEditorEvents.some(event => event.type === 'input' && event.inputType === 'historyRedo' && event.trusted);
    if (!trustedUndo || !trustedRedo) throw new BlockedCheckError('The GuitarDSL textarea did not expose trusted native historyUndo and historyRedo input events.');
    await waitForSavedDraft();
    return {
      undoMethod: `WebDriver ${nativeKeyRoute} COMMAND+Z`,
      redoMethod: `WebDriver ${nativeKeyRoute} COMMAND+SHIFT+Z`,
      trustedUndo,
      trustedRedo,
      nativeEditorEvents
    };
  });

  await recordCheck('preview-svg-and-inspector-variables-settings', async () => {
    const source = 'let riff = 4.d 4.d 4.d 4.d\nkey: C\n| C $riff |\n';
    await setEditorFixtureText(source);
    const svgCount = await inspectPreviewSvg();
    await activateInspectorTab('variables');
    await waitUntil(async () => await driver.executeScript(() => document.querySelector('#variables-list')?.textContent?.includes('riff')), 'Inspector did not show the DSL variable.');
    await activateInspectorTab('settings');
    await waitUntil(async () => await driver.executeScript(() => document.querySelectorAll('#inspector-content select, #settings-content select').length > 0), 'Inspector score settings were not rendered.');
    return { previewSvgCount: svgCount, variable: 'riff', settingsSelectCount: await driver.executeScript(() => document.querySelectorAll('#inspector-content select, #settings-content select').length) };
  });

  await recordCheck('pdf-blob-download-and-native-file-save', async () => {
    await driver.executeScript(() => {
      window.__guitardslSafariSmoke.pdfBlob = undefined;
      window.__guitardslSafariSmoke.download = undefined;
    });
    await click('#download-pdf');
    await waitUntil(async () => await driver.executeScript(() => Boolean(window.__guitardslSafariSmoke?.pdfBlob && window.__guitardslSafariSmoke?.download)),
      'PDF export did not create a Blob and invoke a download link.', 20_000);
    const details = await driver.executeScript(() => ({
      blobType: window.__guitardslSafariSmoke.pdfBlob.type,
      blobSize: window.__guitardslSafariSmoke.pdfBlob.size,
      filename: window.__guitardslSafariSmoke.download.filename,
      nativeDownloadEnabled: window.__guitardslSafariSmoke.nativePdfDownloadEnabled
    }));
    if (details.blobType !== 'application/pdf' || details.blobSize <= 0 || !details.filename.endsWith('.pdf')) {
      throw new Error(`Unexpected PDF export: ${JSON.stringify(details)}`);
    }
    if (!isolatedSafariDownloads) {
      return { ...details, realFileSaved: 'NOT RUN (local smoke does not write to user Downloads)' };
    }
    if (!details.nativeDownloadEnabled) throw new Error('Safari fixture did not enable the native PDF file download in CI.');
    const filename = basename(details.filename);
    if (filename !== details.filename) throw new Error(`Unsafe PDF download filename: ${details.filename}`);
    const downloadedPath = join(isolatedSafariDownloads.directory, filename);
    const downloadedPdf = await waitForDownloadedFile(downloadedPath);
    const signature = downloadedPdf.subarray(0, 5).toString('ascii');
    const pageCount = [...downloadedPdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length;
    if (signature !== '%PDF-' || pageCount < 1) {
      throw new Error(`Downloaded file is not a valid non-empty PDF: ${JSON.stringify({ signature, pageCount, bytes: downloadedPdf.length })}`);
    }
    const artifactPath = resolve(outputDir, `safari-pdf-download-${Date.now()}.pdf`);
    await copyFile(downloadedPath, artifactPath);
    return {
      ...details,
      realFileSaved: true,
      savedFile: artifactPath,
      savedBytes: downloadedPdf.length,
      signature,
      pageCount
    };
  });

  await recordCheck('web-audio-preview-inspector-exclusion', async () => {
    await activateInspectorTab('progression');
    await waitUntil(async () => await driver.executeScript(() => document.querySelector('#candidate-list li') !== null), 'Progression candidates were not rendered.');
    await click('#progression-play');
    await waitUntil(async () => await driver.executeScript(() => /Audition playing\./u.test(document.querySelector('#progression-audio-status')?.textContent ?? '')),
      'Inspector audition did not start using the test audio context.');
    await driver.switchTo().frame(await driver.findElement(By.css('#score-frame')));
    await waitUntil(async () => await driver.executeScript(() => document.body.dataset.progressionAudioLocked === 'true'), 'Preview was not locked during Inspector audition.');
    const previewDisabled = await driver.findElement(By.css('#btn-play')).isEnabled().then(enabled => !enabled);
    await driver.switchTo().defaultContent();
    if (!previewDisabled) throw new Error('Preview playback remained enabled during Inspector audition.');
    await click('#progression-stop');
    await waitUntil(async () => await driver.executeScript(() => document.querySelector('#progression-audio-status')?.textContent?.trim() === 'Audition stopped.'), 'Inspector audition did not stop cleanly.');
    await driver.switchTo().frame(await driver.findElement(By.css('#score-frame')));
    await waitUntil(async () => await driver.executeScript(() => document.body.dataset.progressionAudioLocked === 'false'), 'Preview did not unlock after Inspector audition.');
    await driver.switchTo().defaultContent();
    return { previewDisabledDuringAudition: previewDisabled, physicalAudioOutput: 'NOT RUN (mock AudioContext)' };
  });

  await recordCheck('narrow-layout-and-keyboard-focus', async () => {
    await driver.manage().window().setRect({ width: 390, height: 844, x: 0, y: 0 });
    await waitUntil(async () => await driver.executeScript(() => window.innerWidth <= 600), 'Safari viewport did not enter the narrow layout.');
    const width = await driver.executeScript(() => window.innerWidth);
    const focusTarget = await driver.executeScript(() => {
      const candidates = ['#download-pdf', '#new-score', '#export-file', '#connect-drive'];
      return candidates.find(selector => {
        const element = document.querySelector(selector);
        return element instanceof HTMLElement && element.getClientRects().length > 0 && !element.hidden;
      });
    });
    if (!focusTarget) throw new Error('No visible keyboard-focus target was available at the narrow width.');
    await driver.executeScript(selector => document.querySelector(selector)?.focus(), focusTarget);
    await driver.actions().sendKeys(Key.TAB).perform();
    await waitUntil(async () => await driver.executeScript(() => {
      const active = document.activeElement;
      return Boolean(active && active !== document.body && active.matches(':focus-visible'));
    }), 'Keyboard focus did not advance visibly to the next control.');
    const focusedControl = await driver.executeScript(() => document.activeElement?.id || document.activeElement?.tagName);
    return { viewportWidth: width, focusedControl, focusVisible: true };
  });

  await recordCheck('export-after-local-storage-failure', async () => {
    await driver.manage().window().setRect({ width: 1280, height: 900, x: 0, y: 0 });
    const exportSource = 'title: Safari export smoke\n\ntempo: 96\n\n[Verse]\nC | G | Am | F |\n';
    await setEditorFixtureText(exportSource);
    await waitForSavedDraft();
    await driver.executeAsyncScript(done => {
      window.__failLocalDraftWrites().then(() => done({ ok: true }), error => done({ error: String(error) }));
    });
    const editor = await driver.findElement(By.css('#source-pane textarea'));
    await driver.executeScript(target => {
      target.focus();
      target.setSelectionRange(target.value.length, target.value.length);
    }, editor);
    await editor.sendKeys('\n# export after storage failure');
    await waitUntil(async () => await driver.executeScript(() => document.querySelector('#app-message')?.textContent?.includes('Injected Safari smoke storage failure')),
      'Injected local storage failure was not surfaced.', 10_000);
    const downloadInvocationStart = await driver.executeScript(() => {
      window.__guitardslSafariSmoke.download = undefined;
      return window.__guitardslSafariSmoke.downloadInvocationCount;
    });
    await click('#export-file');
    let activationMethod = 'WebDriver click';
    try {
      await waitUntil(async () => await driver.executeScript(start => window.__guitardslSafariSmoke?.downloadInvocationCount > start, downloadInvocationStart),
        'Source export did not invoke a download after storage failed.', 1_000);
    } catch {
      activationMethod = 'WebDriver Enter';
      await driver.findElement(By.css('#export-file')).sendKeys(Key.ENTER);
      await waitUntil(async () => await driver.executeScript(start => window.__guitardslSafariSmoke?.downloadInvocationCount > start, downloadInvocationStart),
        'Source export did not invoke a download after storage failed.');
    }
    const result = await driver.executeScript(() => ({
      filename: window.__guitardslSafariSmoke.download.filename,
      downloadInvocationCount: window.__guitardslSafariSmoke.downloadInvocationCount,
      savedState: document.querySelector('#saved-state')?.textContent?.trim()
    }));
    if (!result.filename.endsWith('.guitardsl')) throw new Error(`Unexpected source export name: ${result.filename}`);
    return { ...result, activationMethod };
  });

  await recordCheck('mocked-google-oauth-picker-drive-api', async () => {
    await click('#connect-drive');
    await waitUntil(async () => await driver.executeScript(() => document.querySelector('#app-message')?.textContent?.includes('Connected to Google Drive')),
      'Mock Google OAuth connection did not complete.');
    await click('#storage-drive');
    const openPicker = await driver.findElements(By.css('#file-actions button')).then(async buttons => {
      for (const button of buttons) if ((await button.getText()).includes('Open from Drive')) return button;
      throw new Error('Open from Drive action was not rendered.');
    });
    await openPicker.sendKeys(Key.ENTER);
    await waitUntil(async () => await driver.executeScript(() => document.querySelector('#source-pane textarea')?.value.includes('Safari Drive mock')),
      'Mock Picker result did not open the Drive document.');
    const details = await driver.executeScript(() => ({
      tokenRequests: window.__guitardslSafariSmoke.tokenRequests,
      pickerOpened: window.__guitardslSafariSmoke.pickerOpened,
      driveRequests: window.__guitardslSafariSmoke.driveRequests
    }));
    if (details.tokenRequests < 1 || !details.pickerOpened || !details.driveRequests.some(request => request.path === '/drive/v3/files/safari-file')) {
      throw new Error(`Mocked OAuth/Picker/Drive path was incomplete: ${JSON.stringify(details)}`);
    }
    return { tokenRequests: details.tokenRequests, pickerOpened: details.pickerOpened, driveApiRequests: details.driveRequests.length, productionDrive: 'NOT RUN' };
  });
} catch (error) {
  failed = true;
  report.runnerError = error instanceof Error ? error.message : String(error);
  emit({ type: 'runner-error', error: report.runnerError });
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  if (driver) {
    try { report.finalPageDiagnostics = await pageDiagnostics(); }
    catch (error) { report.finalDiagnosticsError = error instanceof Error ? error.message : String(error); }
    if (failed) {
      try { await writeFile(screenshotPath, Buffer.from(await driver.takeScreenshot(), 'base64')); report.failureScreenshot = screenshotPath; }
      catch (error) { report.screenshotError = error instanceof Error ? error.message : String(error); }
    }
    try { await driver.quit(); }
    catch (error) { if (!report.quitError) report.quitError = error instanceof Error ? error.message : String(error); }
  }
  if (server && server.exitCode === null) server.kill('SIGTERM');
  try { await restoreSafariDownloads(isolatedSafariDownloads); }
  catch (error) {
    failed = true;
    report.downloadIsolationCleanupError = error instanceof Error ? error.message : String(error);
  }
  report.finishedAt = new Date().toISOString();
  report.status = failed || report.checks.some(check => check.status !== 'PASS') ? 'FAIL' : 'PASS';
  emit({ type: 'report-metadata', metadata: {
    browserVersion: report.browserVersion,
    browserCapabilitiesVersion: report.browserCapabilitiesVersion,
    initialPageDiagnostics: report.initialPageDiagnostics,
    finalPageDiagnostics: report.finalPageDiagnostics,
    failureScreenshot: report.failureScreenshot,
    runnerError: report.runnerError,
    downloadIsolationCleanupError: report.downloadIsolationCleanupError,
    nativeProbeKeyRelease: report.nativeProbeKeyRelease
  } });
}

if (failed || report.status !== 'PASS') process.exitCode = 1;
