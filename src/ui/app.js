const $ = (id) => document.getElementById(id)
const card = $("card")
const input = $("input")
const messagesNode = $("messages")
const chatView = $("view-chat")

const state = { settings: null, chat: null, view: "chat", platform: "", history: [], selected: 0 }
let rendered = []
let pinned = true
let expandedNow = false

const mod = (event) => (state.platform === "darwin" ? event.metaKey : event.ctrlKey)

function setView(view) {
  state.view = view
  for (const name of ["chat", "history", "settings"]) {
    $("view-" + name).classList.toggle("on", name === view)
  }
  $("btn-history").classList.toggle("active", view === "history")
  $("btn-settings").classList.toggle("active", view === "settings")
  if (view === "history") loadHistory()
  if (view === "settings") buildSettings($("view-settings"), state, updateSettings)
  updateChrome()
}

function updateChrome() {
  const chat = state.chat
  const expanded = state.view !== "chat" || chat.messages.length > 0
  if (expanded !== expandedNow) {
    expandedNow = expanded
    card.classList.toggle("expanded", expanded)
    window.glimpse.expand(expanded)
  }
  card.classList.toggle("busy", Boolean(chat.busy))
  $("title").textContent = state.view === "history" ? t.history : state.view === "settings" ? t.settings : chat.title
  input.placeholder = chat.messages.length ? t.followUp : t.ask
  $("hint").textContent = expanded || input.value ? "" : t.hintKeys
}

// ---------- chat ----------

function messageNode(message) {
  if (message.role === "user") return el("div", "message question", message.text)
  const node = el("div", "message")
  if (message.blocks?.length) node.appendChild(renderBlocks(message.blocks))
  if (message.captcha) {
    const notice = el("div", "notice", "")
    notice.appendChild(el("div", "", t.captcha))
    const button = el("button", "button primary", t.openCheck)
    button.addEventListener("click", () => window.glimpse.showGoogle())
    notice.appendChild(button)
    node.appendChild(notice)
  } else if (message.error && !message.blocks?.length) {
    const notice = el("div", "notice")
    notice.appendChild(el("div", "", t.errors[message.error] || t.errors.network))
    const actions = el("div", "actions")
    const retry = el("button", "button primary", t.retry)
    retry.addEventListener("click", () => window.glimpse.retry())
    const browser = el("button", "button", t.openBrowser)
    browser.addEventListener("click", () => window.glimpse.openInBrowser())
    actions.append(retry, browser)
    notice.appendChild(actions)
    node.appendChild(notice)
  } else if (message.pending && !message.blocks?.length) {
    const dots = el("div", "dots")
    dots.append(el("span"), el("span"), el("span"))
    node.appendChild(dots)
  }
  if (!message.pending && message.sources?.length) {
    const sources = el("div", "sources")
    for (const source of message.sources.slice(0, 5)) {
      const chip = el("button", "chip", source.title)
      chip.title = source.title
      chip.addEventListener("click", () => window.glimpse.openExternal(source.url))
      sources.appendChild(chip)
    }
    node.firstChild?.appendChild(sources) || node.appendChild(sources)
  }
  return node
}

function renderChat() {
  const messages = state.chat.messages
  if (messages.length < rendered.length || rendered.some((r, i) => r.message.role !== messages[i]?.role)) {
    messagesNode.replaceChildren()
    rendered = []
  }
  let newQuestion = null
  messages.forEach((message, index) => {
    const json = JSON.stringify(message)
    const existing = rendered[index]
    if (existing && existing.json === json) return
    const node = messageNode(message)
    if (existing) {
      node.style.animation = "none"
      existing.node.replaceWith(node)
    } else {
      messagesNode.appendChild(node)
      if (message.role === "user") newQuestion = node
    }
    rendered[index] = { message, json, node }
  })
  if (newQuestion) pinned = true
  if (pinned) pinLastQuestion()
}

// Keep the newest question at the top so its answer starts in view.
function pinLastQuestion() {
  const questions = messagesNode.querySelectorAll(".question")
  const last = questions[questions.length - 1]
  if (last) requestAnimationFrame(() => (chatView.scrollTop = last.offsetTop - 14))
}

chatView.addEventListener("wheel", () => (pinned = false), { passive: true })

function ask() {
  const text = input.value.trim()
  if (!text || state.chat.busy) return
  input.value = ""
  if (state.view !== "chat") setView("chat")
  window.glimpse.ask(text)
}

// ---------- history ----------

async function loadHistory() {
  state.history = await window.glimpse.listHistory()
  state.selected = 0
  $("history-search").value = ""
  renderHistory()
  $("history-search").focus()
}

function filteredHistory() {
  const query = $("history-search").value.trim().toLowerCase()
  return query ? state.history.filter((c) => c.title.toLowerCase().includes(query)) : state.history
}

function renderHistory() {
  const list = $("history-list")
  const items = filteredHistory()
  list.replaceChildren()
  if (!items.length) {
    list.appendChild(el("div", "empty", state.history.length ? t.noMatches : t.noHistory))
    return
  }
  const format = new Intl.DateTimeFormat(document.documentElement.lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
  items.forEach((chat, index) => {
    const item = el("div", "history-item" + (index === state.selected ? " selected" : ""))
    const text = el("div", "text")
    text.append(el("div", "name", chat.title), el("div", "meta", `${format.format(chat.updated)} · ${t.questions(chat.count)}`))
    const remove = el("button", "icon")
    remove.title = t.remove
    remove.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>'
    remove.addEventListener("click", async (event) => {
      event.stopPropagation()
      state.history = await window.glimpse.removeChat(chat.id)
      renderHistory()
    })
    item.append(text, remove)
    item.addEventListener("click", () => openChat(chat.id))
    list.appendChild(item)
  })
  list.children[state.selected]?.scrollIntoView({ block: "nearest" })
}

function openChat(id) {
  window.glimpse.openChat(id)
  setView("chat")
  input.focus()
}

$("history-search").addEventListener("input", () => {
  state.selected = 0
  renderHistory()
})
$("history-search").addEventListener("keydown", (event) => {
  const items = filteredHistory()
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault()
    const step = event.key === "ArrowDown" ? 1 : -1
    state.selected = Math.max(0, Math.min(items.length - 1, state.selected + step))
    renderHistory()
  } else if (event.key === "Enter" && items[state.selected]) {
    openChat(items[state.selected].id)
  }
})

// ---------- settings ----------

async function updateSettings(patch, live, replace) {
  if (live) {
    applyLook({ ...state.settings, ...patch })
    return
  }
  const previousLanguage = state.settings.uiLanguage
  state.settings = replace ? patch : await window.glimpse.setSettings(patch)
  applyLook(state.settings)
  if (state.settings.uiLanguage !== previousLanguage) {
    t = pickStrings(state.settings.uiLanguage)
    document.documentElement.lang = state.settings.uiLanguage !== "auto" ? state.settings.uiLanguage : (navigator.language || "en").slice(0, 2)
    relabel()
    messagesNode.replaceChildren()
    rendered = []
    renderChat()
    updateChrome()
  }
  const view = $("view-settings")
  const scroll = view.scrollTop
  buildSettings(view, state, updateSettings)
  view.scrollTop = scroll
}

// ---------- wiring ----------

$("btn-new").addEventListener("click", () => {
  window.glimpse.newChat()
  setView("chat")
  input.focus()
})
$("btn-history").addEventListener("click", () => setView(state.view === "history" ? "chat" : "history"))
$("btn-settings").addEventListener("click", () => setView(state.view === "settings" ? "chat" : "settings"))
$("btn-close").addEventListener("click", () => window.glimpse.hide())
function relabel() {
  for (const [id, key] of [["btn-new", "newChat"], ["btn-history", "history"], ["btn-settings", "settings"], ["btn-close", "close"]]) {
    $(id).title = t[key]
  }
  $("history-search").placeholder = t.searchHistory
}

input.addEventListener("input", updateChrome)
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && mod(event)) {
    window.glimpse.openInBrowser(input.value.trim())
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
    if (state.view !== "chat") setView("chat")
    else if (input.value) input.value = ""
    else window.glimpse.hide()
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

window.glimpse.onChat((chat) => {
  const changedChat = state.chat?.id !== chat.id
  state.chat = chat
  if (changedChat) {
    messagesNode.replaceChildren()
    rendered = []
  }
  renderChat()
  updateChrome()
})
window.glimpse.onSettings((settings) => {
  state.settings = settings
  applyLook(settings)
  if (state.view === "settings") buildSettings($("view-settings"), state, updateSettings)
})
window.glimpse.onShown((view) => {
  card.style.animation = "none"
  void card.offsetWidth
  card.style.animation = ""
  if (view) setView(view)
  if (view !== "history") input.focus()
})

window.glimpse.init().then(({ settings, chat, platform, homepage }) => {
  state.homepage = homepage
  t = pickStrings(settings.uiLanguage)
  relabel()
  state.settings = settings
  state.chat = chat
  state.platform = platform
  document.documentElement.lang = settings.uiLanguage !== "auto" ? settings.uiLanguage : (navigator.language || "en").slice(0, 2)
  applyLook(settings)
  renderChat()
  updateChrome()
  input.focus()
})
