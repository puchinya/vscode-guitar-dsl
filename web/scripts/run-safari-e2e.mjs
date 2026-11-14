import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder, By, Key } from 'selenium-webdriver';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(webRoot, 'test-results/safari');
const reportPath = resolve(outputDir, 'safari-smoke-report.json');
const screenshotPath = resolve(outputDir, 'safari-smoke-failure.png');
const port = Number(process.env.GUITARDSL_SAFARI_PORT ?? 4180);
const baseUrl = `http://127.0.0.1:${port}`;
const report = {
  schemaVersion: 1,
  target: 'Apple Safari via SafariDriver',
  status: 'RUNNING',
  startedAt: new Date().toISOString(),
  osVersion: commandVersion('/usr/bin/sw_vers', ['-productVersion']),
  safariDriverVersion: commandVersion('/usr/bin/safaridriver', ['--version']),
  browserVersion: null,
  checks: [],
  notRun: ['iOS/iPadOS Safari', 'production Google OAuth', 'production Google Drive', 'physical audio output']
};

let server;
let driver;
let failed = false;

function commandVersion(command, args) {
  try { return execFileSync(command, args, { encoding: 'utf8' }).trim(); }
  catch (error) { return `UNAVAILABLE: ${error.message}`; }
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
  try {
    const details = await action();
    report.checks.push({ id, status: 'PASS', durationMs: Date.now() - started, ...(details ?? {}) });
  } catch (error) {
    failed = true;
    const check = { id, status: 'FAIL', durationMs: Date.now() - started, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    try { check.diagnostics = await pageDiagnostics(); } catch { /* retain the original failure */ }
    try {
      const path = resolve(outputDir, `${id}-failure.png`);
      await writeFile(path, Buffer.from(await driver.takeScreenshot(), 'base64'));
      check.screenshot = path;
    } catch { /* screenshot is best effort */ }
    report.checks.push(check);
    console.error(`Safari smoke failed: ${id}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
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

async function setEditorText(source) {
  await driver.executeScript(value => {
    const editor = document.querySelector('#source-pane textarea');
    if (!editor) throw new Error('Source textarea is missing.');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(editor, value);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
  }, source);
  await waitUntil(async () => await editorValue() === source, 'The native textarea did not accept the requested source.');
}

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
  server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
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
  await waitForServer();

  driver = await new Builder().forBrowser('safari').build();
  await driver.manage().setTimeouts({ implicit: 0, pageLoad: 30_000, script: 30_000 });
  report.browserVersion = await driver.executeScript(() => navigator.userAgent).catch(() => null);
  const capabilities = await driver.getCapabilities();
  report.browserCapabilitiesVersion = capabilities.get('browserVersion') ?? null;
  await driver.get(`${baseUrl}/test/safari/fixture.html`);
  await driver.wait(async () => await driver.executeScript(() => Boolean(document.querySelector('#saved-state') && document.querySelector('#source-pane textarea'))), 20_000);
  await driver.executeScript(() => {
    const editor = document.querySelector('#source-pane textarea');
    if (!editor) throw new Error('Source textarea is missing before smoke checks.');
    const events = [];
    for (const type of ['beforeinput', 'input', 'keydown', 'keyup']) {
      editor.addEventListener(type, event => events.push({
        type, inputType: event.inputType, data: event.data, key: event.key,
        metaKey: event.metaKey, shiftKey: event.shiftKey,
        trusted: event.isTrusted, defaultPrevented: event.defaultPrevented
      }), true);
    }
    window.__guitardslSafariSmoke.nativeEditorEvents = events;
  });
  report.initialPageDiagnostics = await driver.executeScript(() => ({
    language: navigator.language,
    appLoaded: Boolean(document.querySelector('#saved-state')),
    editorSelectorFound: Boolean(document.querySelector('#source-pane textarea')),
    ids: Array.from(document.querySelectorAll('[id]'), element => element.id)
  }));

  await recordCheck('local-create-edit-native-undo-redo-refresh-restore', async () => {
    const base = 'title: Safari smoke\n\ntempo: 96\n\n[Verse]\nC | G | Am | F |\n';
    await setEditorText(base);
    const editor = await driver.findElement(By.css('#source-pane textarea'));
    await editor.click();
    await driver.actions().keyDown(Key.SHIFT).sendKeys('1').keyUp(Key.SHIFT).perform();
    await waitUntil(async () => (await editorValue())?.endsWith('!'), 'Native text input was not applied.');
    await driver.actions()
      .keyDown(Key.COMMAND).keyDown('z').keyUp('z').keyUp(Key.COMMAND)
      .perform();
    await waitUntil(async () => (await editorValue()) === base, 'Command-Z did not undo the native textarea edit.');
    await driver.actions()
      .keyDown(Key.COMMAND).keyDown(Key.SHIFT).keyDown('z')
      .keyUp('z').keyUp(Key.SHIFT).keyUp(Key.COMMAND)
      .perform();
    await waitUntil(async () => (await editorValue()) === `${base}!`, 'Command-Shift-Z did not redo the native textarea edit.');
    await waitForSavedDraft();
    const saved = await editorValue();
    await driver.navigate().refresh();
    await waitUntil(async () => await editorValue() === saved, 'IndexedDB draft and open tab were not restored after refresh.', 20_000);
    await waitForSavedDraft();
    return {
      restoredSourceLength: saved.length,
      tabRestored: await driver.findElements(By.css('#open-tabs [role="tab"]')).then(tabs => tabs.length > 0),
      nativeEditorEvents: await driver.executeScript(() => window.__guitardslSafariSmoke.nativeEditorEvents.slice(-12))
    };
  });

  await recordCheck('preview-svg-and-inspector-variables-settings', async () => {
    const source = 'let riff = 4.d 4.d\nkey: C\n| C $riff |\n';
    await setEditorText(source);
    const svgCount = await inspectPreviewSvg();
    await activateInspectorTab('variables');
    await waitUntil(async () => await driver.executeScript(() => document.querySelector('#variables-list')?.textContent?.includes('riff')), 'Inspector did not show the DSL variable.');
    await activateInspectorTab('settings');
    await waitUntil(async () => await driver.executeScript(() => document.querySelectorAll('#inspector-content select, #settings-content select').length > 0), 'Inspector score settings were not rendered.');
    return { previewSvgCount: svgCount, variable: 'riff', settingsSelectCount: await driver.executeScript(() => document.querySelectorAll('#inspector-content select, #settings-content select').length) };
  });

  await recordCheck('pdf-blob-and-download-invocation', async () => {
    await click('#download-pdf');
    await waitUntil(async () => await driver.executeScript(() => Boolean(window.__guitardslSafariSmoke?.pdfBlob && window.__guitardslSafariSmoke?.download)),
      'PDF export did not create a Blob and invoke a download link.', 20_000);
    return driver.executeScript(() => ({
      blobType: window.__guitardslSafariSmoke.pdfBlob.type,
      blobSize: window.__guitardslSafariSmoke.pdfBlob.size,
      filename: window.__guitardslSafariSmoke.download.filename
    })).then(details => {
      if (details.blobType !== 'application/pdf' || details.blobSize <= 0 || !details.filename.endsWith('.pdf')) {
        throw new Error(`Unexpected PDF export: ${JSON.stringify(details)}`);
      }
      return details;
    });
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
    await driver.executeAsyncScript(done => {
      window.__failLocalDraftWrites().then(() => done({ ok: true }), error => done({ error: String(error) }));
    });
    const editor = await driver.findElement(By.css('#source-pane textarea'));
    await editor.sendKeys('\n# export after storage failure');
    await waitUntil(async () => await driver.executeScript(() => document.querySelector('#app-message')?.textContent?.includes('Injected Safari smoke storage failure')),
      'Injected local storage failure was not surfaced.', 10_000);
    await driver.executeScript(() => { window.__guitardslSafariSmoke.download = undefined; });
    await click('#export-file');
    await waitUntil(async () => await driver.executeScript(() => Boolean(window.__guitardslSafariSmoke?.download?.filename)), 'Source export did not invoke a download after storage failed.');
    const result = await driver.executeScript(() => ({ filename: window.__guitardslSafariSmoke.download.filename, savedState: document.querySelector('#saved-state')?.textContent?.trim() }));
    if (!result.filename.endsWith('.guitardsl')) throw new Error(`Unexpected source export name: ${result.filename}`);
    return result;
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
  try {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Safari smoke report: ${reportPath}`);
  } catch (error) {
    console.error(`Could not write Safari smoke report: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
  }
}

if (failed || report.status !== 'PASS') process.exitCode = 1;
