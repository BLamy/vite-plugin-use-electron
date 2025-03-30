"use strict";
const electron = require("electron");
const preload = require("@electron-toolkit/preload");
const fs = require("fs");
const path = require("path");
const api = {};
const possibleBridgePaths = [
  path.join(__dirname, "_generated_preload_bridge.js"),
  path.join(process.cwd(), "out/preload/_generated_preload_bridge.js"),
  path.join(process.cwd(), "dist/preload/_generated_preload_bridge.js"),
  path.join(process.cwd(), "dist-electron/preload/_generated_preload_bridge.js")
];
if (process.contextIsolated) {
  try {
    console.log("[Preload] Electron context isolation enabled.");
    electron.contextBridge.exposeInMainWorld("electron", preload.electronAPI);
    electron.contextBridge.exposeInMainWorld("api", api);
    let bridgeLoaded = false;
    for (const bridgePath of possibleBridgePaths) {
      try {
        if (fs.existsSync(bridgePath)) {
          console.log(`[Preload] Loading bridge from: ${bridgePath}`);
          require(bridgePath);
          bridgeLoaded = true;
          console.log("[Preload] Bridge loaded successfully.");
          break;
        }
      } catch (error) {
        console.error(`[Preload] Error loading bridge from ${bridgePath}:`, error);
      }
    }
    if (!bridgeLoaded) {
      console.warn("[Preload] No bridge loaded. Creating emergency implementation.");
      const emergencyApi = {
        getOsInfo: async () => {
          throw new Error("Bridge not properly generated. Plugin may not be working correctly.");
        },
        addNumbers: async () => {
          throw new Error("Bridge not properly generated. Plugin may not be working correctly.");
        },
        riskyOperation: async () => {
          throw new Error("Bridge not properly generated. Plugin may not be working correctly.");
        },
        testMainFunction: async () => {
          throw new Error("Bridge not properly generated. Plugin may not be working correctly.");
        },
        getSystemInfo: async () => {
          throw new Error("Bridge not properly generated. Plugin may not be working correctly.");
        },
        componentTestFunction: async () => {
          throw new Error("Bridge not properly generated. Plugin may not be working correctly.");
        }
      };
      electron.contextBridge.exposeInMainWorld("mainApi", emergencyApi);
      console.warn("[Preload] Emergency bridge exposed to window");
    }
  } catch (error) {
    console.error(error);
  }
} else {
  console.warn("[Preload] Context isolation disabled. Using less secure API exposure.");
  window.electron = preload.electronAPI;
  window.api = api;
  if (possibleBridgePaths.some((p) => fs.existsSync(p))) {
    window.mainApi = new Proxy({}, {
      get: (target, prop) => {
        if (typeof prop === "string") {
          return (...args) => {
            console.warn(`[Preload Warning] Called window.mainApi.${String(prop)} before bridge is loaded`);
            return Promise.reject(new Error(`MainApi.${String(prop)} is not yet available`));
          };
        }
        return void 0;
      }
    });
    console.log("[Preload] Created mainApi proxy for delayed loading");
  }
}
console.log("[Preload] Script executed.");
