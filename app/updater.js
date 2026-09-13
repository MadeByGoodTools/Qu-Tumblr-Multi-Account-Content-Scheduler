const { app, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");

function startAutoUpdates(getWindow) {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = console;

  autoUpdater.on("update-downloaded", async (info) => {
    const window = getWindow?.();
    const options = {
      type: "info",
      title: "Qu update ready",
      message: `Qu ${info.version} is ready to install.`,
      detail: "Restart Qu now to finish the update.",
      buttons: ["Restart and update", "Later"],
      defaultId: 0,
      cancelId: 1
    };
    const result = window && !window.isDestroyed()
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
    if (result.response === 0) autoUpdater.quitAndInstall(false, true);
  });

  autoUpdater.on("error", (error) => console.warn("Qu update check failed:", error.message));
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 15_000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

module.exports = { startAutoUpdates };
