import { onUnmounted, shallowRef } from 'vue';
import type { WebWorkspaceController } from '../types/workspace';

export function useWorkspace(controller: WebWorkspaceController) {
  const snapshot = shallowRef<Readonly<ReturnType<WebWorkspaceController['snapshot']>>>(controller.snapshot());
  const unsubscribe = controller.subscribe(next => { snapshot.value = next; });
  onUnmounted(unsubscribe);
  return { snapshot };
}
