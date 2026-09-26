// Score settings editor webview: renders the section model sent by the extension host and reports
// intents ({ command, section, ... }). All computation and document edits happen in the host.
(function () {
  const vscode = acquireVsCodeApi();
  const L = JSON.parse(document.getElementById('l10n').textContent);
  const tabsEl = document.getElementById('tabs');
  const sectionEl = document.getElementById('section');
  const applyBtn = document.getElementById('btn-apply');
  const closeBtn = document.getElementById('btn-close');
  const statusEl = document.getElementById('status');

  let active = null;
  let model = null;

  function send(command, extra) {
    vscode.postMessage(Object.assign({ command }, extra || {}));
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    (children || []).forEach(c => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return node;
  }

  function chips(names) {
    return el('div', { class: 'chips' }, names.map(n => el('span', { class: 'chip', text: n })));
  }

  // --- Section renderers (one per section id) ---
  const renderers = {
    capo(m) {
      const root = el('div', { class: 'layout' });
      const left = el('div', { class: 'col' });
      const right = el('div', { class: 'col' });
      root.appendChild(left);
      root.appendChild(right);

      const summary = el('div', { class: 'summary' });
      summary.appendChild(el('span', {}, [L.currentCapo + ': ', el('b', { text: m.sourceCapo === null ? '—' : String(m.sourceCapo) })]));
      summary.appendChild(el('span', {}, [L.selectedCapo + ': ', el('b', { id: 'selected-capo', text: String(m.selectedCapo) })]));
      left.appendChild(summary);

      const table = el('table', { id: 'candidates' });
      table.appendChild(el('tr', {}, [L.colCapo, L.colScore, L.colLevel, L.colStatus].map(h => el('th', { text: h }))));
      m.candidates.forEach(c => {
        const capoCell = el('td', { text: String(c.capo) });
        if (c.capo === m.sourceCapo) capoCell.appendChild(el('span', { class: 'badge', text: L.current }));
        if (c.recommended) capoCell.appendChild(el('span', { class: 'badge', text: '★ ' + L.recommended }));
        const row = el('tr', {
          class: 'candidate' + (c.capo === m.selectedCapo ? ' selected' : '') + (c.supported ? '' : ' unsupported'),
          'data-capo': String(c.capo)
        }, [
          capoCell,
          el('td', { text: c.score === undefined ? '—' : String(c.score) }),
          el('td', { text: c.levelLabel || '—' }),
          el('td', { text: c.supported ? L.supported : L.unsupported + (c.reason ? ' (' + c.reason + ')' : '') })
        ]);
        if (c.supported) {
          row.addEventListener('click', () => send('select', { section: 'capo', capo: c.capo }));
        }
        table.appendChild(row);
      });
      left.appendChild(table);
      if (m.noChords) left.appendChild(el('p', { class: 'warn', text: L.noChords }));

      right.appendChild(el('h2', { text: L.currentVocabulary }));
      right.appendChild(chips(m.currentVocabulary));
      right.appendChild(el('h2', { text: L.targetVocabulary }));
      right.appendChild(chips(m.targetVocabulary));
      right.appendChild(el('h2', { text: L.mapping }));
      const mapTable = el('table', { class: 'mapping', id: 'mapping' });
      m.mapping.forEach(([from, to]) => mapTable.appendChild(el('tr', {}, [el('td', { text: from }), el('td', { text: '→' }), el('td', { text: to })])));
      right.appendChild(mapTable);
      if (m.unresolved.length > 0) {
        right.appendChild(el('h2', { text: L.unresolvedChords }));
        right.appendChild(chips(m.unresolved));
      }
      if (m.warnings.length > 0 || m.error) {
        right.appendChild(el('h2', { text: L.warnings }));
        m.warnings.forEach(w => right.appendChild(el('p', { class: 'warn', text: w })));
        if (m.error) right.appendChild(el('p', { class: 'error', id: 'capo-error', text: m.error }));
      }
      return root;
    }
  };

  function render(msg) {
    active = msg.active;
    model = msg.model;
    tabsEl.textContent = '';
    msg.sections.forEach(s => {
      const tab = el('button', { class: 'tab' + (s.id === active ? ' active' : ''), role: 'tab', text: s.title });
      tab.addEventListener('click', () => send('showSection', { section: s.id }));
      tabsEl.appendChild(tab);
    });
    sectionEl.textContent = '';
    const renderer = renderers[active];
    if (renderer) sectionEl.appendChild(renderer(model));
    applyBtn.disabled = !(model && model.canApply);
  }

  applyBtn.addEventListener('click', () => {
    if (active === 'capo' && model) send('apply', { section: 'capo', capo: model.selectedCapo });
  });
  closeBtn.addEventListener('click', () => send('close'));

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'load') {
      render(msg);
    } else if (msg.type === 'status') {
      statusEl.textContent = msg.text;
      statusEl.classList.toggle('error', !!msg.error);
    }
  });

  send('ready');
})();
