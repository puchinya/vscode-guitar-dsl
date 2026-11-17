<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { WorkspaceCommand } from '../types/workspace';
import MainMenuBar, { type MainMenuId } from './MainMenuBar.vue';
import { useWorkspaceStore } from '../stores/workspaceStore';

const workspaceStore = useWorkspaceStore();
const snapshot = computed(() => {
  const current = workspaceStore.view;
  if (current === null) throw new Error('Workspace store must be attached before HeaderBar is rendered.');
  return current;
});
const emit = defineEmits<{ command: [command: WorkspaceCommand] }>();
const { t } = useI18n({ useScope: 'global' });
const openMenu = (menu: Extract<WorkspaceCommand, { type: 'menu.open' }>['menu']) => emit('command', { type: 'menu.open', menu });
const mainMenuBar = ref<InstanceType<typeof MainMenuBar>>();
function focusMainMenu(menu: MainMenuId): void { mainMenuBar.value?.focusMenu(menu); }
defineExpose({ focusMainMenu });
const driveStatusLabel = computed(() => t(`drive.status.${snapshot.value.driveStatus}`));
</script>

<template>
  <header class="topbar">
    <div class="brand"><img class="brand-mark" src="/icons/guitardsl-sidebar.svg" alt="" /><strong>GuitarDSL</strong></div>
    <MainMenuBar ref="mainMenuBar" :active-menu="snapshot.menu?.id" @open="openMenu" />
    <div class="top-actions">
      <button type="button" class="quiet-button icon-action drive-header-button" id="connect-drive" :data-state="snapshot.driveStatus" :data-connected="String(snapshot.driveStatus === 'connected')" :disabled="snapshot.driveBusy || !snapshot.online" :aria-label="t('drive.connectionState', { status: driveStatusLabel })" :title="snapshot.driveAccountLabel || driveStatusLabel" aria-haspopup="menu" @click="openMenu('drive')">
        <img class="google-drive-logo" src="/icons/google-drive-2026-color.png" alt="" /><span id="drive-state-label">{{ driveStatusLabel }}</span>
      </button>
      <button type="button" class="quiet-button icon-action" id="save-document" :disabled="snapshot.saveDisabled" :aria-label="t('action.save')" :title="t('action.save')" @click="emit('command', { type: 'document.save' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-save"></use></svg><span class="sr-only">{{ t('action.save') }}</span></button>
      <button type="button" class="quiet-button icon-action" id="download-pdf" :aria-label="t('action.downloadPdf')" :title="t('action.downloadPdf')" @click="emit('command', { type: 'document.export-pdf' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-pdf"></use></svg><span class="sr-only">{{ t('action.downloadPdf') }}</span></button>
      <button type="button" class="quiet-button icon-action" id="help-button" :aria-label="t('action.help')" :title="t('action.help')" @click="emit('command', { type: 'help.open' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-help"></use></svg><span class="sr-only">{{ t('action.help') }}</span></button>
      <button type="button" class="quiet-button icon-action" id="settings-button" :aria-label="t('action.settings')" :title="t('action.settings')" aria-haspopup="menu" @click="openMenu('settings')"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-settings"></use></svg><span class="sr-only">{{ t('action.settings') }}</span></button>
    </div>
  </header>
</template>
