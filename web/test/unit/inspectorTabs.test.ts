import assert from 'node:assert/strict';
import test from 'node:test';
import { renderInspectorTabsMarkup } from '@guitardsl/ui/inspectorTabs';

test('shared Inspector tabs expose the active section and disabled state accessibly', () => {
  const html = renderInspectorTabsMarkup({
    listLabel: 'Inspector sections', active: 'settings', disabled: ['progression'],
    labels: {
      document: { full: 'Document', compact: 'Doc' }, variables: { full: 'Variables', compact: 'Vars' },
      settings: { full: 'Settings', compact: 'Set' }, progression: { full: 'Progression', compact: 'Prog' }
    }, controlsId: 'inspector-content'
  });
  assert.match(html, /role="tablist" aria-label="Inspector sections"/);
  assert.match(html, /data-inspector-tab="settings"[^>]*aria-selected="true"[^>]*tabindex="0"/);
  assert.match(html, /data-inspector-tab="progression"[^>]*disabled/);
  assert.match(html, /aria-controls="inspector-content"/);
});

test('shared Inspector tabs escape text before inserting markup', () => {
  const html = renderInspectorTabsMarkup({
    listLabel: '<Inspector>', active: 'document',
    labels: {
      document: { full: '<Document>', compact: 'D' }, variables: { full: 'Variables', compact: 'V' },
      settings: { full: 'Settings', compact: 'S' }, progression: { full: 'Progression', compact: 'P' }
    }
  });
  assert.match(html, /&lt;Inspector&gt;/);
  assert.match(html, /&lt;Document&gt;/);
  assert.doesNotMatch(html, /<Document>/);
});
