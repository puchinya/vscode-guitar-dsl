import * as assert from 'assert';
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
    assert.match(html, /status\.textContent = message\.status/);
    assert.match(html, /var\(--vscode-sideBar-background\)/);
    assert.match(html, /@media \(max-width: 600px\)/);
    assert.match(html, /<script nonce="unit-nonce">/);
    assert.doesNotMatch(html, /<script[^>]+src=|https?:\/\//i);
  });

  it('renders document status without putting its URI or version into the Webview', () => {
    const uri = 'file:///private/song.guitardsl';
    const html = renderInspectorHtml('en', { kind: 'document', uri, version: 9 }, 'vscode-webview://unit', 'nonce-9');

    assert.match(html, /data-context-kind="document"/);
    assert.match(html, /Showing the active GuitarDSL document context/);
    assert.match(html, /This foundation is read-only/);
    assert.doesNotMatch(html, /private\/song\.guitardsl|version.{0,10}9/i);
  });

  it('escapes untrusted nonce and CSP source values', () => {
    const html = renderInspectorHtml('en', { kind: 'empty' }, '" onerror="alert(1)', 'nonce"&<');

    assert.match(html, /&quot; onerror=&quot;alert\(1\)/);
    assert.match(html, /nonce&quot;&amp;&lt;/);
    assert.doesNotMatch(html, /nonce"&</);
  });
});
