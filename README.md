<p align="center"><img src="build/icon.png" width="96" alt="" /></p>

<h1 align="center">Glimpse</h1>

<p align="center">Google AI answers in a quick floating window, with follow-up questions.<br/>Linux · Windows · macOS</p>

<p align="center"><a href="../../releases/latest"><b>Download</b></a> · <a href="README.ru.md">Русский</a></p>

<p align="center"><img src="docs/answer.png" width="640" alt="Glimpse showing an answer from Google AI Mode" /></p>

Press a shortcut, type a question, read Google's AI answer right there, and keep asking.
No API keys and no account: Glimpse opens Google's AI Mode in a hidden browser window
and shows the answer in its own clean interface.

## How it looks

A small bar opens over any window. Type and press `Enter`:

<p align="center"><img src="docs/bar.png" width="640" alt="The compact question bar" /></p>

The bar grows into a chat when the answer arrives. Ask follow-ups in the same conversation.

<table>
  <tr>
    <td><img src="docs/history.png" alt="History with search" /></td>
    <td><img src="docs/settings.png" alt="Settings: themes, accent, corners, size" /></td>
    <td><img src="docs/paper.png" alt="The light Paper theme" /></td>
  </tr>
  <tr>
    <td align="center">History with search</td>
    <td align="center">Themes and settings</td>
    <td align="center">Light theme</td>
  </tr>
</table>

## Features

- Spotlight-style bar that grows into a chat; every open starts a new chat
- Follow-up questions in the same conversation
- Ask about an image: paste it with `Ctrl+V` or drop it on the window
- Answers keep their structure: headings, lists, tables, bold text, sources
- Five themes (Glass, Midnight, Paper, Mono, Forest), accent color, opacity, corners, font, size
- Chat history with search
- Global shortcut, tray icon, start at login
- Updates itself on Windows and Linux (AppImage); on macOS it tells you when a new version is out
- English and Russian interface

## Install

Download the file for your system from [Releases](../../releases/latest):

| System | File |
| --- | --- |
| Windows | `Glimpse-Setup-x.y.z.exe` |
| macOS, Apple silicon (M1 and later) | `Glimpse-x.y.z-arm64.dmg` |
| macOS, Intel | `Glimpse-x.y.z.dmg` |
| Linux, any distribution | `Glimpse-x.y.z.AppImage`: `chmod +x`, then run |

- **macOS:** the app is not notarized. The first time, right-click it and choose Open.
  If macOS says the app "is damaged", run `xattr -cr /Applications/Glimpse.app` once.
- **Windows:** SmartScreen may say "Unknown publisher". Choose More info → Run anyway.

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
  (with `follow_mouse` a mouse move would otherwise hide it). Keep Corners in
  Settings at 20px or less, Hyprland's maximum, so the blur matches the window:

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
