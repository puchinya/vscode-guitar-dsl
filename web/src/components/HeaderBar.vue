<script setup lang="ts">
import { computed, ref } from 'vue';
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
const text = (ja: string, en: string) => snapshot.value.locale === 'ja' ? ja : en;
const openMenu = (menu: Extract<WorkspaceCommand, { type: 'menu.open' }>['menu']) => emit('command', { type: 'menu.open', menu });
const mainMenuBar = ref<InstanceType<typeof MainMenuBar>>();
function focusMainMenu(menu: MainMenuId): void { mainMenuBar.value?.focusMenu(menu); }
defineExpose({ focusMainMenu });
const driveStatusLabel = () => {
  const values = snapshot.value.locale === 'ja'
    ? { connected: '接続済み', connecting: '接続中…', reauth: '再接続が必要', offline: 'オフライン', disconnected: '未接続' }
    : { connected: 'Connected', connecting: 'Connecting…', reauth: 'Reconnect required', offline: 'Offline', disconnected: 'Not connected' };
  return values[snapshot.value.driveStatus];
};
</script>

<template>
  <header class="topbar">
    <div class="brand"><img class="brand-mark" src="/icons/guitardsl-sidebar.svg" alt="" /><strong>GuitarDSL</strong></div>
    <MainMenuBar ref="mainMenuBar" :locale="snapshot.locale" :active-menu="snapshot.menu?.id" @open="openMenu" />
    <div class="top-actions">
      <button type="button" class="quiet-button icon-action drive-header-button" id="connect-drive" :data-state="snapshot.driveStatus" :data-connected="String(snapshot.driveStatus === 'connected')" :disabled="snapshot.driveBusy || !snapshot.online" :aria-label="text('Google Drive', 'Google Drive') + ': ' + driveStatusLabel()" :title="snapshot.driveAccountLabel || driveStatusLabel()" aria-haspopup="menu" @click="openMenu('drive')">
        <img class="google-drive-logo" src="/icons/google-drive-2026-color.png" alt="" /><span id="drive-state-label">{{ driveStatusLabel() }}</span>
      </button>
      <button type="button" class="quiet-button icon-action" id="save-document" :disabled="snapshot.saveDisabled" :aria-label="text('保存', 'Save')" :title="text('保存', 'Save')" @click="emit('command', { type: 'document.save' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-save"></use></svg><span class="sr-only">{{ text('保存', 'Save') }}</span></button>
      <button type="button" class="quiet-button icon-action" id="download-pdf" :aria-label="text('PDFを出力', 'Download PDF')" :title="text('PDFを出力', 'Download PDF')" @click="emit('command', { type: 'document.export-pdf' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-pdf"></use></svg><span class="sr-only">{{ text('PDFを出力', 'Download PDF') }}</span></button>
      <button type="button" class="quiet-button icon-action" id="help-button" :aria-label="text('ヘルプ', 'Help')" :title="text('ヘルプ', 'Help')" @click="emit('command', { type: 'help.open' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-help"></use></svg><span class="sr-only">{{ text('ヘルプ', 'Help') }}</span></button>
      <button type="button" class="quiet-button icon-action" id="settings-button" :aria-label="text('設定', 'Settings')" :title="text('設定', 'Settings')" aria-haspopup="menu" @click="openMenu('settings')"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-settings"></use></svg><span class="sr-only">{{ text('設定', 'Settings') }}</span></button>
    </div>
  </header>
</template>
