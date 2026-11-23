<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { WorkspaceCommand, WorkspaceViewSnapshot } from '../types/workspace';

const props = defineProps<{ snapshot: Readonly<WorkspaceViewSnapshot> }>();
const emit = defineEmits<{ command: [command: WorkspaceCommand] }>();
const { t, locale } = useI18n({ useScope: 'global' });

function legalHref(page: 'terms' | 'licenses' | 'privacy'): string {
  const activeLocale = locale.value === 'ja' ? 'ja' : 'en';
  return `https://guitardsl.app/${page}/${activeLocale}/`;
}

function setWelcomeSuppressed(event: Event): void {
  const input = event.currentTarget as HTMLInputElement;
  const requested = input.checked;
  input.checked = props.snapshot.welcomeSuppressed;
  emit('command', { type: 'welcome.set-suppressed', suppressed: requested });
}
</script>

<template>
  <section class="welcome-page" :aria-labelledby="'welcome-heading'">
    <div class="welcome-content">
      <header class="welcome-hero">
        <h1 id="welcome-heading">{{ t('welcome.heading') }}</h1>
        <p class="welcome-subtitle">{{ t('welcome.subtitle') }}</p>
      </header>

      <div class="welcome-columns">
        <div class="welcome-start-column">
          <section class="welcome-start" aria-labelledby="welcome-start-heading">
            <h2 id="welcome-start-heading">{{ t('welcome.start') }}</h2>
            <div class="welcome-actions">
              <button type="button" class="welcome-action" @click="emit('command', { type: 'document.create' })">
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 2.75h7l4 4v10.5H4z" /><path d="M11 2.75v4h4M10 9v6m-3-3h6" /></svg>
                <span>{{ t('welcome.create') }}</span>
              </button>
              <button v-if="['disconnected', 'reauth', 'connecting'].includes(snapshot.driveStatus)" type="button" class="welcome-action" :disabled="snapshot.driveStatus === 'connecting'" @click="emit('command', { type: 'drive.connect', source: 'welcome' })">
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 5 6 0M5.4 6.2 3.8 9m1.6 4.8 1.6 2.8m7.6-2.8-1.6 2.8M14.6 6.2 16.2 9" /><circle cx="4.6" cy="5" r="2" /><circle cx="15.4" cy="5" r="2" /><circle cx="2.8" cy="11" r="2" /><circle cx="17.2" cy="11" r="2" /><circle cx="10" cy="16" r="2" /></svg>
                <span>{{ t('welcome.connect') }}</span>
              </button>
              <div v-else class="welcome-drive-status" role="status">
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 5 6 0M5.4 6.2 3.8 9m1.6 4.8 1.6 2.8m7.6-2.8-1.6 2.8M14.6 6.2 16.2 9" /><circle cx="4.6" cy="5" r="2" /><circle cx="15.4" cy="5" r="2" /><circle cx="2.8" cy="11" r="2" /><circle cx="17.2" cy="11" r="2" /><circle cx="10" cy="16" r="2" /></svg>
                <div>
                  <strong>{{ snapshot.driveStatus === 'offline' ? t('welcome.driveOffline') : t('welcome.connected') }}</strong>
                  <p>{{ snapshot.driveStatus === 'offline' ? t('welcome.driveOfflineHint') : t('welcome.driveHint') }}</p>
                </div>
              </div>
              <button type="button" class="welcome-action" @click="emit('command', { type: 'tutorial.open' })">
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 4.25c2.4-.8 4.6-.45 6.5 1.1 1.9-1.55 4.1-1.9 6.5-1.1v11c-2.4-.8-4.6-.45-6.5 1.1-1.9-1.55-4.1-1.9-6.5-1.1zM10 5.35v11" /></svg>
                <span>{{ t('welcome.tutorial') }}</span>
              </button>
            </div>
          </section>

          <section class="welcome-storage" aria-labelledby="welcome-storage-heading">
            <h2 id="welcome-storage-heading">{{ t('welcome.storage') }}</h2>
            <p>{{ t('welcome.storageText') }}</p>
          </section>
        </div>

        <nav class="welcome-links" aria-labelledby="welcome-links-heading">
          <h2 id="welcome-links-heading">{{ t('welcome.links') }}</h2>
          <ul class="welcome-link-list">
            <li><button type="button" @click="emit('command', { type: 'help.open' })">{{ t('welcome.help') }}</button></li>
            <li><a :href="legalHref('terms')" target="_blank" rel="noopener noreferrer">{{ t('welcome.terms') }}</a></li>
            <li><a :href="legalHref('licenses')" target="_blank" rel="noopener noreferrer">{{ t('welcome.licenses') }}</a></li>
            <li><a :href="legalHref('privacy')" target="_blank" rel="noopener noreferrer">{{ t('welcome.privacy') }}</a></li>
            <li><a href="https://github.com/puchinya/vscode-guitar-dsl" target="_blank" rel="noopener noreferrer">{{ t('welcome.source') }}</a></li>
          </ul>
        </nav>
      </div>

      <footer class="welcome-footer">
        <label class="welcome-suppress"><input type="checkbox" :checked="snapshot.welcomeSuppressed" @change="setWelcomeSuppressed" />{{ t('welcome.suppress') }}</label>
      </footer>
    </div>
  </section>
</template>
