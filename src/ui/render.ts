import type { Block } from "../shared/types"

// Builds answer DOM from extract.ts blocks. Text from Google never goes through
// innerHTML: only <b> and <i> are turned into elements, everything else stays text.
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function decode(text: string) {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
}

function inline<T extends HTMLElement>(parent: T, markup: string) {
  const stack: HTMLElement[] = [parent]
  for (const part of markup.split(/(<\/?[bi]>)/)) {
    const target = stack[stack.length - 1]!
    if (part === "<b>" || part === "<i>") stack.push(target.appendChild(el(part === "<b>" ? "b" : "i")))
    else if (part === "</b>" || part === "</i>") stack.length = Math.max(1, stack.length - 1)
    else if (part) target.appendChild(document.createTextNode(decode(part)))
  }
  return parent
}

export function renderBlocks(blocks: Block[]) {
  const root = el("div", "answer")
  let list: HTMLOListElement | HTMLUListElement | null = null
  blocks.forEach((block, index) => {
    if (block.k !== "li") list = null
    if (block.k === "h") {
      root.appendChild(inline(el("h3"), block.t))
    } else if (block.k === "li") {
      const ordered = block.n > 0
      if (!list || (list.tagName === "OL") !== ordered) {
        list = el(ordered ? "ol" : "ul")
        if (list instanceof HTMLOListElement) list.start = block.n
        root.appendChild(list)
      }
      list.appendChild(inline(el("li"), block.t))
    } else if (block.k === "table") {
      const table = el("table")
      block.rows.forEach((row, r) => {
        const tr = el("tr")
        for (const cell of row) tr.appendChild(inline(el(r === 0 && block.head ? "th" : "td"), cell))
        table.appendChild(tr)
      })
      root.appendChild(table)
    } else {
      root.appendChild(inline(el("p", index === 0 ? "lead" : ""), block.t))
    }
  })
  return root
}
