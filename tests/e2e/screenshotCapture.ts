import * as fs from 'fs/promises';
import * as http from 'http';
import * as path from 'path';

interface DevToolsTarget {
  readonly id?: string;
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
      && item.url.includes('extensionId=puchinya.vscode-guitar-dsl')
      && !item.url.includes('purpose=webviewView'));
    for (const candidate of previewTargets) {
      try {
        const containsPreviewDom = await withDevToolsTarget(candidate, async send => {
          await send('Runtime.enable');
          const tree = await send('Page.getFrameTree');
          const frameTree = tree.frameTree as Record<string, unknown> | undefined;
          let frameId: string | undefined;
          const visit = (node: Record<string, unknown>): void => {
            const frame = node.frame as { id?: string; name?: string } | undefined;
            if (frame?.name === 'active-frame') frameId = frame.id;
            if (Array.isArray(node.childFrames)) node.childFrames.forEach(child => visit(child as Record<string, unknown>));
          };
          if (frameTree) {
            visit(frameTree);
            if (!frameId) {
              const root = frameTree.frame as { id?: string; url?: string } | undefined;
              if (root?.url?.startsWith('vscode-webview://')) frameId = root.id;
            }
          }
          if (!frameId) return false;
          const isolated = await send('Page.createIsolatedWorld', { frameId, worldName: 'guitardsl-preview-target-check' });
          if (typeof isolated.executionContextId !== 'number') return false;
          const result = await send('Runtime.evaluate', {
            contextId: isolated.executionContextId,
            expression: `!!document.querySelector('.toolbar-container') && !!document.getElementById('preview-edit-row')`,
            returnByValue: true
          });
          return (result.result as { value?: unknown } | undefined)?.value === true;
        });
        if (containsPreviewDom) return candidate;
      } catch {
        // A webview may be shutting down while a different Preview target is opening.
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const available = lastTargets.map(item => `${item.type}:${item.url.slice(0, 180)}`).join(' | ');
  throw new Error(`Expected one GuitarDSL Preview webview target; available targets: ${available || '(none)'}`);
}

async function waitForTranscriptionTarget(port: number): Promise<DevToolsTarget> {
  let lastTargets: DevToolsTarget[] = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    lastTargets = await getTargets(port);
    const candidates = lastTargets.filter(item => item.type === 'iframe'
      && item.url.startsWith('vscode-webview://')
      && item.url.includes('extensionId=puchinya.vscode-guitar-dsl')
      && !item.url.includes('purpose=webviewView'));
    const transcriptionTargets: DevToolsTarget[] = [];
    for (const candidate of candidates) {
      try {
        const containsTranscriptionDom = await withDevToolsTarget(candidate, async send => {
          await send('Runtime.enable');
          const tree = await send('Page.getFrameTree');
          const frameTree = tree.frameTree as Record<string, unknown> | undefined;
          let frameId: string | undefined;
          const visit = (node: Record<string, unknown>): void => {
            const frame = node.frame as { id?: string; name?: string; url?: string } | undefined;
            if (frame?.name === 'active-frame') frameId = frame.id;
            if (Array.isArray(node.childFrames)) node.childFrames.forEach(child => visit(child as Record<string, unknown>));
          };
          if (frameTree) {
            visit(frameTree);
            if (!frameId) {
              const root = frameTree.frame as { id?: string; url?: string } | undefined;
              if (root?.url?.startsWith('vscode-webview://')) frameId = root.id;
            }
          }
          if (!frameId) return false;
          const isolated = await send('Page.createIsolatedWorld', { frameId, worldName: 'guitardsl-transcription-target-check' });
          if (typeof isolated.executionContextId !== 'number') return false;
          const result = await send('Runtime.evaluate', {
            contextId: isolated.executionContextId,
            expression: `!!document.querySelector('#keyManagement summary')`,
            returnByValue: true
          });
          return (result.result as { value?: unknown } | undefined)?.value === true;
        });
        if (containsTranscriptionDom) transcriptionTargets.push(candidate);
      } catch {
        // A stale or not-yet-loaded panel target can disappear during workspace restoration.
      }
    }
    if (transcriptionTargets.length === 1) return transcriptionTargets[0];
    if (transcriptionTargets.length > 1) {
      throw new Error(`Expected one GuitarDSL transcription webview target, found ${transcriptionTargets.length}: ${transcriptionTargets.map(item => item.title).join(', ')}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const available = lastTargets.map(item => `${item.type}:${item.url.slice(0, 180)}`).join(' | ');
  throw new Error(`Could not find the GuitarDSL transcription webview target: ${available || '(none)'}`);
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
let previewViewportWasOverridden = false;
let previewWorkbenchMetricsWereOverridden = false;

export async function capturePreviewWebviewScreenshot(
  filename: string,
  issueNumber = 145,
  previewViewportWidth?: number,
  outputScale: 1 | 2 = 1
): Promise<void> {
  if (process.env.GUITARDSL_E2E_CAPTURE_SCREENSHOTS !== '1') return;
  if (outputScale !== 1 && outputScale !== 2) throw new Error(`Invalid Preview screenshot output scale: ${outputScale}`);
  const port = Number(process.env.GUITARDSL_E2E_CDP_PORT);
  const outputPath = path.resolve(__dirname, `../../../docs/status/evidence/issue-${issueNumber}`, filename);
  if (previewViewportWidth !== undefined) await setPreviewWebviewViewportWidth(previewViewportWidth);
  const target = await waitForPreviewTarget(port);
  const viewport = await withDevToolsTarget(target, async send => {
    await send('Page.enable');
    const viewportResult = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({ width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio })',
      returnByValue: true
    });
    const viewportValue = (viewportResult.result as { value?: unknown } | undefined)?.value;
    if (typeof viewportValue !== 'string') throw new Error('Could not read the Preview Webview viewport');
    const viewport = JSON.parse(viewportValue) as { width?: unknown; height?: unknown; devicePixelRatio?: unknown };
    if (typeof viewport.width !== 'number' || typeof viewport.height !== 'number'
      || typeof viewport.devicePixelRatio !== 'number'
      || viewport.width < 1 || viewport.height < 1 || viewport.devicePixelRatio <= 0) {
      throw new Error('The Preview Webview returned invalid screenshot dimensions');
    }
    if (previewViewportWidth !== undefined && Math.abs(viewport.width - previewViewportWidth) > 1) {
      throw new Error(`The Preview Webview screenshot viewport is ${viewport.width}px; expected ${previewViewportWidth}px`);
    }
    return {
      width: viewport.width,
      height: viewport.height,
      screenshotScale: outputScale / viewport.devicePixelRatio
    };
  });

  const inspectVisiblePreviewFrame = async (): Promise<{
    workbenchWidth: number;
    workbenchHeight: number;
    workbenchOuterWidth: number;
    frames: Array<{ x: number; y: number; width: number; height: number }>;
  }> => withWorkbenchDevTools(async send => {
    const result = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        workbenchWidth: window.innerWidth,
        workbenchHeight: window.innerHeight,
        workbenchOuterWidth: window.outerWidth,
        frames: [...document.querySelectorAll('iframe')].map(frame => {
          const rect = frame.getBoundingClientRect();
          return { src: frame.getAttribute('src') || '', width: rect.width, height: rect.height,
            x: rect.x, y: rect.y, visible: rect.width > 0 && rect.height > 0 };
        }).filter(frame => frame.visible && frame.src.startsWith('vscode-webview://'))
      })`,
      returnByValue: true
    });
    const value = (result.result as { value?: unknown } | undefined)?.value;
    if (typeof value !== 'string') throw new Error('Could not locate the visible Preview Webview in the workbench');
    return JSON.parse(value) as {
      workbenchWidth: number;
      workbenchHeight: number;
      workbenchOuterWidth: number;
      frames: Array<{ x: number; y: number; width: number; height: number }>;
    };
  });

  let workbench = await inspectVisiblePreviewFrame();
  if (workbench.frames.length !== 1) {
    throw new Error(`Expected one visible Preview iframe for capture, found ${workbench.frames.length}`);
  }
  let frame = workbench.frames[0];
  if (Math.abs(frame.width - viewport.width) > 1) {
    throw new Error(`The Preview iframe is ${frame.width}px wide; expected its ${viewport.width}px viewport`);
  }
  if (frame.x < -1 || frame.x + frame.width > workbench.workbenchWidth + 1) {
    await setWorkbenchViewportWidth(Math.ceil(Math.max(workbench.workbenchOuterWidth, frame.x + frame.width + 56)));
    workbench = await inspectVisiblePreviewFrame();
    if (workbench.frames.length !== 1) {
      throw new Error(`Expected one visible Preview iframe after resizing the workbench, found ${workbench.frames.length}`);
    }
    frame = workbench.frames[0];
  }
  if (frame.x < -1 || frame.y < -1 || frame.x + frame.width > workbench.workbenchWidth + 1
    || frame.y + frame.height > workbench.workbenchHeight + 1
    || frame.height + 1 < viewport.height) {
    throw new Error(`The Preview iframe is clipped by the workbench (${frame.width}x${frame.height} at ${frame.x},${frame.y}; workbench ${workbench.workbenchWidth}x${workbench.workbenchHeight}; Preview ${viewport.width}x${viewport.height})`);
  }

  await withWorkbenchDevTools(async send => {
    await send('Page.enable');
    const result = await send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: frame.x, y: frame.y, width: viewport.width, height: viewport.height, scale: viewport.screenshotScale }
    });
    const data = result.data;
    if (typeof data !== 'string') throw new Error('DevTools did not return a Preview screenshot');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const image = Buffer.from(data, 'base64');
    const screenshotWidth = image.readUInt32BE(16);
    const screenshotHeight = image.readUInt32BE(20);
    const expectedWidth = Math.round(viewport.width * outputScale);
    const expectedHeight = Math.round(viewport.height * outputScale);
    if (screenshotWidth !== expectedWidth || screenshotHeight !== expectedHeight) {
      throw new Error(`The Preview screenshot is clipped to ${screenshotWidth}x${screenshotHeight}px; expected ${expectedWidth}x${expectedHeight}px`);
    }
    await fs.writeFile(outputPath, image);
  });
}

/** Emulates an exact CSS viewport inside the Preview Webview even when the host display is narrower. */
export async function setPreviewWebviewViewportWidth(width: number, height?: number): Promise<void> {
  if (!Number.isFinite(width) || width < 280) throw new Error(`Invalid Preview Webview viewport width: ${width}`);
  if (height !== undefined && (!Number.isFinite(height) || height < 240)) {
    throw new Error(`Invalid Preview Webview viewport height: ${height}`);
  }
  const previewTarget = await waitForPreviewTarget(Number(process.env.GUITARDSL_E2E_CDP_PORT));
  const previewTargetId = new URL(previewTarget.url).searchParams.get('id');
  if (!previewTargetId) throw new Error('The GuitarDSL Preview target has no Webview id');
  let targetHeight = height === undefined ? 0 : Math.round(height);
  let deviceScaleFactor = 1;
  await withWorkbenchDevTools(async send => {
    const result = await send('Runtime.evaluate', {
      expression: `JSON.stringify((() => {
        const previewTargetId = ${JSON.stringify(previewTargetId)};
        const frame = [...document.querySelectorAll('iframe')].find(item => {
          const rect = item.getBoundingClientRect();
          const src = item.getAttribute('src') || '';
          if (rect.width <= 0 || rect.height <= 0 || !src.startsWith('vscode-webview://')) return false;
          try { return new URL(src, location.href).searchParams.get('id') === previewTargetId; }
          catch { return false; }
        });
        if (!frame) return { error: 'Preview Webview frame not found' };
        if (!window.__guitardslPreviewViewportState) {
          window.__guitardslPreviewViewportState = {
            frame,
            previewTargetId,
            width: frame.style.width,
            minWidth: frame.style.minWidth,
            maxWidth: frame.style.maxWidth,
            flex: frame.style.flex,
            height: frame.style.height,
            minHeight: frame.style.minHeight,
            maxHeight: frame.style.maxHeight
          };
        }
        frame.style.width = '${Math.round(width)}px';
        frame.style.minWidth = '${Math.round(width)}px';
        frame.style.maxWidth = 'none';
        frame.style.flex = '0 0 ${Math.round(width)}px';
        ${height === undefined ? '' : `frame.style.height = '${Math.round(height)}px';
        frame.style.minHeight = '${Math.round(height)}px';
        frame.style.maxHeight = 'none';`}
        const rect = frame.getBoundingClientRect();
        return { width: rect.width, height: rect.height, parentWidth: frame.parentElement?.getBoundingClientRect().width };
      })())`,
      returnByValue: true
    });
    const value = (result.result as { value?: unknown } | undefined)?.value;
    if (typeof value !== 'string') throw new Error('Could not resize the Preview Webview frame');
    const dimensions = JSON.parse(value) as { error?: string; width?: number; height?: number };
    if (dimensions.error) throw new Error(dimensions.error);
    if (Math.abs((dimensions.width ?? 0) - width) > 1) {
      throw new Error(`The Preview Webview frame could not reach ${width}px (actual=${dimensions.width})`);
    }
    if (height !== undefined && Math.abs((dimensions.height ?? 0) - height) > 1) {
      throw new Error(`The Preview Webview frame could not reach ${height}px tall (actual=${dimensions.height})`);
    }
    previewViewportWasOverridden = true;
  });
  await withWorkbenchDevTools(async send => {
    const before = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({ width: window.innerWidth, height: window.innerHeight, deviceScaleFactor: window.devicePixelRatio })',
      returnByValue: true
    });
    const beforeValue = (before.result as { value?: unknown } | undefined)?.value;
    if (typeof beforeValue !== 'string') throw new Error('Could not read the workbench viewport before Preview emulation');
    const viewport = JSON.parse(beforeValue) as { width?: unknown; height?: unknown; deviceScaleFactor?: unknown };
    if (typeof viewport.height !== 'number' || typeof viewport.deviceScaleFactor !== 'number') {
      throw new Error('The workbench returned invalid viewport metrics before Preview emulation');
    }
    targetHeight = height === undefined ? Math.round(viewport.height) : Math.round(height);
    deviceScaleFactor = viewport.deviceScaleFactor as number;
    await send('Emulation.setDeviceMetricsOverride', {
      width: Math.round(width),
      height: targetHeight,
      deviceScaleFactor,
      mobile: false,
      screenWidth: Math.round(width),
      screenHeight: targetHeight
    });
    previewWorkbenchMetricsWereOverridden = true;
  });
  await withDevToolsTarget(previewTarget, async send => {
    const after = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({ width: window.innerWidth, height: window.innerHeight })',
      returnByValue: true
    });
    const afterValue = (after.result as { value?: unknown } | undefined)?.value;
    if (typeof afterValue !== 'string') throw new Error('Could not verify the Preview Webview viewport emulation');
    const measured = JSON.parse(afterValue) as { width?: unknown; height?: unknown };
    if (Math.abs(Number(measured.width) - width) > 1 || (height !== undefined && Math.abs(Number(measured.height) - height) > 1)) {
      throw new Error(`Preview viewport emulation did not apply (actual=${measured.width}x${measured.height}, expected=${width}x${height ?? 'current'})`);
    }
  });
  await new Promise(resolve => setTimeout(resolve, 200));
}

/** Clears the Preview Webview viewport override after exact-width acceptance. */
export async function resetPreviewWebviewViewport(): Promise<void> {
  if (!previewViewportWasOverridden && !previewWorkbenchMetricsWereOverridden) return;
  if (previewWorkbenchMetricsWereOverridden) {
    await withWorkbenchDevTools(async send => {
      await send('Emulation.clearDeviceMetricsOverride');
    });
    previewWorkbenchMetricsWereOverridden = false;
  }
  if (!previewViewportWasOverridden) return;
  await withWorkbenchDevTools(async send => {
    await send('Runtime.evaluate', {
      expression: `(() => {
        const state = window.__guitardslPreviewViewportState;
        if (!state) return;
        const frame = state.frame?.isConnected ? state.frame : [...document.querySelectorAll('iframe')].find(item => {
          const src = item.getAttribute('src') || '';
          if (!src.startsWith('vscode-webview://')) return false;
          try { return new URL(src, location.href).searchParams.get('id') === state.previewTargetId; }
          catch { return false; }
        });
        if (frame) {
          frame.style.width = state.width;
          frame.style.minWidth = state.minWidth;
          frame.style.maxWidth = state.maxWidth;
          frame.style.flex = state.flex;
          frame.style.height = state.height;
          frame.style.minHeight = state.minHeight;
          frame.style.maxHeight = state.maxHeight;
        }
        delete window.__guitardslPreviewViewportState;
      })()`,
      returnByValue: true
    });
  });
  previewViewportWasOverridden = false;
}

/** Captures the active YouTube transcription Webview at its real CSS viewport size. */
export async function captureTranscriptionWebviewScreenshot(filename: string, issueNumber = 137): Promise<void> {
  if (process.env.GUITARDSL_E2E_CAPTURE_SCREENSHOTS !== '1') return;
  const port = Number(process.env.GUITARDSL_E2E_CDP_PORT);
  await waitForTranscriptionTarget(port);
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
    if (typeof boundsValue !== 'string') throw new Error('Could not locate the visible transcription Webview in the workbench');
    const visibleFrames = JSON.parse(boundsValue) as Array<{ x: number; y: number; width: number; height: number }>;
    if (visibleFrames.length !== 1) {
      throw new Error(`Expected one visible transcription Webview iframe for capture, found ${visibleFrames.length}`);
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
    if (typeof data !== 'string') throw new Error('DevTools did not return a transcription screenshot');
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
  let inspectorTargets: Awaited<ReturnType<typeof getTargets>> = [];
  let lastTargetSummary: string[] = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    const targets = await getTargets(port);
    lastTargetSummary = targets.map(item => `${item.type}:${item.title}:${item.url.slice(0, 180)}`);
    inspectorTargets = targets.filter(item => item.type === 'iframe'
      && item.url.includes('purpose=webviewView')
      && item.url.includes('extensionId=puchinya.vscode-guitar-dsl'));
    if (inspectorTargets.length === 1) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (inspectorTargets.length !== 1) {
    throw new Error(`Expected one GuitarDSL Inspector webview target, found ${inspectorTargets.length}; DevTools targets: ${lastTargetSummary.join(' | ') || '(none)'}`);
  }
  return withDevToolsTarget(inspectorTargets[0], async send => {
    await send('Runtime.enable');
    let activeFrameId: string | undefined;
    let contentFrameId: string | undefined;
    let lastFrames: string[] = [];
    for (let attempt = 0; attempt < 40 && !activeFrameId && !contentFrameId; attempt++) {
      const tree = await send('Page.getFrameTree');
      lastFrames = [];
      const visit = (node: Record<string, unknown>, depth: number): void => {
        const frame = node.frame as { id?: string; name?: string; url?: string } | undefined;
        if (frame) lastFrames.push(`${frame.name ?? '(unnamed)'}:${frame.url ?? '(no url)'}`);
        if (frame?.name === 'active-frame') activeFrameId = frame.id;
        if (depth > 0 && frame?.id && frame.url?.startsWith('vscode-webview://')) contentFrameId = frame.id;
        if (Array.isArray(node.childFrames)) node.childFrames.forEach(child => visit(child as Record<string, unknown>, depth + 1));
      };
      if (tree.frameTree) {
        const frameTree = tree.frameTree as Record<string, unknown>;
        visit(frameTree, 0);
        if (!activeFrameId && !contentFrameId) {
          const rootFrame = frameTree.frame as { id?: string; url?: string } | undefined;
          if (rootFrame?.url?.startsWith('vscode-webview://')) activeFrameId = rootFrame.id;
        }
      }
      if (!activeFrameId) await new Promise(resolve => setTimeout(resolve, 50));
    }
    const inspectorFrameId = activeFrameId ?? contentFrameId;
    if (!inspectorFrameId) throw new Error(`Could not find the active Inspector webview frame: ${lastFrames.join(' | ')}`);
    const isolated = await send('Page.createIsolatedWorld', { frameId: inspectorFrameId, worldName: 'guitardsl-e2e-evaluation' });
    const contextId = isolated.executionContextId;
    if (typeof contextId !== 'number') throw new Error('Could not create an Inspector evaluation context');
    let inspectorDomReady = false;
    for (let attempt = 0; attempt < 40 && !inspectorDomReady; attempt++) {
      const ready = await send('Runtime.evaluate', {
        contextId,
        expression: "document.readyState === 'complete' && !!document.getElementById('inspector-context-tabs')",
        returnByValue: true
      });
      inspectorDomReady = (ready.result as { value?: unknown } | undefined)?.value === true;
      if (!inspectorDomReady) await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!inspectorDomReady) {
      const state = await send('Runtime.evaluate', {
        contextId,
        expression: "JSON.stringify({ readyState: document.readyState, href: location.href, html: document.documentElement?.innerHTML.slice(0, 240) })",
        returnByValue: true
      });
      const description = (state.result as { value?: unknown } | undefined)?.value;
      throw new Error(`Inspector Webview document did not finish rendering its top-level tabs (${String(description)}; ${inspectorTargets[0].url}; frames=${lastFrames.join(' | ')})`);
    }
    const response = await send('Runtime.evaluate', { contextId, expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) {
      const details = response.exceptionDetails as { text?: string; exception?: { description?: string; value?: string } };
      throw new Error(`Inspector Webview evaluation raised an exception (${details.exception?.description ?? details.exception?.value ?? details.text ?? 'unknown'})`);
    }
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
        if (response.exceptionDetails) {
          const details = response.exceptionDetails as { text?: string; exception?: { description?: string; value?: string } };
          throw new Error(`Preview Webview evaluation raised an exception (${details.exception?.description ?? details.exception?.value ?? details.text ?? 'unknown'})`);
        }
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

/** Holds real Preview and workbench CDP sessions while reduced motion is emulated. */
export async function withPreviewReducedMotion<T>(reduced: boolean, run: () => Promise<T>): Promise<T> {
  const port = Number(process.env.GUITARDSL_E2E_CDP_PORT);
  const targets = await Promise.all([waitForWorkbenchTarget(port), waitForPreviewTarget(port)]);
  const apply = (send: SendDevToolsCommand) => send('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }]
  }).then(() => undefined);
  const withTarget = (index: number): Promise<T> => withDevToolsTarget(targets[index], async send => {
    await apply(send);
    try {
      return index + 1 < targets.length ? await withTarget(index + 1) : await run();
    } finally {
      await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    }
  });
  return withTarget(0);
}

/** Evaluates an expression in the singleton YouTube transcription webview. */
export async function evaluateTranscriptionWebview<T>(expression: string): Promise<T> {
  const target = await waitForTranscriptionTarget(Number(process.env.GUITARDSL_E2E_CDP_PORT));
  return withDevToolsTarget(target, async send => {
    await send('Runtime.enable');
    const tree = await send('Page.getFrameTree');
    let activeFrameId: string | undefined;
    const frameSummaries: string[] = [];
    const visit = (node: Record<string, unknown>): void => {
      const frame = node.frame as { id?: string; name?: string; url?: string } | undefined;
      if (frame) frameSummaries.push(`${frame.name ?? '(unnamed)'}:${frame.url ?? '(no url)'}`);
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
    if (!activeFrameId) throw new Error('Could not find the active transcription webview frame');
    const isolated = await send('Page.createIsolatedWorld', { frameId: activeFrameId, worldName: 'guitardsl-transcription-evaluation' });
    const contextId = isolated.executionContextId;
    if (typeof contextId !== 'number') throw new Error('Could not create a transcription webview evaluation context');
    const response = await send('Runtime.evaluate', { contextId, expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) {
      const details = response.exceptionDetails as { text?: string; exception?: { description?: string; value?: string } };
      throw new Error(`Transcription Webview evaluation raised an exception (${details.exception?.description ?? details.exception?.value ?? details.text ?? 'unknown'}): ${target.url}; frames=${frameSummaries.join(' | ')}`);
    }
    const value = (response.result as { value?: unknown } | undefined)?.value;
    return value as T;
  });
}

/** Reads the browser accessibility role and name for a transcription control. */
export async function inspectTranscriptionWebviewAccessibility(selector: string): Promise<{ role: string; name: string; focused: boolean }> {
  const target = await waitForTranscriptionTarget(Number(process.env.GUITARDSL_E2E_CDP_PORT));
  return withDevToolsTarget(target, async send => {
    await send('Runtime.enable');
    const tree = await send('Page.getFrameTree');
    let activeFrameId: string | undefined;
    const visit = (node: Record<string, unknown>): void => {
      const frame = node.frame as { id?: string; name?: string; url?: string } | undefined;
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
    if (!activeFrameId) throw new Error('Could not find the active transcription webview frame');
    const isolated = await send('Page.createIsolatedWorld', { frameId: activeFrameId, worldName: 'guitardsl-transcription-accessibility' });
    if (typeof isolated.executionContextId !== 'number') throw new Error('Could not create a transcription accessibility context');
    const resolved = await send('Runtime.evaluate', {
      contextId: isolated.executionContextId,
      expression: `document.querySelector(${JSON.stringify(selector)})`,
      returnByValue: false
    });
    const objectId = (resolved.result as { objectId?: unknown } | undefined)?.objectId;
    if (typeof objectId !== 'string') throw new Error(`Could not find transcription control ${selector}`);
    await send('DOM.enable');
    await send('Accessibility.enable');
    const described = await send('DOM.describeNode', { objectId });
    const backendNodeId = (described.node as { backendNodeId?: unknown } | undefined)?.backendNodeId;
    if (typeof backendNodeId !== 'number') throw new Error(`Could not describe transcription control ${selector}`);
    const response = await send('Accessibility.getPartialAXTree', { backendNodeId, fetchRelatives: false });
    const nodes = Array.isArray(response.nodes) ? response.nodes as Array<Record<string, unknown>> : [];
    const node = nodes[0];
    if (!node) throw new Error(`No accessibility node exists for transcription control ${selector}`);
    const role = (node.role as { value?: unknown } | undefined)?.value;
    const name = (node.name as { value?: unknown } | undefined)?.value;
    const properties = Array.isArray(node.properties) ? node.properties as Array<Record<string, unknown>> : [];
    const focused = properties.some(property => {
      const value = property.value as { value?: unknown } | undefined;
      return property.name === 'focused' && value?.value === true;
    });
    return { role: typeof role === 'string' ? role : '', name: typeof name === 'string' ? name : '', focused };
  });
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

export async function dispatchPreviewKeyboardKey(key: 'Tab' | 'Escape' | 'Enter' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'Home' | 'End'): Promise<void> {
  const port = Number(process.env.GUITARDSL_E2E_CDP_PORT);
  const target = await waitForPreviewTarget(port);
  const virtualKeyCodes: Record<typeof key, number> = {
    Tab: 9, Escape: 27, Enter: 13, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
    ArrowUp: 38, Home: 36, End: 35
  };
  const code = virtualKeyCodes[key];
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
  if (!Number.isFinite(width) || width < 320) throw new Error(`Invalid workbench viewport width: ${width}`);
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

/** Resizes the Extension Development Host viewport in both dimensions for score-reservation checks. */
export async function setWorkbenchViewportSize(width: number, height: number): Promise<void> {
  if (!Number.isFinite(width) || width < 800) throw new Error(`Invalid workbench viewport width: ${width}`);
  if (!Number.isFinite(height) || height < 500) throw new Error(`Invalid workbench viewport height: ${height}`);
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
      expression: `window.resizeTo(${Math.round(width)}, ${Math.round(height)})`,
      returnByValue: true
    });
    await new Promise(resolve => setTimeout(resolve, 200));
  });
}

/** Clears the optional emulated viewport after a width-matrix test. */
export async function resetWorkbenchViewport(): Promise<void> {
  await withWorkbenchDevTools(async send => {
    if (workbenchWindowSizeForRestore) {
      await send('Runtime.evaluate', {
        expression: `window.resizeTo(${workbenchWindowSizeForRestore.width}, ${workbenchWindowSizeForRestore.height})`,
        returnByValue: true
      });
    }
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

/** Expands a real Extension Development Host Tree View section by its displayed label. */
export async function expandWorkbenchSidebarSection(label: string): Promise<void> {
  await withWorkbenchDevTools(async send => {
    const result = await send('Runtime.evaluate', {
      expression: `JSON.stringify((() => {
        const rows = [...document.querySelectorAll('.part.sidebar .monaco-list-row')];
        const row = rows.find(node => (node.getAttribute('aria-label') || node.textContent || '').toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));
        if (!row) return { error: 'Sidebar section not found: ' + ${JSON.stringify(label)} };
        const twistie = row.querySelector('.monaco-tl-twistie');
        if (!twistie) return { error: 'Sidebar section has no tree expander: ' + ${JSON.stringify(label)} };
        const ariaExpanded = row.getAttribute('aria-expanded');
        const collapsed = ariaExpanded === 'false' || twistie.classList.contains('collapsed');
        if (!collapsed) return { alreadyExpanded: true };
        const rect = twistie.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })())`,
      returnByValue: true
    });
    const value = (result.result as { value?: unknown } | undefined)?.value;
    if (typeof value !== 'string') throw new Error('Could not locate the requested Sidebar section');
    const target = JSON.parse(value) as { error?: string; alreadyExpanded?: boolean; x?: number; y?: number };
    if (target.error) throw new Error(target.error);
    if (target.alreadyExpanded) return;
    if (typeof target.x !== 'number' || typeof target.y !== 'number') throw new Error('Sidebar section has no clickable expander');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  });
}

/** Reads the rendered Workbench Sidebar labels and Codicon classes for visual regression checks. */
export async function inspectWorkbenchSidebarItems(): Promise<{ label: string; iconClass: string }[]> {
  return withWorkbenchDevTools(async send => {
    const result = await send('Runtime.evaluate', {
      expression: `JSON.stringify([...document.querySelectorAll('.part.sidebar .monaco-list-row')].map(row => ({
        label: row.getAttribute('aria-label') || (row.textContent || '').trim(),
        iconClass: row.querySelector('.codicon')?.className || ''
      })))`,
      returnByValue: true
    });
    const value = (result.result as { value?: unknown } | undefined)?.value;
    if (typeof value !== 'string') throw new Error('Could not inspect rendered Sidebar items');
    return JSON.parse(value) as { label: string; iconClass: string }[];
  });
}

type WorkbenchKey = 'ArrowRight' | 'Tab' | 'Enter' | 'Escape' | 'Space';

async function dispatchKey(send: SendDevToolsCommand, key: WorkbenchKey, shift = false): Promise<void> {
  const definitions: Record<WorkbenchKey, { key: string; code: string; virtualKeyCode: number }> = {
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', virtualKeyCode: 39 },
    Tab: { key: 'Tab', code: 'Tab', virtualKeyCode: 9 },
    Enter: { key: 'Enter', code: 'Enter', virtualKeyCode: 13 },
    Escape: { key: 'Escape', code: 'Escape', virtualKeyCode: 27 },
    Space: { key: ' ', code: 'Space', virtualKeyCode: 32 }
  };
  const definition = definitions[key];
  const modifiers = shift ? 8 : 0;
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: definition.key, code: definition.code,
    windowsVirtualKeyCode: definition.virtualKeyCode, nativeVirtualKeyCode: definition.virtualKeyCode, modifiers
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: definition.key, code: definition.code,
    windowsVirtualKeyCode: definition.virtualKeyCode, nativeVirtualKeyCode: definition.virtualKeyCode, modifiers
  });
}

/** Sends a real DevTools keyboard event to the Extension Development Host. */
export async function dispatchWorkbenchKey(key: WorkbenchKey, shift = false): Promise<void> {
  await withWorkbenchDevTools(send => dispatchKey(send, key, shift));
}

/** Sends a real DevTools keyboard event to the transcription Webview renderer. */
export async function dispatchTranscriptionWebviewKey(key: WorkbenchKey, shift = false): Promise<void> {
  const target = await waitForTranscriptionTarget(Number(process.env.GUITARDSL_E2E_CDP_PORT));
  await withDevToolsTarget(target, send => dispatchKey(send, key, shift));
}

/** Resizes the native Primary Sidebar through its real sash. */
export async function resizePrimarySidebarToWidth(targetWidth: number): Promise<number> {
  if (!Number.isFinite(targetWidth) || targetWidth < 200) throw new Error(`Invalid Primary Sidebar width: ${targetWidth}`);
  return withWorkbenchDevTools(async send => {
    const readLayout = async (): Promise<{ width: number; x: number; y: number }> => {
      const result = await send('Runtime.evaluate', {
        expression: `JSON.stringify((() => {
          const sidebar = document.querySelector('.part.sidebar');
          const sash = document.querySelector('.monaco-sash.vertical.primary-sidebar-sash');
          if (!sidebar || !sash) return { error: 'Primary Sidebar or its sash is missing' };
          const sidebarRect = sidebar.getBoundingClientRect();
          const sashRect = sash.getBoundingClientRect();
          return { width: Math.round(sidebarRect.width), x: sashRect.left + sashRect.width / 2,
            y: Math.min(sidebarRect.bottom - 40, sidebarRect.top + 160) };
        })())`,
        returnByValue: true
      });
      const value = (result.result as { value?: unknown } | undefined)?.value;
      if (typeof value !== 'string') throw new Error('Could not inspect the Primary Sidebar sash');
      const layout = JSON.parse(value) as { error?: string; width?: number; x?: number; y?: number };
      if (layout.error || layout.width === undefined || layout.x === undefined || layout.y === undefined) {
        throw new Error(layout.error ?? 'Primary Sidebar layout is incomplete');
      }
      return { width: layout.width, x: layout.x, y: layout.y };
    };
    const initial = await readLayout();
    if (initial.width !== targetWidth) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: initial.x, y: initial.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: initial.x, y: initial.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: targetWidth, y: initial.y, button: 'left', buttons: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetWidth, y: initial.y, button: 'left', clickCount: 1 });
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return (await readLayout()).width;
  });
}

/** Resizes the visible Auxiliary Bar through the vertical sash beside that real workbench part. */
export async function resizeAuxiliarySidebarToWidth(targetWidth: number): Promise<number> {
  if (!Number.isFinite(targetWidth) || targetWidth < 200) throw new Error(`Invalid Auxiliary Bar width: ${targetWidth}`);
  return withWorkbenchDevTools(async send => {
    const readLayout = async (): Promise<{ width: number; x: number; y: number; side: 'left' | 'right' }> => {
      const result = await send('Runtime.evaluate', {
        expression: `JSON.stringify((() => {
          const sidebar = document.querySelector('.part.auxiliarybar');
          if (!sidebar) return { error: 'Auxiliary Bar is missing' };
          const sidebarRect = sidebar.getBoundingClientRect();
          const candidates = [...document.querySelectorAll('.monaco-sash.vertical')].map(sash => {
            const rect = sash.getBoundingClientRect();
            return { rect, centerX: rect.left + rect.width / 2 };
          });
          const adjacent = candidates.find(({ rect }) =>
            Math.abs(rect.right - sidebarRect.left) <= 2 || Math.abs(rect.left - sidebarRect.right) <= 2);
          if (!adjacent) return { error: 'Auxiliary Bar sash is missing', width: sidebarRect.width };
          return {
            width: Math.round(sidebarRect.width),
            x: adjacent.centerX,
            y: Math.min(sidebarRect.bottom - 40, sidebarRect.top + 160),
            side: sidebarRect.left > window.innerWidth / 2 ? 'right' : 'left'
          };
        })())`,
        returnByValue: true
      });
      const value = (result.result as { value?: unknown } | undefined)?.value;
      if (typeof value !== 'string') throw new Error('Could not inspect the Auxiliary Bar sash');
      const layout = JSON.parse(value) as { error?: string; width?: number; x?: number; y?: number; side?: 'left' | 'right' };
      if (layout.error || layout.width === undefined || layout.x === undefined || layout.y === undefined || !layout.side) {
        throw new Error(layout.error ?? 'Auxiliary Bar layout is incomplete');
      }
      return { width: layout.width, x: layout.x, y: layout.y, side: layout.side };
    };
    const initial = await readLayout();
    if (initial.width !== targetWidth) {
      const delta = targetWidth - initial.width;
      const targetX = initial.x + (initial.side === 'right' ? -delta : delta);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: initial.x, y: initial.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: initial.x, y: initial.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: targetX, y: initial.y, button: 'left', buttons: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetX, y: initial.y, button: 'left', clickCount: 1 });
      for (let attempt = 0; attempt < 50; attempt++) {
        const current = await readLayout();
        if (current.width === targetWidth) return current.width;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    const final = await readLayout();
    if (final.width !== targetWidth) throw new Error(`Auxiliary Bar width settled at ${final.width}px; expected ${targetWidth}px`);
    return final.width;
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
