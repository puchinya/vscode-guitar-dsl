<script setup lang="ts">
import ExplorerPane from './ExplorerPane.vue';
import DocumentTabs from './DocumentTabs.vue';
import SourceEditorHost from './SourceEditorHost.vue';
import ScorePreviewHost from './ScorePreviewHost.vue';
import InspectorHost from './InspectorHost.vue';
import ProblemsPane from './ProblemsPane.vue';
import GridSplitter from './GridSplitter.vue';
import type { WorkspaceCommand, WorkspaceHostBindings, WorkspaceViewSnapshot } from '../types/workspace';

const props = defineProps<{ snapshot: Readonly<WorkspaceViewSnapshot>; controller: WorkspaceHostBindings }>();
const emit = defineEmits<{ command: [command: WorkspaceCommand] }>();
const text = (ja: string, en: string) => props.snapshot.locale === 'ja' ? ja : en;
const maxProblemsHeight = () => Math.floor(window.innerHeight * 0.45);
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
    :style="{ '--explorer-width': `${snapshot.explorerWidth}px`, '--inspector-width': `${snapshot.inspectorWidth}px`, '--problems-height': `${snapshot.problemsHeight}px` }"
  >
    <nav class="activity-bar" :aria-label="text('ワークスペースツール', 'Workspace tools')">
      <button type="button" id="activity-explorer" :aria-label="text('エクスプローラーの表示切替', 'Toggle Explorer')" :title="text('エクスプローラーの表示切替', 'Toggle Explorer')" :aria-pressed="snapshot.explorerOpen" @click="emit('command', { type: 'panel.toggle', panel: 'explorer' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-folder"></use></svg></button>
      <span class="activity-spacer"></span>
      <button type="button" id="toggle-problems" :aria-label="text('問題', 'Problems')" :title="text('問題', 'Problems')" :aria-expanded="snapshot.problemsOpen" @click="emit('command', { type: 'panel.toggle', panel: 'problems' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-problems"></use></svg><span id="tool-window-count" :hidden="snapshot.diagnostics.length === 0">{{ snapshot.diagnostics.length || '' }}</span><span class="sr-only">{{ text('問題', 'Problems') }}</span></button>
    </nav>
    <ExplorerPane :snapshot="snapshot" @command="emit('command', $event)" />
    <GridSplitter id="explorer-splitter" class="workspace-splitter" splitter="explorer" orientation="vertical" :label="text('Explorer の幅を変更', 'Resize Explorer')" :min="180" :max="420" :value="snapshot.explorerWidth" @command="emit('command', $event)" />
    <section class="editor-workspace" :aria-label="text('楽譜ワークスペース', 'Score workspace')">
      <DocumentTabs :snapshot="snapshot" @command="emit('command', $event)" />
      <div class="split-view" :style="{ '--split-ratio': `${snapshot.splitRatio * 100}%` }">
        <SourceEditorHost :snapshot="snapshot" :controller="controller" />
        <GridSplitter id="center-splitter" class="split-divider" splitter="center" orientation="vertical" :label="text('ソースと譜面の幅を変更', 'Resize source and score panes')" :min="5" :max="95" :value="Math.round(snapshot.splitRatio * 100)" @command="emit('command', $event)" />
        <ScorePreviewHost :controller="controller" />
      </div>
    </section>
    <GridSplitter id="inspector-splitter" class="workspace-splitter" splitter="inspector" orientation="vertical" :label="text('Inspector の幅を変更', 'Resize Inspector')" :min="260" :max="480" :value="snapshot.inspectorWidth" @command="emit('command', $event)" />
    <InspectorHost :snapshot="snapshot" :controller="controller" @command="emit('command', $event)" />
    <GridSplitter id="problems-splitter" class="problems-splitter" splitter="problems" orientation="horizontal" :label="text('問題パネルの高さを変更', 'Resize Problems')" :min="140" :max="maxProblemsHeight()" :value="snapshot.problemsHeight" @command="emit('command', $event)" />
    <ProblemsPane @command="emit('command', $event)" />
    <div class="tool-window-bar" role="group" :aria-label="text('ツールウィンドウ', 'Tool windows')"><button type="button" id="toggle-inspector" :aria-label="text('Inspector の表示切替', 'Toggle Inspector')" :title="text('Inspector の表示切替', 'Toggle Inspector')" :aria-pressed="snapshot.inspectorOpen" @click="emit('command', { type: 'panel.toggle', panel: 'inspector' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-inspector"></use></svg><span class="sr-only">{{ text('Inspector の表示切替', 'Toggle Inspector') }}</span></button></div>
  </div>
</template>
