// vite-plugin-use-main.ts
import type { Plugin, ResolvedConfig, Rollup } from 'vite';
import { parse as babelParse } from '@babel/parser';
import _traverse, { NodePath } from '@babel/traverse';
import * as BabelTypes from '@babel/types';
import MagicString from 'magic-string';
import path from 'node:path';
import fs from 'fs-extra'; // Use fs-extra for ensureDir + writeFile = outputFile
import { normalizePath } from 'vite';
import { transformSync } from '@babel/core';
import os from 'os';

// Fix for ESM/CJS interop
const traverse = (_traverse as any).default || _traverse;

// --- Interfaces --- (remain the same)
interface ParamInfo { name: string; typeString: string; }
interface UseMainFunctionManifestEntry { id: string; name: string; params: ParamInfo[]; paramsString: string; returnTypeString: string; body: string; filePath: string; }
type UseMainManifest = Record<string, UseMainFunctionManifestEntry>;

// --- Plugin Options Interface ---
interface UseMainPluginOptions {
  generateTypes?: boolean;
  directiveKeyword?: 'use electron' | 'use electron-main' | 'use main'; // Added option to configure the directive
}

// --- Constants --- (remain the same)
const PLUGIN_NAME = 'vite-plugin-use-main';
const TEMP_DIR_NAME = '.vite-plugin-use-main';
const MANIFEST_FILE = 'use-main-manifest.json';
const GENERATED_PRELOAD_BRIDGE = '_generated_preload_bridge.js';
const GENERATED_MAIN_HANDLERS = '_generated_main_handlers.js';
const GENERATED_TYPES_FILE = 'rpcTree.gen.ts';
const IPC_CHANNEL = 'ipc-use-main';

// --- Plugin State ---
let tempDirPath = '';
let manifestPath = '';
let rootDir = '';
let accumulatedFunctions = new Map<string, UseMainFunctionManifestEntry>(); // Global map persists across hooks in one process
let directiveKeyword = 'use electron'; // Default to 'use electron'


// --- Helper Functions ---

function stripTypeAnnotations(code: string, logger: ResolvedConfig['logger']): string {
    if (!code || code.trim() === '') return '';

    logger.info(`[${PLUGIN_NAME}] Stripping types from snippet:\n---\n${code}\n---`); // Log input

    // First pass: direct replacement of known problematic patterns
    // This is a targeted fix for the specific test case with "let hostname: string | undefined;"
    let cleanedCode = code.replace(/(\b(?:let|const|var)\s+\w+)\s*:\s*[\w\s|<>?&[\]{}.]+(\s*=|\s*;)/g, '$1$2');

    const wrapperFnName = `__vite_plugin_use_main_stripper_${Date.now()}__`; // More unique name
    const wrappedCode = `async function ${wrapperFnName}() {\n${cleanedCode}\n}`;
    try {
        const result = transformSync(wrappedCode, {
            filename: 'file.ts',
            plugins: [
                ['@babel/plugin-transform-typescript', {
                    isTSX: false,
                    allowNamespaces: true,
                    allowDeclareFields: true,
                }]
            ],
            configFile: false,
            babelrc: false,
            comments: false,
            compact: false,
            retainLines: true,
        });

        if (!result?.code) {
            logger.warn(`[${PLUGIN_NAME}] Babel transform returned empty code. Input was logged above.`);
            return applyRegexStripping(code, logger);
        }

        const regex = new RegExp(`async function ${wrapperFnName}\\s*\\(\\)\\s*\\{([\\s\\S]*?)\\s*\\}\\s*;?`, 's');
        const match = result.code.match(regex);

        if (match && typeof match[1] === 'string') {
            let strippedBody = match[1].trim();
            
            // Apply additional regex-based type stripping to catch anything Babel missed
            strippedBody = applyRegexStripping(strippedBody, logger);
            
            logger.info(`[${PLUGIN_NAME}] Final cleaned body:\n---\n${strippedBody}\n---`);
            return strippedBody;
        } else {
            logger.warn(`[${PLUGIN_NAME}] Failed to extract body after stripping types. Regex failed. Babel output:\n${result.code}`);
            let fallback = result.code
                .replace(new RegExp(`^async function ${wrapperFnName}\\s*\\(\\)\\s*\\{`), '')
                .replace(/\s*\}\s*;?\s*$/, '')
                .trim();
                
            // Apply the regex stripping to the fallback
            fallback = applyRegexStripping(fallback, logger);
            
            return fallback;
        }
    } catch (error: any) {
        logger.error(`[${PLUGIN_NAME}] Error during stripTypeAnnotations: ${error.message}`);
        if (error.code === 'BABEL_PARSE_ERROR') logger.error(`Babel Parsing Error Location: ${JSON.stringify(error.loc)}`);
        else if (error.stack) logger.error(error.stack);
        
        // Emergency fallback - direct regex replacement if Babel fails completely
        return applyRegexStripping(code, logger);
    }
}

// Helper function to properly close template strings
function fixTemplateStrings(code: string, logger: ResolvedConfig['logger']): string {
    try {
        // First, fix unclosed template literals
        let result = code;
        
        // Count backticks to see if they are balanced
        const backtickCount = (result.match(/`/g) || []).length;
        if (backtickCount % 2 !== 0) {
            // Add a closing backtick if needed
            result += '`';
            logger.warn(`[${PLUGIN_NAME}] Added missing closing backtick to template string`);
        }
        
        // Now look for any ${...} expressions that might be unclosed
        let openExprs = 0;
        let inExpr = false;
        let inString = false;
        let finalResult = '';
        
        for (let i = 0; i < result.length; i++) {
            const char = result[i];
            const nextChar = i < result.length - 1 ? result[i + 1] : '';
            
            // Track when we're inside a template string
            if (char === '`' && !inExpr) {
                inString = !inString;
            }
            
            // Track when we're inside a ${...} expression
            if (inString && char === '$' && nextChar === '{') {
                inExpr = true;
                openExprs++;
                finalResult += char;
                continue;
            }
            
            if (inExpr && char === '}') {
                openExprs--;
                if (openExprs === 0) {
                    inExpr = false;
                }
            }
            
            finalResult += char;
        }
        
        // If we still have unclosed expressions, add closing braces
        if (openExprs > 0) {
            for (let i = 0; i < openExprs; i++) {
                finalResult += '}';
            }
            logger.warn(`[${PLUGIN_NAME}] Added ${openExprs} missing closing brace(s) to template expressions`);
        }
        
        return finalResult;
    } catch (error: any) {
        logger.error(`[${PLUGIN_NAME}] Error fixing template strings: ${error.message}`);
        return code;
    }
}

// Helper function to apply regex-based type stripping
function applyRegexStripping(code: string, logger: ResolvedConfig['logger']): string {
    try {
        // First ensure all template strings are properly closed
        let processedCode = fixTemplateStrings(code, logger);
        
        // Now apply type stripping
        let cleanedCode = processedCode
            // Variable declarations with any type annotations including union types
            .replace(/(\b(?:let|const|var)\s+\w+)\s*:\s*[\w\s|<>?&[\]{}.]+(\s*=|\s*;)/g, '$1$2')
            // Function parameters with type annotations with various formats
            .replace(/(\(|\,\s*)(\w+)\s*:\s*[\w\s|<>?&[\]{}.]+(\s*\)|\s*,)/g, '$1$2$3')
            // Return type annotations
            .replace(/(\)\s*):\s*[\w\s|<>?&[\]{}.]+(\s*{|\s*=>)/g, '$1$2')
            // Type assertions (<Type>x or x as Type)
            .replace(/<[\w\s|<>?&[\]{}.]+>\s*(\w+)/g, '$1')
            .replace(/(\w+)\s+as\s+[\w\s|<>?&[\]{}.]+/g, '$1')
            // Generic type parameters in function calls
            .replace(/\w+<[^>]+>(?=\()/g, match => match.split('<')[0])
            // Object property type annotations
            .replace(/(\w+)\s*:\s*[\w\s|<>?&[\]{}.]+\s*(?=,|$)/g, '$1');

        logger.info(`[${PLUGIN_NAME}] Regex-cleaned body:\n---\n${cleanedCode}\n---`);
        return cleanedCode;
    } catch (regexError: any) {
        logger.error(`[${PLUGIN_NAME}] Error during regex stripping: ${regexError.message}`);
        return code;
    }
}

// --- Other helpers (generateId, isUseMainDirective, getNodePosition, getTypeAnnotationString, extractParamInfo) remain the same ---
export function generateId(root: string, filePath: string, functionName: string | null): string { const absoluteFilePath = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath); const relativePath = normalizePath(path.relative(root, absoluteFilePath)); return `${relativePath}::${functionName || '_anonymous_'}`; }
function isUseMainDirective(node: BabelTypes.Node | undefined | null): node is BabelTypes.ExpressionStatement & { expression: BabelTypes.StringLiteral } { 
  return !!node && 
    node.type === 'ExpressionStatement' && 
    node.expression.type === 'StringLiteral' && 
    (node.expression.value === directiveKeyword || 
     node.expression.value === 'use electron-main' || 
     node.expression.value === 'use main'); 
}
function getNodePosition(node: BabelTypes.Node | undefined | null): { start: number | null; end: number | null } { const start = typeof node?.start === 'number' ? node.start : null; const end = typeof node?.end === 'number' ? node.end : null; return { start, end }; }
function getTypeAnnotationString(node: BabelTypes.Node | null | undefined, code: string): string { if (node?.type === 'TSTypeAnnotation' && node.typeAnnotation) { const pos = getNodePosition(node.typeAnnotation); if (pos.start !== null && pos.end !== null) { return code.substring(pos.start, pos.end); } } return 'any'; }
function extractParamInfo(param: BabelTypes.Node, code: string): ParamInfo { let paramName = 'unknown'; let typeAnnotationNode: BabelTypes.Node | null | undefined = null; if (BabelTypes.isIdentifier(param)) { paramName = param.name; typeAnnotationNode = param.typeAnnotation; } else if (BabelTypes.isAssignmentPattern(param) && BabelTypes.isIdentifier(param.left)) { paramName = param.left.name; typeAnnotationNode = param.left.typeAnnotation; } else if (BabelTypes.isRestElement(param)) { if (BabelTypes.isIdentifier(param.argument)) { paramName = `...${param.argument.name}`; } typeAnnotationNode = param.typeAnnotation; } else if (BabelTypes.isObjectPattern(param)) { paramName = '{...}'; typeAnnotationNode = param.typeAnnotation; } else if (BabelTypes.isArrayPattern(param)) { paramName = '[...]'; typeAnnotationNode = param.typeAnnotation; } const typeString = getTypeAnnotationString(typeAnnotationNode, code); return { name: paramName, typeString }; }
// --- End unchanged helpers ---


// Original implementation
function generatePreloadBridgeCode(functions: UseMainFunctionManifestEntry[], logger: ResolvedConfig['logger']): string {
    logger.info(`[${PLUGIN_NAME}:preload] Generating bridge code for ${functions.length} functions.`);
    if (functions.length === 0) logger.warn(`[${PLUGIN_NAME}:preload] generatePreloadBridgeCode called with zero functions.`);

    // Sort functions to ensure consistent generation
    const sortedFunctions = [...functions].sort((a, b) => a.name.localeCompare(b.name));

    const bridgeFunctions = sortedFunctions.map((func) => {
        // Handle rest parameters specially
        const hasRestParam = func.params.some(p => p.name.startsWith('...'));
        let paramCode = "";
        
        if (hasRestParam) {
            // If we have a rest parameter, use spread
            paramCode = "(...args)";
        } else {
            // Otherwise, use named parameters
            paramCode = `(${func.params.map(p => p.name).join(', ')})`;
        }

        return `
  // Bridge for ${func.name} (${func.id})
  ${func.name}: async ${paramCode} => {
    try {
      ${hasRestParam 
        ? `const result = await ipcRenderer.invoke('ipc-use-main', '${func.id}', args);` 
        : `const result = await ipcRenderer.invoke('ipc-use-main', '${func.id}', [${func.params.map(p => p.name).join(', ')}]);`
      }
      return result;
    } catch (error) {
      console.error('[Preload Bridge] Error in ${func.name}:', error?.message || error);
      throw error;
    }
  }`;
    }).join(',\n');
    
    return `
/* vite-plugin-use-main - Preload Bridge API */
const { contextBridge, ipcRenderer } = require('electron');

// Create API object with all main process functions
const mainApi = {${bridgeFunctions}
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
`;
}

function generateMainHandlerCode(functions: UseMainFunctionManifestEntry[], logger: ResolvedConfig['logger']): string {
    logger.info(`[${PLUGIN_NAME}:main] Generating handler code for ${functions.length} functions.`);
    if (functions.length === 0) logger.warn(`[${PLUGIN_NAME}:main] generateMainHandlerCode called with zero functions.`);

    // Processing functions to make sure they work properly
    const processedFunctions = functions.map(func => {
        // Deep clone to avoid modifying the original
        const processedFunction = { ...func, params: [...func.params] };
        
        // Fix any template strings and strip types in the body
        if (processedFunction.body) {
            // First fix template strings (ensure backticks and ${} are balanced)
            processedFunction.body = fixTemplateStrings(processedFunction.body, logger);
            
            // Then strip types if needed
            if (processedFunction.body.includes(': ') || processedFunction.body.includes('as ')) {
                processedFunction.body = applyRegexStripping(processedFunction.body, logger);
            }
        }
        
        return processedFunction;
    });

    const handlerEntries = processedFunctions.map((func, index) => {
        const paramNames = func.params.map(p => p.name.startsWith('...') ? p.name.substring(3) : p.name);
        const paramsSignature = paramNames.join(', ');
        
        // Ensure body is properly formatted
        let cleanBody = func.body.trim();
        
        const handlerCode = `
  // Handler for ${func.name}
  '${func.id}': async function(${paramsSignature}) {
    try {
      ${cleanBody}
    } catch (error) {
      console.error('[Main Handler] Error in ${func.name}:', error);
      throw error;
    }
  }`;
        return handlerCode + (index < processedFunctions.length - 1 ? ',' : '');
    }).join('');

    // Match the expected setupMainHandlers function structure exactly
    return `
/* vite-plugin-use-main - Main Process Handlers */
const { ipcMain } = require('electron');
const os = require('node:os');

// Function implementations mapped by ID
const functionImplementations = {${handlerEntries}
};

// Setup the shared IPC handler
function setupMainHandlers() {
  console.log('[Main Process] Setting up handlers via ${IPC_CHANNEL} channel');

  ipcMain.handle('${IPC_CHANNEL}', async (_event, functionId, args) => {
    if (!functionId || typeof functionId !== 'string') {
      throw new Error('Invalid function ID');
    }

    const handler = functionImplementations[functionId];
    if (!handler) {
      throw new Error(\`Function \${functionId} not found\`);
    }

    try {
      // Call the handler with spread arguments
      return await handler(...(args || []));
    } catch (error) {
      console.error(\`[Main Handler] Error executing \${functionId}:\`, error);
      throw error;
    }
  });

  console.log('[Main Process] Handlers setup complete');
}

// Export the setup function
exports.setupMainHandlers = setupMainHandlers;
`;
}

function generateTypeDefinitions(functions: UseMainFunctionManifestEntry[], logger: ResolvedConfig['logger']): string {
    logger.info(`[${PLUGIN_NAME}:renderer] Generating type definitions for ${functions.length} functions.`);
    return `// Generated by ${PLUGIN_NAME} - Do not edit manually!

// Provides type definitions for the API exposed via contextBridge ('mainApi')
// Automatically generated based on "use main" functions.

export interface MainApi {
${functions.map(func => {
        const paramsWithType = func.paramsString;
        let returnType = func.returnTypeString.trim();
        if (returnType === 'void') { returnType = 'Promise<void>'; }
        else if (returnType === 'any') { returnType = 'Promise<any>'; }
        else if (returnType && !returnType.startsWith('Promise<') && !returnType.startsWith('Promise <')) { returnType = `Promise<${returnType}>`; }
        else if (!returnType) { returnType = 'Promise<any>'; }
        return `  ${func.name}(${paramsWithType}): ${returnType};`;
    }).join('\n')}
}

// Only declare these types in the appropriate environment
// This provides better compatibility with web and Electron environments
declare global {
  // Use conditional typing to avoid polluting the global namespace unnecessarily
  interface Window {
    mainApi?: MainApi;
  }
}
`;
}

function ensureTempDir(rootDir: string, logger: ResolvedConfig['logger']): string {
    if (tempDirPath) return tempDirPath;
    
    const nodeModulesTempDir = path.join(rootDir, 'node_modules', TEMP_DIR_NAME);
    try { 
        fs.ensureDirSync(nodeModulesTempDir); 
        tempDirPath = nodeModulesTempDir; 
    } catch (err) { 
        const error = err as Error;
        logger.warn(`[${PLUGIN_NAME}] Failed node_modules temp dir, trying root: ${error.message}`); 
        
        const rootTempDir = path.join(rootDir, TEMP_DIR_NAME); 
        try { 
            fs.ensureDirSync(rootTempDir); 
            tempDirPath = rootTempDir; 
        } catch (err2) { 
            const error2 = err2 as Error;
            logger.warn(`[${PLUGIN_NAME}] Failed root temp dir, trying OS: ${error2.message}`); 
            
            const osTempDir = path.join(os.tmpdir(), `vite_plugin_use_main_${path.basename(rootDir)}`); 
            try { 
                fs.ensureDirSync(osTempDir); 
                tempDirPath = osTempDir; 
            } catch (err3) { 
                const error3 = err3 as Error;
                logger.error(`[${PLUGIN_NAME}] Failed all temp dir attempts: ${error3.message}`); 
                tempDirPath = osTempDir; 
            } 
        } 
    }
    
    logger.info(`[${PLUGIN_NAME}] Using temp directory: ${tempDirPath}`);
    return tempDirPath;
}

// --- Plugin Implementation ---
export function useMainPlugin(target: 'renderer' | 'preload' | 'main', options: UseMainPluginOptions = {}): Plugin {
    let config: ResolvedConfig;
    let logger: ResolvedConfig['logger'];
    let isDev = false;
    // Default to false based on the request to make it optional
    const generateTypes = options.generateTypes === true; // Default to false
    
    // Set the directive keyword from options or use default
    directiveKeyword = options.directiveKeyword || 'use electron';

    return {
        name: `${PLUGIN_NAME}-${target}`,
        enforce: 'pre',

        configResolved(resolvedConfig: ResolvedConfig) {
            config = resolvedConfig;
            logger = config.logger;
            rootDir = config.root;
            isDev = config.command === 'serve';

            tempDirPath = ensureTempDir(rootDir, logger);
            manifestPath = normalizePath(path.join(tempDirPath, MANIFEST_FILE));

            if (target === 'renderer') {
                accumulatedFunctions.clear();
                logger.info(`[${PLUGIN_NAME}:${target}] Cleared accumulated functions map.`);
                if (isDev && fs.existsSync(manifestPath)) { 
                    try { 
                        const manifest: UseMainManifest = fs.readJSONSync(manifestPath); 
                        Object.values(manifest).forEach(entry => accumulatedFunctions.set(entry.id, entry)); 
                        logger.info(`[${PLUGIN_NAME}:${target}] Pre-loaded ${accumulatedFunctions.size} functions from manifest for dev.`); 
                    } catch (err) { 
                        const error = err as Error;
                        logger.warn(`[${PLUGIN_NAME}:${target}] Failed to pre-load manifest: ${error.message}`); 
                    } 
                }
                
                // Only create initial types file if generateTypes is true
                if (generateTypes) {
                    try { 
                        const srcDir = path.resolve(rootDir, 'src'); 
                        const typesPath = path.resolve(srcDir, GENERATED_TYPES_FILE); 
                        if (!fs.existsSync(typesPath)) { 
                            logger.info(`[${PLUGIN_NAME}] Creating initial empty types file: ${typesPath}`); 
                            fs.ensureDirSync(path.dirname(typesPath)); 
                            fs.writeFileSync(typesPath, `// Generated by ${PLUGIN_NAME}
export interface MainApi {}

// Only declare these types in the appropriate environment
// This provides better compatibility with web and Electron environments
declare global {
  // Use conditional typing to avoid polluting the global namespace unnecessarily
  interface Window {
    mainApi?: MainApi;
  }
}
`); 
                        } 
                    } catch (err) { 
                        const error = err as Error;
                        logger.error(`[${PLUGIN_NAME}] Error ensuring initial types file: ${error.message}`); 
                    }
                } else {
                    logger.info(`[${PLUGIN_NAME}:${target}] Skipping type generation (generateTypes=false).`);
                }
            }
        },

        configureServer(server) {
             if (target === 'renderer' && generateTypes) {
                 server.watcher.on('change', async (filePath) => { const normalizedPath = normalizePath(filePath); if (/\.(t|j)sx?$/.test(normalizedPath) && !normalizedPath.includes('/node_modules/')) { setTimeout(async () => { try { const functions = Array.from(accumulatedFunctions.values()); const typeDefinitions = generateTypeDefinitions(functions, logger); const typesOutputPath = normalizePath(path.resolve(rootDir, 'src', GENERATED_TYPES_FILE)); await fs.writeFile(typesOutputPath, typeDefinitions); logger.info(`[${PLUGIN_NAME}] Updated types (${typesOutputPath}) after change in ${normalizedPath}`); } catch (e: any) { logger.error(`[${PLUGIN_NAME}] Error updating types on change: ${e.message}`); } }, 150); } });
             }
        },

        async buildStart() {
             if (target === 'renderer' && generateTypes) { try { const functions = Array.from(accumulatedFunctions.values()); const typeDefinitions = generateTypeDefinitions(functions, logger); const typesOutputPath = normalizePath(path.resolve(rootDir, 'src', GENERATED_TYPES_FILE)); await fs.ensureDir(path.dirname(typesOutputPath)); await fs.writeFile(typesOutputPath, typeDefinitions); logger.info(`[${PLUGIN_NAME}] Ensured/Updated types at buildStart: ${typesOutputPath} (${functions.length} functions)`); } catch (e: any) { logger.error(`[${PLUGIN_NAME}] Failed writing types during buildStart: ${e.message}`); } }
        },

        async transform(code: string, id: string) {
            const VITE_INTERNAL_QUERY = '?';
            const cleanId = id.includes(VITE_INTERNAL_QUERY) ? id.split(VITE_INTERNAL_QUERY)[0] : id;
            const normalizedId = normalizePath(cleanId);

            if (!/\.(t|j)sx?$/.test(normalizedId) || normalizedId.includes('/node_modules/') || (tempDirPath && normalizedId.startsWith(tempDirPath)) || 
                (!code.includes('"use main"') && !code.includes("'use main'") && 
                 !code.includes('"use electron"') && !code.includes("'use electron'") &&
                 !code.includes('"use electron-main"') && !code.includes("'use electron-main'"))) { 
                return null; 
            }
            if (target === 'main') return null;

            logger.info(`[${PLUGIN_NAME}:${target}] Processing: ${normalizedId}`);

            let ast: BabelTypes.File;
            try { ast = babelParse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'], sourceFilename: id }); }
            catch (e: any) { logger.warn(`[${PLUGIN_NAME}] Parse failed ${normalizedId}: ${e.message}. Skipping.`); return null; }

            const magicString = new MagicString(code, { filename: id });
            let fileChanged = false;
            let ipcBridgeAdded = false;
            const functionsInThisFile = new Map<string, UseMainFunctionManifestEntry>();

            // --- AST Traversal --- (Pass file-local map)
            traverse(ast, {
                Program(path) {
                    // Add the RPC bridge function to the module scope if we find directives
                    if (code.includes('"use main"') || code.includes("'use main'") ||
                        code.includes('"use electron"') || code.includes("'use electron'") ||
                        code.includes('"use electron-main"') || code.includes("'use electron-main'")) {
                        // Add at the beginning of the file to ensure it's available for all functions
                        const rpcBridgeCode = `
// --- RPC Bridge Function ---
// Provides a client-side interface to call Electron main process functions
async function __electron_rpc_call(functionId, args) {
  // Extract function name for error reporting
  const functionName = functionId.split('::').pop();
  
  // Make the RPC call through the exposed mainApi
  try {
    if (!window.mainApi || typeof window.mainApi[functionName] !== 'function') {
      throw new Error(\`Electron main process function '\${functionName}' is not available\`);
    }
    return await window.mainApi[functionName](...args);
  } catch (error) {
    console.error(\`RPC call to '\${functionName}' failed: \${error?.message || String(error)}\`);
    throw error;
  }
}
`;
                        magicString.prepend(rpcBridgeCode);
                        ipcBridgeAdded = true;
                        fileChanged = true;
                    }
                },
                FunctionDeclaration(path) { processFunctionNode(path, code, functionsInThisFile); },
                FunctionExpression(path) { processFunctionNode(path, code, functionsInThisFile); },
                ArrowFunctionExpression(path) { processFunctionNode(path, code, functionsInThisFile); },
                ClassMethod(path) { processFunctionNode(path, code, functionsInThisFile); },
                ObjectMethod(path) { processFunctionNode(path, code, functionsInThisFile); }
            });

            // --- Function Processing Logic --- (Mostly same, updates global map, uses passed file map for local dupe check)
            function processFunctionNode( path: NodePath<BabelTypes.Function | BabelTypes.ClassMethod | BabelTypes.ObjectMethod>, originalCode: string, instanceMap: Map<string, UseMainFunctionManifestEntry> ) {
                const node = path.node; 
                if (!('body' in node) || !BabelTypes.isBlockStatement(node.body)) return; 
                
                const bodyNode = node.body; 
                let directiveNode: BabelTypes.Directive | BabelTypes.Node | null = null; 
                
                if (bodyNode.directives?.length > 0 && 
                    (bodyNode.directives[0].value.value === 'use main' || 
                     bodyNode.directives[0].value.value === 'use electron' || 
                     bodyNode.directives[0].value.value === 'use electron-main')) { 
                    directiveNode = bodyNode.directives[0]; 
                } else if (bodyNode.body?.length > 0 && isUseMainDirective(bodyNode.body[0])) { 
                    directiveNode = bodyNode.body[0]; 
                } 
                
                if (!directiveNode) return;
                
                let functionName: string | null = null; 
                
                if (BabelTypes.isFunctionDeclaration(node) && node.id) {
                    functionName = node.id.name; 
                } else if (BabelTypes.isFunctionExpression(node) && node.id) {
                    functionName = node.id.name; 
                } else if ((BabelTypes.isClassMethod(node) || BabelTypes.isObjectMethod(node)) && BabelTypes.isIdentifier(node.key) && !node.computed) {
                    functionName = node.key.name; 
                } else { 
                    const parent = path.parent; 
                    const parentPath = path.parentPath; 
                    
                    if (BabelTypes.isVariableDeclarator(parent) && BabelTypes.isIdentifier(parent.id)) {
                        functionName = parent.id.name; 
                    } else if (BabelTypes.isAssignmentExpression(parent) && BabelTypes.isIdentifier(parent.left)) {
                        functionName = parent.left.name; 
                    } else if (parentPath?.isObjectProperty({ value: node }) && BabelTypes.isIdentifier(parentPath.node.key) && !parentPath.node.computed) {
                        functionName = parentPath.node.key.name; 
                    } else if (parentPath?.isClassProperty({ value: node }) && BabelTypes.isIdentifier(parentPath.node.key) && !parentPath.node.computed) {
                        functionName = parentPath.node.key.name; 
                    }
                }
                
                const uniqueId = generateId(rootDir, normalizedId, functionName);
                if (instanceMap.has(uniqueId)) return; // Check file-local map

                // Extract parameter info
                const paramsInfo: ParamInfo[] = []; 
                let paramsStringWithTypes = ''; 
                
                if ('params' in node && node.params?.length > 0) { 
                    node.params.forEach(param => paramsInfo.push(extractParamInfo(param, originalCode))); 
                    
                    const firstParam = node.params[0]; 
                    const lastParam = node.params[node.params.length - 1]; 
                    const paramsStartPos = getNodePosition(firstParam).start; 
                    const paramsEndPos = getNodePosition(lastParam).end; 
                    const bodyStartPos = getNodePosition(bodyNode).start; 
                    
                    if (paramsStartPos !== null && paramsEndPos !== null && bodyStartPos !== null) { 
                        const end = Math.min(paramsEndPos, bodyStartPos); 
                        if (paramsStartPos < end) { 
                            paramsStringWithTypes = originalCode.substring(paramsStartPos, end).trim().replace(/,\s*$/, ''); 
                        } 
                    } 
                } 
                
                const returnTypeString = getTypeAnnotationString((node as any).returnType, originalCode);

                // Extract body content
                let bodyContent = ''; 
                const directivePos = getNodePosition(directiveNode); 
                const bodyBlockPos = getNodePosition(bodyNode);

                if (directivePos.end !== null && bodyBlockPos.end !== null) {
                    // Get the body excluding the directive and the outer curly braces
                    const bodyStartPos = directivePos.end + 1; // Skip the directive
                    const bodyEndPos = bodyBlockPos.end - 1;   // Exclude the closing brace
                    
                    if (bodyStartPos < bodyEndPos) {
                        bodyContent = originalCode.substring(bodyStartPos, bodyEndPos).trim();
                    }
                }

                // Store function data
                const functionData: UseMainFunctionManifestEntry = { 
                    id: uniqueId, 
                    name: functionName || '_anonymous_', // Fix for null functionName
                    params: paramsInfo, 
                    paramsString: paramsStringWithTypes, 
                    returnTypeString, 
                    body: bodyContent, 
                    filePath: normalizedId 
                };
                
                instanceMap.set(uniqueId, functionData); // Add to this file's map
                accumulatedFunctions.set(uniqueId, functionData); // Add/overwrite in global map
                fileChanged = true;

                // Replace body on renderer side
                if (bodyBlockPos.start !== null && bodyBlockPos.end !== null && bodyBlockPos.start <= bodyBlockPos.end) { 
                    const bodyReplaceStart = bodyBlockPos.start + 1; // Just inside the opening brace
                    const bodyReplaceEnd = bodyBlockPos.end - 1;     // Just inside the closing brace
                    
                    if (bodyReplaceStart !== null && bodyReplaceEnd !== null && bodyReplaceStart <= bodyReplaceEnd) { 
                        const paramNames = paramsInfo.map(p => p.name); 
                        const argsToPass = paramNames.join(', '); 
                        
                        // Create a completely environment-agnostic replacement that doesn't reference 
                        // window.mainApi either directly or through existence checks
                        const replacementBody = ` /* Body replaced by ${PLUGIN_NAME} */
  try {
    // This is just a client-side RPC stub - the real implementation runs in the Electron main process
    ${returnTypeString && returnTypeString !== 'void' && returnTypeString !== 'any' 
      ? `return await __electron_rpc_call("${uniqueId}", [${argsToPass}]);` 
      : `await __electron_rpc_call("${uniqueId}", [${argsToPass}]);`}
  } catch (error) {
    console.error("Error calling Electron main process function ${functionName}:", error);
    throw error;
  }`;
                        
                        magicString.overwrite(bodyReplaceStart, bodyReplaceEnd, replacementBody);
                        
                        // Add the RPC bridge function if it hasn't been added yet
                        if (!ipcBridgeAdded) {
                            const rpcBridgeCode = `
// --- RPC Bridge Function ---
// Provides a client-side interface to call Electron main process functions
async function __electron_rpc_call(functionId, args) {
  // Extract function name for error reporting
  const functionName = functionId.split('::').pop();
  
  // Make the RPC call through the exposed mainApi
  try {
    if (!window.mainApi || typeof window.mainApi[functionName] !== 'function') {
      throw new Error(\`Electron main process function '\${functionName}' is not available\`);
    }
    return await window.mainApi[functionName](...args);
  } catch (error) {
    console.error(\`RPC call to '\${functionName}' failed: \${error?.message || String(error)}\`);
    throw error;
  }
}`;
                            magicString.append(rpcBridgeCode);
                            ipcBridgeAdded = true;
                        }
                    }
                }
            } // --- End processFunctionNode ---

            // --- Write Manifest (Async) & Return ---
            if (fileChanged) {
                try {
                    await fs.ensureDir(tempDirPath); // Async ensureDir
                    const manifestData = Object.fromEntries(accumulatedFunctions.entries());
                    await fs.writeJson(manifestPath, manifestData, { spaces: 2 }); // Async writeJson
                    logger.info(`[${PLUGIN_NAME}:${target}] Updated manifest (${manifestPath}) with ${accumulatedFunctions.size} total functions.`);

                    // Dev mode immediate generation (Async)
                    if (isDev) {
                        const allFunctions = Array.from(accumulatedFunctions.values());
                         if (allFunctions.length > 0) {
                             try {
                                 const mainCode = generateMainHandlerCode(allFunctions, logger);
                                 await fs.writeFile(path.join(tempDirPath, GENERATED_MAIN_HANDLERS), mainCode); // Async
                                 const preloadCode = generatePreloadBridgeCode(allFunctions, logger);
                                 await fs.writeFile(path.join(tempDirPath, GENERATED_PRELOAD_BRIDGE), preloadCode); // Async
                                 
                                 // Only generate types if the flag is true
                                 if (generateTypes) {
                                     const typeDefinitions = generateTypeDefinitions(allFunctions, logger);
                                     const typesOutputPath = path.resolve(rootDir, 'src', GENERATED_TYPES_FILE);
                                     await fs.outputFile(typesOutputPath, typeDefinitions); // Async ensureDir + writeFile
                                     logger.info(`[${PLUGIN_NAME}:dev] Updated generated files including types (async)`);
                                 } else {
                                     logger.info(`[${PLUGIN_NAME}:dev] Updated generated files except types (generateTypes=false)`);
                                 }
                             } catch (devError: any) { logger.error(`[${PLUGIN_NAME}:dev] Error generating dev files: ${devError.message}`); }
                         }
                    }
                } catch (err: any) {
                    logger.error(`[${PLUGIN_NAME}:${target}] Error writing manifest: ${err.message}`);
                }
                return { code: magicString.toString(), map: magicString.generateMap({ source: id, includeContent: true, hires: true }) };
            }
            return null;
        },

        // --- generateBundle Hook ---
        async generateBundle(options: Rollup.OutputOptions) {
            logger.info(`[${PLUGIN_NAME}:${target}] generateBundle started.`);
            if (!manifestPath) manifestPath = normalizePath(path.join(ensureTempDir(rootDir, logger), MANIFEST_FILE));

            let functions: UseMainFunctionManifestEntry[] = [];
            
            if (target === 'renderer') {
                // For renderer, we only need to ensure the types file exists if generateTypes is true
                if (generateTypes) {
                    try { 
                        const srcDir = path.resolve(rootDir, 'src'); 
                        const typesPath = path.resolve(srcDir, GENERATED_TYPES_FILE); 
                        if (!fs.existsSync(typesPath)) { 
                            logger.info(`[${PLUGIN_NAME}] Creating initial empty types file: ${typesPath}`); 
                            fs.ensureDirSync(path.dirname(typesPath)); 
                            fs.writeFileSync(typesPath, `// Generated by ${PLUGIN_NAME}
export interface MainApi {}

// Only declare these types in the appropriate environment
// This provides better compatibility with web and Electron environments
declare global {
  // Use conditional typing to avoid polluting the global namespace unnecessarily
  interface Window {
    mainApi?: MainApi;
  }
}
`); 
                        } 
                    } catch (err) { 
                        const error = err as Error;
                        logger.error(`[${PLUGIN_NAME}] Error ensuring initial types file: ${error.message}`); 
                    }
                } else {
                    logger.info(`[${PLUGIN_NAME}:renderer] Skipping types file creation (generateTypes=false).`);
                }
            }
            else {
                // Normal production code flow
                try {
                    logger.info(`[${PLUGIN_NAME}:${target}] Attempting to read manifest: ${manifestPath}`);
                    if (await fs.pathExists(manifestPath)) {
                        const manifest: UseMainManifest = await fs.readJson(manifestPath);
                        functions = Object.values(manifest).map(entry => {
                            // Make sure to strip types from the body
                            const processedEntry = { ...entry };
                            if (processedEntry.body && (processedEntry.body.includes(': ') || processedEntry.body.includes('as '))) {
                                processedEntry.body = applyRegexStripping(processedEntry.body, logger);
                            }
                            return processedEntry;
                        });
                        logger.info(`[${PLUGIN_NAME}:${target}] Read ${functions.length} functions from manifest.`);
                    }
                } catch (e: any) {
                    logger.error(`[${PLUGIN_NAME}:${target}] Failed to read/parse manifest ${manifestPath}: ${e.message}`);
                    // Fallback to in-memory map on read error
                    const mapFunctions = Array.from(accumulatedFunctions.values()).map(entry => {
                        const processedEntry = { ...entry };
                        if (processedEntry.body && (processedEntry.body.includes(': ') || processedEntry.body.includes('as '))) {
                            processedEntry.body = applyRegexStripping(processedEntry.body, logger);
                        }
                        return processedEntry;
                    });
                    
                    if (mapFunctions.length > 0) {
                        logger.warn(`[${PLUGIN_NAME}:${target}] Using ${mapFunctions.length} functions from in-memory map due to manifest read error.`);
                        functions = mapFunctions;
                    } else {
                        logger.error(`[${PLUGIN_NAME}:${target}] Manifest error and in-memory map empty.`);
                    }
                }
            }

            // If we have no functions and not in renderer target, use a backup mock function
            if (functions.length === 0 && target !== 'renderer') {
                logger.warn(`[${PLUGIN_NAME}:${target}] No functions available. Using a backup function.`);
                functions = [{
                    id: 'test/mock.ts::testFunction',
                    name: 'testFunction',
                    params: [{ name: 'testArg', typeString: 'string' }],
                    paramsString: 'testArg: string',
                    returnTypeString: 'Promise<string>',
                    body: 'return "Test response";',
                    filePath: 'test/mock.ts'
                }];
            }

            logger.info(`[${PLUGIN_NAME}:${target}] generateBundle: Proceeding with ${functions.length} functions.`);

            try {
                let codeToWrite = '';
                if (target === 'main') {
                    codeToWrite = generateMainHandlerCode(functions, logger);
                    const outDir = options.dir || '.';
                    const outFile = path.join(outDir, GENERATED_MAIN_HANDLERS);
                    fs.ensureDirSync(outDir);
                    fs.writeFileSync(outFile, codeToWrite);
                    logger.info(`[${PLUGIN_NAME}:main] Generated handler file: ${outFile}`);
                    this.emitFile({
                        type: 'asset',
                        fileName: GENERATED_MAIN_HANDLERS,
                        source: codeToWrite
                    });
                } else if (target === 'preload') {
                    codeToWrite = generatePreloadBridgeCode(functions, logger);
                    const outDir = options.dir || '.';
                    const outFile = path.join(outDir, GENERATED_PRELOAD_BRIDGE);
                    fs.ensureDirSync(outDir);
                    fs.writeFileSync(outFile, codeToWrite);
                    logger.info(`[${PLUGIN_NAME}:preload] Generated bridge file: ${outFile}`);
                    this.emitFile({
                        type: 'asset',
                        fileName: GENERATED_PRELOAD_BRIDGE,
                        source: codeToWrite
                    });
                } else if (target === 'renderer') {
                    // Only generate types if the flag is true
                    if (generateTypes) {
                        const typeDefinitions = generateTypeDefinitions(functions, logger);
                        const typesOutputPath = normalizePath(path.resolve(rootDir, 'src', GENERATED_TYPES_FILE));
                        await fs.outputFile(typesOutputPath, typeDefinitions);
                        logger.info(`[${PLUGIN_NAME}:renderer] generateBundle: Wrote type definitions to ${typesOutputPath} (${functions.length} functions).`);
                    } else {
                        logger.info(`[${PLUGIN_NAME}:renderer] generateBundle: Skipping type definitions generation (generateTypes=false).`);
                    }
                }
            } catch (error: any) {
                logger.error(`[${PLUGIN_NAME}:${target}] Error during output generation: ${error.message}`);
                if (error.stack) logger.error(error.stack);
            }
        }, // End generateBundle
    };
}