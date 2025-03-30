
/* vite-plugin-use-electron - Main Process Handlers */
const { ipcMain } = require('electron');
const os = require('node:os');

// Function implementations mapped by ID
const functionImplementations = {
  // Handler for componentTestFunction
  'src/components/SystemInfo.tsx::componentTestFunction': async function(message) {
    try {
      console.log("componentTestFunctsion received:", message);
    await new Promise(resolve => setTimeout(resolve, 50));
    return `Main process received: "${message}" and says hello back!`;
    } catch (error) {
      console.error('[Main Handler] Error in componentTestFunction:', error);
      throw error;
    }
  },
  // Handler for getOsInfo
  'src/actions/main-operations.ts::getOsInfo': async function(detailLevel) {
    try {
      // The magic directive!
    console.log(`[Main Process: getOsInfo] Received detailLevel: ${detailLevel}`);
    const platform = os.platform();
    const arch = os.arch();
    let hostname;
    if (detailLevel > 0) {
        hostname = os.hostname();
    }
    return { platform, arch, hostname };
    } catch (error) {
      console.error('[Main Handler] Error in getOsInfo:', error);
      throw error;
    }
  },
  // Handler for addNumbers
  'src/actions/main-operations.ts::addNumbers': async function(a, b) {
    try {
      console.log(`[Main Process: addNumbers] Adding ${a} and ${b}`);
    return a + b;
    } catch (error) {
      console.error('[Main Handler] Error in addNumbers:', error);
      throw error;
    }
  },
  // Handler for riskyOperation
  'src/actions/main-operations.ts::riskyOperation': async function(shouldFail) {
    try {
      console.log(`[Main Process: riskyOperation] Called with shouldFail=${shouldFail}`);
    if (shouldFail) {
        throw new Error("Operation failed!");
    }
    return "Operation succeeded!";
    } catch (error) {
      console.error('[Main Handler] Error in riskyOperation:', error);
      throw error;
    }
  },
  // Handler for testMainFunction
  'src/actions/main-operations.ts::testMainFunction': async function() {
    try {
      console.log('[Main Process: testMainFunction] Called');
    return "Main process is working!";
    } catch (error) {
      console.error('[Main Handler] Error in testMainFunction:', error);
      throw error;
    }
  }
};

// Setup the shared IPC handler
function setupMainHandlers() {
  console.log('[Main Process] Setting up handlers via ipc-use-electron channel');

  ipcMain.handle('ipc-use-electron', async (_event, functionId, args) => {
    if (!functionId || typeof functionId !== 'string') {
      throw new Error('Invalid function ID');
    }

    const handler = functionImplementations[functionId];
    if (!handler) {
      throw new Error(`Function ${functionId} not found`);
    }

    try {
      // Call the handler with spread arguments
      return await handler(...(args || []));
    } catch (error) {
      console.error(`[Main Handler] Error executing ${functionId}:`, error);
      throw error;
    }
  });

  console.log('[Main Process] Handlers setup complete');
}

// Export the setup function
exports.setupMainHandlers = setupMainHandlers;
