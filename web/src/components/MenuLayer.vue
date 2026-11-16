<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { WorkspaceCommand, WorkspaceViewSnapshot } from '../types/workspace';

const props = defineProps<{ snapshot: Readonly<WorkspaceViewSnapshot> }>();
const emit = defineEmits<{ command: [command: WorkspaceCommand] }>();
const menuElement = ref<HTMLElement>();
let removeDocumentListeners: (() => void) | undefined;

function onMenuKeydown(event: KeyboardEvent): void {
  const mainMenus = ['file', 'edit', 'view'] as const;
  const mainMenuIndex = props.snapshot.menu ? mainMenus.indexOf(props.snapshot.menu.id as typeof mainMenus[number]) : -1;
  if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && mainMenuIndex >= 0) {
    event.preventDefault();
    const nextIndex = (mainMenuIndex + (event.key === 'ArrowRight' ? 1 : mainMenus.length - 1)) % mainMenus.length;
    emit('command', { type: 'menu.open', menu: mainMenus[nextIndex] });
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const buttons = Array.from(menuElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
  if (!buttons.length) return;
  event.preventDefault();
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? buttons[0]
    : event.key === 'End' ? buttons.at(-1)
      : buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
  next?.focus();
}

watch(() => props.snapshot.menu, async menu => {
  removeDocumentListeners?.();
  removeDocumentListeners = undefined;
  if (!menu) return;
  await nextTick();
  const root = menuElement.value;
  if (!root) return;
  root.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  const onOutside = (event: PointerEvent) => {
    if (event.target instanceof Node && !root.contains(event.target)) emit('command', { type: 'menu.close' });
  };
  const onFocus = (event: FocusEvent) => {
    const invoker = menu.invokerId ? document.getElementById(menu.invokerId) : null;
    if (event.target instanceof Node && !root.contains(event.target) && event.target !== invoker) emit('command', { type: 'menu.close' });
  };
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('focusin', onFocus, true);
  removeDocumentListeners = () => {
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('focusin', onFocus, true);
  };
}, { flush: 'post' });
onBeforeUnmount(() => removeDocumentListeners?.());
</script>

<template>
  <div v-if="snapshot.menu" ref="menuElement" :id="['explorer', 'drive-root', 'inspector'].includes(snapshot.menu.id) ? 'panel-menu' : snapshot.menu.id === 'context' ? 'context-menu' : `${snapshot.menu.id}-menu`" class="settings-menu command-menu" role="menu" :aria-label="snapshot.menu.label" :style="snapshot.menu.position ? { left: `${snapshot.menu.position.left}px`, top: `${snapshot.menu.position.top}px` } : undefined" @keydown="onMenuKeydown" @keydown.esc.stop.prevent="emit('command', { type: 'menu.close' })">
    <template v-for="item in snapshot.menu.items" :key="item.id">
      <div v-if="item.separator" role="separator"></div>
      <button v-else type="button" :role="item.checked === undefined ? 'menuitem' : 'menuitemradio'" :disabled="item.disabled" :aria-checked="item.checked === undefined ? undefined : item.checked" @click="emit('command', { type: 'menu.activate', itemId: item.id })"><span>{{ item.label }}</span><kbd v-if="item.shortcut">{{ item.shortcut }}</kbd><span v-if="item.checked" class="menu-check" aria-hidden="true">✓</span></button>
    </template>
  </div>
</template>
