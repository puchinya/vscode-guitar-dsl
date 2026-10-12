import { getMessages, type SupportedLocale } from '../i18n';
import type { InspectorContext } from '../inspector/inspectorController';

export function renderInspectorHtml(
  locale: SupportedLocale,
  context: InspectorContext,
  cspSource: string,
  nonce: string,
  generation = 0
): string {
  const messages = getMessages(locale);
  const status = context.kind === 'document' ? messages.inspectorDocumentStatus : messages.inspectorEmptyStatus;
  const description = context.kind === 'document'
    ? messages.inspectorDocumentDescription
    : messages.inspectorEmptyDescription;
  const safeNonce = escapeHtml(nonce);
  const safeGeneration = Number.isSafeInteger(generation) && generation >= 0 ? generation : 0;
  const csp = [
    "default-src 'none'",
    'img-src ' + escapeHtml(cspSource),
    "font-src 'none'",
    "style-src 'nonce-" + safeNonce + "'",
    "script-src 'nonce-" + safeNonce + "'",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');

  return [
    '<!DOCTYPE html>',
    '<html lang="' + locale + '">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '  <meta http-equiv="Content-Security-Policy" content="' + csp + '">',
    '  <title>' + escapeHtml(messages.inspectorHeading) + '</title>',
    '  <style nonce="' + safeNonce + '">',
    '    :root { color-scheme: light dark; }',
    '    * { box-sizing: border-box; }',
    '    html, body { min-height: 100%; }',
    '    body {',
    '      margin: 0;',
    '      background: var(--vscode-sideBar-background);',
    '      color: var(--vscode-foreground);',
    '      font-family: var(--vscode-font-family);',
    '      font-size: var(--vscode-font-size);',
    '      line-height: 1.5;',
    '    }',
    '    main {',
    '      width: min(100%, 42rem);',
    '      margin: 0 auto;',
    '      padding: clamp(16px, 5vw, 28px);',
    '    }',
    '    h1 { margin: 0 0 16px; font-size: 1.2em; font-weight: 600; }',
    '    .status {',
    '      margin: 0 0 10px;',
    '      padding-left: 12px;',
    '      border-left: 2px solid var(--vscode-focusBorder);',
    '      font-weight: 600;',
    '    }',
    '    .description {',
    '      margin: 0;',
    '      color: var(--vscode-descriptionForeground);',
    '      overflow-wrap: anywhere;',
    '    }',
    '    @media (max-width: 600px) {',
    '      main { padding: 14px; }',
    '      h1 { font-size: 1.1em; }',
    '    }',
    '  </style>',
    '</head>',
    '<body>',
    '  <main id="inspector-state" data-generation="' + safeGeneration + '" data-context-kind="' + context.kind + '" aria-label="' + escapeHtml(messages.inspectorRegionLabel) + '" aria-labelledby="inspector-heading">',
    '    <h1 id="inspector-heading">' + escapeHtml(messages.inspectorHeading) + '</h1>',
    '    <p id="inspector-status" class="status" role="status" aria-live="polite">' + escapeHtml(status) + '</p>',
    '    <p id="inspector-description" class="description">' + escapeHtml(description) + '</p>',
    '  </main>',
    '  <script nonce="' + safeNonce + '">',
    '    (() => {',
    '      const root = document.getElementById("inspector-state");',
    '      const status = document.getElementById("inspector-status");',
    '      const description = document.getElementById("inspector-description");',
    '      let lastGeneration = Number(root.dataset.generation);',
    '      const vscodeApi = acquireVsCodeApi();',
    '      window.addEventListener("message", event => {',
    '        const message = event.data;',
    '        if (!message || message.command !== "setContext" || !Number.isSafeInteger(message.generation) || message.generation <= lastGeneration) return;',
    '        if (message.kind !== "empty" && message.kind !== "document") return;',
    '        lastGeneration = message.generation;',
    '        root.dataset.generation = String(message.generation);',
    '        root.dataset.contextKind = message.kind;',
    '        status.textContent = message.status;',
    '        description.textContent = message.description;',
    '      });',
    '      vscodeApi.postMessage({ command: "ready" });',
    '    })();',
    '  </script>',
    '</body>',
    '</html>'
  ].join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
