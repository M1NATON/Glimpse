import { app, net } from "electron"
import { spawn } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

// Updates straight from GitHub Releases: the API lists each file with its SHA-256,
// so no extra update manifests are needed next to the installers.

interface Asset {
  name: string
  digest: string | null
  browser_download_url: string
}

interface Release {
  tag_name: string
  draft: boolean
  html_url: string
  assets: Asset[]
}

export interface Found {
  version: string
  page: string
  asset: Asset
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/

function parts(version: string) {
  return VERSION.exec(version)?.slice(1).map(Number) ?? null
}

export function isNewer(candidate: string, current: string) {
  const a = parts(candidate)
  const b = parts(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return false
}

// The file this system installs, by the names electron-builder gives them.
function installerFor(assets: Asset[]) {
  const pattern =
    process.platform === "win32"
      ? /^Glimpse-Setup-[\d.]+\.exe$/
      : process.platform === "darwin"
        ? process.arch === "arm64"
          ? /^Glimpse-[\d.]+-arm64\.dmg$/
          : /^Glimpse-[\d.]+\.dmg$/
        : process.arch === "x64"
          ? /^Glimpse-[\d.]+\.AppImage$/
          : null
  return pattern ? assets.find((asset) => pattern.test(asset.name)) : undefined
}

export async function findUpdate(repo: string): Promise<Found | null> {
  const response = await net.fetch(`https://api.github.com/repos/${repo}/releases?per_page=10`, {
    headers: { Accept: "application/vnd.github+json" },
  })
  if (!response.ok) return null
  const releases = (await response.json()) as Release[]
  const newest = releases
    .filter((release) => !release.draft && isNewer(release.tag_name, app.getVersion()))
    .sort((a, b) => (isNewer(a.tag_name, b.tag_name) ? -1 : 1))[0]
  const asset = newest && installerFor(newest.assets)
  return newest && asset ? { version: newest.tag_name.replace(/^v/, ""), page: newest.html_url, asset } : null
}

// Downloads the installer and checks it against the SHA-256 GitHub reports; nothing unverified is kept.
export async function download(asset: Asset) {
  const expected = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? "")?.[1]
  if (!expected) throw new Error("no checksum")
  const response = await net.fetch(asset.browser_download_url)
  if (!response.ok || !response.body) throw new Error(`download failed: ${response.status}`)
  // A fresh private folder: a fixed name in a shared /tmp could be planted by another user.
  const file = path.join(fs.mkdtempSync(path.join(app.getPath("temp"), "glimpse-update-")), asset.name)
  const hash = crypto.createHash("sha256")
  const out = fs.createWriteStream(file)
  try {
    for await (const chunk of response.body) {
      hash.update(chunk)
      if (!out.write(chunk)) await new Promise<void>((resolve) => out.once("drain", () => resolve()))
    }
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())))
    if (hash.digest("hex") !== expected) throw new Error("checksum mismatch")
    return file
  } catch (error) {
    out.destroy()
    fs.rmSync(file, { force: true })
    throw error
  }
}

// Puts the downloaded version in place; the caller quits the app right after.
export function install(file: string) {
  if (process.platform === "win32") {
    // The NSIS installer closes the running app, installs silently and starts the new one.
    spawn(file, ["/S", "--force-run"], { detached: true, stdio: "ignore" }).unref()
    return
  }
  const current = process.env.APPIMAGE
  if (!current) throw new Error("not an AppImage")
  // Copy next to the old file first, so the final rename is atomic on the same disk.
  const next = `${current}.update`
  fs.copyFileSync(file, next)
  fs.chmodSync(next, 0o755)
  fs.renameSync(next, current)
  fs.rmSync(file, { force: true })
  relaunch([])
}

// Starts Glimpse again once this process has exited. An AppImage runs from a mount
// that disappears on exit, taking Electron's own relauncher with it, so a shell
// outside the image waits until this process is gone (and with it the single-instance
// lock), then starts the image file. It gives up waiting after 30 seconds.
export function relaunch(args: string[]) {
  const image = process.env.APPIMAGE
  if (!image) return app.relaunch({ args })
  const script = 'pid=$1; shift; i=0; while kill -0 "$pid" 2>/dev/null && [ $i -lt 150 ]; do sleep 0.2; i=$((i+1)); done; exec "$0" "$@"'
  spawn("/bin/sh", ["-c", script, image, String(process.pid), ...args], { detached: true, stdio: "ignore" }).unref()
}
