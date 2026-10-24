<p align="center"><img src="build/icon.png" width="96" alt="" /></p>

<h1 align="center">Glimpse</h1>

<p align="center">Google AI answers in a quick floating window, with follow-up questions.<br/>Linux · Windows · macOS</p>

Press a shortcut, type a question, read Google's AI answer right there, and keep asking.
No API keys: Glimpse opens Google's AI Mode in a hidden browser window and shows
the answer in its own clean interface.

## Features

- Spotlight-style bar that grows into a chat when the answer arrives
- Follow-up questions in the same conversation
- Answers keep their structure: headings, lists, tables, bold text, sources
- Themes (Glass, Midnight, Paper, Mono, Forest), accent color, opacity, corners, font, size
- Chat history with search
- Global shortcut, tray icon, start at login
- English and Russian interface

## Install

Download the installer for your system from [Releases](../../releases):

| System | File |
| --- | --- |
| Windows | `Glimpse-Setup-x.y.z.exe` |
| macOS | `Glimpse-x.y.z-arm64.dmg` (Apple silicon) or `Glimpse-x.y.z.dmg` (Intel). Right-click → Open the first time: the app is not notarized |
| Linux | `Glimpse-x.y.z.AppImage` (any distribution: make it executable and run) |

## Use

| Action | Keys |
| --- | --- |
| Open or hide | `Ctrl+Space` (`⌥Space` on macOS), change it in Settings |
| Ask | `Enter` |
| Open the chat in your browser | `Ctrl+Enter` / `⌘↵` |
| New chat | `Ctrl+N` / `⌘N` |
| History | `Ctrl+H` / `⌘H` |
| Settings | `Ctrl+,` / `⌘,` |
| Back / hide | `Esc` |

If Google asks you to confirm you are not a robot, Glimpse shows the Google page:
pass the check once and the answer continues.

### Linux notes

- On Wayland the global shortcut goes through the desktop portal. If your desktop
  does not support it, bind any key in your window manager to run `glimpse`
  (a second launch toggles the window).
- Hyprland users can get a borderless, blurred window that keeps focus while open
  (with `follow_mouse` a mouse move would otherwise hide it) with:

  ```lua
  o.window({ class = "^glimpse$", title = "^Glimpse$" }, { float = true, no_shadow = true, border_size = 0, rounding = 20, stay_focused = true })
  ```

## Build from source

```bash
npm install
npm start          # build and run
npm test           # end-to-end tests against the real app
npm run dist       # build installers for the current system into dist/
```

Written in TypeScript and compiled by `tsc` into `out/`; there is no bundler.

Releases are built by GitHub Actions for all three systems when a `v*` tag is pushed.

## How it works

`src/main/google.ts` keeps a hidden Chromium window on Google's AI Mode page.
`src/page/extract.ts` runs inside that page and turns the answer into simple blocks
(paragraphs, headings, list items, tables). The interface in `src/ui/` draws those
blocks; Google's markup is never inserted as HTML.

If Google changes its page and answers stop appearing, `src/page/extract.ts` is the file to fix.

## Disclaimer

Glimpse is not affiliated with Google. It shows the same answers you would see on
google.com, in your own browser session.

## License

MIT
