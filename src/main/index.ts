import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import fs from 'fs'
import path from 'path'

// Setup main handlers - try to load the generated file
let setupMainHandlers: () => void;

// Possible locations for the generated handlers file
const possibleHandlerPaths = [
  join(__dirname, '_generated_main_handlers.js'),
  join(process.cwd(), 'out/main/_generated_main_handlers.js'),
  join(process.cwd(), 'dist/main/_generated_main_handlers.js'),
  join(process.cwd(), 'dist-electron/main/_generated_main_handlers.js')
];

// Load handlers from the first available path
for (const handlerPath of possibleHandlerPaths) {
  try {
    if (fs.existsSync(handlerPath)) {
      console.log(`[Main Process] Loading handlers from: ${handlerPath}`);
      const handlers = require(handlerPath);
      
      if (handlers && typeof handlers.setupMainHandlers === 'function') {
        setupMainHandlers = handlers.setupMainHandlers;
        console.log(`[Main Process] Successfully loaded handlers from: ${handlerPath}`);
        break;
      }
    }
  } catch (error) {
    console.error(`[Main Process] Failed to load handlers from ${handlerPath}:`, error);
  }
}

// If no handlers were loaded, provide a basic emergency handler
if (!setupMainHandlers) {
  console.warn('[Main Process] No handlers loaded. Using emergency implementation.');
  setupMainHandlers = () => {
    console.warn('[Main Process] Emergency handlers in use - functions will return errors');
    ipcMain.handle('ipc-use-main', async (_event, functionId) => {
      throw new Error(`No handler implemented for ${functionId}. Plugin may not have generated handlers correctly.`);
    });
  };
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  try {
    setupMainHandlers(); // Call the setup function
  } catch (error) {
    console.error("Failed to setup main process handlers:", error);
  }

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
