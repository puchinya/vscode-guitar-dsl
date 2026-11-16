<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { WorkspaceHostBindings, WorkspaceViewSnapshot } from '../types/workspace';

const props = defineProps<{ snapshot: Readonly<WorkspaceViewSnapshot>; controller: WorkspaceHostBindings }>();
const container = ref<HTMLElement>();
onMounted(() => { if (container.value) props.controller.mountSourceEditor(container.value); });
</script>

<template>
  <section class="source-pane" aria-label="GuitarDSL source" id="source-pane">
    <div ref="container" class="editor-surface" aria-label="GuitarDSL source editor"></div>
  </section>
</template>
