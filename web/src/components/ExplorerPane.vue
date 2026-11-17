<script setup lang="ts">
import type { WorkspaceCommand, WorkspaceViewSnapshot } from '../types/workspace';

const props = defineProps<{ snapshot: Readonly<WorkspaceViewSnapshot> }>();
const emit = defineEmits<{ command: [command: WorkspaceCommand] }>();
const text = (ja: string, en: string) => props.snapshot.locale === 'ja' ? ja : en;
const openFile = (file: (typeof props.snapshot.localFiles)[number]) => {
  if (file.identity.storage === 'drive' && file.accountId) emit('command', {
    type: 'document.open-drive', identity: file.identity, accountId: file.accountId, driveGeneration: props.snapshot.driveGeneration
  });
  else emit('command', { type: 'document.open-local', identity: file.identity });
};
</script>

<template>
  <aside class="file-list" aria-label="Files">
    <div class="pane-heading explorer-heading"><span id="files-heading">{{ text('エクスプローラー', 'EXPLORER') }}</span><div class="panel-heading-actions"><button type="button" id="new-score" class="icon-action" :aria-label="text('新しい楽譜', 'New score')" :title="text('新しい楽譜', 'New score')" @click="emit('command', { type: 'document.create' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-fileplus"></use></svg></button><button type="button" id="explorer-more" class="icon-action" :aria-label="text('エクスプローラーのオプション', 'Explorer options')" :title="text('エクスプローラーのオプション', 'Explorer options')" aria-haspopup="menu" @click="emit('command', { type: 'menu.open', menu: 'explorer' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-more"></use></svg></button></div></div>
    <section class="storage-section" data-storage-section="local">
      <div class="storage-root-row">
        <button type="button" class="storage-expander" data-storage-expander="local" :aria-label="`${text(snapshot.localExpanded ? '折りたたむ' : '展開', snapshot.localExpanded ? 'Collapse' : 'Expand')} ${text('このデバイス', 'On this device')}`" :aria-expanded="snapshot.localExpanded" aria-controls="local-storage-content" @click="emit('command', { type: 'explorer.toggle-expanded', storage: 'local' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use :href="snapshot.localExpanded ? '#ic-down' : '#ic-right'"></use></svg></button>
        <svg class="web-icon root-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-folder"></use></svg>
        <button type="button" data-storage="local" class="storage-root-label" id="storage-local" @click="emit('command', { type: 'storage.set-active', storage: 'local' })">{{ text('このデバイス', 'On this device') }}</button>
      </div>
      <div v-show="snapshot.localExpanded" class="storage-content" id="local-storage-content">
        <div class="file-actions" id="file-actions"><button type="button" @click="emit('command', { type: 'document.import-local' })">{{ text('ファイルを読み込む…', 'Import file…') }}</button></div>
        <div class="file-items" id="file-items">
          <button v-for="file in snapshot.localFiles" :key="file.identity.fileId" type="button" class="file-item" :class="{ selected: file.selected }" data-storage="local" :data-file-id="file.identity.fileId" :data-revision="file.revision" :aria-current="file.selected ? 'page' : undefined" @click="openFile(file)"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-file"></use></svg><span class="file-name">{{ file.name }}</span></button>
          <div v-if="!snapshot.localFiles.length" class="empty-state">{{ snapshot.ready ? text('楽譜がありません', 'No scores yet') : text('読み込み中…', 'Loading…') }}</div>
        </div>
      </div>
    </section>
    <section class="storage-section" data-storage-section="drive">
      <div class="storage-root-row">
        <button type="button" class="storage-expander" data-storage-expander="drive" :aria-label="`${text(snapshot.driveExpanded ? '折りたたむ' : '展開', snapshot.driveExpanded ? 'Collapse' : 'Expand')} Google Drive`" :aria-expanded="snapshot.driveExpanded" aria-controls="drive-storage-content" @click="emit('command', { type: 'explorer.toggle-expanded', storage: 'drive' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use :href="snapshot.driveExpanded ? '#ic-down' : '#ic-right'"></use></svg></button>
        <img class="root-icon drive-root-icon" src="/icons/google-drive-2026-color.png" alt="" />
        <button type="button" data-storage="drive" class="storage-root-label" id="storage-drive" @click="emit('command', { type: 'storage.set-active', storage: 'drive' })">Google Drive</button>
        <span id="drive-status" class="drive-status-dot" :aria-label="snapshot.driveAccountLabel" :hidden="snapshot.driveStatus !== 'connected'"></span>
        <button type="button" id="drive-connect-inline" class="drive-connect-inline" :aria-label="snapshot.driveStatus === 'connecting' ? text('接続中…', 'Connecting…') : snapshot.driveStatus === 'reauth' ? text('Drive に再接続', 'Reconnect Drive') : text('接続', 'Connect')" :title="snapshot.driveStatus === 'reauth' ? `${text('Drive に再接続', 'Reconnect Drive')} — ${snapshot.driveAccountLabel || ''}` : snapshot.driveStatus === 'connecting' ? text('接続中…', 'Connecting…') : text('接続', 'Connect')" :hidden="snapshot.driveStatus === 'connected'" :disabled="snapshot.driveStatus === 'connecting' || !snapshot.online" @click="emit('command', { type: 'drive.connect' })">{{ snapshot.driveStatus === 'connecting' ? text('接続中…', 'Connecting…') : snapshot.driveStatus === 'reauth' ? text('Drive に再接続', 'Reconnect Drive') : text('接続', 'Connect') }}</button>
        <button type="button" id="drive-root-more" class="icon-action drive-root-more" :aria-label="text('Google Drive のオプション', 'Google Drive options')" :title="text('Google Drive のオプション', 'Google Drive options')" aria-haspopup="menu" :disabled="!snapshot.online" @click="emit('command', { type: 'menu.open', menu: 'drive-root' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-more"></use></svg></button>
      </div>
      <div v-show="snapshot.driveExpanded" class="storage-content" id="drive-storage-content">
        <div class="file-actions" id="drive-file-actions"></div>
        <div class="file-items" id="drive-file-items">
          <div v-if="snapshot.online && snapshot.driveStatus === 'connected' && snapshot.driveFolderName" class="drive-folder-row">{{ snapshot.driveFolderName }}</div>
          <div v-if="!snapshot.online" class="empty-state">{{ text('オフラインではDriveを利用できません', 'Google Drive is unavailable offline') }}</div>
          <div v-else-if="snapshot.driveStatus !== 'connected'" class="empty-state">{{ text('接続するとDriveのファイルが表示されます', 'Connect to show Google Drive files') }}</div>
          <button v-for="file in snapshot.driveFiles" :key="file.identity.fileId" type="button" class="file-item" :class="{ selected: file.selected }" data-storage="drive" :data-file-id="file.identity.fileId" :data-account-id="file.accountId" :data-revision="file.revision" :aria-current="file.selected ? 'page' : undefined" @click="openFile(file)"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-file"></use></svg><span class="file-name">{{ file.name }}</span></button>
          <div v-if="snapshot.online && snapshot.driveStatus === 'connected' && !snapshot.driveFiles.length" class="empty-state">{{ snapshot.driveFolderId ? text('楽譜がありません', 'No scores yet') : text('保存先フォルダーを選択してください', 'Choose a destination folder') }}</div>
        </div>
        <p v-if="snapshot.driveScopeNote" class="drive-scope-note" id="drive-scope-note" role="note">{{ snapshot.driveScopeNote }}</p>
        <p v-if="snapshot.driveOverwriteWarning" class="drive-overwrite-note" id="drive-overwrite-note" role="note">{{ snapshot.driveOverwriteWarning }}</p>
      </div>
    </section>
  </aside>
</template>
