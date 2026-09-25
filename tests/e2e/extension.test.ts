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
    );    assert.ok(
      commands.includes('guitardsl.editChordDiagram'),
      'Command guitardsl.editChordDiagram should be registered'
    );
    assert.ok(
      commands.includes('guitardsl.transcribeYouTube'),
      'Command guitardsl.transcribeYouTube should be registered'
    );
    assert.ok(
      commands.includes('guitardsl.transcribeAudio'),
      'Command guitardsl.transcribeAudio should be registered'
    );
    assert.ok(
      commands.includes('guitardsl.setGeminiApiKey'),
      'Command guitardsl.setGeminiApiKey should be registered'
    );
    assert.ok(
      commands.includes('guitardsl.clearGeminiApiKey'),
      'Command guitardsl.clearGeminiApiKey should be registered'
    );
    assert.ok(
      commands.includes('guitardsl.applyStrummingPattern'),
      'Command guitardsl.applyStrummingPattern should be registered'
    );
  });

  test('CodeLens should offer the chord editor on chord definition lines', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'guitardsl',
      content: ['title: Chords', 'chord C@barre = x35553 base:3', 'chord D = nope', '| C@barre |'].join('\n')
    });
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', doc.uri);
    assert.ok(lenses, 'CodeLenses should be returned');
    const chordLenses = lenses.filter(l => l.command?.command === 'guitardsl.editChordDiagram');
    assert.strictEqual(chordLenses.length, 1, 'Only the valid chord line gets a CodeLens');
    assert.strictEqual(chordLenses[0].range.start.line, 1);
    assert.strictEqual(chordLenses[0].command!.arguments![1], 'C@barre');
  });

  test('Saving from the chord editor inserts, replaces and rejects duplicates', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { applyChordSave } = require('../../chordEditor');
    const doc = await vscode.workspace.openTextDocument({
      language: 'guitardsl',
      content: ['title: Save Test', '', '[Intro]', '| C@barre | G |'].join('\n')
    });
    const state = { name: 'C', label: 'barre', frets: ['x', 3, 5, 5, 5, 3], windowBase: 3, fingers: [null, '1', '3', '3', '3', '1'], barres: [{ fret: 3, from: 1, to: 5 }] };

    const inserted = await applyChordSave(doc.uri, state, undefined, false);
    assert.deepStrictEqual(inserted, { ok: true, applied: true, key: 'C@barre', line: 1 });
    assert.strictEqual(doc.lineAt(1).text, 'chord C@barre = x35553 base:3 fingers:-13331 barre:3');
    assert.strictEqual(doc.lineAt(2).text, '', 'blank line before the score is kept');

    const duplicate = await applyChordSave(doc.uri, state, undefined, true);
    assert.deepStrictEqual(duplicate, { ok: false, error: 'duplicate', detail: 'C@barre' });

    const replaced = await applyChordSave(doc.uri, { ...state, frets: ['x', 3, 5, 5, 5, 'x'], fingers: new Array(6).fill(null), barres: [] }, 1, false);
    assert.strictEqual(replaced.ok && replaced.line, 1);
    assert.strictEqual(doc.lineAt(1).text, 'chord C@barre = x3555x base:3');
    assert.strictEqual(doc.lineCount, 5);

    const invalid = await applyChordSave(doc.uri, { ...state, name: 'Hm' }, 1, false);
    assert.deepStrictEqual(invalid, { ok: false, error: 'name', detail: 'Hm' });
  });

  test('Edit chord diagram command should open the editor panel', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'guitardsl',
      content: ['chord C@barre = x35553 base:3', '| C@barre |'].join('\n')
    });
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand('guitardsl.editChordDiagram', doc.uri, 'C@barre');
    let tabs: vscode.Tab[] = [];
    let editorTab: vscode.Tab | undefined;
    for (let i = 0; i < 50 && !editorTab; i++) {
      tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
      editorTab = tabs.find(t => t.input instanceof vscode.TabInputWebview && t.label.endsWith(': C@barre'));
      if (!editorTab) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(editorTab, `Chord editor tab should be open (tabs: ${tabs.map(t => t.label).join(', ')})`);
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

  test('Transcribe YouTube command should lazily open transcribe panel', async () => {
    await vscode.commands.executeCommand('guitardsl.transcribeYouTube');
    let transcribeTab: vscode.Tab | undefined;
    for (let i = 0; i < 50 && !transcribeTab; i++) {
      const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
      transcribeTab = tabs.find(t => t.input instanceof vscode.TabInputWebview && (t.label.includes('採譜') || t.label.includes('Transcribe')));
      if (!transcribeTab) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(transcribeTab, 'Transcribe webview tab should be open');
  });
});


