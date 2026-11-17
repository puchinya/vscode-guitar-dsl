<script setup lang="ts">
import type { WorkspaceCommand, WorkspaceContextMenuRequest, WorkspaceViewSnapshot } from '../types/workspace';
import type { MainMenuId } from './MainMenuBar.vue';
import ContextMenu from './ContextMenu.vue';
import WorkspaceMenu from './WorkspaceMenu.vue';

const props = defineProps<{ snapshot: Readonly<WorkspaceViewSnapshot> }>();
const emit = defineEmits<{
  command: [command: WorkspaceCommand];
  contextRequest: [request: WorkspaceContextMenuRequest];
  navigateMain: [menu: MainMenuId];
}>();
</script>

<template>
  <WorkspaceMenu
    v-if="snapshot.menu && snapshot.menu.id !== 'context'"
    :menu="snapshot.menu"
    @command="emit('command', $event)"
    @navigate-main="emit('navigateMain', $event)"
  />
  <ContextMenu
    :menu="snapshot.menu?.id === 'context' ? snapshot.menu : undefined"
    @request="emit('contextRequest', $event)"
    @command="emit('command', $event)"
    @navigate-main="emit('navigateMain', $event)"
  />
</template>
