<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getScoreSettingsEditorMessages } from '@guitardsl/core/i18n';
import type { WorkspaceCommand, WorkspaceHostBindings, WorkspaceViewSnapshot } from '../types/workspace';

const props = defineProps<{ snapshot: Readonly<WorkspaceViewSnapshot>; controller: WorkspaceHostBindings }>();
const emit = defineEmits<{ command: [command: WorkspaceCommand] }>();
const content = ref<HTMLElement>();
const tabs = ref<HTMLElement>();
const settings = ref<HTMLElement>();
const settingsLabels = ref<HTMLElement>();
const initialSettingsLabels = JSON.stringify(getScoreSettingsEditorMessages(props.snapshot.locale));
onMounted(() => {
  if (content.value && tabs.value && settings.value && settingsLabels.value) {
    props.controller.mountInspectorHosts({ content: content.value, tabs: tabs.value, settings: settings.value, settingsLabels: settingsLabels.value });
  }
});
</script>

<template>
  <aside class="inspector" aria-label="Inspector">
    <div class="pane-heading"><span id="inspector-heading">Inspector</span><button type="button" id="inspector-more" class="icon-action" aria-label="Inspector options" title="Inspector options" aria-haspopup="menu" @click="emit('command', { type: 'menu.open', menu: 'inspector' })"><svg class="web-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-more"></use></svg></button></div>
    <div ref="tabs" id="inspector-tabs-host"></div>
    <div ref="content" class="inspector-content" id="inspector-content" role="tabpanel" tabindex="0"></div>
    <div id="inspector-settings-parking" hidden>
      <div ref="settings" id="shared-inspector-settings">
        <section id="inspector-state"><h2 id="settings-heading" tabindex="-1"></h2><div class="settings-tabs" id="settings-tabs"></div><div id="settings-content"></div><div class="inspector-actions" id="settings-actions"><button id="settings-apply" type="button"></button><button id="settings-cancel" type="button"></button></div><div ref="settingsLabels" id="settings-labels" hidden>{{ initialSettingsLabels }}</div></section>
      </div>
    </div>
  </aside>
</template>
