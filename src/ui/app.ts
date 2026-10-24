import type { ChatSummary, Message, Settings, ShownChat, ShownSettings, View } from "../shared/types"
import { t, useStrings } from "./i18n.js"
import { el, renderBlocks } from "./render.js"
import { applyLook, buildSettings, type SettingsContext } from "./settings.js"

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const card = $("card")
const input = $<HTMLInputElement>("input")
const messagesNode = $("messages")
const chatView = $("view-chat")
const historySearch = $<HTMLInputElement>("history-search")
const api = window.glimpse

let settings: ShownSettings
let chat: ShownChat
let platform = ""
let homepage = ""
let view: View = "chat"
let history: ChatSummary[] = []
let selected = 0
let rendered: { json: string; node: HTMLElement; role: Message["role"] }[] = []
let pinned = true
let expandedNow = false

const mod = (event: KeyboardEvent) => (platform === "darwin" ? event.metaKey : event.ctrlKey)

function setView(next: View) {
  view = next
  for (const name of ["chat", "history", "settings"]) $("view-" + name).classList.toggle("on", name === next)
  $("btn-history").classList.toggle("active", next === "history")
  $("btn-settings").classList.toggle("active", next === "settings")
  if (next === "history") loadHistory()
  if (next === "settings") drawSettings()
  updateChrome()
}

function updateChrome() {
  const expanded = view !== "chat" || chat.messages.length > 0
  if (expanded !== expandedNow) {
    expandedNow = expanded
    card.classList.toggle("expanded", expanded)
    api.expand(expanded)
  }
  card.classList.toggle("busy", chat.busy)
  $("title").textContent = view === "history" ? t.history : view === "settings" ? t.settings : chat.title
  input.placeholder = chat.messages.length ? t.followUp : t.ask
  $("hint").textContent = expanded || input.value ? "" : t.hintKeys
}

// ---------- chat ----------

function notice(text: string, ...buttons: [string, string, () => void][]) {
  const node = el("div", "notice")
  node.appendChild(el("div", "", text))
  const actions = node.appendChild(el("div", "actions"))
  for (const [label, className, onClick] of buttons) {
    const button = actions.appendChild(el("button", className, label))
    button.addEventListener("click", onClick)
  }
  return node
}

function messageNode(message: Message) {
  if (message.role === "user") return el("div", "message question", message.text)
  const node = el("div", "message")
  if (message.blocks.length) node.appendChild(renderBlocks(message.blocks))
  if (message.captcha) {
    node.appendChild(notice(t.captcha, [t.openCheck, "button primary", () => api.showGoogle()]))
  } else if (message.error && !message.blocks.length) {
    const text = message.error in t.errors ? t.errors[message.error as keyof typeof t.errors] : t.errors.network
    node.appendChild(notice(text, [t.retry, "button primary", () => api.retry()], [t.openBrowser, "button", () => api.openInBrowser()]))
  } else if (message.pending && !message.blocks.length) {
    const dots = node.appendChild(el("div", "dots"))
    dots.append(el("span"), el("span"), el("span"))
  }
  if (!message.pending && message.sources.length) {
    const sources = el("div", "sources")
    for (const source of message.sources.slice(0, 5)) {
      const chip = sources.appendChild(el("button", "chip", source.title))
      chip.title = source.title
      chip.addEventListener("click", () => api.openExternal(source.url))
    }
    ;(node.firstElementChild ?? node).appendChild(sources)
  }
  return node
}

function renderChat() {
  const messages = chat.messages
  if (messages.length < rendered.length || rendered.some((r, i) => r.role !== messages[i]?.role)) {
    messagesNode.replaceChildren()
    rendered = []
  }
  let newQuestion = false
  messages.forEach((message, index) => {
    const json = JSON.stringify(message)
    const existing = rendered[index]
    if (existing?.json === json) return
    const node = messageNode(message)
    if (existing) {
      node.style.animation = "none"
      existing.node.replaceWith(node)
    } else {
      messagesNode.appendChild(node)
      if (message.role === "user") newQuestion = true
    }
    rendered[index] = { json, node, role: message.role }
  })
  if (newQuestion) pinned = true
  if (pinned) pinLastQuestion()
}

// Keep the newest question at the top so its answer starts in view.
function pinLastQuestion() {
  const questions = messagesNode.querySelectorAll<HTMLElement>(".question")
  const last = questions[questions.length - 1]
  if (last) requestAnimationFrame(() => (chatView.scrollTop = last.offsetTop - 14))
}

function ask() {
  const text = input.value.trim()
  if (!text || chat.busy) return
  input.value = ""
  if (view !== "chat") setView("chat")
  api.ask(text)
}

// ---------- history ----------

async function loadHistory() {
  history = await api.listHistory()
  selected = 0
  historySearch.value = ""
  renderHistory()
  historySearch.focus()
}

function filteredHistory() {
  const query = historySearch.value.trim().toLowerCase()
  return query ? history.filter((c) => c.title.toLowerCase().includes(query)) : history
}

function renderHistory() {
  const list = $("history-list")
  const items = filteredHistory()
  list.replaceChildren()
  if (!items.length) {
    list.appendChild(el("div", "empty", history.length ? t.noMatches : t.noHistory))
    return
  }
  const format = new Intl.DateTimeFormat(document.documentElement.lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
  items.forEach((saved, index) => {
    const item = el("div", "history-item" + (index === selected ? " selected" : ""))
    const text = el("div", "text")
    text.append(el("div", "name", saved.title), el("div", "meta", `${format.format(saved.updated)} · ${t.questions(saved.count)}`))
    const remove = el("button", "icon")
    remove.title = t.remove
    remove.setAttribute("aria-label", t.remove)
    remove.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>'
    remove.addEventListener("click", async (event) => {
      event.stopPropagation()
      history = await api.removeChat(saved.id)
      renderHistory()
    })
    item.append(text, remove)
    item.addEventListener("click", () => openChat(saved.id))
    list.appendChild(item)
  })
  list.children[selected]?.scrollIntoView({ block: "nearest" })
}

function openChat(id: string) {
  api.openChat(id)
  setView("chat")
  input.focus()
}

// ---------- settings ----------

const settingsContext = (): SettingsContext => ({
  settings,
  platform,
  homepage,
  reset: async () => receiveSettings(await api.resetSettings()),
})

function drawSettings() {
  const node = $("view-settings")
  const scroll = node.scrollTop
  buildSettings(node, settingsContext(), updateSettings)
  node.scrollTop = scroll
}

async function updateSettings(patch: Partial<Settings>, live = false) {
  if (live) return applyLook({ ...settings, ...patch })
  receiveSettings(await api.setSettings(patch))
}

function receiveSettings(next: ShownSettings) {
  const languageChanged = settings?.uiLanguage !== next.uiLanguage
  settings = next
  applyLook(next)
  if (languageChanged) {
    useStrings(next.uiLanguage)
    relabel()
    messagesNode.replaceChildren()
    rendered = []
    renderChat()
    updateChrome()
  }
  if (view === "settings") drawSettings()
}

// ---------- wiring ----------

function relabel() {
  for (const [id, key] of [["btn-new", "newChat"], ["btn-history", "history"], ["btn-settings", "settings"], ["btn-close", "close"]] as const) {
    $(id).title = t[key]
    $(id).setAttribute("aria-label", t[key])
  }
  historySearch.placeholder = t.searchHistory
}

$("btn-new").addEventListener("click", () => {
  api.newChat()
  setView("chat")
  input.focus()
})
$("btn-history").addEventListener("click", () => setView(view === "history" ? "chat" : "history"))
$("btn-settings").addEventListener("click", () => setView(view === "settings" ? "chat" : "settings"))
$("btn-close").addEventListener("click", () => api.hide())

chatView.addEventListener("wheel", () => (pinned = false), { passive: true })
historySearch.addEventListener("input", () => {
  selected = 0
  renderHistory()
})
historySearch.addEventListener("keydown", (event) => {
  const items = filteredHistory()
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault()
    selected = Math.max(0, Math.min(items.length - 1, selected + (event.key === "ArrowDown" ? 1 : -1)))
    renderHistory()
  } else if (event.key === "Enter") {
    const item = items[selected]
    if (item) openChat(item.id)
  }
})

input.addEventListener("input", updateChrome)
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && mod(event)) {
    api.openInBrowser(input.value.trim())
  } else if (event.key === "Enter") {
    ask()
  } else if (event.key === "PageDown" || event.key === "PageUp") {
    pinned = false
    chatView.scrollBy({ top: (event.key === "PageDown" ? 1 : -1) * chatView.clientHeight * 0.85, behavior: "smooth" })
  } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !input.value) {
    pinned = false
    chatView.scrollBy({ top: event.key === "ArrowDown" ? 120 : -120, behavior: "smooth" })
  } else {
    return
  }
  event.preventDefault()
})

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (document.querySelector(".shortcut.recording")) return
    if (view !== "chat") setView("chat")
    else if (input.value) input.value = ""
    else api.hide()
    updateChrome()
    input.focus()
  } else if (mod(event) && event.key.toLowerCase() === "n") {
    $("btn-new").click()
  } else if (mod(event) && event.key.toLowerCase() === "h") {
    $("btn-history").click()
  } else if (mod(event) && event.key === ",") {
    $("btn-settings").click()
  } else {
    return
  }
  event.preventDefault()
})

const init = await api.init()
platform = init.platform
homepage = init.homepage
chat = init.chat
receiveSettings(init.settings)
renderChat()
updateChrome()
input.focus()

api.onChat((next) => {
  if (chat.id !== next.id) {
    messagesNode.replaceChildren()
    rendered = []
  }
  chat = next
  renderChat()
  updateChrome()
})
api.onSettings(receiveSettings)
api.onShown((next) => {
  card.style.animation = "none"
  void card.offsetWidth
  card.style.animation = ""
  if (next) setView(next)
  if (next !== "history") input.focus()
})
