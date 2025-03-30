
/* vite-plugin-use-electron - Preload Bridge API */
const { contextBridge, ipcRenderer } = require('electron');

// Create API object with all main process functions
const mainApi = {
  // Bridge for addNumbers (src/actions/main-operations.ts::addNumbers)
  addNumbers: async (a, b) => {
    try {
      const result = await ipcRenderer.invoke('ipc-use-electron', 'src/actions/main-operations.ts::addNumbers', [a, b]);
      return result;
    } catch (error) {
      console.error('[Preload Bridge] Error in addNumbers:', error?.message || error);
      throw error;
    }
  },

  // Bridge for componentTestFunction (src/components/SystemInfo.tsx::componentTestFunction)
  componentTestFunction: async (message) => {
    try {
      const result = await ipcRenderer.invoke('ipc-use-electron', 'src/components/SystemInfo.tsx::componentTestFunction', [message]);
      return result;
    } catch (error) {
      console.error('[Preload Bridge] Error in componentTestFunction:', error?.message || error);
      throw error;
    }
  },

  // Bridge for getOsInfo (src/actions/main-operations.ts::getOsInfo)
  getOsInfo: async (detailLevel) => {
    try {
      const result = await ipcRenderer.invoke('ipc-use-electron', 'src/actions/main-operations.ts::getOsInfo', [detailLevel]);
      return result;
    } catch (error) {
      console.error('[Preload Bridge] Error in getOsInfo:', error?.message || error);
      throw error;
    }
  },

  // Bridge for riskyOperation (src/actions/main-operations.ts::riskyOperation)
  riskyOperation: async (shouldFail) => {
    try {
      const result = await ipcRenderer.invoke('ipc-use-electron', 'src/actions/main-operations.ts::riskyOperation', [shouldFail]);
      return result;
    } catch (error) {
      console.error('[Preload Bridge] Error in riskyOperation:', error?.message || error);
      throw error;
    }
  },

  // Bridge for testMainFunction (src/actions/main-operations.ts::testMainFunction)
  testMainFunction: async () => {
    try {
      const result = await ipcRenderer.invoke('ipc-use-electron', 'src/actions/main-operations.ts::testMainFunction', []);
      return result;
    } catch (error) {
      console.error('[Preload Bridge] Error in testMainFunction:', error?.message || error);
      throw error;
    }
  }
};

// Safely expose the API to the renderer process
if (typeof contextBridge !== 'undefined' && contextBridge.exposeInMainWorld) {
  // Electron environment - use contextBridge for security
  contextBridge.exposeInMainWorld('mainApi', mainApi);
  console.log('[Preload Bridge] mainApi object exposed to window via contextBridge.');
} else {
  // Fallback for environments without contextBridge
  if (typeof global !== 'undefined') {
    global.mainApi = mainApi;
    console.log('[Preload Bridge] mainApi object exposed to global fallback.');
  }
  
  // Only as a last resort in web-like environments
  if (typeof window !== 'undefined') {
    window.mainApi = mainApi;
    console.log('[Preload Bridge] mainApi object exposed directly to window (less secure).');
  }
}
