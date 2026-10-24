export type Theme = "glass" | "midnight" | "paper" | "mono" | "forest"
export type Font = "system" | "mono" | "serif"
export type ErrorCode = "network" | "timeout" | "empty" | "nobox"
export type View = "chat" | "history" | "settings"

export interface Settings {
  shortcut: string
  language: string
  uiLanguage: string
  launchAtLogin: boolean
  hideOnBlur: boolean
  hideDelay: number
  saveHistory: boolean
  theme: Theme
  accent: string
  fontSize: number
  opacity: number
  radius: number
  width: number
  height: number
  font: Font
}

export interface ShownSettings extends Settings {
  shortcutOk: boolean
}

// Answer blocks from extract.ts; `t` is text with only <b>/<i> markup.
export type Block =
  | { k: "p" | "h"; t: string }
  | { k: "li"; t: string; n: number; d: number }
  | { k: "table"; rows: string[][]; head: boolean }
  | { k: "images"; items: { src: string; alt: string }[] }

export interface Source {
  title: string
  url: string
}

export interface Answer {
  blocks: Block[]
  sources: Source[]
}

export type Message =
  | { role: "user"; text: string; image?: string }
  | ({ role: "ai"; pending: boolean; error?: ErrorCode; captcha?: boolean } & Answer)

export interface Chat {
  id: string
  title: string
  messages: Message[]
}

export interface ShownChat extends Chat {
  saved: boolean
  busy: boolean
}

export interface SavedChat extends Chat {
  updated: number
}

export interface ChatSummary {
  id: string
  title: string
  updated: number
  count: number
}

export interface InitData {
  settings: ShownSettings
  chat: ShownChat
  platform: string
  homepage: string
  update: UpdateState | null
}

// An image for the question: `data` goes to Google, `thumb` is kept in the chat.
export interface Attachment {
  data: string
  thumb: string
}

export type UpdateState = { state: "ready"; version: string } | { state: "available"; version: string; url: string }

export interface GlimpseApi {
  init(): Promise<InitData>
  ask(text: string, image?: Attachment): void
  retry(): void
  newChat(): void
  listHistory(): Promise<ChatSummary[]>
  openChat(id: string): void
  removeChat(id: string): Promise<ChatSummary[]>
  clearHistory(): Promise<ChatSummary[]>
  setSettings(patch: Partial<Settings>): Promise<ShownSettings>
  resetSettings(): Promise<ShownSettings>
  expand(value: boolean): void
  hide(): void
  openExternal(url: string): void
  openInBrowser(text?: string): void
  showGoogle(): void
  onChat(callback: (chat: ShownChat) => void): () => void
  onSettings(callback: (settings: ShownSettings) => void): () => void
  onShown(callback: (view: View | null) => void): () => void
  onUpdate(callback: (update: UpdateState) => void): () => void
  installUpdate(): void
  copyImage(data: string): void
  saveImage(data: string, name: string): Promise<boolean>
}

// Result of window.__askGoogle inside the Google page.
export type PageResult =
  | { blocked: true }
  | { found: false }
  | { found: true; md: string; sources: Source[]; expanding: boolean; busy: boolean }
