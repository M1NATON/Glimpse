const { contextBridge, ipcRenderer } = require("electron")

const listen = (channel) => (callback) => {
  const handler = (_event, value) => callback(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld("glimpse", {
  init: () => ipcRenderer.invoke("init"),
  ask: (text) => ipcRenderer.send("ask", text),
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
})
