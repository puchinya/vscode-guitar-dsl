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
export async function captureWorkbenchScreenshot(filename: string): Promise<void> {
  if (process.env.GUITARDSL_E2E_CAPTURE_SCREENSHOTS !== '1') return;
  const outputPath = path.resolve(__dirname, '../../../docs/status/evidence/issue-134', filename);
  await withWorkbenchDevTools(async send => {
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
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };

  try {
    return await run(send);
  } finally {
    socket.close();
  }
}
