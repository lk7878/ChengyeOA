import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { KnowledgeBroker } from './knowledge-broker.mjs';
import { dataDirectory, hostEnvironment, isTrustedBridgeCall, navigation, readConfig } from './config.mjs';
import { createHostSupervisor } from '../../../third_party/deepseek-harness/apps/product-desktop/src/host-supervisor.ts';
import { createDesktopLifecycle } from '../../../third_party/deepseek-harness/apps/product-desktop/src/window-lifecycle.ts';
import { validateProductProfile } from '../../../third_party/deepseek-harness/apps/product-desktop/src/product-profile.ts';

const title = '律师智慧管理系统';
const home = dataDirectory();
app.setName(title);
app.setPath('userData', join(home, 'client'));
let oaWindow, caseWindow, tray, lifecycle, host, opening, config, knowledge;

function show(window) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}

function guard(window, origin) {
  const route = (event, target) => {
    const result = navigation(target, origin);
    if (result === 'allow') return;
    event.preventDefault();
    if (result === 'external') void shell.openExternal(target);
  };
  window.webContents.on('will-navigate', route);
  window.webContents.on('will-redirect', route);
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (navigation(url, origin) !== 'deny') void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}

async function openAssistant() {
  if (lifecycle.isQuitting()) throw new Error('客户端正在退出');
  if (caseWindow && !caseWindow.isDestroyed()) { show(caseWindow); return; }
  if (opening) return opening;
  opening = (async () => {
    const env = hostEnvironment(home);
    await validateProductProfile(env.DSH_HOME);
    const cwd = join(home, 'workspace');
    await mkdir(cwd, { recursive: true });
    if (lifecycle.isQuitting()) return;
    const args = [join(config.vendorPath, 'apps/cli/lib/bin.js'), '--profile', 'product', '--patch', join(app.getAppPath(), 'product.patch.yml'), '--no-open', '--host', '127.0.0.1', '--port', '0'];
    host = createHostSupervisor({
      command: config.nodePath,
      args,
      cwd, env, readyTimeoutMs: 60000,
      spawnHost: () => {
        const child = spawn(config.nodePath, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        const reply = value => { if (child.connected) child.send(value, () => {}); };
        child.on('message', value => knowledge.request(value, reply, child));
        child.once('exit', () => knowledge.detach(child));
        child.once('disconnect', () => knowledge.detach(child));
        return child;
      },
      onUnexpectedExit: () => {
        if (!lifecycle.isQuitting()) {
          caseWindow?.destroy(); caseWindow = undefined;
          dialog.showErrorBox('智慧办案已停止', '本机 Harness 进程意外退出。已落盘资料仍保留，可重新打开智慧办案。');
        }
      },
    });
    const ready = await host.start();
    if (lifecycle.isQuitting()) { await host.shutdown(); return; }
    caseWindow = new BrowserWindow({
      title: '智慧办案 · Harness', width: 1280, height: 840, minWidth: 960, minHeight: 640,
      show: false, autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, partition: 'persist:harness-local' },
    });
    guard(caseWindow, ready.origin);
    caseWindow.on('close', event => { if (!lifecycle.isQuitting()) { event.preventDefault(); caseWindow.hide(); } });
    caseWindow.once('ready-to-show', () => show(caseWindow));
    await caseWindow.loadURL(ready.launchUrl);
  })().catch(async error => {
    caseWindow?.destroy(); caseWindow = undefined;
    await host?.shutdown();
    // Native supervisor diagnostics already redact tokens; do not return them to OA.
    console.error('Harness startup:', host?.diagnostics() || error.message);
    throw new Error('智慧办案启动失败，请检查本机配置与桌面日志');
  }).finally(() => { opening = undefined; });
  return opening;
}

async function bootstrap() {
  config = await readConfig(home);
  const oaOrigin = new URL(config.oaUrl).origin;
  lifecycle = createDesktopLifecycle({
    showWindow: () => show(oaWindow),
    hideWindow: () => oaWindow?.hide(),
    shutdownHost: async () => { knowledge?.invalidate(); await host?.shutdown(); await opening?.catch(() => {}); await host?.shutdown(); },
    quitApp: () => app.quit(),
    reportShutdownError: () => dialog.showErrorBox('退出异常', '请检查本机 Harness 是否已退出。'),
  });
  oaWindow = new BrowserWindow({
    title, width: 1440, height: 960, minWidth: 960, minHeight: 640, show: false, autoHideMenuBar: true,
    webPreferences: { preload: join(app.getAppPath(), 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false,
      partition: `persist:oa-${createHash('sha256').update(oaOrigin).digest('hex').slice(0, 16)}` },
  });
  guard(oaWindow, oaOrigin);
  knowledge = new KnowledgeBroker(oaOrigin, value => {
    if (!oaWindow.webContents.isDestroyed()) oaWindow.webContents.send('chengye:knowledge-event', value);
  });
  oaWindow.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) knowledge.invalidate(); });
  oaWindow.webContents.on('render-process-gone', () => knowledge.invalidate());
  for (const [channel, handler] of [['chengye:knowledge-identity', value => knowledge.setIdentity(value)], ['chengye:knowledge-reply', value => knowledge.accept(value)]]) {
    ipcMain.on(channel, (event, value) => {
      if (isTrustedBridgeCall(event, oaWindow.webContents, oaOrigin)) handler(value);
    });
  }
  oaWindow.once('ready-to-show', () => show(oaWindow));
  oaWindow.on('close', event => lifecycle.handleWindowClose(event));
  ipcMain.handle('chengye:open-assistant', async (event, ...args) => {
    if (args.length || !isTrustedBridgeCall(event, oaWindow.webContents, oaOrigin)) throw new Error('不允许的桌面调用');
    await openAssistant();
  });
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) {
    const offset = (y * 16 + x) * 4;
    pixels[offset] = 0xff; pixels[offset + 1] = 0x77; pixels[offset + 2] = 0x16; pixels[offset + 3] = 0xff;
  }
  const icon = nativeImage.createFromBitmap(pixels, { width: 16, height: 16, scaleFactor: 1 });
  tray = new Tray(icon); tray.setToolTip(title);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 OA', click: () => show(oaWindow) },
    { label: '打开智慧办案', click: () => { void openAssistant().catch(error => dialog.showErrorBox('智慧办案', error.message)); } },
    { label: '重新加载 OA', click: () => { void oaWindow.loadURL(config.oaUrl).catch(reportOaFailure); } },
    { type: 'separator' },
    { label: '退出客户端', click: () => { void lifecycle.requestQuit(); } },
  ]));
  tray.on('double-click', () => show(oaWindow));
  await oaWindow.loadURL(config.oaUrl).catch(reportOaFailure);
}

function reportOaFailure(error) {
  if (error?.code === 'ERR_ABORTED') return; // A newer OA navigation replaced this one.
  dialog.showErrorBox('OA 暂时无法连接', '请检查网络和 OA 服务地址。可从系统托盘重新加载 OA，或打开本地智慧办案。');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => show(oaWindow));
  app.on('window-all-closed', () => {});
  app.on('before-quit', event => {
    if (lifecycle && !lifecycle.isQuitting()) { event.preventDefault(); void lifecycle.requestQuit(); }
  });
  app.whenReady().then(bootstrap).catch(error => {
    dialog.showErrorBox('客户端启动失败', error.message);
    void (host?.shutdown() || Promise.resolve()).finally(() => app.quit());
  });
}
