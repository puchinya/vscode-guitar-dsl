export type WebIconName =
  | 'music' | 'code' | 'split' | 'eye' | 'save' | 'pdf' | 'account' | 'help' | 'settings'
  | 'folder' | 'cloud' | 'fileplus' | 'import' | 'problems' | 'close' | 'down' | 'inspector';

/** Self-contained icon paths adapted from the Issue #172 SVG UI contract. */
export const WEB_ICON_SPRITE = `<svg class="icon-sprite" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
  <symbol id="ic-music" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M9 19V6l12-2v12"/><circle cx="6" cy="19" r="3"/><circle cx="18" cy="16" r="3"/></g></symbol>
  <symbol id="ic-code" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="m8 8-4 4 4 4m8-8 4 4-4 4M14 5l-4 14"/></g></symbol>
  <symbol id="ic-split" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></g></symbol>
  <symbol id="ic-eye" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></g></symbol>
  <symbol id="ic-save" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M4 3h13l4 4v14H3V3h1Z"/><path d="M7 3v7h10V3M7 21v-7h10v7"/></g></symbol>
  <symbol id="ic-pdf" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M6 2h9l5 5v15H6z"/><path d="M15 2v6h5"/><path d="M9 15h8M9 18h6"/></g></symbol>
  <symbol id="ic-account" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="9" r="3"/><path d="M5.8 19a6.5 6.5 0 0 1 12.4 0"/></g></symbol>
  <symbol id="ic-help" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><circle cx="12" cy="12" r="10"/><path d="M9 9a3.3 3.3 0 1 1 5 2.8c-1.3 1-2 1.5-2 3"/><path d="M12 18h.01" stroke-width="3"/></g></symbol>
  <symbol id="ic-settings" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M10.4 2h3.2l.6 2.4a8.2 8.2 0 0 1 2 .9l2.2-1.2 2.2 2.2-1.2 2.2c.4.6.7 1.2.9 2l2.4.6v3.2l-2.4.6a8 8 0 0 1-.9 2l1.2 2.2-2.2 2.2-2.2-1.2a8 8 0 0 1-2 .9l-.6 2.4h-3.2l-.6-2.4a8 8 0 0 1-2-.9l-2.2 1.2-2.2-2.2 1.2-2.2a8 8 0 0 1-.9-2l-2.4-.6v-3.2l2.4-.6a8 8 0 0 1 .9-2L3.4 6.3l2.2-2.2 2.2 1.2a8 8 0 0 1 2-.9L10.4 2Z"/><circle cx="12" cy="12" r="3.2"/></g></symbol>
  <symbol id="ic-folder" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/></g></symbol>
  <symbol id="ic-cloud" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M7 19h11a4 4 0 0 0 .3-8 6.8 6.8 0 0 0-13.2-1.2A4.5 4.5 0 0 0 7 19Z"/></g></symbol>
  <symbol id="ic-fileplus" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5M9 15h8m-4-4v8"/></g></symbol>
  <symbol id="ic-import" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M12 3v13m-5-5 5 5 5-5M4 18v4h16v-4"/></g></symbol>
  <symbol id="ic-problems" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><circle cx="12" cy="12" r="10"/><path d="M12 7v7m0 3h.01" stroke-width="2.6"/></g></symbol>
  <symbol id="ic-close" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="m5 5 14 14M19 5 5 19"/></g></symbol>
  <symbol id="ic-down" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="m5 9 7 7 7-7"/></g></symbol>
  <symbol id="ic-inspector" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></g></symbol>
</svg>`;

export function createWebIcon(name: WebIconName): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(ns, 'svg');
  icon.classList.add('web-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `#ic-${name}`);
  icon.append(use);
  return icon;
}

export function setIconButton(button: HTMLButtonElement, name: WebIconName, label: string): void {
  button.setAttribute('aria-label', label);
  button.title = label;
  const accessibleName = document.createElement('span');
  accessibleName.className = 'sr-only';
  accessibleName.textContent = label;
  button.replaceChildren(createWebIcon(name), accessibleName);
}
