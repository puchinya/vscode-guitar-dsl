<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import type { WorkspaceCommand, WorkspaceContextMenuRequest, WorkspaceMenuSnapshot } from '../types/workspace';
import type { MainMenuId } from './MainMenuBar.vue';
import WorkspaceMenu from './WorkspaceMenu.vue';

const props = defineProps<{ menu?: Readonly<WorkspaceMenuSnapshot> }>();
const emit = defineEmits<{
  request: [request: WorkspaceContextMenuRequest];
  command: [command: WorkspaceCommand];
  navigateMain: [menu: MainMenuId];
}>();

const contextTargets = '.storage-root-row, .file-item, .tab, .problem-row, .cm-gutters, .score-pane';
const keyboardTargets = `${contextTargets}, .cm-content, #explorer-more, #inspector-more`;

function onContextMenu(event: MouseEvent): void {
  const target = event.target instanceof HTMLElement ? event.target : event.target instanceof Element ? event.target.parentElement : null;
  if (!target || target.closest('.cm-content') || !target.closest(contextTargets)) return;
  event.preventDefault();
  emit('request', { target, clientX: event.clientX, clientY: event.clientY, keyboard: false });
}

function onKeyboardContextMenu(event: KeyboardEvent): void {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  if (!focused?.closest(keyboardTargets)) return;
  event.preventDefault();
  const rect = focused.getBoundingClientRect();
  emit('request', { target: focused, clientX: rect.left, clientY: rect.bottom, keyboard: true });
}

onMounted(() => {
  document.addEventListener('contextmenu', onContextMenu, true);
  document.addEventListener('keydown', onKeyboardContextMenu, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('contextmenu', onContextMenu, true);
  document.removeEventListener('keydown', onKeyboardContextMenu, true);
});
</script>

<template>
  <WorkspaceMenu
    :menu="menu"
    @command="emit('command', $event)"
    @navigate-main="emit('navigateMain', $event)"
  />
</template>
