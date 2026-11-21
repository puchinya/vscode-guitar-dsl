<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { WorkspaceCommand, WorkspaceViewSnapshot } from '../types/workspace';
import chordFixture from '../../../docs/tutorials/momiji-4-4-no-melody.guitardsl?raw';
import melodyFixture from '../../../docs/tutorials/momiji-4-4-with-melody.guitardsl?raw';

const props = defineProps<{ snapshot: Readonly<WorkspaceViewSnapshot> }>();
const emit = defineEmits<{ command: [command: WorkspaceCommand] }>();
const { t, tm } = useI18n({ useScope: 'global' });
const copyState = ref<'copied' | 'failed' | ''>('');
const steps = computed(() => Object.values(tm('tutorial.steps') as Record<string, { title: string; body: string; code?: string }>));
const fixtureExamples = computed(() => {
  const chordParts = chordFixture.split('\n\n[Verse 1]\n');
  const chordRows = (chordParts[1] ?? '').split(/\r?\n/).filter((line) => line.startsWith('|'));
  const melodyParts = melodyFixture.split('\n\n[Verse 1]\n');
  const melodyGroups = (melodyParts[1] ?? '').split('\n\n');
  const chordHeader = `${chordParts[0]}\n\n[Verse 1]`;
  const melodyHeader = `${melodyParts[0]}\n\n[Verse 1]`;
  const chordOnly = chordRows.map((line) => line.replace(/ l:"[^"]*"/g, ''));
  const chunkLines = (groupIndex: number): string[] => (melodyGroups[groupIndex] ?? '').split(/\r?\n/).filter(Boolean);
  const bFirstHalf = [
    ...chunkLines(0), ...chunkLines(1), '',
    ...chunkLines(4), '', ...chunkLines(5)
  ].join('\n');
  const bSecondHalf = [
    ...chunkLines(2), ...chunkLines(3), '',
    ...chunkLines(6), '', ...chunkLines(7)
  ].join('\n');
  return [
    `${chordHeader}\n${chordOnly.join('\n')}`,
    chordRows.slice(0, 8).join('\n'),
    chordRows.slice(8, 16).join('\n'),
    `${melodyHeader}\n${bFirstHalf}`,
    bSecondHalf
  ];
});
const currentStep = computed(() => {
  const index = props.snapshot.tutorialStepIndex;
  const step = steps.value[index]!;
  const codeByStep: Record<number, number> = { 2: 0, 3: 1, 4: 2, 7: 3, 8: 4 };
  const exampleIndex = codeByStep[index];
  return exampleIndex === undefined ? step : { ...step, code: fixtureExamples.value[exampleIndex] };
});

async function copyExample(): Promise<void> {
  if (!currentStep.value.code) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(currentStep.value.code);
    copyState.value = 'copied';
  } catch { copyState.value = 'failed'; }
}
</script>

<template>
  <section class="tutorial-panel" :aria-label="t('tutorial.title')">
    <header class="tutorial-heading">
      <div><h2>{{ t('tutorial.title') }}</h2><p>{{ t('tutorial.step', { current: snapshot.tutorialStepIndex + 1 }) }}</p></div>
      <div class="tutorial-completion">
        <span :data-complete="snapshot.tutorialChordOnlyCompleted">A</span>
        <span :data-complete="snapshot.tutorialMelodyCompleted">B</span>
      </div>
    </header>
    <article class="tutorial-step" :key="snapshot.tutorialStepIndex">
      <h3>{{ currentStep.title }}</h3>
      <p>{{ currentStep.body }}</p>
      <pre v-if="currentStep.code"><code>{{ currentStep.code }}</code></pre>
      <button v-if="currentStep.code" type="button" @click="copyExample">{{ t('tutorial.copy') }}</button>
      <p class="tutorial-copy-status" role="status" aria-live="polite">{{ copyState === 'copied' ? t('tutorial.copied') : copyState === 'failed' ? t('tutorial.copyFailed') : '' }}</p>
    </article>
    <div class="tutorial-completion-labels">
      <span v-if="snapshot.tutorialChordOnlyCompleted">{{ t('tutorial.completedA') }}</span>
      <span v-if="snapshot.tutorialMelodyCompleted">{{ t('tutorial.completedB') }}</span>
    </div>
    <footer class="tutorial-actions">
      <button type="button" :disabled="snapshot.tutorialStepIndex === 0" @click="emit('command', { type: 'tutorial.navigate', action: 'previous' })">{{ t('tutorial.previous') }}</button>
      <button type="button" @click="emit('command', { type: 'tutorial.navigate', action: 'restart' })">{{ t('tutorial.restart') }}</button>
      <button type="button" :disabled="snapshot.tutorialStepIndex === 9" @click="emit('command', { type: 'tutorial.navigate', action: 'next' })">{{ t('tutorial.next') }}</button>
      <button type="button" class="tutorial-finish" @click="emit('command', { type: 'tutorial.navigate', action: 'finish' })">{{ t('tutorial.finish') }}</button>
    </footer>
  </section>
</template>
