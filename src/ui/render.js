// Builds answer DOM from extract.js blocks. Text from Google never goes through
// innerHTML: only <b> and <i> are turned into elements, everything else stays text.
function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function decode(text) {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
}

function inline(parent, markup) {
  let target = parent
  const stack = [parent]
  for (const part of String(markup || "").split(/(<\/?[bi]>)/)) {
    if (part === "<b>" || part === "<i>") {
      const node = el(part === "<b>" ? "b" : "i")
      target.appendChild(node)
      stack.push(node)
      target = node
    } else if (part === "</b>" || part === "</i>") {
      if (stack.length > 1) stack.pop()
      target = stack[stack.length - 1]
    } else if (part) {
      target.appendChild(document.createTextNode(decode(part)))
    }
  }
  return parent
}

function renderBlocks(blocks) {
  const root = el("div", "answer")
  let list = null
  blocks.forEach((block, index) => {
    if (block.k !== "li") list = null
    if (block.k === "h") {
      root.appendChild(inline(el("h3"), block.t))
    } else if (block.k === "li") {
      const ordered = block.n > 0
      if (!list || list.ordered !== ordered) {
        list = { node: el(ordered ? "ol" : "ul"), ordered }
        if (ordered) list.node.start = block.n
        root.appendChild(list.node)
      }
      list.node.appendChild(inline(el("li"), block.t))
    } else if (block.k === "table") {
      const table = el("table")
      ;(block.rows || []).forEach((row, r) => {
        const tr = el("tr")
        row.forEach((cell) => tr.appendChild(inline(el(r === 0 && block.head ? "th" : "td"), cell)))
        table.appendChild(tr)
      })
      root.appendChild(table)
    } else {
      root.appendChild(inline(el("p", index === 0 ? "lead" : ""), block.t))
    }
  })
  return root
}
