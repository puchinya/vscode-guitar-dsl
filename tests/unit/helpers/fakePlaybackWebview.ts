import * as vm from 'vm';

type Listener = (event: any) => unknown;

class FakeClassList {
  private readonly values = new Set<string>();

  add(...names: string[]): void {
    for (const name of names) this.values.add(name);
  }

  remove(...names: string[]): void {
    for (const name of names) this.values.delete(name);
  }

  contains(name: string): boolean {
    return this.values.has(name);
  }

  toggle(name: string, force?: boolean): boolean {
    const next = force ?? !this.values.has(name);
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Listener[]>();
  value = '';
  checked = false;
  disabled = false;
  hidden = false;
  textContent = '';
  innerHTML = '';
  title = '';
  parentNode: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  rectTop = 200;
  readonly tagName: string;

  constructor(tagName = 'div') {
    this.tagName = tagName;
  }

  addEventListener(type: string, listener: Listener): void {
    const values = this.listeners.get(type) ?? [];
    values.push(listener);
    this.listeners.set(type, values);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  closest(selector: string): FakeElement | null {
    let current: FakeElement | null = this;
    while (current) {
      if (selector.startsWith('.') && (current.getAttribute('class') ?? '').split(/\s+/).includes(selector.slice(1))) return current;
      current = current.parentNode;
    }
    return null;
  }

  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child: FakeElement, before: FakeElement | null): FakeElement {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  removeChild(child: FakeElement): FakeElement {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  getBoundingClientRect(): { top: number; bottom: number; height: number } {
    return { top: this.rectTop, bottom: this.rectTop + 100, height: 100 };
  }

  async dispatch(type: string): Promise<void> {
    const event = { target: this, currentTarget: this };
    for (const listener of this.listeners.get(type) ?? []) await listener(event);
  }
}

class FakeAudioParam {
  value = 0;
  readonly events: Array<{ kind: string; value: number; time: number }> = [];

  setValueAtTime(value: number, time: number): void {
    this.value = value;
    this.events.push({ kind: 'set', value, time });
  }

  cancelScheduledValues(time: number): void {
    for (let index = this.events.length - 1; index >= 0; index--) {
      if (this.events[index].time >= time) this.events.splice(index, 1);
    }
    this.events.push({ kind: 'cancel', value: 0, time });
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.value = value;
    this.events.push({ kind: 'ramp', value, time });
  }
}

class FakeGainNode {
  readonly gain = new FakeAudioParam();
  connectedTo: unknown;
  disconnected = false;

  connect(destination: unknown): void {
    this.connectedTo = destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeOscillatorNode {
  readonly frequency = new FakeAudioParam();
  type = 'sine';
  startAt: number | undefined;
  stopAt: number | undefined;
  readonly stopCalls: number[] = [];
  connectedTo: unknown;
  disconnected = false;
  ended = false;
  onended: (() => void) | null = null;

  constructor(private readonly now: () => number) {}

  connect(destination: unknown): void {
    this.connectedTo = destination;
  }

  start(when = this.now()): void {
    this.startAt = when;
  }

  stop(when = this.now()): void {
    this.stopCalls.push(when);
    this.stopAt = Math.min(this.stopAt ?? Number.POSITIVE_INFINITY, when);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  advanceTo(time: number): void {
    if (this.ended || this.stopAt === undefined || this.stopAt > time) return;
    this.finish();
  }

  finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.onended?.();
  }
}

interface FakeInterval {
  callback: () => void;
  delay: number;
}

export interface FakePlaybackWebview {
  readonly playbackData: Record<string, any>;
  click(id: string): Promise<void>;
  setRange(id: string, value: number): void;
  setChecked(id: string, value: boolean): void;
  change(id: string): Promise<void>;
  advanceAudioTime(seconds: number): void;
  runSchedulerTicks(): void;
  fireWindowEvent(name: string, event?: unknown): Promise<void>;
  sendPlaybackAction(action: string): Promise<void>;
  runAnimationFrames(): void;
  setAnchorRectTop(top: number): void;
  scoreOverlayElementCount(): number;
  activeOscillators(): FakeOscillatorNode[];
  scheduledOscillators(): FakeOscillatorNode[];
  readonly audioContextCount: number;
  readonly audioContextCloseCount: number;
  readonly intervalCount: number;
  readonly scrollY: number;
  readonly savedWebviewState: unknown;
  element(id: string): FakeElement;
}

export function createFakePlaybackWebview(html: string, restoredState?: unknown): FakePlaybackWebview {
  const scripts = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi));
  const dataScript = scripts.find((match) => /\bid=["']playback-data["']/.test(match[1]));
  const executableScript = scripts.find((match) => !/\btype=["']application\/json["']/.test(match[1]));
  if (!dataScript || !executableScript) throw new Error('Preview HTML must contain playback JSON and an executable inline script');

  const playbackData = JSON.parse(dataScript[2]) as Record<string, any>;
  const elements = new Map<string, FakeElement>();
  const playbackDataElement = new FakeElement();
  playbackDataElement.textContent = dataScript[2];
  elements.set('playback-data', playbackDataElement);

  const windowListeners = new Map<string, Array<(event?: unknown) => unknown>>();
  const documentListeners = new Map<string, Listener[]>();
  const intervals = new Map<number, FakeInterval>();
  const contexts: Array<InstanceType<typeof FakeAudioContext>> = [];
  let nextIntervalId = 1;
  let savedWebviewState = restoredState;
  let nextAnimationFrameId = 1;
  let scrollY = 0;
  const animationFrames = new Map<number, (time: number) => unknown>();

  class FakeAudioContext {
    currentTime = 0;
    state = 'running';
    readonly destination = {};
    readonly oscillators: FakeOscillatorNode[] = [];
    closeCalls = 0;

    constructor() {
      contexts.push(this);
    }

    createOscillator(): FakeOscillatorNode {
      const oscillator = new FakeOscillatorNode(() => this.currentTime);
      this.oscillators.push(oscillator);
      return oscillator;
    }

    createGain(): FakeGainNode {
      return new FakeGainNode();
    }

    async resume(): Promise<void> {
      this.state = 'running';
    }

    async close(): Promise<void> {
      this.closeCalls++;
      this.state = 'closed';
      for (const oscillator of this.oscillators) oscillator.finish();
    }

    advanceTo(time: number): void {
      this.currentTime = time;
      for (const oscillator of this.oscillators) oscillator.advanceTo(time);
    }
  }

  const body = new FakeElement();
  body.setAttribute('data-page-size', 'A4');
  body.setAttribute('data-orientation', 'portrait');
  const anchors: FakeElement[] = [];
  const systemElements: FakeElement[] = [];
  for (const match of html.matchAll(/<rect\b([^>]*\bclass=["']playback-measure-anchor["'][^>]*)\/?\s*>/gi)) {
    const anchor = new FakeElement('rect');
    const attributes = match[1];
    for (const attribute of attributes.matchAll(/([\w:-]+)=["']([^"']*)["']/g)) {
      anchor.setAttribute(attribute[1], attribute[2]);
    }
    const system = new FakeElement('g');
    system.setAttribute('class', 'system');
    system.appendChild(anchor);
    anchors.push(anchor);
    systemElements.push(system);
  }
  const document = {
    body,
    getElementById(id: string): FakeElement {
      let element = elements.get(id);
      if (!element) {
        element = new FakeElement();
        elements.set(id, element);
      }
      return element;
    },
    querySelectorAll(selector: string): FakeElement[] {
      if (selector.includes('playback-measure-anchor')) return anchors;
      return [];
    },
    createElementNS(_namespace: string, tagName: string): FakeElement {
      return new FakeElement(tagName);
    },
    addEventListener(type: string, listener: Listener): void {
      const values = documentListeners.get(type) ?? [];
      values.push(listener);
      documentListeners.set(type, values);
    }
  };
  const window = {
    AudioContext: FakeAudioContext,
    innerHeight: 800,
    get scrollY() { return scrollY; },
    scrollTo(_x: number, y: number): void {
      scrollY = y;
      for (const listener of windowListeners.get('scroll') ?? []) listener({});
    },
    requestAnimationFrame(callback: (time: number) => unknown): number {
      const id = nextAnimationFrameId++;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id: number): void {
      animationFrames.delete(id);
    },
    setInterval(callback: () => void, delay: number): number {
      const id = nextIntervalId++;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id: number): void {
      intervals.delete(id);
    },
    addEventListener(name: string, listener: (event?: unknown) => unknown): void {
      const values = windowListeners.get(name) ?? [];
      values.push(listener);
      windowListeners.set(name, values);
    }
  };
  const vscode = {
    getState: () => savedWebviewState,
    setState: (state: unknown) => { savedWebviewState = state; },
    postMessage: () => undefined
  };

  vm.runInNewContext(executableScript[2], {
    window,
    document,
    acquireVsCodeApi: () => vscode
  }, { timeout: 1000 });

  const allOscillators = () => contexts.flatMap((context) => context.oscillators);
  const getElement = (id: string) => document.getElementById(id);

  return {
    playbackData,
    click: async (id) => { await getElement(id).dispatch('click'); },
    setRange: (id, value) => { getElement(id).value = String(value); },
    setChecked: (id, value) => { getElement(id).checked = value; },
    change: async (id) => { await getElement(id).dispatch('change'); },
    advanceAudioTime: (seconds) => {
      for (const context of contexts) context.advanceTo(context.currentTime + seconds);
    },
    runSchedulerTicks: () => {
      for (const interval of Array.from(intervals.values())) interval.callback();
    },
    fireWindowEvent: async (name, event) => {
      for (const listener of windowListeners.get(name) ?? []) await listener(event);
    },
    sendPlaybackAction: async (action) => {
      for (const listener of windowListeners.get('message') ?? []) await listener({ data: { command: 'playbackAction', action } });
    },
    runAnimationFrames: () => {
      const frames = Array.from(animationFrames.values());
      animationFrames.clear();
      for (const callback of frames) callback(0);
    },
    setAnchorRectTop: (top) => {
      for (const anchor of anchors) anchor.rectTop = top;
    },
    scoreOverlayElementCount: () => systemElements.reduce((count, system) => count + system.children.filter(child => {
      const className = child.getAttribute('class') ?? '';
      return className === 'playback-highlight' || className === 'playback-playhead';
    }).length, 0),
    activeOscillators: () => allOscillators().filter((oscillator) => !oscillator.disconnected && !oscillator.ended),
    scheduledOscillators: allOscillators,
    get audioContextCount() { return contexts.length; },
    get audioContextCloseCount() { return contexts.reduce((count, context) => count + context.closeCalls, 0); },
    get intervalCount() { return intervals.size; },
    get scrollY() { return scrollY; },
    get savedWebviewState() { return savedWebviewState; },
    element: getElement
  };
}
