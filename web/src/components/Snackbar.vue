<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';

type WorkspaceNotice = { text: string; kind: 'info' | 'error' };

const props = defineProps<{ message?: WorkspaceNotice }>();
const emit = defineEmits<{ dismiss: [] }>();
let dismissTimer: number | undefined;

function clearDismissTimer(): void {
  if (dismissTimer === undefined) return;
  window.clearTimeout(dismissTimer);
  dismissTimer = undefined;
}

watch(() => props.message, message => {
  clearDismissTimer();
  if (!message) return;
  const currentMessage = message;
  dismissTimer = window.setTimeout(() => {
    dismissTimer = undefined;
    if (props.message === currentMessage) emit('dismiss');
  }, message.kind === 'error' ? 8_000 : 4_000);
}, { immediate: true });

onBeforeUnmount(clearDismissTimer);
</script>

<template>
  <div
    v-if="message"
    id="app-message"
    class="app-message"
    :data-kind="message.kind"
    :role="message.kind === 'error' ? 'alert' : 'status'"
  >{{ message.text }}</div>
</template>
