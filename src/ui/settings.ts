import type { Settings, ShownSettings, Theme } from "../shared/types"
import { t } from "./i18n.js"
import { el } from "./render.js"

export type Update = (patch: Partial<Settings>, live?: boolean) => void

export interface SettingsContext {
  settings: ShownSettings
  platform: string
  homepage: string
  reset(): void
}

const THEMES: Record<Theme, [string, string]> = {
  glass: ["rgb(22 28 44)", "rgb(232 236 245)"],
  midnight: ["rgb(12 13 18)", "rgb(236 237 242)"],
  paper: ["rgb(250 249 246)", "rgb(28 30 36)"],
  mono: ["rgb(0 0 0)", "rgb(255 255 255)"],
  forest: ["rgb(18 30 26)", "rgb(226 238 230)"],
}
const ACCENTS = ["#4dd6c8", "#5b9dff", "#a78bfa", "#f472b6", "#fb923c", "#4ade80"]
const LANGUAGES = { en: "English", ru: "Русский", uk: "Українська", de: "Deutsch", fr: "Français", es: "Español", pt: "Português", it: "Italiano", pl: "Polski", tr: "Türkçe", ja: "日本語", "zh-CN": "中文" }
const NAMED_KEYS: Record<string, string> = { Space: "Space", Enter: "Enter", Tab: "Tab", Backquote: "`", Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\" }

export function applyLook(s: Settings) {
  const root = document.documentElement
  root.dataset.theme = s.theme
  root.dataset.font = s.font
  root.style.setProperty("--accent", s.accent)
  root.style.setProperty("--opacity", String(s.opacity))
  root.style.setProperty("--radius", s.radius + "px")
  root.style.setProperty("--font-size", s.fontSize + "px")
}

// Turns a keydown into an Electron accelerator such as "Control+Shift+Space".
function accelerator(event: KeyboardEvent, platform: string) {
  let key = NAMED_KEYS[event.code]
  if (!key && /^(Key[A-Z]|Digit\d)$/.test(event.code)) key = event.code.slice(-1)
  if (!key && /^F\d{1,2}$/.test(event.code)) key = event.code
  if (!key) return null
  const parts = []
  if (event.ctrlKey) parts.push("Control")
  if (event.altKey) parts.push("Alt")
  if (event.shiftKey) parts.push("Shift")
  if (event.metaKey) parts.push(platform === "darwin" ? "Command" : "Super")
  if (!parts.length && !/^F\d/.test(key)) return null
  return [...parts, key].join("+")
}

function prettyShortcut(value: string, platform: string) {
  if (!value) return "—"
  if (platform !== "darwin") return value.replace(/Control/g, "Ctrl").replace(/\+/g, " + ")
  return value.replace("Command", "⌘").replace("Control", "⌃").replace("Alt", "⌥").replace("Shift", "⇧").replace(/\+/g, "")
}

type NumberKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings]
type BooleanKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings]
type StringKey = "font" | "uiLanguage" | "language"

export function buildSettings(container: HTMLElement, context: SettingsContext, update: Update) {
  const s = context.settings
  container.replaceChildren()

  const section = (title: string) => container.appendChild(el("div", "section")).appendChild(el("h4", "", title)).parentElement!
  const row = (parent: HTMLElement, label: string, control: HTMLElement, note?: string) => {
    const text = el("label", "", label)
    if (note) text.appendChild(el("span", "note", note))
    parent.appendChild(el("div", "row")).append(text, control)
  }
  const range = (key: NumberKey, min: number, max: number, step: number, format: (v: number) => string) => {
    const wrap = el("div", "swatches")
    const value = el("span", "value", format(s[key]))
    const input = Object.assign(el("input"), { type: "range", min, max, step, value: String(s[key]) })
    input.addEventListener("input", () => {
      value.textContent = format(Number(input.value))
      update({ [key]: Number(input.value) }, true)
    })
    input.addEventListener("change", () => update({ [key]: Number(input.value) }))
    wrap.append(input, value)
    return wrap
  }
  const toggle = (key: BooleanKey) => {
    const button = el("button", "toggle" + (s[key] ? " on" : ""))
    button.setAttribute("role", "switch")
    button.setAttribute("aria-checked", String(s[key]))
    button.addEventListener("click", () => update({ [key]: !s[key] }))
    return button
  }
  const select = (key: StringKey, options: Record<string, string>) => {
    const node = el("select")
    for (const [value, label] of Object.entries(options)) {
      const option = el("option", "", label)
      option.value = value
      option.selected = s[key] === value
      node.appendChild(option)
    }
    node.addEventListener("change", () => update({ [key]: node.value }))
    return node
  }

  const look = section(t.look)
  const themes = el("div", "themes")
  for (const [name, [bg, fg]] of Object.entries(THEMES) as [Theme, [string, string]][]) {
    const card = el("button", "theme" + (s.theme === name ? " on" : ""))
    card.style.background = bg
    card.style.color = fg
    card.append(el("i"), el("span", "", t.themes[name]))
    card.addEventListener("click", () => update({ theme: name }))
    themes.appendChild(card)
  }
  look.appendChild(themes)

  const swatches = el("div", "swatches")
  for (const color of ACCENTS) {
    const swatch = el("button", "swatch" + (s.accent === color ? " on" : ""))
    swatch.style.background = color
    swatch.title = color
    swatch.addEventListener("click", () => update({ accent: color }))
    swatches.appendChild(swatch)
  }
  const picker = Object.assign(el("input"), { type: "color", value: s.accent })
  picker.addEventListener("input", () => update({ accent: picker.value }, true))
  picker.addEventListener("change", () => update({ accent: picker.value }))
  swatches.appendChild(picker)
  row(look, t.accent, swatches)
  row(look, t.opacity, range("opacity", 0.3, 1, 0.02, (v) => Math.round(v * 100) + "%"))
  row(look, t.radius, range("radius", 0, 34, 1, (v) => v + "px"))
  row(look, t.fontSize, range("fontSize", 12, 18, 1, (v) => v + "px"))
  row(look, t.font, select("font", t.fonts))
  row(look, t.width, range("width", 560, 1000, 10, (v) => v + "px"))
  row(look, t.height, range("height", 420, 900, 10, (v) => v + "px"))

  const behavior = section(t.behavior)
  const shortcut = el("button", "shortcut" + (s.shortcutOk ? "" : " bad"), prettyShortcut(s.shortcut, context.platform))
  shortcut.addEventListener("click", () => {
    shortcut.classList.add("recording")
    shortcut.textContent = t.recording
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === "Escape") return finish(null)
      const value = accelerator(event, context.platform)
      if (value) finish(value)
    }
    const finish = (value: string | null) => {
      window.removeEventListener("keydown", onKey, true)
      shortcut.classList.remove("recording")
      if (value) update({ shortcut: value })
      else shortcut.textContent = prettyShortcut(s.shortcut, context.platform)
    }
    window.addEventListener("keydown", onKey, true)
  })
  row(behavior, t.shortcut, shortcut, s.shortcutOk ? t.shortcutNote : t.shortcutBad)
  row(behavior, t.uiLanguage, select("uiLanguage", { auto: t.languages.auto, en: "English", ru: "Русский" }))
  row(behavior, t.language, select("language", { auto: t.languages.auto, ...LANGUAGES }))
  row(behavior, t.hideOnBlur, toggle("hideOnBlur"))
  if (s.hideOnBlur) row(behavior, t.hideDelay, range("hideDelay", 0, 3000, 100, (v) => (v / 1000).toFixed(1) + " " + t.seconds))
  row(behavior, t.launchAtLogin, toggle("launchAtLogin"))
  row(behavior, t.saveHistory, toggle("saveHistory"))

  const actions = section(t.data).appendChild(el("div", "actions"))
  const clear = el("button", "button danger", t.clearHistory)
  clear.addEventListener("click", async () => {
    await window.glimpse.clearHistory()
    clear.textContent = "✓"
  })
  const reset = el("button", "button", t.resetSettings)
  reset.addEventListener("click", () => context.reset())
  actions.append(clear, reset)

  if (context.homepage) {
    const link = el("button", "button", t.source + " ↗")
    link.addEventListener("click", () => window.glimpse.openExternal(context.homepage))
    section(t.about).appendChild(link)
  }
}
