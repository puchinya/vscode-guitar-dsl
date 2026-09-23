import * as assert from 'assert';
import * as vscode from 'vscode';

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
    await vscode.window.showTextDocument(doc);

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
});

