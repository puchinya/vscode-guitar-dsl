<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import HeaderBar from './components/HeaderBar.vue';
import WorkspaceShell from './components/WorkspaceShell.vue';
import MenuLayer from './components/MenuLayer.vue';
import PwaUpdatePrompt from './components/PwaUpdatePrompt.vue';
import { WEB_ICON_SPRITE } from './icons';
import { useWorkspaceStore } from './stores/workspaceStore';
import type { WebWorkspaceController, WorkspaceHostBindings, WorkspaceCommand, WorkspaceViewSnapshot } from './types/workspace';

const props = defineProps<{ controller: WebWorkspaceController & WorkspaceHostBindings }>();
const workspaceStore = useWorkspaceStore();
const { view: storeView, problemSummary } = storeToRefs(workspaceStore);
const snapshot = computed<Readonly<WorkspaceViewSnapshot>>(() => {
  if (storeView.value === null) throw new Error('Workspace store must be attached before App is mounted.');
  return storeView.value;
});
const iconSprite = WEB_ICON_SPRITE;
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const systemDark = ref(systemTheme.matches);
const updateSystemTheme = (event: MediaQueryListEvent) => { systemDark.value = event.matches; };
systemTheme.addEventListener('change', updateSystemTheme);
let disposed = false;
const disposeController = () => {
  if (disposed) return;
  disposed = true;
  workspaceStore.detach();
  props.controller.dispose();
};
const handlePageHide = (event: PageTransitionEvent) => {
  if (event.persisted) dispatch({ type: 'lifecycle.pagehide', persisted: true });
  else disposeController();
};
const handlePageShow = (event: PageTransitionEvent) => {
  if (event.persisted) dispatch({ type: 'lifecycle.pageshow', persisted: true });
};
onMounted(() => {
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('pageshow', handlePageShow);
});
onBeforeUnmount(() => {
  systemTheme.removeEventListener('change', updateSystemTheme);
  window.removeEventListener('pagehide', handlePageHide);
  window.removeEventListener('pageshow', handlePageShow);
  disposeController();
});
const theme = computed(() => snapshot.value.theme === 'system' ? (systemDark.value ? 'dark' : 'light') : snapshot.value.theme);
watch(theme, value => document.querySelector('#app')?.setAttribute('data-theme', value), { immediate: true });
watch(() => snapshot.value.ready, ready => {
  document.querySelector('#app')?.setAttribute('aria-busy', String(!ready));
}, { immediate: true });
function dispatch(command: WorkspaceCommand): void {
  void props.controller.dispatch(command);
}
</script>

<template>
  <main class="app-shell" :data-theme="theme" :aria-busy="!snapshot.ready" aria-label="GuitarDSL">
    <div class="icon-sprite" aria-hidden="true" v-html="iconSprite"></div>
    <HeaderBar @command="dispatch" />
    <WorkspaceShell :snapshot="snapshot" :controller="controller" @command="dispatch" />
    <footer class="statusbar" aria-label="Workspace status">
      <span id="status-problems">{{ problemSummary }}</span>
      <span id="status-cursor">{{ snapshot.cursorPosition || 'Ln 1, Col 1' }}</span><span class="status-spacer"></span>
      <span class="preview-state sr-only" id="preview-state" aria-live="polite">{{ snapshot.previewStatus || (snapshot.ready ? '' : 'Loading score') }}</span>
      <span class="status-dot" :class="{ unavailable: !snapshot.ready }" aria-hidden="true"></span><span class="saved-state" id="saved-state">{{ snapshot.storageStatus || (snapshot.online ? 'Ready' : 'Offline') }}</span>
    </footer>
    <input id="file-input" type="file" accept=".guitardsl,.gdsl,text/plain" hidden @change="dispatch({ type: 'document.import-local' })" />
    <dialog id="help-dialog" class="help-dialog"><header><h2 id="help-title">Help</h2><button type="button" id="close-help" class="icon-action" aria-label="Close" title="Close">×</button></header><p id="help-popup-note" hidden></p><p id="help-direct-link-row" hidden><a id="help-direct-link" target="_blank" rel="noopener noreferrer">Open Help in a new tab</a></p><nav id="help-toc" aria-label="Help topics"></nav><article id="help-content"></article></dialog>
    <MenuLayer :snapshot="snapshot" @command="dispatch" />
    <PwaUpdatePrompt :state="snapshot.pwa" :locale="snapshot.locale" @update="dispatch({ type: 'pwa.update' })" @later="dispatch({ type: 'pwa.later' })" />
  </main>
</template>
