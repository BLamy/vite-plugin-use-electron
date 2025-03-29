// tests/vite-plugin-use-main.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs-extra';
import { generateId, useMainPlugin } from '../vite-plugin-use-main';
import type { Plugin } from 'vite';
import { normalizePath } from 'vite';
import path from 'node:path';

// --- Mocking `fs-extra` ---
vi.mock('fs-extra');

// --- Mock Logger ---
const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

// --- Test Constants ---
const MOCK_ROOT = normalizePath(process.cwd() + '/mock-project-root');
const TEMP_DIR = normalizePath(path.join(MOCK_ROOT, 'node_modules', '.vite-plugin-use-main'));
const MANIFEST_PATH = normalizePath(path.join(TEMP_DIR, 'use-main-manifest.json'));

// --- Test Helper ---
function getRendererPluginInstance(): Plugin & {
    transform: (code: string, id: string) => Promise<{ code: string; map: any } | null>;
    configResolved: (config: any) => void;
} {
    const plugin = useMainPlugin('renderer') as any;
    plugin.configResolved({ root: MOCK_ROOT, logger: mockLogger }); // Pass mock logger
    return plugin;
}

// --- In-Memory Manifest ---
let testManifest: Record<string, any> = {};

describe('vite-plugin-use-main (Renderer Transform Logic)', () => {
    let plugin: ReturnType<typeof getRendererPluginInstance>;

    beforeEach(() => {
        vi.clearAllMocks();
        testManifest = {};
        // Configure mocks
        (fs.ensureDirSync as ReturnType<typeof vi.fn>).mockClear();
        (fs.readJsonSync as ReturnType<typeof vi.fn>).mockImplementation((filePath) => {
            if (filePath === MANIFEST_PATH) return JSON.parse(JSON.stringify(testManifest));
            return {};
        });
        (fs.writeJsonSync as ReturnType<typeof vi.fn>).mockImplementation((filePath, data) => {
            if (filePath === MANIFEST_PATH) testManifest = JSON.parse(JSON.stringify(data));
        });
        // Get plugin instance AFTER mocks are set up
        plugin = getRendererPluginInstance();
    });

    // --- Basic Ignore Cases --- (Keep passing tests)
    it('should return null for files without "use main" directive', async () => {
        const code = `function normalFunc() {}`;
        const id = normalizePath(`${MOCK_ROOT}/src/normal.ts`);
        const result = await plugin.transform(code, id);
        expect(result).toBeNull();
        expect(fs.writeJsonSync).not.toHaveBeenCalled();
    });

    it('should return null for files inside node_modules', async () => {
        const code = `function libFunc() { "use main"; return require('os').platform(); }`;
        const id = normalizePath(`${MOCK_ROOT}/node_modules/some-lib/index.js`);
        const result = await plugin.transform(code, id);
        expect(result).toBeNull();
        expect(fs.writeJsonSync).not.toHaveBeenCalled();
    });

     it('should return null for non-JS/TS files', async () => {
        const code = `<template><button @click="doAction">Click</button></template>`;
        const id = normalizePath(`${MOCK_ROOT}/src/component.vue`);
        const result = await plugin.transform(code, id);
        expect(result).toBeNull();
    });

    // --- Parse Failure Test ---
    it('should return null if Babel parsing fails', async () => {
        // Use syntax guaranteed to fail parsing
        const code = `function invalidFunc() { let a = : string; }`;
        const id = normalizePath(`${MOCK_ROOT}/src/invalid.ts`);
        vi.clearAllMocks(); // Reset mocks for this specific call
        (fs.ensureDirSync as ReturnType<typeof vi.fn>).mockClear();

        const result = await plugin.transform(code, id);

        expect(result).toBeNull();
        expect(fs.writeJsonSync).not.toHaveBeenCalled();
    });

    // --- Core Extraction Cases ---
    const testCases: Array<{
        name: string; id: string; code: string; expectedName: string; expectedParams: string; expectedBodyContains: string[]; shouldWarn?: boolean; skipExtraction?: boolean;
    }> = [
        // --- Cases that SHOULD parse and transform now ---
        // Note: expectedManifestId removed, calculated dynamically in test
        { name: 'Function Declaration (no params)', id: '/src/utils/actions.ts', code: `export function triggerAction() { "use main"; console.log('Action!'); return 123; }`, expectedName: 'triggerAction', expectedParams: '', expectedBodyContains: ["console.log('Action!')", "return 123;"] },
        { name: 'Function Declaration (with params)', id: '/src/utils/fetchers.ts', code: `import fs from 'node:fs'; async function readFile(filePath: string, encoding: BufferEncoding = 'utf8'): Promise<string> { "use main"; const content = await fs.promises.readFile(filePath, encoding); return content.trim(); }`, expectedName: 'readFile', expectedParams: "filePath: string, encoding: BufferEncoding = 'utf8'", expectedBodyContains: ["await fs.promises.readFile(filePath, encoding)", "content.trim()"] },
        { name: 'Const Arrow Function', id: '/src/api/sender.ts', code: `export const sendMessage = async (message: { text: string; userId: number }) => { "use main"; if (!message.text) throw new Error("Empty message"); await db.send(message); return { success: true }; };`, expectedName: 'sendMessage', expectedParams: 'message: { text: string; userId: number }', expectedBodyContains: ["!message.text", "await db.send(message)"] },
        { name: 'Const Function Expression (Simple Assignment)', id: '/src/math.ts', code: `const add = function(x: number, y: number): number { "use main"; return x + y; };`, expectedName: 'add', expectedParams: 'x: number, y: number', expectedBodyContains: ["return x + y"] },
        { name: 'Object Method (Function Expression)', id: '/src/services/storage.ts', code: `const storageService = { saveItem: function(key: string, value: any) { "use main"; localStorage.setItem(key, JSON.stringify(value)); } };`, expectedName: 'saveItem', expectedParams: 'key: string, value: any', expectedBodyContains: ["localStorage.setItem"] },
        { name: 'Object Method (Arrow Function)', id: '/src/services/logger.ts', code: `export const logger = { logError: (error: Error, context?: string) => { "use main"; const timestamp = new Date().toISOString(); console.error(\`[\${timestamp}] \${context || 'Global'}:\`, error.message, error.stack); } };`, expectedName: 'logError', expectedParams: 'error: Error, context?: string', expectedBodyContains: ["new Date().toISOString()", "console.error"] },
        { name: 'Empty Function Body', id: '/src/empty.ts', code: `function doNothing() { "use main"; }`, expectedName: 'doNothing', expectedParams: '', expectedBodyContains: [] },
        { name: 'Function with only directive', id: '/src/onlyDirective.ts', code: `function justDirective() { "use main"; }`, expectedName: 'justDirective', expectedParams: '', expectedBodyContains: [] },
        { name: 'Anonymous Function Assigned Later', id: '/src/anonAssign.ts', code: `let myAction: any; myAction = (data: any) => { "use main"; console.log("Processing data:", data); };`, expectedName: 'myAction', expectedParams: 'data: any', expectedBodyContains: ['console.log("Processing data:", data)'], shouldWarn: false, skipExtraction: false },

        // --- Cases that SHOULD be skipped or warn ---
        { name: 'Directive Not First Statement', id: '/src/mixed.ts', code: `function doSomething(config: object) { console.log('Renderer'); "use main"; /* Ignored! */ return config; }`, expectedName: '', expectedParams: '', expectedBodyContains: [], skipExtraction: true },
        { name: 'Anonymous Default Export Arrow Function', id: '/src/anonDefault.ts', code: `export default () => { "use main"; return Math.random(); };`, expectedName: '', expectedParams: '', expectedBodyContains: [], shouldWarn: true, skipExtraction: true },
    ];

    for (const tc of testCases) {
        it(`should handle: ${tc.name}`, async () => {
            const absoluteId = normalizePath(path.join(MOCK_ROOT, tc.id));
            // Use the *actual* helper function for consistent ID generation
            const expectedManifestId = generateId(MOCK_ROOT, absoluteId, tc.expectedName);

            vi.clearAllMocks();
            testManifest = {};
            (fs.readJsonSync as ReturnType<typeof vi.fn>).mockReturnValue({});

            const result = await plugin.transform(tc.code, absoluteId);

            if (tc.skipExtraction) {
                expect(result).toBeNull();
                expect(fs.writeJsonSync).not.toHaveBeenCalled();
                if (tc.shouldWarn) { expect(mockLogger.warn).toHaveBeenCalled(); }
                 else { expect(mockLogger.warn).not.toHaveBeenCalled(); }
            } else {
                expect(result, `Test case "${tc.name}" failed: result should not be null`).not.toBeNull();
                if (!result) return;

                // Check Code Replacement
                expect(result.code).toContain(`throw new Error('"${tc.expectedName}" is "use main"...`);
                expect(result.map).toBeDefined();

                // Check Manifest Write
                expect(fs.writeJsonSync, `Test case "${tc.name}" failed: writeJsonSync call count`).toHaveBeenCalledOnce();
                const manifestData = testManifest;

                // Check Manifest Content
                expect(manifestData[expectedManifestId], `Test case "${tc.name}" failed: manifest entry missing for ID ${expectedManifestId}`).toBeDefined();
                const entry = manifestData[expectedManifestId];
                expect(entry.id).toBe(expectedManifestId);
                expect(entry.name).toBe(tc.expectedName);
                expect(entry.paramsString).toBe(tc.expectedParams);
                expect(entry.filePath).toBe(absoluteId); // Check stored path is absolute normalized
                for (const snippet of tc.expectedBodyContains) { expect(entry.body).toContain(snippet); }
                expect(entry.body).not.toContain('"use main"');

                if (tc.shouldWarn) { expect(mockLogger.warn).toHaveBeenCalled(); }
                 else { expect(mockLogger.warn).not.toHaveBeenCalled(); }
            }
        });
    }

    // --- Test Multiple Functions and Duplicates ---
    it('should handle multiple functions in one file and warn on duplicates', async () => {
        const absoluteId = normalizePath(`${MOCK_ROOT}/src/multi.ts`);
        const code = `
            export function funcOne(a: number) { "use main"; return a + 1; } // #1 Processed
            export const funcTwo = (b: string): string => { "use main"; return b.toUpperCase(); } // #2 Processed
            const anotherVar = function funcOne(a: number) { // #3 Named 'funcOne' - SKIPPED
                 "use main";
                 return a * 100; // This body should remain UNTOUCHED
            };
        `;
        testManifest = {}; vi.clearAllMocks(); (fs.readJsonSync as ReturnType<typeof vi.fn>).mockReturnValue({});
        const result = await plugin.transform(code, absoluteId);
        expect(result, "Result should not be null").not.toBeNull(); if (!result) return;

        // Check replacements (less brittle check)
        expect(result.code).toMatch(/export function funcOne\(a: number\) { \/\* Body Replaced/);
        expect(result.code).toMatch(/export const funcTwo = \(b: string\): string => { \/\* Body Replaced/);
        // Check original body of skipped function REMAINS
        expect(result.code).toContain("return a * 100;");
        // Check replacement marker is NOT present for the skipped function
        expect(result.code).not.toMatch(/anotherVar = function funcOne\(a: number\) { \/\* Body Replaced/);

        // Check Manifest Write & Content
        expect(fs.writeJsonSync).toHaveBeenCalledOnce();
        const manifestData = testManifest;
        const id1 = generateId(MOCK_ROOT, absoluteId, 'funcOne');
        const id2 = generateId(MOCK_ROOT, absoluteId, 'funcTwo');
        expect(Object.keys(manifestData).length).toBe(2);
        expect(manifestData[id1]).toBeDefined();
        expect(manifestData[id2]).toBeDefined();
        expect(manifestData[id1].body.trim()).toBe("return a + 1;");
        // Check warning for duplicate
        expect(mockLogger.warn).toHaveBeenCalledWith( expect.stringContaining(`Duplicate function ID encountered: ${id1}`), expect.any(Object) );
    });

    // --- Test Manifest Accumulation ---
     it('should accumulate functions from multiple files into the manifest', async () => {
         const id1 = normalizePath(`${MOCK_ROOT}/src/file1.ts`);
         const code1 = `export function actionA() { "use main"; return 'A'; }`;
         const id2 = normalizePath(`${MOCK_ROOT}/src/file2.ts`);
         const code2 = `export function actionB() { "use main"; return 'B'; }`;
         // Use generateId for consistency
         const manifestId1 = generateId(MOCK_ROOT, id1, 'actionA');
         const manifestId2 = generateId(MOCK_ROOT, id2, 'actionB');

         // --- Transform file 1 ---
         testManifest = {}; vi.clearAllMocks(); (fs.readJsonSync as ReturnType<typeof vi.fn>).mockReturnValue(testManifest);
         await plugin.transform(code1, id1);
         expect(fs.writeJsonSync).toHaveBeenCalledTimes(1);
         expect(testManifest[manifestId1], "Manifest should contain actionA after file 1").toBeDefined();
         expect(Object.keys(testManifest).length).toBe(1);

         // --- Transform file 2 ---
         vi.clearAllMocks();
         await plugin.transform(code2, id2);
         expect(fs.writeJsonSync).toHaveBeenCalledTimes(1);
         expect(testManifest[manifestId1], "actionA should still be in manifest").toBeDefined();
         expect(testManifest[manifestId2], "actionB should be added to manifest").toBeDefined();
         expect(Object.keys(testManifest).length).toBe(2);
     });

     // --- ADD MORE TESTS ---
     it('should handle functions inside classes (if applicable)', async () => {
        const absoluteId = normalizePath(`${MOCK_ROOT}/src/myClass.ts`);
        const code = ` class MyService { performTask(input: number): string { "use main"; return \`Processed \${input}\`; } regularMethod() { return 1; } } `;
        const manifestId = generateId(MOCK_ROOT, absoluteId, 'performTask');
        vi.clearAllMocks(); testManifest = {}; (fs.readJsonSync as ReturnType<typeof vi.fn>).mockReturnValue({});
        const result = await plugin.transform(code, absoluteId);

        expect(result, "Class method transform failed").not.toBeNull(); // Ensure result is not null
        expect(fs.writeJsonSync).toHaveBeenCalledOnce();
        expect(testManifest[manifestId], "Manifest entry missing for class method").toBeDefined();
        // Check replacement (less brittle)
        expect(result?.code).toMatch(/performTask\(input: number\): string { \/\* Body Replaced/);
        expect(result?.code).toContain(`regularMethod() { return 1; }`);
    });

    it('should handle exported function expressions correctly', async () => {
        const absoluteId = normalizePath(`${MOCK_ROOT}/src/exportedFunc.ts`);
        const code = `
           export default function myDefaultExport(arg: boolean) {
               "use main";
               return !arg;
           }
        `;
        const manifestId = generateId(MOCK_ROOT, absoluteId, 'myDefaultExport');
        testManifest = {}; vi.clearAllMocks(); (fs.readJsonSync as ReturnType<typeof vi.fn>).mockReturnValue({});

        const result = await plugin.transform(code, absoluteId);
        expect(result).not.toBeNull();
        expect(fs.writeJsonSync).toHaveBeenCalledOnce();
        expect(testManifest[manifestId]).toBeDefined();
        expect(testManifest[manifestId].name).toBe('myDefaultExport');
        expect(testManifest[manifestId].paramsString).toBe('arg: boolean');
        expect(testManifest[manifestId].body).toContain('return !arg;');
    });
    
      it('should handle comments around directive', async () => {
        const absoluteId = normalizePath(`${MOCK_ROOT}/src/comments.ts`);
        const code = `
            function commentedFunc() {
                // Some comment before
                "use main"; // Directive
                // Some comment after
                return 'hello';
            }
        `;
         const manifestId = generateId(MOCK_ROOT, absoluteId, 'commentedFunc');
         testManifest = {}; vi.clearAllMocks(); (fs.readJsonSync as ReturnType<typeof vi.fn>).mockReturnValue({});

         const result = await plugin.transform(code, absoluteId);
         expect(result).not.toBeNull();
         expect(fs.writeJsonSync).toHaveBeenCalledOnce();
         expect(testManifest[manifestId]).toBeDefined();
         expect(testManifest[manifestId].body).toContain("return 'hello'");
         expect(testManifest[manifestId].body).toContain("Some comment after"); // Comments after directive are part of body
         expect(testManifest[manifestId].body).not.toContain("Some comment before");
     });

    it('should handle complex TypeScript types', async () => {
        const absoluteId = normalizePath(`${MOCK_ROOT}/src/complexTypes.ts`);
        const code = `
            function complexTypes<T extends object>(
                param1: { nested: Array<T>; optional?: string },
                callback: (item: T) => Promise<void>
            ) {
                "use main";
                return param1.nested.length;
            }
        `;
        const manifestId = generateId(MOCK_ROOT, absoluteId, 'complexTypes');
        testManifest = {}; 
        vi.clearAllMocks(); 
        (fs.readJsonSync as ReturnType<typeof vi.fn>).mockReturnValue({});

        const result = await plugin.transform(code, absoluteId);
        expect(result).not.toBeNull();
        expect(fs.writeJsonSync).toHaveBeenCalledOnce();
        expect(testManifest[manifestId]).toBeDefined();
        expect(testManifest[manifestId].name).toBe('complexTypes');
        expect(testManifest[manifestId].paramsString).toContain('param1: { nested: Array<T>; optional?: string }');
        expect(testManifest[manifestId].paramsString).toContain('callback: (item: T) => Promise<void>');
        expect(testManifest[manifestId].body).toContain('return param1.nested.length');
    });

    it('should handle async and generator functions', async () => {
        const absoluteId = normalizePath(`${MOCK_ROOT}/src/asyncFuncs.ts`);
        const code = `
            async function* dataStream() {
                "use main";
                yield* [1, 2, 3];
            }

            async function fetchData() {
                "use main";
                return await Promise.resolve(42);
            }
        `;
        const streamId = generateId(MOCK_ROOT, absoluteId, 'dataStream');
        const fetchId = generateId(MOCK_ROOT, absoluteId, 'fetchData');
        testManifest = {}; 
        vi.clearAllMocks(); 
        (fs.readJsonSync as ReturnType<typeof vi.fn>).mockReturnValue({});

        const result = await plugin.transform(code, absoluteId);
        expect(result).not.toBeNull();
        expect(fs.writeJsonSync).toHaveBeenCalledOnce();
        
        // Check dataStream function
        expect(testManifest[streamId]).toBeDefined();
        expect(testManifest[streamId].name).toBe('dataStream');
        expect(testManifest[streamId].body).toContain('yield* [1, 2, 3]');

        // Check fetchData function
        expect(testManifest[fetchId]).toBeDefined();
        expect(testManifest[fetchId].name).toBe('fetchData');
        expect(testManifest[fetchId].body).toContain('return await Promise.resolve(42)');
    });

    it('should handle nested functions with use main', async () => {
        const absoluteId = normalizePath(`${MOCK_ROOT}/src/nested.ts`);
        const code = `
            function outer() {
                function inner() {
                    "use main";
                    return 42;
                }
                return inner;
            }

            const nested = {
                level1: {
                    level2: function() {
                        "use main";
                        return true;
                    }
                }
            };
        `;
        const innerId = generateId(MOCK_ROOT, absoluteId, 'inner');
        const level2Id = generateId(MOCK_ROOT, absoluteId, 'level2');
        testManifest = {}; 
        vi.clearAllMocks(); 
        (fs.readJsonSync as ReturnType<typeof vi.fn>).mockReturnValue({});

        const result = await plugin.transform(code, absoluteId);
        expect(result).not.toBeNull();
        expect(fs.writeJsonSync).toHaveBeenCalledOnce();
        
        // Check inner function
        expect(testManifest[innerId]).toBeDefined();
        expect(testManifest[innerId].name).toBe('inner');
        expect(testManifest[innerId].body).toContain('return 42');

        // Check level2 function
        expect(testManifest[level2Id]).toBeDefined();
        expect(testManifest[level2Id].name).toBe('level2');
        expect(testManifest[level2Id].body).toContain('return true');
    });

    it('should handle various export patterns', async () => {
        const absoluteId = normalizePath(`${MOCK_ROOT}/src/exports.ts`);
        const code = `
            export const namedExport = () => { "use main"; return 1; };
            
            export default class {
                method() { "use main"; return 2; }
            }
            
            const toBeAliased = function() { "use main"; return 3; };
            export { toBeAliased as aliased };
        `;
        const namedId = generateId(MOCK_ROOT, absoluteId, 'namedExport');
        const methodId = generateId(MOCK_ROOT, absoluteId, 'method');
        const aliasedId = generateId(MOCK_ROOT, absoluteId, 'toBeAliased');
        
        testManifest = {}; 
        vi.clearAllMocks(); 
        (fs.readJsonSync as ReturnType<typeof vi.fn>).mockReturnValue({});

        const result = await plugin.transform(code, absoluteId);
        expect(result).not.toBeNull();
        expect(fs.writeJsonSync).toHaveBeenCalledOnce();
        
        // Check named export
        expect(testManifest[namedId]).toBeDefined();
        expect(testManifest[namedId].name).toBe('namedExport');
        expect(testManifest[namedId].body).toContain('return 1');

        // Check class method
        expect(testManifest[methodId]).toBeDefined();
        expect(testManifest[methodId].name).toBe('method');
        expect(testManifest[methodId].body).toContain('return 2');

        // Check aliased export
        expect(testManifest[aliasedId]).toBeDefined();
        expect(testManifest[aliasedId].name).toBe('toBeAliased');
        expect(testManifest[aliasedId].body).toContain('return 3');
    });

    it('should handle multiple directives in function', async () => {
        const absoluteId = normalizePath(`${MOCK_ROOT}/src/directives.ts`);
        const code = `
            function multiDirective() {
                "use strict";
                "use main";
                "use something else";
                return true;
            }

            function mainFirst() {
                "use main";
                "use strict";
                return false;
            }
        `;
        const multiId = generateId(MOCK_ROOT, absoluteId, 'multiDirective');
        const firstId = generateId(MOCK_ROOT, absoluteId, 'mainFirst');
        
        testManifest = {}; 
        vi.clearAllMocks(); 
        (fs.readJsonSync as ReturnType<typeof vi.fn>).mockReturnValue({});

        const result = await plugin.transform(code, absoluteId);
        expect(result).not.toBeNull();
        expect(fs.writeJsonSync).toHaveBeenCalledOnce();
        
        // Check multiDirective function (should be ignored as "use main" is not first)
        expect(testManifest[multiId]).toBeUndefined();
        
        // Check mainFirst function (should be processed as "use main" is first)
        expect(testManifest[firstId]).toBeDefined();
        expect(testManifest[firstId].name).toBe('mainFirst');
        expect(testManifest[firstId].body).toContain('"use strict"');
        expect(testManifest[firstId].body).toContain('return false');
    });

    it('should handle unicode function names and content', async () => {
        const absoluteId = normalizePath(`${MOCK_ROOT}/src/unicode.ts`);
        const code = `
            function 你好世界() {
                "use main";
                return '🌍';
            }

            const λ = () => {
                "use main";
                return 'λ calculus';
            };
        `;
        const unicodeId = generateId(MOCK_ROOT, absoluteId, '你好世界');
        const lambdaId = generateId(MOCK_ROOT, absoluteId, 'λ');
        
        testManifest = {}; 
        vi.clearAllMocks(); 
        (fs.readJsonSync as ReturnType<typeof vi.fn>).mockReturnValue({});

        const result = await plugin.transform(code, absoluteId);
        expect(result).not.toBeNull();
        expect(fs.writeJsonSync).toHaveBeenCalledOnce();
        
        // Check unicode named function
        expect(testManifest[unicodeId]).toBeDefined();
        expect(testManifest[unicodeId].name).toBe('你好世界');
        expect(testManifest[unicodeId].body).toContain("return '🌍'");

        // Check lambda function
        expect(testManifest[lambdaId]).toBeDefined();
        expect(testManifest[lambdaId].name).toBe('λ');
        expect(testManifest[lambdaId].body).toContain("return 'λ calculus'");
    });
    it('should handle computed property names by skipping them', async () => { // Renamed test for clarity
        const absoluteId = normalizePath(`${MOCK_ROOT}/src/computed.ts`);
        const code = `
            const prefix = 'computed';
            const obj = {
                [prefix + 'Name']() { "use main"; return true; }, // Skipped
                normalMethod() { "use main"; return false; } // Processed
            };
        `;
        const normalMethodId = generateId(MOCK_ROOT, absoluteId, 'normalMethod');
        testManifest = {}; vi.clearAllMocks(); (fs.readJsonSync as ReturnType<typeof vi.fn>).mockReturnValue({});

        const result = await plugin.transform(code, absoluteId);
        expect(result).not.toBeNull(); // Expect non-null because normalMethod is processed
        expect(fs.writeJsonSync).toHaveBeenCalledOnce();
        expect(testManifest[normalMethodId]).toBeDefined();
        expect(Object.keys(testManifest).length).toBe(1); // Only normalMethod added
        expect(mockLogger.warn).toHaveBeenCalledWith(
          "[vite-plugin-use-main] Skipping method with computed name in /Users/brettlamy/Dev/'electron-test/mock-project-root/src/computed.ts.",
          {
            "timestamp": true,
          }
        );
        // Check that the skipped function's body wasn't replaced
        expect(result?.code).toContain("[prefix + 'Name']() { \"use main\"; return true; }");
    });

    it('should generate correct source maps', async () => {
        const absoluteId = normalizePath(`${MOCK_ROOT}/src/sourcemap.ts`);
        const code = `
            function mapped() {
                "use main";
                console.log("This is line 4");
                return 42;
            }
        `;
        
        testManifest = {}; 
        vi.clearAllMocks(); 
        (fs.readJsonSync as ReturnType<typeof vi.fn>).mockReturnValue({});

        const result = await plugin.transform(code, absoluteId);
        expect(result).not.toBeNull();
        expect(result?.map).toBeDefined();
        
        const sourceMap = result?.map;
        expect(sourceMap?.version).toBe(3);
        expect(sourceMap?.sources).toContain(absoluteId);
        expect(sourceMap?.sourcesContent).toBeDefined();
        expect(sourceMap?.mappings).toBeDefined();
        expect(typeof sourceMap?.mappings).toBe('string');
    });

    it('should handle fs errors gracefully', async () => {
        const absoluteId = normalizePath(`${MOCK_ROOT}/src/error.ts`);
        const code = `
            function errorTest() {
                "use main";
                return true;
            }
        `;
        
        testManifest = {}; 
        vi.clearAllMocks(); 
        
        // Mock fs to throw on write
        (fs.writeJsonSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
            throw new Error('Disk full');
        });
        (fs.readJsonSync as ReturnType<typeof vi.fn>).mockReturnValue({});

        const result = await plugin.transform(code, absoluteId);
        expect(result).not.toBeNull();
        expect(mockLogger.error).toHaveBeenCalledWith(
            expect.stringContaining('Error updating manifest: Disk full'),
            expect.any(Object)
        );
    });

});

// Add new test suite for generated code
describe('vite-plugin-use-main (Generated Code Tests)', () => {
    let plugin: ReturnType<typeof getRendererPluginInstance>;
    let mainPlugin: Plugin;
    let preloadPlugin: Plugin;

    beforeEach(() => {
        vi.clearAllMocks();
        testManifest = {};
        // Configure mocks
        (fs.ensureDirSync as ReturnType<typeof vi.fn>).mockClear();
        (fs.readJsonSync as ReturnType<typeof vi.fn>).mockImplementation((filePath) => {
            if (filePath === MANIFEST_PATH) return JSON.parse(JSON.stringify(testManifest));
            return {};
        });
        (fs.writeJsonSync as ReturnType<typeof vi.fn>).mockImplementation((filePath, data) => {
            if (filePath === MANIFEST_PATH) testManifest = JSON.parse(JSON.stringify(data));
        });

        // Get plugin instances
        plugin = getRendererPluginInstance();
        mainPlugin = useMainPlugin('main');
        preloadPlugin = useMainPlugin('preload');
        
        // Configure plugins
        // @ts-expect-error
        mainPlugin.configResolved({ root: MOCK_ROOT, logger: mockLogger } as any);
        // @ts-expect-error
        preloadPlugin.configResolved({ root: MOCK_ROOT, logger: mockLogger } as any);
    });

    it('should generate valid preload bridge code with proper argument handling', async () => {
        // First collect some functions
        const code = `
            export async function testFunction(arg1: number, arg2: string) {
                "use main";
                return arg1 + arg2;
            }
        `;
        const id = normalizePath(`${MOCK_ROOT}/src/functions.ts`);
        
        // Mock fs.readJSON to return our test manifest
        const testManifest = {
            [`${id}::testFunction`]: {
                id: `${id}::testFunction`,
                name: 'testFunction',
                params: [
                    { name: 'arg1', typeString: 'number' },
                    { name: 'arg2', typeString: 'string' }
                ],
                paramsString: 'arg1: number, arg2: string',
                returnTypeString: 'Promise<string>',
                body: 'return arg1 + arg2;',
                filePath: id
            }
        };
        
        (fs.readJSON as ReturnType<typeof vi.fn>).mockResolvedValue(testManifest);

        // Generate bundle
        const bundle = {} as any;
        const generateBundle = preloadPlugin.generateBundle as any;
        
        const emittedFiles: any[] = [];
        const emitFile = vi.fn((file: any) => {
            emittedFiles.push(file);
        });

        await generateBundle.call({ emitFile }, {}, bundle);

        // Verify emitted preload bridge code
        expect(emittedFiles.length).toBe(1);
        const preloadCode = emittedFiles[0].source;
        expect(preloadCode).toContain('mainApi.testFunction = async (...args)');
    });

    it('should generate valid main handler code with proper argument handling', async () => {
        const absoluteId = normalizePath(`${MOCK_ROOT}/src/handlers.ts`);
        const code = `
            export async function getData(id: number) {
                "use main";
                return { id, timestamp: Date.now() };
            }

            export const processArray = async (items: string[]) => {
                "use main";
                return items.map(item => item.toUpperCase());
            };
        `;
        
        // Transform the code first to populate manifest
        testManifest = {}; 
        vi.clearAllMocks();
        (fs.readJsonSync as ReturnType<typeof vi.fn>).mockReturnValue({});
        await plugin.transform(code, absoluteId);

        // Mock fs.readJSON to return our populated manifest
        (fs.readJSON as ReturnType<typeof vi.fn>).mockResolvedValue(testManifest);

        // Generate bundle
        const bundle = {} as any;
        const generateBundle = mainPlugin.generateBundle as any;
        
        const emittedFiles: any[] = [];
        const emitFile = vi.fn((file: any) => {
            emittedFiles.push(file);
        });

        await generateBundle.call({ emitFile }, {}, bundle);

        // Verify emitted files
        expect(emittedFiles.length).toBe(1);
        const mainCode = emittedFiles[0].source;

        // Verify structure and content
        expect(mainCode).toContain('const { ipcMain } = require(\'electron\')');
        expect(mainCode).toContain('ipcMain.handle(');
        
        // Verify function registration
        expect(mainCode).toContain('getData');
        expect(mainCode).toContain('processArray');
        
        // Verify logging
        expect(mainCode).toContain('[Main Handler] getData received args:');
        expect(mainCode).toContain('[Main Handler] getData returning result:');
        
        // Verify error handling
        expect(mainCode).toContain('catch (error)');
        expect(mainCode).toContain('throw new Error(error?.message || \'Unknown error\')');
    });

    it('should handle empty manifest gracefully', async () => {
        // Mock fs.readJSON to return empty manifest
        (fs.readJSON as ReturnType<typeof vi.fn>).mockResolvedValue({});
        
        const bundle = {} as any;
        const generateBundleMain = mainPlugin.generateBundle as any;
        const generateBundlePreload = preloadPlugin.generateBundle as any;
        
        const emittedFiles: any[] = [];
        const emitFile = vi.fn((file: any) => {
            emittedFiles.push(file);
        });

        await generateBundleMain.call({ emitFile }, {}, bundle);
        await generateBundlePreload.call({ emitFile }, {}, bundle);

        expect(emittedFiles.length).toBe(0);
        expect(mockLogger.warn).toHaveBeenNthCalledWith(
            1,
            '[vite-plugin-use-main:main] No "use main" functions found in manifest. Skipping code generation.'
        );
        expect(mockLogger.warn).toHaveBeenNthCalledWith(
            2,
            '[vite-plugin-use-main:preload] No "use main" functions found in manifest. Skipping code generation.'
        );
    });

    it('should handle manifest read errors gracefully', async () => {
        // Mock fs.readJSON to throw error
        (fs.readJSON as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Failed to read manifest'));

        const bundle = {} as any;
        const generateBundle = mainPlugin.generateBundle as any;
        
        const emittedFiles: any[] = [];
        const emitFile = vi.fn((file: any) => {
            emittedFiles.push(file);
        });

        await generateBundle.call({ emitFile }, {}, bundle);

        expect(emittedFiles.length).toBe(0);
        expect(mockLogger.error).toHaveBeenCalledWith(
            `[vite-plugin-use-main:main] Failed read manifest ${MANIFEST_PATH}: Failed to read manifest`
        );
    });

    it('should generate code that properly handles complex types and nested objects', async () => {
        const testManifest = {
            'test::handleComplexData': {
                id: 'test::handleComplexData',
                name: 'handleComplexData',
                params: [{
                    name: 'config',
                    typeString: '{ settings: { enabled: boolean; threshold: number }; callbacks: Array<(data: any) => void> }'
                }],
                paramsString: 'config: { settings: { enabled: boolean; threshold: number }; callbacks: Array<(data: any) => void> }',
                returnTypeString: 'Promise<number>',
                body: 'return config.settings.threshold;',
                filePath: 'test.ts'
            }
        };

        // Mock fs.readJSON to return our test manifest
        (fs.readJSON as ReturnType<typeof vi.fn>).mockResolvedValue(testManifest);

        const bundle = {} as any;
        const generateBundleMain = mainPlugin.generateBundle as any;
        
        const emittedFiles: any[] = [];
        const emitFile = vi.fn((file: any) => {
            emittedFiles.push(file);
        });

        await generateBundleMain.call({ emitFile }, {}, bundle);

        const mainCode = emittedFiles[0]?.source;
        expect(mainCode).toBeDefined();
        expect(mainCode).toMatch(/async \(_event, ...args\)/);
        // Check for parameter destructuring
        expect(mainCode).toContain('const { config } = params');
        // Check for function body
        expect(mainCode).toContain('return config.settings.threshold');
        // Check for error handling
        expect(mainCode).toContain('catch (error)');
        expect(mainCode).toContain('throw new Error(error?.message || \'Unknown error\')');
    });
});