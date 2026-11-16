<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { WorkspaceHostBindings } from '../types/workspace';

const props = defineProps<{ controller: WorkspaceHostBindings }>();
const frame = ref<HTMLIFrameElement>();
onMounted(() => { if (frame.value) props.controller.mountScoreFrame(frame.value); });
</script>

<template>
  <section class="score-pane" aria-label="Score preview" id="score-pane">
    <iframe ref="frame" id="score-frame" title="GuitarDSL score preview" sandbox="allow-scripts"></iframe>
  </section>
</template>
