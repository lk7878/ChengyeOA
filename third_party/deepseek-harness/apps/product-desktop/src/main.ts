import path from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
  type Event,
} from 'electron'
import { createHostSupervisor, type HostSupervisor } from './host-supervisor.js'
import { decideNavigation } from './navigation-policy.js'
import { validateProductProfile } from './product-profile.js'
import { createDesktopLifecycle, type DesktopLifecycle } from './window-lifecycle.js'

const APP_NAME = 'DeepSeek Harness Product'
const WINDOW_WIDTH = 1_280
const WINDOW_HEIGHT = 840

let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let host: HostSupervisor | undefined
let lifecycle: DesktopLifecycle | undefined

function createTrayImage() {
  const size = 16
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4
      const foreground = x >= 3 && x <= 12 && y >= 3 && y <= 12
      pixels[offset] = foreground ? 0xf5 : 0x00
      pixels[offset + 1] = foreground ? 0xb3 : 0x00
      pixels[offset + 2] = foreground ? 0x31 : 0x00
      pixels[offset + 3] = foreground ? 0xff : 0x00
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 1 })
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function describeFailure(message: string): string {
  const diagnostics = host?.diagnostics().trim()
  return diagnostics ? `${message}\n\nRecent host output:\n${diagnostics}` : message
}

function reportFatalFailure(title: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  dialog.showErrorBox(title, describeFailure(message))
}

function enforceNavigation(window: BrowserWindow, allowedOrigin: string): void {
  const route = (event: Event, target: string) => {
    const decision = decideNavigation(target, allowedOrigin)
    if (decision === 'allow') return
    event.preventDefault()
    if (decision === 'external') void shell.openExternal(target)
  }
  window.webContents.on('will-navigate', route)
  window.webContents.on('will-redirect', route)
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (decideNavigation(url, allowedOrigin) === 'external') void shell.openExternal(url)
    return { action: 'deny' }
  })
}

async function bootstrap(): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('F002 supports Windows only.')
  }

  await validateProductProfile(process.env.DSH_HOME)
  const appDirectory = app.getAppPath()
  const workspaceRoot = path.resolve(appDirectory, '..', '..')
  const cliEntry = path.join(workspaceRoot, 'apps', 'cli', 'lib', 'bin.js')
  const nodeCommand = process.env.DSH_DESKTOP_NODE?.trim() || 'node'
  host = createHostSupervisor({
    command: nodeCommand,
    args: [
      cliEntry,
      '--profile',
      'product',
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
    ],
    cwd: workspaceRoot,
    env: { ...process.env },
    onUnexpectedExit: (message) => {
      reportFatalFailure('Product host stopped', message)
      void lifecycle?.requestQuit()
    },
  })

  const ready = await host.start()
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })

  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  enforceNavigation(mainWindow, ready.origin)

  lifecycle = createDesktopLifecycle({
    showWindow: showMainWindow,
    hideWindow: () => { mainWindow?.hide() },
    shutdownHost: () => host?.shutdown() ?? Promise.resolve(),
    quitApp: () => { app.quit() },
    reportShutdownError: (error) => { reportFatalFailure('Product host shutdown failed', error) },
  })
  mainWindow.on('close', (event) => { lifecycle?.handleWindowClose(event) })
  mainWindow.once('ready-to-show', showMainWindow)
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || lifecycle?.isQuitting()) return
    reportFatalFailure('Product UI failed to load', `${errorDescription} (${errorCode})`)
    void lifecycle?.requestQuit()
  })

  tray = new Tray(createTrayImage())
  tray.setToolTip(APP_NAME)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: showMainWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => void lifecycle?.requestQuit() },
  ]))
  tray.on('double-click', showMainWindow)

  await mainWindow.loadURL(ready.launchUrl)
}

app.setName(APP_NAME)
const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) {
  app.quit()
} else {
  app.on('second-instance', showMainWindow)
  app.on('window-all-closed', () => {})
  app.on('before-quit', (event) => {
    if (!lifecycle || lifecycle.isQuitting()) return
    event.preventDefault()
    void lifecycle.requestQuit()
  })
  app.whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      reportFatalFailure('Desktop startup failed', error)
      if (host) void host.shutdown().finally(() => { app.quit() })
      else app.quit()
    })
}
