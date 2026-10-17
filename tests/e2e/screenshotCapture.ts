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

async function waitForPreviewTarget(port: number): Promise<DevToolsTarget> {
  let lastTargets: DevToolsTarget[] = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    lastTargets = await getTargets(port);
    // Recent VS Code releases expose opaque vscode-webview:// URLs for the
    // Preview, while Inspector views retain purpose=webviewView metadata.
    const previewTargets = lastTargets.filter(item => item.type === 'iframe'
      && item.url.startsWith('vscode-webview://')
      && !(item.url.includes('purpose=webviewView')
        && item.url.includes('extensionId=puchinya.vscode-guitar-dsl')));
    if (previewTargets.length === 1) return previewTargets[0];
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const available = lastTargets.map(item => `${item.type}:${item.url.slice(0, 180)}`).join(' | ');
  throw new Error(`Expected one GuitarDSL Preview webview target; available targets: ${available || '(none)'}`);
}

/** Captures the selected VS Code workbench page through its local DevTools target. */
export async function captureWorkbenchScreenshot(filename: string, issueNumber = 134, viewportWidth?: number): Promise<void> {
  if (process.env.GUITARDSL_E2E_CAPTURE_SCREENSHOTS !== '1') return;
  const outputPath = path.resolve(__dirname, `../../../docs/status/evidence/issue-${issueNumber}`, filename);
  await withWorkbenchDevTools(async send => {
    const width = viewportWidth ?? Number(process.env.GUITARDSL_E2E_VIEWPORT_WIDTH ?? 800);
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

/** Captures only the active Preview Webview at its real CSS viewport size. */
export async function capturePreviewWebviewScreenshot(filename: string, issueNumber = 145): Promise<void> {
  if (process.env.GUITARDSL_E2E_CAPTURE_SCREENSHOTS !== '1') return;
  const port = Number(process.env.GUITARDSL_E2E_CDP_PORT);
  await waitForPreviewTarget(port);
  const outputPath = path.resolve(__dirname, `../../../docs/status/evidence/issue-${issueNumber}`, filename);
  await withWorkbenchDevTools(async send => {
    const boundsResult = await send('Runtime.evaluate', {
      expression: `JSON.stringify([...document.querySelectorAll('iframe')].map(frame => {
        const rect = frame.getBoundingClientRect();
        return { src: frame.getAttribute('src') || '', width: rect.width, height: rect.height,
          x: rect.x, y: rect.y, visible: rect.width > 0 && rect.height > 0 };
      }).filter(frame => frame.visible && frame.src.startsWith('vscode-webview://')))` ,
      returnByValue: true
    });
    const boundsValue = (boundsResult.result as { value?: unknown } | undefined)?.value;
    if (typeof boundsValue !== 'string') throw new Error('Could not locate the visible Preview Webview in the workbench');
    const visibleFrames = JSON.parse(boundsValue) as Array<{ x: number; y: number; width: number; height: number }>;
    if (visibleFrames.length !== 1) {
      throw new Error(`Expected one visible Preview iframe for capture, found ${visibleFrames.length}`);
    }
    const frame = visibleFrames[0];
    await send('Page.enable');
    const result = await send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: frame.x, y: frame.y, width: frame.width, height: frame.height, scale: 1 }
    });
    const data = result.data;
    if (typeof data !== 'string') throw new Error('DevTools did not return a Preview screenshot');
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

/** Evaluates an expression in the singleton Preview WebviewPanel renderer. */
export async function evaluatePreviewWebview<T>(expression: string): Promise<T> {
  const port = Number(process.env.GUITARDSL_E2E_CDP_PORT);
  for (let evaluationAttempt = 0; evaluationAttempt < 3; evaluationAttempt++) {
    const target = await waitForPreviewTarget(port);
    try {
      return await withDevToolsTarget(target, async send => {
        await send('Runtime.enable');
        let contextId: number | undefined;
        let lastFrames: string[] = [];
        for (let attempt = 0; attempt < 6 && contextId === undefined; attempt++) {
          const tree = await send('Page.getFrameTree');
          let activeFrameId: string | undefined;
          lastFrames = [];
          const visit = (node: Record<string, unknown>): void => {
            const frame = node.frame as { id?: string; name?: string; url?: string } | undefined;
            if (frame) lastFrames.push(`${frame.name ?? '(unnamed)'}:${frame.url ?? '(no url)'}`);
            if (frame?.name === 'active-frame') activeFrameId = frame.id;
            if (Array.isArray(node.childFrames)) node.childFrames.forEach(child => visit(child as Record<string, unknown>));
          };
          if (tree.frameTree) {
            const frameTree = tree.frameTree as Record<string, unknown>;
            visit(frameTree);
            if (!activeFrameId) {
              const rootFrame = frameTree.frame as { id?: string; url?: string } | undefined;
              if (rootFrame?.url?.startsWith('vscode-webview://')) activeFrameId = rootFrame.id;
            }
          }
          if (!activeFrameId) throw new Error(`Could not find the active Preview webview frame: ${lastFrames.join(' | ')}`);
          try {
            const isolated = await send('Page.createIsolatedWorld', { frameId: activeFrameId, worldName: 'guitardsl-preview-evaluation' });
            if (typeof isolated.executionContextId !== 'number') throw new Error('Could not create a Preview evaluation context');
            contextId = isolated.executionContextId;
          } catch (error) {
            if (!(error instanceof Error) || !/No frame for given id found/.test(error.message) || attempt === 5) throw error;
            await new Promise(resolve => setTimeout(resolve, 40));
          }
        }
        if (contextId === undefined) throw new Error(`Could not create a Preview evaluation context for ${lastFrames.join(' | ')}`);
        const response = await send('Runtime.evaluate', { contextId, expression, returnByValue: true, awaitPromise: true });
        if (response.exceptionDetails) throw new Error('Preview Webview evaluation raised an exception');
        const value = (response.result as { value?: unknown } | undefined)?.value;
        return value as T;
      });
    } catch (error) {
      if (!(error instanceof Error) || !/Cannot find context with specified id/.test(error.message) || evaluationAttempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }
  throw new Error('Preview Webview evaluation context remained unavailable');
}

export async function waitForPreviewDocument(): Promise<void> {
  let lastState: unknown;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      lastState = await evaluatePreviewWebview<unknown>(`JSON.stringify({ ready: document.readyState !== 'loading'
        && !!document.querySelector('.toolbar-container') && document.body?.dataset.previewInteractionsReady === 'true', url: location.href,
        name: window.name, body: document.body?.innerHTML.slice(0, 600), iframes: [...document.querySelectorAll('iframe')].map(frame => ({ name: frame.name, src: frame.src })) })`);
      if (JSON.parse(lastState as string).ready) return;
    } catch (error) {
      // The webview target can exist before its document and active frame finish loading.
      lastState = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`The GuitarDSL Preview webview did not render its toolbar: ${JSON.stringify(lastState)}`);
}

export async function waitForPreviewIdentity(identity: {
  documentUri: string;
  documentVersion: number;
  previewGeneration: number;
}): Promise<void> {
  let lastState = 'unavailable';
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const state = await evaluatePreviewWebview<string>(`JSON.stringify({
        documentUri: document.body?.dataset.previewDocumentUri,
        documentVersion: Number(document.body?.dataset.previewDocumentVersion),
        previewGeneration: Number(document.body?.dataset.previewGeneration)
      })`);
      lastState = state;
      const actual = JSON.parse(state) as typeof identity;
      if (actual.documentUri === identity.documentUri
        && actual.documentVersion === identity.documentVersion
        && actual.previewGeneration === identity.previewGeneration) return;
    } catch (error) {
      lastState = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Preview did not load the expected document identity ${JSON.stringify(identity)}; current=${lastState}`);
}

export async function dispatchPreviewKeyboardKey(key: 'Tab' | 'Escape' | 'Enter' | 'ArrowDown'): Promise<void> {
  const port = Number(process.env.GUITARDSL_E2E_CDP_PORT);
  const target = await waitForPreviewTarget(port);
  const code = key === 'Tab' ? 9 : key === 'Escape' ? 27 : key === 'ArrowDown' ? 40 : 13;
  await withDevToolsTarget(target, async send => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  });
}

/** Opens a native Preview control using a real DevTools mouse input event. */
export async function clickPreviewElement(selector: string): Promise<void> {
  const geometry = JSON.parse(await evaluatePreviewWebview<string>(`JSON.stringify((() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Preview element not found: ' + ${JSON.stringify(selector)});
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })())`)) as { x: number; y: number };
  const target = await waitForPreviewTarget(Number(process.env.GUITARDSL_E2E_CDP_PORT));
  await withDevToolsTarget(target, async send => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: geometry.x, y: geometry.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: geometry.x, y: geometry.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: geometry.x, y: geometry.y, button: 'left', clickCount: 1 });
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

let workbenchWindowSizeForRestore: { width: number; height: number } | undefined;

async function withWorkbenchDevTools<T>(run: (send: SendDevToolsCommand) => Promise<T>): Promise<T> {
  const port = Number(process.env.GUITARDSL_E2E_CDP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('GUITARDSL_E2E_CDP_PORT was not provided by the test runner');
  }
  const target = await waitForWorkbenchTarget(port);
  return withDevToolsTarget(target, run);
}

/** Resizes the Extension Development Host viewport before editor sash tests. */
export async function setWorkbenchViewportWidth(width: number): Promise<void> {
  if (!Number.isFinite(width) || width < 800) throw new Error(`Invalid workbench viewport width: ${width}`);
  await withWorkbenchDevTools(async send => {
    const sizeResult = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({ width: window.outerWidth, height: window.outerHeight })',
      returnByValue: true
    });
    const sizeValue = (sizeResult.result as { value?: unknown } | undefined)?.value;
    if (typeof sizeValue !== 'string') throw new Error('Could not read the Extension Development Host window size');
    const currentSize = JSON.parse(sizeValue) as { width: number; height: number };
    workbenchWindowSizeForRestore ??= currentSize;
    await send('Runtime.evaluate', {
      expression: `window.resizeTo(${Math.round(width)}, Math.max(900, window.outerHeight))`,
      returnByValue: true
    });
    await new Promise(resolve => setTimeout(resolve, 200));
  });
}

/** Clears the optional emulated viewport after a width-matrix test. */
export async function resetWorkbenchViewport(): Promise<void> {
  await withWorkbenchDevTools(async send => {
    if (!workbenchWindowSizeForRestore) return;
    await send('Runtime.evaluate', {
      expression: `window.resizeTo(${workbenchWindowSizeForRestore.width}, ${workbenchWindowSizeForRestore.height})`,
      returnByValue: true
    });
    workbenchWindowSizeForRestore = undefined;
  });
}

export async function inspectWorkbenchLayout(): Promise<string> {
  return withWorkbenchDevTools(async send => {
    const response = await send('Runtime.evaluate', {
      expression: `JSON.stringify({ viewport: { width: innerWidth, height: innerHeight },
        editor: [...document.querySelectorAll('.part.editor')].map(node => { const r=node.getBoundingClientRect(); return { width: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right) }; }),
        parts: Object.fromEntries(['sidebar', 'auxiliarybar'].map(name => { const node=document.querySelector('.part.'+name); if(!node) return [name, { visible:false, width:0 }]; const r=node.getBoundingClientRect(); const style=getComputedStyle(node); return [name, { visible:style.display!=='none' && style.visibility!=='hidden' && r.width>0 && r.height>0, width:Math.round(r.width) }]; })),
        groups: [...document.querySelectorAll('.editor-group-container')].map(node => { const r=node.getBoundingClientRect(); return { width: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right), classes: node.className }; }),
        sashes: [...document.querySelectorAll('.monaco-sash')].map(node => { const r=node.getBoundingClientRect(); return { width: Math.round(r.width), left: Math.round(r.left), top: Math.round(r.top), classes: node.className }; }) })`,
      returnByValue: true
    });
    const value = (response.result as { value?: unknown } | undefined)?.value;
    if (typeof value !== 'string') throw new Error('Could not inspect the Extension Development Host layout');
    return value;
  });
}

/** Resizes the active editor group through its real VS Code sash, in CSS pixels. */
export async function resizeActiveEditorGroupToWidth(targetWidth: number): Promise<void> {
  if (!Number.isFinite(targetWidth) || targetWidth < 320) throw new Error(`Invalid editor group width: ${targetWidth}`);
  await withWorkbenchDevTools(async send => {
    const response = await send('Runtime.evaluate', {
      expression: `JSON.stringify((() => {
        const active = document.querySelector('.editor-group-container.active');
        if (!active) return { error: 'active editor group not found' };
        const activeRect = active.getBoundingClientRect();
        const activeLeft = activeRect.left;
        const activeRight = activeRect.right;
        const sash = [...document.querySelectorAll('.monaco-sash.vertical:not(.primary-sidebar-sash)')]
          .map(node => ({ node, rect: node.getBoundingClientRect() }))
          .map(item => ({ ...item, leftDistance: Math.abs(item.rect.left - activeLeft), rightDistance: Math.abs(item.rect.left - activeRight) }))
          .filter(item => Math.min(item.leftDistance, item.rightDistance) < 10)
          .sort((a, b) => Math.min(a.leftDistance, a.rightDistance) - Math.min(b.leftDistance, b.rightDistance))[0];
        if (!sash) return { error: 'active group sash not found', width: activeRect.width };
        return { width: activeRect.width, x: sash.rect.left + sash.rect.width / 2,
          y: Math.min(activeRect.bottom - 40, activeRect.top + 160),
          direction: sash.leftDistance < 10 ? -1 : 1 };
      })())`,
      returnByValue: true
    });
    const value = (response.result as { value?: unknown } | undefined)?.value;
    if (typeof value !== 'string') throw new Error('Could not measure the active editor group');
    const geometry = JSON.parse(value) as { error?: string; width?: number; x?: number; y?: number; direction?: number };
    if (geometry.error || geometry.width === undefined || geometry.x === undefined || geometry.y === undefined || geometry.direction === undefined) {
      throw new Error(`Could not resize the active editor group: ${JSON.stringify(geometry)}`);
    }
    const delta = targetWidth - geometry.width;
    if (Math.abs(delta) < 1) return;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / 40));
    const targetX = geometry.x + geometry.direction * delta;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: geometry.x, y: geometry.y, button: 'left', clickCount: 1 });
    for (let step = 1; step <= steps; step++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: geometry.x + (targetX - geometry.x) * step / steps,
        y: geometry.y,
        button: 'left',
        buttons: 1
      });
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetX, y: geometry.y, button: 'left', clickCount: 1 });
  });
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
