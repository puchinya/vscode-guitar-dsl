<script setup lang="ts">
import type { WorkspaceCommand, WorkspaceViewSnapshot } from '../types/workspace';

const props = defineProps<{ snapshot: Readonly<WorkspaceViewSnapshot> }>();
const emit = defineEmits<{ command: [command: WorkspaceCommand] }>();
const text = (ja: string, en: string) => props.snapshot.locale === 'ja' ? ja : en;
</script>

<template>
  <div class="tabs" :aria-label="snapshot.tabs.length ? text('開いている文書とワークスペース表示', 'Open documents and workspace views') : undefined">
    <div v-if="snapshot.tabs.length" class="document-tabs" role="tablist" id="open-tabs">
      <div v-for="tab in snapshot.tabs" :key="tab.key" class="tab" :class="{ active: tab.key === snapshot.activeKey }" :data-document-tab-key="tab.key">
        <button type="button" role="tab" :aria-selected="tab.key === snapshot.activeKey" :title="tab.name" @click="emit('command', { type: 'document.activate', key: tab.key })">{{ tab.name }}</button>
        <span class="tab-save-state" :data-state="tab.saveStatus" aria-hidden="true"></span>
        <button type="button" class="tab-close" :aria-label="`${text('閉じる', 'Close')} ${tab.name}`" :title="`${text('閉じる', 'Close')} ${tab.name}`" @click.stop="emit('command', { type: 'document.close', key: tab.key })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-close"></use></svg></button>
      </div>
    </div>
    <div v-if="snapshot.tabs.length" class="view-mode-controls" role="group" :aria-label="text('ワークスペース表示', 'Workspace view')">
      <button type="button" class="view-mode-button" id="view-source" :aria-label="text('ソース表示', 'Source view')" :aria-pressed="snapshot.viewMode === 'source'" @click="emit('command', { type: 'view.set-mode', mode: 'source' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-code"></use></svg></button>
      <button type="button" class="view-mode-button" id="view-split" :aria-label="text('分割表示', 'Split view')" :aria-pressed="snapshot.viewMode === 'split'" @click="emit('command', { type: 'view.set-mode', mode: 'split' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-split"></use></svg></button>
      <button type="button" class="view-mode-button" id="view-score" :aria-label="text('譜面表示', 'Score view')" :aria-pressed="snapshot.viewMode === 'score'" @click="emit('command', { type: 'view.set-mode', mode: 'score' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-eye"></use></svg></button>
    </div>
  </div>
</template>
