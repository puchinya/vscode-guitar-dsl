import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

test('opens a local-first GuitarDSL workspace', async ({ page }) => {
  if (process.env.GUITARDSL_CAPTURE_ISSUE166 === '1'
    && page.context().browser()?.browserType().name() === 'chromium') {
    await page.setViewportSize({ width: 1600, height: 1000 });
  }
  await page.goto('/');
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
    const evidencePath = resolve(process.cwd(), '../docs/status/evidence/issue-166/web-spa-en-desktop.png');
    await mkdir(dirname(evidencePath), { recursive: true });
    await page.screenshot({ path: evidencePath, fullPage: false });
  }
});

test('restores the latest local draft and commits it on Save', async ({ page }) => {
  await page.goto('/');
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

test('accepts browser IME composition events in the native source editor', async ({ page }) => {
  await page.goto('/');
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
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
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

test('keeps separate local documents in tabs and supports file export', async ({ page }) => {
  await page.goto('/');
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
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Untitled.pdf');
});

test('preserves a pending Preview edit when changing modes', async ({ page }) => {
  await page.goto('/');
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
  await expect(page.getByRole('textbox', { name: 'GuitarDSL source editor' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Score', exact: true }).click();
  await expect(page.locator('#source-pane')).toBeHidden();
  await expect(page.frameLocator('#score-frame').locator('.spread-sheet svg').first()).toBeVisible();
});
