const { BrowserWindow, app, session } = require("electron")
const { EventEmitter } = require("node:events")
const fs = require("node:fs")
const path = require("node:path")

const EXTRACT = fs.readFileSync(path.join(__dirname, "extract.js"), "utf8")
const POLL_MS = 350
const STABLE_TICKS = 6
const TIMEOUT_MS = 60000

function aiUrl(query, language) {
  const url = new URL("https://www.google.com/search")
  url.searchParams.set("udm", "50")
  url.searchParams.set("q", query)
  if (language && language !== "auto") url.searchParams.set("hl", language)
  return url.toString()
}

// One Google AI Mode conversation in a hidden window. Emits:
//   update {blocks, sources}  while the answer fills in
//   done   {blocks, sources}  once it is complete
//   error  {code}             network | timeout | empty | nobox
//   captcha / captchaSolved   when Google wants a human check
class GoogleSession extends EventEmitter {
  constructor() {
    super()
    this.win = null
    this.started = false
    this.busy = false
    this.language = "auto"
  }

  ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.win
    // Report the Chromium engine as it is, without Electron's app-specific tokens.
    const google = session.fromPartition("persist:google")
    google.setUserAgent(app.userAgentFallback.replace(/ (Electron|glimpse|Glimpse)\/\S+/g, ""))
    google.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    this.win = new BrowserWindow({
      show: false,
      width: 1100,
      height: 1400,
      title: "Glimpse · Google",
      autoHideMenuBar: true,
      webPreferences: {
        partition: "persist:google",
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })
    const contents = this.win.webContents
    contents.setWindowOpenHandler(() => ({ action: "deny" }))
    contents.on("dom-ready", () => contents.executeJavaScript(EXTRACT).catch(() => {}))
    contents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3 && this.busy) this.fail("network", description)
    })
    contents.on("did-navigate", (_event, url) => {
      if (this.captcha && !/\/sorry\//.test(url)) {
        this.captcha = false
        this.win.hide()
        this.emit("captchaSolved")
      }
    })
    this.win.on("close", (event) => {
      // Closing the captcha window only hides it: the session lives on.
      if (this.quitting) return
      event.preventDefault()
      this.win.hide()
    })
    return this.win
  }

  warmUp() {
    const win = this.ensureWindow()
    if (!win.webContents.getURL()) win.loadURL("https://www.google.com/")
  }

  reset() {
    this.stop()
    this.started = false
    this.busy = false
  }

  async ask(text, language) {
    this.language = language || this.language
    const win = this.ensureWindow()
    this.busy = true
    this.lastKey = ""
    this.lastResult = null
    this.stable = 0
    this.startedAt = Date.now()
    if (!this.started) {
      this.started = true
      this.awaitTurns = 1
      win.loadURL(aiUrl(text, this.language))
    } else {
      let before = -1
      try {
        before = await win.webContents.executeJavaScript(`window.__askGoogleSend(${JSON.stringify(text)})`)
      } catch {}
      if (before < 0) {
        // The follow-up box is gone (page changed or reloaded): start over with this question.
        this.awaitTurns = 1
        win.loadURL(aiUrl(text, this.language))
      } else {
        this.awaitTurns = before + 1
      }
    }
    this.startPolling()
  }

  startPolling() {
    clearInterval(this.timer)
    this.timer = setInterval(() => this.tick(), POLL_MS)
  }

  stop() {
    clearInterval(this.timer)
    this.timer = null
  }

  async tick() {
    if (!this.busy || this.ticking) return
    if (Date.now() - this.startedAt > TIMEOUT_MS) {
      if (this.lastResult) this.finish()
      else this.fail("timeout")
      return
    }
    const contents = this.win.webContents
    if (contents.isLoading()) return
    this.ticking = true
    let result = null
    try {
      result = await contents.executeJavaScript(`window.__askGoogle ? window.__askGoogle(${this.awaitTurns}) : null`)
    } catch {}
    this.ticking = false
    if (!result || !this.busy) return

    if (result.blocked) {
      if (!this.captcha) {
        this.captcha = true
        this.startedAt = Date.now() + 5 * 60 * 1000
        this.win.setTitle("Glimpse · подтвердите, что вы не робот")
        this.win.show()
        this.emit("captcha")
      }
      return
    }
    if (!result.found || !result.md) return

    const key = result.md + JSON.stringify(result.sources || [])
    if (key !== this.lastKey) {
      this.lastKey = key
      this.stable = 0
      this.lastResult = { blocks: safeParse(result.md), sources: result.sources || [] }
      this.emit("update", this.lastResult)
    } else if (!result.busy && !result.expanding) {
      this.stable += 1
      if (this.stable >= STABLE_TICKS) this.finish()
    }
  }

  finish() {
    this.stop()
    this.busy = false
    const result = this.lastResult
    this.lastResult = null
    this.emit("done", result)
  }

  fail(code, detail) {
    this.stop()
    this.busy = false
    this.lastResult = null
    this.emit("error", { code, detail })
  }

  showPage() {
    const win = this.ensureWindow()
    win.setTitle("Glimpse · Google")
    win.show()
  }

  destroy() {
    this.stop()
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
  }
}

function safeParse(json) {
  try {
    return JSON.parse(json)
  } catch {
    return []
  }
}

module.exports = { GoogleSession, aiUrl }
