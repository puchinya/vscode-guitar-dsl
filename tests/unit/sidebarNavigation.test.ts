import * as assert from 'assert';
import { getMessages } from '../../src/i18n';
import { EXPLICIT_URI_ONLY_RESOLUTION } from '../../src/documentResolver';
import {
  createSidebarNavigationCommands,
  SIDEBAR_CHOOSE_TRANSCRIPTION_SOURCE_COMMAND,
  SIDEBAR_EXPORT_GUITAR_PRO_ACTIVE_COMMAND,
  SIDEBAR_EXPORT_PDF_ACTIVE_COMMAND,
  SIDEBAR_OPEN_GUITAR_DSL_FILE_COMMAND,
  SIDEBAR_SHOW_PREVIEW_ACTIVE_COMMAND
} from '../../src/sidebarNavigation';

interface Harness {
  api: any;
  handlers: Map<string, (...args: any[]) => any>;
  executed: any[][];
  dialogOptions: any[];
  errors: string[];
  warnings: string[];
  opened: any[];
  shown: any[];
  quickPickOptions: any[][];
  selectedFiles?: any[];
  selectedSource?: any;
  openFails: boolean;
}

function createHarness(): Harness {
  const harness: Harness = {
    api: {},
    handlers: new Map(),
    executed: [],
    dialogOptions: [],
    errors: [],
    warnings: [],
    opened: [],
    shown: [],
    quickPickOptions: [],
    selectedFiles: undefined,
    selectedSource: undefined,
    openFails: false
  };
  harness.api = {
    commands: {
      registerCommand: (id: string, handler: (...args: any[]) => any) => {
        harness.handlers.set(id, handler);
        return { dispose: () => harness.handlers.delete(id) };
      },
      executeCommand: async (...args: any[]) => { harness.executed.push(args); }
    },
    window: {
      activeTextEditor: undefined,
      showOpenDialog: async (options: any) => {
        harness.dialogOptions.push(options);
        return harness.selectedFiles;
      },
      showTextDocument: async (doc: any) => { harness.shown.push(doc); },
      showErrorMessage: (message: string) => { harness.errors.push(message); },
      showWarningMessage: (message: string) => { harness.warnings.push(message); },
      showQuickPick: async (options: any[]) => {
        harness.quickPickOptions.push(options);
        return harness.selectedSource;
      }
    },
    workspace: {
      openTextDocument: async (uri: any) => {
        harness.opened.push(uri);
        if (harness.openFails) throw new Error('simulated open failure');
        return { uri, languageId: 'guitardsl', fileName: uri.path };
      }
    }
  };
  return harness;
}

describe('Sidebar navigation command handlers', () => {
  const msgs = getMessages('en');
  let harness: Harness;
  let disposables: { dispose(): void }[];

  beforeEach(() => {
    harness = createHarness();
    disposables = createSidebarNavigationCommands(harness.api, msgs);
  });

  afterEach(() => disposables.splice(0).reverse().forEach(disposable => disposable.dispose()));

  const handler = (id: string) => {
    const value = harness.handlers.get(id);
    assert.ok(value, `command ${id} is registered`);
    return value!;
  };

  it('registers each internal command once and returns owned disposables', () => {
    assert.strictEqual(disposables.length, 5);
    assert.deepStrictEqual([...harness.handlers.keys()], [
      SIDEBAR_OPEN_GUITAR_DSL_FILE_COMMAND,
      SIDEBAR_CHOOSE_TRANSCRIPTION_SOURCE_COMMAND,
      SIDEBAR_SHOW_PREVIEW_ACTIVE_COMMAND,
      SIDEBAR_EXPORT_PDF_ACTIVE_COMMAND,
      SIDEBAR_EXPORT_GUITAR_PRO_ACTIVE_COMMAND
    ]);
  });

  it('opens only .guitardsl / .gdsl files and has no effect when the picker is canceled', async () => {
    const openFile = handler(SIDEBAR_OPEN_GUITAR_DSL_FILE_COMMAND);
    await openFile();
    assert.deepStrictEqual(harness.opened, []);
    assert.deepStrictEqual(harness.shown, []);
    assert.deepStrictEqual(harness.errors, []);

    harness.selectedFiles = [{ path: '/work/score.txt' }];
    await openFile();
    assert.deepStrictEqual(harness.opened, []);
    assert.deepStrictEqual(harness.errors, [msgs.msgUnsupportedGuitarDslFile]);

    harness.selectedFiles = [{ path: '/work/score.gdsl' }];
    await openFile();
    assert.deepStrictEqual(harness.opened, [harness.selectedFiles[0]]);
    assert.deepStrictEqual(harness.shown.map(doc => doc.uri), harness.opened);
    const options = harness.dialogOptions[0];
    assert.strictEqual(options.canSelectMany, false);
    assert.deepStrictEqual(options.filters[msgs.sidebarGuitarDslFileFilter], ['guitardsl', 'gdsl']);
  });

  it('reports an open failure without creating or revealing an Untitled document', async () => {
    harness.openFails = true;
    harness.selectedFiles = [{ path: '/work/fail.guitardsl' }];
    await handler(SIDEBAR_OPEN_GUITAR_DSL_FILE_COMMAND)();
    assert.strictEqual(harness.opened.length, 1);
    assert.deepStrictEqual(harness.shown, []);
    assert.deepStrictEqual(harness.errors, [msgs.msgGuitarDslFileOpenFailed]);
  });

  it('dispatches only the selected transcription source and cancels without running either command', async () => {
    const choose = handler(SIDEBAR_CHOOSE_TRANSCRIPTION_SOURCE_COMMAND);
    await choose();
    assert.deepStrictEqual(harness.executed, []);
    assert.deepStrictEqual(harness.quickPickOptions[0].map(item => item.command), [
      'guitardsl.transcribeYouTube', 'guitardsl.transcribeAudio'
    ]);
    harness.selectedSource = harness.quickPickOptions[0][0];
    await choose();
    harness.selectedSource = harness.quickPickOptions[0][1];
    await choose();
    assert.deepStrictEqual(harness.executed, [['guitardsl.transcribeYouTube'], ['guitardsl.transcribeAudio']]);
  });

  it('uses the active editor at invocation and ignores stale item URIs or plaintext fallback', async () => {
    const uriA = { path: '/work/a.guitardsl' };
    const uriB = { path: '/work/b.gdsl' };
    const docA = { languageId: 'guitardsl', fileName: uriA.path, uri: uriA };
    const docB = { languageId: 'guitardsl', fileName: uriB.path, uri: uriB };
    harness.api.window.activeTextEditor = { document: docA };
    harness.api.window.activeTextEditor = { document: docB };

    await handler(SIDEBAR_SHOW_PREVIEW_ACTIVE_COMMAND)(uriA);
    await handler(SIDEBAR_EXPORT_PDF_ACTIVE_COMMAND)(uriA);
    await handler(SIDEBAR_EXPORT_GUITAR_PRO_ACTIVE_COMMAND)(uriA);
    assert.deepStrictEqual(harness.executed, [
      ['guitardsl.showPreview', uriB, undefined, EXPLICIT_URI_ONLY_RESOLUTION],
      ['guitardsl.exportPdf', uriB, undefined, EXPLICIT_URI_ONLY_RESOLUTION],
      ['guitardsl.exportGuitarPro', uriB, EXPLICIT_URI_ONLY_RESOLUTION]
    ]);

    harness.api.window.activeTextEditor = {
      document: { languageId: 'plaintext', fileName: '/work/readme.txt', uri: { path: '/work/readme.txt' } }
    };
    await handler(SIDEBAR_SHOW_PREVIEW_ACTIVE_COMMAND)(uriA);
    await handler(SIDEBAR_EXPORT_PDF_ACTIVE_COMMAND)(uriA);
    await handler(SIDEBAR_EXPORT_GUITAR_PRO_ACTIVE_COMMAND)(uriA);
    assert.strictEqual(harness.executed.length, 3, 'plaintext actions dispatch nothing');
    assert.deepStrictEqual(harness.warnings, [msgs.msgOpenGuitarDslFile, msgs.msgOpenGuitarDslFile, msgs.msgOpenGuitarDslFile]);
  });
});
