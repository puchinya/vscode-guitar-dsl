// Chord diagram editor webview (spec: docs/specs/extension.md "コードダイアグラムエディタ").
// The extension host owns validation, rendering of previews/presets and saving; this script only edits the state.
(function () {
  const vscode = acquireVsCodeApi();
  const L = JSON.parse(document.getElementById('l10n').textContent);
  const STRINGS = 6;
  const WINDOW = 5;
  const MAX_BASE = 20;

  // Grid geometry (px)
  const LEFT = 44;
  const TOP = 36;
  const SG = 34;
  const FG = 40;
  const GRID_W = LEFT + (STRINGS - 1) * SG + 28;
  const GRID_H = TOP + WINDOW * FG + 12;

  let state = null;
  let tool = 'fret';
  let finger = '1';
  let barreStart = null;
  let presetRoot = null;
  let presetSuffix = null;
  let presetRoots = [];
  let presetQualities = [];

  const $ = id => document.getElementById(id);
  const grid = $('grid');
  const nameInput = $('chord-name');
  const labelInput = $('chord-label');
  const baseInput = $('base-fret');

  function send(command, extra) {
    vscode.postMessage(Object.assign({ command }, extra || {}));
  }

  function changed() {
    drawGrid();
    send('change', { state });
  }

  function svgEl(tag, attrs, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function stringX(s) {
    return LEFT + s * SG;
  }

  function underBarre(s, f) {
    return state.barres.some(b => b.fret === f && s >= b.from && s <= b.to);
  }

  function drawGrid() {
    const base = state.windowBase;
    grid.setAttribute('viewBox', '0 0 ' + GRID_W + ' ' + GRID_H);
    grid.setAttribute('width', GRID_W);
    grid.setAttribute('height', GRID_H);
    grid.textContent = '';

    // Open / mute markers above the nut
    for (let s = 0; s < STRINGS; s++) {
      const x = stringX(s);
      const f = state.frets[s];
      grid.appendChild(svgEl('rect', { x: x - SG / 2, y: 0, width: SG, height: TOP - 4, class: 'hit', 'data-action': 'marker', 'data-s': s }));
      if (f === 'x') {
        grid.appendChild(svgEl('text', { x, y: TOP - 12, class: 'marker', 'text-anchor': 'middle' }, '×'));
      } else if (f === 0) {
        grid.appendChild(svgEl('circle', { cx: x, cy: TOP - 17, r: 6, class: 'open' }));
      }
    }

    grid.appendChild(svgEl('line', { x1: stringX(0), y1: TOP, x2: stringX(STRINGS - 1), y2: TOP, class: base === 1 ? 'nut' : 'fret' }));
    for (let k = 1; k <= WINDOW; k++) {
      const y = TOP + k * FG;
      grid.appendChild(svgEl('line', { x1: stringX(0), y1: y, x2: stringX(STRINGS - 1), y2: y, class: 'fret' }));
    }
    for (let k = 0; k < WINDOW; k++) {
      grid.appendChild(svgEl('text', { x: LEFT - 22, y: TOP + k * FG + FG / 2 + 4, class: 'fret-no', 'text-anchor': 'end' }, String(base + k)));
    }
    for (let s = 0; s < STRINGS; s++) {
      grid.appendChild(svgEl('line', { x1: stringX(s), y1: TOP, x2: stringX(s), y2: TOP + WINDOW * FG, class: 'string' }));
    }

    // Click targets (one per string x fret)
    for (let s = 0; s < STRINGS; s++) {
      for (let k = 0; k < WINDOW; k++) {
        const attrs = { x: stringX(s) - SG / 2, y: TOP + k * FG, width: SG, height: FG, class: 'hit cell', 'data-action': 'cell', 'data-s': s, 'data-f': base + k };
        if (barreStart && barreStart.s === s && barreStart.f === base + k) attrs.class += ' pending';
        grid.appendChild(svgEl('rect', attrs));
      }
    }

    for (const b of state.barres) {
      if (b.fret < base || b.fret >= base + WINDOW) continue;
      const y = TOP + (b.fret - base) * FG + FG / 2;
      grid.appendChild(svgEl('rect', { x: stringX(b.from) - 11, y: y - 9, width: stringX(b.to) - stringX(b.from) + 22, height: 18, rx: 9, class: 'barre' }));
    }
    for (let s = 0; s < STRINGS; s++) {
      const f = state.frets[s];
      if (typeof f !== 'number' || f <= 0 || f < base || f >= base + WINDOW) continue;
      const y = TOP + (f - base) * FG + FG / 2;
      if (!underBarre(s, f)) {
        grid.appendChild(svgEl('circle', { cx: stringX(s), cy: y, r: 11, class: 'dot' }));
      }
      if (state.fingers[s]) {
        grid.appendChild(svgEl('text', { x: stringX(s), y: y + 4.5, class: 'finger', 'text-anchor': 'middle' }, state.fingers[s]));
      }
    }
  }

  function onMarker(s) {
    state.frets[s] = state.frets[s] === 0 ? 'x' : 0;
    state.fingers[s] = null;
  }

  function onCell(s, f) {
    if (tool === 'fret') {
      if (state.frets[s] === f) {
        state.frets[s] = 0;
        state.fingers[s] = null;
      } else {
        state.frets[s] = f;
      }
    } else if (tool === 'finger') {
      if (state.frets[s] === f || underBarre(s, f)) {
        state.fingers[s] = finger === '-' ? null : finger;
      }
    } else {
      const existing = state.barres.findIndex(b => b.fret === f && s >= b.from && s <= b.to);
      if (existing >= 0) {
        state.barres.splice(existing, 1);
        barreStart = null;
      } else if (barreStart && barreStart.f === f && barreStart.s !== s) {
        const from = Math.min(barreStart.s, s);
        const to = Math.max(barreStart.s, s);
        for (let i = from; i <= to; i++) {
          const cur = state.frets[i];
          if (cur === 'x' || cur === 0 || cur < f) state.frets[i] = f;
        }
        state.barres.push({ fret: f, from, to });
        barreStart = null;
      } else {
        barreStart = { s, f };
      }
    }
  }

  grid.addEventListener('click', e => {
    const t = e.target.closest('[data-action]');
    if (!t || !state) return;
    const s = Number(t.getAttribute('data-s'));
    if (t.getAttribute('data-action') === 'marker') onMarker(s);
    else onCell(s, Number(t.getAttribute('data-f')));
    changed();
  });

  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      tool = btn.getAttribute('data-tool');
      barreStart = null;
      document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b === btn));
      $('finger-picker').hidden = tool !== 'finger';
      $('tool-help').textContent = L['help_' + tool];
      drawGrid();
    });
  });
  document.querySelectorAll('[data-finger]').forEach(btn => {
    btn.addEventListener('click', () => {
      finger = btn.getAttribute('data-finger');
      document.querySelectorAll('[data-finger]').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  nameInput.addEventListener('input', () => { state.name = nameInput.value; send('change', { state }); });
  labelInput.addEventListener('input', () => { state.label = labelInput.value; send('change', { state }); });
  baseInput.addEventListener('change', () => {
    const n = Math.max(1, Math.min(MAX_BASE, Math.round(Number(baseInput.value)) || 1));
    baseInput.value = n;
    state.windowBase = n;
    changed();
  });
  $('base-down').addEventListener('click', () => { baseInput.value = state.windowBase - 1; baseInput.dispatchEvent(new Event('change')); });
  $('base-up').addEventListener('click', () => { baseInput.value = state.windowBase + 1; baseInput.dispatchEvent(new Event('change')); });

  $('btn-clear').addEventListener('click', () => {
    state.frets = new Array(STRINGS).fill(0);
    state.fingers = new Array(STRINGS).fill(null);
    state.barres = [];
    barreStart = null;
    changed();
  });
  $('btn-save').addEventListener('click', () => send('save', { state, asNew: false }));
  $('btn-save-new').addEventListener('click', () => send('save', { state, asNew: true }));
  $('btn-close').addEventListener('click', () => send('close'));

  function renderPresetLists() {
    const roots = $('preset-roots');
    const qualities = $('preset-qualities');
    roots.textContent = '';
    qualities.textContent = '';
    presetRoots.forEach(r => {
      const b = document.createElement('button');
      b.textContent = r;
      b.className = 'chip' + (r === presetRoot ? ' active' : '');
      b.addEventListener('click', () => { presetRoot = r; requestPresets(); });
      roots.appendChild(b);
    });
    presetQualities.forEach(q => {
      const b = document.createElement('button');
      b.textContent = q.label;
      b.className = 'chip' + (q.suffix === presetSuffix ? ' active' : '');
      b.addEventListener('click', () => { presetSuffix = q.suffix; requestPresets(); });
      qualities.appendChild(b);
    });
  }

  function requestPresets() {
    renderPresetLists();
    if (presetRoot !== null && presetSuffix !== null) {
      send('presets', { root: presetRoot, suffix: presetSuffix });
    }
  }

  function renderPresetItems(items, name) {
    const list = $('preset-items');
    list.textContent = '';
    if (items.length === 0) {
      list.textContent = L.noPresets;
      return;
    }
    items.forEach(item => {
      const b = document.createElement('button');
      b.className = 'preset';
      b.title = item.frets;
      b.innerHTML = item.svg; // rendered by the extension host from preset data
      b.addEventListener('click', () => {
        state.name = name;
        state.frets = item.state.frets.slice();
        state.fingers = item.state.fingers.slice();
        state.barres = item.state.barres.map(x => Object.assign({}, x));
        state.windowBase = item.state.windowBase;
        barreStart = null;
        syncInputs();
        changed();
      });
      list.appendChild(b);
    });
  }

  function renderCandidates(candidates) {
    const box = $('candidates');
    box.textContent = '';
    if (candidates.length === 0) {
      box.textContent = '—';
      return;
    }
    candidates.forEach(c => {
      const b = document.createElement('button');
      b.className = 'chip' + (c === state.name ? ' active' : '');
      b.textContent = c;
      b.addEventListener('click', () => {
        state.name = c;
        nameInput.value = c;
        send('change', { state });
      });
      box.appendChild(b);
    });
  }

  function syncInputs() {
    nameInput.value = state.name;
    labelInput.value = state.label;
    baseInput.value = state.windowBase;
  }

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'load') {
      state = msg.state;
      presetRoots = msg.presetRoots;
      presetQualities = msg.presetQualities;
      presetRoot = msg.presetRoot;
      presetSuffix = msg.presetSuffix;
      barreStart = null;
      $('editing').textContent = msg.editingText;
      syncInputs();
      drawGrid();
      requestPresets();
      send('change', { state });
    } else if (msg.type === 'preview') {
      $('preview').innerHTML = msg.svg;
      $('dsl-line').textContent = msg.line;
      $('error').textContent = msg.error || '';
      $('btn-save').disabled = !!msg.error;
      $('btn-save-new').disabled = !!msg.error;
      renderCandidates(msg.candidates);
    } else if (msg.type === 'presets') {
      if (msg.root === presetRoot && msg.suffix === presetSuffix) renderPresetItems(msg.items, msg.name);
    } else if (msg.type === 'status') {
      $('status').textContent = msg.text;
      $('status').className = msg.error ? 'status error' : 'status';
      if (msg.editingText) $('editing').textContent = msg.editingText;
    }
  });

  send('ready');
})();
