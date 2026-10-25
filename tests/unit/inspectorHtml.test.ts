import * as assert from 'assert';
import { runInNewContext } from 'node:vm';
import { renderInspectorHtml } from '../../src/render/inspectorHtml';

describe('renderInspectorHtml', () => {
  it('renders a localized accessible empty state with nonce-only resources', () => {
    const html = renderInspectorHtml('ja', { kind: 'empty' }, 'vscode-webview://unit', 'unit-nonce');

    assert.match(html, /<html lang="ja">/);
    assert.match(html, /data-context-kind="empty"/);
    assert.match(html, /GuitarDSL Inspector/);
    assert.match(html, /GuitarDSL 文書が選択されていません/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /aria-labelledby="inspector-heading"/);
    assert.match(html, /default-src 'none'/);
    assert.match(html, /style-src 'nonce-unit-nonce'/);
    assert.match(html, /script-src 'nonce-unit-nonce'/);
    assert.match(html, /message\.generation <= lastGeneration/);
    assert.match(html, /status\.textContent = nextStatus/);
    assert.match(html, /postMessage\(\{ command: "ready" \}\)/);
    assert.match(html, /var\(--vscode-sideBar-background\)/);
    assert.match(html, /@media \(max-width: 600px\)/);
    assert.match(html, /<script nonce="unit-nonce">/);
    assert.doesNotMatch(html, /<script[^>]+src=|https?:\/\//i);
  });

  it('keeps document identity machine-readable without showing it in document status', () => {
    const uri = 'file:///private/song.guitardsl';
    const html = renderInspectorHtml('en', { kind: 'document', uri, version: 9 }, 'vscode-webview://unit', 'nonce-9');

    assert.match(html, /data-context-kind="document"/);
    assert.match(html, /data-document-uri="file:\/\/\/private\/song\.guitardsl"/);
    assert.match(html, /data-document-version="9"/);
    assert.match(html, /Showing the active GuitarDSL document context/);
    assert.match(html, /This foundation is read-only/);
    const documentPanel = html.match(/<div id="document-state"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
    assert.doesNotMatch(documentPanel, /private\/song\.guitardsl|version.{0,10}9/i);
  });

  it('renders the shared top-level tabs with session identity and keyboard activation', () => {
    const context = {
      kind: 'variables',
      uri: 'file:///song.guitardsl', version: 12, sessionGeneration: 4, revision: 0, draftRevision: 0,
      definitions: []
    } as const;
    const html = renderInspectorHtml('en', context, 'vscode-webview://unit', 'top-tabs', 7);

    assert.match(html, /id="inspector-context-tabs" role="tablist"/);
    for (const tab of ['document', 'variables', 'settings', 'progression']) {
      assert.match(html, new RegExp(`id="inspector-tab-${tab}"[^>]*role="tab"[^>]*aria-controls="${tab}-state"`));
    }
    assert.match(html, /id="inspector-tab-variables"[^>]*aria-selected="true"/);
    assert.match(html, /id="inspector-tab-progression"[^>]* disabled/,
      'progression stays disabled unless the host has a valid suggestion session');
    assert.match(html, /data-document-uri="file:\/\/\/song\.guitardsl" data-document-version="12" data-session-generation="4"/);
    assert.match(html, /command: "inspectorSelectTab", tab, generation: lastGeneration, documentUri: uri, documentVersion: version/);
    assert.match(html, /event\.key === "ArrowRight"/);
    assert.match(html, /event\.key === "Home"/);
    assert.match(html, /event\.key === "End"/);
    assert.match(html, /event\.key === "Enter" \|\| event\.key === " "/);
  });

  it('shows direct and indirect let references and disables invalid definition edits', () => {
    const context = {
      kind: 'variables',
      uri: 'file:///song.guitardsl',
      version: 4,
      sessionGeneration: 1,
      revision: 0,
      draftRevision: 0,
      selectedName: 'riff',
      definitions: [{
        name: 'riff', valid: false, duplicate: true, line: 0, nameStartCol: 4, nameEndCol: 8,
        valueStartCol: 11, valueEndCol: 14, value: '4.d', allowedContexts: ['measure'],
        directReferences: [{ name: 'riff', line: 2, startCol: 8, endCol: 13, kind: 'score' }],
        usageLocations: [
          { name: 'riff', line: 2, startCol: 8, endCol: 13, kind: 'score' },
          { name: 'riff', line: 1, startCol: 10, endCol: 15, kind: 'definition', ownerName: 'groove', via: 'groove' }
        ]
      }]
    } as const;
    const html = renderInspectorHtml('en', context, 'vscode-webview://unit', 'variables-nonce');
    assert.match(html, /id="variables-usages"/);
    assert.match(html, /labels\.variablesDirect \+ ": " \+ directCount/);
    assert.match(html, /deleteOption\.disabled = !valid \|\| !unused/);
    assert.match(html, /labels\.variablesInvalid/);
    assert.match(html, /postVariables\("variablesJump", \{ name: selected\.name, line: item\.line/);
  });

  it('renders the settings state inside the shared Inspector and loads its nonce-authorized renderer', () => {
    const context = {
      kind: 'settings',
      uri: 'file:///song.guitardsl',
      version: 3,
      sessionGeneration: 2,
      revision: 0,
      section: 'capo',
      sections: [
        { id: 'capo', title: 'Capo / Playability' },
        { id: 'beginner', title: 'Beginner Mode' },
        { id: 'transpose', title: 'Transpose' }
      ],
      model: { sourceCapo: 0, selectedCapo: 0, candidates: [], canApply: false },
      status: 'Capo / Playability',
      description: 'Choose a capo'
    } as const;
    const html = renderInspectorHtml('en', context, 'vscode-webview://unit', 'settings-nonce', 2,
      'vscode-webview://unit/media/inspectorSettings.js');

    assert.match(html, /data-context-kind="settings"/);
    assert.match(html, /id="settings-state"/);
    assert.match(html, /id="settings-tabs" class="settings-tabs" role="tablist"/);
    assert.match(html, /id="settings-apply" type="button" data-inspector-control="action" data-inspector-key="apply" disabled/);
    assert.match(html, /id="settings-cancel" type="button" data-inspector-control="action" data-inspector-key="close"/);
    assert.match(html, /script-src 'nonce-settings-nonce' vscode-webview:\/\/unit/);
    assert.match(html, /<script nonce="settings-nonce" src="vscode-webview:\/\/unit\/media\/inspectorSettings\.js"><\/script>/);
    assert.doesNotMatch(html, /Choose a capo.{0,50}file:\/\/\/song/);
  });

  it('renders audition modes, repeat guidance, and a native keyboard-operable candidate list', () => {
    const context = {
      kind: 'progression',
      uri: 'file:///song.guitardsl',
      version: 3,
      sessionGeneration: 2,
      target: { startMeasure: 0, bars: 8, operation: 'replace' },
      availableBars: [4, 8],
      availableOperations: ['replace', 'append'],
      candidates: [{ id: 'candidate-1', chords: ['C', 'Dm', 'Em', 'F'], score: 6, scoreText: '+6', rationale: 'C major' }],
      selectedCandidateId: 'candidate-1',
      side: 'B',
      auditionMode: 'bars',
      auditionSpeed: 100,
      loading: false
    } as const;
    const html = renderInspectorHtml('en', context, 'vscode-webview://unit', 'progression-nonce');
    const fourBarHtml = renderInspectorHtml('en', {
      ...context,
      target: { ...context.target, bars: 4 }
    }, 'vscode-webview://unit', 'progression-nonce');
    const sixteenBarHtml = renderInspectorHtml('en', {
      ...context,
      target: { ...context.target, bars: 16 }
    }, 'vscode-webview://unit', 'progression-nonce');

    assert.match(html, /<option value="chord">Single chord<\/option>/);
    assert.match(html, /<option value="bars">Full progression<\/option>/);
    assert.match(html, /<option value="melody">Progression with melody<\/option>/);
    assert.match(html, /<option value="song">Audition full song<\/option>/);
    assert.match(html, /<h1 id="inspector-heading">GuitarDSL Inspector<\/h1>/,
      'the common Inspector heading stays distinct from the progression section heading');
    assert.match(html, /id="progression-repeat-notice" class="description repeat-notice"><\/p>/,
      '8-bar proposals show the repeat limitation notice');
    assert.match(sixteenBarHtml, /id="progression-repeat-notice" class="description repeat-notice"><\/p>/,
      '16-bar proposals show the repeat limitation notice');
    assert.match(fourBarHtml, /id="progression-repeat-notice" class="description repeat-notice" hidden><\/p>/,
      '4-bar proposals hide the repeat limitation notice');
    assert.match(html, /repeatNotice\.hidden = context\.target\.bars <= 4/);
    assert.match(html, /id="candidate-list" class="candidate-list"><\/ul>/);
    assert.match(html, /button\.setAttribute\("aria-pressed", String\(candidate\.id === context\.selectedCandidateId\)\)/);
    assert.doesNotMatch(html, /role="listbox"|role="option"/);
    assert.match(html, /settings-tab/);
    assert.match(html, /aria-selected/, 'settings navigation uses a selected tab state');
    assert.match(html, /existingCandidates = new Map\(Array\.from\(candidateList\.children\)/,
      'candidate rows are reconciled by ID so a host refresh can retain the focused button');
    assert.match(html, /restoreControlFocus\(focusedControl, focusedKey\)/,
      'a removed or disabled focused choice moves focus to its selected or first enabled fallback');
    assert.doesNotMatch(html, /candidateList\.replaceChildren\(\)|container\.replaceChildren\(\)/,
      'context updates do not discard every focused choice node');
    assert.match(html, /auditionMode\.addEventListener\("change"/);
    assert.match(html, /button:focus-visible/);
    assert.match(html, /\.mode-control \{ flex: 1 1 100%; flex-direction: column; align-items: stretch; \}/,
      'the narrow Inspector stacks the audition mode label and select');
    assert.match(html, /\.mode-control select \{ min-width: 0; width: 100%; box-sizing: border-box; \}/,
      'the audition mode options remain readable across the available row');
  });

  it('ignores an older asynchronous context message after a newer generation is applied', () => {
    const html = renderInspectorHtml('en', { kind: 'empty' }, 'vscode-webview://unit', 'nonce-3', 1);
    const scriptIndex = html.indexOf('<script nonce="nonce-3">');
    const stateIndex = html.indexOf('<main id="inspector-state"');
    assert.ok(stateIndex >= 0 && scriptIndex > stateIndex, 'the runtime script follows the DOM elements it initializes');
    const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
    assert.strictEqual(typeof script, 'string');

    const parsedHtml = html.slice(0, scriptIndex);
    const rootMatch = parsedHtml.match(/<main id="inspector-state" data-generation="(\d+)" data-context-kind="([^"]+)"/);
    const statusMatch = parsedHtml.match(/<p id="inspector-status"[^>]*>([\s\S]*?)<\/p>/);
    const descriptionMatch = parsedHtml.match(/<p id="inspector-description"[^>]*>([\s\S]*?)<\/p>/);
    assert.ok(rootMatch && statusMatch && descriptionMatch, 'the HTML parser has created all elements before running the script');
    type FakeElement = {
      dataset: Record<string, string>;
      textContent: string;
      hidden: boolean;
      disabled: boolean;
      value: string;
      addEventListener: () => void;
      setAttribute: () => void;
      replaceChildren: () => void;
      append: () => void;
    };
    const makeElement = (): FakeElement => ({
      dataset: {}, textContent: '', hidden: false, disabled: false, value: '',
      addEventListener: () => {}, setAttribute: () => {}, replaceChildren: () => {}, append: () => {}
    });
    const elements = new Map<string, FakeElement>([
      ['inspector-state', { ...makeElement(), dataset: { generation: rootMatch[1], contextKind: rootMatch[2] } }],
      ['inspector-status', { ...makeElement(), textContent: statusMatch[1] }],
      ['inspector-description', { ...makeElement(), textContent: descriptionMatch[1] }]
    ]);
    const root = elements.get('inspector-state')!;
    const status = elements.get('inspector-status')!;
    const description = elements.get('inspector-description')!;
    let receiveMessage: ((event: { data: unknown }) => void) | undefined;
    let readyMessage: unknown;
    runInNewContext(script!, {
      document: {
        getElementById: (id: string) => {
          if (!elements.has(id)) elements.set(id, makeElement());
          return elements.get(id);
        },
        querySelectorAll: () => []
      },
      window: {
        addEventListener: (type: string, listener: (event: { data: unknown }) => void) => {
          if (type === 'message') receiveMessage = listener;
        }
      },
      acquireVsCodeApi: () => ({ postMessage: (message: unknown) => { readyMessage = message; } })
    });

    assert.ok(receiveMessage);
    assert.strictEqual(
      (readyMessage as { command?: unknown } | undefined)?.command,
      'ready',
      'the initialized DOM requests an authoritative host snapshot'
    );
    receiveMessage!({ data: { command: 'setContext', generation: 3, kind: 'document', context: { kind: 'document' }, status: 'current', description: 'current context' } });
    receiveMessage!({ data: { command: 'setContext', generation: 2, kind: 'empty', context: { kind: 'empty' }, status: 'stale', description: 'stale context' } });

    assert.strictEqual(root.dataset?.generation, '3');
    assert.strictEqual(root.dataset?.contextKind, 'document');
    assert.strictEqual(status.textContent, 'current');
    assert.strictEqual(description.textContent, 'current context');
  });

  it('escapes untrusted nonce and CSP source values', () => {
    const html = renderInspectorHtml('en', { kind: 'empty' }, '" onerror="alert(1)', 'nonce"&<');

    assert.match(html, /&quot; onerror=&quot;alert\(1\)/);
    assert.match(html, /nonce&quot;&amp;&lt;/);
    assert.doesNotMatch(html, /nonce"&</);
  });
});
