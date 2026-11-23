<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import ExplorerPane from './ExplorerPane.vue';
import DocumentTabs from './DocumentTabs.vue';
import SourceEditorHost from './SourceEditorHost.vue';
import ScorePreviewHost from './ScorePreviewHost.vue';
import InspectorHost from './InspectorHost.vue';
import ProblemsPane from './ProblemsPane.vue';
import WelcomePage from './WelcomePage.vue';
import GridSplitter from './GridSplitter.vue';
import type { WorkspaceCommand, WorkspaceHostBindings, WorkspaceViewSnapshot } from '../types/workspace';

defineProps<{ snapshot: Readonly<WorkspaceViewSnapshot>; controller: WorkspaceHostBindings }>();
const emit = defineEmits<{ command: [command: WorkspaceCommand] }>();
const { t } = useI18n({ useScope: 'global' });
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
    <nav class="activity-bar" :aria-label="t('workspace.tools')">
      <button type="button" id="activity-explorer" :aria-label="t('workspace.toggleExplorer')" :title="t('workspace.toggleExplorer')" :aria-pressed="snapshot.explorerOpen" @click="emit('command', { type: 'panel.toggle', panel: 'explorer' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-folder"></use></svg></button>
      <span class="activity-spacer"></span>
      <button type="button" id="toggle-problems" :aria-label="t('problems.title')" :title="t('problems.title')" :aria-expanded="snapshot.problemsOpen" @click="emit('command', { type: 'panel.toggle', panel: 'problems' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-problems"></use></svg><span id="tool-window-count" :hidden="snapshot.diagnostics.length === 0">{{ snapshot.diagnostics.length || '' }}</span><span class="sr-only">{{ t('problems.title') }}</span></button>
    </nav>
    <ExplorerPane :snapshot="snapshot" @command="emit('command', $event)" />
    <GridSplitter id="explorer-splitter" class="workspace-splitter" splitter="explorer" orientation="vertical" :label="t('workspace.resizeExplorer')" :min="180" :max="420" :value="snapshot.explorerWidth" @command="emit('command', $event)" />
    <section class="editor-workspace" :aria-label="t('workspace.score')">
      <DocumentTabs :snapshot="snapshot" @command="emit('command', $event)" />
      <WelcomePage v-if="snapshot.welcomeOpen" v-show="snapshot.welcomeActive" :snapshot="snapshot" @command="emit('command', $event)" />
      <div v-show="snapshot.tabs.length > 0 && !snapshot.welcomeActive" class="split-view" :style="{ '--split-ratio': `${snapshot.splitRatio * 100}%` }">
        <SourceEditorHost :snapshot="snapshot" :controller="controller" />
        <GridSplitter id="center-splitter" class="split-divider" splitter="center" orientation="vertical" :label="t('workspace.resizeSourceAndScore')" :min="5" :max="95" :value="Math.round(snapshot.splitRatio * 100)" @command="emit('command', $event)" />
        <ScorePreviewHost :controller="controller" />
      </div>
    </section>
    <GridSplitter id="inspector-splitter" class="workspace-splitter" splitter="inspector" orientation="vertical" :label="t('workspace.resizeInspector')" :min="260" :max="480" :value="snapshot.inspectorWidth" @command="emit('command', $event)" />
    <InspectorHost :snapshot="snapshot" :controller="controller" @command="emit('command', $event)" />
    <GridSplitter id="problems-splitter" class="problems-splitter" splitter="problems" orientation="horizontal" :label="t('workspace.resizeProblems')" :min="140" :max="maxProblemsHeight()" :value="snapshot.problemsHeight" @command="emit('command', $event)" />
    <ProblemsPane @command="emit('command', $event)" />
    <div class="tool-window-bar" role="group" :aria-label="t('workspace.toolWindows')"><button type="button" id="toggle-inspector" :aria-label="t('workspace.toggleInspector')" :title="t('workspace.toggleInspector')" :aria-pressed="snapshot.inspectorOpen && snapshot.rightDockPane === 'inspector'" @click="emit('command', { type: 'panel.select-right', pane: 'inspector', mode: 'toggle' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-inspector"></use></svg><span class="sr-only">{{ t('workspace.toggleInspector') }}</span></button><button type="button" id="toggle-tutorial" :aria-label="t('workspace.toggleTutorial')" :title="t('workspace.toggleTutorial')" :aria-pressed="snapshot.inspectorOpen && snapshot.rightDockPane === 'tutorial'" @click="emit('command', { type: 'panel.select-right', pane: 'tutorial', mode: 'toggle' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-help"></use></svg><span class="sr-only">{{ t('workspace.toggleTutorial') }}</span></button></div>
  </div>
</template>
