import fs from "node:fs"
import path from "node:path"
import type { Chat, ChatSummary, SavedChat, Settings as SettingsValue } from "../shared/types"

const isMac = process.platform === "darwin"

export const DEFAULT_SETTINGS: SettingsValue = {
  shortcut: isMac ? "Alt+Space" : "Control+Space",
  language: "auto",
  uiLanguage: "auto",
  launchAtLogin: false,
  hideOnBlur: true,
  hideDelay: 600,
  saveHistory: true,
  theme: "glass",
  accent: "#0a84ff",
  fontSize: 14,
  opacity: 0.9,
  radius: 16,
  width: 720,
  height: 640,
  font: "system",
}

// The same limits the settings sliders use.
const RANGES: Partial<Record<string, [number, number]>> = {
  opacity: [0.3, 1],
  radius: [0, 34],
  fontSize: [12, 18],
  width: [560, 1000],
  height: [420, 900],
  hideDelay: [0, 3000],
}

// A JSON file written atomically (write to a temp file, then rename), so a
// crash mid-write never leaves a half-written file behind.
class JsonFile<T> {
  constructor(
    private file: string,
    private fallback: T,
  ) {}

  read(): T {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as T
    } catch {
      return structuredClone(this.fallback)
    }
  }

  write(value: T) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temp = this.file + ".tmp"
    fs.writeFileSync(temp, JSON.stringify(value, null, 2))
    fs.renameSync(temp, this.file)
  }
}

export class Settings {
  private store: JsonFile<Partial<SettingsValue>>
  private value: SettingsValue

  constructor(dir: string) {
    this.store = new JsonFile(path.join(dir, "settings.json"), {})
    this.value = { ...DEFAULT_SETTINGS }
    this.apply(this.store.read())
  }

  get(): SettingsValue {
    return { ...this.value }
  }

  set(patch: Partial<SettingsValue>) {
    this.apply(patch)
    this.store.write(this.value)
    return this.get()
  }

  reset() {
    this.value = { ...DEFAULT_SETTINGS, shortcut: this.value.shortcut }
    this.store.write(this.value)
    return this.get()
  }

  // Only known keys with the default's type get through: patches come from the UI and from disk.
  private apply(patch: Partial<SettingsValue>) {
    const target = this.value as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(patch ?? {})) {
      if (!(key in DEFAULT_SETTINGS) || typeof value !== typeof DEFAULT_SETTINGS[key as keyof SettingsValue]) continue
      const range = RANGES[key]
      if (range && (typeof value !== "number" || !Number.isFinite(value))) continue
      target[key] = range ? Math.min(range[1], Math.max(range[0], value as number)) : value
    }
  }
}

const MAX_CHATS = 300

export class History {
  private store: JsonFile<{ chats: SavedChat[] }>
  private chats: SavedChat[]

  constructor(dir: string) {
    this.store = new JsonFile(path.join(dir, "history.json"), { chats: [] })
    this.chats = this.store.read().chats ?? []
  }

  list(): ChatSummary[] {
    return this.chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      updated: chat.updated,
      count: chat.messages.filter((m) => m.role === "user").length,
    }))
  }

  get(id: string) {
    return this.chats.find((chat) => chat.id === id) ?? null
  }

  save(chat: Chat) {
    this.chats = this.chats.filter((c) => c.id !== chat.id)
    this.chats.unshift({ ...chat, updated: Date.now() })
    this.chats.length = Math.min(this.chats.length, MAX_CHATS)
    this.store.write({ chats: this.chats })
  }

  remove(id: string) {
    this.chats = this.chats.filter((chat) => chat.id !== id)
    this.store.write({ chats: this.chats })
    return this.list()
  }

  clear() {
    this.chats = []
    this.store.write({ chats: [] })
    return this.list()
  }
}
