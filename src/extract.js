// Injected into Google results pages by AskGoogle.qml; turns an AI answer into
// blocks (p, h, li, table) with <b>/<i> inline markup, returned JSON-encoded in `md`.
// latest: read the newest AI Mode turn once at least `latest` turns exist.
window.__askGoogle = function (latest) {
  var turns = Array.prototype.slice.call(document.querySelectorAll('[data-scope-id="turn"]'))
  var blocked = /\/sorry\/|captcha/i.test(location.href) || !!document.querySelector('form#captcha-form, #recaptcha')
  if (blocked) return { blocked: true }

  function hidden(e) {
    var s = getComputedStyle(e)
    if (s.display === "none" || s.visibility === "hidden") return true
    if (s.display === "contents") return false
    if (!e.getClientRects().length) return true
    // Screen-reader-only text: clipped down to a pixel or so.
    var box = e.getBoundingClientRect()
    return box.width <= 2 && box.height <= 2 && e.textContent.trim().length > 0
  }
  var root = null, best = 0
  if (latest) {
    if (turns.length < latest) return { found: false }
    root = turns[turns.length - 1]
    if (!root.innerText.trim()) return { found: false }
  } else {
    turns.forEach(function(t) {
      if (hidden(t)) return
      var len = t.innerText.length
      if (len > best) { best = len; root = t }
    })
  }
  if (!root) return { found: false }

  var expand = document.querySelector('[aria-controls="m-x-content"][aria-expanded="false"]')
  if (expand) expand.click()

  var skipTags = { SVG: 1, IMG: 1, SCRIPT: 1, STYLE: 1, BUTTON: 1, NOSCRIPT: 1, H2: 1 }
  function skip(n) {
    var tag = n.tagName.toUpperCase()
    var role = n.getAttribute("role") || ""
    if (skipTags[tag] || hidden(n) || n.classList.contains("notranslate")) return true
    if (role === "heading" && n.getAttribute("aria-level") === "2") return true
    return role === "button" && getComputedStyle(n).display !== "inline"
  }
  function esc(t) { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") }
  function tidy(h) {
    return h.replace(/\s+/g, " ").replace(/ +([.,;:!?»)])/g, "$1").replace(/([«(]) +/g, "$1").trim()
  }
  // Inline content as the small HTML subset Qt StyledText renders: <b> and <i>.
  function inlineHtml(e) {
    var out = ""
    for (var n = e.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { out += esc(n.textContent); continue }
      if (n.nodeType !== 1 || skip(n)) continue
      var tag = n.tagName.toUpperCase()
      var inner = inlineHtml(n)
      if (!inner.trim()) continue
      if (tag === "STRONG" || tag === "B") out += " <b>" + inner.trim() + "</b> "
      else if (tag === "EM" || tag === "I") out += " <i>" + inner.trim() + "</i> "
      else if (/^(DIV|P|UL|OL|LI|TABLE)$/.test(tag)) out += " " + inner + " "
      else out += inner
    }
    return out
  }
  function isHeading(n) {
    return /^H[3-6]$/.test(n.tagName.toUpperCase()) || n.getAttribute("role") === "heading"
  }

  var blocks = [], para = ""
  function flush() {
    var t = tidy(para)
    if (t) blocks.push({ k: "p", t: t })
    para = ""
  }
  function walk(e, depth) {
    for (var n = e.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { para += esc(n.textContent); continue }
      if (n.nodeType !== 1 || skip(n)) continue
      var tag = n.tagName.toUpperCase()
      if (isHeading(n)) {
        flush()
        var h = tidy(esc(n.innerText))
        if (h) blocks.push({ k: "h", t: h })
      } else if (tag === "UL" || tag === "OL") {
        flush()
        var list = n
        var items = Array.prototype.filter.call(n.querySelectorAll("li"), function(li) {
          return li.parentElement.closest("ul, ol") === list && !hidden(li)
        })
        items.forEach(function(li, index) {
          var t = tidy(inlineHtml(li))
          if (t) blocks.push({ k: "li", t: t, n: tag === "OL" ? index + 1 : 0, d: depth })
        })
      } else if (tag === "TABLE") {
        flush()
        var rows = Array.prototype.map.call(n.querySelectorAll("tr"), function(tr) {
          return Array.prototype.map.call(tr.children, function(c) { return tidy(inlineHtml(c)) })
        }).filter(function(r) { return r.join("").length > 0 })
        if (rows.length) blocks.push({ k: "table", rows: rows, head: !!n.querySelector("th") })
      } else if (tag === "STRONG" || tag === "B" || tag === "EM" || tag === "I") {
        var inner = inlineHtml(n).trim()
        if (inner) para += tag === "STRONG" || tag === "B" ? " <b>" + inner + "</b> " : " <i>" + inner + "</i> "
      } else {
        var display = getComputedStyle(n).display
        var block = display === "block" || display === "flex" || display === "grid" || tag === "P"
        if (block) flush()
        walk(n, depth + 1)
        if (block) flush()
      }
    }
  }
  walk(root, 0)
  flush()
  var text = blocks.length ? JSON.stringify(blocks) : ""

  var byHref = {}
  root.querySelectorAll("a[href][aria-label]").forEach(function(a) {
    var href = a.href
    if (/^https:\/\/(support|policies|accounts)\.google\./.test(href)) return
    var label = a.getAttribute("aria-label").trim()
    if (!byHref[href] || label.length > byHref[href].length) byHref[href] = label
  })
  var sources = Object.keys(byHref).map(function(href) { return { title: byHref[href], url: href } })

  var busy = !!root.querySelector('[aria-busy="true"], [data-complete="false"]') ||
    Array.prototype.some.call(document.querySelectorAll('button[aria-label], [role="button"][aria-label]'), function(b) {
      return /^(Остановить|Stop)/.test(b.getAttribute("aria-label")) && b.getClientRects().length > 0
    })
  return { found: true, md: text, sources: sources, expanding: !!expand, busy: busy }
}

// Types a follow-up into the AI Mode box; returns the turn count before sending.
window.__askGoogleSend = function (text) {
  var before = document.querySelectorAll('[data-scope-id="turn"]').length
  var box = Array.prototype.find.call(document.querySelectorAll("textarea"), function(t) { return t.getClientRects().length > 0 })
  if (!box) return -1
  box.focus()
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, text)
  box.dispatchEvent(new Event("input", { bubbles: true }))
  box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }))
  return before
}
