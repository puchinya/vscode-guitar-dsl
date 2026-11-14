export const WEB_PREVIEW_BRIDGE = `window.guitarDslHost = {
  postMessage: message => window.parent.postMessage({ channel: 'guitardsl-preview', message }, '*'),
  getState: () => null,
  setState: () => {}
};
const postContextMenu = (event, keyboard = false) => {
  const identity = document.body.dataset;
  const element = event.target instanceof Element ? event.target : document.activeElement;
  const target = element instanceof Element ? element.closest('[data-visual-binding]') : null;
  const focusedBindingId = target?.getAttribute('data-visual-binding') || '';
  const visualElementId = focusedBindingId || (keyboard && document.activeElement === document.body ? lastVisualElementId : '');
  const rect = keyboard && element instanceof Element ? element.getBoundingClientRect() : null;
  window.parent.postMessage({ channel: 'guitardsl-preview', message: {
    command: 'contextMenu', clientX: rect ? rect.left + 12 : event.clientX, clientY: rect ? rect.bottom : event.clientY,
    visualElementId,
    documentUri: identity.previewDocumentUri || '',
    documentVersion: Number(identity.previewDocumentVersion),
    previewGeneration: Number(identity.previewGeneration)
  } }, '*');
};
let lastVisualElementId = '';
document.addEventListener('click', event => {
  const element = event.target instanceof Element ? event.target : null;
  lastVisualElementId = element?.closest('[data-visual-binding]')?.getAttribute('data-visual-binding') || '';
});
document.addEventListener('contextmenu', event => {
  event.preventDefault();
  postContextMenu(event);
});
document.addEventListener('keydown', event => {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  event.preventDefault();
  postContextMenu(event, true);
});`;

export const WEB_PREVIEW_STYLE = `
  :root { color-scheme: light; --vscode-editorWidget-background:#fff; --vscode-editorWidget-border:#dfe2e7;
    --vscode-foreground:#20242b; --vscode-descriptionForeground:#68717e; --vscode-widget-border:#d9dde5;
    --vscode-input-background:#fff; --vscode-input-foreground:#20242b; --vscode-button-background:#5364d9;
    --vscode-button-border:#5364d9; --vscode-button-secondaryBackground:#f2f3f6;
    --vscode-button-secondaryForeground:#343a46; --vscode-button-secondaryHoverBackground:#e7e9f0;
    --vscode-focusBorder:#5364d9; }
  body { padding-top: 102px; background:#f4f5f7; color:#20242b; }
  .toolbar-container,.score-settings-row { box-shadow:none; }
  @media(prefers-color-scheme:dark) { :root { color-scheme:dark; --vscode-editorWidget-background:#242830;
    --vscode-editorWidget-border:#3a3f4a; --vscode-foreground:#e4e7ee; --vscode-descriptionForeground:#aeb5c2;
    --vscode-widget-border:#454c59; --vscode-input-background:#1e2127; --vscode-input-foreground:#e4e7ee;
    --vscode-button-background:#6877eb; --vscode-button-border:#6877eb; --vscode-button-secondaryBackground:#2e333d;
    --vscode-button-secondaryForeground:#e4e7ee; --vscode-button-secondaryHoverBackground:#3b424e;
    --vscode-focusBorder:#8792ea; }
    body { background:#1e2127; color:#e4e7ee; } }
`;

export type PreviewMessage = Record<string, unknown>;
export type PreviewPostMessage = (payload: Record<string, unknown>) => void;

/** Validates the sandboxed Preview message boundary and exposes a host-neutral handler. */
export function listenForPreviewMessages(
  frame: HTMLIFrameElement,
  handler: (message: PreviewMessage, postToFrame: PreviewPostMessage) => void
): () => void {
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== frame.contentWindow) return;
    const envelope = event.data as { channel?: string; message?: PreviewMessage } | undefined;
    if (envelope?.channel !== 'guitardsl-preview' || !envelope.message) return;
    handler(envelope.message, payload => frame.contentWindow?.postMessage(payload, '*'));
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
