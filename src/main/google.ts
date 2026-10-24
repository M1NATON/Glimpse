import { BrowserWindow, app, session } from "electron"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import path from "node:path"
import type { Answer, Block, ErrorCode, PageResult } from "../shared/types"

const EXTRACT = fs.readFileSync(path.join(__dirname, "..", "page", "extract.js"), "utf8")
const POLL_MS = 350
const STABLE_TICKS = 6
const TIMEOUT_MS = 60000

export function aiUrl(query: string, language: string) {
  const url = new URL("https://www.google.com/search")
  url.searchParams.set("udm", "50")
  url.searchParams.set("q", query)
  if (language && language !== "auto") url.searchParams.set("hl", language)
  return url.toString()
}

interface Events {
  update: [Answer]
  done: [Answer]
  error: [{ code: ErrorCode; detail?: string }]
  captcha: []
  captchaSolved: []
}

// One Google AI Mode conversation in a hidden window.
export class GoogleSession extends EventEmitter<Events> {
  quitting = false
  captcha = false
  busy = false
  private win: BrowserWindow | null = null
  private started = false
  private language = "auto"
  private timer: NodeJS.Timeout | undefined
  private ticking = false
  private awaitTurns = 1
  private lastKey = ""
  private lastResult: Answer | null = null
  private stable = 0
  private startedAt = 0

  private ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.win
    // Report the Chromium engine as it is, without Electron's app-specific tokens.
    const google = session.fromPartition("persist:google")
    google.setUserAgent(app.userAgentFallback.replace(/ (Electron|glimpse|Glimpse)\/\S+/g, ""))
    google.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    const win = new BrowserWindow({
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
    const contents = win.webContents
    contents.setWindowOpenHandler(() => ({ action: "deny" }))
    contents.on("dom-ready", () => contents.executeJavaScript(EXTRACT).catch(() => {}))
    contents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3 && this.busy) this.fail("network", description)
    })
    contents.on("did-navigate", (_event, url) => {
      if (this.captcha && !/\/sorry\//.test(url)) {
        this.captcha = false
        win.hide()
        this.emit("captchaSolved")
      }
    })
    win.on("close", (event) => {
      // Closing the captcha window only hides it: the session lives on.
      if (this.quitting) return
      event.preventDefault()
      win.hide()
    })
    this.win = win
    return win
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

  async ask(text: string, language: string) {
    this.language = language || this.language
    const win = this.ensureWindow()
    this.busy = true
    this.lastKey = ""
    this.lastResult = null
    this.stable = 0
    this.startedAt = Date.now()
    this.awaitTurns = 1
    let before = -1
    if (this.started) {
      before = await win.webContents.executeJavaScript(`window.__askGoogleSend(${JSON.stringify(text)})`).catch(() => -1)
    }
    // No follow-up box (first question, or the page changed): start over with this question.
    if (before < 0) win.loadURL(aiUrl(text, this.language))
    else this.awaitTurns = before + 1
    this.started = true
    this.startPolling()
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

  private startPolling() {
    clearInterval(this.timer)
    this.timer = setInterval(() => this.tick(), POLL_MS)
  }

  private stop() {
    clearInterval(this.timer)
    this.timer = undefined
  }

  private async tick() {
    if (!this.busy || this.ticking || !this.win) return
    if (Date.now() - this.startedAt > TIMEOUT_MS) {
      if (this.lastResult) this.finish()
      else this.fail("timeout")
      return
    }
    const contents = this.win.webContents
    if (contents.isLoading()) return
    this.ticking = true
    const result: PageResult | null = await contents
      .executeJavaScript(`window.__askGoogle ? window.__askGoogle(${this.awaitTurns}) : null`)
      .catch(() => null)
    this.ticking = false
    if (!result || !this.busy) return

    if ("blocked" in result) {
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

    const key = result.md + JSON.stringify(result.sources)
    if (key !== this.lastKey) {
      this.lastKey = key
      this.stable = 0
      this.lastResult = { blocks: safeParse(result.md), sources: result.sources }
      this.emit("update", this.lastResult)
    } else if (!result.busy && !result.expanding && ++this.stable >= STABLE_TICKS) {
      this.finish()
    }
  }

  private finish() {
    this.stop()
    this.busy = false
    const result = this.lastResult ?? { blocks: [], sources: [] }
    this.lastResult = null
    this.emit("done", result)
  }

  private fail(code: ErrorCode, detail?: string) {
    this.stop()
    this.busy = false
    this.lastResult = null
    this.emit("error", { code, detail })
  }
}

function safeParse(json: string): Block[] {
  try {
    return JSON.parse(json)
  } catch {
    return []
  }
}
