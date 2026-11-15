<script setup lang="ts">
import type { PwaUpdateSnapshot } from '../pwa/registerPwa';

defineProps<{ state: Readonly<PwaUpdateSnapshot>; locale: 'en' | 'ja' }>();
const emit = defineEmits<{ update: []; later: [] }>();
</script>

<template>
  <section
    v-if="state.updateAvailable"
    class="pwa-update-prompt"
    role="dialog"
    aria-modal="true"
    :aria-label="locale === 'ja' ? 'アプリの更新' : 'App update'"
  >
    <div class="pwa-update-copy">
      <strong>{{ locale === 'ja' ? 'GuitarDSL の更新があります' : 'A GuitarDSL update is ready' }}</strong>
      <span>{{ locale === 'ja' ? '更新の前に編集中の内容を保存します。再読み込み後は元に戻す履歴が失われる場合があります。' : 'The app checks that your work is saved before reloading. CodeMirror undo history may not survive the update.' }}</span>
      <span v-if="state.blockedReason" class="pwa-update-blocked" role="status">{{ state.blockedReason }}</span>
    </div>
    <div class="pwa-update-actions">
      <button type="button" class="quiet-button" :disabled="state.updating" @click="emit('later')">
        {{ locale === 'ja' ? '後で' : 'Later' }}
      </button>
      <button type="button" class="primary-button" :disabled="state.updating" @click="emit('update')">
        {{ state.updating ? (locale === 'ja' ? '確認中…' : 'Checking…') : locale === 'ja' ? '更新する' : 'Update' }}
      </button>
    </div>
  </section>
</template>
