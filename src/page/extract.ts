// Injected into Google's AI Mode page. Turns the newest answer into blocks
// (p, h, li, table) whose text carries only <b>/<i> markup, JSON-encoded in `md`.
// This file is a plain script, not a module: it runs as a string in the page.

interface Window {
  __askGoogle(latest: number): unknown
  __askGoogleSend(text: string): number
  __askGoogleSendImage(text: string, dataUrl: string): Promise<number>
}

window.__askGoogle = (latest) => {
  const blocked = /\/sorry\/|captcha/i.test(location.href) || !!document.querySelector("form#captcha-form, #recaptcha")
  if (blocked) return { blocked: true }

  const turns = [...document.querySelectorAll<HTMLElement>('[data-scope-id="turn"]')]
  if (turns.length < latest) return { found: false }
  const root = turns[turns.length - 1]
  if (!root?.innerText.trim()) return { found: false }

  const expand = document.querySelector<HTMLElement>('[aria-controls="m-x-content"][aria-expanded="false"]')
  expand?.click()

  const hidden = (e: Element) => {
    const s = getComputedStyle(e)
    if (s.display === "none" || s.visibility === "hidden") return true
    if (s.display === "contents") return false
    if (!e.getClientRects().length) return true
    // Screen-reader-only text: clipped down to a pixel or so.
    const box = e.getBoundingClientRect()
    return box.width <= 2 && box.height <= 2 && (e.textContent ?? "").trim().length > 0
  }
  const skipTags = new Set(["SVG", "IMG", "SCRIPT", "STYLE", "BUTTON", "NOSCRIPT", "H2"])
  const skip = (n: Element) => {
    const role = n.getAttribute("role") ?? ""
    if (skipTags.has(n.tagName.toUpperCase()) || hidden(n) || n.classList.contains("notranslate")) return true
    if (role === "heading" && n.getAttribute("aria-level") === "2") return true
    return role === "button" && getComputedStyle(n).display !== "inline"
  }
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  // Bold and italic are wrapped in spaces; drop the ones that end up before punctuation.
  const tidy = (h: string) =>
    h
      .replace(/\s+/g, " ")
      .replace(/ +([.,;:!?»)])/g, "$1")
      .replace(/(<\/[bi]>) +([.,;:!?»)]|—(?! ))/g, "$1$2")
      .replace(/ +(<[bi]>[.,;:!?»)])/g, "$1")
      .replace(/([«(]) +/g, "$1")
      .trim()
  const isBold = (tag: string) => tag === "STRONG" || tag === "B"
  const isItalic = (tag: string) => tag === "EM" || tag === "I"
  const wrap = (tag: string, inner: string) => (isBold(tag) ? ` <b>${inner}</b> ` : ` <i>${inner}</i> `)

  const inlineHtml = (e: Element): string => {
    let out = ""
    for (let n = e.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === Node.TEXT_NODE) out += esc(n.textContent ?? "")
      if (!(n instanceof Element) || skip(n)) continue
      const tag = n.tagName.toUpperCase()
      const inner = inlineHtml(n)
      if (!inner.trim()) continue
      if (isBold(tag) || isItalic(tag)) out += wrap(tag, inner.trim())
      else if (/^(DIV|P|UL|OL|LI|TABLE)$/.test(tag)) out += " " + inner + " "
      else out += inner
    }
    return out
  }
  const isHeading = (n: Element) => /^H[3-6]$/.test(n.tagName.toUpperCase()) || n.getAttribute("role") === "heading"

  const blocks: unknown[] = []
  let para = ""
  const flush = () => {
    const t = tidy(para)
    if (t) blocks.push({ k: "p", t })
    para = ""
  }
  const walk = (e: Element, depth: number) => {
    for (let n = e.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === Node.TEXT_NODE) para += esc(n.textContent ?? "")
      if (!(n instanceof HTMLElement) || skip(n)) continue
      const tag = n.tagName.toUpperCase()
      if (isHeading(n)) {
        flush()
        const h = tidy(esc(n.innerText))
        if (h) blocks.push({ k: "h", t: h })
      } else if (tag === "UL" || tag === "OL") {
        flush()
        const list = n
        const items = [...n.querySelectorAll("li")].filter((li) => li.parentElement?.closest("ul, ol") === list && !hidden(li))
        items.forEach((li, index) => {
          const t = tidy(inlineHtml(li))
          if (t) blocks.push({ k: "li", t, n: tag === "OL" ? index + 1 : 0, d: depth })
        })
      } else if (tag === "TABLE") {
        flush()
        const rows = [...n.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => tidy(inlineHtml(c)))).filter((r) => r.join("").length > 0)
        if (rows.length) blocks.push({ k: "table", rows, head: !!n.querySelector("th") })
      } else if (isBold(tag) || isItalic(tag)) {
        const inner = inlineHtml(n).trim()
        if (inner) para += wrap(tag, inner)
      } else {
        const display = getComputedStyle(n).display
        const block = display === "block" || display === "flex" || display === "grid" || tag === "P"
        if (block) flush()
        walk(n, depth + 1)
        if (block) flush()
      }
    }
  }
  walk(root, 0)
  flush()

  // Google embeds its answer's pictures as data URLs; keep a few, after the first paragraph.
  const plain = (html: string) => new DOMParser().parseFromString(html, "text/html").body.textContent ?? ""
  const images = [...root.querySelectorAll("img")]
    .filter((i) => i.naturalWidth >= 150 && i.getBoundingClientRect().width > 40 && /^data:image\/(jpeg|png|webp);base64,/.test(i.currentSrc))
    .slice(0, 4)
    .map((i) => ({ src: i.currentSrc, alt: plain(i.alt).trim() }))
  if (images.length && blocks.length) blocks.splice(1, 0, { k: "images", items: images })

  const byHref = new Map<string, string>()
  root.querySelectorAll<HTMLAnchorElement>("a[href][aria-label]").forEach((a) => {
    if (/^https:\/\/(support|policies|accounts)\.google\./.test(a.href)) return
    const label = (a.getAttribute("aria-label") ?? "").trim()
    if (label.length > (byHref.get(a.href)?.length ?? -1)) byHref.set(a.href, label)
  })
  const sources = [...byHref].map(([url, title]) => ({ title, url }))

  const busy =
    !!root.querySelector('[aria-busy="true"], [data-complete="false"]') ||
    [...document.querySelectorAll('button[aria-label], [role="button"][aria-label]')].some(
      (b) => /^(Остановить|Stop)/.test(b.getAttribute("aria-label") ?? "") && b.getClientRects().length > 0,
    )
  return { found: true, md: blocks.length ? JSON.stringify(blocks) : "", sources, expanding: !!expand, busy }
}

// Types a follow-up into the AI Mode box; returns the turn count before sending.
window.__askGoogleSend = (text) => {
  const before = document.querySelectorAll('[data-scope-id="turn"]').length
  const box = [...document.querySelectorAll("textarea")].find((t) => t.getClientRects().length > 0)
  if (!box) return -1
  box.focus()
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, text)
  box.dispatchEvent(new Event("input", { bubbles: true }))
  // The send button works on every AI Mode page; Enter alone does not on the empty start page.
  const send = [...document.querySelectorAll<HTMLElement>("button[aria-label]")].find(
    (b) => /^(Отправить|Send)/.test(b.getAttribute("aria-label") ?? "") && b.getClientRects().length > 0,
  )
  if (send) send.click()
  else box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }))
  return before
}

// Pastes an image into the AI Mode box the way Ctrl+V does, waits until Google shows
// it as an attachment, then sends the text with it. Returns the turn count before sending.
window.__askGoogleSendImage = async (text, dataUrl) => {
  const box = [...document.querySelectorAll("textarea")].find((t) => t.getClientRects().length > 0)
  if (!box) return -1
  const name = "glimpse-image." + (dataUrl.slice(11, dataUrl.indexOf(";")) || "png")
  // Decoded by hand: Google's content policy may not allow fetching data: URLs.
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (c) => c.charCodeAt(0))
  const file = new File([bytes], name, { type: dataUrl.slice(5, dataUrl.indexOf(";")) })
  const transfer = new DataTransfer()
  transfer.items.add(file)
  box.focus()
  box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }))
  for (let waited = 0; !document.querySelector(`[aria-label="${name}"]`); waited += 200) {
    if (waited > 10000) return -1
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return window.__askGoogleSend(text)
}
