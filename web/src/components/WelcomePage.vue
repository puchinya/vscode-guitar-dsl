<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { WorkspaceCommand, WorkspaceViewSnapshot } from '../types/workspace';

const props = defineProps<{ snapshot: Readonly<WorkspaceViewSnapshot> }>();
const emit = defineEmits<{ command: [command: WorkspaceCommand] }>();
const { t } = useI18n({ useScope: 'global' });
const legalUrl = (page: string, locale: string) => `https://guitardsl.app/${page}/${locale}/`;
function setWelcomeSuppressed(event: Event): void {
  const input = event.currentTarget as HTMLInputElement;
  const requested = input.checked;
  input.checked = props.snapshot.welcomeSuppressed;
  emit('command', { type: 'welcome.set-suppressed', suppressed: requested });
}
</script>

<template>
  <section class="welcome-page" :aria-label="t('welcome.heading')">
    <div class="welcome-grid">
      <section class="welcome-start" :aria-labelledby="'welcome-start-heading'">
        <p class="welcome-eyebrow">GuitarDSL</p>
        <h1>{{ t('welcome.heading') }}</h1>
        <p class="welcome-subtitle">{{ t('welcome.subtitle') }}</p>
        <h2 id="welcome-start-heading">{{ t('welcome.start') }}</h2>
        <div class="welcome-actions">
          <button type="button" class="welcome-primary" @click="emit('command', { type: 'document.create' })">{{ t('welcome.create') }}</button>
          <button v-if="['disconnected', 'reauth', 'connecting'].includes(snapshot.driveStatus)" type="button" :disabled="snapshot.driveStatus === 'connecting'" @click="emit('command', { type: 'drive.connect', source: 'welcome' })">{{ t('welcome.connect') }}</button>
          <div v-else-if="snapshot.driveStatus === 'offline'" class="welcome-drive-connected" role="status">
            <strong>{{ t('welcome.driveOffline') }}</strong>
            <p>{{ t('welcome.driveOfflineHint') }}</p>
          </div>
          <div v-else class="welcome-drive-connected" role="status">
            <strong>{{ t('welcome.connected') }}</strong>
            <p>{{ t('welcome.driveHint') }}</p>
          </div>
          <button type="button" @click="emit('command', { type: 'tutorial.open' })">{{ t('welcome.tutorial') }}</button>
        </div>
        <div class="welcome-storage">
          <h2>{{ t('welcome.storage') }}</h2>
          <p>{{ t('welcome.storageText') }}</p>
        </div>
        <label class="welcome-suppress"><input type="checkbox" :checked="snapshot.welcomeSuppressed" @change="setWelcomeSuppressed" />{{ t('welcome.suppress') }}</label>
      </section>
      <section class="welcome-about" :aria-labelledby="'welcome-about-heading'">
        <h2 id="welcome-about-heading">{{ t('welcome.about') }}</h2>
        <ul class="welcome-capabilities">
          <li>{{ t('welcome.subtitle') }}</li>
          <li>{{ t('welcome.storageText') }}</li>
        </ul>
        <nav class="welcome-links" :aria-label="t('welcome.about')">
          <button type="button" @click="emit('command', { type: 'help.open' })">{{ t('welcome.help') }}</button>
          <a :href="legalUrl('terms', snapshot.locale)" target="_blank" rel="noopener noreferrer">{{ t('welcome.terms') }}</a>
          <a :href="legalUrl('licenses', snapshot.locale)" target="_blank" rel="noopener noreferrer">{{ t('welcome.licenses') }}</a>
          <a :href="legalUrl('privacy', snapshot.locale)" target="_blank" rel="noopener noreferrer">{{ t('welcome.privacy') }}</a>
          <a href="https://github.com/puchinya/vscode-guitar-dsl" target="_blank" rel="noopener noreferrer">{{ t('welcome.source') }}</a>
        </nav>
      </section>
    </div>
  </section>
</template>
