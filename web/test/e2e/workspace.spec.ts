import { expect, test } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

test('opens a local-first GuitarDSL workspace', async ({ page }) => {
  if (process.env.GUITARDSL_CAPTURE_ISSUE166 === '1'
    && page.context().browser()?.browserType().name() === 'chromium') {
    await page.setViewportSize({ width: 1600, height: 1000 });
  }
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await expect(page.getByRole('main', { name: 'GuitarDSL' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'GuitarDSL source editor' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Document' })).toBeVisible();
  const inspectorTabs = page.locator('.shared-inspector-tabs');
  await expect(inspectorTabs.getByRole('tab')).toHaveCount(4);
  expect(await inspectorTabs.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'New score' })).toBeVisible();
  await expect(page.locator('#file-items').getByRole('button', { name: 'Untitled.guitardsl' })).toHaveCount(1);
  await expect(page.frameLocator('#score-frame').locator('.spread-sheet svg').first()).toBeVisible();
  if (process.env.GUITARDSL_CAPTURE_ISSUE166 === '1'
    && page.context().browser()?.browserType().name() === 'chromium') {
    await page.getByRole('textbox', { name: 'GuitarDSL source editor' }).fill('key: C\n\n[Verse]\nC | G | Am | F |\n');
    await page.getByRole('tab', { name: 'Progression' }).click();
    await page.getByRole('button', { name: 'Suggest next chords' }).click();
    await expect(page.locator('.progression-card').first()).toBeVisible();
    const evidencePath = resolve(process.cwd(), '../docs/status/evidence/issue-166/web-spa-en-desktop.png');
    await mkdir(dirname(evidencePath), { recursive: true });
    await page.screenshot({ path: evidencePath, fullPage: false });
  }
});

test('shows syntax highlighting while keeping the native textarea as the source buffer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const source = 'title: Song\n\n[Verse]\nC | G | Am | F | # comment\n';
  await editor.fill(source);

  const layer = page.locator('.editor-highlight');
  await expect(layer.locator('.gds-key')).toHaveText('title');
  await expect(layer.locator('.gds-section')).toHaveText('[Verse]');
  await expect(layer.locator('.gds-chord')).toHaveText(['C', 'G', 'Am', 'F']);
  await expect(layer.locator('.gds-comment')).toHaveText('# comment');
  expect(await layer.evaluate(element => element.textContent)).toBe(source);
  await expect(editor).toHaveValue(source);

  await page.getByLabel('Theme').selectOption('light');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'light');
  const lightChordColor = await layer.locator('.gds-chord').first().evaluate(element => getComputedStyle(element).color);
  await page.getByLabel('Theme').selectOption('dark');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark');
  const darkChordColor = await layer.locator('.gds-chord').first().evaluate(element => getComputedStyle(element).color);
  expect(darkChordColor).not.toBe(lightChordColor);
  await editor.fill(Array.from({ length: 80 }, (_, index) => `[Verse${index}]\nC | G |\n`).join(''));
  await editor.evaluate(element => { (element as HTMLTextAreaElement).scrollTop = 200; });
  await expect.poll(() => layer.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});

test('restores the latest local draft and commits it on Save', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const source = 'title: Draft restored\n\ntempo: 104\n\n[Verse]\nAm | F | C | G |\n';
  await editor.fill(source);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'GuitarDSL source editor' })).toHaveValue(source);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#saved-state')).toHaveText('Saved locally');
  await expect(page.getByRole('button', { name: 'Draft restored.guitardsl' })).toHaveCount(0);
});

test('finalizes a local-to-Drive move atomically only when no newer IndexedDB draft exists', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const result = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const local = await indexedDb.createLocal('Atomic move.guitardsl', 'title: Original\n');
    const stale = { identity: local.identity, revision: 0, source: local.source };
    const latest = { identity: local.identity, revision: 1, source: 'title: Newer draft\n' };
    await indexedDb.saveDraft(latest);
    const remote = {
      identity: { storage: 'drive' as const, fileId: 'drive-atomic-move' }, accountId: 'account-atomic-move',
      name: local.name, source: stale.source, revision: 0, createdAt: local.createdAt, updatedAt: Date.now()
    };

    const staleMoveCompleted = await indexedDb.completeLocalMove(stale, local.name, remote);
    const preserved = await indexedDb.getDocument(local.identity);
    const driveCountAfterStale = (await indexedDb.listDocuments('drive', 'account-atomic-move')).length;
    const current = await indexedDb.commitLocal(latest, local.name);
    const completed = current
      ? await indexedDb.completeLocalMove(latest, local.name, { ...remote, source: latest.source })
      : false;
    const localAfterCompletion = await indexedDb.getDocument(local.identity);
    const driveDocuments = await indexedDb.listDocuments('drive', 'account-atomic-move');
    return {
      staleMoveCompleted, preservedSource: preserved?.source, driveCountAfterStale,
      completed, localAfterCompletion, driveSource: driveDocuments[0]?.source
    };
  });

  expect(result.staleMoveCompleted).toBe(false);
  expect(result.preservedSource).toBe('title: Newer draft\n');
  expect(result.driveCountAfterStale).toBe(0);
  expect(result.completed).toBe(true);
  expect(result.localAfterCompletion).toBeUndefined();
  expect(result.driveSource).toBe('title: Newer draft\n');
});

test('preserves a committed document against another tab with a stale same-revision or higher-revision snapshot', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const result = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const local = await indexedDb.createLocal('Concurrent edits.guitardsl', 'title: Original\n');
    const base = { revision: local.revision, source: local.source };
    // Both editors have the same base. Local revision is not a CAS token.
    const writerA = { identity: local.identity, revision: 1, source: 'title: Writer A\n' };
    const writerB = { identity: local.identity, revision: 1, source: 'title: Writer B\n' };
    const firstDraft = await indexedDb.saveDraft(writerA, undefined, base);
    const staleDraft = await indexedDb.saveDraft(writerB, undefined, base);
    const committedA = await indexedDb.commitLocal(writerA, undefined, { revision: 1, source: writerA.source });
    const staleCommit = await indexedDb.commitLocal(writerB, undefined, base);
    const staleHigher = await indexedDb.saveDraft(
      { ...writerB, revision: 3 }, undefined, base
    );
    const after = await indexedDb.getDocument(local.identity);
    return { firstDraft, staleDraft, committed: !!committedA, staleCommit: !!staleCommit, staleHigher, source: after?.source };
  });
  expect(result).toEqual({
    firstDraft: true, staleDraft: false, committed: true,
    staleCommit: false, staleHigher: false, source: 'title: Writer A\n'
  });
});

test('keeps source export available when browser storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
  });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await expect(page.locator('#saved-state')).toContainText('Local storage is unavailable');
  const source = 'title: Keep this source\n\n[Verse]\nC | G | Am | F |\n';
  await editor.fill(source);
  await expect(editor).toHaveValue(source);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .guitardsl' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('Untitled.guitardsl');
});

test('preserves original CRLF line endings when editing and exporting an imported score', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const source = 'title: Song\r\n[Verse]\r\nC | G | Am | F |\r\n';
  await page.locator('#file-input').setInputFiles({
    name: 'Line endings.guitardsl', mimeType: 'text/plain', buffer: Buffer.from(source, 'utf8')
  });
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await expect(editor).toHaveValue(source.replace(/\r\n/gu, '\n'));
  await editor.fill(source.replace(/\r\n/gu, '\n').replace('Song', 'Track'));

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .guitardsl' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(await readFile(path!, 'utf8')).toBe('title: Track\r\n[Verse]\r\nC | G | Am | F |\r\n');
});

test('localizes the Inspector, honors its theme, and supports keyboard tabs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await page.getByLabel('Language').selectOption('ja');
  await page.getByLabel('テーマ').selectOption('dark');
  await expect(page.locator('#app')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: '新しい楽譜' })).toBeVisible();

  await page.getByRole('tab', { name: '文書' }).focus();
  await page.keyboard.press('ArrowRight');
  const variablesTab = page.getByRole('tab', { name: '変数' });
  await expect(variablesTab).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(variablesTab).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('textbox', { name: 'GuitarDSL ソースエディター' }).fill('key: C\n\n[Verse]\nC | G | Am | F |\n');
  await page.getByRole('tab', { name: 'コード進行' }).click();
  await page.getByRole('button', { name: '次のコードを提案' }).click();
  const candidate = page.locator('.progression-card').first();
  await expect(candidate).toBeVisible();
  await expect(candidate.getByRole('button', { name: '試聴' })).toBeVisible();
});

test('accepts browser IME composition events in the native source editor', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await editor.evaluate(element => {
    const input = element as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    input.value += '日本語';
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true, data: '日本語', inputType: 'insertCompositionText', isComposing: true
    }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本語' }));
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true, data: '日本語', inputType: 'insertText', isComposing: false
    }));
  });
  await expect(editor).toHaveValue(/日本語$/);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
});

test('keeps native text editing undoable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await expect(editor).toHaveValue(/^title: My song/m);
  const initial = await editor.inputValue();
  await editor.focus();
  await editor.press('ControlOrMeta+End');
  await editor.pressSequentially('!');
  await expect(editor).toHaveValue(`${initial}!`);
  await editor.press('ControlOrMeta+z');
  await expect(editor).toHaveValue(initial);
});

test('shows compiler diagnostics and moves the source selection to one', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await editor.fill('time: 3/4\n\n[Verse]\nC |\n@time: 7/x\n');
  const diagnostic = page.locator('#diagnostics button').filter({ hasText: 'L5:' });
  await expect(diagnostic).toBeVisible();
  await diagnostic.click();
  const selection = await editor.evaluate(element => ({
    start: (element as HTMLTextAreaElement).selectionStart,
    end: (element as HTMLTextAreaElement).selectionEnd
  }));
  expect(selection.start).toBeGreaterThan(0);
  expect(selection.end).toBeGreaterThan(selection.start);
});

test('applies Preview edits to source and rerenders the edited score', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const source = '[Verse]\nD | G | Am | F |\n';
  await editor.fill(source);
  const preview = page.frameLocator('#score-frame');
  const target = preview.locator('#preview-edit-target');
  await expect(target.locator('option').filter({ hasText: 'chord · D' })).toHaveCount(1);
  await expect(preview.locator('#preview-mode-select')).toBeVisible();
  const initialGeneration = await preview.locator('body').getAttribute('data-preview-generation');
  await preview.locator('#preview-mode-select').selectOption('edit');
  await expect(preview.locator('body')).toHaveAttribute('data-preview-ui-mode', 'edit');
  await expect.poll(() => preview.locator('body').getAttribute('data-preview-generation'))
    .not.toBe(initialGeneration);
  await expect(target).toBeVisible();
  const chordOption = target.locator('option').filter({ hasText: 'chord · D' });
  await expect(chordOption).toHaveCount(1);
  await target.selectOption(await chordOption.getAttribute('value') ?? '');
  await preview.locator('#preview-edit-value').fill('E');
  await preview.locator('#preview-edit-apply').click();
  await expect(preview.locator('#preview-edit-status')).toHaveText('The change was applied.');
  await expect(editor).toHaveValue('[Verse]\nE | G | Am | F |\n');
  await expect(preview.locator('#preview-edit-target option').filter({ hasText: 'chord · E' })).toHaveCount(1);
});

test('edits and renames let variables through the same shared Inspector controls and planner', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await editor.fill('let riff = 4.d 4.d\nkey: C\n| C $riff |\n');
  await page.getByRole('tab', { name: 'Variables' }).click();
  await expect(page.locator('#variables-list button')).toHaveText('riff');
  await page.locator('#variables-operation').selectOption('rename');
  await page.locator('#variables-name').fill('pulse');
  await page.locator('#variables-apply').click();
  await expect(editor).toHaveValue('let pulse = 4.d 4.d\nkey: C\n| C $pulse |\n');

  await page.locator('#variables-operation').selectOption('add');
  await page.locator('#variables-name').fill('unused');
  await page.locator('#variables-value').fill('4.d');
  await page.locator('#variables-apply').click();
  await expect(editor).toHaveValue(/let unused = 4\.d/);
  await page.locator('#variables-list button').filter({ hasText: 'unused' }).click();
  await page.locator('#variables-operation').selectOption('deleteUnused');
  await page.locator('#variables-apply').click();
  await expect(editor).not.toHaveValue(/let unused = 4\.d/);
});

test('opens the shared chord diagram editor from a Preview diagram', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const preview = page.frameLocator('#score-frame');
  const priorRevision = Number(await preview.locator('body').getAttribute('data-preview-document-version'));
  await editor.fill('title: Chord editor\n\n[Verse]\n| C | G |\n');
  // Wait for the new document revision rather than a stale visible Preview.
  await expect.poll(async () => Number(await preview.locator('body').getAttribute('data-preview-document-version')))
    .toBeGreaterThan(priorRevision);
  await expect(preview.locator('body')).toHaveAttribute('data-preview-interactions-ready', 'true');
  await expect(preview.locator('.chord-diagram').first()).toBeVisible();
  await preview.locator('.chord-diagram').first().click();
  const dialog = page.locator('dialog.web-chord-editor');
  await expect(dialog).toBeVisible();
  const chordFrame = page.frameLocator('dialog.web-chord-editor iframe');
  await expect(chordFrame.locator('#btn-save')).toBeVisible();
  await chordFrame.locator('#btn-save').click();
  await expect(editor).toHaveValue(/chord C\s*=/);
  await expect(dialog).toHaveCount(0);
});

test('serializes Inspector audition with Preview playback', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const readyPreview = page.frameLocator('#score-frame');
  const priorRevision = Number(await readyPreview.locator('body').getAttribute('data-preview-document-version'));
  await page.getByRole('textbox', { name: 'GuitarDSL source editor' }).fill('key: C\n\n[Verse]\nC | G | Am | F |\n');
  await expect.poll(async () => Number(await readyPreview.locator('body').getAttribute('data-preview-document-version')))
    .toBeGreaterThan(priorRevision);
  await expect(readyPreview.locator('body')).toHaveAttribute('data-preview-interactions-ready', 'true');
  await page.getByRole('tab', { name: 'Progression' }).click();
  await page.getByRole('button', { name: 'Suggest next chords' }).click();
  const candidate = page.locator('.progression-card').first();
  await expect(candidate).toBeVisible();
  await candidate.getByRole('button', { name: 'Audition' }).click();

  const preview = page.frameLocator('#score-frame');
  const previewBody = preview.locator('body');
  const audioStatus = page.locator('#progression-audio-status');
  await expect(audioStatus).toHaveText('Audition playing.');
  await expect(previewBody).toHaveAttribute('data-progression-audio-locked', 'true');
  await expect(preview.locator('#btn-play')).toBeDisabled();

  await page.getByRole('button', { name: 'Stop audition' }).click();
  await expect(audioStatus).toHaveText('Audition stopped.');
  await expect(previewBody).toHaveAttribute('data-progression-audio-locked', 'false');
  await expect(preview.locator('#btn-play')).toBeEnabled();
});

test('keeps separate local documents in tabs and supports file export', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  page.once('dialog', dialog => dialog.accept('Second.guitardsl'));
  await page.getByRole('button', { name: 'New score' }).click();
  await expect(page.getByRole('tab', { name: 'Second.guitardsl' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .guitardsl' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Second.guitardsl');
});

test('downloads a PDF from the shared score SVG renderer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Untitled.pdf');
});

test('preserves a pending Preview edit when changing modes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const preview = page.frameLocator('#score-frame');
  const initialGeneration = await preview.locator('body').getAttribute('data-preview-generation');
  await preview.locator('#preview-mode-select').selectOption('edit');
  await expect.poll(() => preview.locator('body').getAttribute('data-preview-generation'))
    .not.toBe(initialGeneration);
  await preview.locator('#preview-edit-target').selectOption({ index: 0 });
  const editValue = preview.locator('#preview-edit-value');
  await expect(editValue).toBeEnabled();
  const pendingValue = `${await editValue.inputValue()}m`;
  await editValue.fill(pendingValue);
  await preview.locator('#preview-mode-select').selectOption('normal');
  await expect(preview.locator('#preview-edit-status')).toHaveText('Apply the pending Preview edit before changing modes.');
  await expect(editValue).toHaveValue(pendingValue);
  await expect(preview.locator('#preview-mode-select')).toHaveValue('edit');
});

test('keeps a narrow workspace usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'GuitarDSL source editor' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Score', exact: true }).click();
  await expect(page.locator('#source-pane')).toBeHidden();
  await expect(page.frameLocator('#score-frame').locator('.spread-sheet svg').first()).toBeVisible();
});
