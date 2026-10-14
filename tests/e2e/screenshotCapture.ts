import * as fs from 'fs/promises';
import * as http from 'http';
import * as path from 'path';

interface DevToolsTarget {
  readonly type: string;
  readonly title: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

interface DevToolsResponse {
  readonly id?: number;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly message?: string };
}

function getTargets(port: number): Promise<DevToolsTarget[]> {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/json/list' }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`DevTools target query returned HTTP ${response.statusCode ?? 'unknown'}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as DevToolsTarget[]);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(1000, () => request.destroy(new Error('DevTools target query timed out')));
    request.once('error', reject);
  });
}

async function waitForWorkbenchTarget(port: number): Promise<DevToolsTarget> {
  let lastTitles: string[] = [];
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const targets = await getTargets(port);
      const pages = targets.filter(target => target.type === 'page');
      lastTitles = pages.map(target => target.title);
      const workbenchTargets = pages.filter(target =>
        /extension development host|拡張機能開発ホスト/i.test(target.title)
      );
      if (workbenchTargets.length === 1) return workbenchTargets[0];
      if (workbenchTargets.length > 1) {
        throw new Error(`Expected one Extension Development Host window, found ${workbenchTargets.length}: ${lastTitles.join(', ')}`);
      }
    } catch (error) {
      if (attempt === 29) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Could not find the Extension Development Host window. DevTools page titles: ${lastTitles.join(', ')}`);
}

/** Captures the selected VS Code workbench page through its local DevTools target. */
export async function captureWorkbenchScreenshot(filename: string, issueNumber = 134): Promise<void> {
  if (process.env.GUITARDSL_E2E_CAPTURE_SCREENSHOTS !== '1') return;
  const outputPath = path.resolve(__dirname, `../../../docs/status/evidence/issue-${issueNumber}`, filename);
  await withWorkbenchDevTools(async send => {
    const width = Number(process.env.GUITARDSL_E2E_VIEWPORT_WIDTH ?? 800);
    if (Number.isFinite(width) && width >= 320) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false
      });
    }
    await send('Page.enable');
    const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const data = result.data;
    if (typeof data !== 'string') throw new Error('DevTools did not return screenshot data');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, Buffer.from(data, 'base64'));
  });
}

export async function scrollInspectorToControls(): Promise<void> {
  if (process.env.GUITARDSL_E2E_CAPTURE_SCREENSHOTS !== '1') return;
  await withWorkbenchDevTools(async send => {
    const dimensionsResult = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({ width: window.innerWidth, height: window.innerHeight })',
      returnByValue: true
    });
    const dimensionsValue = (dimensionsResult.result as { value?: unknown } | undefined)?.value;
    if (typeof dimensionsValue !== 'string') throw new Error('Could not read the workbench viewport size');
    const dimensions = JSON.parse(dimensionsValue) as { width?: unknown; height?: unknown };
    if (typeof dimensions.width !== 'number' || typeof dimensions.height !== 'number') {
      throw new Error('The workbench returned an invalid viewport size');
    }
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: Math.max(0, dimensions.width - 40),
      y: Math.max(0, dimensions.height - 80),
      deltaX: 0,
      deltaY: dimensions.height
    });
  });
}

/** Evaluates a test expression in the selected GuitarDSL Inspector renderer. */
export async function evaluateInspectorWebview<T>(expression: string): Promise<T> {
  const port = Number(process.env.GUITARDSL_E2E_CDP_PORT);
  const targets = await getTargets(port);
  const inspectorTargets = targets.filter(item => item.type === 'iframe'
    && item.url.includes('purpose=webviewView')
    && item.url.includes('extensionId=puchinya.vscode-guitar-dsl'));
  if (inspectorTargets.length !== 1) {
    throw new Error(`Expected one GuitarDSL Inspector webview target, found ${inspectorTargets.length}`);
  }
  return withDevToolsTarget(inspectorTargets[0], async send => {
    await send('Runtime.enable');
    const tree = await send('Page.getFrameTree');
    let activeFrameId: string | undefined;
    const visit = (node: Record<string, unknown>): void => {
      const frame = node.frame as { id?: string; name?: string } | undefined;
      if (frame?.name === 'active-frame') activeFrameId = frame.id;
      if (Array.isArray(node.childFrames)) node.childFrames.forEach(child => visit(child as Record<string, unknown>));
    };
    if (tree.frameTree) visit(tree.frameTree as Record<string, unknown>);
    if (!activeFrameId) throw new Error('Could not find the active Inspector webview frame');
    const isolated = await send('Page.createIsolatedWorld', { frameId: activeFrameId, worldName: 'guitardsl-e2e-evaluation' });
    const contextId = isolated.executionContextId;
    if (typeof contextId !== 'number') throw new Error('Could not create an Inspector evaluation context');
    const response = await send('Runtime.evaluate', { contextId, expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error('Inspector Webview evaluation raised an exception');
    const value = (response.result as { value?: unknown } | undefined)?.value;
    return value as T;
  });
}

export async function activateInspectorControlWithKeyboard(
  control: 'candidate' | 'bars' | 'operation' | 'play' | 'stop' | 'section' | 'action',
  key: string,
  waitForAudioState = true,
  activate = true
): Promise<boolean> {
  if (process.env.GUITARDSL_E2E_CAPTURE_SCREENSHOTS !== '1') return false;
  const port = Number(process.env.GUITARDSL_E2E_CDP_PORT);
  const targets = await getTargets(port);
  const target = targets.find(item => item.type === 'iframe' && item.url.includes('purpose=webviewView') && item.url.includes('extensionId=puchinya.vscode-guitar-dsl'));
  if (!target) throw new Error('Could not find the GuitarDSL Inspector webview target');
  return withDevToolsTarget(target, async send => {
    const result = await send('Page.getFrameTree');
    let activeFrameId: string | undefined;
    const visit = (node: Record<string, unknown>): void => {
      const frame = node.frame as { id?: string; name?: string; url?: string } | undefined;
      if (frame?.name === 'active-frame') activeFrameId = frame.id;
      if (Array.isArray(node.childFrames)) node.childFrames.forEach(child => visit(child as Record<string, unknown>));
    };
    if (result.frameTree) visit(result.frameTree as Record<string, unknown>);
    if (!activeFrameId) throw new Error('Could not find the active Inspector webview frame');
    const isolatedWorld = await send('Page.createIsolatedWorld', { frameId: activeFrameId, worldName: 'guitardsl-e2e-keyboard-check' });
    const executionContextId = isolatedWorld.executionContextId;
    if (typeof executionContextId !== 'number') throw new Error('Could not create an Inspector frame execution context');
    const readFocusedButton = async (): Promise<{ control?: string; key?: string; pressed?: string; selected?: string; tag?: string } | undefined> => {
      const focused = await send('Runtime.evaluate', {
        contextId: executionContextId,
        expression: "JSON.stringify({tag:document.activeElement?.tagName,control:document.activeElement?.dataset?.inspectorControl,key:document.activeElement?.dataset?.inspectorKey,pressed:document.activeElement?.getAttribute('aria-pressed'),selected:document.activeElement?.getAttribute('aria-selected')})",
        returnByValue: true
      });
      const value = (focused.result as { value?: unknown } | undefined)?.value;
      if (typeof value !== 'string') return undefined;
      return JSON.parse(value) as { control?: string; key?: string; pressed?: string; selected?: string; tag?: string };
    };
    const readAudioState = async (): Promise<string | undefined> => {
      const result = await send('Runtime.evaluate', {
        contextId: executionContextId,
        expression: 'document.getElementById("inspector-state")?.dataset.audioState',
        returnByValue: true
      });
      const value = (result.result as { value?: unknown } | undefined)?.value;
      return typeof value === 'string' ? value : undefined;
    };
    const readAudioStatus = async (): Promise<string> => {
      const result = await send('Runtime.evaluate', {
        contextId: executionContextId,
        expression: 'JSON.stringify({state:document.getElementById("inspector-state")?.dataset.audioState,status:document.getElementById("progression-audio-status")?.textContent})',
        returnByValue: true
      });
      const value = (result.result as { value?: unknown } | undefined)?.value;
      return typeof value === 'string' ? value : '<unavailable>';
    };
    const hasFocusedAccessibilityControl = async (expectedRole: 'button' | 'tab'): Promise<boolean> => {
      await send('DOM.enable');
      await send('Accessibility.enable');
      const activeElement = await send('Runtime.evaluate', {
        contextId: executionContextId,
        expression: 'document.activeElement',
        returnByValue: false
      });
      const objectId = (activeElement.result as { objectId?: unknown } | undefined)?.objectId;
      if (typeof objectId !== 'string') return false;
      const described = await send('DOM.describeNode', { objectId });
      const backendNodeId = (described.node as { backendNodeId?: unknown } | undefined)?.backendNodeId;
      if (typeof backendNodeId !== 'number') return false;
      const tree = await send('Accessibility.getPartialAXTree', { backendNodeId, fetchRelatives: false });
      const nodes = Array.isArray(tree.nodes) ? tree.nodes as Array<Record<string, unknown>> : [];
      const focused = nodes.find(node => Array.isArray(node.properties)
        && (node.properties as Array<Record<string, unknown>>).some(property => {
          const value = property.value as { value?: unknown } | undefined;
          return property.name === 'focused' && value?.value === true;
        }));
      const role = focused?.role as { value?: unknown } | undefined;
      const name = focused?.name as { value?: unknown } | undefined;
      return role?.value === expectedRole && typeof name?.value === 'string' && name.value.length > 0;
    };
    const dispatchTab = async (): Promise<void> => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    };
    for (let tab = 0; tab < 40; tab++) {
      await dispatchTab();
      const focused = await readFocusedButton();
      if (focused?.tag === 'BUTTON' && focused.control === control && focused.key === key) {
        if (!activate) return hasFocusedAccessibilityControl(control === 'section' ? 'tab' : 'button');
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
        if (control === 'action' && key === 'close') return true;
        if (control === 'play' || control === 'stop') {
          if (!waitForAudioState) return true;
          const expectedState = control === 'play' ? 'playing' : 'idle';
          for (let attempt = 0; attempt < 40; attempt++) {
            if (await readAudioState() === expectedState) return true;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error(`Inspector ${control} did not reach audio state ${expectedState}: ${await readAudioStatus()}`);
        }
        for (let attempt = 0; attempt < 20; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 25));
          const updated = await readFocusedButton();
          const activated = control === 'section' ? updated?.selected === 'true' : updated?.pressed === 'true';
          if (updated?.tag === 'BUTTON' && updated.control === control && updated.key === key && activated
            && await hasFocusedAccessibilityControl(control === 'section' ? 'tab' : 'button')) return true;
        }
        return false;
      }
    }
    return false;
  });
}

type SendDevToolsCommand = (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;

async function withWorkbenchDevTools<T>(run: (send: SendDevToolsCommand) => Promise<T>): Promise<T> {
  const port = Number(process.env.GUITARDSL_E2E_CDP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('GUITARDSL_E2E_CDP_PORT was not provided by the test runner');
  }
  const target = await waitForWorkbenchTarget(port);
  return withDevToolsTarget(target, run);
}

async function withDevToolsTarget<T>(target: DevToolsTarget, run: (send: SendDevToolsCommand) => Promise<T>): Promise<T> {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error(`Could not connect to DevTools target: ${target.title}`)), { once: true });
  });

  let nextId = 0;
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  socket.addEventListener('message', event => {
    let message: DevToolsResponse;
    try {
      message = JSON.parse(String(event.data)) as DevToolsResponse;
    } catch {
      return;
    }
    if (message.id === undefined) return;
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message ?? 'DevTools command failed'));
    else handler.resolve(message.result ?? {});
  });

  const send: SendDevToolsCommand = (method, params = {}) => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject: error => reject(new Error(`${method}: ${error.message}`)) });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };

  try {
    return await run(send);
  } finally {
    socket.close();
  }
}
