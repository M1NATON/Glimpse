const fs = require("node:fs")
const path = require("node:path")

const isMac = process.platform === "darwin"

const DEFAULT_SETTINGS = {
  shortcut: isMac ? "Alt+Space" : "Control+Space",
  language: "auto",
  uiLanguage: "auto",
  launchAtLogin: false,
  hideOnBlur: true,
  saveHistory: true,
  theme: "glass",
  accent: "#4dd6c8",
  fontSize: 14,
  opacity: 0.72,
  radius: 22,
  width: 720,
  height: 640,
  font: "system",
}

// A JSON file written atomically (write to a temp file, then rename), so a
// crash mid-write never leaves a half-written file behind.
class JsonFile {
  constructor(file, fallback) {
    this.file = file
    this.fallback = fallback
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8"))
    } catch {
      return structuredClone(this.fallback)
    }
  }

  write(value) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temp = this.file + ".tmp"
    fs.writeFileSync(temp, JSON.stringify(value, null, 2))
    fs.renameSync(temp, this.file)
  }
}

class Settings {
  constructor(dir) {
    this.store = new JsonFile(path.join(dir, "settings.json"), DEFAULT_SETTINGS)
    this.value = { ...DEFAULT_SETTINGS, ...this.store.read() }
  }

  get() {
    return { ...this.value }
  }

  set(patch) {
    for (const key of Object.keys(patch)) {
      if (!(key in DEFAULT_SETTINGS)) continue
      if (typeof patch[key] !== typeof DEFAULT_SETTINGS[key]) continue
      this.value[key] = patch[key]
    }
    this.store.write(this.value)
    return this.get()
  }

  reset() {
    this.value = { ...DEFAULT_SETTINGS, shortcut: this.value.shortcut }
    this.store.write(this.value)
    return this.get()
  }
}

const MAX_CHATS = 300

class History {
  constructor(dir) {
    this.store = new JsonFile(path.join(dir, "history.json"), { chats: [] })
    this.chats = this.store.read().chats || []
  }

  list() {
    return this.chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      updated: chat.updated,
      count: chat.messages.filter((m) => m.role === "user").length,
    }))
  }

  get(id) {
    return this.chats.find((chat) => chat.id === id) || null
  }

  save(chat) {
    const index = this.chats.findIndex((c) => c.id === chat.id)
    const entry = { ...chat, updated: Date.now() }
    if (index >= 0) this.chats.splice(index, 1)
    this.chats.unshift(entry)
    this.chats.length = Math.min(this.chats.length, MAX_CHATS)
    this.store.write({ chats: this.chats })
  }

  remove(id) {
    this.chats = this.chats.filter((chat) => chat.id !== id)
    this.store.write({ chats: this.chats })
  }

  clear() {
    this.chats = []
    this.store.write({ chats: [] })
  }
}

module.exports = { Settings, History, DEFAULT_SETTINGS }
