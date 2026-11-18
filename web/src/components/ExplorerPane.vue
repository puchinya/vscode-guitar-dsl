<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { WorkspaceCommand, WorkspaceViewSnapshot } from '../types/workspace';

const props = defineProps<{ snapshot: Readonly<WorkspaceViewSnapshot> }>();
const emit = defineEmits<{ command: [command: WorkspaceCommand] }>();
const { t } = useI18n({ useScope: 'global' });
const openFile = (file: (typeof props.snapshot.localFiles)[number]) => {
  if (file.identity.storage === 'drive' && file.accountId) emit('command', {
    type: 'document.open-drive', identity: file.identity, accountId: file.accountId, driveGeneration: props.snapshot.driveGeneration
  });
  else emit('command', { type: 'document.open-local', identity: file.identity });
};
</script>

<template>
  <aside class="file-list" :aria-label="t('explorer.files')">
    <div class="pane-heading explorer-heading"><span id="files-heading">{{ t('explorer.title') }}</span><div class="panel-heading-actions"><button type="button" id="new-score" class="icon-action" :aria-label="t('action.newScore')" :title="t('action.newScore')" @click="emit('command', { type: 'document.create' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-fileplus"></use></svg></button><button type="button" id="explorer-more" class="icon-action" :aria-label="t('action.explorerOptions')" :title="t('action.explorerOptions')" aria-haspopup="menu" @click="emit('command', { type: 'menu.open', menu: 'explorer' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-more"></use></svg></button></div></div>
    <section class="storage-section" data-storage-section="local">
      <div class="storage-root-row">
        <button type="button" class="storage-expander" data-storage-expander="local" :aria-label="`${t(snapshot.localExpanded ? 'common.collapse' : 'common.expand')} ${t('drive.onThisDevice')}`" :aria-expanded="snapshot.localExpanded" aria-controls="local-storage-content" @click="emit('command', { type: 'explorer.toggle-expanded', storage: 'local' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use :href="snapshot.localExpanded ? '#ic-down' : '#ic-right'"></use></svg></button>
        <svg class="web-icon root-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-folder"></use></svg>
        <button type="button" data-storage="local" class="storage-root-label" id="storage-local" @click="emit('command', { type: 'storage.set-active', storage: 'local' })">{{ t('drive.onThisDevice') }}</button>
      </div>
      <div v-show="snapshot.localExpanded" class="storage-content" id="local-storage-content">
        <div class="file-actions" id="file-actions"><button type="button" @click="emit('command', { type: 'document.import-local' })">{{ t('action.importFile') }}</button></div>
        <div class="file-items" id="file-items">
          <button v-for="file in snapshot.localFiles" :key="file.identity.fileId" type="button" class="file-item" :class="{ selected: file.selected }" data-storage="local" :data-file-id="file.identity.fileId" :data-revision="file.revision" :aria-current="file.selected ? 'page' : undefined" @click="openFile(file)"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-file"></use></svg><span class="file-name">{{ file.name }}</span></button>
          <div v-if="!snapshot.localFiles.length" class="empty-state">{{ snapshot.ready ? t('common.noScores') : t('common.loading') }}</div>
        </div>
      </div>
    </section>
    <section class="storage-section" data-storage-section="drive">
      <div class="storage-root-row">
        <button type="button" class="storage-expander" data-storage-expander="drive" :aria-label="`${t(snapshot.driveExpanded ? 'common.collapse' : 'common.expand')} ${t('drive.name')}`" :aria-expanded="snapshot.driveExpanded" aria-controls="drive-storage-content" @click="emit('command', { type: 'explorer.toggle-expanded', storage: 'drive' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use :href="snapshot.driveExpanded ? '#ic-down' : '#ic-right'"></use></svg></button>
        <img class="root-icon drive-root-icon" src="/icons/google-drive-2026-color.png" alt="" />
        <button type="button" data-storage="drive" class="storage-root-label" id="storage-drive" @click="emit('command', { type: 'storage.set-active', storage: 'drive' })">{{ t('drive.name') }}</button>
        <span id="drive-status" class="drive-status-dot" :aria-label="snapshot.driveAccountLabel" :hidden="snapshot.driveStatus !== 'connected'"></span>
        <button type="button" id="drive-connect-inline" class="drive-connect-inline" :aria-label="t(snapshot.driveStatus === 'connecting' ? 'drive.action.connecting' : snapshot.driveStatus === 'reauth' ? 'drive.action.reconnect' : 'drive.action.connect')" :title="snapshot.driveStatus === 'reauth' ? `${t('drive.action.reconnect')} — ${snapshot.driveAccountLabel || ''}` : t(snapshot.driveStatus === 'connecting' ? 'drive.action.connecting' : 'drive.action.connect')" :hidden="snapshot.driveStatus === 'connected'" :disabled="snapshot.driveStatus === 'connecting' || !snapshot.online" @click="emit('command', { type: 'drive.connect' })">{{ t(snapshot.driveStatus === 'connecting' ? 'drive.action.connecting' : snapshot.driveStatus === 'reauth' ? 'drive.action.reconnect' : 'drive.action.connect') }}</button>
        <button type="button" id="drive-root-more" class="icon-action drive-root-more" :aria-label="t('action.googleDriveOptions')" :title="t('action.googleDriveOptions')" aria-haspopup="menu" :disabled="!snapshot.online" @click="emit('command', { type: 'menu.open', menu: 'drive-root' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-more"></use></svg></button>
      </div>
      <div v-show="snapshot.driveExpanded" class="storage-content" id="drive-storage-content">
        <div class="file-actions" id="drive-file-actions"></div>
        <div class="file-items" id="drive-file-items">
          <div v-if="snapshot.online && snapshot.driveStatus === 'connected' && snapshot.driveFolderName" class="drive-folder-row">{{ snapshot.driveFolderName }}</div>
          <div v-if="!snapshot.online" class="empty-state">{{ t('drive.unavailableOffline') }}</div>
          <div v-else-if="snapshot.driveStatus !== 'connected'" class="empty-state">{{ t('drive.connectToShowFiles') }}</div>
          <button v-for="file in snapshot.driveFiles" :key="file.identity.fileId" type="button" class="file-item" :class="{ selected: file.selected }" data-storage="drive" :data-file-id="file.identity.fileId" :data-account-id="file.accountId" :data-revision="file.revision" :aria-current="file.selected ? 'page' : undefined" @click="openFile(file)"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-file"></use></svg><span class="file-name">{{ file.name }}</span></button>
          <div v-if="snapshot.online && snapshot.driveStatus === 'connected' && !snapshot.driveFiles.length" class="empty-state">{{ snapshot.driveFolderId ? t('common.noScores') : t('drive.chooseDestinationFolder') }}</div>
        </div>
        <p v-if="snapshot.driveScopeNote" class="drive-scope-note" id="drive-scope-note" role="note">{{ snapshot.driveScopeNote }}</p>
        <p v-if="snapshot.driveOverwriteWarning" class="drive-overwrite-note" id="drive-overwrite-note" role="note">{{ snapshot.driveOverwriteWarning }}</p>
      </div>
    </section>
  </aside>
</template>
