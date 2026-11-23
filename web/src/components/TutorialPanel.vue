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
  const splitVerseGroups = (fixture: string) => {
    const normalized = fixture.replace(/\r\n?/gu, '\n');
    const [metadata, verse = ''] = normalized.split('\n\n[Verse 1]\n');
    return { header: `${metadata}\n\n[Verse 1]`, groups: verse.trimEnd().split('\n\n') };
  };
  const chordParts = splitVerseGroups(chordFixture);
  const melodyParts = splitVerseGroups(melodyFixture);
  const chordGroups = chordParts.groups.map((group) => group.replace(/ l:"[^"]*"/gu, ''));
  const joinGroups = (groups: string[]) => groups.join('\n\n');
  const bFirstHalf = joinGroups([
    ...melodyParts.groups.slice(0, 2), ...melodyParts.groups.slice(4, 6)
  ]);
  const bSecondHalf = joinGroups([
    ...melodyParts.groups.slice(2, 4), ...melodyParts.groups.slice(6, 8)
  ]);
  return [
    `${chordParts.header}\n${joinGroups(chordGroups)}`,
    joinGroups(chordParts.groups.slice(0, 2)),
    joinGroups(chordParts.groups.slice(2, 4)),
    `${melodyParts.header}\n${bFirstHalf}`,
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
