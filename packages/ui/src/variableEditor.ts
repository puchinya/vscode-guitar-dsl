/** Host-neutral Inspector variable controls. Both VS Code Webview and Web SPA render this markup. */
export interface VariableEditorLabels {
  title: string; description: string; name: string; value: string; reference: string; usage: string;
  choose: string; add: string; editGlobal: string; rename: string; clone: string; deleteUnused: string;
  detachLocal: string; jump: string; apply: string; cancel: string;
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function renderVariableEditorBody(labels: VariableEditorLabels): string {
  const options: Array<[string, string]> = [
    ['chooseReference', labels.choose], ['add', labels.add], ['editGlobal', labels.editGlobal],
    ['rename', labels.rename], ['clone', labels.clone], ['deleteUnused', labels.deleteUnused],
    ['detachLocal', labels.detachLocal]
  ];
  return `<h2 id="variables-heading">${escape(labels.title)}</h2>
    <p id="variables-description" class="description">${escape(labels.description)}</p>
    <ul id="variables-list" class="variable-list" aria-label="${escape(labels.title)}"></ul>
    <p id="variables-meta" class="variable-meta" role="status"></p>
    <ul id="variables-usages" class="variable-usage-list" aria-label="${escape(labels.usage)}"></ul>
    <div class="variable-form">
      <label><span id="variables-name-label">${escape(labels.name)}</span><input id="variables-name" type="text" maxlength="64" autocomplete="off"></label>
      <label><span id="variables-value-label">${escape(labels.value)}</span><textarea id="variables-value" rows="3" maxlength="2048" spellcheck="false"></textarea></label>
      <label><span id="variables-reference-label">${escape(labels.reference)}</span><select id="variables-reference"></select></label>
      <label><span>${escape(labels.usage)}</span><select id="variables-operation">
        ${options.map(([id, title]) => `<option value="${id}">${escape(title)}</option>`).join('')}
      </select></label>
      <div class="variable-actions">
        <button id="variables-jump" type="button">${escape(labels.jump)}</button>
        <button id="variables-apply" type="button">${escape(labels.apply)}</button>
        <button id="variables-cancel" type="button">${escape(labels.cancel)}</button>
      </div>
      <p id="variables-error" class="error" role="alert" hidden></p>
    </div>`;
}

export function renderVariableEditorMarkup(labels: VariableEditorLabels): string {
  return `<section id="variables-state" role="tabpanel" tabindex="0" aria-labelledby="inspector-tab-variables" hidden>
    ${renderVariableEditorBody(labels)}
  </section>`;
}
