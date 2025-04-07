// use-electron.spec.ts (Corrected v3)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { useElectronMainPlugin } from '../use-electron';
import os from 'os';
// Use general Plugin type, remove specific PluginContext
import type { Plugin, ResolvedConfig } from 'vite';

// Constants (remain the same)
const TEST_TEMP_DIR = path.join(os.tmpdir(), 'vite-plugin-use-electron-test');
const MOCK_ROOT_DIR = path.join(TEST_TEMP_DIR, 'mock-project');
const MOCK_OUT_MAIN = path.join(MOCK_ROOT_DIR, 'out/main');
const MOCK_OUT_PRELOAD = path.join(MOCK_ROOT_DIR, 'out/preload');
const MOCK_MANIFEST_DIR = path.join(MOCK_ROOT_DIR, 'node_modules/.vite-plugin-use-electron');
const MOCK_MANIFEST_PATH = path.join(MOCK_MANIFEST_DIR, 'use-electron-manifest.json');

// Mock files (remain the same)
const mockFiles = {
  mainOperations: {
    path: 'src/renderer/src/main-operations.ts',
    content: `
import os from 'os'; // <-- Should be treeshaken from renderer bundle
import fs from 'fs'; // <-- Should be treeshaken from renderer bundle
import crypto from 'crypto'; // <-- Should REMAIN if used elsewhere

/**
 * Gets basic OS information.
 */
export async function getOsInfo(detailLevel: number) {
    "use electron"; // The magic directive!
    console.log(\`[Main Process: getOsInfo] Received detailLevel: \${detailLevel}\`);
    const platform = os.platform();
    const arch = os.arch();
    let hostname: string | undefined;
    if (detailLevel > 0) {
        hostname = os.hostname();
    }
    return { 
      platform, 
      arch, 
      hostname
    };
}

/**
 * Simple addition in the main process.
 */
export async function addNumbers(a: number, b: number): Promise<number> {
    "use electron";
    console.log(\`[Main Process: addNumbers] Adding \${a} and \${b}\`);
    return a + b;
}

/**
 * Example function that might throw an error.
 */
export async function riskyOperation(shouldFail: boolean): Promise<string> {
    "use electron";
    console.log(\`[Main Process: riskyOperation] Called with shouldFail=\${shouldFail}\`);
    if (shouldFail) {
        throw new Error("Operation failed as requested!");
    }
    return "Operation succeeded!";
}

/**
 * Simple test function to verify "use electron" is working
 */
export async function testMainFunction(): Promise<string> {
    "use electron";
    console.log('[Main Process: testMainFunction] Called');
    return "Main process is working!";
}

/**
 * Reads a file size (uses fs).
 */
export async function getFileSize(filePath: string): Promise<number> {
    "use electron";
    console.log(\`[Main Process: getFileSize] Reading size of: \${filePath}\`);
    // Use fs promises API
    const stats = await fs.promises.stat(filePath);
    return stats.size;
}

// Function NOT using "use electron" - its imports should remain
export function generateHash(data: string): string {
    const hash = crypto.createHash('sha256');
    hash.update(data);
    return hash.digest('hex');
}
    `
  },
  systemInfo: {
    path: 'src/renderer/src/components/SystemInfo.tsx',
    content: `
import React from 'react'; // <-- Should remain
import { useQuery } from '@tanstack/react-query'; // <-- Should remain
import { getOsInfo, generateHash } from '@renderer/main-operations'; // <-- Should remain (or be adjusted by plugin)

// Component test function
async function componentTestFunction(message: string): Promise<string> {
    "use electron";
    console.log("componentTestFunction received:", message);
    await new Promise(resolve => setTimeout(resolve, 50)); // Uses built-in Promise, no import needed usually
    return \`Main process received: "\${message}" and says hello back!\`;
}

export default function SystemInfo() {
  const { data: osInfo } = useQuery({ queryKey: ['osInfo'], queryFn: () => getOsInfo(1) });
  const hash = generateHash('some data'); // Uses a non-"use electron" function
  // Component implementation...
  return (
      <div>
          <p>OS: {osInfo?.platform} ({osInfo?.arch})</p>
          <p>Hostname: {osInfo?.hostname}</p>
          <p>Hash: {hash}</p>
      </div>
  );
}
    `
  }
};

// *** UPDATED EXPECTED HANDLERS *** (Sorted, includes 'fs' require)
const EXPECTED_HANDLERS_FILE = `
/* vite-plugin-use-electron - Main Process Handlers */
const { ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');

// Function implementations mapped by ID
const functionImplementations = {
  // Handler for componentTestFunction (src/renderer/src/components/SystemInfo.tsx::componentTestFunction)
  'src/renderer/src/components/SystemInfo.tsx::componentTestFunction': async function(message) {
    try {
      console.log("componentTestFunction received:", message);
      await new Promise(resolve => setTimeout(resolve, 50));
      return \`Main process received: "\${message}" and says hello back!\`;
    } catch (error) {
      console.error('[Main Handler] Error in componentTestFunction (src/renderer/src/components/SystemInfo.tsx::componentTestFunction):', error);
      throw error;
    }
  },
  // Handler for addNumbers (src/renderer/src/main-operations.ts::addNumbers)
  'src/renderer/src/main-operations.ts::addNumbers': async function(a, b) {
    try {
      console.log(\`[Main Process: addNumbers] Adding \${a} and \${b}\`);
      return a + b;
    } catch (error) {
      console.error('[Main Handler] Error in addNumbers (src/renderer/src/main-operations.ts::addNumbers):', error);
      throw error;
    }
  },
  // Handler for getFileSize (src/renderer/src/main-operations.ts::getFileSize)
  'src/renderer/src/main-operations.ts::getFileSize': async function(filePath) {
    try {
      console.log(\`[Main Process: getFileSize] Reading size of: \${filePath}\`);
      const stats = await fs.promises.stat(filePath);
      return stats.size;
    } catch (error) {
      console.error('[Main Handler] Error in getFileSize (src/renderer/src/main-operations.ts::getFileSize):', error);
      throw error;
    }
  },
  // Handler for getOsInfo (src/renderer/src/main-operations.ts::getOsInfo)
  'src/renderer/src/main-operations.ts::getOsInfo': async function(detailLevel) {
    try {
      console.log(\`[Main Process: getOsInfo] Received detailLevel: \${detailLevel}\`);
      const platform = os.platform();
      const arch = os.arch();
      let hostname;
      if (detailLevel > 0) {
          hostname = os.hostname();
      }
      return {
        platform,
        arch,
        hostname
      };
    } catch (error) {
      console.error('[Main Handler] Error in getOsInfo (src/renderer/src/main-operations.ts::getOsInfo):', error);
      throw error;
    }
  },
  // Handler for riskyOperation (src/renderer/src/main-operations.ts::riskyOperation)
  'src/renderer/src/main-operations.ts::riskyOperation': async function(shouldFail) {
    try {
      console.log(\`[Main Process: riskyOperation] Called with shouldFail=\${shouldFail}\`);
      if (shouldFail) {
          throw new Error("Operation failed as requested!");
      }
      return "Operation succeeded!";
    } catch (error) {
      console.error('[Main Handler] Error in riskyOperation (src/renderer/src/main-operations.ts::riskyOperation):', error);
      throw error;
    }
  },
  // Handler for testMainFunction (src/renderer/src/main-operations.ts::testMainFunction)
  'src/renderer/src/main-operations.ts::testMainFunction': async function() {
    try {
      console.log('[Main Process: testMainFunction] Called');
      return "Main process is working!";
    } catch (error) {
      console.error('[Main Handler] Error in testMainFunction (src/renderer/src/main-operations.ts::testMainFunction):', error);
      throw error;
    }
  }
};

// Setup the shared IPC handler
function setupMainHandlers() {
  if (typeof ipcMain === 'undefined' || !ipcMain.handle) {
      console.error('[Main Handler] Error: ipcMain.handle is not available. This code must run in the Electron main process.');
      return;
  }
  const handlerCount = Object.keys(functionImplementations).length;
  console.log(\`[Main Process] Setting up \${handlerCount} handlers via 'ipc-use-electron' channel\`);

  ipcMain.handle('ipc-use-electron', async (event, functionId, args) => {
    if (!functionId || typeof functionId !== 'string') {
      console.error('[Main Handler] Received invalid or missing function ID.');
      throw new Error('Invalid function ID provided.');
    }
    const handler = functionImplementations[functionId];
    if (!handler) {
      console.error(\`[Main Handler] Function '\${functionId}' not found. Available: \${Object.keys(functionImplementations).join(', ')}\`);
      throw new Error(\`Function '\${functionId}' not found in main process handlers.\`);
    }
    if (!Array.isArray(args)) {
        console.warn(\`[Main Handler] Received non-array arguments for '\${functionId}'. Using empty array. Received:\`, args);
        args = [];
    }
    try {
      const result = await handler(...args);
      return result;
    } catch (error) {
      console.error(\`[Main Handler] Error executing '\${functionId}':\`, error);
      throw error;
    }
  });

  console.log('[Main Process] Handlers setup complete.');
}

// Export the setup function
exports.setupMainHandlers = setupMainHandlers;
`.trim();

// *** UPDATED EXPECTED PRELOAD BRIDGE *** (Sorted, includes getFileSize)
const EXPECTED_PRELOAD_BRIDGE = `
/* vite-plugin-use-electron - Preload Bridge API */
const { contextBridge, ipcRenderer } = require('electron');

// Create API object with all main process functions
const mainApi = {
  // Bridge for addNumbers (src/renderer/src/main-operations.ts::addNumbers)
  addNumbers: async (a, b) => {
    try {
      const result = await ipcRenderer.invoke('ipc-use-electron', 'src/renderer/src/main-operations.ts::addNumbers', [a, b]);
      return result;
    } catch (error) {
      console.error('[Preload Bridge] Error invoking addNumbers (src/renderer/src/main-operations.ts::addNumbers):', error?.message || error);
      if (error instanceof Error) { throw error; } else { throw new Error(String(error ?? 'Unknown IPC Error')); }
    }
  },
  // Bridge for componentTestFunction (src/renderer/src/components/SystemInfo.tsx::componentTestFunction)
  componentTestFunction: async (message) => {
    try {
      const result = await ipcRenderer.invoke('ipc-use-electron', 'src/renderer/src/components/SystemInfo.tsx::componentTestFunction', [message]);
      return result;
    } catch (error) {
      console.error('[Preload Bridge] Error invoking componentTestFunction (src/renderer/src/components/SystemInfo.tsx::componentTestFunction):', error?.message || error);
      if (error instanceof Error) { throw error; } else { throw new Error(String(error ?? 'Unknown IPC Error')); }
    }
  },
  // Bridge for getFileSize (src/renderer/src/main-operations.ts::getFileSize)
  getFileSize: async (filePath) => {
    try {
      const result = await ipcRenderer.invoke('ipc-use-electron', 'src/renderer/src/main-operations.ts::getFileSize', [filePath]);
      return result;
    } catch (error) {
      console.error('[Preload Bridge] Error invoking getFileSize (src/renderer/src/main-operations.ts::getFileSize):', error?.message || error);
      if (error instanceof Error) { throw error; } else { throw new Error(String(error ?? 'Unknown IPC Error')); }
    }
  },
  // Bridge for getOsInfo (src/renderer/src/main-operations.ts::getOsInfo)
  getOsInfo: async (detailLevel) => {
    try {
      const result = await ipcRenderer.invoke('ipc-use-electron', 'src/renderer/src/main-operations.ts::getOsInfo', [detailLevel]);
      return result;
    } catch (error) {
      console.error('[Preload Bridge] Error invoking getOsInfo (src/renderer/src/main-operations.ts::getOsInfo):', error?.message || error);
      if (error instanceof Error) { throw error; } else { throw new Error(String(error ?? 'Unknown IPC Error')); }
    }
  },
  // Bridge for riskyOperation (src/renderer/src/main-operations.ts::riskyOperation)
  riskyOperation: async (shouldFail) => {
    try {
      const result = await ipcRenderer.invoke('ipc-use-electron', 'src/renderer/src/main-operations.ts::riskyOperation', [shouldFail]);
      return result;
    } catch (error) {
      console.error('[Preload Bridge] Error invoking riskyOperation (src/renderer/src/main-operations.ts::riskyOperation):', error?.message || error);
      if (error instanceof Error) { throw error; } else { throw new Error(String(error ?? 'Unknown IPC Error')); }
    }
  },
  // Bridge for testMainFunction (src/renderer/src/main-operations.ts::testMainFunction)
  testMainFunction: async () => {
    try {
      const result = await ipcRenderer.invoke('ipc-use-electron', 'src/renderer/src/main-operations.ts::testMainFunction', []);
      return result;
    } catch (error) {
      console.error('[Preload Bridge] Error invoking testMainFunction (src/renderer/src/main-operations.ts::testMainFunction):', error?.message || error);
      if (error instanceof Error) { throw error; } else { throw new Error(String(error ?? 'Unknown IPC Error')); }
    }
  }
};

// Safely expose the API to the renderer process
try {
  if (process.contextIsolated) {
      contextBridge.exposeInMainWorld('mainApi', mainApi);
      console.log('[Preload Bridge] mainApi object exposed via contextBridge.');
  } else {
      // Fallback for non-contextIsolated environments (less secure)
      if (typeof window !== 'undefined') {
         (window as any).mainApi = mainApi;
         console.warn('[Preload Bridge] WARNING: contextIsolation is disabled. mainApi object exposed directly to window (less secure).');
      } else if (typeof global !== 'undefined') {
         (global as any).mainApi = mainApi;
         console.warn('[Preload Bridge] WARNING: contextIsolation is disabled. mainApi object exposed directly to global (less secure).');
      }
  }
} catch (error) {
    console.error('[Preload Bridge] Failed to expose mainApi:', error);
}
`.trim();


// Corrected mockManifest based on expected transform logic
const mockManifest = {
  'src/renderer/src/components/SystemInfo.tsx::componentTestFunction': {
    id: 'src/renderer/src/components/SystemInfo.tsx::componentTestFunction',
    name: 'componentTestFunction',
    params: [{ name: 'message', typeString: 'string' }],
    paramsString: 'message: string',
    returnTypeString: 'Promise<string>',
    body: 'console.log("componentTestFunction received:", message);\n    await new Promise(resolve => setTimeout(resolve, 50));\n    return `Main process received: "${message}" and says hello back!`;',
    filePath: 'src/renderer/src/components/SystemInfo.tsx',
    imports: []
  },
  'src/renderer/src/main-operations.ts::addNumbers': {
    id: 'src/renderer/src/main-operations.ts::addNumbers',
    name: 'addNumbers',
    params: [ { name: 'a', typeString: 'number' }, { name: 'b', typeString: 'number' } ],
    paramsString: 'a: number, b: number',
    returnTypeString: 'Promise<number>',
    body: 'console.log(`[Main Process: addNumbers] Adding ${a} and ${b}`);\n    return a + b;',
    filePath: 'src/renderer/src/main-operations.ts',
    imports: []
  },
  'src/renderer/src/main-operations.ts::getFileSize': {
    id: 'src/renderer/src/main-operations.ts::getFileSize',
    name: 'getFileSize',
    params: [{ name: 'filePath', typeString: 'string' }],
    paramsString: 'filePath: string',
    returnTypeString: 'Promise<number>',
    body: 'console.log(`[Main Process: getFileSize] Reading size of: ${filePath}`);\n    // Use fs promises API\n    const stats = await fs.promises.stat(filePath);\n    return stats.size;',
    filePath: 'src/renderer/src/main-operations.ts',
    imports: ['fs']
  },
  'src/renderer/src/main-operations.ts::getOsInfo': {
    id: 'src/renderer/src/main-operations.ts::getOsInfo',
    name: 'getOsInfo',
    params: [{ name: 'detailLevel', typeString: 'number' }],
    paramsString: 'detailLevel: number',
    returnTypeString: 'Promise<{ platform: string; arch: string; hostname?: string }>',
    body: 'console.log(`[Main Process: getOsInfo] Received detailLevel: ${detailLevel}`);\n    const platform = os.platform();\n    const arch = os.arch();\n    let hostname: string | undefined;\n    if (detailLevel > 0) {\n        hostname = os.hostname();\n    }\n    return { platform, arch, hostname };',
    filePath: 'src/renderer/src/main-operations.ts',
    imports: ['os']
  },
  'src/renderer/src/main-operations.ts::riskyOperation': {
    id: 'src/renderer/src/main-operations.ts::riskyOperation',
    name: 'riskyOperation',
    params: [{ name: 'shouldFail', typeString: 'boolean' }],
    paramsString: 'shouldFail: boolean',
    returnTypeString: 'Promise<string>',
    body: 'console.log(`[Main Process: riskyOperation] Called with shouldFail=${shouldFail}`);\n    if (shouldFail) {\n        throw new Error("Operation failed as requested!");\n    }\n    return "Operation succeeded!";',
    filePath: 'src/renderer/src/main-operations.ts',
    imports: []
  },
  'src/renderer/src/main-operations.ts::testMainFunction': {
    id: 'src/renderer/src/main-operations.ts::testMainFunction',
    name: 'testMainFunction',
    params: [],
    paramsString: '',
    returnTypeString: 'Promise<string>',
    body: 'console.log(\'[Main Process: testMainFunction] Called\');\n    return "Main process is working!";',
    filePath: 'src/renderer/src/main-operations.ts',
    imports: []
  }
};


function normalizeWhitespace(str: string): string {
    if (!str) return '';
    return str
        .replace(/\r\n/g, '\n') // Normalize line endings
        .replace(/[ \t]+/g, ' ') // Replace multiple tabs/spaces with single space
        .replace(/\n\s*\n/g, '\n') // Replace multiple newlines with single newline
        .trim();
}


// --- Test Suite ---
describe('vite-plugin-use-electron plugin', () => {
  let mockViteConfig: ResolvedConfig;
  // Use Partial<Plugin> for mock context type
  let mockPluginContext: Partial<Plugin>;

  beforeEach(async () => {
    // Setup test environment (ensure dirs)
    await fs.emptyDir(TEST_TEMP_DIR);
    await fs.ensureDir(MOCK_ROOT_DIR);
    await fs.ensureDir(MOCK_OUT_MAIN);
    await fs.ensureDir(MOCK_OUT_PRELOAD);
    await fs.ensureDir(path.join(MOCK_ROOT_DIR, 'src/renderer/src/components'));
    await fs.ensureDir(MOCK_MANIFEST_DIR);

    // Create mock source files
    await fs.writeFile( path.join(MOCK_ROOT_DIR, mockFiles.mainOperations.path), mockFiles.mainOperations.content );
    await fs.writeFile( path.join(MOCK_ROOT_DIR, mockFiles.systemInfo.path), mockFiles.systemInfo.content );

    // Mock Vite config
    mockViteConfig = {
      root: MOCK_ROOT_DIR,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      command: 'build',
      build: { outDir: path.join(MOCK_ROOT_DIR, 'out') },
      isProduction: true,
      mode: 'production',
    } as unknown as ResolvedConfig;

    // Mock plugin context
    mockPluginContext = {
      // @ts-expect-error - Mocking emitFile
      emitFile: vi.fn(),
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(TEST_TEMP_DIR);
  });

  describe('transform hook (renderer target)', () => {
    let rendererPlugin: Plugin;

    beforeEach(async () => {
      rendererPlugin = useElectronMainPlugin('renderer');
      // @ts-expect-error - Simulating hook
      await rendererPlugin.configResolved?.(mockViteConfig);
      await fs.remove(MOCK_MANIFEST_PATH);
    });

    it('should replace function bodies and remove "use electron" directive', async () => {
      const id = path.join(MOCK_ROOT_DIR, mockFiles.mainOperations.path);
      const code = mockFiles.mainOperations.content;

      // @ts-expect-error - Calling hook
      const result = await rendererPlugin.transform?.(code, id);
      expect(result).toBeTruthy(); if (!result || typeof result === 'string') return;
      const transformedCode = result.code;

      expect(transformedCode).contains('/* Body replaced by vite-plugin-use-electron */');
      expect(transformedCode).contains('window.mainApi.getOsInfo');
      // ** Check directive is ACTUALLY removed from the specific function **
      expect(transformedCode).contains('export function generateHash(data: string): string {');
    });

    it('should remove imports used ONLY within "use electron" functions (treeshaking)', async () => {
      const id = path.join(MOCK_ROOT_DIR, mockFiles.mainOperations.path);
      const code = mockFiles.mainOperations.content;

      // @ts-expect-error - Calling hook
      const result = await rendererPlugin.transform?.(code, id);
      expect(result).toBeTruthy(); if (!result || typeof result === 'string') return;
      const transformedCode = result.code;

      expect(transformedCode).not.toMatch(/^\s*import os from 'os';/m);
      expect(transformedCode).not.toMatch(/^\s*import fs from 'fs';/m);
      expect(transformedCode).toMatch(/^\s*import crypto from 'crypto';/m);
    });

    it('should NOT remove imports used by non-"use electron" code', async () => {
      const id = path.join(MOCK_ROOT_DIR, mockFiles.systemInfo.path);
      const code = mockFiles.systemInfo.content;

      // @ts-expect-error - Calling hook
      const result = await rendererPlugin.transform?.(code, id);
      expect(result).toBeTruthy(); if (!result || typeof result === 'string') return;
      const transformedCode = result.code;

      // ** Corrected Assertion: Check presence **
      expect(transformedCode).toMatch(/^\s*import React from 'react';/m);
      expect(transformedCode).toMatch(/^\s*import { useQuery } from '@tanstack\/react-query';/m);
      expect(transformedCode).toMatch(/^\s*import { getOsInfo, generateHash } from '@renderer\/main-operations';/m);
      expect(transformedCode).contains('window.mainApi.componentTestFunction');
    });

    it('should update the manifest file with correct imports after transform', async () => {
      const id = path.join(MOCK_ROOT_DIR, mockFiles.mainOperations.path);
      const code = mockFiles.mainOperations.content;

      expect(await fs.pathExists(MOCK_MANIFEST_PATH)).toBe(false);

      // @ts-expect-error - Calling hook
      await rendererPlugin.transform?.(code, id); // Await transform and manifest write

      expect(await fs.pathExists(MOCK_MANIFEST_PATH)).toBe(true);

      const manifestContent = await fs.readJson(MOCK_MANIFEST_PATH);
      // Check imports for getFileSize again
      expect(manifestContent).toHaveProperty('src/renderer/src/main-operations.ts::getFileSize');
      expect(manifestContent['src/renderer/src/main-operations.ts::getFileSize'].imports).toEqual(['fs']); // ** This should now pass **
      expect(manifestContent).toHaveProperty('src/renderer/src/main-operations.ts::getOsInfo');
      expect(manifestContent['src/renderer/src/main-operations.ts::getOsInfo'].imports).toEqual(['os']);
    });
  });

  // --- generateBundle tests (should pass now if transform is correct) ---
  describe('generateBundle hook', () => {
    async function writeMockManifest() {
      // Use the mockManifest constant directly
      await fs.outputJson(MOCK_MANIFEST_PATH, mockManifest, { spaces: 2 });
    }

    it('should create main handlers file including required node modules', async () => {
      await writeMockManifest();
      const plugin = useElectronMainPlugin('main');
      // @ts-expect-error - Simulate hook
      await plugin.configResolved?.(mockViteConfig); // Use await if async
      Object.assign(plugin, mockPluginContext);
      // @ts-expect-error - Simulate hook
      await plugin.generateBundle?.( { dir: MOCK_OUT_MAIN, format: 'cjs' }, {} );

      // @ts-expect-error - Mocking emitFile
      expect(mockPluginContext.emitFile).toHaveBeenCalledOnce();
      // @ts-expect-error - Mocking emitFile
      const emittedSource = (mockPluginContext.emitFile)?.mock.calls[0][0].source; // Use as any if type is complex
      expect(emittedSource).toBeDefined();
      expect(normalizeWhitespace(emittedSource)).toEqual(normalizeWhitespace(EXPECTED_HANDLERS_FILE));
    });

    it('should create preload bridge file without node module requires', async () => {
      await writeMockManifest();
      const plugin = useElectronMainPlugin('preload');
      // @ts-expect-error - Simulate hook
      await plugin.configResolved?.(mockViteConfig);
      Object.assign(plugin, mockPluginContext);
      // @ts-expect-error - Simulate hook
      await plugin.generateBundle?.( { dir: MOCK_OUT_PRELOAD, format: 'cjs' }, {});
      // @ts-expect-error - Mocking emitFile
      expect(mockPluginContext.emitFile).toHaveBeenCalledOnce();
      // @ts-expect-error - Mocking emitFile
      const emittedSource = (mockPluginContext.emitFile)?.mock.calls[0][0].source;
      expect(emittedSource).toBeDefined();
      expect(normalizeWhitespace(emittedSource)).toEqual(normalizeWhitespace(EXPECTED_PRELOAD_BRIDGE));
    });

    it('should attempt to write files to standard output directories', async () => {
      await writeMockManifest();
      const mainPlugin = useElectronMainPlugin('main');
      // @ts-expect-error - Mocking emitFile
      const mainCtx: Partial<Plugin> = { emitFile: vi.fn() }; // Use Partial<Plugin>
      // @ts-expect-error - Simulate hook
      await mainPlugin.configResolved?.(mockViteConfig);
      Object.assign(mainPlugin, mainCtx);
      // @ts-expect-error - generateBundle
      await mainPlugin.generateBundle?.({ dir: MOCK_OUT_MAIN, format: 'cjs' });

      const preloadPlugin = useElectronMainPlugin('preload');
      // @ts-expect-error - Mocking emitFile
      const preloadCtx: Partial<Plugin> = { emitFile: vi.fn() }; // Use Partial<Plugin>
      // @ts-expect-error - Simulate hook
      await preloadPlugin.configResolved?.(mockViteConfig);
      Object.assign(preloadPlugin, preloadCtx);
      // @ts-expect-error - generateBundle
      await preloadPlugin.generateBundle?.({ dir: MOCK_OUT_PRELOAD, format: 'cjs' });

      // @ts-expect-error - Mocking emitFile
      expect(mainCtx.emitFile).toHaveBeenCalledTimes(1);
      // @ts-expect-error - Mocking emitFile
      expect(preloadCtx.emitFile).toHaveBeenCalledTimes(1);

      const mainFilePath = path.join(MOCK_OUT_MAIN, '_generated_main_handlers.js');
      const preloadFilePath = path.join(MOCK_OUT_PRELOAD, '_generated_preload_bridge.js');

      expect(await fs.pathExists(mainFilePath), `Main handler file missing at ${mainFilePath}`).toBe(true);
      expect(await fs.pathExists(preloadFilePath), `Preload bridge file missing at ${preloadFilePath}`).toBe(true);

      const mainContent = await fs.readFile(mainFilePath, 'utf-8');
      const preloadContent = await fs.readFile(preloadFilePath, 'utf-8');

      expect(normalizeWhitespace(mainContent)).toEqual(normalizeWhitespace(EXPECTED_HANDLERS_FILE));
      expect(normalizeWhitespace(preloadContent)).toEqual(normalizeWhitespace(EXPECTED_PRELOAD_BRIDGE));
    });
  });

  describe('integration simulation', () => {
     async function writeMockManifest() {
        await fs.outputJson(MOCK_MANIFEST_PATH, mockManifest, { spaces: 2 });
     }
    it('should generate structurally sound handlers and bridge', async () => {
       await writeMockManifest();
       const mainPlugin = useElectronMainPlugin('main');
       // @ts-expect-error - Mocking emitFile
       const mainCtx: Partial<Plugin> = { emitFile: vi.fn() };
       // @ts-expect-error - Simulate hook
       await mainPlugin.configResolved?.(mockViteConfig);
       Object.assign(mainPlugin, mainCtx);
       // @ts-expect-error - Simulate hook
       await mainPlugin.generateBundle?.({ dir: MOCK_OUT_MAIN, format: 'cjs' });

       const preloadPlugin = useElectronMainPlugin('preload');
       // @ts-expect-error - Mocking emitFile
       const preloadCtx: Partial<Plugin> = { emitFile: vi.fn() };
       // @ts-expect-error - Simulate hook
       await preloadPlugin.configResolved?.(mockViteConfig);
       Object.assign(preloadPlugin, preloadCtx);
       // @ts-expect-error - Simulate hook
       await preloadPlugin.generateBundle?.({ dir: MOCK_OUT_PRELOAD, format: 'cjs' });
       // @ts-expect-error - Mocking emitFile
       expect(mainCtx.emitFile).toHaveBeenCalledTimes(1);
       // @ts-expect-error - Mocking emitFile
       expect(preloadCtx.emitFile).toHaveBeenCalledTimes(1);
       // @ts-expect-error - Mocking emitFile
       const mainHandlersSource = (mainCtx.emitFile)?.mock.calls[0][0].source;
       // @ts-expect-error - Mocking emitFile
       const preloadBridgeSource = (preloadCtx.emitFile)?.mock.calls[0][0].source;

       expect(mainHandlersSource).toContain("require('node:os')");
       expect(mainHandlersSource).toContain("require('node:fs')");
       expect(mainHandlersSource).toContain("'src/renderer/src/main-operations.ts::getFileSize': async function");

       expect(preloadBridgeSource).not.toContain("require('node:os')");
       expect(preloadBridgeSource).not.toContain("require('node:fs')");
       expect(preloadBridgeSource).toContain('getFileSize: async (filePath) => {');
    });
  });
});