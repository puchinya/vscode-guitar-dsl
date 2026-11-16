import { defineStore } from 'pinia';
import { computed, shallowRef } from 'vue';
import type { WebWorkspaceController, WorkspaceViewSnapshot } from '../types/workspace';

export type WorkspaceViewSource = Pick<WebWorkspaceController, 'snapshot' | 'subscribe'>;

export const useWorkspaceStore = defineStore('workspace', () => {
  const view = shallowRef<Readonly<WorkspaceViewSnapshot> | null>(null);
  let attachedSource: WorkspaceViewSource | null = null;
  let unsubscribe: (() => void) | null = null;
  let subscriptionGeneration = 0;

  const problemSummary = computed(() => {
    const snapshot = view.value;
    const errors = snapshot?.diagnostics.filter(item => item.severity === 'error').length ?? 0;
    const warnings = snapshot?.diagnostics.filter(item => item.severity === 'warning').length ?? 0;
    return snapshot?.locale === 'ja'
      ? `エラー ${errors} / 警告 ${warnings}`
      : `Errors ${errors} / Warnings ${warnings}`;
  });

  function attach(source: WorkspaceViewSource): void {
    if (attachedSource === source) return;
    if (attachedSource !== null) {
      throw new Error('Workspace store is already attached; call detach() before attaching a different controller.');
    }

    const initialSnapshot = source.snapshot();
    const generation = ++subscriptionGeneration;
    attachedSource = source;
    view.value = initialSnapshot;

    try {
      const stop = source.subscribe(next => {
        if (attachedSource === source && subscriptionGeneration === generation) view.value = next;
      });
      if (attachedSource === source && subscriptionGeneration === generation) unsubscribe = stop;
      else stop();
    } catch (error) {
      if (attachedSource === source && subscriptionGeneration === generation) {
        attachedSource = null;
        subscriptionGeneration++;
      }
      throw error;
    }
  }

  function detach(): void {
    const stop = unsubscribe;
    unsubscribe = null;
    attachedSource = null;
    subscriptionGeneration++;
    stop?.();
  }

  return { view, problemSummary, attach, detach };
});
