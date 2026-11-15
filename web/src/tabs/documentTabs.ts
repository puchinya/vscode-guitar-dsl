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
