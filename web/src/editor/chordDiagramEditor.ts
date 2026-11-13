import chordEditorScriptUrl from '../../../media/chordEditor.js?url';
import { renderChordEditorHtml } from '@guitardsl/ui/chordEditorHtml';
import { buildChordLine, createEditorSession, planChordSave, stateFromVoicing, type ChordEditorState } from '@guitardsl/core/chordEditorModel';
import { getChordEditorMessages, formatChordDefinitionError, type SupportedLocale } from '@guitardsl/core/i18n';
import { PRESET_QUALITIES, PRESET_ROOTS, getPresetVoicings } from '@guitardsl/core/chordPresets';
import { NOTE_NAMES, detectChordNames, parseChordName } from '@guitardsl/core/chordDetect';
import { formatFrets, STRING_COUNT } from '@guitardsl/core/chordDefinition';
import { DIAGRAM_FINGER_UNIT_HEIGHT, DIAGRAM_UNIT_HEIGHT, DIAGRAM_UNIT_WIDTH, renderChordDiagramSvg } from '@guitardsl/core/render/chordDiagram';

const CHANNEL = 'guitardsl-chord-web';

interface ChordEditorOptions {
  source: string;
  key: string;
  locale: SupportedLocale;
  /** The owner checks active document and source revision before applying. */
  apply(updatedSource: string, originalSource: string): boolean | Promise<boolean>;
}

function diagramSvg(voicing: Parameters<typeof renderChordDiagramSvg>[0], scale: number): string {
  const height = DIAGRAM_UNIT_HEIGHT + DIAGRAM_FINGER_UNIT_HEIGHT;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${DIAGRAM_UNIT_WIDTH * scale}" height="${height * scale}" viewBox="0 0 ${DIAGRAM_UNIT_WIDTH} ${height}" font-family="sans-serif">${renderChordDiagramSvg(voicing)}</svg>`;
}

function sanitizeState(raw: unknown): ChordEditorState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const object = raw as Record<string, unknown>;
  if (!Array.isArray(object.frets) || object.frets.length !== STRING_COUNT) return undefined;
  const frets = object.frets.map(f => f === 'x' ? 'x' : Number.isInteger(f) && Number(f) >= 0 ? Number(f) : 0);
  const fingers = Array.isArray(object.fingers) && object.fingers.length === STRING_COUNT
    ? object.fingers.map(f => ['1', '2', '3', '4', 'T'].includes(String(f)) ? f : null)
    : new Array(STRING_COUNT).fill(null);
  const barres = Array.isArray(object.barres) ? object.barres
    .filter(b => b && typeof b === 'object' && Number.isInteger(b.fret) && Number.isInteger(b.from) && Number.isInteger(b.to))
    .map(b => ({ fret: b.fret as number, from: b.from as number, to: b.to as number })) : [];
  return {
    name: String(object.name ?? ''), label: String(object.label ?? ''),
    frets, fingers, barres, windowBase: Number.isInteger(object.windowBase) && Number(object.windowBase) >= 1
      ? Number(object.windowBase) : 1
  } as ChordEditorState;
}

/** Replaces one line or inserts a chord definition without normalizing unrelated line endings. */
function applyPlan(source: string, plan: Exclude<ReturnType<typeof planChordSave>, { kind: 'duplicate' }>): string {
  const eol = source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n';
  const starts = [0];
  for (const match of source.matchAll(/\r\n|\r|\n/g)) starts.push((match.index ?? 0) + match[0].length);
  if (plan.kind === 'replace') {
    const start = starts[plan.line];
    if (start === undefined) throw new Error('Chord definition is no longer available');
    const next = starts[plan.line + 1] ?? source.length;
    const match = /\r\n|\r|\n/.exec(source.slice(start, next));
    const end = match ? start + match.index : next;
    const original = source.slice(start, end);
    const indent = /^\s*/.exec(original)?.[0] ?? '';
    const comment = /\s#.*$/.exec(original)?.[0] ?? '';
    return source.slice(0, start) + indent + plan.text + comment + source.slice(end);
  }
  const start = starts[plan.line] ?? source.length;
  if (start < source.length) return source.slice(0, start) + plan.text + eol + source.slice(start);
  return source + (source && !/[\r\n]$/.test(source) ? eol : '') + plan.text + eol;
}

/** The exact VS Code chord editor HTML and script, with a browser message adapter. */
export function showChordDiagramEditor(options: ChordEditorOptions): void {
  const originalSource = options.source;
  const session = createEditorSession(originalSource, options.key);
  const labels = getChordEditorMessages(options.locale);
  const dialog = document.createElement('dialog');
  dialog.className = 'web-chord-editor';
  dialog.setAttribute('aria-label', labels.panelTitle);
  const frame = document.createElement('iframe');
  frame.setAttribute('title', labels.panelTitle);
  frame.sandbox.add('allow-scripts');
  frame.style.cssText = 'width:min(90vw,1040px);height:min(78vh,780px);border:0;display:block;background:white';
  const themeStyle = `<style>:root{--vscode-font-family:system-ui,sans-serif;--vscode-foreground:#242933;--vscode-editor-background:white;--vscode-descriptionForeground:#555f6d;--vscode-button-background:#4158c9;--vscode-button-foreground:white;--vscode-button-secondaryBackground:#e9edf3;--vscode-button-secondaryForeground:#263247;--vscode-focusBorder:#526ee8;--vscode-input-background:white;--vscode-input-foreground:#242933;--vscode-textCodeBlock-background:#eef1f5;--vscode-errorForeground:#b71935}</style>`;
  const bridge = `<script>window.acquireVsCodeApi=()=>({postMessage:message=>parent.postMessage({channel:'${CHANNEL}',message},'*'),getState:()=>null,setState:()=>{}});</script>`;
  const html = renderChordEditorHtml(labels, chordEditorScriptUrl, options.locale)
    .replace('</head>', themeStyle + '</head>')
    .replace('<script id="l10n"', bridge + '<script id="l10n"');
  frame.srcdoc = html;
  dialog.append(frame);
  document.body.append(dialog);

  const send = (payload: Record<string, unknown>): void => frame.contentWindow?.postMessage(payload, '*');
  const editingText = () => session.line === undefined ? labels.editingNew : labels.editingExisting(session.line + 1);
  let saving = false;
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== frame.contentWindow || !event.data || event.data.channel !== CHANNEL) return;
    const message = event.data.message as Record<string, unknown> | undefined;
    if (!message) return;
    if (message.command === 'ready') {
      const parsed = parseChordName(session.state.name);
      const root = parsed ? NOTE_NAMES[parsed.rootPc] : undefined;
      const suffix = parsed && PRESET_QUALITIES.some(x => x.suffix === parsed.suffix) ? parsed.suffix : undefined;
      send({ type: 'load', state: session.state, presetRoots: PRESET_ROOTS, presetQualities: PRESET_QUALITIES,
        presetRoot: root, presetSuffix: suffix, editingText: editingText() });
      return;
    }
    if (message.command === 'close') { dialog.close(); return; }
    if (message.command === 'presets') {
      const root = String(message.root ?? '');
      const suffix = String(message.suffix ?? '');
      const items = getPresetVoicings(root, suffix, session.instrument).map(voicing => ({
        state: stateFromVoicing(root + suffix, '', voicing), frets: formatFrets(voicing.frets), svg: diagramSvg(voicing, 1)
      }));
      send({ type: 'presets', root, suffix, name: root + suffix, items });
      return;
    }
    const state = sanitizeState(message.state);
    if (!state) return;
    if (message.command === 'change') {
      const built = buildChordLine(state, session.instrument);
      const voicing = { frets: state.frets, baseFret: state.windowBase, fingers: state.fingers, barres: state.barres };
      send({ type: 'preview', svg: diagramSvg(voicing, 2),
        line: built.ok ? built.line : '',
        error: built.ok ? '' : formatChordDefinitionError(built.error, built.detail, options.locale),
        candidates: detectChordNames(state.frets, 8, session.instrument).map(candidate => candidate.name)
      });
      return;
    }
    if (message.command === 'save' && !saving) {
      saving = true;
      void (async () => {
        try {
          const built = buildChordLine(state, session.instrument);
          if (!built.ok) throw new Error(formatChordDefinitionError(built.error, built.detail, options.locale));
          const plan = planChordSave(originalSource, built.line, built.definition, session.line, message.asNew === true);
          if (plan.kind === 'duplicate') throw new Error(labels.duplicate(plan.key));
          const nextSource = applyPlan(originalSource, plan);
          if (!await options.apply(nextSource, originalSource)) throw new Error('Source changed. Reopen the chord editor before saving.');
          send({ type: 'status', text: labels.saved(built.definition.name), error: false, editingText: editingText() });
          dialog.close();
        } catch (error) {
          send({ type: 'status', text: error instanceof Error ? error.message : String(error), error: true,
            editingText: editingText() });
        } finally { saving = false; }
      })();
    }
  };
  const cleanup = (): void => { window.removeEventListener('message', onMessage); dialog.remove(); };
  window.addEventListener('message', onMessage);
  dialog.addEventListener('close', cleanup, { once: true });
  dialog.addEventListener('cancel', cleanup, { once: true });
  dialog.showModal();
}
