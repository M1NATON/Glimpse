const THEMES = {
  glass: ["rgb(22 28 44)", "rgb(232 236 245)"],
  midnight: ["rgb(12 13 18)", "rgb(236 237 242)"],
  paper: ["rgb(250 249 246)", "rgb(28 30 36)"],
  mono: ["rgb(0 0 0)", "rgb(255 255 255)"],
  forest: ["rgb(18 30 26)", "rgb(226 238 230)"],
}
const ACCENTS = ["#4dd6c8", "#5b9dff", "#a78bfa", "#f472b6", "#fb923c", "#4ade80"]
const LANGUAGES = { auto: null, en: "English", ru: "Русский", uk: "Українська", de: "Deutsch", fr: "Français", es: "Español", pt: "Português", it: "Italiano", pl: "Polski", tr: "Türkçe", ja: "日本語", "zh-CN": "中文" }

function applyLook(s) {
  const root = document.documentElement
  root.dataset.theme = s.theme
  root.dataset.font = s.font
  root.style.setProperty("--accent", s.accent)
  root.style.setProperty("--opacity", String(s.opacity))
  root.style.setProperty("--radius", s.radius + "px")
  root.style.setProperty("--font-size", s.fontSize + "px")
}

// Turns a keydown into an Electron accelerator such as "Control+Shift+Space".
function accelerator(event, platform) {
  const named = { Space: "Space", Enter: "Enter", Tab: "Tab", Backquote: "`", Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\" }
  let key = named[event.code]
  if (!key && /^Key[A-Z]$/.test(event.code)) key = event.code.slice(3)
  if (!key && /^Digit\d$/.test(event.code)) key = event.code.slice(5)
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

function prettyShortcut(value, platform) {
  if (!value) return "—"
  if (platform !== "darwin") return value.replace(/Control/g, "Ctrl").replace(/\+/g, " + ")
  return value.replace("Command", "⌘").replace("Control", "⌃").replace("Alt", "⌥").replace("Shift", "⇧").replace(/\+/g, "")
}

function buildSettings(container, state, update) {
  const s = state.settings
  container.replaceChildren()

  const section = (title) => {
    const node = el("div", "section")
    node.appendChild(el("h4", "", title))
    container.appendChild(node)
    return node
  }
  const row = (parent, label, control, note) => {
    const node = el("div", "row")
    const text = el("label", "", label)
    if (note) text.appendChild(el("span", "note", note))
    node.append(text, control)
    parent.appendChild(node)
    return node
  }
  const range = (key, min, max, step, format) => {
    const wrap = el("div", "swatches")
    const value = el("span", "", format(s[key]))
    value.style.minWidth = "44px"
    value.style.textAlign = "right"
    value.style.opacity = "0.6"
    const input = el("input")
    Object.assign(input, { type: "range", min, max, step, value: s[key] })
    input.addEventListener("input", () => {
      value.textContent = format(Number(input.value))
      update({ [key]: Number(input.value) }, true)
    })
    input.addEventListener("change", () => update({ [key]: Number(input.value) }))
    wrap.append(input, value)
    return wrap
  }
  const toggle = (key) => {
    const button = el("button", "toggle" + (s[key] ? " on" : ""))
    button.addEventListener("click", () => update({ [key]: !s[key] }))
    return button
  }
  const select = (key, options) => {
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
  for (const [name, [bg, fg]] of Object.entries(THEMES)) {
    const card = el("div", "theme" + (s.theme === name ? " on" : ""))
    card.style.background = bg
    card.style.color = fg
    card.append(el("i"), el("span", "", t.themes[name]))
    card.addEventListener("click", () => update({ theme: name }))
    themes.appendChild(card)
  }
  look.appendChild(themes)

  const swatches = el("div", "swatches")
  for (const color of ACCENTS) {
    const swatch = el("div", "swatch" + (s.accent === color ? " on" : ""))
    swatch.style.background = color
    swatch.addEventListener("click", () => update({ accent: color }))
    swatches.appendChild(swatch)
  }
  const picker = el("input")
  picker.type = "color"
  picker.value = s.accent
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
  const shortcut = el("button", "shortcut" + (s.shortcutOk === false ? " bad" : ""), prettyShortcut(s.shortcut, state.platform))
  shortcut.addEventListener("click", () => {
    shortcut.classList.add("recording")
    shortcut.textContent = t.recording
    const onKey = (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === "Escape") return finish(null)
      const value = accelerator(event, state.platform)
      if (value) finish(value)
    }
    const finish = (value) => {
      window.removeEventListener("keydown", onKey, true)
      shortcut.classList.remove("recording")
      if (value) update({ shortcut: value })
      else shortcut.textContent = prettyShortcut(s.shortcut, state.platform)
    }
    window.addEventListener("keydown", onKey, true)
  })
  row(behavior, t.shortcut, shortcut, s.shortcutOk === false ? t.shortcutBad : t.shortcutNote)
  const languages = { ...LANGUAGES, auto: t.languages.auto }
  row(behavior, t.uiLanguage, select("uiLanguage", { auto: t.languages.auto, en: "English", ru: "Русский" }))
  row(behavior, t.language, select("language", languages))
  row(behavior, t.hideOnBlur, toggle("hideOnBlur"))
  if (s.hideOnBlur) row(behavior, t.hideDelay, range("hideDelay", 0, 3000, 100, (v) => (v / 1000).toFixed(1) + " " + t.seconds))
  row(behavior, t.launchAtLogin, toggle("launchAtLogin"))
  row(behavior, t.saveHistory, toggle("saveHistory"))

  const data = section(t.data)
  const actions = el("div", "actions")
  const clear = el("button", "button danger", t.clearHistory)
  clear.addEventListener("click", async () => {
    await window.glimpse.clearHistory()
    clear.textContent = "✓"
  })
  const reset = el("button", "button", t.resetSettings)
  reset.addEventListener("click", async () => update(await window.glimpse.resetSettings(), false, true))
  actions.append(clear, reset)
  data.appendChild(actions)

  if (state.homepage) {
    const about = section(t.about)
    const link = el("button", "button", t.source + " ↗")
    link.addEventListener("click", () => window.glimpse.openExternal(state.homepage))
    about.appendChild(link)
  }
}
