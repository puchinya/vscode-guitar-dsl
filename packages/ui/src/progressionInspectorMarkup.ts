import type { Messages } from '@guitardsl/core/i18n';

function escape(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/** Shared four-tab Inspector progression panel used by the VS Code Webview and Web SPA. */
export function renderProgressionInspectorMarkup(
  messages: Messages,
  options: { hidden?: boolean; repeatNoticeVisible?: boolean } = {}
): string {
  const hidden = options.hidden === false ? '' : ' hidden';
  const repeatNotice = options.repeatNoticeVisible ? '' : ' hidden';
  return `<section id="progression-state" role="tabpanel" tabindex="0" aria-labelledby="inspector-tab-progression"${hidden}>
    <h2 id="progression-heading">${escape(messages.uiProgressionTitle)}</h2>
    <p id="progression-description" class="description">${escape(messages.uiProgressionDescription)}</p>
    <fieldset><legend id="bars-legend">${escape(messages.progressionLengthPrompt)}</legend><div class="choice-row" id="bars-options"></div></fieldset>
    <fieldset><legend id="operation-legend">${escape(messages.progressionOperationPrompt)}</legend><div class="choice-row" id="operation-options"></div></fieldset>
    <h2 id="candidate-heading">${escape(messages.progressionCandidatePrompt)}</h2>
    <p id="progression-repeat-notice" class="description repeat-notice"${repeatNotice}></p>
    <ul id="candidate-list" class="candidate-list"></ul>
    <p id="progression-error" class="error" role="alert" hidden></p>
    <div class="toolbar">
      <button id="progression-play" type="button" data-inspector-control="play" data-inspector-key="play">${escape(messages.uiProgressionAudition)}</button>
      <button id="progression-stop" type="button" data-inspector-control="stop" data-inspector-key="stop" disabled>${escape(messages.uiStop)}</button>
      <label class="mode-control"><span id="audition-mode-label">${escape(messages.uiProgressionAuditionMode)}</span><select id="progression-audition-mode">
        <option value="chord">${escape(messages.uiProgressionChord)}</option>
        <option value="bars">${escape(messages.uiProgressionBars)}</option>
        <option value="melody">${escape(messages.uiProgressionWithMelody)}</option>
        <option value="song">${escape(messages.uiProgressionFullSong)}</option>
      </select></label>
      <div class="side-group" role="group" aria-label="${escape(messages.uiProgressionTitle)}">
        <button id="progression-side-a" type="button" aria-pressed="false">${escape(messages.uiProgressionSideA)}</button>
        <button id="progression-side-b" type="button" aria-pressed="false">${escape(messages.uiProgressionSideB)}</button>
      </div>
      <label class="speed-control"><span id="speed-label">${escape(messages.uiProgressionSpeed)}</span><select id="progression-speed">
        <option value="50">50%</option><option value="75">75%</option><option value="100" selected>100%</option><option value="125">125%</option><option value="150">150%</option>
      </select></label>
    </div>
    <p id="progression-audio-status" class="description" role="status" aria-live="polite"></p>
    <div class="actions">
      <button id="progression-apply" type="button">${escape(messages.uiProgressionApply)}</button>
      <button id="progression-cancel" type="button">${escape(messages.uiProgressionClose)}</button>
    </div>
  </section>`;
}
