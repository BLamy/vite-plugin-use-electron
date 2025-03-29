import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { ElectronAPI } from '@electron-toolkit/preload'

// Import the GENERATED MainApi interface
import type { MainApi } from '../shared/rpcTree.gen'

// Make the API available on the window object for type checking in renderer
declare global {
  interface Window {
    mainApi: MainApi;
    electron: ElectronAPI;
    api: unknown;
  }
}

// Custom APIs for renderer
const api = {}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    
    // Require the generated bridge code (which performs the contextBridge.exposeInMainWorld)
    // Path is relative to the output directory (dist-electron/preload)
    require('./_generated_preload_bridge.js');
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

console.log('[Preload] Script executed.');
