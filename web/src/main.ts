import './style.css';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { createWorkspaceController } from './controllers/workspaceController';
import { useWorkspaceStore } from './stores/workspaceStore';
import { createWebI18n } from './i18n';

const controller = createWorkspaceController();
const pinia = createPinia();
const i18n = createWebI18n(controller.snapshot().locale);
useWorkspaceStore(pinia).attach(controller);
createApp(App, { controller }).use(pinia).use(i18n).mount('#app');
void controller.start();
