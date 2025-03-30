
/* vite-plugin-use-electron - Preload Bridge API */
const { contextBridge, ipcRenderer } = require('electron');
const mainApi = {
  // Bridge for getOsInfo (src/renderer/src/main-operations.ts::getOsInfo)
  getOsInfo: async (...args) => {
    try {
      const result = await ipcRenderer.invoke('ipc-use-electron', 'src/renderer/src/main-operations.ts::getOsInfo', args);
      return result;
    } catch (error) {
      console.error('[Preload Bridge] Error in getOsInfo:', error?.message || error);
      throw error;
    }
  },
  // Bridge for addNumbers (src/renderer/src/main-operations.ts::addNumbers)
  addNumbers: async (...args) => {
    try {
      const result = await ipcRenderer.invoke('ipc-use-electron', 'src/renderer/src/main-operations.ts::addNumbers', args);
      return result;
    } catch (error) {
      console.error('[Preload Bridge] Error in addNumbers:', error?.message || error);
      throw error;
    }
  },
  // Bridge for riskyOperation (src/renderer/src/main-operations.ts::riskyOperation)
  riskyOperation: async (...args) => {
    try {
      const result = await ipcRenderer.invoke('ipc-use-electron', 'src/renderer/src/main-operations.ts::riskyOperation', args);
      return result;
    } catch (error) {
      console.error('[Preload Bridge] Error in riskyOperation:', error?.message || error);
      throw error;
    }
  },
  // Bridge for testMainFunction (src/renderer/src/main-operations.ts::testMainFunction)
  testMainFunction: async (...args) => {
    try {
      const result = await ipcRenderer.invoke('ipc-use-electron', 'src/renderer/src/main-operations.ts::testMainFunction', args);
      return result;
    } catch (error) {
      console.error('[Preload Bridge] Error in testMainFunction:', error?.message || error);
      throw error;
    }
  },
  // Bridge for componentTestFunction (src/renderer/src/components/SystemInfo.tsx::componentTestFunction)
  componentTestFunction: async (...args) => {
    try {
      const result = await ipcRenderer.invoke('ipc-use-electron', 'src/renderer/src/components/SystemInfo.tsx::componentTestFunction', args);
      return result;
    } catch (error) {
      console.error('[Preload Bridge] Error in componentTestFunction:', error?.message || error);
      throw error;
    }
  }
};
contextBridge.exposeInMainWorld('mainApi', mainApi); // Expose the full API object
console.log('[Preload Bridge] mainApi object exposed to window.');
