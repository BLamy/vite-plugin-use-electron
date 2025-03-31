import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { ElectronAPI } from '@electron-toolkit/preload'
import fs from 'fs'
import path from 'path'

// Import the GENERATED MainApi interface
import type { MainApi } from '../shared/rpcTree.gen'

// Make the API available on the window object for type checking in renderer
declare global {
  interface Window {
    mainApi?: MainApi;  // Make it optional
    electron: ElectronAPI;
    api: unknown;
  }
}

// Custom APIs for renderer
const api = {}

// Define the IPC channel for emergency use
const IPC_CHANNEL = 'ipc-use-electron';

// Possible locations for the generated bridge file
const possibleBridgePaths = [
  path.join(__dirname, '_generated_preload_bridge.js'),
  path.join(process.cwd(), 'out/preload/_generated_preload_bridge.js'),
  path.join(process.cwd(), 'dist/preload/_generated_preload_bridge.js'),
  path.join(process.cwd(), 'dist-electron/preload/_generated_preload_bridge.js')
];

// Use contextBridge if we're in a secure context
if (process.contextIsolated) {
  try {
    console.log('[Preload] Electron context isolation enabled.')
    
    // Expose electron API safely
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    
    // Try to find and load the generated bridge file
    let bridgeLoaded = false;
    
    for (const bridgePath of possibleBridgePaths) {
      try {
        if (fs.existsSync(bridgePath)) {
          console.log(`[Preload] Loading bridge from: ${bridgePath}`);
          // Execute the bridge file
          require(bridgePath);
          bridgeLoaded = true;
          console.log('[Preload] Bridge loaded successfully.');
          break;
        }
      } catch (error) {
        console.error(`[Preload] Error loading bridge from ${bridgePath}:`, error);
      }
    }

    // If no bridge file was found, create a minimal emergency bridge
    if (!bridgeLoaded) {
      console.warn('[Preload] No bridge loaded. Creating emergency implementation.');
      
      // Create a minimal mainApi object that just throws errors
      const emergencyApi: Partial<MainApi> = {
        getOsInfo: async () => { 
          throw new Error('Bridge not properly generated. Plugin may not be working correctly.'); 
        },
        addNumbers: async () => { 
          throw new Error('Bridge not properly generated. Plugin may not be working correctly.'); 
        },
        riskyOperation: async () => { 
          throw new Error('Bridge not properly generated. Plugin may not be working correctly.'); 
        },
        testMainFunction: async () => { 
          throw new Error('Bridge not properly generated. Plugin may not be working correctly.'); 
        },
        getSystemInfo: async () => { 
          throw new Error('Bridge not properly generated. Plugin may not be working correctly.'); 
        },
        componentTestFunction: async () => { 
          throw new Error('Bridge not properly generated. Plugin may not be working correctly.'); 
        }
      };
      
      contextBridge.exposeInMainWorld('mainApi', emergencyApi);
      console.warn('[Preload] Emergency bridge exposed to window');
    }
  } catch (error) {
    console.error(error)
  }
} else {
  // Fallback without contextBridge - this is less secure
  console.warn('[Preload] Context isolation disabled. Using less secure API exposure.');
  
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  
  // Only create a placeholder for mainApi if it will be populated by the bridge
  // @ts-ignore (define in dts)
  if (possibleBridgePaths.some(p => fs.existsSync(p))) {
    // Create a proxy that handles missing properties gracefully
    window.mainApi = new Proxy({} as MainApi, {
      get: (target, prop) => {
        if (typeof prop === 'string') {
          // Return a function that returns a rejected promise for any function call
          return (...args: any[]) => {
            console.warn(`[Preload Warning] Called window.mainApi.${String(prop)} before bridge is loaded`);
            return Promise.reject(new Error(`MainApi.${String(prop)} is not yet available`));
          };
        }
        return undefined;
      }
    });
    console.log('[Preload] Created mainApi proxy for delayed loading');
  }
}

console.log('[Preload] Script executed.'); 