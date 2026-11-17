<script setup lang="ts">
import type { WorkspaceCommand } from '../types/workspace';

type SplitterCommand = Extract<WorkspaceCommand, { type: 'splitter.event' }>;

const props = defineProps<{
  splitter: SplitterCommand['splitter'];
  orientation: 'horizontal' | 'vertical';
  label: string;
  min: number;
  max: number;
  value: number;
}>();

const emit = defineEmits<{ command: [command: SplitterCommand] }>();

function send(phase: SplitterCommand['phase'], event?: PointerEvent | KeyboardEvent): void {
  emit('command', {
    type: 'splitter.event',
    splitter: props.splitter,
    phase,
    ...(event instanceof PointerEvent ? { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY } : {}),
    ...(event instanceof KeyboardEvent ? { key: event.key, shiftKey: event.shiftKey } : {})
  });
}

function pointerDown(event: PointerEvent): void {
  const target = event.currentTarget;
  if (target instanceof HTMLElement) target.setPointerCapture(event.pointerId);
  event.preventDefault();
  send('start', event);
}

function keyDown(event: KeyboardEvent): void {
  const axisKeys = props.orientation === 'vertical'
    ? ['ArrowLeft', 'ArrowRight']
    : ['ArrowUp', 'ArrowDown'];
  if (!axisKeys.includes(event.key) && !['Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  send('keyboard', event);
}
</script>

<template>
  <div
    class="grid-splitter"
    role="separator"
    :aria-orientation="orientation"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="value"
    tabindex="0"
    @pointerdown="pointerDown"
    @pointermove="send('move', $event)"
    @pointerup="send('end', $event)"
    @pointercancel="send('cancel', $event)"
    @lostpointercapture="send('cancel', $event)"
    @dblclick="send('reset')"
    @keydown="keyDown"
  ></div>
</template>
