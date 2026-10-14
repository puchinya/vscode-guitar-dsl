// Settings form for the shared Inspector. It renders host-owned models and posts only typed intents.
(function () {
  const root = document.getElementById('inspector-state');
  const tabs = document.getElementById('settings-tabs');
  const content = document.getElementById('settings-content');
  const actions = document.getElementById('settings-actions');
  const L = JSON.parse(document.getElementById('settings-labels').textContent);

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'disabled') node.disabled = value === true;
      else if (value !== undefined && value !== null) node.setAttribute(key, String(value));
    });
    (children || []).forEach(child => node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child));
    return node;
  }

  function send(command, extra) {
    if (typeof window.guitarDslInspectorPostSettings === 'function') {
      window.guitarDslInspectorPostSettings(command, extra || {});
    }
  }

  function fact(label, value) {
    const strong = el('strong', { text: value === undefined || value === null || value === '' ? '—' : String(value) });
    return el('div', { class: 'settings-fact' }, [el('span', { text: label }), strong]);
  }

  function heading(parent, label) {
    parent.appendChild(el('h3', { text: label }));
  }

  function chipList(parent, values) {
    const list = el('div', { class: 'settings-chips' });
    (values || []).forEach(value => list.appendChild(el('span', { class: 'settings-chip', text: value })));
    parent.appendChild(list);
  }

  function table(parent, headings, rows, className) {
    const wrapper = el('div', { class: 'settings-table-scroll' });
    const tableNode = el('table', { class: `settings-table ${className || ''}` });
    const head = el('thead');
    head.appendChild(el('tr', {}, headings.map(value => el('th', { scope: 'col', text: value }))));
    tableNode.appendChild(head);
    const body = el('tbody');
    rows.forEach(row => body.appendChild(el('tr', { class: row.className || '' }, row.cells.map(value => el('td', { text: value })))));
    tableNode.appendChild(body);
    wrapper.appendChild(tableNode);
    parent.appendChild(wrapper);
  }

  function candidateList(parent, model, section) {
    const list = el('div', { class: 'settings-candidates', role: 'group', 'aria-label': L.candidates });
    (model.candidates || []).forEach(candidate => {
      const labels = [String(candidate.capo)];
      if (candidate.capo === model.sourceCapo) labels.push(L.current);
      if (candidate.recommended) labels.push(`★ ${L.recommended}`);
      labels.push(candidate.score === undefined ? '—' : String(candidate.score));
      if (candidate.levelLabel) labels.push(candidate.levelLabel);
      labels.push(candidate.supported ? L.supported : `${L.unsupported}${candidate.reason ? ` (${candidate.reason})` : ''}`);
      const button = el('button', {
        type: 'button',
        class: 'settings-candidate',
        'aria-pressed': section === 'capo'
          ? candidate.capo === model.selectedCapo
          : candidate.capo === model.targetCapo,
        disabled: !candidate.supported,
        'data-inspector-control': 'candidate',
        'data-inspector-key': String(candidate.capo)
      }, [el('span', { class: 'settings-candidate-title', text: labels.join(' · ') })]);
      if (candidate.reason) button.appendChild(el('span', { class: 'settings-candidate-reason', text: candidate.reason }));
      button.addEventListener('click', () => send(section === 'capo' ? 'settingsSelectCapo' : 'settingsSelectBeginnerCapo', { capo: candidate.capo }));
      list.appendChild(button);
    });
    parent.appendChild(list);
  }

  function warnings(parent, model) {
    if (!(model.warnings || []).length && !model.error) return;
    heading(parent, L.warnings);
    (model.warnings || []).forEach(message => parent.appendChild(el('p', { class: 'settings-warning', text: message })));
    if (model.error) parent.appendChild(el('p', { class: 'settings-error', role: 'alert', text: model.error }));
  }

  function renderCapo(parent, model) {
    const facts = el('div', { class: 'settings-facts' }, [
      fact(L.currentCapo, model.sourceCapo),
      fact(L.selectedCapo, model.selectedCapo),
      fact(L.recommendedCapo, model.recommendedCapo)
    ]);
    parent.appendChild(facts);
    heading(parent, L.candidates);
    candidateList(parent, model, 'capo');
    if (model.noChords) parent.appendChild(el('p', { class: 'settings-warning', text: L.noChords }));
    heading(parent, L.currentVocabulary);
    chipList(parent, model.currentVocabulary);
    heading(parent, L.targetVocabulary);
    chipList(parent, model.targetVocabulary);
    heading(parent, L.mapping);
    table(parent, [L.colSource, '', L.colTarget], (model.mapping || []).map(pair => ({ cells: [pair[0], '→', pair[1]] })), 'mapping');
    if ((model.unresolved || []).length) {
      heading(parent, L.unresolvedChords);
      chipList(parent, model.unresolved);
    }
    warnings(parent, model);
  }

  function renderBeginner(parent, model) {
    parent.appendChild(el('p', { class: 'settings-note', text: L.beginnerNote }));
    const controls = el('div', { class: 'settings-control-grid' });
    const barre = el('select', { 'data-inspector-control': 'input', 'data-inspector-key': 'barre-policy', 'aria-label': L.barreChords }, [
      el('option', { value: 'allow', text: L.barreAllow }),
      el('option', { value: 'forbid', text: L.barreForbid })
    ]);
    barre.value = model.barrePolicy;
    barre.addEventListener('change', () => send('settingsSetBarrePolicy', { policy: barre.value }));
    controls.appendChild(el('label', {}, [el('span', { text: L.barreChords }), barre]));

    const capo = el('select', { 'data-inspector-control': 'input', 'data-inspector-key': 'beginner-capo', 'aria-label': L.capo });
    capo.appendChild(el('option', { value: 'auto', text: L.capoAuto }));
    (model.candidates || []).forEach(candidate => capo.appendChild(el('option', {
      value: String(candidate.capo), text: `${candidate.capo}${candidate.supported ? '' : ` — ${L.unsupported}`}`, disabled: !candidate.supported
    })));
    capo.value = model.selectedCapo === null ? 'auto' : String(model.selectedCapo);
    capo.addEventListener('change', () => send('settingsSelectBeginnerCapo', { capo: capo.value === 'auto' ? 'auto' : Number(capo.value) }));
    controls.appendChild(el('label', {}, [el('span', { text: L.capo }), capo]));
    parent.appendChild(controls);

    parent.appendChild(el('div', { class: 'settings-facts' }, [
      fact(L.recommendedCapo, model.recommendedCapo),
      fact(L.currentPlayability, formatPlayability(model.currentPlayability)),
      fact(L.targetPlayability, formatPlayability(model.targetPlayability))
    ]));
    heading(parent, L.candidates);
    candidateList(parent, model, 'beginner');
    if (model.noChords) parent.appendChild(el('p', { class: 'settings-warning', text: L.noChords }));
    heading(parent, L.mapping);
    table(parent, [L.colSource, L.colCapoChord, L.colTarget, ''], (model.mapping || []).map(item => ({
      className: item.substituted ? 'substituted' : '',
      cells: [item.source, item.capoChord, item.target, item.substituted ? L.substituted : '']
    })), 'mapping');
    warnings(parent, model);
  }

  function formatPlayability(value) {
    return value ? `${value.levelLabel} ${value.score}/100` : '—';
  }

  function renderTranspose(parent, model) {
    parent.appendChild(el('p', { class: 'settings-note', text: L.transposeNote }));
    const controls = el('div', { class: 'settings-control-grid' });
    const semitones = el('select', { 'data-inspector-control': 'input', 'data-inspector-key': 'semitones', 'aria-label': L.semitones });
    for (let n = model.semitoneRange[0]; n <= model.semitoneRange[1]; n++) {
      semitones.appendChild(el('option', { value: String(n), text: `${n > 0 ? '+' : ''}${n}` }));
    }
    semitones.value = String(model.semitones);
    semitones.addEventListener('change', () => send('settingsSetSemitones', { semitones: Number(semitones.value) }));
    controls.appendChild(el('label', {}, [el('span', { text: L.semitones }), semitones]));
    if (model.keyOptions) {
      const key = el('select', { 'data-inspector-control': 'input', 'data-inspector-key': 'target-key', 'aria-label': L.targetKey });
      model.keyOptions.forEach(option => key.appendChild(el('option', {
        value: String(option.semitones), text: `${option.key} (${option.semitones > 0 ? '+' : ''}${option.semitones})`
      })));
      key.value = String(model.semitones);
      key.addEventListener('change', () => send('settingsSetSemitones', { semitones: Number(key.value) }));
      controls.appendChild(el('label', {}, [el('span', { text: L.targetKey }), key]));
    }
    const mode = el('select', { 'data-inspector-control': 'input', 'data-inspector-key': 'capo-mode', 'aria-label': L.capoPolicy }, [
      el('option', { value: 'keep', text: L.capoKeep }),
      el('option', { value: 'recommended', text: L.capoRecommended }),
      el('option', { value: 'explicit', text: L.capoExplicit })
    ]);
    mode.value = model.capoMode;
    const capo = el('select', { 'data-inspector-control': 'input', 'data-inspector-key': 'transpose-capo', 'aria-label': L.targetCapo });
    for (let n = 0; n <= 12; n++) capo.appendChild(el('option', { value: String(n), text: String(n) }));
    capo.value = String(model.explicitCapo);
    capo.disabled = model.capoMode !== 'explicit';
    const sendCapoMode = () => send('settingsSetTransposeCapoMode', { mode: mode.value, capo: Number(capo.value) });
    mode.addEventListener('change', sendCapoMode);
    capo.addEventListener('change', sendCapoMode);
    controls.appendChild(el('label', {}, [el('span', { text: L.capoPolicy }), mode]));
    controls.appendChild(el('label', {}, [el('span', { text: L.targetCapo }), capo]));
    parent.appendChild(controls);

    parent.appendChild(el('div', { class: 'settings-facts' }, [
      fact(L.currentKey, model.sourceKey),
      fact(L.targetKey, model.targetKey),
      fact(L.currentCapo, model.sourceCapo),
      fact(L.targetCapo, model.targetCapo)
    ]));
    heading(parent, L.mapping);
    table(parent, [L.colSource, '', L.colTarget], (model.mapping || []).map(pair => ({ cells: [pair[0], '→', pair[1]] })), 'mapping');
    warnings(parent, model);
  }

  window.renderSettingsInspector = function (context) {
    const focused = document.activeElement;
    const control = focused && focused.dataset ? focused.dataset.inspectorControl : '';
    const key = focused && focused.dataset ? focused.dataset.inspectorKey : '';
    const section = context && context.kind === 'settings' ? context.section : '';
    tabs.textContent = '';
    content.textContent = '';
    actions.hidden = !section;
    if (!section) return;

    (context.sections || []).forEach(item => {
      const button = el('button', {
        type: 'button', class: 'settings-tab', role: 'tab',
        'aria-selected': item.id === section,
        'data-inspector-control': 'section', 'data-inspector-key': item.id,
        text: item.title
      });
      button.addEventListener('click', () => send('settingsSelectSection', { nextSection: item.id }));
      tabs.appendChild(button);
    });

    const model = context.model || {};
    if (section === 'capo') renderCapo(content, model);
    else if (section === 'beginner') renderBeginner(content, model);
    else renderTranspose(content, model);

    const apply = document.getElementById('settings-apply');
    const cancel = document.getElementById('settings-cancel');
    apply.textContent = L.apply;
    apply.disabled = model.canApply !== true;
    cancel.textContent = L.close;

    const target = control && key
      ? tabs.querySelector(`[data-inspector-control="${control}"][data-inspector-key="${key}"]`) || content.querySelector(`[data-inspector-control="${control}"][data-inspector-key="${key}"]`)
      : null;
    if (target && !target.disabled) target.focus();
    else if (control) {
      const selected = tabs.querySelector('[aria-selected="true"]') || content.querySelector('[aria-pressed="true"]') || content.querySelector('select');
      if (selected && !selected.disabled) selected.focus();
      else document.getElementById('settings-heading').focus();
    }
  };

  document.getElementById('settings-apply').addEventListener('click', () => send('settingsApply'));
  document.getElementById('settings-cancel').addEventListener('click', () => send('settingsCancel'));
  if (window.guitarDslInspectorContext) window.renderSettingsInspector(window.guitarDslInspectorContext);
})();
