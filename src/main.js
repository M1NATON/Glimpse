const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen, shell } = require("electron")
const { execFile } = require("node:child_process")
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { GoogleSession, aiUrl } = require("./google")
const { Settings, History } = require("./store")

const isMac = process.platform === "darwin"
const isWindows = process.platform === "win32"
const isLinux = process.platform === "linux"
const COMPACT_HEIGHT = 68

// Wayland has no global hotkeys for apps; Chromium asks the desktop portal instead.
if (isLinux) app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal")

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => toggle())
  app.whenReady().then(start)
}

let win = null
let tray = null
let settings = null
let history = null
let expanded = false
let blurTimer = null
let chat = null
const google = new GoogleSession()

function newChat() {
  chat = { id: crypto.randomUUID(), title: "", messages: [], saved: false }
}

function sendChat() {
  win?.webContents.send("chat", { ...chat, busy: google.busy })
}

function persistChat() {
  if (!settings.get().saveHistory || !chat.messages.length) return
  history.save({ id: chat.id, title: chat.title, messages: chat.messages })
}

function start() {
  if (isMac) app.dock?.hide()
  settings = new Settings(app.getPath("userData"))
  history = new History(app.getPath("userData"))
  newChat()
  createWindow()
  createTray()
  applySettings(settings.get())
  wireGoogle()
  google.warmUp()
  if (!process.argv.includes("--hidden")) show()
}

function createWindow() {
  const s = settings.get()
  win = new BrowserWindow({
    width: s.width,
    height: COMPACT_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: !isLinux,
    title: "Glimpse",
    backgroundColor: "#00000000",
    ...(isMac ? { vibrancy: "hud", visualEffectState: "active" } : {}),
    ...(isWindows ? { backgroundMaterial: "acrylic" } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.loadFile(path.join(__dirname, "ui", "index.html"))
  win.webContents.once("did-finish-load", relaunchIfShrunk)
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: "deny" }
  })
  win.webContents.on("will-navigate", (event) => event.preventDefault())
  // A short delay keeps a stray click outside from snapping the window shut.
  win.on("blur", () => {
    const s = settings.get()
    if (!s.hideOnBlur || google.captcha || win.webContents.isDevToolsOpened()) return
    clearTimeout(blurTimer)
    blurTimer = setTimeout(() => {
      if (!win.isFocused()) hide()
    }, s.hideDelay)
  })
  win.on("focus", () => clearTimeout(blurTimer))
}

// Chromium on Wayland folds GNOME's text scaling into the page scale; below the
// display scale it draws the page smaller than its own window. XWayland does not.
async function relaunchIfShrunk() {
  if (!isLinux || process.env.XDG_SESSION_TYPE !== "wayland" || process.argv.includes("--glimpse-x11")) return
  const pageScale = await win.webContents.executeJavaScript("devicePixelRatio")
  const displayScale = screen.getDisplayMatching(win.getBounds()).scaleFactor
  if (pageScale >= displayScale - 0.01) return
  app.relaunch({ args: [...process.argv.slice(1).filter((a) => !a.startsWith("--ozone-platform")), "--ozone-platform=x11", "--glimpse-x11"] })
  app.exit(0)
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "..", "build", "icon.png")).resize({ width: 18, height: 18 })
  tray = new Tray(icon)
  tray.setToolTip("Glimpse")
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Открыть Glimpse", click: show },
      { label: "Настройки", click: () => show("settings") },
      { label: "История", click: () => show("history") },
      { type: "separator" },
      { label: "Выйти", click: () => app.quit() },
    ]),
  )
  tray.on("click", toggle)
}

function placeWindow(height) {
  const s = settings.get()
  const cursor = screen.getCursorScreenPoint()
  const area = screen.getDisplayNearestPoint(cursor).workArea
  const top = Math.round(area.y + Math.max(24, (area.height - s.height) / 2))
  win.setBounds({ x: Math.round(area.x + (area.width - s.width) / 2), y: top, width: s.width, height })
}

function setExpanded(next) {
  expanded = next
  const s = settings.get()
  const height = next ? s.height : COMPACT_HEIGHT
  const bounds = win.getBounds()
  win.setBounds({ ...bounds, width: s.width, height }, isMac)
  hyprResize(s.width, height)
}

// Hyprland ignores size requests from floating clients; ask it directly.
function hyprResize(width, height) {
  if (!isLinux || !process.env.HYPRLAND_INSTANCE_SIGNATURE) return
  const selector = `pid:${process.pid}`
  execFile("hyprctl", ["dispatch", `hl.dsp.window.resize({ x = ${width}, y = ${height}, window = "${selector}" })`], (error) => {
    if (error) execFile("hyprctl", ["dispatch", "resizewindowpixel", `exact ${width} ${height},${selector}`], () => {})
  })
}

function show(view) {
  if (!win) return
  if (!win.isVisible()) placeWindow(expanded ? settings.get().height : COMPACT_HEIGHT)
  win.show()
  win.focus()
  win.webContents.send("shown", view || null)
}

function hide() {
  if (win?.isVisible()) win.hide()
}

function toggle() {
  if (win?.isVisible() && win.isFocused()) hide()
  else show()
}

function openExternal(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === "https:" || parsed.protocol === "http:") shell.openExternal(parsed.toString())
  } catch {}
}

function registerShortcut(accelerator) {
  globalShortcut.unregisterAll()
  if (!accelerator) return true
  try {
    return globalShortcut.register(accelerator, toggle)
  } catch {
    return false
  }
}

function setLaunchAtLogin(enabled) {
  if (!isLinux) {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ["--hidden"] })
    return
  }
  const file = path.join(os.homedir(), ".config", "autostart", "glimpse.desktop")
  if (!enabled) {
    fs.rmSync(file, { force: true })
    return
  }
  const exec = process.env.APPIMAGE || process.execPath
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    `[Desktop Entry]\nType=Application\nName=Glimpse\nExec="${exec}" --hidden\nX-GNOME-Autostart-enabled=true\n`,
  )
}

function applySettings(s) {
  const shortcutOk = registerShortcut(s.shortcut)
  setLaunchAtLogin(s.launchAtLogin)
  if (win) {
    win.webContents.send("settings", { ...s, shortcutOk })
    if (win.getBounds().width !== s.width || expanded) setExpanded(expanded)
  }
  return shortcutOk
}

function wireGoogle() {
  const last = () => chat.messages[chat.messages.length - 1]
  google.on("update", ({ blocks, sources }) => {
    Object.assign(last(), { blocks, sources, pending: true })
    sendChat()
  })
  google.on("done", ({ blocks, sources }) => {
    Object.assign(last(), { blocks, sources, pending: false })
    persistChat()
    sendChat()
  })
  google.on("error", ({ code }) => {
    Object.assign(last(), { error: code, pending: false })
    sendChat()
  })
  google.on("captcha", () => {
    Object.assign(last(), { captcha: true })
    sendChat()
  })
  google.on("captchaSolved", () => {
    Object.assign(last(), { captcha: false })
    sendChat()
    show()
  })
}

function ask(text) {
  text = String(text || "").trim().slice(0, 2000)
  if (!text || google.busy) return
  if (!chat.title) chat.title = text.slice(0, 80)
  chat.messages.push({ role: "user", text })
  chat.messages.push({ role: "ai", blocks: [], sources: [], pending: true })
  sendChat()
  google.ask(text, settings.get().language)
}

ipcMain.handle("init", () => ({
  settings: { ...settings.get(), shortcutOk: true },
  chat: { ...chat, busy: google.busy },
  platform: process.platform,
  homepage: require("../package.json").homepage || "",
}))
ipcMain.on("ask", (_event, text) => ask(text))
ipcMain.on("retry", () => {
  const question = [...chat.messages].reverse().find((m) => m.role === "user")
  if (!question || google.busy) return
  chat.messages.splice(chat.messages.length - 1, 1, { role: "ai", blocks: [], sources: [], pending: true })
  sendChat()
  google.reset()
  google.ask(question.text, settings.get().language)
})
ipcMain.on("new-chat", () => {
  google.reset()
  newChat()
  sendChat()
})
ipcMain.handle("history:list", () => history.list())
ipcMain.on("history:open", (_event, id) => {
  const saved = history.get(id)
  if (!saved) return
  google.reset()
  chat = { id: saved.id, title: saved.title, messages: saved.messages, saved: true }
  sendChat()
})
ipcMain.handle("history:remove", (_event, id) => {
  history.remove(id)
  return history.list()
})
ipcMain.handle("history:clear", () => {
  history.clear()
  return []
})
ipcMain.handle("settings:set", (_event, patch) => {
  const next = settings.set(patch || {})
  const shortcutOk = applySettings(next)
  return { ...next, shortcutOk }
})
ipcMain.handle("settings:reset", () => {
  const next = settings.reset()
  return { ...next, shortcutOk: applySettings(next) }
})
ipcMain.on("expand", (_event, next) => setExpanded(Boolean(next)))
ipcMain.on("hide", hide)
ipcMain.on("open-external", (_event, url) => openExternal(url))
ipcMain.on("open-in-browser", (_event, text) => {
  const question = text || [...chat.messages].reverse().find((m) => m.role === "user")?.text
  if (question) openExternal(aiUrl(question, settings.get().language))
  hide()
})
ipcMain.on("show-google", () => google.showPage())

app.on("before-quit", () => {
  google.quitting = true
})
app.on("will-quit", () => {
  globalShortcut.unregisterAll()
  google.destroy()
})
app.on("window-all-closed", (event) => event.preventDefault())
