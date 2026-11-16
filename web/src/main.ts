import './style.css';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { createWorkspaceController } from './controllers/workspaceController';
import { useWorkspaceStore } from './stores/workspaceStore';

const controller = createWorkspaceController();
const pinia = createPinia();
useWorkspaceStore(pinia).attach(controller);
createApp(App, { controller }).use(pinia).mount('#app');
void controller.start();
