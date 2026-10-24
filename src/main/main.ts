import { BrowserWindow, Menu, Tray, app, globalShortcut, ipcMain, nativeImage, screen, shell } from "electron"
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Chat, Message, Settings as SettingsValue, ShownSettings, View } from "../shared/types"
import { GoogleSession, aiUrl } from "./google"
import { History, Settings } from "./store"

const isMac = process.platform === "darwin"
const isLinux = process.platform === "linux"
const COMPACT_HEIGHT = 68
const ROOT = app.getAppPath()

// Wayland has no global hotkeys for apps; Chromium asks the desktop portal instead.
if (isLinux) app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal")

let win: BrowserWindow | null = null
let tray: Tray | null = null
let settings: Settings
let history: History
let expanded = false
let blurTimer: NodeJS.Timeout | undefined
let chat: Chat & { saved: boolean }
const google = new GoogleSession()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => toggle())
  app.whenReady().then(start)
}

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
  const window = new BrowserWindow({
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
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win = window
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.loadFile(path.join(ROOT, "out", "ui", "index.html"))
  window.webContents.once("did-finish-load", relaunchIfShrunk)
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: "deny" }
  })
  window.webContents.on("will-navigate", (event) => event.preventDefault())
  // A short delay keeps a stray click outside from snapping the window shut.
  window.on("blur", () => {
    const s = settings.get()
    if (!s.hideOnBlur || google.captcha || window.webContents.isDevToolsOpened()) return
    clearTimeout(blurTimer)
    blurTimer = setTimeout(() => {
      if (!window.isFocused()) hide()
    }, s.hideDelay)
  })
  window.on("focus", () => clearTimeout(blurTimer))
}

// Chromium on Wayland folds GNOME's text scaling into the page scale; below the
// display scale it draws the page smaller than its own window. XWayland does not.
async function relaunchIfShrunk() {
  if (!win || !isLinux || process.env.XDG_SESSION_TYPE !== "wayland" || process.argv.includes("--glimpse-x11")) return
  const pageScale: number = await win.webContents.executeJavaScript("devicePixelRatio")
  const displayScale = screen.getDisplayMatching(win.getBounds()).scaleFactor
  if (pageScale >= displayScale - 0.01) return
  app.relaunch({ args: [...process.argv.slice(1).filter((a) => !a.startsWith("--ozone-platform")), "--ozone-platform=x11", "--glimpse-x11"] })
  app.exit(0)
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ROOT, "build", "icon.png")).resize({ width: 18, height: 18 })
  tray = new Tray(icon)
  tray.setToolTip("Glimpse")
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Открыть Glimpse", click: () => show() },
      { label: "Настройки", click: () => show("settings") },
      { label: "История", click: () => show("history") },
      { type: "separator" },
      { label: "Выйти", click: () => app.quit() },
    ]),
  )
  tray.on("click", toggle)
}

function placeWindow(height: number) {
  if (!win) return
  const s = settings.get()
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const top = Math.round(area.y + Math.max(24, (area.height - s.height) / 2))
  win.setBounds({ x: Math.round(area.x + (area.width - s.width) / 2), y: top, width: s.width, height })
}

function setExpanded(next: boolean) {
  if (!win) return
  expanded = next
  const s = settings.get()
  const height = next ? s.height : COMPACT_HEIGHT
  win.setBounds({ ...win.getBounds(), width: s.width, height }, isMac)
  hyprResize(s.width, height)
}

// Hyprland ignores size requests from floating clients; ask it directly.
function hyprResize(width: number, height: number) {
  if (!isLinux || !process.env.HYPRLAND_INSTANCE_SIGNATURE) return
  const selector = `pid:${process.pid}`
  execFile("hyprctl", ["dispatch", `hl.dsp.window.resize({ x = ${width}, y = ${height}, window = "${selector}" })`], (error) => {
    if (error) execFile("hyprctl", ["dispatch", "resizewindowpixel", `exact ${width} ${height},${selector}`], () => {})
  })
}

function show(view?: View) {
  if (!win) return
  if (!win.isVisible()) placeWindow(expanded ? settings.get().height : COMPACT_HEIGHT)
  win.show()
  win.focus()
  win.webContents.send("shown", view ?? null)
}

function hide() {
  if (win?.isVisible()) win.hide()
}

// Each open from the shortcut starts a fresh chat; past chats stay in History.
function toggle() {
  if (win?.isVisible() && win.isFocused()) return hide()
  if (!win?.isVisible() && chat.messages.length) {
    google.reset()
    newChat()
    sendChat()
  }
  show()
}

function openExternal(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === "https:" || parsed.protocol === "http:") shell.openExternal(parsed.toString())
  } catch {}
}

function registerShortcut(accelerator: string) {
  globalShortcut.unregisterAll()
  if (!accelerator) return true
  try {
    return globalShortcut.register(accelerator, toggle)
  } catch {
    return false
  }
}

function setLaunchAtLogin(enabled: boolean) {
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
  fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Glimpse\nExec="${exec}" --hidden\nX-GNOME-Autostart-enabled=true\n`)
}

function applySettings(s: SettingsValue): ShownSettings {
  const shortcutOk = registerShortcut(s.shortcut)
  setLaunchAtLogin(s.launchAtLogin)
  const shown = { ...s, shortcutOk }
  if (win) {
    win.webContents.send("settings", shown)
    if (win.getBounds().width !== s.width || expanded) setExpanded(expanded)
  }
  return shown
}

function lastAnswer() {
  return chat.messages[chat.messages.length - 1] as Extract<Message, { role: "ai" }>
}

function wireGoogle() {
  google.on("update", (answer) => {
    Object.assign(lastAnswer(), answer, { pending: true })
    sendChat()
  })
  google.on("done", (answer) => {
    Object.assign(lastAnswer(), answer, { pending: false })
    persistChat()
    sendChat()
  })
  google.on("error", ({ code }) => {
    Object.assign(lastAnswer(), { error: code, pending: false })
    sendChat()
  })
  google.on("captcha", () => {
    lastAnswer().captcha = true
    sendChat()
    hide()
  })
  google.on("captchaSolved", () => {
    lastAnswer().captcha = false
    sendChat()
    show()
  })
}

function pendingAnswer(): Message {
  return { role: "ai", blocks: [], sources: [], pending: true }
}

function ask(value: unknown) {
  const text = String(value ?? "").trim().slice(0, 2000)
  if (!text || google.busy) return
  if (!chat.title) chat.title = text.slice(0, 80)
  chat.messages.push({ role: "user", text }, pendingAnswer())
  sendChat()
  google.ask(text, settings.get().language)
}

function lastQuestion() {
  const question = chat.messages.findLast((m) => m.role === "user")
  return question?.role === "user" ? question.text : ""
}

ipcMain.handle("init", () => ({
  settings: { ...settings.get(), shortcutOk: true },
  chat: { ...chat, busy: google.busy },
  platform: process.platform,
  homepage: JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).homepage ?? "",
}))
ipcMain.on("ask", (_event, text) => ask(text))
ipcMain.on("retry", () => {
  const question = lastQuestion()
  if (!question || google.busy) return
  chat.messages.splice(chat.messages.length - 1, 1, pendingAnswer())
  sendChat()
  google.reset()
  google.ask(question, settings.get().language)
})
ipcMain.on("new-chat", () => {
  google.reset()
  newChat()
  sendChat()
})
ipcMain.handle("history:list", () => history.list())
ipcMain.on("history:open", (_event, id) => {
  const saved = history.get(String(id))
  if (!saved) return
  google.reset()
  chat = { id: saved.id, title: saved.title, messages: saved.messages, saved: true }
  sendChat()
})
ipcMain.handle("history:remove", (_event, id) => history.remove(String(id)))
ipcMain.handle("history:clear", () => history.clear())
ipcMain.handle("settings:set", (_event, patch) => applySettings(settings.set(typeof patch === "object" && patch ? patch : {})))
ipcMain.handle("settings:reset", () => applySettings(settings.reset()))
ipcMain.on("expand", (_event, next) => setExpanded(Boolean(next)))
ipcMain.on("hide", hide)
ipcMain.on("open-external", (_event, url) => openExternal(String(url)))
ipcMain.on("open-in-browser", (_event, text) => {
  const question = String(text || "") || lastQuestion()
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
// Hiding the last window must not quit: Glimpse lives in the tray.
app.on("window-all-closed", () => {})
