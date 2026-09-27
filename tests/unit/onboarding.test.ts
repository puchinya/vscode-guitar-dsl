import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { getMessages } from '../../src/i18n';
import { parseGuitarDsl } from '../../src/compiler';

const ROOT = path.resolve(__dirname, '../..');

describe('onboarding commands', () => {
  const mock: any = require('vscode');
  const calls = {
    picks: [] as { labels: string[]; placeHolder?: string }[],
    reads: [] as string[],
    opened: [] as unknown[],
    shown: [] as unknown[],
    errors: [] as string[],
    info: [] as string[]
  };
  let pickIndex: number | undefined;
  let readFails = false;

  // Imports snapshot the mock's keys (not their values): create the keys before loading onboarding.ts,
  // then install the stubs on the current objects at run time (other test files replace them).
  mock.Uri ??= {};
  mock.workspace ??= {};
  mock.window ??= {};
  const onboarding: typeof import('../../src/onboarding') = require('../../src/onboarding');
  const openTextDocument = async (arg: unknown) => {
    calls.opened.push(arg);
    return { untitled: true, ...(arg as object) };
  };

  before(() => {
    mock.workspace.fs ??= {};
    const { Uri: uriApi, workspace: workspaceApi, window: windowApi } = mock;
    uriApi.joinPath = (base: { path: string }, ...segments: string[]) => ({ path: [base.path, ...segments].join('/') });
    workspaceApi.fs.readFile = async (uri: { path: string }) => {
      calls.reads.push(uri.path);
      if (readFails) throw new Error('ENOENT /secret/stack');
      return new Uint8Array(fs.readFileSync(uri.path));
    };
    workspaceApi.openTextDocument = openTextDocument;
    Object.assign(windowApi, {
      showQuickPick: async (items: { label: string }[], options?: { placeHolder?: string }) => {
        calls.picks.push({ labels: items.map(i => i.label), placeHolder: options?.placeHolder });
        return pickIndex === undefined ? undefined : items[pickIndex];
      },
      showTextDocument: async (doc: unknown) => { calls.shown.push(doc); },
      showErrorMessage: async (text: string) => { calls.errors.push(text); },
      showInformationMessage: async (text: string) => { calls.info.push(text); },
      showWarningMessage: async (text: string) => { calls.info.push(text); }
    });
  });

  beforeEach(() => {
    for (const list of Object.values(calls)) list.length = 0;
    pickIndex = undefined;
    readFails = false;
  });

  describe('guitardsl.newDocumentFromTemplate', () => {
    it('offers the three templates in order with localized labels', async () => {
      for (const locale of ['en', 'ja'] as const) {
        calls.picks.length = 0;
        await onboarding.newDocumentFromTemplate(locale);
        const m = getMessages(locale);
        assert.deepStrictEqual(calls.picks[0].labels, [
          m.templates.basicChordSong.label, m.templates.melodyExample.label, m.templates.leadSheetExample.label
        ]);
        assert.strictEqual(calls.picks[0].placeHolder, m.templatePickPlaceholder);
      }
      assert.deepStrictEqual(getMessages('en').templates.basicChordSong.label, 'Basic Chord Song');
      assert.deepStrictEqual(getMessages('en').templates.melodyExample.label, 'Melody Example');
      assert.deepStrictEqual(getMessages('en').templates.leadSheetExample.label, 'Lead Sheet Example');
    });

    for (const [index, id] of ['basicChordSong', 'melodyExample', 'leadSheetExample'].entries()) {
      it(`${id}: opens an untitled guitardsl document with the starter content`, async () => {
        pickIndex = index;
        await onboarding.newDocumentFromTemplate('en');
        const content = onboarding.STARTER_TEMPLATES[id as keyof typeof onboarding.STARTER_TEMPLATES].content;
        assert.deepStrictEqual(calls.opened, [{ language: 'guitardsl', content }]);
        assert.deepStrictEqual(calls.shown, [{ untitled: true, language: 'guitardsl', content }]);
        assert.deepStrictEqual(calls.errors, []);
        assert.deepStrictEqual(calls.reads, [], 'templates never read or touch files');
      });
    }

    it('cancelling the Quick Pick creates nothing and shows no notification', async () => {
      await onboarding.newDocumentFromTemplate('en');
      assert.strictEqual(calls.picks.length, 1);
      assert.deepStrictEqual([calls.opened, calls.shown, calls.errors, calls.info], [[], [], [], []]);
    });

    it('a failure to create the document shows one localized error', async () => {
      pickIndex = 0;
      mock.workspace.openTextDocument = async () => { throw new Error('boom'); };
      try {
        await onboarding.newDocumentFromTemplate('ja');
      } finally {
        mock.workspace.openTextDocument = openTextDocument;
      }
      assert.deepStrictEqual(calls.errors, [getMessages('ja').msgTemplateOpenFailed]);
      assert.deepStrictEqual(calls.shown, []);
    });
  });

  describe('starter templates', () => {
    for (const [id, template] of Object.entries(onboarding.STARTER_TEMPLATES)) {
      it(`${id}: parses without diagnostics and its body is taken from ${template.source}`, () => {
        assert.ok(template.content.trim() !== '');
        assert.deepStrictEqual(parseGuitarDsl(template.content).diagnostics.map(d => `${d.code}@${d.line}`), []);
        const sample = fs.readFileSync(path.join(ROOT, template.source), 'utf8').split('\n');
        const body = template.content.slice(template.content.indexOf('\n\n')).split('\n').filter(l => l.trim() !== '');
        for (const line of body) assert.ok(sample.includes(line), `${id}: "${line}" comes from the sample`);
        assert.ok(template.content.length <= fs.statSync(path.join(ROOT, template.source)).size);
      });
    }
  });

  describe('guitardsl.openSample', () => {
    const ext = { path: ROOT };

    it('offers exactly the five curated samples in order', async () => {
      await onboarding.openSample(ext as any, 'en');
      assert.deepStrictEqual(calls.picks[0].labels, [
        'sample.guitardsl', 'sample_melody.guitardsl', 'sample_leadsheet.guitardsl', 'sample_voicings.guitardsl', 'sample_notes.guitardsl'
      ]);
      assert.strictEqual(calls.picks[0].placeHolder, getMessages('en').samplePickPlaceholder);
    });

    for (const [index, id] of [...onboarding.CURATED_SAMPLES].entries()) {
      it(`${id}: opens the sample content as an untitled editable document`, async () => {
        pickIndex = index;
        await onboarding.openSample(ext as any, 'en');
        assert.deepStrictEqual(calls.reads, [`${ROOT}/samples/${id}`], 'read from the extension root');
        const content = fs.readFileSync(path.join(ROOT, 'samples', id), 'utf8');
        assert.deepStrictEqual(calls.opened, [{ language: 'guitardsl', content }], 'untitled document, not the packaged file URI');
        assert.deepStrictEqual(calls.shown, [{ untitled: true, language: 'guitardsl', content }]);
        assert.deepStrictEqual(calls.errors, []);
      });
    }

    it('cancelling the Quick Pick is a no-op', async () => {
      await onboarding.openSample(ext as any, 'en');
      assert.deepStrictEqual([calls.reads, calls.opened, calls.shown, calls.errors, calls.info], [[], [], [], [], []]);
    });

    it('an unreadable sample shows one localized error and opens nothing', async () => {
      pickIndex = 0;
      readFails = true;
      await onboarding.openSample(ext as any, 'ja');
      assert.deepStrictEqual(calls.opened, []);
      assert.deepStrictEqual(calls.errors, [getMessages('ja').msgSampleOpenFailed]);
      assert.ok(!calls.errors[0].includes('ENOENT'));
    });
  });

  it('the curated samples ship in the VSIX: .vscodeignore re-includes exactly those files', () => {
    const ignore = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8');
    const reincluded = [...ignore.matchAll(/^!samples\/(.+)$/gm)].map(m => m[1].trim());
    assert.deepStrictEqual(reincluded, [...onboarding.CURATED_SAMPLES]);
    assert.ok(/^samples\/\*\*$/m.test(ignore), 'other samples stay excluded');
    for (const id of onboarding.CURATED_SAMPLES) {
      assert.ok(fs.existsSync(path.join(ROOT, ...onboarding.sampleFilePath(id))), id);
    }
  });
});
