import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPinia, setActivePinia, storeToRefs } from 'pinia';
import { isReactive, watch } from 'vue';
import { useWorkspaceStore, type WorkspaceViewSource } from '../../src/stores/workspaceStore';
import type { WorkspaceViewSnapshot } from '../../src/types/workspace';

type Listener = (snapshot: Readonly<WorkspaceViewSnapshot>) => void;

function makeSnapshot(overrides: Partial<WorkspaceViewSnapshot> = {}): Readonly<WorkspaceViewSnapshot> {
  return {
    ready: false,
    tabs: [], activeKey: null, activeStorage: 'local', locale: 'en', theme: 'system', viewMode: 'split',
    explorerOpen: true, inspectorOpen: true, problemsOpen: true, explorerAutoHidden: false, inspectorAutoHidden: false,
    localExpanded: true, driveExpanded: true, explorerWidth: 220, inspectorWidth: 300, problemsHeight: 200, splitRatio: 0.4,
    localFiles: [], driveFiles: [], diagnostics: [], online: true, driveStatus: 'disconnected', driveGeneration: 0,
    driveBusy: false, saveDisabled: false,
    pwa: { updateAvailable: false, offlineReady: false, updating: false, online: true },
    ...overrides
  };
}

function makeSource(initial: Readonly<WorkspaceViewSnapshot>) {
  let current = initial;
  let activeListener: Listener | undefined;
  let lastListener: Listener | undefined;
  let subscriptions = 0;
  let unsubscriptions = 0;
  let disposals = 0;
  const source: WorkspaceViewSource = {
    snapshot: () => current,
    subscribe(listener) {
      subscriptions++;
      activeListener = listener;
      lastListener = listener;
      listener(current);
      return () => {
        unsubscriptions++;
        if (activeListener === listener) activeListener = undefined;
      };
    }
  };
  return {
    source,
    emit(snapshot: Readonly<WorkspaceViewSnapshot>) {
      current = snapshot;
      activeListener?.(snapshot);
    },
    lastListener: () => lastListener,
    get subscriptions() { return subscriptions; },
    get unsubscriptions() { return unsubscriptions; },
    dispose() { disposals++; },
    get disposals() { return disposals; }
  };
}

function activateStore() {
  setActivePinia(createPinia());
  return useWorkspaceStore();
}

test('attaches one subscription and replaces the shallow view reference', () => {
  const store = activateStore();
  const first = makeSnapshot();
  const source = makeSource(first);
  const refs = storeToRefs(store);

  assert.equal(store.view, null);
  store.attach(source.source);
  assert.equal(store.view, first);
  assert.equal(refs.view.value, first);
  assert.equal(source.subscriptions, 1);

  store.attach(source.source);
  assert.equal(source.subscriptions, 1);

  const diagnostics = [{ severity: 'error' as const, message: 'bad score', file: 'song.guitardsl', line: 1, column: 1, from: 0, to: 1 }];
  const next = makeSnapshot({ activeKey: 'local:song.guitardsl', diagnostics });
  source.emit(next);

  assert.equal(refs.view.value, next);
  assert.equal(refs.view.value?.diagnostics, diagnostics);
  assert.equal(isReactive(refs.view.value), false);
  assert.equal(isReactive(refs.view.value?.diagnostics), false);
});

test('rejects a different controller until the current one is detached', () => {
  const store = activateStore();
  const first = makeSource(makeSnapshot());
  const second = makeSource(makeSnapshot({ activeKey: 'second' }));

  store.attach(first.source);
  assert.throws(() => store.attach(second.source), /call detach\(\)/);
  assert.equal(second.subscriptions, 0);

  store.detach();
  store.attach(second.source);
  assert.equal(store.view, second.source.snapshot());
  assert.equal(second.subscriptions, 1);
});

test('updates the localized problem summary and storeToRefs consumers', () => {
  const store = activateStore();
  const refs = storeToRefs(store);
  const source = makeSource(makeSnapshot());
  const summaries: string[] = [];
  const stop = watch(() => refs.problemSummary.value, value => summaries.push(value), { flush: 'sync' });

  assert.equal(store.problemSummary, 'Errors 0 / Warnings 0');
  store.attach(source.source);
  source.emit(makeSnapshot({
    locale: 'en',
    diagnostics: [
      { severity: 'error', message: 'bad score', file: 'song.guitardsl', line: 1, column: 1, from: 0, to: 1 },
      { severity: 'warning', message: 'check score', file: 'song.guitardsl', line: 2, column: 1, from: 4, to: 5 }
    ]
  }));
  assert.equal(store.problemSummary, 'Errors 1 / Warnings 1');

  source.emit(makeSnapshot({
    locale: 'ja',
    diagnostics: [
      { severity: 'error', message: 'bad score', file: 'song.guitardsl', line: 1, column: 1, from: 0, to: 1 },
      { severity: 'error', message: 'bad score 2', file: 'song.guitardsl', line: 2, column: 1, from: 4, to: 5 },
      { severity: 'warning', message: 'check score', file: 'song.guitardsl', line: 3, column: 1, from: 8, to: 9 }
    ]
  }));
  assert.equal(store.problemSummary, 'エラー 2 / 警告 1');
  assert.deepEqual(summaries, ['Errors 1 / Warnings 1', 'エラー 2 / 警告 1']);
  stop();
});

test('detaches once, ignores stale callbacks, retains the last view, and can reattach', () => {
  const store = activateStore();
  const first = makeSource(makeSnapshot({ activeKey: 'first' }));
  const second = makeSource(makeSnapshot({ activeKey: 'second' }));
  store.attach(first.source);
  const oldView = store.view;
  const staleCallback = first.lastListener();

  store.detach();
  store.detach();
  assert.equal(first.unsubscriptions, 1);
  assert.equal(store.view, oldView);
  assert.equal(first.disposals, 0);

  staleCallback?.(makeSnapshot({ activeKey: 'stale' }));
  assert.equal(store.view, oldView);

  store.attach(second.source);
  assert.equal(store.view, second.source.snapshot());
  staleCallback?.(makeSnapshot({ activeKey: 'stale again' }));
  assert.equal(store.view?.activeKey, 'second');
});
