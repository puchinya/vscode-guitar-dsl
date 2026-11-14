import { documentTabKey, sameDocumentIdentity, type DocumentIdentity } from '@guitardsl/document';

export interface DocumentTabView {
  document: { identity: DocumentIdentity; name: string };
  accountId?: string;
}

export function tabKey(tab: DocumentTabView): string {
  return documentTabKey(tab.document.identity, tab.accountId);
}

export function sameTabIdentity(tab: DocumentTabView, identity: DocumentIdentity, accountId?: string): boolean {
  return sameDocumentIdentity(tab.document.identity, identity)
    && (identity.storage !== 'drive' || tab.accountId === accountId);
}

export function activeTab<T extends DocumentTabView>(tabs: T[], activeKey: string | null): T | undefined {
  return tabs.find(tab => tabKey(tab) === activeKey);
}

export function renderDocumentTabs<T extends DocumentTabView>(
  container: HTMLElement,
  tabs: T[],
  activeKey: string | null,
  closeLabel: string,
  onActivate: (key: string) => void | Promise<void>,
  onClose: (tab: T) => void | Promise<void>
): void {
  container.replaceChildren();
  for (const tab of tabs) {
    const key = tabKey(tab);
    const wrapper = document.createElement('div');
    wrapper.className = `tab${key === activeKey ? ' active' : ''}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(key === activeKey));
    button.textContent = tab.document.name;
    button.title = tab.document.identity.storage === 'drive' ? `Google Drive · ${tab.document.name}` : tab.document.name;
    button.addEventListener('click', () => { void onActivate(key); });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.setAttribute('aria-label', `${closeLabel} ${tab.document.name}`);
    close.textContent = '×';
    close.addEventListener('click', event => {
      event.stopPropagation();
      void onClose(tab);
    });
    wrapper.append(button, close);
    container.append(wrapper);
  }
}
