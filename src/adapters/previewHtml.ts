import { compileGuitarDslToHtml as compileShared, type CompileHtmlOptions } from '@guitardsl/ui/previewHtml';

const vscodePreviewBridge = `window.guitarDslHost = (() => {
  if (typeof acquireVsCodeApi !== 'function') return null;
  const api = acquireVsCodeApi();
  return { postMessage: message => api.postMessage(message), getState: () => api.getState(), setState: state => api.setState(state) };
})();`;

/** VS Code host adapter for the shared Preview UI. */
export function compileGuitarDslToHtml(dslContent: string, options?: CompileHtmlOptions): string {
  return compileShared(dslContent, { ...options, hostBootstrapScript: vscodePreviewBridge });
}

export {
  buildProgressionAuditionPlaybackData,
  isPreviewFocusControl,
  isPreviewLayoutFocusControl,
  renderPracticeGuidePanel
} from '@guitardsl/ui/previewHtml';
export type {
  CompileHtmlOptions,
  PreviewFocusControl,
  PreviewLayoutFocusControl,
  ProgressionAuditionMode,
  ProgressionAuditionPlaybackData,
  ProgressionAuditionPlaybackResult,
  ScoreFontUris
} from '@guitardsl/ui/previewHtml';
