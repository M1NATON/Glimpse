import { contextBridge, ipcRenderer } from "electron"
import type { GlimpseApi } from "../shared/types"

const listen =
  <T>(channel: string) =>
  (callback: (value: T) => void) => {
    const handler = (_event: unknown, value: T) => callback(value)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  }

const api: GlimpseApi = {
  init: () => ipcRenderer.invoke("init"),
  ask: (text, image) => ipcRenderer.send("ask", text, image),
  retry: () => ipcRenderer.send("retry"),
  newChat: () => ipcRenderer.send("new-chat"),
  listHistory: () => ipcRenderer.invoke("history:list"),
  openChat: (id) => ipcRenderer.send("history:open", id),
  removeChat: (id) => ipcRenderer.invoke("history:remove", id),
  clearHistory: () => ipcRenderer.invoke("history:clear"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  resetSettings: () => ipcRenderer.invoke("settings:reset"),
  expand: (value) => ipcRenderer.send("expand", value),
  hide: () => ipcRenderer.send("hide"),
  openExternal: (url) => ipcRenderer.send("open-external", url),
  openInBrowser: (text) => ipcRenderer.send("open-in-browser", text),
  showGoogle: () => ipcRenderer.send("show-google"),
  onChat: listen("chat"),
  onSettings: listen("settings"),
  onShown: listen("shown"),
  onUpdate: listen("update"),
  installUpdate: () => ipcRenderer.send("install-update"),
  copyImage: (data) => ipcRenderer.send("image:copy", data),
  saveImage: (data, name) => ipcRenderer.invoke("image:save", data, name),
}

contextBridge.exposeInMainWorld("glimpse", api)
