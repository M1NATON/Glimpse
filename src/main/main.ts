import { BrowserWindow, ClipboardItem, Menu, Tray, app, clipboard, dialog, globalShortcut, ipcMain, nativeImage, screen, shell } from "electron"
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Attachment, Chat, Message, Settings as SettingsValue, ShownSettings, UpdateState, View } from "../shared/types"
import { GoogleSession, aiUrl } from "./google"
import { History, Settings } from "./store"
import { download, findUpdate, install, relaunch } from "./update"

const isMac = process.platform === "darwin"
const isLinux = process.platform === "linux"
const COMPACT_HEIGHT = 68
const ROOT = app.getAppPath()
const IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/
const MAX_IMAGE = 12 * 1024 * 1024
const UPDATE_EVERY = 6 * 60 * 60 * 1000

// Wayland has no global hotkeys for apps; Chromium asks the desktop portal instead.
if (isLinux) app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal")

let win: BrowserWindow | null = null
let tray: Tray | null = null
let settings: Settings
let history: History
let expanded = false
let blurTimer: NodeJS.Timeout | undefined
let dialogOpen = false
let shortcutOk = true
let update: { version: string; page: string; file?: string } | null = null
let chat: Chat & { saved: boolean }
const google = new GoogleSession()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => toggle())
  // macOS: opening the app again from Finder or Spotlight reaches the running one here.
  app.on("activate", () => show())
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
  // macOS ignores login item args, so a login launch is recognised by the system flag instead.
  const atLogin = isMac && app.getLoginItemSettings().wasOpenedAtLogin
  if (!process.argv.includes("--hidden") && !atLogin) show()
  watchUpdates()
}

// Windows and the AppImage update themselves; macOS only installs signed apps,
// so there Glimpse points to the release page instead.
function watchUpdates() {
  const repo = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)$/.exec(homepage())?.[1]
  if (!app.isPackaged || !repo || (isLinux && !process.env.APPIMAGE)) return
  const check = async () => {
    if (update) return
    const found = await findUpdate(repo).catch(() => null)
    if (!found) return
    const file = isMac ? undefined : await download(found.asset).catch(() => undefined)
    if (!isMac && !file) return
    update = { version: found.version, page: found.page, file }
    sendUpdate()
  }
  setTimeout(check, 15_000)
  setInterval(check, UPDATE_EVERY)
}

function updateState(): UpdateState | null {
  if (!update) return null
  return update.file ? { state: "ready", version: update.version } : { state: "available", version: update.version, url: update.page }
}

function sendUpdate() {
  if (update) win?.webContents.send("update", updateState())
}

function installUpdate() {
  if (!update) return
  if (!update.file) return openExternal(update.page)
  try {
    install(update.file)
  } catch {
    return openExternal(update.page)
  }
  google.quitting = true
  app.quit()
}

function homepage(): string {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).homepage ?? ""
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
  // skipTransformProcessType keeps macOS from bringing back the dock icon hidden in start().
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  window.loadFile(path.join(ROOT, "out", "ui", "index.html"))
  window.webContents.once("did-finish-load", fitPageScale)
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: "deny" }
  })
  window.webContents.on("will-navigate", (event) => event.preventDefault())
  // A short delay keeps a stray click outside from snapping the window shut.
  window.on("blur", () => {
    const s = settings.get()
    if (!s.hideOnBlur || google.captcha || dialogOpen || window.webContents.isDevToolsOpened()) return
    clearTimeout(blurTimer)
    blurTimer = setTimeout(() => {
      if (!window.isFocused()) hide()
    }, s.hideDelay)
  })
  // Focus means the compositor has mapped the window, so it can take the corners.
  window.on("focus", () => {
    clearTimeout(blurTimer)
    hyprRounding()
  })
  // Closing from the window manager only hides it: the app lives on in the tray.
  window.on("close", (event) => {
    if (google.quitting) return
    event.preventDefault()
    hide()
  })
}

// Chromium on Wayland folds GNOME's text scaling into the device scale, so the page
// draws smaller than its own window. Relaunch once with the display's real scale;
// XWayland would avoid this too, but it loses keyboard focus when the window reopens.
async function fitPageScale() {
  if (!win || !isLinux || app.commandLine.hasSwitch("force-device-scale-factor")) return
  const pageScale: number = await win.webContents.executeJavaScript("devicePixelRatio")
  const displayScale = screen.getDisplayMatching(win.getBounds()).scaleFactor
  if (Math.abs(pageScale - displayScale) < 0.01) return
  relaunch([...process.argv.slice(1), `--force-device-scale-factor=${displayScale}`])
  app.exit(0)
}

const TRAY_LABELS = {
  en: ["Open Glimpse", "Settings", "History", "Quit"],
  ru: ["Открыть Glimpse", "Настройки", "История", "Выйти"],
}

// macOS gets a monochrome template icon that follows the menu bar; elsewhere a simple
// eye that stays readable at tray sizes (the @2x file is picked up on high-DPI screens).
function createTray() {
  const icon = nativeImage.createFromPath(path.join(ROOT, "build", isMac ? "trayTemplate.png" : "tray.png"))
  tray = new Tray(icon)
  tray.setToolTip("Glimpse")
  // On macOS a click opens the menu; elsewhere a click toggles the window, decided by
  // visibility alone because clicking the tray has already taken focus from it.
  if (!isMac) tray.on("click", () => (win?.isVisible() ? hide() : toggle()))
}

function updateTrayMenu(s: SettingsValue) {
  const language = s.uiLanguage === "auto" ? app.getLocale().slice(0, 2) : s.uiLanguage
  const [open, settingsLabel, historyLabel, quit] = language === "ru" ? TRAY_LABELS.ru : TRAY_LABELS.en
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: open, click: () => show() },
      { label: settingsLabel, click: () => show("settings") },
      { label: historyLabel, click: () => show("history") },
      { type: "separator" },
      { label: quit, click: () => app.quit() },
    ]),
  )
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

// Hyprland ignores size requests from floating clients and rounds and blurs the
// window by its own rules; tell it the window's real size and corners.
function hyprResize(width: number, height: number) {
  const window = `pid:${process.pid}`
  hyprDispatch(`hl.dsp.window.resize({ x = ${width}, y = ${height}, window = "${window}" })`, ["resizewindowpixel", `exact ${width} ${height},${window}`])
}

function hyprRounding() {
  const window = `pid:${process.pid}`
  const radius = settings.get().radius
  hyprDispatch(`hl.dsp.window.set_prop({ window = "${window}", prop = "rounding", value = "${radius}" })`, ["setprop", `${window} rounding ${radius}`])
}

// Lua-configured Hyprland takes hl.dsp calls; older configs take the classic dispatchers.
function hyprDispatch(lua: string, classic: string[]) {
  if (!isLinux || !process.env.HYPRLAND_INSTANCE_SIGNATURE) return
  execFile("hyprctl", ["dispatch", lua], (error, stdout) => {
    if (error || !stdout.startsWith("ok")) execFile("hyprctl", ["dispatch", ...classic], () => {})
  })
}

function show(view?: View) {
  if (!win) return
  if (!win.isVisible()) placeWindow(expanded ? settings.get().height : COMPACT_HEIGHT)
  // Without a dock icon the app is not active on macOS, so the window would show without keyboard focus.
  if (isMac) app.focus({ steal: true })
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
  // From source the login item would point at node_modules' electron.
  if (!app.isPackaged) return
  if (!isLinux) {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ["--hidden"] })
    return
  }
  const file = path.join(os.homedir(), ".config", "autostart", "glimpse.desktop")
  if (!enabled) {
    fs.rmSync(file, { force: true })
    return
  }
  // Desktop Entry quoting: escape \ " ` $ inside the quotes, and % everywhere.
  const exec = (process.env.APPIMAGE || process.execPath).replace(/[\\"`$]/g, "\\$&").replace(/%/g, "%%")
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Glimpse\nExec="${exec}" --hidden\nX-GNOME-Autostart-enabled=true\n`)
}

function applySettings(s: SettingsValue): ShownSettings {
  shortcutOk = registerShortcut(s.shortcut)
  updateTrayMenu(s)
  setLaunchAtLogin(s.launchAtLogin)
  const shown = { ...s, shortcutOk }
  if (win) {
    win.webContents.send("settings", shown)
    if (win.getBounds().width !== s.width || expanded) setExpanded(expanded)
    hyprRounding()
  }
  return shown
}

// The answer being written, if the current chat still has one: events from a
// cancelled question must not land on a fresh chat.
function lastAnswer() {
  const last = chat.messages[chat.messages.length - 1]
  return last?.role === "ai" && last.pending ? last : null
}

function wireGoogle() {
  google.on("update", (answer) => {
    const target = lastAnswer()
    if (!target) return
    Object.assign(target, answer, { pending: true })
    sendChat()
  })
  google.on("done", (answer) => {
    const target = lastAnswer()
    if (!target) return
    Object.assign(target, answer, { pending: false })
    persistChat()
    sendChat()
  })
  google.on("error", ({ code }) => {
    const target = lastAnswer()
    if (!target) return
    Object.assign(target, { error: code, pending: false })
    sendChat()
  })
  google.on("captcha", () => {
    const target = lastAnswer()
    if (!target) return
    target.captcha = true
    sendChat()
    hide()
  })
  google.on("captchaSolved", () => {
    const target = lastAnswer()
    if (!target?.captcha) return
    target.captcha = false
    sendChat()
    show()
  })
}

function pendingAnswer(): Message {
  return { role: "ai", blocks: [], sources: [], pending: true }
}

function ask(value: unknown, attachment: unknown) {
  const text = String(value ?? "").trim().slice(0, 2000)
  const image = validImage(attachment)
  if ((!text && !image) || google.busy) return
  if (!chat.title) chat.title = (text || "Image").slice(0, 80)
  chat.messages.push({ role: "user", text, ...(image && { image: image.thumb }) }, pendingAnswer())
  sendChat()
  google.ask(text, settings.get().language, image?.data)
}

function isImage(url: unknown): url is string {
  return typeof url === "string" && url.length < MAX_IMAGE && IMAGE.test(url)
}

// The image comes from the renderer: only small base64 data URLs of common types get through.
function validImage(value: unknown): Attachment | null {
  const { data, thumb } = (value ?? {}) as Partial<Attachment>
  return isImage(data) && isImage(thumb) ? { data, thumb } : null
}

function lastQuestion() {
  const question = chat.messages.findLast((m) => m.role === "user")
  return question?.role === "user" ? question.text : ""
}

ipcMain.handle("init", () => ({
  settings: { ...settings.get(), shortcutOk },
  chat: { ...chat, busy: google.busy },
  platform: process.platform,
  homepage: homepage(),
  // A reloaded UI gets a pending update again; it was only pushed once.
  update: updateState(),
}))
ipcMain.on("ask", (_event, text, image) => ask(text, image))
ipcMain.on("image:copy", (_event, data) => {
  if (!isImage(data)) return
  const png = new Blob([nativeImage.createFromDataURL(data).toPNG()], { type: "image/png" })
  clipboard.write([new ClipboardItem({ "image/png": png })]).catch(() => {})
})
ipcMain.handle("image:save", async (_event, data, name) => {
  if (!isImage(data) || !win) return false
  const extension = data.slice(11, data.indexOf(";")).replace("jpeg", "jpg")
  const base = String(name || "image").replace(/[\\/:*?"<>|\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "image"
  // The save dialog takes focus; the window must not hide behind it.
  dialogOpen = true
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath("pictures"), `${base}.${extension}`) })
    if (canceled || !filePath) return false
    fs.writeFileSync(filePath, Buffer.from(data.slice(data.indexOf(",") + 1), "base64"))
    return true
  } catch {
    return false
  } finally {
    dialogOpen = false
  }
})
ipcMain.on("install-update", installUpdate)
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
