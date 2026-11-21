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
        <button type="button" class="storage-expander" data-storage-expander="drive" :aria-label="`${t(snapshot.driveExpanded ? 'common.collapse' : 'common.expand')} ${t('drive.library')}`" :aria-expanded="snapshot.driveExpanded" aria-controls="drive-storage-content" @click="emit('command', { type: 'explorer.toggle-expanded', storage: 'drive' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use :href="snapshot.driveExpanded ? '#ic-down' : '#ic-right'"></use></svg></button>
        <svg class="web-icon root-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-folder"></use></svg>
        <button type="button" data-storage="drive" class="storage-root-label" id="storage-drive" @click="emit('command', { type: 'storage.set-active', storage: 'drive' })">{{ t('drive.library') }}</button>
        <button type="button" id="drive-root-more" class="icon-action drive-root-more" :aria-label="t('action.googleDriveOptions')" :title="t('action.googleDriveOptions')" aria-haspopup="menu" :disabled="!snapshot.online" @click="emit('command', { type: 'menu.open', menu: 'drive-root' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-more"></use></svg></button>
      </div>
      <div id="drive-connection-row" class="drive-connection-row" :data-state="snapshot.driveStatus" :data-online="snapshot.online" role="status" aria-live="polite">
        <img class="drive-provider-icon" src="/icons/google-drive-2026-color.png" alt="" aria-hidden="true" />
        <span class="drive-provider-name">{{ t('drive.name') }}</span>
        <span v-if="snapshot.online && snapshot.driveStatus === 'connected'" id="drive-status" class="drive-status-dot" aria-hidden="true"></span>
        <span v-if="snapshot.online && snapshot.driveStatus === 'connected'" class="drive-connection-state">{{ t('drive.status.connected') }}</span>
        <span v-else-if="snapshot.online && snapshot.driveStatus === 'connecting'" class="drive-connection-state">{{ t('drive.status.connecting') }}</span>
        <span v-else-if="!snapshot.online || snapshot.driveStatus === 'offline'" class="drive-connection-state">{{ t('drive.status.offline') }}</span>
        <button v-else-if="snapshot.driveStatus === 'reauth'" type="button" id="drive-connect-inline" class="drive-connection-action" :aria-label="`${t('drive.status.reauthDescription')}${snapshot.driveAccountLabel ? `: ${snapshot.driveAccountLabel}` : ''}`" :title="`${t('drive.status.reauthDescription')}${snapshot.driveAccountLabel ? ` — ${snapshot.driveAccountLabel}` : ''}`" @click="emit('command', { type: 'drive.connect' })">{{ t('drive.status.reauth') }}</button>
        <button v-else type="button" id="drive-connect-inline" class="drive-connection-action" :aria-label="t('drive.action.connect')" :title="t('drive.action.connect')" @click="emit('command', { type: 'drive.connect' })">{{ t('drive.status.disconnected') }}</button>
      </div>
      <div v-show="snapshot.driveExpanded" class="storage-content" id="drive-storage-content">
        <div class="file-actions" id="drive-file-actions">
          <button type="button" :disabled="snapshot.driveStatus !== 'connected' || !snapshot.driveFolderId" @click="snapshot.driveFolderId && snapshot.driveAccountId && emit('command', { type: 'drive.library.create-score', accountId: snapshot.driveAccountId, driveGeneration: snapshot.driveGeneration, targetFolderId: snapshot.driveFolderId })">{{ t('action.newScore') }}</button>
          <button type="button" :disabled="snapshot.driveStatus !== 'connected' || !snapshot.driveFolderId" @click="snapshot.driveFolderId && snapshot.driveAccountId && emit('command', { type: 'drive.library.import', accountId: snapshot.driveAccountId, driveGeneration: snapshot.driveGeneration, targetFolderId: snapshot.driveFolderId })">{{ t('drive.importFromDrive') }}</button>
        </div>
        <div class="file-items" id="drive-file-items">
          <div v-if="!snapshot.online" class="empty-state">{{ t('drive.unavailableOffline') }}</div>
          <div v-else-if="snapshot.driveStatus !== 'connected'" class="empty-state">{{ t('drive.connectToShowFiles') }}</div>
          <div v-for="entry in snapshot.driveEntries" :key="entry.identity.fileId" class="drive-tree-entry">
            <button type="button" class="file-item drive-library-entry" :class="{ 'drive-folder-entry': entry.kind === 'folder', selected: entry.selected }" :style="{ paddingLeft: `${8 + entry.depth * 16}px` }" data-storage="drive" :data-kind="entry.kind" :data-file-id="entry.identity.fileId" :data-parent-id="entry.parentId" :data-account-id="entry.accountId" :data-drive-generation="snapshot.driveGeneration" :data-revision="entry.revision" :aria-current="entry.selected ? 'page' : undefined" :aria-expanded="entry.kind === 'folder' ? entry.expanded : undefined" @click="entry.kind === 'folder' && snapshot.driveAccountId ? emit('command', { type: 'drive.library.toggle-folder', accountId: snapshot.driveAccountId, driveGeneration: snapshot.driveGeneration, folderId: entry.identity.fileId }) : openFile(entry)">
              <svg v-if="entry.kind === 'folder'" class="web-icon folder-disclosure" viewBox="0 0 24 24" aria-hidden="true"><use :href="entry.expanded ? '#ic-down' : '#ic-right'"></use></svg>
              <svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use :href="entry.kind === 'folder' ? '#ic-folder' : '#ic-file'"></use></svg>
              <span class="file-name">{{ entry.name }}</span>
            </button>
            <div v-if="entry.kind === 'folder' && entry.expanded && entry.loading" class="drive-tree-state" :style="{ paddingLeft: `${32 + entry.depth * 16}px` }">{{ t('common.loading') }}</div>
            <div v-if="entry.kind === 'folder' && entry.expanded && entry.error" class="drive-tree-state drive-tree-error" role="status" :style="{ paddingLeft: `${32 + entry.depth * 16}px` }">{{ entry.error }}</div>
          </div>
          <div v-if="snapshot.online && snapshot.driveStatus === 'connected' && !snapshot.driveFolderId" class="empty-state">{{ t('drive.chooseDestinationFolder') }}</div>
          <div v-else-if="snapshot.online && snapshot.driveStatus === 'connected' && !snapshot.driveEntries.length && snapshot.driveFolderId" class="empty-state">{{ t('drive.emptyLibrary') }}</div>
        </div>
        <p v-if="snapshot.driveScopeNote" class="drive-scope-note" id="drive-scope-note" role="note">{{ snapshot.driveScopeNote }}</p>
        <p v-if="snapshot.driveOverwriteWarning" class="drive-overwrite-note" id="drive-overwrite-note" role="note">{{ snapshot.driveOverwriteWarning }}</p>
      </div>
    </section>
  </aside>
</template>
