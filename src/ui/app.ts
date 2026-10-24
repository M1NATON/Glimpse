import type { Attachment, ChatSummary, Message, Settings, ShownChat, ShownSettings, UpdateState, View } from "../shared/types"
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
let attachment: Attachment | null = null
let pendingUpdate: UpdateState | null = null

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
  $("title").textContent = view === "history" ? t.history : view === "settings" ? t.settings : ""
  input.placeholder = attachment ? t.askAboutImage : chat.messages.length ? t.followUp : t.ask
  const quiet = expanded || input.value || attachment
  // In the compact bar a pending update takes the place of the key hints.
  const updateButton = () => {
    const button = el("button", "update-pill", pendingUpdate!.state === "ready" ? t.updateNow : t.download)
    button.title = pendingUpdate!.state === "ready" ? t.updateReady(pendingUpdate!.version) : t.updateAvailable(pendingUpdate!.version)
    button.addEventListener("click", () => api.installUpdate())
    return [button]
  }
  $("hint").replaceChildren(
    ...(quiet ? [] : pendingUpdate ? updateButton() : t.hintKeys.map(([key, label]) => {
      const hint = el("span")
      hint.append(el("kbd", "", key), label)
      return hint
    })),
  )
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
  if (message.role === "user") {
    const title = el("h2", "message question", message.text)
    if (message.image) {
      const image = el("img", "question-image")
      image.src = message.image
      image.alt = t.image
      title.prepend(image)
    }
    return title
  }
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
  if ((!text && !attachment) || chat.busy) return
  input.value = ""
  if (view !== "chat") setView("chat")
  api.ask(text, attachment ?? undefined)
  attach(null)
}

// ---------- images ----------

// Google gets a copy no larger than 1600px; the chat keeps a small thumbnail.
async function readImage(file: Blob): Promise<Attachment> {
  const bitmap = await createImageBitmap(file)
  const scaled = (max: number, quality: number) => {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) })
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL("image/jpeg", quality)
  }
  const result = { data: scaled(1600, 0.9), thumb: scaled(320, 0.8) }
  bitmap.close()
  return result
}

function attach(next: Attachment | null) {
  attachment = next
  const node = $("attachment")
  node.hidden = !next
  node.replaceChildren()
  if (next) {
    const image = el("img")
    image.src = next.thumb
    image.alt = t.image
    const remove = el("button", "remove", "×")
    remove.title = t.removeImage
    remove.setAttribute("aria-label", t.removeImage)
    remove.addEventListener("click", () => {
      attach(null)
      input.focus()
    })
    node.append(image, remove)
  }
  updateChrome()
}

async function attachFile(file: File | undefined | null) {
  if (!file?.type.startsWith("image/")) return false
  try {
    attach(await readImage(file))
  } catch {
    attach(null)
  }
  input.focus()
  return true
}

// ---------- image viewer ----------

let viewing: { images: HTMLImageElement[]; index: number } | null = null

function iconButton(label: string, path: string, onClick: () => void) {
  const button = el("button", "icon")
  button.title = label
  button.setAttribute("aria-label", label)
  button.innerHTML = `<svg viewBox="0 0 24 24"><path d="${path}" /></svg>`
  button.addEventListener("click", onClick)
  return button
}

function openViewer(images: HTMLImageElement[], index: number) {
  viewing = { images, index }
  drawViewer()
}

function closeViewer() {
  viewing = null
  $("viewer").hidden = true
  input.focus()
}

function stepViewer(step: number) {
  if (!viewing || viewing.images.length < 2) return
  viewing.index = (viewing.index + step + viewing.images.length) % viewing.images.length
  drawViewer()
}

function drawViewer() {
  if (!viewing) return
  const source = viewing.images[viewing.index]!
  const node = $("viewer")
  node.hidden = false
  const image = el("img")
  image.src = source.src
  image.alt = source.alt

  const copy = el("button", "button", t.copy)
  copy.addEventListener("click", () => {
    api.copyImage(source.src)
    copy.textContent = t.copied
  })
  const save = el("button", "button", t.save)
  save.addEventListener("click", async () => {
    if (await api.saveImage(source.src, source.alt || "Glimpse")) save.textContent = t.saved
  })
  const tools = el("div", "tools")
  tools.append(el("span", "caption", source.alt))
  if (viewing.images.length > 1) {
    tools.append(
      iconButton(t.previous, "M15 6l-6 6 6 6", () => stepViewer(-1)),
      el("span", "count", `${viewing.index + 1} / ${viewing.images.length}`),
      iconButton(t.next, "M9 6l6 6-6 6", () => stepViewer(1)),
    )
  }
  tools.append(copy, save, iconButton(t.close, "M6 6l12 12M18 6L6 18", closeViewer))
  node.replaceChildren(image, tools)
}

$("viewer").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeViewer()
})

messagesNode.addEventListener("click", (event) => {
  const image = (event.target as HTMLElement).closest<HTMLImageElement>(".gallery img, .question-image")
  if (!image) return
  const group = image.closest(".gallery")
  openViewer(group ? [...group.querySelectorAll("img")] : [image], group ? [...group.querySelectorAll("img")].indexOf(image) : 0)
})

// ---------- updates ----------

function showUpdate(update: UpdateState) {
  pendingUpdate = update
  updateChrome()
  const node = $("update")
  node.hidden = false
  const ready = update.state === "ready"
  const button = el("button", "button primary", ready ? t.restart : t.download)
  button.addEventListener("click", () => api.installUpdate())
  node.replaceChildren(el("span", "", ready ? t.updateReady(update.version) : t.updateAvailable(update.version)), button)
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
window.addEventListener("paste", async (event) => {
  const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"))
  if (file) {
    event.preventDefault()
    await attachFile(file)
  }
})
window.addEventListener("dragover", (event) => {
  event.preventDefault()
  card.classList.add("dropping")
})
window.addEventListener("dragleave", () => card.classList.remove("dropping"))
window.addEventListener("drop", async (event) => {
  event.preventDefault()
  card.classList.remove("dropping")
  await attachFile(event.dataTransfer?.files[0])
})
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && mod(event)) {
    api.openInBrowser(input.value.trim())
  } else if (event.key === "Enter") {
    ask()
  } else if (event.key === "Backspace" && !input.value && attachment) {
    attach(null)
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
  if (viewing && ["Escape", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.key === "Escape") closeViewer()
    else stepViewer(event.key === "ArrowLeft" ? -1 : 1)
    return
  }
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
if (init.update) showUpdate(init.update)
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
api.onUpdate(showUpdate)
api.onShown((next) => {
  card.style.animation = "none"
  void card.offsetWidth
  card.style.animation = ""
  if (next) setView(next)
  if (next !== "history") input.focus()
})
