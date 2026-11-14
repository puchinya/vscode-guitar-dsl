import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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
  notRun: [
    'Apple Safari UI native Undo/Redo (NOT RUN; not an acceptance gate)',
    'actual OS PDF file saving (NOT RUN; not an acceptance gate)',
    'iOS/iPadOS Safari',
    'production Google OAuth',
    'production Google Drive',
    'physical audio output'
  ]
};

let server;
let driver;
let failed = false;
let terminationRequested = false;

function emit(message) {
  if (process.send) process.send(message);
}

function startStep(stepName) {
  emit({ type: 'step-start', step: stepName });
}

class BlockedCheckError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BlockedCheckError';
    this.status = 'BLOCKED';
    this.details = details;
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
    editorFound: Boolean(document.querySelector('#source-pane .cm-content')),
    editorValue: window.__guitarDslReadSource?.() ?? null,
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
    const check = {
      id,
      status,
      durationMs: Date.now() - started,
      ...(error?.details ?? {}),
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    };
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
  return driver.executeScript(() => window.__guitarDslReadSource?.() ?? null);
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
        if (!(event.target instanceof HTMLElement) || !event.target.closest('#source-pane .cm-content')) return;
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

async function setEditorFixtureText(source) {
  const changed = await driver.executeScript(value => {
    if (typeof window.__guitarDslReplaceSource !== 'function') throw new Error('CodeMirror source test hook is missing.');
    return window.__guitarDslReplaceSource(value);
  }, source);
  if (!changed && await editorValue() !== source) throw new Error('CodeMirror did not accept the fixture source.');
  await waitUntil(async () => await editorValue() === source, 'CodeMirror did not accept the fixture source.');
}

async function setEditorCursor(offset) {
  await driver.executeScript(position => {
    if (typeof window.__guitarDslSetCursor !== 'function') throw new Error('CodeMirror cursor test hook is missing.');
    window.__guitarDslSetCursor(position);
  }, offset);
}

process.on('SIGTERM', () => {
  if (terminationRequested) return;
  terminationRequested = true;
  if (server && server.exitCode === null) server.kill('SIGTERM');
  setTimeout(() => process.exit(143), 1_500);
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
  startStep('start-vite-server');
  server = spawn(process.execPath, [resolve(webRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: webRoot,
    env: {
      ...process.env,
      VITE_GOOGLE_CLIENT_ID: process.env.VITE_GOOGLE_CLIENT_ID ?? 'safari-smoke-client',
      VITE_GOOGLE_API_KEY: process.env.VITE_GOOGLE_API_KEY ?? 'safari-smoke-api-key',
      VITE_GOOGLE_APP_ID: process.env.VITE_GOOGLE_APP_ID ?? '123456789'
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

  startStep('load-guitardsl-safari-fixture');
  await driver.get(`${baseUrl}/test/safari/fixture.html`);
  console.log('Safari smoke fixture loaded.');
  await driver.wait(async () => await driver.executeScript(() => Boolean(document.querySelector('#saved-state') && document.querySelector('#source-pane .cm-content'))), 20_000);
  await driver.manage().window().setRect({ width: 1280, height: 900, x: 0, y: 0 });
  await waitUntil(async () => await driver.executeScript(() => window.innerWidth >= 1200), 'Safari smoke did not enter the wide layout.');
  await installAppEditorEventRecorder();
  report.initialPageDiagnostics = await driver.executeScript(() => ({
    language: navigator.language,
    appLoaded: Boolean(document.querySelector('#saved-state')),
    editorSelectorFound: Boolean(document.querySelector('#source-pane .cm-content')),
    ids: Array.from(document.querySelectorAll('[id]'), element => element.id)
  }));

  await recordCheck('local-create-edit-draft-refresh-restore', async () => {
    const priorTabs = await appTabSnapshot();
    await click('#file-actions .file-action');
    await waitUntil(async () => await driver.executeScript(() => window.__guitardslSafariSmoke?.localScoreCreationCount === 1)
      && (await appTabSnapshot()).some(tab => tab.name === 'Safari recovery.guitardsl' && tab.selected),
    'A new local score was not created and selected.');
    const initialSource = await editorValue();
    if (typeof initialSource !== 'string') throw new Error('The newly created local score source is missing.');
    const editor = await driver.findElement(By.css('#source-pane .cm-content'));
    const eventStart = await driver.executeScript(() => window.__guitardslSafariSmoke.nativeEditorEvents.length);
    await driver.executeScript(target => target.focus(), editor);
    await setEditorCursor(initialSource.length);
    await editor.sendKeys('x');
    const saved = `${initialSource}x`;
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

  await recordCheck('pdf-blob-validity-and-download-anchor-invocation', async () => {
    await driver.executeScript(() => {
      window.__guitardslSafariSmoke.pdfBlob = undefined;
      window.__guitardslSafariSmoke.download = undefined;
    });
    await click('#download-pdf');
    await waitUntil(async () => await driver.executeScript(() => Boolean(window.__guitardslSafariSmoke?.pdfBlob && window.__guitardslSafariSmoke?.download)),
      'PDF export did not create a Blob and invoke a download link.', 20_000);
    const details = await driver.executeAsyncScript(done => {
      const smoke = window.__guitardslSafariSmoke;
      const blob = smoke?.pdfBlob;
      if (!(blob instanceof Blob)) {
        done({ error: 'PDF export did not produce a Blob.' });
        return;
      }
      blob.arrayBuffer().then(buffer => {
        const bytes = new Uint8Array(buffer);
        const text = new TextDecoder().decode(bytes);
        done({
          blobType: blob.type,
          blobSize: blob.size,
          filename: smoke.download?.filename,
          downloadInvocationCount: smoke.downloadInvocationCount,
          signature: String.fromCharCode(...bytes.slice(0, 5)),
          pageCount: [...text.matchAll(/\/Type\s*\/Page\b/g)].length
        });
      }, error => done({ error: String(error) }));
    });
    if (details.error) throw new Error(`PDF Blob could not be inspected: ${details.error}`);
    if (details.blobType !== 'application/pdf' || details.blobSize <= 0 || !details.filename?.endsWith('.pdf')) {
      throw new Error(`Unexpected PDF export: ${JSON.stringify(details)}`);
    }
    if (details.signature !== '%PDF-' || details.pageCount < 1 || details.downloadInvocationCount < 1) {
      throw new Error(`PDF Blob validity or download-anchor invocation failed: ${JSON.stringify(details)}`);
    }
    return {
      ...details,
      validPdfBlob: true,
      downloadAnchorInvoked: true,
      actualFileSaved: 'NOT RUN (outside Issue #166 acceptance)'
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
      const candidates = ['#download-pdf', '#file-actions .file-action', '#connect-drive'];
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
    const editor = await driver.findElement(By.css('#source-pane .cm-content'));
    await driver.executeScript(target => target.focus(), editor);
    const currentSource = await editorValue();
    if (typeof currentSource !== 'string') throw new Error('CodeMirror source is missing before the storage failure edit.');
    await setEditorCursor(currentSource.length);
    await editor.sendKeys('\n# export after storage failure');
    await waitUntil(async () => await driver.executeScript(() => document.querySelector('#app-message')?.textContent?.includes('Injected Safari smoke storage failure')),
      'Injected local storage failure was not surfaced.', 10_000);
    const downloadInvocationStart = await driver.executeScript(() => {
      window.__guitardslSafariSmoke.download = undefined;
      return window.__guitardslSafariSmoke.downloadInvocationCount;
    });
    const activeTab = await driver.findElement(By.css('#open-tabs [role="tab"][aria-selected="true"]'));
    await driver.executeScript(target => {
      target.focus();
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', code: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
    }, activeTab);
    await waitUntil(async () => await driver.executeScript(() => {
      const menu = document.querySelector('#context-menu');
      return Boolean(menu && !menu.hidden && Array.from(menu.querySelectorAll('button')).some(button => button.textContent?.includes('Export source')));
    }), 'The active tab source-export menu did not open.');
    const exportMenuItem = await driver.findElements(By.css('#context-menu button')).then(async buttons => {
      for (const button of buttons) if ((await button.getText()).includes('Export source')) return button;
      throw new Error('Export source action was not rendered in the active tab menu.');
    });
    await exportMenuItem.click();
    let activationMethod = 'WebDriver click';
    try {
      await waitUntil(async () => await driver.executeScript(start => window.__guitardslSafariSmoke?.downloadInvocationCount > start, downloadInvocationStart),
        'Source export did not invoke a download after storage failed.', 1_000);
    } catch {
      activationMethod = 'WebDriver Enter';
      await exportMenuItem.sendKeys(Key.ENTER);
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
    const menuOpened = await driver.executeScript(() => {
      const menu = document.querySelector('#account-menu');
      return Boolean(menu && !menu.hidden && menu.querySelector('button'));
    });
    if (!menuOpened) await driver.findElement(By.css('#connect-drive')).sendKeys(Key.ENTER);
    await waitUntil(async () => await driver.executeScript(() => {
      const menu = document.querySelector('#account-menu');
      return Boolean(menu && !menu.hidden && menu.querySelector('button'));
    }), 'Google Account menu did not open.');
    const connectMenuAction = await driver.findElement(By.css('#account-menu button'));
    await driver.executeScript(action => action.click(), connectMenuAction);
    await waitUntil(async () => await driver.executeScript(() => document.querySelector('#app-message')?.textContent?.includes('Connected to Google Drive')),
      'Mock Google OAuth connection did not complete.', 10_000).catch(async error => {
        const details = await driver.executeScript(() => ({
          accountMenuHidden: document.querySelector('#account-menu')?.hidden,
          accountMenuText: document.querySelector('#account-menu')?.textContent?.trim(),
          tokenRequests: window.__guitardslSafariSmoke?.tokenRequests,
          appMessage: document.querySelector('#app-message')?.textContent?.trim()
        }));
        throw new Error(`${error.message} State: ${JSON.stringify(details)}`);
      });
    await click('#storage-drive');
    const driveSelected = await driver.executeScript(() => document.querySelector('#storage-drive')?.classList.contains('selected'));
    if (!driveSelected) await driver.findElement(By.css('#storage-drive')).sendKeys(Key.ENTER);
    await waitUntil(async () => await driver.executeScript(() => document.querySelector('#storage-drive')?.classList.contains('selected')),
      'Google Drive storage did not become selected.');
    const openPicker = await driver.findElements(By.css('#drive-file-actions button')).then(async buttons => {
      for (const button of buttons) if ((await button.getText()).includes('Open from Drive')) return button;
      throw new Error('Open from Drive action was not rendered.');
    });
    await openPicker.sendKeys(Key.ENTER);
    await waitUntil(async () => await driver.executeScript(() => window.__guitarDslReadSource?.().includes('Safari Drive mock')),
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
  report.finishedAt = new Date().toISOString();
  report.status = failed || report.checks.some(check => check.status !== 'PASS') ? 'FAIL' : 'PASS';
  emit({ type: 'report-metadata', metadata: {
    browserVersion: report.browserVersion,
    browserCapabilitiesVersion: report.browserCapabilitiesVersion,
    initialPageDiagnostics: report.initialPageDiagnostics,
    finalPageDiagnostics: report.finalPageDiagnostics,
    failureScreenshot: report.failureScreenshot,
    runnerError: report.runnerError,
    notRun: report.notRun
  } });
}

if (failed || report.status !== 'PASS') process.exitCode = 1;
