import { _electron as electron, chromium, expect, test, type ElectronApplication, type Page } from "@playwright/test"
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const root = path.join(__dirname, "..")
let dataDir: string
let app: ElectronApplication
let page: Page

const savedChat = {
  id: "seed-1",
  title: "Seeded chat",
  updated: Date.now(),
  messages: [
    { role: "user", text: "Seeded chat" },
    { role: "ai", pending: false, blocks: [{ k: "p", t: "Seeded <b>answer</b>" }], sources: [] },
  ],
}

async function launch() {
  app = await electron.launch({ args: [root, `--user-data-dir=${dataDir}`, "--glimpse-x11"] })
  page = await app.firstWindow()
  await expect(page.locator("#input")).toBeVisible()
}

// A second launch is how the shortcut and the tray toggle the window.
function secondLaunch() {
  return new Promise((resolve) => {
    const child = spawn(require("electron") as unknown as string, [root, `--user-data-dir=${dataDir}`, "--glimpse-x11"])
    child.on("exit", resolve)
  })
}

const isVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.title === "Glimpse")!.isVisible())

test.beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glimpse-test-"))
  fs.writeFileSync(path.join(dataDir, "history.json"), JSON.stringify({ chats: [savedChat] }))
  fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ uiLanguage: "en", hideOnBlur: false }))
  await launch()
})

test.afterEach(async () => {
  await app.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test("opens as a compact bar", async () => {
  await expect(page.locator("#input")).toHaveAttribute("placeholder", "Ask Google…")
  await expect(page.locator("#card")).not.toHaveClass(/expanded/)
  await expect(page.locator("#input")).toBeFocused()
})

test("history opens a saved chat and renders only safe markup", async () => {
  await page.keyboard.press("Control+H")
  await expect(page.locator(".history-item")).toHaveCount(1)
  await page.keyboard.press("Enter")
  await expect(page.locator(".answer b")).toHaveText("answer")
  await expect(page.locator("#card")).toHaveClass(/expanded/)
})

test("each open from the shortcut starts a new chat", async () => {
  await page.keyboard.press("Control+H")
  await page.keyboard.press("Enter")
  await expect(page.locator(".message")).toHaveCount(2)
  await page.keyboard.press("Escape")
  await expect.poll(isVisible).toBe(false)
  await secondLaunch()
  await expect.poll(isVisible).toBe(true)
  await expect(page.locator(".message")).toHaveCount(0)
  await expect(page.locator("#card")).not.toHaveClass(/expanded/)
})

test("settings are saved and survive a restart", async () => {
  await page.keyboard.press("Control+,")
  await page.locator(".theme", { hasText: "Paper" }).click()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper")
  await app.close()
  await launch()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper")
  expect(JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8")).theme).toBe("paper")
})

test("a broken settings file falls back to defaults", async () => {
  await app.close()
  fs.writeFileSync(path.join(dataDir, "settings.json"), "{not json")
  await launch()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "glass")
})

// Talks to the real Google. Playwright's own launch sets navigator.webdriver, which
// Google answers with a captcha, so this test starts the app as a user would and
// attaches over DevTools. CI runners get a captcha anyway: local only.
test("answers a real question", async () => {
  test.skip(!!process.env.CI, "Google shows a captcha to CI runners")
  await app.close()
  const child = spawn(require("electron") as unknown as string, [root, `--user-data-dir=${dataDir}`, "--glimpse-x11", "--remote-debugging-port=9339"])
  try {
    await expect.poll(() => fetch("http://127.0.0.1:9339/json/version").then((r) => r.ok, () => false)).toBe(true)
    const browser = await chromium.connectOverCDP("http://127.0.0.1:9339")
    await expect.poll(() => browser.contexts().flatMap((c) => c.pages()).some((p) => p.url().endsWith("ui/index.html"))).toBe(true)
    const ui = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().endsWith("ui/index.html"))!
    await ui.evaluate(() => window.glimpse.ask("what is 2+2"))
    await expect(ui.locator(".message .answer")).toContainText("4", { timeout: 60_000 })
    await expect(ui.locator(".dots")).toHaveCount(0)
    await browser.close()
  } finally {
    child.kill()
  }
  await launch()
})

// Under Playwright's launch Google always wants a captcha, which makes this path testable.
test("hands the captcha to the Google window", async () => {
  test.skip(!!process.env.CI, "needs the real Google")
  await page.locator("#input").fill("what is 2+2")
  await page.keyboard.press("Enter")
  await expect(page.locator(".notice")).toBeVisible({ timeout: 30_000 })
  await expect.poll(isVisible).toBe(false)
  const googleShown = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.title !== "Glimpse" && w.isVisible()))
  await expect.poll(googleShown).toBe(true)
})
