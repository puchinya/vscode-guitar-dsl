import * as assert from 'assert';
import * as vscode from 'vscode';

const settle = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Shows `doc` and waits until it is the active editor and stays so briefly. An editor left open by an earlier
 * test can otherwise still be (or become again) active, and commands such as `undo` or tools that resolve the
 * active editor would target it.
 */
async function showAndFocus(doc: vscode.TextDocument, column: vscode.ViewColumn = vscode.ViewColumn.One): Promise<vscode.TextEditor> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const editor = await vscode.window.showTextDocument(doc, { viewColumn: column, preview: false, preserveFocus: false });
    await settle(20);
    if (vscode.window.activeTextEditor?.document === doc) {
      await settle(20);
      if (vscode.window.activeTextEditor?.document === doc) return editor;
    }
  }
  assert.fail(`${doc.uri.toString()} did not become the active editor`);
}

/** Runs `undo` in `doc` (focused first) and waits until its text has changed. */
async function undoIn(doc: vscode.TextDocument): Promise<void> {
  const before = doc.getText();
  await showAndFocus(doc);
  await vscode.commands.executeCommand('undo');
  for (let i = 0; i < 100 && doc.getText() === before; i++) await settle(10);
}

/** Closes every editor and waits until none is visible, so a suite starts without leftovers. */
async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  for (let i = 0; i < 100 && (vscode.window.visibleTextEditors.length > 0 || vscode.window.activeTextEditor); i++) await settle(10);
}

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
    assert.ok(commands.includes('guitardsl.openHelp'), 'Command guitardsl.openHelp should be registered');
    assert.ok(commands.includes('guitardsl.newDocumentFromTemplate'), 'Command guitardsl.newDocumentFromTemplate should be registered');
    assert.ok(commands.includes('guitardsl.openSample'), 'Command guitardsl.openSample should be registered');
  });

  test('the GuitarDSL sidebar view is contributed and can be focused', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('guitardsl.sidebar.focus'), 'the guitardsl.sidebar view exists');
    await vscode.commands.executeCommand('guitardsl.sidebar.focus');
    // Give focus back to the editor: later tests run focus-dependent commands such as `undo`.
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  });

  test('Every contributed command is registered (T016)', async () => {
    const ext = vscode.extensions.all.find(e => e.packageJSON?.name === 'vscode-guitar-dsl');
    assert.ok(ext);
    const registered = new Set(await vscode.commands.getCommands(true));
    for (const c of ext.packageJSON.contributes.commands as { command: string }[]) {
      assert.ok(registered.has(c.command), `${c.command} should be registered`);
    }
  });

  test('guitardsl.openHelp opens Help without a GuitarDSL document and changes no document (T017)', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const guitarDocs = () => vscode.workspace.textDocuments.filter(d => d.languageId === 'guitardsl');
    const before = guitarDocs().map(d => d.uri.toString());
    const dirtyBefore = vscode.workspace.textDocuments.filter(d => d.isDirty).length;

    await vscode.commands.executeCommand('guitardsl.openHelp');
    await vscode.commands.executeCommand('guitardsl.openHelp');

    assert.deepStrictEqual(guitarDocs().map(d => d.uri.toString()), before, 'no GuitarDSL document is opened or created');
    assert.strictEqual(vscode.workspace.textDocuments.filter(d => d.isDirty).length, dirtyBefore, 'no document is modified');
    const ext = vscode.extensions.all.find(e => e.packageJSON?.name === 'vscode-guitar-dsl');
    for (const locale of ['ja', 'en']) {
      const uri = vscode.Uri.joinPath(ext!.extensionUri, 'media', 'help', `guitardsl-help.${locale}.md`);
      const stat = await vscode.workspace.fs.stat(uri);
      assert.ok(stat.size > 0, `packaged Help ${locale} exists`);
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
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
    await showAndFocus(doc);
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
    await showAndFocus(doc);

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

  test('Tuning diagnostics highlight the invalid pitch and clear after correction', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'guitardsl',
      content: 'tuning: E2 A2 H3 G3 B3 E4\n[Intro]\n| C |\n'
    });
    const editor = await showAndFocus(doc);
    const waitFor = async (predicate: (items: readonly vscode.Diagnostic[]) => boolean) => {
      for (let i = 0; i < 50; i++) {
        const items = vscode.languages.getDiagnostics(doc.uri);
        if (predicate(items)) return items;
        await settle(100);
      }
      return vscode.languages.getDiagnostics(doc.uri);
    };
    const invalid = (await waitFor(items => items.some(d => d.code === 'invalidTuningPitch')))
      .find(d => d.code === 'invalidTuningPitch');
    assert.ok(invalid, 'invalidTuningPitch diagnostic should be published');
    assert.strictEqual(invalid.severity, vscode.DiagnosticSeverity.Error);
    assert.strictEqual(invalid.range.start.line, 0);
    assert.strictEqual(doc.getText(invalid.range), 'H3');
    await editor.edit(edit => edit.replace(invalid.range, 'D3'));
    assert.strictEqual((await waitFor(items => items.length === 0)).length, 0, 'diagnostics should clear after correction');
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
    assert.ok(transcribeTab.label.includes('Experimental') || transcribeTab.label.includes('実験的'), 'the opened webview tab identifies the feature as Experimental');
  });
});



suite('Capo / playability (Issue #62)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const previewCapo = () => require('../../previewCapo');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const scoreSettings = () => require('../../scoreSettingsEditor');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('os');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodePath = require('path');

  const SOURCE = ['title: Capo Test', 'key: B', '', '[Intro]', '| B | E | F#m7 | E/G# |', ''].join('\n');
  const AT_CAPO_2 = ['title: Capo Test', 'capo: 2', 'key: B', '', '[Intro]', '| A | D | Em7 | D/F# |', ''].join('\n');

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(check: () => boolean, message: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
      if (check()) return;
      await sleep(100);
    }
    assert.fail(message);
  }
  async function openPreviewed(content: string): Promise<vscode.TextDocument> {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content });
    await showAndFocus(doc, vscode.ViewColumn.One);
    previewCapo().effectiveDslProbe.previewInput = undefined;
    await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
    await waitFor(() => previewCapo().effectiveDslProbe.previewInput === doc.getText(), 'preview should render the source');
    return doc;
  }
  function tmpPdf(name: string): vscode.Uri {
    return vscode.Uri.file(nodePath.join(os.tmpdir(), `guitardsl-e2e-${process.pid}-${name}.pdf`));
  }
  async function replaceAll(doc: vscode.TextDocument, text: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
    assert.ok(await vscode.workspace.applyEdit(edit));
  }

  suiteSetup(async () => {
    const ext = vscode.extensions.all.find(e => e.packageJSON?.name === 'vscode-guitar-dsl');
    if (ext && !ext.isActive) await ext.activate();
  });

  test('E2E-01 capo and score settings commands are registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('guitardsl.editCapo'));
    assert.ok(commands.includes('guitardsl.editScoreSettings'));
  });

  test('E2E-02 opening the score settings editor does not mutate the source', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    const version = doc.version;
    await vscode.commands.executeCommand('guitardsl.editCapo', doc.uri);
    let tab: vscode.Tab | undefined;
    await waitFor(() => {
      tab = vscode.window.tabGroups.all.flatMap(g => g.tabs)
        .find(t => t.input instanceof vscode.TabInputWebview && /^(Score Settings|楽譜設定)/.test(t.label));
      return tab !== undefined;
    }, 'score settings editor tab should open');
    await sleep(300);
    assert.strictEqual(doc.getText(), SOURCE);
    assert.strictEqual(doc.version, version);
  });

  test('EDITOR-01 apply recomputes from the latest source', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: '| B |\n' });
    await showAndFocus(doc);
    await vscode.commands.executeCommand('guitardsl.editCapo', doc.uri);
    await replaceAll(doc, '| B | E |\n');
    const result = await scoreSettings().applyCapoTransform(doc.uri, 2);
    assert.ok(result.ok && result.changed);
    assert.strictEqual(doc.getText(), 'capo: 2\n| A | D |\n');
  });

  test('EDITOR-02 a single undo restores the previous DSL', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    const result = await scoreSettings().applyCapoTransform(doc.uri, 2);
    assert.ok(result.ok);
    assert.strictEqual(doc.getText(), AT_CAPO_2);
    await undoIn(doc);
    assert.strictEqual(doc.getText(), SOURCE);
  });

  test('PREVIEW-01/02 transient override without drift; PDF-01/02/03 PDF uses the same effective DSL', async () => {
    const doc = await openPreviewed(SOURCE);
    const controller = previewCapo().getPreviewCapoController();
    const probe = previewCapo().effectiveDslProbe;

    for (const target of [2, 5, 1]) assert.ok(controller.setTarget(doc, target));
    assert.strictEqual(doc.getText(), SOURCE, 'PREVIEW-01 the document is not mutated');
    assert.strictEqual(probe.previewInput, ['title: Capo Test', 'capo: 1', 'key: B', '', '[Intro]', '| Bb | Eb | Fm7 | Eb/G |', ''].join('\n'), 'PREVIEW-02 computed from source');

    assert.ok(controller.setTarget(doc, 2));
    assert.strictEqual(probe.previewInput, AT_CAPO_2);
    const target = tmpPdf('override');
    await vscode.commands.executeCommand('guitardsl.exportPdf', doc.uri, target);
    assert.strictEqual(probe.pdfInput, probe.previewInput, 'PDF-01 identical effective DSL');
    assert.ok(probe.pdfInput.includes('capo: 2') && probe.pdfInput.includes('key: B') && probe.pdfInput.includes('| A |'), 'PDF-02');
    assert.ok(fs.existsSync(target.fsPath) && fs.statSync(target.fsPath).size > 0, 'PDF-03 file written');
    fs.unlinkSync(target.fsPath);
    assert.strictEqual(doc.getText(), SOURCE);
  });

  test('Issue #84 alternate tuning reaches Preview and PDF while key and melody stay unchanged', async () => {
    const source = [
      'title: Alternate Tuning',
      'tuning: Drop D',
      'capo: 0',
      'key: C',
      '',
      '[Intro]',
      '| C |',
      'mel: | c4/1 |',
      ''
    ].join('\n');
    const doc = await openPreviewed(source);
    const controller = previewCapo().getPreviewCapoController();
    const probe = previewCapo().effectiveDslProbe;
    assert.ok(controller.setTarget(doc, 2));
    const expected = source.replace('capo: 0', 'capo: 2').replace('| C |', '| Bb |');
    await waitFor(() => probe.previewInput === expected, 'Preview should retain tuning and transform only capo-relative chord names');
    const target = tmpPdf('alternate-tuning');
    await vscode.commands.executeCommand('guitardsl.exportPdf', doc.uri, target);
    assert.strictEqual(probe.pdfInput, probe.previewInput, 'PDF must use the same effective DSL as Preview');
    assert.ok(probe.pdfInput.includes('tuning: Drop D') && probe.pdfInput.includes('key: C') && probe.pdfInput.includes('mel: | c4/1 |'));
    assert.ok(fs.existsSync(target.fsPath) && fs.statSync(target.fsPath).size > 0);
    fs.unlinkSync(target.fsPath);
    assert.strictEqual(doc.getText(), source, 'the temporary capo preview must not edit the document');
  });

  test('PREVIEW-03 source edits recompute the override; PREVIEW-04 unsupported source clears it', async () => {
    const doc = await openPreviewed(SOURCE);
    const controller = previewCapo().getPreviewCapoController();
    const probe = previewCapo().effectiveDslProbe;
    assert.ok(controller.setTarget(doc, 2));

    await replaceAll(doc, SOURCE.replace('| B | E |', '| B | C# |'));
    await waitFor(() => probe.previewInput?.includes('| A | B |') === true, 'PREVIEW-03 transformed preview follows the source');
    assert.deepStrictEqual(controller.getState(), { documentUri: doc.uri.toString(), targetCapo: 2 });

    const unsupported = 'chord C@special = x35553\n' + doc.getText().replace('| B |', '| C@special |');
    await replaceAll(doc, unsupported);
    await waitFor(() => probe.previewInput === unsupported, 'PREVIEW-04 source is rendered');
    assert.strictEqual(controller.getState(), undefined);
    assert.ok(controller.resolve(doc).capo.warning, 'a warning is shown in the capo bar');

    const target = tmpPdf('invalidated');
    await vscode.commands.executeCommand('guitardsl.exportPdf', doc.uri, target);
    assert.strictEqual(probe.pdfInput, unsupported, 'no stale transformed PDF');
    fs.unlinkSync(target.fsPath);
  });

  test('PDF-04 without an override the PDF input is exactly doc.getText(); state resets on switch and close', async () => {
    const doc = await openPreviewed(SOURCE);
    const controller = previewCapo().getPreviewCapoController();
    const probe = previewCapo().effectiveDslProbe;
    const target = tmpPdf('plain');
    await vscode.commands.executeCommand('guitardsl.exportPdf', doc.uri, target);
    assert.strictEqual(probe.pdfInput, doc.getText());
    fs.unlinkSync(target.fsPath);

    assert.ok(controller.setTarget(doc, 3));
    const other = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: '| G |\n' });
    await showAndFocus(other, vscode.ViewColumn.One);
    await waitFor(() => controller.getState() === undefined, 'switching documents resets the override');

    await showAndFocus(doc, vscode.ViewColumn.One);
    assert.ok(controller.setTarget(doc, 3));
    const previewTab = vscode.window.tabGroups.all.flatMap(g => g.tabs).find(t => t.input instanceof vscode.TabInputWebview && t.label.includes('GuitarDSL'));
    assert.ok(previewTab, 'preview tab');
    await vscode.window.tabGroups.close(previewTab!);
    await waitFor(() => controller.getState() === undefined, 'closing the preview resets the override');
  });

  test('E2E-PB01 source edits rebuild Preview HTML for the same document', async () => {
    const doc = await openPreviewed(SOURCE);
    const probe = previewCapo().previewLifecycleProbe;
    const generation = probe.generation;

    await replaceAll(doc, SOURCE.replace('Capo Test', 'Edited Capo Test'));
    await waitFor(() => probe.generation > generation && probe.currentDocumentUri === doc.uri.toString(),
      'editing the source should generate new Preview HTML for the same document');
    assert.ok(probe.generation > generation);
  });

  test('E2E-PB02 switching documents rebuilds Preview for the newly active document', async () => {
    await openPreviewed(SOURCE);
    const probe = previewCapo().previewLifecycleProbe;
    const generation = probe.generation;
    const docB = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: '| G |\n' });

    await showAndFocus(docB, vscode.ViewColumn.One);
    await waitFor(() => probe.generation > generation && probe.currentDocumentUri === docB.uri.toString(),
      'document switch should generate Preview HTML for document B');
  });

  test('E2E-PB03 closing the Preview webview disposes its current HTML generation', async () => {
    await openPreviewed(SOURCE);
    const probe = previewCapo().previewLifecycleProbe;
    const generation = probe.generation;
    let previewTab: vscode.Tab | undefined;
    await waitFor(() => {
      previewTab = vscode.window.tabGroups.all.flatMap(group => group.tabs)
        .find(tab => tab.input instanceof vscode.TabInputWebview && tab.label.includes('GuitarDSL'));
      return previewTab !== undefined;
    }, 'Preview Webview tab should be open');

    await vscode.window.tabGroups.close(previewTab!);
    await waitFor(() => probe.disposedGeneration === generation,
      'closing the Preview tab should dispose the current generation');
  });
});

suite('Beginner Mode (Issue #65)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const previewCapo = () => require('../../previewCapo');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const previewBeginner = () => require('../../previewBeginner');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const beginnerMode = () => require('../../beginnerMode');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const scoreSettings = () => require('../../scoreSettingsEditor');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const i18n = () => require('../../i18n');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('os');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodePath = require('path');

  const SOURCE = ['title: Beginner Test', 'key: C', '', '[Intro]', '| F | C | G | Am |', ''].join('\n');
  const FORBID_AT_0 = SOURCE.replace('| F |', '| Fmaj7 |');

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(check: () => boolean, message: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
      if (check()) return;
      await sleep(100);
    }
    assert.fail(message);
  }
  const probe = () => previewCapo().effectiveDslProbe;
  const beginner = () => previewBeginner().getPreviewBeginnerController();
  const capo = () => previewCapo().getPreviewCapoController();
  async function openPreviewed(content: string): Promise<vscode.TextDocument> {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content });
    await showAndFocus(doc, vscode.ViewColumn.One);
    probe().previewInput = undefined;
    await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
    await waitFor(() => probe().previewInput === doc.getText(), 'preview should render the source');
    return doc;
  }
  function tmpPdf(name: string): vscode.Uri {
    return vscode.Uri.file(nodePath.join(os.tmpdir(), `guitardsl-e2e-${process.pid}-beginner-${name}.pdf`));
  }
  async function exportPdf(doc: vscode.TextDocument, name: string): Promise<string> {
    const target = tmpPdf(name);
    await vscode.commands.executeCommand('guitardsl.exportPdf', doc.uri, target);
    assert.ok(fs.existsSync(target.fsPath) && fs.statSync(target.fsPath).size > 0, 'PDF written');
    fs.unlinkSync(target.fsPath);
    return probe().pdfInput;
  }
  async function replaceAll(doc: vscode.TextDocument, text: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
    assert.ok(await vscode.workspace.applyEdit(edit));
  }

  suiteSetup(async () => {
    const ext = vscode.extensions.all.find(e => e.packageJSON?.name === 'vscode-guitar-dsl');
    if (ext && !ext.isActive) await ext.activate();
  });

  test('BEG-E2E-01 ON clears the capo override and uses forbid + auto; Preview and PDF are identical; OFF shows the source', async () => {
    const doc = await openPreviewed(SOURCE);
    assert.ok(capo().setTarget(doc, 2));
    assert.ok(beginner().enable(doc));
    assert.strictEqual(capo().getState(), undefined, 'the capo override is cleared');
    assert.deepStrictEqual(beginner().getState(), { documentUri: doc.uri.toString(), barrePolicy: 'forbid' });
    const expected = beginnerMode().planBeginnerTransform(SOURCE, { barrePolicy: 'forbid' });
    assert.ok(expected.ok);
    assert.strictEqual(expected.text, FORBID_AT_0);
    assert.strictEqual(probe().previewInput, expected.text);
    assert.strictEqual(await exportPdf(doc, 'on'), probe().previewInput, 'Beginner Mode PDF input equals the preview input');
    assert.strictEqual(doc.getText(), SOURCE, 'the document is not mutated');

    beginner().disable(doc);
    assert.strictEqual(beginner().getState(), undefined);
    assert.strictEqual(capo().getState(), undefined, 'the previous capo override is not restored');
    assert.strictEqual(probe().previewInput, SOURCE);
    assert.strictEqual(await exportPdf(doc, 'off'), SOURCE, 'inactive: the existing capo behavior (source text)');

    // Repeated ON/OFF does not drift.
    for (let i = 0; i < 3; i++) {
      assert.ok(beginner().enable(doc));
      assert.strictEqual(probe().previewInput, FORBID_AT_0);
      beginner().disable(doc);
      assert.strictEqual(probe().previewInput, SOURCE);
    }
  });

  test('BEG-E2E-02 manual capo fixes the target; a policy change returns to auto', async () => {
    const doc = await openPreviewed(SOURCE);
    assert.ok(beginner().enable(doc));
    assert.ok(beginner().setTargetCapo(doc, 5));
    assert.strictEqual(beginner().getState().targetCapo, 5);
    const at5 = beginnerMode().planBeginnerTransform(SOURCE, { barrePolicy: 'forbid', targetCapo: 5 });
    assert.ok(at5.ok);
    assert.strictEqual(probe().previewInput, at5.text);
    assert.strictEqual(capo().getState(), undefined, 'the capo selector drives Beginner Mode, not the capo override');

    assert.ok(beginner().setBarrePolicy(doc, 'allow'));
    assert.deepStrictEqual(beginner().getState(), { documentUri: doc.uri.toString(), barrePolicy: 'allow' });
    const auto = beginnerMode().planBeginnerTransform(SOURCE, { barrePolicy: 'allow' });
    assert.ok(auto.ok && auto.autoCapo);
    assert.strictEqual(probe().previewInput, auto.text);
    assert.strictEqual(await exportPdf(doc, 'allow'), probe().previewInput);
    beginner().disable(doc);
  });

  test('BEG-E2E-03 source edits recompute; an unsolvable edit clears the state with a warning and no stale PDF', async () => {
    const doc = await openPreviewed(SOURCE);
    assert.ok(beginner().enable(doc));
    assert.ok(beginner().setTargetCapo(doc, 0));
    await replaceAll(doc, SOURCE.replace('| G |', '| Cmaj9 |'));
    await waitFor(() => probe().previewInput?.includes('| Fmaj7 | C | Cmaj7 | Am |') === true, 'preview follows the edited source');
    assert.strictEqual(beginner().getState().targetCapo, 0);

    const unsolvable = doc.getText().replace('| Am |', '| Bm |');
    await replaceAll(doc, unsolvable);
    await waitFor(() => probe().previewInput === unsolvable, 'the source is rendered');
    assert.strictEqual(beginner().getState(), undefined);
    assert.ok(beginner().currentNotice(), 'a warning is kept for the capo bar');
    assert.strictEqual(await exportPdf(doc, 'cleared'), unsolvable, 'no stale transformed PDF');
  });

  test('TAB-E2E-01 transform guards reset Preview overrides and keep Preview and PDF on source', async () => {
    const tabSource = [
      'title: Beginner TAB Test',
      'key: C',
      '',
      '[Intro]',
      '| C | G | Am | F |',
      'tab: | 6f0/1 | 6f2/1 | 5f0/1 | 5f2/1 |',
      ''
    ].join('\n');

    const capoDoc = await openPreviewed(SOURCE);
    assert.ok(capo().setTarget(capoDoc, 2));
    await replaceAll(capoDoc, tabSource);
    await waitFor(() => probe().previewInput === tabSource, 'TAB source is rendered after capo override reset');
    assert.strictEqual(capo().getState(), undefined);
    assert.strictEqual(capo().resolve(capoDoc).text, tabSource, 'capo failure does not return a partial rewrite');
    assert.ok(capo().resolve(capoDoc).capo.warning, 'capo reset warning is retained');
    assert.strictEqual(await exportPdf(capoDoc, 'tab-capo-reset'), tabSource, 'PDF uses the unmodified TAB source');

    const beginnerDoc = await openPreviewed(SOURCE);
    assert.ok(beginner().enable(beginnerDoc));
    await replaceAll(beginnerDoc, tabSource);
    await waitFor(() => probe().previewInput === tabSource, 'TAB source is rendered after Beginner Mode reset');
    assert.strictEqual(beginner().getState(), undefined);
    assert.ok(beginner().currentNotice(), 'Beginner Mode reset warning is retained');
    const effective = previewBeginner().resolvePreviewEffectiveDsl(beginnerDoc, beginner(), capo());
    assert.strictEqual(effective.text, tabSource, 'effective DSL never contains a partial Beginner Mode rewrite');
    assert.strictEqual(await exportPdf(beginnerDoc, 'tab-beginner-reset'), tabSource, 'PDF uses the unmodified TAB source');
  });

  test('BEG-E2E-04 switching documents, closing the document and closing the preview clear the state', async () => {
    const doc = await openPreviewed(SOURCE);
    assert.ok(beginner().enable(doc));
    const other = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: '| G |\n' });
    await showAndFocus(other, vscode.ViewColumn.One);
    await waitFor(() => beginner().getState() === undefined, 'switching documents clears Beginner Mode');
    assert.strictEqual(await exportPdf(doc, 'switched'), SOURCE);

    await showAndFocus(doc, vscode.ViewColumn.One);
    assert.ok(beginner().enable(doc));
    const previewTab = vscode.window.tabGroups.all.flatMap(g => g.tabs).find(t => t.input instanceof vscode.TabInputWebview && t.label.includes('GuitarDSL'));
    assert.ok(previewTab, 'preview tab');
    await vscode.window.tabGroups.close(previewTab!);
    await waitFor(() => beginner().getState() === undefined, 'closing the preview clears Beginner Mode');

    const closing = await openPreviewed(SOURCE);
    assert.ok(beginner().enable(closing));
    await showAndFocus(closing, vscode.ViewColumn.One);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await waitFor(() => beginner().getState() === undefined, 'closing the document clears Beginner Mode');
  });

  test('BEG-E2E-05 apply recomputes from the latest source in one WorkspaceEdit and one undo restores it', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    const edited = SOURCE.replace('| G |', '| G | F |');
    await replaceAll(doc, edited);
    const versionBefore = doc.version;
    const result = await scoreSettings().applyBeginnerTransform(doc.uri, { barrePolicy: 'forbid', targetCapo: 0 });
    assert.ok(result.ok && result.changed);
    assert.strictEqual(doc.getText(), edited.replace(/\| F \|/g, '| Fmaj7 |'), 'computed from the latest source');
    assert.strictEqual(doc.version, versionBefore + 1, 'a single edit');
    await undoIn(doc);
    assert.strictEqual(doc.getText(), edited, 'one undo restores the whole DSL');

    await replaceAll(doc, '| Bm |\n');
    const none = await scoreSettings().applyBeginnerTransform(doc.uri, { barrePolicy: 'forbid', targetCapo: 0 });
    assert.ok(!none.ok && none.code === 'noPlayableAlternative');
    assert.strictEqual(doc.getText(), '| Bm |\n', 'a failed apply does not modify the source');
  });

  test('BEG-E2E-06 the Score Settings beginner section model shows the mapping and applies its own selection', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    const section = new (scoreSettings().BeginnerSection)();
    let refreshed = 0;
    const statuses: string[] = [];
    const ctx = {
      doc,
      messages: i18n().getMessages('ja'),
      editorMessages: i18n().getScoreSettingsEditorMessages('ja'),
      refresh: () => { refreshed++; },
      status: (text: string) => { statuses.push(text); }
    };
    assert.strictEqual(section.id, 'beginner');
    const model = section.buildModel(ctx);
    assert.strictEqual(model.barrePolicy, 'forbid');
    assert.strictEqual(model.selectedCapo, null);
    assert.strictEqual(model.candidates.length, 13);
    assert.deepStrictEqual(model.mapping.find((r: any) => r.source === 'F'), { source: 'F', capoChord: 'F', target: 'Fmaj7', substituted: true });
    assert.ok(model.canApply);

    await section.onMessage(ctx, { command: 'setPolicy', policy: 'allow' });
    assert.strictEqual(section.buildModel(ctx).barrePolicy, 'allow');
    await section.onMessage(ctx, { command: 'select', capo: 0 });
    assert.strictEqual(section.buildModel(ctx).selectedCapo, 0);
    assert.strictEqual(section.buildModel(ctx).canApply, false, 'allow at capo 0 keeps the source');
    await section.onMessage(ctx, { command: 'setPolicy', policy: 'forbid' });
    assert.strictEqual(section.buildModel(ctx).selectedCapo, null, 'a policy change returns to auto');
    await section.onMessage(ctx, { command: 'select', capo: 0 });
    // The webview sends only the intent; the host applies its own selection to the latest source.
    await section.onMessage(ctx, { command: 'apply', text: 'stale webview text' });
    assert.strictEqual(doc.getText(), FORBID_AT_0);
    assert.ok(statuses.length > 0 && refreshed > 0);
    await undoIn(doc);
    assert.strictEqual(doc.getText(), SOURCE);
  });
});

suite('Advanced notation / sounding transposition (Issue #68)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const previewCapo = () => require('../../previewCapo');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const previewBeginner = () => require('../../previewBeginner');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const beginnerMode = () => require('../../beginnerMode');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const scoreSettings = () => require('../../scoreSettingsEditor');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const i18n = () => require('../../i18n');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('os');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodePath = require('path');

  const SOURCE = ['title: Transpose Test', 'capo: 0', 'key: C', '', '| C | F |', 'mel: | c5/1 | a4/1 |', ''].join('\n');

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(check: () => boolean, message: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
      if (check()) return;
      await sleep(100);
    }
    assert.fail(message);
  }
  const probe = () => previewCapo().effectiveDslProbe;
  async function replaceAll(doc: vscode.TextDocument, text: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
    assert.ok(await vscode.workspace.applyEdit(edit));
  }
  function sectionContext(doc: vscode.TextDocument, statuses: string[]) {
    return {
      doc,
      messages: i18n().getMessages('en'),
      editorMessages: i18n().getScoreSettingsEditorMessages('en'),
      refresh: () => undefined,
      status: (text: string) => { statuses.push(text); }
    };
  }
  function tmpPdf(name: string): vscode.Uri {
    return vscode.Uri.file(nodePath.join(os.tmpdir(), `guitardsl-e2e-${process.pid}-transpose-${name}.pdf`));
  }

  suiteSetup(async () => {
    const ext = vscode.extensions.all.find(e => e.packageJSON?.name === 'vscode-guitar-dsl');
    if (ext && !ext.isActive) await ext.activate();
  });

  test('TR-E2E-01 apply recomputes from the latest source, not from the previous model (T042)', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    const statuses: string[] = [];
    const ctx = sectionContext(doc, statuses);
    const section = new (scoreSettings().TransposeSection)();
    await section.onMessage(ctx, { command: 'setSemitones', semitones: 2 });
    const model = section.buildModel(ctx);
    assert.strictEqual(model.targetKey, 'D');
    assert.deepStrictEqual(model.mapping, [['C', 'D'], ['F', 'G']]);
    assert.ok(model.canApply);
    // The document changes after the model was shown; apply must use the new text.
    await replaceAll(doc, SOURCE.replace('| C | F |', '| C | F | G |').replace('| a4/1 |', '| a4/1 | b4/1 |'));
    await section.onMessage(ctx, { command: 'apply', text: 'stale webview text', model });
    assert.strictEqual(doc.getText(), ['title: Transpose Test', 'capo: 0', 'key: D', '', '| D | G | A |', 'mel: | d5/1 | b4/1 | c#5/1 |', ''].join('\n'));
    assert.ok(statuses[statuses.length - 1].includes('+2'));
    assert.strictEqual(section.buildModel(ctx).semitones, 0, 'the selection resets after apply');
  });

  test('TR-E2E-02 transpose + explicit capo is one WorkspaceEdit and one undo (T043)', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    const version = doc.version;
    const result = await scoreSettings().applyTransposeTransform(doc.uri, { semitones: 2, capoMode: { kind: 'explicit', capo: 2 } });
    assert.ok(result.ok && result.changed);
    assert.strictEqual(doc.getText(), SOURCE.replace('capo: 0', 'capo: 2').replace('key: C', 'key: D').replace('mel: | c5/1 | a4/1 |', 'mel: | d5/1 | b4/1 |'));
    assert.strictEqual(doc.version, version + 1, 'a single edit');
    await undoIn(doc);
    assert.strictEqual(doc.getText(), SOURCE, 'one undo restores the exact original');

    // A failing plan never edits the document.
    await replaceAll(doc, 'chord C@x = x32010\n| C@x |\n');
    const failed = await scoreSettings().applyTransposeTransform(doc.uri, { semitones: 1, capoMode: { kind: 'keep' } });
    assert.ok(!failed.ok && failed.code === 'labeledChordVariant');
    assert.strictEqual(doc.getText(), 'chord C@x = x32010\n| C@x |\n');
  });

  test('TR-E2E-03 Score Settings exposes Capo, Beginner and Transpose sections side by side (T044)', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc);
    await vscode.commands.executeCommand('guitardsl.editScoreSettings', doc.uri);
    const panel = (scoreSettings().ScoreSettingsEditorPanel as any).current;
    assert.ok(panel, 'panel open');
    assert.deepStrictEqual(panel.sections.map((s: any) => s.id), ['capo', 'beginner', 'transpose']);
    const ctx = sectionContext(doc, []);
    const [, beginnerSection, transposeSection] = panel.sections;
    await transposeSection.onMessage(ctx, { command: 'setSemitones', semitones: 5 });
    await transposeSection.onMessage(ctx, { command: 'setCapoMode', mode: 'recommended' });
    await beginnerSection.onMessage(ctx, { command: 'setPolicy', policy: 'allow' });
    assert.strictEqual(beginnerSection.buildModel(ctx).barrePolicy, 'allow');
    assert.strictEqual(transposeSection.buildModel(ctx).semitones, 5, 'sections keep their own state');
    assert.strictEqual(transposeSection.buildModel(ctx).capoMode, 'recommended');
    const titles = panel.sections.map((s: any) => s.title(i18n().getScoreSettingsEditorMessages('ja')));
    assert.deepStrictEqual(titles, ['カポ / 弾きやすさ', '初心者モード', '移調']);
    panel.panel.dispose();
  });

  test('TR-E2E-04 Preview / PDF re-resolve from the transposed source, including Beginner Mode (T045)', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await showAndFocus(doc, vscode.ViewColumn.One);
    probe().previewInput = undefined;
    await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri);
    await waitFor(() => probe().previewInput === doc.getText(), 'preview renders the source');

    const beginner = previewBeginner().getPreviewBeginnerController();
    assert.ok(beginner.enable(doc));
    const result = await scoreSettings().applyTransposeTransform(doc.uri, { semitones: -2, capoMode: { kind: 'keep' } });
    assert.ok(result.ok && result.changed);
    const transposed = doc.getText();
    assert.ok(transposed.includes('key: Bb') && transposed.includes('| Bb | Eb |'));
    const expected = beginnerMode().planBeginnerTransform(transposed, { barrePolicy: 'forbid' });
    const expectedInput = expected.ok ? expected.text : transposed;
    await waitFor(() => probe().previewInput === expectedInput, 'Beginner Mode re-resolves from the new source');
    const target = tmpPdf('after');
    await vscode.commands.executeCommand('guitardsl.exportPdf', doc.uri, target);
    assert.strictEqual(probe().pdfInput, probe().previewInput, 'PDF uses the same effective DSL');
    assert.ok(!probe().pdfInput.includes('key: C\n'), 'no stale pre-transform source');
    fs.unlinkSync(target.fsPath);
    beginner.disable(doc);
    await waitFor(() => probe().previewInput === transposed, 'without Beginner Mode the preview shows the source');
  });

  test('TR-E2E-06 the outline lists score events as Event symbols next to the existing symbols (T047)', async () => {
    const content = ['title: Outline', 'time: 6/8', '@tempo: 132', '| C |', '[Verse]', '@key: D  # modulate', '@mark: B', '| D |', '@time: 7/8(2+2+3)', '| D |', ''].join('\n');
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content });
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', doc.uri);
    assert.ok(symbols);
    const flat = (list: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] => list.flatMap(s => [s, ...flat(s.children)]);
    const events = flat(symbols).filter(s => s.kind === vscode.SymbolKind.Event).map(s => s.name);
    assert.deepStrictEqual(events, ['@tempo: 132', '@key: D', '@mark: B', '@time: 7/8(2+2+3)']);
    const verse = symbols.find(s => s.name === 'Verse');
    assert.ok(verse && verse.kind === vscode.SymbolKind.Namespace);
    assert.deepStrictEqual(verse.children.filter(c => c.kind === vscode.SymbolKind.Event).map(c => c.name), ['@key: D', '@mark: B', '@time: 7/8(2+2+3)']);
    const metadata = symbols.find(s => s.name === 'Metadata');
    assert.ok(metadata && metadata.children.some(c => c.name === 'time' && c.detail === '6/8'));
  });

  test('TR-E2E-05 the advanced notation sample exports to PDF (T048)', async () => {
    const sample = nodePath.join(__dirname, '../../../samples/sample_advanced_notation.guitardsl');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(sample));
    await showAndFocus(doc);
    const target = tmpPdf('advanced');
    await vscode.commands.executeCommand('guitardsl.exportPdf', doc.uri, target);
    assert.ok(fs.existsSync(target.fsPath) && fs.statSync(target.fsPath).size > 0, 'PDF written');
    assert.strictEqual(probe().pdfInput, doc.getText());
    fs.unlinkSync(target.fsPath);
    const diagnostics = vscode.languages.getDiagnostics(doc.uri).filter(d => d.severity === vscode.DiagnosticSeverity.Error);
    assert.deepStrictEqual(diagnostics, []);
  });
});

suite('AI integration: language model tools (Issue #80)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const aiTools = () => require('../../ai/tools');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const capoModule = () => require('../../capo');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const compiler = () => require('../../compiler');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const scoreSettings = () => require('../../scoreSettingsEditor');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('os');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodePath = require('path');

  const TOOL_NAMES = [
    'guitardsl_validate_dsl',
    'guitardsl_analyze_playability',
    'guitardsl_apply_capo',
    'guitardsl_apply_beginner_mode',
    'guitardsl_apply_transpose',
    'guitardsl_analyze_accompaniment',
    'guitardsl_apply_accompaniment'
  ];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const strumming = () => require('../../strummingCodeLens');
  // The deterministic capo fixture of the Capo / playability suite.
  const CAPO_SOURCE = ['title: Capo Test', 'key: B', '', '[Intro]', '| B | E | F#m7 | E/G# |', ''].join('\n');
  const CAPO_AT_2 = ['title: Capo Test', 'capo: 2', 'key: B', '', '[Intro]', '| A | D | Em7 | D/F# |', ''].join('\n');
  const BEGINNER_SOURCE = ['title: Beginner Test', 'key: C', '', '[Intro]', '| F | C | G | Am |', ''].join('\n');
  const INVALID_SOURCE = 'title: X\n| C |\nmel: C4\n';

  const tmpDir: string = fs.mkdtempSync(nodePath.join(os.tmpdir(), `guitardsl-e2e-ai-${process.pid}-`));
  const never = new vscode.CancellationTokenSource().token;
  const parse = (r: vscode.LanguageModelToolResult) => {
    assert.strictEqual(r.content.length, 1, 'one text part');
    return JSON.parse((r.content[0] as vscode.LanguageModelTextPart).value);
  };
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(check: () => boolean, message: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
      if (check()) return;
      await sleep(20);
    }
    assert.fail(message);
  }
  function writeFixture(name: string, content: string): string {
    const file = nodePath.join(tmpDir, name);
    fs.writeFileSync(file, content, 'utf8');
    return file;
  }
  async function openUntitled(content: string, show = true): Promise<vscode.TextDocument> {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content });
    if (show) await showAndFocus(doc, vscode.ViewColumn.One);
    return doc;
  }
  function makeTools(overrides: Record<string, unknown> = {}) {
    const guard = new (aiTools().MutationGuard)();
    const tools = aiTools().createGuitarDslAiTools({
      locale: 'en',
      getLastDoc: () => undefined,
      applyCapo: scoreSettings().applyCapoTransform,
      applyBeginner: scoreSettings().applyBeginnerTransform,
      applyTranspose: scoreSettings().applyTransposeTransform,
      applyAccompaniment: strumming().applyAccompanimentTransform,
      guard,
      ...overrides
    });
    return { tools, guard };
  }
  const u = (doc: vscode.TextDocument) => doc.uri.toString();
  /** Invokes without prepareInvocation (no confirmation). */
  async function invokeOnly(tool: vscode.LanguageModelTool<object>, input: object, token: vscode.CancellationToken = never) {
    return parse((await tool.invoke({ input, toolInvocationToken: undefined }, token)) as vscode.LanguageModelToolResult);
  }
  /** Like VS Code: prepareInvocation (confirmation) first, then invoke. */
  async function call(tool: vscode.LanguageModelTool<object>, input: object, token: vscode.CancellationToken = never) {
    await tool.prepareInvocation?.({ input }, never);
    return invokeOnly(tool, input, token);
  }
  const invokeRegistered = async (name: string, input: object) =>
    parse(await vscode.lm.invokeTool(name, { input, toolInvocationToken: undefined }, never));
  /** Removes the tool-only fields so a result can be compared with the apply helper's result. */
  const summaryOf = (result: Record<string, unknown>) => {
    const { schemaVersion, operation, document, postValidationPassed, postErrorCount, ...rest } = result;
    return rest;
  };

  suiteSetup(async () => {
    const ext = vscode.extensions.all.find(e => e.packageJSON?.name === 'vscode-guitar-dsl');
    if (ext && !ext.isActive) await ext.activate();
    // Editors of earlier suites (e.g. the advanced notation sample) must not be the active editor here.
    await closeAllEditors();
  });
  suiteTeardown(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  test('T012/T028 activation without any model: commands, language and the seven tools are registered', async () => {
    const ext = vscode.extensions.all.find(e => e.packageJSON?.name === 'vscode-guitar-dsl');
    assert.ok(ext?.isActive);
    const commands = await vscode.commands.getCommands(true);
    for (const c of ['guitardsl.showPreview', 'guitardsl.editCapo', 'guitardsl.openHelp', 'guitardsl.transcribeYouTube']) assert.ok(commands.includes(c), c);
    assert.ok((await vscode.languages.getLanguages()).includes('guitardsl'));
    const registered = vscode.lm.tools.map(t => t.name).filter(n => n.startsWith('guitardsl_'));
    assert.deepStrictEqual([...registered].sort(), [...TOOL_NAMES].sort());
    const doc = await openUntitled(CAPO_SOURCE);
    const diagnostics = vscode.languages.getDiagnostics(doc.uri);
    assert.strictEqual(diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length, 0, 'normal language support works');
  });

  test('T005 validate via vscode.lm.invokeTool: valid fixture, invalid fixture with 1-based location', async () => {
    const valid = await invokeRegistered('guitardsl_validate_dsl', { path: writeFixture('valid.guitardsl', CAPO_SOURCE) });
    assert.strictEqual(valid.schemaVersion, 1);
    assert.strictEqual(valid.ok, true);
    assert.strictEqual(valid.valid, true);
    assert.strictEqual(valid.errorCount, 0);

    const invalidPath = writeFixture('invalid.guitardsl', INVALID_SOURCE);
    const invalid = await invokeRegistered('guitardsl_validate_dsl', { path: invalidPath });
    assert.strictEqual(invalid.ok, true, 'parser errors are data, not a tool failure');
    assert.strictEqual(invalid.valid, false);
    assert.strictEqual(invalid.errorCount, 1);
    assert.strictEqual(invalid.document.path, invalidPath);
    assert.deepStrictEqual(invalid.diagnostics, [{ severity: 'error', code: 'upperCaseNoteName', args: { token: 'C4' }, line: 3, startColumn: 6, endColumn: 8 }]);
    assert.strictEqual(fs.readFileSync(invalidPath, 'utf8'), INVALID_SOURCE, 'no repair');

    // path omitted: the active untitled GuitarDSL document.
    const doc = await openUntitled(INVALID_SOURCE);
    const active = await invokeRegistered('guitardsl_validate_dsl', {});
    assert.strictEqual(active.document.uri, doc.uri.toString());
    assert.strictEqual(active.valid, false);
  });

  test('T006 playability via vscode.lm.invokeTool equals inferCapoForDsl exactly', async () => {
    const result = await invokeRegistered('guitardsl_analyze_playability', { path: writeFixture('capo.guitardsl', CAPO_SOURCE) });
    const expected = capoModule().inferCapoForDsl(CAPO_SOURCE);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.sourceCapo, expected.sourceCapo);
    assert.strictEqual(result.recommendedCapo, expected.recommendedCapo ?? null);
    assert.strictEqual(result.candidates.length, 13);
    assert.deepStrictEqual(result.candidates, expected.candidates.map((c: any) => ({
      capo: c.capo, supported: c.supported, score: c.playability?.score ?? null, level: c.playability?.level ?? null, reason: c.reason ?? null
    })));
    const current = expected.candidates[expected.sourceCapo].playability;
    assert.deepStrictEqual(result.currentPlayability, { score: current.score, level: current.level, unresolvedChords: current.unresolvedChords });
  });

  test('R010 read-only tools and prepareInvocation do not change the document; mutation confirmations come from the input only', async () => {
    const doc = await openUntitled(CAPO_SOURCE);
    const version = doc.version;
    const { tools } = makeTools();
    await call(tools.guitardsl_validate_dsl, {});
    await call(tools.guitardsl_analyze_playability, {});
    const prepared = await tools.guitardsl_apply_capo.prepareInvocation({ input: { uri: u(doc), targetCapo: 2 } }, never);
    assert.ok(prepared.confirmationMessages, 'mutation tools ask for confirmation');
    assert.ok(String(prepared.confirmationMessages.message).includes(doc.uri.toString(true)), String(prepared.confirmationMessages.message));
    assert.ok(String(prepared.confirmationMessages.message).includes('2'));
    const other = await openUntitled('| G |\n');
    const again = await tools.guitardsl_apply_capo.prepareInvocation({ input: { uri: u(doc), targetCapo: 2 } }, never);
    assert.deepStrictEqual(again, prepared, 'independent of the active editor and of earlier calls');
    const preparedPath = await tools.guitardsl_apply_transpose.prepareInvocation({ input: { path: '/x/song.guitardsl', semitones: 2, capoMode: 'keep' } }, never);
    assert.ok(String(preparedPath.confirmationMessages.message).includes(vscode.Uri.file('/x/song.guitardsl').fsPath));
    const noTarget = await tools.guitardsl_apply_capo.prepareInvocation({ input: { targetCapo: 2 } }, never);
    assert.strictEqual(noTarget.confirmationMessages, undefined, 'invalid input (no target) has nothing to confirm');
    assert.strictEqual(doc.version, version);
    assert.strictEqual(doc.getText(), CAPO_SOURCE);
    assert.strictEqual(other.getText(), '| G |\n');
  });

  test('T007 apply capo: one change, expected transform, post-validation; unsupported input makes no edit', async () => {
    const doc = await openUntitled(CAPO_SOURCE);
    const version = doc.version;
    const { tools } = makeTools();
    const result = await call(tools.guitardsl_apply_capo, { uri: u(doc), targetCapo: 2 });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.operation, 'applyCapo');
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.targetCapo, 2);
    assert.strictEqual(result.postValidationPassed, true);
    assert.strictEqual(result.text, undefined, 'the transformed DSL is not returned');
    assert.strictEqual(doc.getText(), CAPO_AT_2);
    assert.strictEqual(doc.version, version + 1, 'exactly one document change');
    await undoIn(doc);
    assert.strictEqual(doc.getText(), CAPO_SOURCE, 'one undo restores the source');

    for (const targetCapo of [13, -1, 2.5]) {
      const bad = await call(tools.guitardsl_apply_capo, { uri: u(doc), targetCapo });
      assert.strictEqual(bad.ok, false);
      assert.strictEqual(bad.code, 'invalidInput');
    }
    for (const input of [{ targetCapo: 2 }, { uri: u(doc), path: '/x/a.guitardsl', targetCapo: 2 }, { uri: 'Untitled-1', targetCapo: 2 }]) {
      assert.strictEqual((await call(tools.guitardsl_apply_capo, input)).code, 'invalidInput', JSON.stringify(input));
    }
    assert.strictEqual(doc.getText(), CAPO_SOURCE, 'no target means no edit (never the active editor)');
    const broken = await openUntitled(INVALID_SOURCE);
    const failed = await call(tools.guitardsl_apply_capo, { uri: u(broken), targetCapo: 2 });
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(failed.code, 'sourceParseError', 'existing failure code');
    assert.strictEqual(broken.getText(), INVALID_SOURCE);
    assert.strictEqual(doc.getText(), CAPO_SOURCE);

    const missing = await call(tools.guitardsl_apply_capo, { targetCapo: 2, path: writeFixture('notes.txt', 'hello') });
    assert.strictEqual(missing.code, 'documentNotFound');
    const unknownUntitled = 'untitled:NoSuchDocument-999';
    assert.strictEqual((await call(tools.guitardsl_apply_capo, { uri: unknownUntitled, targetCapo: 2 })).code, 'documentNotFound');
    assert.ok(!vscode.workspace.textDocuments.some(d => d.uri.toString() === vscode.Uri.parse(unknownUntitled).toString()), 'no untitled document is created');
  });

  test('T008 Beginner Mode matches applyBeginnerTransform for allow and forbid (auto capo); failure leaves the source unchanged', async () => {
    const { tools } = makeTools();
    for (const barrePolicy of ['allow', 'forbid']) {
      const twin = await openUntitled(BEGINNER_SOURCE, false);
      const expected = await scoreSettings().applyBeginnerTransform(twin.uri, { barrePolicy });
      const doc = await openUntitled(BEGINNER_SOURCE);
      const result = await call(tools.guitardsl_apply_beginner_mode, { uri: u(doc), barrePolicy });
      assert.strictEqual(result.ok, true, barrePolicy);
      assert.strictEqual(result.operation, 'applyBeginnerMode');
      const { ok, ...expectedSummary } = expected;
      assert.deepStrictEqual(summaryOf(result), { ok: true, ...expectedSummary });
      assert.strictEqual(doc.getText(), twin.getText());
      assert.strictEqual(result.postValidationPassed, true);
    }
    const explicitTwin = await openUntitled(BEGINNER_SOURCE, false);
    const explicitExpected = await scoreSettings().applyBeginnerTransform(explicitTwin.uri, { barrePolicy: 'allow', targetCapo: 0 });
    const explicitDoc = await openUntitled(BEGINNER_SOURCE);
    await call(tools.guitardsl_apply_beginner_mode, { uri: u(explicitDoc), barrePolicy: 'allow', targetCapo: 0 });
    assert.strictEqual(explicitDoc.getText(), explicitTwin.getText());
    assert.ok(explicitExpected.ok);

    const broken = await openUntitled(INVALID_SOURCE);
    const failed = await call(tools.guitardsl_apply_beginner_mode, { uri: u(broken), barrePolicy: 'allow' });
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(broken.getText(), INVALID_SOURCE);
  });

  test('T009 transpose keep / recommended / explicit match applyTransposeTransform; explicit without capo fails before mutation', async () => {
    const { tools } = makeTools();
    const modes: [object, any][] = [
      [{ semitones: 2, capoMode: 'keep' }, { kind: 'keep' }],
      [{ semitones: -3, capoMode: 'recommended' }, { kind: 'recommended' }],
      [{ semitones: 5, capoMode: 'explicit', capo: 3 }, { kind: 'explicit', capo: 3 }]
    ];
    for (const [input, capoMode] of modes) {
      const twin = await openUntitled(CAPO_SOURCE, false);
      const expected = await scoreSettings().applyTransposeTransform(twin.uri, { semitones: (input as any).semitones, capoMode });
      const doc = await openUntitled(CAPO_SOURCE);
      const result = await call(tools.guitardsl_apply_transpose, { uri: u(doc), ...input });
      assert.strictEqual(result.ok, expected.ok, JSON.stringify(input));
      const { ok, ...expectedSummary } = expected;
      assert.deepStrictEqual(summaryOf(result), { ok: expected.ok, ...expectedSummary });
      assert.strictEqual(doc.getText(), twin.getText());
      assert.strictEqual(result.postValidationPassed, true);
      assert.strictEqual(compiler().parseGuitarDsl(doc.getText()).diagnostics.filter((d: any) => d.severity === 'error').length, 0);
    }
    const doc = await openUntitled(CAPO_SOURCE);
    const version = doc.version;
    for (const input of [{ semitones: 2, capoMode: 'explicit' }, { semitones: 2, capoMode: 'explicit', capo: 13 }, { semitones: 12, capoMode: 'keep' }]) {
      const bad = await call(tools.guitardsl_apply_transpose, { uri: u(doc), ...input });
      assert.strictEqual(bad.code, 'invalidInput', JSON.stringify(input));
    }
    assert.strictEqual(doc.version, version);
  });

  test('T010 concurrent mutation on the same document fails fast with documentBusy; the guard is always released', async () => {
    const doc = await openUntitled(CAPO_SOURCE);
    const key = doc.uri.toString();
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    let applyCalls = 0;
    const { tools, guard } = makeTools({
      applyCapo: async (uri: vscode.Uri, capo: number) => {
        applyCalls++;
        await gate;
        return scoreSettings().applyCapoTransform(uri, capo);
      }
    });
    const first = call(tools.guitardsl_apply_capo, { uri: key, targetCapo: 2 });
    await waitFor(() => guard.isHeld(key), 'the first call should own the guard');
    const second = await call(tools.guitardsl_apply_beginner_mode, { uri: key, barrePolicy: 'allow' });
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.code, 'documentBusy');
    assert.strictEqual(doc.getText(), CAPO_SOURCE, 'the busy call does not edit');
    const readOnly = await call(tools.guitardsl_validate_dsl, {});
    assert.strictEqual(readOnly.ok, true, 'read-only tools still run');
    release();
    assert.strictEqual((await first).ok, true);
    assert.strictEqual(applyCalls, 1);
    assert.strictEqual(guard.isHeld(key), false, 'released after success');

    const failing = makeTools({ applyCapo: async () => ({ ok: false, code: 'untransposableChord' }) });
    assert.strictEqual((await call(failing.tools.guitardsl_apply_capo, { uri: key, targetCapo: 3 })).code, 'untransposableChord');
    assert.strictEqual(failing.guard.isHeld(key), false, 'released after failure');

    const throwing = makeTools({ applyCapo: async () => { throw new Error('boom'); } });
    await assert.rejects(() => call(throwing.tools.guitardsl_apply_capo, { uri: key, targetCapo: 3 }), /boom/);
    assert.strictEqual(throwing.guard.isHeld(key), false, 'released after an exception');
  });

  test('T011 cancellation before mutation makes no edit and leaves no background work', async () => {
    const doc = await openUntitled(CAPO_SOURCE);
    let applyCalls = 0;
    const { tools, guard } = makeTools({ applyCapo: async () => { applyCalls++; return { ok: true, changed: false }; } });
    const source = new vscode.CancellationTokenSource();
    source.cancel();
    assert.strictEqual((await call(tools.guitardsl_apply_capo, { uri: u(doc), targetCapo: 2 }, source.token)).code, 'cancelled');

    // Cancelled after resolution, immediately before the mutation.
    let checks = 0;
    const lateToken = { get isCancellationRequested() { return ++checks > 1; }, onCancellationRequested: source.token.onCancellationRequested } as vscode.CancellationToken;
    assert.strictEqual((await call(tools.guitardsl_apply_capo, { uri: u(doc), targetCapo: 2 }, lateToken)).code, 'cancelled');
    assert.strictEqual(guard.isHeld(doc.uri.toString()), false);
    await sleep(200);
    assert.strictEqual(applyCalls, 0);
    assert.strictEqual(doc.getText(), CAPO_SOURCE);
  });

  test('B-1 the edited document is exactly the one the input names, even if the active editor changes after confirmation', async () => {
    const { tools } = makeTools();
    const docA = await openUntitled(CAPO_SOURCE);
    const input = { uri: u(docA), targetCapo: 2 };
    const prepared = await tools.guitardsl_apply_capo.prepareInvocation({ input }, never);
    assert.ok(String(prepared.confirmationMessages.message).includes(docA.uri.toString(true)));
    const docB = await openUntitled(CAPO_SOURCE);
    assert.strictEqual(vscode.window.activeTextEditor?.document, docB, 'the active editor changed after confirmation');
    const result = await invokeOnly(tools.guitardsl_apply_capo, input);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.document.uri, u(docA));
    assert.strictEqual(docA.getText(), CAPO_AT_2, 'the confirmed document is edited');
    assert.strictEqual(docB.getText(), CAPO_SOURCE, 'the active document is not');

    // prepareInvocation is not required before invoke (VS Code does not guarantee the pairing either way).
    const file = writeFixture('explicit.guitardsl', CAPO_SOURCE);
    const explicit = await invokeOnly(tools.guitardsl_apply_capo, { targetCapo: 2, path: file });
    assert.strictEqual(explicit.ok, true);
    assert.strictEqual((await vscode.workspace.openTextDocument(vscode.Uri.file(file))).getText(), CAPO_AT_2);
    assert.strictEqual(docB.getText(), CAPO_SOURCE);
  });

  test('B-1 read-only result document.uri targets an untitled document through vscode.lm.invokeTool', async () => {
    const doc = await openUntitled(CAPO_SOURCE);
    const validated = await invokeRegistered('guitardsl_validate_dsl', {});
    assert.strictEqual(validated.document.uri, u(doc));
    const outcome = await Promise.race([
      invokeRegistered('guitardsl_apply_capo', { uri: validated.document.uri, targetCapo: 2 }),
      sleep(5000).then(() => 'timeout')
    ]);
    assert.notStrictEqual(outcome, 'timeout', 'invokeTool should not wait for interactive confirmation outside a chat request');
    const result = outcome as any;
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(doc.getText(), CAPO_AT_2);
  });

  const SONG = ['title: Song', '', '[Verse]', '| C | 4.d 4.d 4.d 4.d | G | 4.d 4.d 4.d 4.d |', '[Chorus]', '| F | 4.d 4.d 4.d 4.d | C | 4.d 4.d 4.d 4.d |]', ''].join('\n');
  const intentPlan = (sectionIndex: number, patch: object = {}) => ({
    sectionIndex, mode: 'intent', style: 'strum', subdivision: 'auto', energy: 'medium', density: 'medium', syncopation: 'none', emphasis: 'none', operation: 'replace', ...patch
  });

  test('T027A analyze accompaniment through vscode.lm.invokeTool: structure, then one family', async () => {
    const file = writeFixture('accompaniment.guitardsl', SONG);
    const structure = await invokeRegistered('guitardsl_analyze_accompaniment', { path: file });
    assert.strictEqual(structure.schemaVersion, 1);
    assert.strictEqual(structure.ok, true);
    assert.strictEqual(structure.document.path, file);
    assert.deepStrictEqual(structure.sections.map((s: any) => [s.sectionIndex, s.name]), [[0, 'Verse'], [1, 'Chorus']]);
    assert.ok(structure.sections[0].availableFamilies.includes('eighth'));
    assert.strictEqual(structure.sections[0].availablePresets, undefined);
    const family = await invokeRegistered('guitardsl_analyze_accompaniment', { path: file, sectionIndex: 1, family: 'shuffle' });
    assert.deepStrictEqual(family.selectedSection.availablePresets.map((p: any) => p.id), ['blues_4_4_shuffle_basic', 'bluesrock_4_4_shuffle_backbeat', 'blues_4_4_shuffle_all_down']);
    assert.strictEqual((await invokeRegistered('guitardsl_analyze_accompaniment', { path: file, family: 'shuffle' })).code, 'invalidInput');
    assert.strictEqual((await invokeRegistered('guitardsl_analyze_accompaniment', { path: file, sectionIndex: 7 })).code, 'sectionNotFound');
  });

  test('T031/T032 apply accompaniment: several sections in one WorkspaceEdit, one undo, compact result with post-validation', async () => {
    const doc = await openUntitled(SONG);
    const version = doc.version;
    const { tools } = makeTools();
    const result = await call(tools.guitardsl_apply_accompaniment, {
      uri: u(doc),
      plans: [intentPlan(0, { energy: 'low', density: 'sparse', style: 'sustain' }), intentPlan(1, { energy: 'high', density: 'dense', emphasis: 'backbeat' })]
    });
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(result.operation, 'applyAccompaniment');
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(result.appliedSections.map((s: any) => s.selectedPresetId), ['sustain_4_4_whole', 'rock_4_4_eighth_backbeat']);
    assert.strictEqual(result.postValidationPassed, true);
    assert.strictEqual(result.postErrorCount, 0);
    assert.strictEqual(result.text, undefined, 'the DSL is not returned');
    assert.strictEqual(doc.version, version + 1, 'one document change');
    assert.ok(doc.getText().includes('| C | 1.d | G | 1.d |'));
    assert.ok(doc.getText().includes('| F | 8.d 8.u 8.d.a 8.u 8.d 8.u 8.d.a 8.u |'));
    await undoIn(doc);
    assert.strictEqual(doc.getText(), SONG, 'one undo restores every section');
  });

  const NEW_SONG_DRAFT = ['title: New Song', 'time: 4/4', '', '[Verse]', '| C | G |', 'mel: | c4/2 d4/2 | e4/1 |', 'lyr: la la la', '', '[Chorus]', '| F | C |', 'mel: | f4/2 e4/2 | c4/1 |', 'lyr: la la la', ''].join('\n');
  const newSongPlans = [
    intentPlan(0, { energy: 'low', density: 'sparse', arrangementGroup: 'verse' }),
    intentPlan(1, { energy: 'high', density: 'dense', emphasis: 'backbeat', arrangementGroup: 'chorus' })
  ];
  const strokes = /\b\d+\.[du]\b/;

  // Tool mechanics only: this test starts after the new target already exists (an active untitled document).
  // It does not prove Agent target selection; the model's new-target policy is covered by the AI asset gate.
  test('#104 new score mechanics (target already established): structural draft -> validate -> analyze -> one apply -> validate; one undo restores the draft', async () => {
    const DRAFT = NEW_SONG_DRAFT;
    const doc = await openUntitled(DRAFT);
    assert.ok(!strokes.test(doc.getText()), 'the draft has no explicit accompaniment rhythm');

    const first = await invokeRegistered('guitardsl_validate_dsl', {});
    assert.strictEqual(first.document.uri, u(doc));
    assert.strictEqual(first.valid, true, JSON.stringify(first));
    assert.strictEqual(first.errorCount, 0);
    assert.strictEqual(first.warningCount, 0);

    const analysis = await invokeRegistered('guitardsl_analyze_accompaniment', {});
    assert.strictEqual(analysis.ok, true, JSON.stringify(analysis));
    assert.strictEqual(analysis.document.uri, u(doc));
    assert.deepStrictEqual(analysis.sections.map((s: any) => [s.sectionIndex, s.name]), [[0, 'Verse'], [1, 'Chorus']]);

    const version = doc.version;
    const outcome = await Promise.race([
      invokeRegistered('guitardsl_apply_accompaniment', {
        uri: first.document.uri,
        plans: newSongPlans
      }),
      sleep(5000).then(() => 'timeout')
    ]);
    assert.notStrictEqual(outcome, 'timeout');
    const applied = outcome as any;
    assert.strictEqual(applied.ok, true, JSON.stringify(applied));
    assert.deepStrictEqual(applied.appliedSections.map((s: any) => s.selectedPresetId), ['strum_4_4_quarter_basic', 'rock_4_4_eighth_backbeat']);
    assert.strictEqual(applied.postValidationPassed, true);
    assert.strictEqual(doc.version, version + 1, 'one document change');
    assert.ok(strokes.test(doc.getText()), 'engine-generated rhythm appears only after apply');
    assert.ok(doc.getText().includes('| F 8.d 8.u 8.d.a 8.u 8.d 8.u 8.d.a 8.u |'));
    assert.ok(doc.getText().includes('mel: | c4/2 d4/2 | e4/1 |') && doc.getText().includes('lyr: la la la'), 'melody and lyrics are kept');

    const last = await invokeRegistered('guitardsl_validate_dsl', {});
    assert.strictEqual(last.errorCount, 0, JSON.stringify(last));

    await undoIn(doc);
    assert.strictEqual(doc.getText(), DRAFT, 'one undo restores the exact structural draft');
  });

  // Mechanical target-pinning regression (not a substitute for the Agent policy): with an existing score A active,
  // every new-score step on a distinct new document B by explicit path edits only B.
  test('#104 new-target pinning: validate/analyze/apply/validate by path edit only the new document; the open existing score is byte-for-byte unchanged', async () => {
    const existingText = SONG;
    const existingPath = writeFixture('existing-song.guitardsl', existingText);
    const existing = await vscode.workspace.openTextDocument(vscode.Uri.file(existingPath));
    await showAndFocus(existing, vscode.ViewColumn.One);
    const newPath = writeFixture('new-song.guitardsl', NEW_SONG_DRAFT);
    assert.notStrictEqual(newPath, existingPath);
    assert.strictEqual(vscode.window.activeTextEditor?.document, existing, 'the existing score is the active editor throughout');

    const first = await invokeRegistered('guitardsl_validate_dsl', { path: newPath });
    assert.deepStrictEqual([first.document.path, first.errorCount], [newPath, 0], JSON.stringify(first));
    const analysis = await invokeRegistered('guitardsl_analyze_accompaniment', { path: newPath });
    assert.strictEqual(analysis.document.path, newPath);
    assert.deepStrictEqual(analysis.sections.map((s: any) => s.name), ['Verse', 'Chorus']);
    const outcome = await Promise.race([invokeRegistered('guitardsl_apply_accompaniment', { path: newPath, plans: newSongPlans }), sleep(5000).then(() => 'timeout')]);
    assert.notStrictEqual(outcome, 'timeout');
    const applied = outcome as any;
    assert.strictEqual(applied.ok, true, JSON.stringify(applied));
    assert.strictEqual(applied.document.path, newPath);
    const last = await invokeRegistered('guitardsl_validate_dsl', { path: newPath });
    assert.deepStrictEqual([last.document.path, last.errorCount], [newPath, 0]);

    const created = await vscode.workspace.openTextDocument(vscode.Uri.file(newPath));
    assert.ok(strokes.test(created.getText()), 'only the new document received accompaniment');
    assert.strictEqual(existing.getText(), existingText, 'the open existing score is unchanged');
    assert.strictEqual(existing.isDirty, false);
    assert.strictEqual(fs.readFileSync(existingPath, 'utf8'), existingText, 'the existing file on disk is byte-for-byte unchanged');
    assert.strictEqual(vscode.window.activeTextEditor?.document, existing);
  });

  test('T029/T030 accompaniment failures edit nothing; the target is the named document; guard and cancellation hold', async () => {
    const doc = await openUntitled(SONG);
    const { tools } = makeTools();
    const bad = await call(tools.guitardsl_apply_accompaniment, { uri: u(doc), plans: [{ sectionIndex: 0, mode: 'preset', presetId: 'waltz_3_4_eighth_flow' }] });
    assert.deepStrictEqual([bad.ok, bad.code], [false, 'invalidPresetForContext']);
    const noTarget = await call(tools.guitardsl_apply_accompaniment, { plans: [intentPlan(0)] });
    assert.strictEqual(noTarget.code, 'invalidInput', 'never the active editor');
    const partial = await call(tools.guitardsl_apply_accompaniment, { uri: u(doc), plans: [intentPlan(0), { sectionIndex: 1, mode: 'dsl', style: 'strum', pattern: '8.d 8.d 8.u 8.u 8.d 8.u 8.d 8.u' }] });
    assert.strictEqual(partial.code, 'unnaturalStrokeDirection', 'one failing plan fails the whole request');
    assert.strictEqual(doc.getText(), SONG);

    const input = { uri: u(doc), plans: [{ sectionIndex: 0, mode: 'preset', presetId: 'arp_4_4_eighth' }] };
    const prepared = await tools.guitardsl_apply_accompaniment.prepareInvocation({ input }, never);
    assert.ok(String(prepared.confirmationMessages.message).includes(doc.uri.toString(true)));
    const other = await openUntitled(SONG);
    assert.strictEqual(vscode.window.activeTextEditor?.document, other);
    assert.strictEqual((await invokeOnly(tools.guitardsl_apply_accompaniment, input)).ok, true);
    assert.ok(doc.getText().includes('| C | 8 8 8 8 8 8 8 8 |'));
    assert.strictEqual(other.getText(), SONG, 'the active editor is not edited');

    const key = u(other);
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    const slow = makeTools({ applyAccompaniment: async (uri: vscode.Uri, request: object) => { await gate; return strumming().applyAccompanimentTransform(uri, request); } });
    const first = call(slow.tools.guitardsl_apply_accompaniment, { uri: key, plans: [intentPlan(0)] });
    await waitFor(() => slow.guard.isHeld(key), 'the first call should own the guard');
    assert.strictEqual((await call(slow.tools.guitardsl_apply_capo, { uri: key, targetCapo: 2 })).code, 'documentBusy');
    release();
    assert.strictEqual((await first).ok, true);
    assert.strictEqual(slow.guard.isHeld(key), false);

    const source = new vscode.CancellationTokenSource();
    source.cancel();
    const before = other.getText();
    assert.strictEqual((await call(tools.guitardsl_apply_accompaniment, { uri: key, plans: [intentPlan(1, { style: 'arpeggio' })] }, source.token)).code, 'cancelled');
    assert.strictEqual(other.getText(), before);
  });

  test('T027 manual QuickPick: meter categories, usage-group separators, no flat 58-item list', async () => {
    const doc = await openUntitled(SONG);
    const window = vscode.window as unknown as { showQuickPick: unknown; showInformationMessage: unknown };
    const original = { pick: window.showQuickPick, info: window.showInformationMessage };
    const shown: vscode.QuickPickItem[][] = [];
    const messages: string[] = [];
    try {
      window.showQuickPick = async (items: vscode.QuickPickItem[]) => {
        shown.push(items);
        if (shown.length === 1) return items.find(i => i.label.includes('16'));
        return items.find(i => (i as any).preset?.id === 'jpop_4_4_sixteenth_bright_drive');
      };
      window.showInformationMessage = async (message: string) => {
        messages.push(message);
        return undefined;
      };
      await strumming().promptAndApplyStrummingPattern(doc, 1, 'en');
    } finally {
      window.showQuickPick = original.pick;
      window.showInformationMessage = original.info;
    }
    assert.strictEqual(shown.length, 2);
    const categories = shown[0].map(i => i.label);
    assert.ok(categories.every(l => l.startsWith('4/4') || l.includes('Close to the current')), categories.join(', '));
    assert.ok(categories.length <= 10);
    const patterns = shown[1];
    assert.ok(patterns.some(i => i.kind === vscode.QuickPickItemKind.Separator && i.label === 'Pop / J-POP'));
    assert.ok(patterns.filter(i => (i as any).preset).every(i => (i as any).preset.family === 'sixteenth'));
    assert.ok(patterns.length < 58);
    assert.ok(doc.getText().includes('| F | 8.d 8.d 16.d 16.u 16.d 16.u 8.d 8.d 16.d 16.u 16.d 16.u |'));
    assert.ok(doc.getText().includes('| C | 4.d 4.d 4.d 4.d | G | 4.d 4.d 4.d 4.d |'), 'the verse is untouched');
    assert.ok(messages.some(m => m.includes('J-POP 16th Bright Drive')));
  });

  test('R-CL same-name sections: the CodeLens identity targets only its section; a stale identity changes nothing', async () => {
    const source = ['[Chorus]', '| C | 4.d 4.d 4.d 4.d |', '', '[Verse]', '| G | 4.d 4.d 4.d 4.d |', '', '[Chorus]', '| F | 4.d 4.d 4.d 4.d |', ''].join('\n');
    const doc = await openUntitled(source);
    const lenses = new (strumming().StrummingCodeLensProvider)('en').provideCodeLenses(doc) as vscode.CodeLens[];
    const targets = lenses.map(l => l.command?.arguments?.[1]);
    assert.deepStrictEqual(targets, [
      { sectionIndex: 0, sectionName: 'Chorus', labelLine: 0 },
      { sectionIndex: 1, sectionName: 'Verse', labelLine: 3 },
      { sectionIndex: 2, sectionName: 'Chorus', labelLine: 6 }
    ]);
    const window = vscode.window as unknown as { showQuickPick: unknown; showInformationMessage: unknown; showWarningMessage: unknown };
    const original = { pick: window.showQuickPick, info: window.showInformationMessage, warn: window.showWarningMessage };
    const warnings: string[] = [];
    let picks = 0;
    try {
      window.showQuickPick = async (items: vscode.QuickPickItem[]) => {
        picks++;
        return picks % 2 === 1 ? items.find(i => i.label.includes('8-beat')) : items.find(i => (i as any).preset?.id === 'rock_4_4_eighth_full');
      };
      window.showInformationMessage = async () => undefined;
      window.showWarningMessage = async (message: string) => {
        warnings.push(message);
        return undefined;
      };
      await vscode.commands.executeCommand('guitardsl.applyStrummingPattern', doc.uri, targets[2]);
      const lines = doc.getText().split('\n');
      assert.strictEqual(lines[1], '| C | 4.d 4.d 4.d 4.d |', 'the first Chorus is untouched');
      assert.strictEqual(lines[7], '| F | 8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u |', 'the second Chorus changes');
      const after = doc.getText();
      // Stale identities: a moved label line, and an index now pointing at another section. No fallback to the first Chorus.
      for (const stale of [{ sectionIndex: 2, sectionName: 'Chorus', labelLine: 5 }, { sectionIndex: 1, sectionName: 'Chorus', labelLine: 6 }]) {
        await vscode.commands.executeCommand('guitardsl.applyStrummingPattern', doc.uri, stale);
        assert.strictEqual(doc.getText(), after, JSON.stringify(stale));
      }
      assert.deepStrictEqual(warnings, ['The section has changed. Refresh the CodeLens and try again.', 'The section has changed. Refresh the CodeLens and try again.']);
      assert.strictEqual(picks, 2, 'a stale identity opens no picker');
    } finally {
      window.showQuickPick = original.pick;
      window.showInformationMessage = original.info;
      window.showWarningMessage = original.warn;
    }
  });

  test('R012 repeated calls recompute from the latest source', async () => {
    const doc = await openUntitled('| B |\n');
    const { tools } = makeTools();
    assert.strictEqual((await call(tools.guitardsl_apply_capo, { uri: u(doc), targetCapo: 2 })).changed, true);
    assert.strictEqual(doc.getText(), 'capo: 2\n| A |\n');
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, doc.positionAt(doc.getText().length), '| E |\n');
    assert.ok(await vscode.workspace.applyEdit(edit));
    const again = await call(tools.guitardsl_apply_capo, { uri: u(doc), targetCapo: 2 });
    assert.strictEqual(again.ok, true);
    assert.strictEqual(again.changed, false, 'same capo again is a no-op decided by the existing helper');
    const latest = doc.getText();
    assert.strictEqual((await call(tools.guitardsl_apply_capo, { uri: u(doc), targetCapo: 0 })).changed, true);
    assert.strictEqual(doc.getText(), capoModule().planCapoTransform(latest, 0).text, 'the edit made in between is transformed too');
  });
});
