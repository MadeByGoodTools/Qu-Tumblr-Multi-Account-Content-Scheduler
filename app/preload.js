// SPDX-License-Identifier: MPL-2.0
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("queueStudio", {
  chooseImages: () => ipcRenderer.invoke("choose-images"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  saveConnection: (connection) => ipcRenderer.invoke("save-connection", connection),
  connectionStatus: () => ipcRenderer.invoke("connection-status"),
  activateConnection: (id) => ipcRenderer.invoke("activate-connection", id),
  removeConnection: (id) => ipcRenderer.invoke("remove-connection", id),
  availableBrowsers: () => ipcRenderer.invoke("available-browsers"),
  launchAuthBrowser: (browserName, url) =>
    ipcRenderer.invoke("launch-auth-browser", browserName, url),
  beginAuthorization: (id) => ipcRenderer.invoke("begin-authorization", id),
  completeAuthorization: (id, result) => ipcRenderer.invoke("complete-authorization", id, result),
  verifyConnection: (id) => ipcRenderer.invoke("verify-connection", id),
  queueStatus: (id) => ipcRenderer.invoke("queue-status", id),
  calendarPosts: (id) => ipcRenderer.invoke("calendar-posts", id),
  saveQueueTimes: (id, times) => ipcRenderer.invoke("save-queue-times", id, times),
  publishPosts: (id, posts) => ipcRenderer.invoke("publish-posts", id, posts),
  aiSidebarState: () => ipcRenderer.invoke("ai-sidebar-state"),
  setAiSidebarOpen: (open) => ipcRenderer.invoke("ai-sidebar-open", open),
  selectAiProvider: (provider) => ipcRenderer.invoke("ai-sidebar-provider", provider),
  setAiSidebarWidth: (width) => ipcRenderer.invoke("ai-sidebar-width", width),
  setAiSidebarBounds: (bounds) => ipcRenderer.invoke("ai-sidebar-bounds", bounds),
  reloadAiSidebar: () => ipcRenderer.invoke("ai-sidebar-reload"),
  openAiProviderExternal: () => ipcRenderer.invoke("ai-sidebar-open-external")
});
