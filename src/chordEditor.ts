// Chord diagram editor panel (webview) and its entry points: command, CodeLens, preview click.

import * as vscode from 'vscode';
import { STRING_COUNT, chordKey, formatFrets, isChordDefinitionLine, isValidChordLabel, isValidChordName, parseChordDefinition, splitChordKey } from './chordDefinition';
import { NOTE_NAMES, detectChordNames, parseChordName } from './chordDetect';
import { ChordEditorState, buildChordLine, createEditorSession, planChordSave, stateFromVoicing } from './chordEditorModel';
import { PRESET_QUALITIES, PRESET_ROOTS, getPresetVoicings } from './chordPresets';
import { parseGuitarDsl } from './compiler';
import { ChordEditorMessages, SupportedLocale, formatChordDefinitionError, getChordEditorMessages } from './i18n';
import { DIAGRAM_FINGER_UNIT_HEIGHT, DIAGRAM_UNIT_HEIGHT, DIAGRAM_UNIT_WIDTH, renderChordDiagramSvg } from './render/chordDiagram';
import { renderChordEditorHtml } from './render/chordEditorHtml';

export const EDIT_CHORD_COMMAND = 'guitardsl.editChordDiagram';

function diagramSvg(voicing: Parameters<typeof renderChordDiagramSvg>[0], scale: number): string {
  const h = DIAGRAM_UNIT_HEIGHT + DIAGRAM_FINGER_UNIT_HEIGHT;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${DIAGRAM_UNIT_WIDTH * scale}" height="${h * scale}" viewBox="0 0 ${DIAGRAM_UNIT_WIDTH} ${h}" font-family="sans-serif">${renderChordDiagramSvg(voicing)}</svg>`;
}

/** Keeps only well-formed state from the webview (it is re-validated by buildChordLine). */
function sanitizeState(raw: any): ChordEditorState | null {
  if (!raw || !Array.isArray(raw.frets) || raw.frets.length !== STRING_COUNT) return null;
  const frets = raw.frets.map((f: any) => (f === 'x' ? 'x' : Number.isInteger(f) && f >= 0 ? f : 0));
  const fingers = Array.isArray(raw.fingers) && raw.fingers.length === STRING_COUNT
    ? raw.fingers.map((f: any) => (['1', '2', '3', '4', 'T'].includes(f) ? f : null))
    : new Array(STRING_COUNT).fill(null);
  const barres = Array.isArray(raw.barres)
    ? raw.barres.filter((b: any) => b && Number.isInteger(b.fret) && Number.isInteger(b.from) && Number.isInteger(b.to))
      .map((b: any) => ({ fret: b.fret, from: b.from, to: b.to }))
    : [];
  const windowBase = Number.isInteger(raw.windowBase) && raw.windowBase >= 1 ? raw.windowBase : 1;
  return { name: String(raw.name ?? ''), label: String(raw.label ?? ''), frets, fingers, barres, windowBase };
}

export class ChordEditorPanel {
  private static current: ChordEditorPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly m: ChordEditorMessages;
  private uri!: vscode.Uri;
  private line: number | undefined;
  private initialState!: ChordEditorState;
  private ready = false;

  static show(extensionUri: vscode.Uri, doc: vscode.TextDocument, key: string, locale: SupportedLocale): void {
    if (!ChordEditorPanel.current) {
      ChordEditorPanel.current = new ChordEditorPanel(extensionUri, locale);
    }
    ChordEditorPanel.current.load(doc, key);
  }

  private constructor(extensionUri: vscode.Uri, private readonly locale: SupportedLocale) {
    this.m = getChordEditorMessages(locale);
    const mediaRoot = vscode.Uri.joinPath(extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel('guitardslChordEditor', this.m.panelTitle, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [mediaRoot]
    });
    const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'chordEditor.js')).toString();
    this.panel.webview.html = renderChordEditorHtml(this.m, scriptUri, locale);
    this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg));
    this.panel.onDidDispose(() => {
      ChordEditorPanel.current = undefined;
    });
  }

  private load(doc: vscode.TextDocument, key: string): void {
    const session = createEditorSession(doc.getText(), key);
    this.uri = doc.uri;
    this.line = session.line;
    this.initialState = session.state;
    this.panel.title = `${this.m.panelTitle}: ${key}`;
    this.panel.reveal();
    if (this.ready) {
      this.postLoad();
    }
  }

  private editingText(): string {
    return this.line === undefined ? this.m.editingNew : this.m.editingExisting(this.line + 1);
  }

  private postLoad(): void {
    const parsed = parseChordName(this.initialState.name);
    const root = parsed ? NOTE_NAMES[parsed.rootPc] : null;
    const suffix = parsed && PRESET_QUALITIES.some(q => q.suffix === parsed.suffix) ? parsed.suffix : null;
    this.panel.webview.postMessage({
      type: 'load',
      state: this.initialState,
      presetRoots: PRESET_ROOTS,
      presetQualities: PRESET_QUALITIES,
      presetRoot: root,
      presetSuffix: suffix,
      editingText: this.editingText()
    });
  }

  private async onMessage(msg: any): Promise<void> {
    if (msg.command === 'ready') {
      this.ready = true;
      this.postLoad();
    } else if (msg.command === 'change') {
      const state = sanitizeState(msg.state);
      if (state) this.postPreview(state);
    } else if (msg.command === 'presets') {
      this.postPresets(String(msg.root), String(msg.suffix));
    } else if (msg.command === 'save') {
      const state = sanitizeState(msg.state);
      if (state) await this.save(state, msg.asNew === true);
    } else if (msg.command === 'close') {
      this.panel.dispose();
    }
  }

  private postPreview(state: ChordEditorState): void {
    const built = buildChordLine(state);
    const voicing = { frets: state.frets, baseFret: state.windowBase, fingers: state.fingers, barres: state.barres };
    this.panel.webview.postMessage({
      type: 'preview',
      svg: diagramSvg(voicing, 2),
      line: built.ok ? built.line : '',
      error: built.ok ? '' : formatChordDefinitionError(built.error, built.detail, this.locale),
      candidates: detectChordNames(state.frets).map(c => c.name)
    });
  }

  private postPresets(root: string, suffix: string): void {
    const name = root + suffix;
    const items = getPresetVoicings(root, suffix).map(v => ({
      state: stateFromVoicing(name, '', v),
      frets: formatFrets(v.frets),
      svg: diagramSvg(v, 1)
    }));
    this.panel.webview.postMessage({ type: 'presets', root, suffix, name, items });
  }

  private async save(state: ChordEditorState, asNew: boolean): Promise<void> {
    const built = buildChordLine(state);
    if (!built.ok) {
      this.postStatus(formatChordDefinitionError(built.error, built.detail, this.locale), true);
      return;
    }
    const doc = await vscode.workspace.openTextDocument(this.uri);
    // The document may have changed since the editor opened: re-check that the edited line is still a definition.
    const editingLine = this.line !== undefined && this.line < doc.lineCount && isChordDefinitionLine(doc.lineAt(this.line).text) ? this.line : undefined;
    const plan = planChordSave(doc.getText(), built.line, built.definition, editingLine, asNew);
    if (plan.kind === 'duplicate') {
      this.postStatus(this.m.duplicate(plan.key), true);
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    if (plan.kind === 'replace') {
      // Keep the line's indentation and end-of-line comment.
      const old = doc.lineAt(plan.line).text;
      const indent = old.match(/^\s*/)![0];
      const comment = old.match(/\s#.*$/)?.[0] ?? '';
      edit.replace(doc.uri, doc.lineAt(plan.line).range, indent + plan.text + comment);
    } else if (plan.line < doc.lineCount) {
      edit.insert(doc.uri, new vscode.Position(plan.line, 0), plan.text + '\n');
    } else {
      const end = doc.lineAt(doc.lineCount - 1).range.end;
      edit.insert(doc.uri, end, (doc.lineAt(doc.lineCount - 1).text === '' ? '' : '\n') + plan.text + '\n');
    }
    if (!(await vscode.workspace.applyEdit(edit))) {
      return;
    }

    const key = chordKey(built.definition.name, built.definition.label);
    const updated = parseGuitarDsl((await vscode.workspace.openTextDocument(this.uri)).getText());
    this.line = updated.chordDefinitions.find(d => chordKey(d.name, d.label) === key)?.line;
    this.panel.title = `${this.m.panelTitle}: ${key}`;
    this.postStatus(this.m.saved(key), false);
  }

  private postStatus(text: string, error: boolean): void {
    this.panel.webview.postMessage({ type: 'status', text, error, editingText: this.editingText() });
  }
}

/** CodeLens "Edit Diagram" above every valid `chord` definition line. */
export class ChordDefinitionCodeLensProvider implements vscode.CodeLensProvider {
  constructor(private readonly m: ChordEditorMessages) {}

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    for (let i = 0; i < doc.lineCount; i++) {
      const text = doc.lineAt(i).text;
      if (!isChordDefinitionLine(text)) continue;
      const parsed = parseChordDefinition(text);
      if (!parsed.ok) continue;
      const key = chordKey(parsed.definition.name, parsed.definition.label);
      lenses.push(new vscode.CodeLens(doc.lineAt(i).range, {
        title: this.m.codeLens,
        command: EDIT_CHORD_COMMAND,
        arguments: [doc.uri, key]
      }));
    }
    return lenses;
  }
}

/** Quick pick of defined keys, used-but-undefined keys and "New…"; returns the chosen key. */
export async function pickChordKey(doc: vscode.TextDocument, m: ChordEditorMessages): Promise<string | undefined> {
  const score = parseGuitarDsl(doc.getText());
  const defined = score.chordDefinitions.map(d => chordKey(d.name, d.label));
  const used = score.usedChords.filter(k => !defined.includes(k));
  type Item = vscode.QuickPickItem & { key?: string };
  const items: Item[] = [];
  if (defined.length > 0) {
    items.push({ label: m.pickDefined, kind: vscode.QuickPickItemKind.Separator });
    score.chordDefinitions.forEach(d => items.push({ label: chordKey(d.name, d.label), description: formatFrets(d.frets), key: chordKey(d.name, d.label) }));
  }
  if (used.length > 0) {
    items.push({ label: m.pickUsed, kind: vscode.QuickPickItemKind.Separator });
    used.forEach(k => items.push({ label: k, key: k }));
  }
  items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
  items.push({ label: `$(add) ${m.pickNew}` });

  const picked = await vscode.window.showQuickPick(items, { placeHolder: m.pickPlaceholder });
  if (!picked) return undefined;
  if (picked.key) return picked.key;
  return vscode.window.showInputBox({
    prompt: m.newNamePrompt,
    validateInput: value => (isValidChordKey(value.trim()) ? undefined : m.invalidName)
  }).then(v => v?.trim() || undefined);
}

export function isValidChordKey(key: string): boolean {
  const { name, label } = splitChordKey(key);
  return isValidChordName(name) && (label === undefined || isValidChordLabel(label));
}
