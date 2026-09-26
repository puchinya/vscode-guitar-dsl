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
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
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
    await vscode.window.showTextDocument(doc);
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
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand('guitardsl.editCapo', doc.uri);
    await replaceAll(doc, '| B | E |\n');
    const result = await scoreSettings().applyCapoTransform(doc.uri, 2);
    assert.ok(result.ok && result.changed);
    assert.strictEqual(doc.getText(), 'capo: 2\n| A | D |\n');
  });

  test('EDITOR-02 a single undo restores the previous DSL', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await vscode.window.showTextDocument(doc);
    const result = await scoreSettings().applyCapoTransform(doc.uri, 2);
    assert.ok(result.ok);
    assert.strictEqual(doc.getText(), AT_CAPO_2);
    await vscode.commands.executeCommand('undo');
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
    await vscode.window.showTextDocument(other, vscode.ViewColumn.One);
    await waitFor(() => controller.getState() === undefined, 'switching documents resets the override');

    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    assert.ok(controller.setTarget(doc, 3));
    const previewTab = vscode.window.tabGroups.all.flatMap(g => g.tabs).find(t => t.input instanceof vscode.TabInputWebview && t.label.includes('GuitarDSL'));
    assert.ok(previewTab, 'preview tab');
    await vscode.window.tabGroups.close(previewTab!);
    await waitFor(() => controller.getState() === undefined, 'closing the preview resets the override');
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
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
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

  test('BEG-E2E-04 switching documents, closing the document and closing the preview clear the state', async () => {
    const doc = await openPreviewed(SOURCE);
    assert.ok(beginner().enable(doc));
    const other = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: '| G |\n' });
    await vscode.window.showTextDocument(other, vscode.ViewColumn.One);
    await waitFor(() => beginner().getState() === undefined, 'switching documents clears Beginner Mode');
    assert.strictEqual(await exportPdf(doc, 'switched'), SOURCE);

    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    assert.ok(beginner().enable(doc));
    const previewTab = vscode.window.tabGroups.all.flatMap(g => g.tabs).find(t => t.input instanceof vscode.TabInputWebview && t.label.includes('GuitarDSL'));
    assert.ok(previewTab, 'preview tab');
    await vscode.window.tabGroups.close(previewTab!);
    await waitFor(() => beginner().getState() === undefined, 'closing the preview clears Beginner Mode');

    const closing = await openPreviewed(SOURCE);
    assert.ok(beginner().enable(closing));
    await vscode.window.showTextDocument(closing, vscode.ViewColumn.One);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await waitFor(() => beginner().getState() === undefined, 'closing the document clears Beginner Mode');
  });

  test('BEG-E2E-05 apply recomputes from the latest source in one WorkspaceEdit and one undo restores it', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await vscode.window.showTextDocument(doc);
    const edited = SOURCE.replace('| G |', '| G | F |');
    await replaceAll(doc, edited);
    const versionBefore = doc.version;
    const result = await scoreSettings().applyBeginnerTransform(doc.uri, { barrePolicy: 'forbid', targetCapo: 0 });
    assert.ok(result.ok && result.changed);
    assert.strictEqual(doc.getText(), edited.replace(/\| F \|/g, '| Fmaj7 |'), 'computed from the latest source');
    assert.strictEqual(doc.version, versionBefore + 1, 'a single edit');
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand('undo');
    assert.strictEqual(doc.getText(), edited, 'one undo restores the whole DSL');

    await replaceAll(doc, '| Bm |\n');
    const none = await scoreSettings().applyBeginnerTransform(doc.uri, { barrePolicy: 'forbid', targetCapo: 0 });
    assert.ok(!none.ok && none.code === 'noPlayableAlternative');
    assert.strictEqual(doc.getText(), '| Bm |\n', 'a failed apply does not modify the source');
  });

  test('BEG-E2E-06 the Score Settings beginner section model shows the mapping and applies its own selection', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await vscode.window.showTextDocument(doc);
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
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand('undo');
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
    await vscode.window.showTextDocument(doc);
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
    await vscode.window.showTextDocument(doc);
    const version = doc.version;
    const result = await scoreSettings().applyTransposeTransform(doc.uri, { semitones: 2, capoMode: { kind: 'explicit', capo: 2 } });
    assert.ok(result.ok && result.changed);
    assert.strictEqual(doc.getText(), SOURCE.replace('capo: 0', 'capo: 2').replace('key: C', 'key: D').replace('mel: | c5/1 | a4/1 |', 'mel: | d5/1 | b4/1 |'));
    assert.strictEqual(doc.version, version + 1, 'a single edit');
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand('undo');
    assert.strictEqual(doc.getText(), SOURCE, 'one undo restores the exact original');

    // A failing plan never edits the document.
    await replaceAll(doc, 'chord C@x = x32010\n| C@x |\n');
    const failed = await scoreSettings().applyTransposeTransform(doc.uri, { semitones: 1, capoMode: { kind: 'keep' } });
    assert.ok(!failed.ok && failed.code === 'labeledChordVariant');
    assert.strictEqual(doc.getText(), 'chord C@x = x32010\n| C@x |\n');
  });

  test('TR-E2E-03 Score Settings exposes Capo, Beginner and Transpose sections side by side (T044)', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: SOURCE });
    await vscode.window.showTextDocument(doc);
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
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
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
    await vscode.window.showTextDocument(doc);
    const target = tmpPdf('advanced');
    await vscode.commands.executeCommand('guitardsl.exportPdf', doc.uri, target);
    assert.ok(fs.existsSync(target.fsPath) && fs.statSync(target.fsPath).size > 0, 'PDF written');
    assert.strictEqual(probe().pdfInput, doc.getText());
    fs.unlinkSync(target.fsPath);
    const diagnostics = vscode.languages.getDiagnostics(doc.uri).filter(d => d.severity === vscode.DiagnosticSeverity.Error);
    assert.deepStrictEqual(diagnostics, []);
  });
});
