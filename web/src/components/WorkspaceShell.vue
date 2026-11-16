<script setup lang="ts">
import ExplorerPane from './ExplorerPane.vue';
import DocumentTabs from './DocumentTabs.vue';
import SourceEditorHost from './SourceEditorHost.vue';
import ScorePreviewHost from './ScorePreviewHost.vue';
import InspectorHost from './InspectorHost.vue';
import ProblemsPane from './ProblemsPane.vue';
import type { WorkspaceCommand, WorkspaceHostBindings, WorkspaceViewSnapshot } from '../types/workspace';

const props = defineProps<{ snapshot: Readonly<WorkspaceViewSnapshot>; controller: WorkspaceHostBindings }>();
const emit = defineEmits<{ command: [command: WorkspaceCommand] }>();
const text = (ja: string, en: string) => props.snapshot.locale === 'ja' ? ja : en;
function splitterEvent(splitter: 'explorer' | 'center' | 'inspector' | 'problems', phase: 'start' | 'move' | 'end' | 'cancel' | 'reset' | 'keyboard', event?: PointerEvent | KeyboardEvent): void {
  const command: WorkspaceCommand = {
    type: 'splitter.event', splitter, phase,
    ...(event instanceof PointerEvent ? { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY } : {}),
    ...(event instanceof KeyboardEvent ? { key: event.key, shiftKey: event.shiftKey } : {})
  };
  emit('command', command);
}
function pointerDown(splitter: 'explorer' | 'center' | 'inspector' | 'problems', event: PointerEvent): void {
  const target = event.currentTarget;
  if (target instanceof HTMLElement) target.setPointerCapture(event.pointerId);
  event.preventDefault();
  splitterEvent(splitter, 'start', event);
}
function keyDown(splitter: 'explorer' | 'center' | 'inspector' | 'problems', event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  splitterEvent(splitter, 'keyboard', event);
}
</script>

<template>
  <div
    class="workspace"
    id="workspace"
    :class="{
      'explorer-closed': !snapshot.explorerOpen,
      'explorer-auto-hidden': snapshot.explorerAutoHidden,
      'inspector-closed': !snapshot.inspectorOpen,
      'inspector-auto-hidden': snapshot.inspectorAutoHidden,
      'problems-collapsed': !snapshot.problemsOpen,
      'view-source': snapshot.viewMode === 'source',
      'view-score': snapshot.viewMode === 'score',
      'view-split': snapshot.viewMode === 'split'
    }"
    :style="{ '--explorer-width': `${snapshot.explorerWidth}px`, '--inspector-width': `${snapshot.inspectorWidth}px`, '--problems-height': `${snapshot.problemsHeight}px`, '--split-ratio': `${snapshot.splitRatio * 100}%` }"
  >
    <nav class="activity-bar" :aria-label="text('ワークスペースツール', 'Workspace tools')">
      <button type="button" id="activity-explorer" :aria-label="text('Explorer の表示切替', 'Toggle Explorer')" :title="text('Explorer の表示切替', 'Toggle Explorer')" :aria-pressed="snapshot.explorerOpen" @click="emit('command', { type: 'panel.toggle', panel: 'explorer' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-folder"></use></svg></button>
      <span class="activity-spacer"></span>
      <button type="button" id="toggle-problems" :aria-label="text('問題', 'Problems')" :title="text('問題', 'Problems')" :aria-expanded="snapshot.problemsOpen" @click="emit('command', { type: 'panel.toggle', panel: 'problems' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-problems"></use></svg><span id="tool-window-count">{{ snapshot.diagnostics.length || '' }}</span><span class="sr-only">{{ text('問題', 'Problems') }}</span></button>
    </nav>
    <ExplorerPane :snapshot="snapshot" @command="emit('command', $event)" />
    <div class="workspace-splitter" id="explorer-splitter" role="separator" aria-orientation="vertical" :aria-label="text('Explorer の幅を変更', 'Resize Explorer')" aria-valuemin="180" aria-valuemax="420" :aria-valuenow="snapshot.explorerWidth" tabindex="0" @pointerdown="pointerDown('explorer', $event)" @pointermove="splitterEvent('explorer', 'move', $event)" @pointerup="splitterEvent('explorer', 'end', $event)" @pointercancel="splitterEvent('explorer', 'cancel', $event)" @lostpointercapture="splitterEvent('explorer', 'cancel', $event)" @dblclick="splitterEvent('explorer', 'reset')" @keydown="keyDown('explorer', $event)"></div>
    <section class="editor-workspace" :aria-label="text('楽譜ワークスペース', 'Score workspace')">
      <DocumentTabs :snapshot="snapshot" @command="emit('command', $event)" />
      <div v-if="snapshot.message" id="app-message" class="app-message" :class="snapshot.message.kind" :data-kind="snapshot.message.kind" role="status" @click="emit('command', { type: 'message.dismiss' })">{{ snapshot.message.text }}</div>
      <div class="split-view" :style="{ '--split-ratio': `${snapshot.splitRatio * 100}%` }">
        <SourceEditorHost :snapshot="snapshot" :controller="controller" />
        <div class="split-divider" id="center-splitter" role="separator" aria-orientation="vertical" :aria-label="text('ソースと譜面の幅を変更', 'Resize source and score panes')" aria-valuemin="5" aria-valuemax="95" :aria-valuenow="Math.round(snapshot.splitRatio * 100)" tabindex="0" @pointerdown="pointerDown('center', $event)" @pointermove="splitterEvent('center', 'move', $event)" @pointerup="splitterEvent('center', 'end', $event)" @pointercancel="splitterEvent('center', 'cancel', $event)" @lostpointercapture="splitterEvent('center', 'cancel', $event)" @dblclick="splitterEvent('center', 'reset')" @keydown="keyDown('center', $event)"></div>
        <ScorePreviewHost :controller="controller" />
      </div>
    </section>
    <div class="workspace-splitter" id="inspector-splitter" role="separator" aria-orientation="vertical" :aria-label="text('Inspector の幅を変更', 'Resize Inspector')" aria-valuemin="260" aria-valuemax="480" :aria-valuenow="snapshot.inspectorWidth" tabindex="0" @pointerdown="pointerDown('inspector', $event)" @pointermove="splitterEvent('inspector', 'move', $event)" @pointerup="splitterEvent('inspector', 'end', $event)" @pointercancel="splitterEvent('inspector', 'cancel', $event)" @lostpointercapture="splitterEvent('inspector', 'cancel', $event)" @dblclick="splitterEvent('inspector', 'reset')" @keydown="keyDown('inspector', $event)"></div>
    <InspectorHost :snapshot="snapshot" :controller="controller" @command="emit('command', $event)" />
    <div class="problems-splitter" id="problems-splitter" role="separator" aria-orientation="horizontal" :aria-label="text('問題パネルの高さを変更', 'Resize Problems')" aria-valuemin="140" aria-valuemax="360" :aria-valuenow="snapshot.problemsHeight" tabindex="0" @pointerdown="pointerDown('problems', $event)" @pointermove="splitterEvent('problems', 'move', $event)" @pointerup="splitterEvent('problems', 'end', $event)" @pointercancel="splitterEvent('problems', 'cancel', $event)" @lostpointercapture="splitterEvent('problems', 'cancel', $event)" @dblclick="splitterEvent('problems', 'reset')" @keydown="keyDown('problems', $event)"></div>
    <ProblemsPane @command="emit('command', $event)" />
    <div class="tool-window-bar" role="group" :aria-label="text('ツールウィンドウ', 'Tool windows')"><button type="button" id="toggle-inspector" :aria-label="text('Inspector の表示切替', 'Toggle Inspector')" :title="text('Inspector の表示切替', 'Toggle Inspector')" :aria-pressed="snapshot.inspectorOpen" @click="emit('command', { type: 'panel.toggle', panel: 'inspector' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-inspector"></use></svg><span class="sr-only">{{ text('Inspector の表示切替', 'Toggle Inspector') }}</span></button></div>
  </div>
</template>
