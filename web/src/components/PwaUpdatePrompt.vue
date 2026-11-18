<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { PwaUpdateSnapshot } from '../pwa/registerPwa';
const { t } = useI18n({ useScope: 'global' });

defineProps<{ state: Readonly<PwaUpdateSnapshot> }>();
const emit = defineEmits<{ update: []; later: [] }>();
</script>

<template>
  <section
    v-if="state.updateAvailable"
    class="pwa-update-prompt"
    role="region"
    aria-live="polite"
    aria-atomic="true"
    :aria-label="t('pwa.title')"
  >
    <div class="pwa-update-copy">
      <strong>{{ t('pwa.updateReady') }}</strong>
      <span>{{ t('pwa.saveBeforeReload') }}</span>
      <span v-if="state.blockedReason" class="pwa-update-blocked" role="status">{{ state.blockedReason }}</span>
    </div>
    <div class="pwa-update-actions">
      <button type="button" class="quiet-button" :disabled="state.updating" @click="emit('later')">
        {{ t('pwa.later') }}
      </button>
      <button type="button" class="primary-button" :disabled="state.updating" @click="emit('update')">
        {{ state.updating ? t('pwa.checking') : t('pwa.update') }}
      </button>
    </div>
  </section>
</template>
