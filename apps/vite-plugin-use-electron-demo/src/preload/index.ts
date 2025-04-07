import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { ElectronAPI } from '@electron-toolkit/preload'
import fs from 'fs'
import path from 'path'

// Make the API available on the window object for type checking in renderer
declare global {
  interface Window {
    electron: ElectronAPI;
    api: unknown;
  }
}



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
    }
  } catch (error) {
    console.error(error)
  }
} else {
  // Fallback without contextBridge - this is less secure
  console.warn('[Preload] Context isolation disabled. Using less secure API exposure.');
  
  window.electron = electronAPI
}

console.log('[Preload] Script executed.'); 