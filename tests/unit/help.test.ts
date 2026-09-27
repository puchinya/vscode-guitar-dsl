import * as assert from 'assert';
import { getMessages } from '../../src/i18n';
import { compileGuitarDslToHtml } from '../../src/render/previewHtml';
import { parseGuitarDsl } from '../../src/compiler';
import { renderContinuousSvg, renderScoreSheets } from '../../src/render/svg';

const DSL = 'title: Help Test\n[Intro]\n| C | 4.d 4.d 4.d 4.d |\n| G | 8.d 8.u 4.d 8.d 8.u 4.d |\n';

describe('Help runtime strings', () => {
  it('T012: Help button and failure strings exist in English and Japanese', () => {
    for (const locale of ['en', 'ja'] as const) {
      const m = getMessages(locale);
      for (const text of [m.uiHelp, m.uiHelpTitle, m.msgHelpOpenFailed]) {
        assert.ok(typeof text === 'string' && text.trim() !== '', `${locale}: non-empty`);
      }
    }
    assert.notStrictEqual(getMessages('ja').uiHelp, getMessages('en').uiHelp);
  });
});

describe('Help examples', () => {
  it('every guitardsl example in the authored Help parses without diagnostics', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    let count = 0;
    for (const locale of ['ja', 'en']) {
      for (const page of ['about', 'features', 'language', 'troubleshooting']) {
        const md = fs.readFileSync(path.resolve(__dirname, '../../docs/help', locale, `${page}.md`), 'utf8');
        for (const m of md.matchAll(/^( *)```guitardsl\n([\s\S]*?)^\1```/gm)) {
          count++;
          const src = m[2].split('\n').map(l => l.slice(m[1].length)).join('\n');
          const codes = parseGuitarDsl(src).diagnostics.map(d => `${d.code}@${d.line}`);
          assert.deepStrictEqual(codes, [], `${locale}/${page}.md example ${count}`);
        }
      }
    }
    assert.ok(count >= 10);
  });
});

describe('Preview Help control', () => {
  it('T014: the toolbar has a focusable, localized Help button that posts openHelp', () => {
    for (const locale of ['en', 'ja'] as const) {
      const m = getMessages(locale);
      const html = compileGuitarDslToHtml(DSL, { locale });
      const button = /<button class="btn-help" id="btn-help"[^>]*>[\s\S]*?<\/button>/.exec(html);
      assert.ok(button, `${locale}: Help button exists`);
      assert.ok(button[0].includes('type="button"'));
      assert.ok(button[0].includes(`title="${m.uiHelpTitle}"`));
      assert.ok(button[0].includes(`aria-label="${m.uiHelpTitle}"`));
      assert.ok(button[0].includes(m.uiHelp) && button[0].includes('?'));
      assert.ok(!/tabindex="-1"/.test(button[0]) && !/disabled/.test(button[0]));
      const right = html.slice(html.indexOf('<div class="toolbar-right">'));
      assert.ok(right.indexOf('id="btn-help"') < right.indexOf('id="btn-save-pdf"'), 'next to the PDF action');
      assert.ok(/vscode\.postMessage\(\{ command: 'openHelp' \}\)/.test(html), 'posts only the openHelp intent');
    }
  });

  it('T015: the Help control is toolbar HTML only and never part of the sheet (PDF) or web SVG', () => {
    const score = parseGuitarDsl(DSL);
    const svgs = [...renderScoreSheets(score, 'A4', 'portrait'), ...renderScoreSheets(score, 'A4', 'landscape'), renderContinuousSvg(score)];
    for (const svg of svgs) {
      assert.ok(!svg.includes('btn-help') && !svg.includes('openHelp'));
      assert.ok(!svg.includes(getMessages('en').uiHelpTitle) && !svg.includes(getMessages('ja').uiHelpTitle));
    }
  });
});

describe('openGuitarDslHelp', () => {
  const mock: any = require('vscode');
  const calls: { stat: string[]; commands: [string, string][]; errors: string[] } = { stat: [], commands: [], errors: [] };
  let statFails = false;
  let help: typeof import('../../src/help');

  before(() => {
    // Install the VS Code APIs help.ts needs before loading it (imports snapshot the mock's keys).
    mock.Uri = {
      joinPath: (base: { path: string }, ...segments: string[]) => ({ path: [base.path, ...segments].join('/'), toString() { return this.path; } })
    };
    mock.workspace = {
      fs: {
        stat: async (uri: { path: string }) => {
          calls.stat.push(uri.path);
          if (statFails) throw new Error('ENOENT /secret/stack');
          return {};
        }
      }
    };
    mock.commands = { executeCommand: async (id: string, uri: { path: string }) => { calls.commands.push([id, uri.path]); } };
    mock.window = { showErrorMessage: async (text: string) => { calls.errors.push(text); } };
    help = require('../../src/help');
  });

  beforeEach(() => {
    calls.stat = [];
    calls.commands = [];
    calls.errors = [];
    statFails = false;
  });

  it('selects the packaged Help file by resolved locale (Japanese vs English fallback)', () => {
    assert.deepStrictEqual(help.helpFilePath('ja'), ['media', 'help', 'guitardsl-help.ja.md']);
    assert.deepStrictEqual(help.helpFilePath('en'), ['media', 'help', 'guitardsl-help.en.md']);
    assert.strictEqual(help.OPEN_HELP_COMMAND, 'guitardsl.openHelp');
  });

  it('opens the locale-specific file in the built-in Markdown preview to the side', async () => {
    await help.openGuitarDslHelp({ path: '/ext' } as any, 'ja-JP');
    await help.openGuitarDslHelp({ path: '/ext' } as any, 'fr');
    assert.deepStrictEqual(calls.commands, [
      ['markdown.showPreviewToSide', '/ext/media/help/guitardsl-help.ja.md'],
      ['markdown.showPreviewToSide', '/ext/media/help/guitardsl-help.en.md']
    ]);
    assert.deepStrictEqual(calls.errors, []);
  });

  it('T018: a missing Help resource shows one localized error, no preview and no stack trace', async () => {
    statFails = true;
    await help.openGuitarDslHelp({ path: '/ext' } as any, 'ja');
    assert.deepStrictEqual(calls.commands, []);
    assert.deepStrictEqual(calls.errors, [getMessages('ja').msgHelpOpenFailed]);
    assert.ok(!calls.errors[0].includes('ENOENT'));
  });

  it('T018: a failing preview command is also reported once and does not throw', async () => {
    mock.commands.executeCommand = async () => { throw new Error('boom'); };
    try {
      await help.openGuitarDslHelp({ path: '/ext' } as any, 'en');
    } finally {
      mock.commands.executeCommand = async (id: string, uri: { path: string }) => { calls.commands.push([id, uri.path]); };
    }
    assert.deepStrictEqual(calls.errors, [getMessages('en').msgHelpOpenFailed]);
  });
});
