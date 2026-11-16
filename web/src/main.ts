import './style.css';
import { createApp } from 'vue';
import App from './App.vue';
import { createWorkspaceController } from './controllers/workspaceController';

const controller = createWorkspaceController();
createApp(App, { controller }).mount('#app');
void controller.start();
