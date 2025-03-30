"use strict";
const electron = require("electron");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const fs = require("fs");
const icon = path.join(__dirname, "../../resources/icon.png");
let setupMainHandlers;
const possibleHandlerPaths = [
  path.join(__dirname, "_generated_main_handlers.js"),
  path.join(process.cwd(), "out/main/_generated_main_handlers.js"),
  path.join(process.cwd(), "dist/main/_generated_main_handlers.js"),
  path.join(process.cwd(), "dist-electron/main/_generated_main_handlers.js")
];
for (const handlerPath of possibleHandlerPaths) {
  try {
    if (fs.existsSync(handlerPath)) {
      console.log(`[Main Process] Loading handlers from: ${handlerPath}`);
      const handlers = require(handlerPath);
      if (handlers && typeof handlers.setupMainHandlers === "function") {
        setupMainHandlers = handlers.setupMainHandlers;
        console.log(`[Main Process] Successfully loaded handlers from: ${handlerPath}`);
        break;
      }
    }
  } catch (error) {
    console.error(`[Main Process] Failed to load handlers from ${handlerPath}:`, error);
  }
}
if (!setupMainHandlers) {
  console.warn("[Main Process] No handlers loaded. Using emergency implementation.");
  setupMainHandlers = () => {
    console.warn("[Main Process] Emergency handlers in use - functions will return errors");
    electron.ipcMain.handle("ipc-use-electron", async (_event, functionId) => {
      throw new Error(`No handler implemented for ${functionId}. Plugin may not have generated handlers correctly.`);
    });
  };
}
function createWindow() {
  const mainWindow = new electron.BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...process.platform === "linux" ? { icon } : {},
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(() => {
  utils.electronApp.setAppUserModelId("com.electron");
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  electron.ipcMain.on("ping", () => console.log("pong"));
  try {
    setupMainHandlers();
  } catch (error) {
    console.error("Failed to setup main process handlers:", error);
  }
  createWindow();
  electron.app.on("activate", function() {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
