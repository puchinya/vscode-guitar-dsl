import { createI18n } from 'vue-i18n';
import type { WorkspaceLocale } from '../types/workspace';
import { en } from './messages/en';
import { ja } from './messages/ja';

export function createWebI18n(initialLocale: WorkspaceLocale) {
  return createI18n({
    legacy: false,
    locale: initialLocale,
    fallbackLocale: 'en',
    messages: { en, ja }
  });
}
