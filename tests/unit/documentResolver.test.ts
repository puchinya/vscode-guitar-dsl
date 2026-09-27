import * as assert from 'assert';

// T004 (Issue #80): the resolver moved from extension.ts to documentResolver.ts keeps the command
// resolution order (spec extension §3.1): explicit URI, active editor, visible editors, last active
// document, any open document, otherwise undefined.
describe('documentResolver (moved from extension.ts)', () => {
  const mock: any = require('vscode');
  // Imports snapshot the mock's keys (not their values): create them before loading the module, and
  // reload it in case another test file loaded it (via src/ai/tools.ts) before the keys existed.
  mock.window ??= {};
  mock.workspace ??= {};
  delete require.cache[require.resolve('../../src/documentResolver')];
  const resolver: typeof import('../../src/documentResolver') = require('../../src/documentResolver');

  const doc = (fileName: string, languageId = 'plaintext', isClosed = false) => ({ fileName, languageId, isClosed, uri: { fsPath: fileName } });
  const song = doc('/w/song.guitardsl', 'guitardsl');
  const other = doc('/w/other.gdsl');
  const text = doc('/w/readme.txt');
  let opened: Record<string, any>;

  beforeEach(() => {
    opened = {};
    mock.window.activeTextEditor = undefined;
    mock.window.visibleTextEditors = [];
    mock.workspace.textDocuments = [];
    mock.workspace.openTextDocument = async (uri: { fsPath: string }) => {
      if (!opened[uri.fsPath]) throw new Error('not found');
      return opened[uri.fsPath];
    };
  });

  it('isGuitarDslDocument: language id or .guitardsl / .gdsl extension', () => {
    assert.strictEqual(resolver.isGuitarDslDocument(undefined), false);
    assert.strictEqual(resolver.isGuitarDslDocument(song as any), true);
    assert.strictEqual(resolver.isGuitarDslDocument(other as any), true);
    assert.strictEqual(resolver.isGuitarDslDocument(doc('/w/SONG.GUITARDSL') as any), true);
    assert.strictEqual(resolver.isGuitarDslDocument(text as any), false);
  });

  it('explicit GuitarDSL URI wins over the active editor', async () => {
    opened[other.fileName] = other;
    mock.window.activeTextEditor = { document: song };
    assert.strictEqual(await resolver.resolveGuitarDslDocument(other.uri as any), other);
  });

  it('explicit non-GuitarDSL or unopenable URI falls back to the active GuitarDSL editor', async () => {
    opened[text.fileName] = text;
    mock.window.activeTextEditor = { document: song };
    assert.strictEqual(await resolver.resolveGuitarDslDocument(text.uri as any), song);
    assert.strictEqual(await resolver.resolveGuitarDslDocument({ fsPath: '/missing.guitardsl' } as any), song);
  });

  it('active GuitarDSL editor', async () => {
    mock.window.activeTextEditor = { document: song };
    mock.window.visibleTextEditors = [{ document: other }];
    assert.strictEqual(await resolver.resolveGuitarDslDocument(), song);
  });

  it('visible GuitarDSL editor when the active editor is not GuitarDSL', async () => {
    mock.window.activeTextEditor = { document: text };
    mock.window.visibleTextEditors = [{ document: text }, { document: other }];
    assert.strictEqual(await resolver.resolveGuitarDslDocument(), other);
  });

  it('last active document (if still open) before other open documents', async () => {
    mock.workspace.textDocuments = [other];
    assert.strictEqual(await resolver.resolveGuitarDslDocument(undefined, song as any), song);
    assert.strictEqual(await resolver.resolveGuitarDslDocument(undefined, doc('/w/closed.guitardsl', 'guitardsl', true) as any), other);
  });

  it('no GuitarDSL document: undefined', async () => {
    mock.window.activeTextEditor = { document: text };
    mock.window.visibleTextEditors = [{ document: text }];
    mock.workspace.textDocuments = [text, doc('/w/closed.gdsl', 'guitardsl', true)];
    assert.strictEqual(await resolver.resolveGuitarDslDocument(), undefined);
  });
});
