<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { WorkspaceCommand, WorkspaceViewSnapshot } from '../types/workspace';

const props = defineProps<{ snapshot: Readonly<WorkspaceViewSnapshot> }>();
const emit = defineEmits<{ command: [command: WorkspaceCommand] }>();
const { t } = useI18n({ useScope: 'global' });
</script>

<template>
  <div class="tabs" :class="{ 'tabs-empty': snapshot.tabs.length === 0 && !snapshot.welcomeOpen }" :aria-label="snapshot.tabs.length || snapshot.welcomeOpen ? t('tabs.openDocumentsAndViews') : undefined">
    <div v-if="snapshot.tabs.length || snapshot.welcomeOpen" class="document-tabs" role="tablist" id="open-tabs">
      <div v-if="snapshot.welcomeOpen" class="tab" :class="{ active: snapshot.welcomeActive }">
        <button type="button" role="tab" :aria-selected="snapshot.welcomeActive" @click="emit('command', { type: 'welcome.open' })">{{ t('tabs.welcome') }}</button>
        <button type="button" class="tab-close" :aria-label="t('tabs.closeWelcome')" :title="t('tabs.closeWelcome')" @click.stop="emit('command', { type: 'welcome.close' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-close"></use></svg></button>
      </div>
      <div v-for="tab in snapshot.tabs" :key="tab.key" class="tab" :class="{ active: !snapshot.welcomeActive && tab.key === snapshot.activeKey }" :data-document-tab-key="tab.key">
        <button type="button" role="tab" :aria-selected="!snapshot.welcomeActive && tab.key === snapshot.activeKey" :title="tab.name" @click="emit('command', { type: 'document.activate', key: tab.key })">{{ tab.name }}</button>
        <span class="tab-save-state" :data-state="tab.saveStatus" aria-hidden="true"></span>
        <button type="button" class="tab-close" :aria-label="t('tabs.closeDocument', { name: tab.name })" :title="t('tabs.closeDocument', { name: tab.name })" @click.stop="emit('command', { type: 'document.close', key: tab.key })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-close"></use></svg></button>
      </div>
    </div>
    <div v-if="snapshot.tabs.length && !snapshot.welcomeActive" class="view-mode-controls" role="group" :aria-label="t('tabs.workspaceView')">
      <button type="button" class="view-mode-button" id="view-source" :aria-label="t('tabs.sourceView')" :aria-pressed="snapshot.viewMode === 'source'" @click="emit('command', { type: 'view.set-mode', mode: 'source' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-code"></use></svg></button>
      <button type="button" class="view-mode-button" id="view-split" :aria-label="t('tabs.splitView')" :aria-pressed="snapshot.viewMode === 'split'" @click="emit('command', { type: 'view.set-mode', mode: 'split' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-split"></use></svg></button>
      <button type="button" class="view-mode-button" id="view-score" :aria-label="t('tabs.scoreView')" :aria-pressed="snapshot.viewMode === 'score'" @click="emit('command', { type: 'view.set-mode', mode: 'score' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-eye"></use></svg></button>
    </div>
  </div>
</template>
