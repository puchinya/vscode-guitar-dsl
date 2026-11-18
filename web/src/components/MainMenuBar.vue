<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

export type MainMenuId = 'file' | 'edit' | 'view';

const props = defineProps<{ activeMenu?: string }>();
const emit = defineEmits<{ open: [menu: MainMenuId] }>();
const root = ref<HTMLElement>();
const menus: MainMenuId[] = ['file', 'edit', 'view'];
const { t } = useI18n({ useScope: 'global' });
const labels = (menu: MainMenuId) => t(`menu.${menu}`);

function focusMenu(menu: MainMenuId, open = true): void {
  root.value?.querySelector<HTMLButtonElement>(`#menu-${menu}-trigger`)?.focus();
  if (open) emit('open', menu);
}

function onTriggerKeydown(menu: MainMenuId, event: KeyboardEvent): void {
  const index = menus.indexOf(menu);
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    const next = (index + (event.key === 'ArrowRight' ? 1 : menus.length - 1)) % menus.length;
    focusMenu(menus[next]!);
    return;
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    focusMenu(menus[event.key === 'Home' ? 0 : menus.length - 1]!, false);
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    emit('open', menu);
  }
}

function onTriggerPointerEnter(menu: MainMenuId): void {
  if (props.activeMenu && props.activeMenu !== menu) emit('open', menu);
}

defineExpose({ focusMenu });
</script>

<template>
  <nav ref="root" class="main-menu-bar" role="menubar" :aria-label="t('menu.main')">
    <button id="menu-file-trigger" type="button" role="menuitem" aria-haspopup="menu" :aria-expanded="activeMenu === 'file'" @click="emit('open', 'file')" @keydown="onTriggerKeydown('file', $event)" @pointerenter="onTriggerPointerEnter('file')">{{ labels('file') }}</button>
    <button id="menu-edit-trigger" type="button" role="menuitem" aria-haspopup="menu" :aria-expanded="activeMenu === 'edit'" @click="emit('open', 'edit')" @keydown="onTriggerKeydown('edit', $event)" @pointerenter="onTriggerPointerEnter('edit')">{{ labels('edit') }}</button>
    <button id="menu-view-trigger" type="button" role="menuitem" aria-haspopup="menu" :aria-expanded="activeMenu === 'view'" @click="emit('open', 'view')" @keydown="onTriggerKeydown('view', $event)" @pointerenter="onTriggerPointerEnter('view')">{{ labels('view') }}</button>
  </nav>
</template>
