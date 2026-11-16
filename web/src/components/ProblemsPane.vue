<script setup lang="ts">
import { computed } from 'vue';
import type { WorkspaceCommand } from '../types/workspace';
import { useWorkspaceStore } from '../stores/workspaceStore';

const workspaceStore = useWorkspaceStore();
const snapshot = computed(() => {
  const current = workspaceStore.view;
  if (current === null) throw new Error('Workspace store must be attached before ProblemsPane is rendered.');
  return current;
});
const emit = defineEmits<{ command: [command: WorkspaceCommand] }>();
const text = (ja: string, en: string) => snapshot.value.locale === 'ja' ? ja : en;
</script>

<template>
  <section class="problems-panel" id="problems-panel" aria-label="Problems" :hidden="!snapshot.problemsOpen">
    <header class="problems-heading"><svg class="web-icon problems-heading-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-problems"></use></svg><strong id="problems-title">{{ text('問題', 'Problems') }}</strong><div id="problem-counts" aria-live="polite"><span class="problem-count problem-count-errors" :class="{ zero: !snapshot.diagnostics.some(d => d.severity === 'error') }"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-error"></use></svg><span id="error-count">{{ snapshot.diagnostics.filter(d => d.severity === 'error').length }}</span></span><span class="problem-count problem-count-warnings" :class="{ zero: !snapshot.diagnostics.some(d => d.severity === 'warning') }"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-warning"></use></svg><span id="warning-count">{{ snapshot.diagnostics.filter(d => d.severity === 'warning').length }}</span></span></div><span class="toolbar-spacer"></span><button type="button" id="close-problems" class="icon-action" :aria-label="text('問題を閉じる', 'Close Problems')" :title="text('問題を閉じる', 'Close Problems')" @click="emit('command', { type: 'panel.set-open', panel: 'problems', open: false })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-close"></use></svg></button></header>
    <div class="problem-columns" id="problem-columns"><span id="problem-severity-heading">{{ text('重要度', 'Severity') }}</span><span id="problem-file-heading">{{ text('ファイル', 'File') }}</span><span id="problem-location-heading">{{ text('行:列', 'Line:Col') }}</span><span id="problem-message-heading">{{ text('メッセージ', 'Message') }}</span></div>
    <div class="diagnostics" id="diagnostics" role="list" aria-live="polite">
      <div v-for="(diagnostic, index) in snapshot.diagnostics" :key="`${diagnostic.file}:${diagnostic.from}:${diagnostic.severity}`" class="problem-row" :class="`problem-${diagnostic.severity}`" role="listitem"><span class="problem-severity" :data-severity="diagnostic.severity"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use :href="diagnostic.severity === 'error' ? '#ic-error' : '#ic-warning'"></use></svg>{{ diagnostic.severity }}</span><span class="problem-file">{{ diagnostic.file }}</span><span class="problem-location">{{ diagnostic.line }}:{{ diagnostic.column }}</span><button class="problem-message" type="button" @click="emit('command', { type: 'diagnostic.activate', index })">{{ diagnostic.message }}</button></div>
      <div v-if="!snapshot.diagnostics.length" class="empty-state">{{ text('問題はありません', 'No problems') }}</div>
    </div>
  </section>
</template>
