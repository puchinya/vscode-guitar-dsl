import type { WebWorkspaceController, WorkspaceCommand, WorkspaceContextMenuRequest, WorkspaceHostBindings, WorkspaceViewSnapshot } from '../types/workspace';

export type { WebWorkspaceController } from '../types/workspace';

type RuntimeController = Omit<WebWorkspaceController, 'start'> & WorkspaceHostBindings;

const initialSnapshot: Readonly<WorkspaceViewSnapshot> = Object.freeze({
  ready: false,
  tabs: [], activeKey: null, activeStorage: 'local', locale: 'en', theme: 'system', viewMode: 'split',
  welcomeOpen: false, welcomeActive: false, welcomeSuppressed: false,
  rightDockPane: 'inspector', tutorialStepIndex: 0, tutorialChordOnlyCompleted: false, tutorialMelodyCompleted: false,
  aboutOpen: false,
  explorerOpen: true, inspectorOpen: true, problemsOpen: true, explorerAutoHidden: false, inspectorAutoHidden: false,
  localExpanded: true, driveExpanded: true, explorerWidth: 220, inspectorWidth: 300, problemsHeight: 200, splitRatio: 0.4,
  localFiles: [], driveFiles: [], driveEntries: [], diagnostics: [], online: typeof navigator === 'undefined' || navigator.onLine,
  driveStatus: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'disconnected', driveGeneration: 0,
  driveBusy: false, saveDisabled: false,
  pwa: { updateAvailable: false, offlineReady: false, updating: false, online: typeof navigator === 'undefined' || navigator.onLine }
});

/** Stable Vue-facing facade. The stateful runtime is loaded only after Vue has mounted its host elements. */
export function createWorkspaceController(): WebWorkspaceController & WorkspaceHostBindings {
  let current: Readonly<WorkspaceViewSnapshot> = initialSnapshot;
  let runtime: RuntimeController | undefined;
  let starting: Promise<void> | undefined;
  let disposed = false;
  const listeners = new Set<(snapshot: Readonly<WorkspaceViewSnapshot>) => void>();
  const pendingCommands: WorkspaceCommand[] = [];
  const hosts: Partial<Parameters<WorkspaceHostBindings['mountInspectorHosts']>[0]> & {
    sourceEditor?: HTMLElement;
    scoreFrame?: HTMLIFrameElement;
  } = {};

  const publish = (snapshot: Readonly<WorkspaceViewSnapshot>): void => {
    current = snapshot;
    for (const listener of listeners) listener(current);
  };

  const controller: WebWorkspaceController & WorkspaceHostBindings = {
    snapshot: () => runtime?.snapshot() ?? current,
    subscribe(callback) {
      listeners.add(callback);
      callback(controller.snapshot());
      return () => listeners.delete(callback);
    },
    async start() {
      if (disposed) return;
      if (starting) return starting;
      starting = (async () => {
        const loaded = await import('../workspaceRuntime');
        runtime = loaded.workspaceRuntimeController;
        if (disposed) {
          runtime.dispose();
          runtime = undefined;
          return;
        }
        runtime.mountSourceEditor(hosts.sourceEditor!);
        runtime.mountScoreFrame(hosts.scoreFrame!);
        if (hosts.content && hosts.tabs && hosts.settings && hosts.settingsLabels) {
          runtime.mountInspectorHosts({ content: hosts.content, tabs: hosts.tabs, settings: hosts.settings, settingsLabels: hosts.settingsLabels });
        }
        runtime.subscribe(publish);
        publish(runtime.snapshot());
        for (const command of pendingCommands.splice(0)) void runtime.dispatch(command);
      })();
      return starting;
    },
    dispatch(command) {
      if (disposed) return;
      if (runtime) return runtime.dispatch(command);
      pendingCommands.push(command);
    },
    prepareForReload() {
      return runtime?.prepareForReload() ?? Promise.resolve({ ok: false as const, reason: 'The workspace is still starting.' });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      runtime?.dispose();
      runtime = undefined;
      pendingCommands.length = 0;
      listeners.clear();
    },
    mountSourceEditor(container) {
      hosts.sourceEditor = container;
    },
    mountScoreFrame(frame) {
      hosts.scoreFrame = frame;
    },
    mountInspectorHosts(value) {
      Object.assign(hosts, value);
    },
    requestContextMenu(request: WorkspaceContextMenuRequest) {
      if (disposed) return;
      runtime?.requestContextMenu(request);
    }
  };

  return controller;
}
