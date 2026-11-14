export type InspectorTabId = 'document' | 'variables' | 'settings' | 'progression';

export interface InspectorTabLabel { full: string; compact: string }
export type InspectorTabLabels = Record<InspectorTabId, InspectorTabLabel>;

export interface InspectorTabsOptions {
  labels: InspectorTabLabels;
  listLabel: string;
  active: InspectorTabId;
  disabled?: readonly InspectorTabId[];
  controlsId?: string | Partial<Record<InspectorTabId, string>>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/** Shared, keyboard-ready navigation used by the VS Code Inspector and Web Inspector. */
export function renderInspectorTabsMarkup(options: InspectorTabsOptions): string {
  const tabs: InspectorTabId[] = ['document', 'variables', 'settings', 'progression'];
  const disabled = new Set(options.disabled ?? []);
  const controlId = (tab: InspectorTabId): string => typeof options.controlsId === 'string'
    ? options.controlsId : options.controlsId?.[tab] ?? `${tab}-state`;
  const buttons = tabs.map(tab => {
    const selected = tab === options.active;
    const label = options.labels[tab];
    return `<button id="inspector-tab-${tab}" type="button" role="tab" data-inspector-tab="${tab}" data-inspector="${tab}" aria-label="${escapeHtml(label.full)}" title="${escapeHtml(label.full)}" aria-controls="${escapeHtml(controlId(tab))}" aria-selected="${selected}" tabindex="${selected ? '0' : '-1'}"${disabled.has(tab) ? ' disabled' : ''}><span class="inspector-tab-label-full">${escapeHtml(label.full)}</span><span class="inspector-tab-label-compact" aria-hidden="true">${escapeHtml(label.compact)}</span></button>`;
  }).join('');
  return `<div class="inspector-context-tabs shared-inspector-tabs" id="inspector-context-tabs" role="tablist" aria-label="${escapeHtml(options.listLabel)}">${buttons}</div>`;
}
