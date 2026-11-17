<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { WorkspaceCommand, WorkspaceMenuSnapshot } from '../types/workspace';
import type { MainMenuId } from './MainMenuBar.vue';

const props = defineProps<{ menu?: Readonly<WorkspaceMenuSnapshot> }>();
const emit = defineEmits<{
  command: [command: WorkspaceCommand];
  navigateMain: [menu: MainMenuId];
}>();
const menuElement = ref<HTMLElement>();
const menus: MainMenuId[] = ['file', 'edit', 'view'];
let removeDocumentListeners: (() => void) | undefined;

function menuId(menu: Readonly<WorkspaceMenuSnapshot>): string {
  if (menu.id === 'context') return 'context-menu';
  if (['explorer', 'drive-root', 'inspector'].includes(menu.id)) return 'panel-menu';
  return `${menu.id}-menu`;
}

function reposition(): void {
  const current = props.menu;
  const element = menuElement.value;
  if (!current?.position || !element) return;
  const rect = element.getBoundingClientRect();
  const left = Math.max(6, Math.min(current.position.left, window.innerWidth - rect.width - 6));
  const top = Math.max(6, Math.min(current.position.top, window.innerHeight - rect.height - 6));
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

function restoreFocus(invokerId: string | undefined): void {
  if (invokerId) document.getElementById(invokerId)?.focus();
}

function close(shouldRestoreFocus: boolean): void {
  const invokerId = props.menu?.invokerId;
  emit('command', { type: 'menu.close' });
  if (shouldRestoreFocus) void nextTick(() => restoreFocus(invokerId));
}

function onOutsidePointer(event: PointerEvent): void {
  const root = menuElement.value;
  if (event.target instanceof Node && root?.contains(event.target)) return;
  close(false);
}

function onOutsideFocus(event: FocusEvent): void {
  const root = menuElement.value;
  const invoker = props.menu?.invokerId ? document.getElementById(props.menu.invokerId) : null;
  if (!(event.target instanceof Node) || root?.contains(event.target) || event.target === invoker) return;
  close(false);
}

function onMenuKeydown(event: KeyboardEvent): void {
  if (!props.menu) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close(true);
    return;
  }
  const menuIndex = menus.indexOf(props.menu.id as MainMenuId);
  if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && menuIndex >= 0) {
    event.preventDefault();
    const next = (menuIndex + (event.key === 'ArrowRight' ? 1 : menus.length - 1)) % menus.length;
    emit('navigateMain', menus[next]!);
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

function activate(itemId: string): void {
  const invokerId = props.menu?.invokerId;
  emit('command', { type: 'menu.activate', itemId });
  void nextTick(() => restoreFocus(invokerId));
}

watch(() => props.menu, async menu => {
  removeDocumentListeners?.();
  removeDocumentListeners = undefined;
  if (!menu) return;
  await nextTick();
  if (props.menu !== menu) return;
  const root = menuElement.value;
  if (!root) return;
  reposition();
  root.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  const onPointer = (event: PointerEvent) => onOutsidePointer(event);
  const onFocus = (event: FocusEvent) => onOutsideFocus(event);
  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('focusin', onFocus, true);
  window.addEventListener('resize', reposition);
  removeDocumentListeners = () => {
    document.removeEventListener('pointerdown', onPointer, true);
    document.removeEventListener('focusin', onFocus, true);
    window.removeEventListener('resize', reposition);
  };
}, { flush: 'post', immediate: true });

onBeforeUnmount(() => removeDocumentListeners?.());
</script>

<template>
  <div
    v-if="menu"
    :id="menuId(menu)"
    ref="menuElement"
    class="settings-menu command-menu"
    :class="{ 'context-menu': menu.id === 'context' }"
    role="menu"
    :aria-label="menu.label"
    :style="menu.position ? { left: `${menu.position.left}px`, top: `${menu.position.top}px` } : undefined"
    @keydown="onMenuKeydown"
  >
    <template v-for="item in menu.items" :key="item.id">
      <div v-if="item.separator" role="separator"></div>
      <button
        v-else
        type="button"
        :role="item.checked === undefined ? 'menuitem' : 'menuitemradio'"
        :disabled="item.disabled"
        :aria-checked="item.checked === undefined ? undefined : item.checked"
        @click="activate(item.id)"
      ><span>{{ item.label }}</span><kbd v-if="item.shortcut">{{ item.shortcut }}</kbd><span v-if="item.checked !== undefined" class="menu-check" aria-hidden="true">{{ item.checked ? '✓' : '' }}</span></button>
    </template>
  </div>
</template>
