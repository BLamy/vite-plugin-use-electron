/* eslint-disable @typescript-eslint/no-explicit-any */
// vite-plugin-use-electron.ts (Corrected v3)

import type { Plugin, ResolvedConfig, Rollup } from 'vite';
import { parse as babelParse, ParserPlugin } from '@babel/parser';
import _traverse, { NodePath } from '@babel/traverse';
import _generate from '@babel/generator';
import * as BabelTypes from '@babel/types';
import MagicString from 'magic-string';
import path from 'path';
import fs from 'fs-extra';
import { normalizePath } from 'vite';
import os from 'os';
import * as ts from 'typescript';

const traverse = ((_traverse as any).default as typeof _traverse) || _traverse;
const generate = ((_generate as any).default as typeof _generate) || _generate;

// --- Interfaces (remain the same) ---
interface ParamInfo {
  name: string;
  typeString: string;
}
interface UseMainFunctionManifestEntry {
  id: string;
  name: string;
  params: ParamInfo[];
  paramsString: string;
  returnTypeString: string;
  body: string;
  filePath: string;
  imports: string[];
}
type UseMainManifest = Record<string, UseMainFunctionManifestEntry>;
interface useElectronMainPluginOptions {
  generateTypes?: boolean;
  directiveKeyword?: 'use electron' | 'use electron-main' | 'use main';
}

// --- Constants (remain the same) ---
const PLUGIN_NAME = 'vite-plugin-use-electron';
const TEMP_DIR_NAME = '.vite-plugin-use-electron';
const MANIFEST_FILE = 'use-electron-manifest.json';
const GENERATED_PRELOAD_BRIDGE = '_generated_preload_bridge.js';
const GENERATED_MAIN_HANDLERS = '_generated_main_handlers.js';
const GENERATED_TYPES_FILE = 'rpcTree.gen.ts';
const BUILTIN_MODULES = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
]);

// --- Plugin State ---
let tempDirPath = '';
let manifestPath = '';
let rootDir = '';
const accumulatedFunctions = new Map<string, UseMainFunctionManifestEntry>(); // Use const
let directiveKeyword = 'use electron';

// --- Helper Functions ---

function generateId(
  root: string,
  filePath: string,
  functionName: string | null
): string {
  const absoluteFilePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(root, filePath);
  const relativePath = normalizePath(path.relative(root, absoluteFilePath));
  return `${relativePath}::${functionName || '_anonymous_'}`;
}

function isUseElectronDirectiveNode(
  node: BabelTypes.Node | undefined | null
): node is
  | (BabelTypes.ExpressionStatement & { expression: BabelTypes.StringLiteral })
  | BabelTypes.Directive {
  // Check for ExpressionStatement ("use electron";)
  if (
    node?.type === 'ExpressionStatement' &&
    node.expression.type === 'StringLiteral' &&
    node.expression.value === directiveKeyword
  )
    return true;
  // Check for Directive node ('use electron')
  if (
    node?.type === 'Directive' &&
    node.value?.type === 'DirectiveLiteral' &&
    node.value.value === directiveKeyword
  )
    return true;
  return false;
}

function getNodePosition(node: BabelTypes.Node | undefined | null): {
  start: number | null;
  end: number | null;
} {
  return { start: node?.start ?? null, end: node?.end ?? null };
}

function getTypeAnnotationString(
  node: BabelTypes.Node | null | undefined,
  code: string
): string {
  if (node?.type === 'TSTypeAnnotation' && node.typeAnnotation) {
    const pos = getNodePosition(node.typeAnnotation);
    if (pos.start !== null && pos.end !== null)
      return code.substring(pos.start, pos.end);
  }
  return 'any';
}

function extractParamInfo(param: BabelTypes.Node, code: string): ParamInfo {
  let paramName = 'unknown',
    typeAnnotationNode: BabelTypes.Node | null | undefined = null;
  if (BabelTypes.isIdentifier(param)) {
    paramName = param.name;
    typeAnnotationNode = param.typeAnnotation;
  } else if (
    BabelTypes.isAssignmentPattern(param) &&
    BabelTypes.isIdentifier(param.left)
  ) {
    paramName = param.left.name;
    typeAnnotationNode = param.left.typeAnnotation;
  } else if (BabelTypes.isRestElement(param)) {
    if (BabelTypes.isIdentifier(param.argument))
      paramName = `...${param.argument.name}`;
    else paramName = '...rest';
    typeAnnotationNode = param.typeAnnotation;
  } else if (BabelTypes.isObjectPattern(param)) {
    paramName = '{}';
    typeAnnotationNode = param.typeAnnotation;
  } else if (BabelTypes.isArrayPattern(param)) {
    paramName = '[]';
    typeAnnotationNode = param.typeAnnotation;
  }
  const typeString = getTypeAnnotationString(typeAnnotationNode, code);
  return { name: paramName, typeString };
}

// Babel-based type stripping (remains the same preferred method)
function stripTypesFromCodeBabel(
  code: string,
  logger: ResolvedConfig['logger']
): string {
  try {
    logger.info(`[${PLUGIN_NAME}] Start stripTypesFromCodeBabel, code length: ${code.length}`);
    if (code.includes('return ')) {
      logger.info(`[${PLUGIN_NAME}] Code contains return statement before stripping types`);
    }
    
    const ast = babelParse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      errorRecovery: true,
    });

    traverse(ast, {
      TSTypeAnnotation(path: NodePath<BabelTypes.TSTypeAnnotation>) {
        path.remove();
      },
      TSTypeParameterDeclaration(
        path: NodePath<BabelTypes.TSTypeParameterDeclaration>
      ) {
        path.remove();
      },
      TSTypeParameterInstantiation(
        path: NodePath<BabelTypes.TSTypeParameterInstantiation>
      ) {
        path.remove();
      },
      TSDeclareFunction(path: NodePath<BabelTypes.TSDeclareFunction>) {
        path.remove();
      },
      TSDeclareMethod(path: NodePath<BabelTypes.TSDeclareMethod>) {
        path.remove();
      },
      TSInterfaceDeclaration(
        path: NodePath<BabelTypes.TSInterfaceDeclaration>
      ) {
        path.remove();
      },
      TSTypeAliasDeclaration(
        path: NodePath<BabelTypes.TSTypeAliasDeclaration>
      ) {
        path.remove();
      },
      TSEnumDeclaration(path: NodePath<BabelTypes.TSEnumDeclaration>) {
        path.remove();
      },
      ClassDeclaration(path: NodePath<BabelTypes.ClassDeclaration>) {
        path.node.implements = null;
        path.node.superTypeParameters = null;
      },
      ClassMethod(path: NodePath<BabelTypes.ClassMethod>) {
        path.node.returnType = null;
        path.node.typeParameters = null;
        path.node.accessibility = undefined;
      },
      ClassProperty(path: NodePath<BabelTypes.ClassProperty>) {
        path.node.typeAnnotation = null;
        path.node.accessibility = undefined;
        path.node.readonly = undefined;
      },
      Function(path: NodePath<BabelTypes.Function>) {
        path.node.returnType = null;
        path.node.typeParameters = null;
        path.get('params').forEach((paramPath: NodePath<BabelTypes.Node>) => {
          if (paramPath.isIdentifier()) paramPath.node.typeAnnotation = null;
          else if (
            paramPath.isAssignmentPattern() &&
            paramPath.node.left.type === 'Identifier'
          )
            paramPath.node.left.typeAnnotation = null;
          else if (paramPath.isRestElement())
            paramPath.node.typeAnnotation = null;
        });
      },
      ReturnStatement(path: NodePath<BabelTypes.ReturnStatement>) {
        // Log when we encounter return statements to verify they're preserved
        logger.info(`[${PLUGIN_NAME}] Found return statement during type stripping`);
      },
      VariableDeclarator(path: NodePath<BabelTypes.VariableDeclarator>) {
        if (path.node.id.type === 'Identifier') {
          path.node.id.typeAnnotation = null;
        } else if (path.node.id.type === 'ObjectPattern') {
          path.node.id.typeAnnotation = null;
        } else if (path.node.id.type === 'ArrayPattern') {
          path.node.id.typeAnnotation = null;
        }
      },
      CallExpression(path: NodePath<BabelTypes.CallExpression>) {
        path.node.typeArguments = null;
        path.node.typeParameters = null;
      },
      TSAsExpression(path: NodePath<BabelTypes.TSAsExpression>) {
        path.replaceWith(path.node.expression);
      },
      ImportDeclaration(path: NodePath<BabelTypes.ImportDeclaration>) {
        if (path.node.importKind === 'type') {
          path.remove();
        } else {
          path.node.specifiers = path.node.specifiers.filter(
            (
              spec: BabelTypes.Node
            ): spec is
              | BabelTypes.ImportSpecifier
              | BabelTypes.ImportDefaultSpecifier
              | BabelTypes.ImportNamespaceSpecifier =>
              !(spec.type === 'ImportSpecifier' && spec.importKind === 'type')
          );
          if (path.node.specifiers.length === 0) path.remove();
        }
      },
    });

    // Generate JavaScript output
    const output = generate(ast, { comments: false });
    
    if (output.code.includes('return ')) {
      logger.info(`[${PLUGIN_NAME}] Code contains return statement after stripping types`);
    } else if (code.includes('return ') && !output.code.includes('return ')) {
      logger.error(`[${PLUGIN_NAME}] CRITICAL: Return statement was removed during type stripping!`);
    }
    
    return output.code;
  } catch (error: unknown) {
    if (error instanceof Error) {
        throw error;
    }
    throw new Error(String(error));
  }
}

function ensureTempDir(
  rootDir: string,
  logger: ResolvedConfig['logger']
): string {
  // (Implementation remains the same)
  if (tempDirPath && fs.existsSync(tempDirPath)) return tempDirPath;
  const attempts = [
    path.join(rootDir, 'node_modules', TEMP_DIR_NAME),
    path.join(rootDir, TEMP_DIR_NAME),
    path.join(
      os.tmpdir(),
      `vite_plugin_use_electron_${path.basename(rootDir)}`
    ),
  ];
  for (const dir of attempts) {
    try {
      fs.ensureDirSync(dir);
      tempDirPath = dir;
      logger.info(`[${PLUGIN_NAME}] Using temp directory: ${tempDirPath}`);
      return tempDirPath;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn(
        `[${PLUGIN_NAME}] Failed to ensure temp directory at ${dir}: ${errorMessage}`
      );
    }
  }
  logger.error(
    `[${PLUGIN_NAME}] Failed to create any temporary directory. Manifest persistence may fail.`
  );
  tempDirPath = attempts[attempts.length - 1];
  return tempDirPath;
}

/**
 * Generate main process handler code for electronjs
 */
function generateMainHandlerCode(
  functions: UseMainFunctionManifestEntry[],
  logger: ResolvedConfig['logger']
): string {
  // Extract the unique modules needed from all functions
  const requiredModules = new Set<string>();
  functions.forEach((func) => {
    if (func.imports && Array.isArray(func.imports)) {
      func.imports.forEach((imp) => {
        // Only add non-empty imports and filter out 'console' which shouldn't be treated as an import
        if (imp && typeof imp === 'string' && imp.trim() && imp !== 'console') {
          requiredModules.add(imp.trim());
        }
      });
    }
  });

  const requireStatements = Array.from(requiredModules)
    .sort()
    .map((mod) => {
      const safeVarName = mod
        .replace(/^@/, '')
        .replace(/^node:/, '')
        .replace(/[^a-zA-Z0-9_$]/g, '_');
      const requirePath =
        BUILTIN_MODULES.has(mod) || mod.startsWith('node:')
          ? mod.startsWith('node:')
            ? mod
            : `node:${mod}`
          : mod;
      return `const ${safeVarName} = require('${requirePath}');`;
    })
    .join('\n');

  // Sort handlers by FUNCTION ID for stable manifest mapping
  const sortedFunctions = [...functions].sort((a, b) =>
    a.id.localeCompare(b.id)
  );

  const handlerEntries = sortedFunctions
    .map((func) => {
      const paramNames = func.params.map((p) => p.name.replace('...', ''));
      const paramsSignature = paramNames.join(', ');
      const cleanBody = func.body?.trim() || '';

      // Process the body to ensure it doesn't have any TypeScript type annotations
      logger.info(`[${PLUGIN_NAME}] Processing body for ${func.name} (${func.id}): ${cleanBody.length} chars`);
      
      // Check for return statements before processing
      if (cleanBody.includes('return ')) {
        logger.info(`[${PLUGIN_NAME}] Function ${func.name} has ${cleanBody.split('return').length - 1} return statements before processing`);
      } else {
        logger.warn(`[${PLUGIN_NAME}] Function ${func.name} has no return statements before processing`);
      }
      
      const processedBody = stripTypesFromCodeBabel(cleanBody, logger);
      logger.info(`[${PLUGIN_NAME}] After stripTypes for ${func.name}: ${processedBody.length} chars`);
      
      // Check for return statements after processing
      if (processedBody.includes('return ')) {
        logger.info(`[${PLUGIN_NAME}] Function ${func.name} has ${processedBody.split('return').length - 1} return statements after processing`);
      } else {
        logger.error(`[${PLUGIN_NAME}] CRITICAL: Function ${func.name} lost its return statements during processing!`);
        logger.info(`[${PLUGIN_NAME}] Original body: ${cleanBody}`);
        logger.info(`[${PLUGIN_NAME}] Processed body: ${processedBody}`);
      }

      // Add an explicit function result variable if there isn't a clear return statement
      let enhancedBody = processedBody;
      if (!processedBody.includes('return ') && processedBody.trim().length > 0) {
        logger.info(`[${PLUGIN_NAME}] Adding explicit return for ${func.name} as none was found`);
        // Try to find the last statement and capture its result
        const lines = processedBody.split('\n');
        if (lines.length > 0) {
          const lastNonEmptyLineIndex = lines.map((l, i) => l.trim() ? i : -1).filter(i => i >= 0).pop();
          if (lastNonEmptyLineIndex !== undefined) {
            const lastLine = lines[lastNonEmptyLineIndex].trim();
            if (!lastLine.endsWith(';') && !lastLine.endsWith('}') && !lastLine.match(/^\s*\/\//)) {
              // It might be an expression that could be returned
              lines[lastNonEmptyLineIndex] = `const __electron_result = ${lastLine};`;
              lines.push('return __electron_result;');
              enhancedBody = lines.join('\n');
              logger.info(`[${PLUGIN_NAME}] Modified body with return for ${func.name}: ${enhancedBody}`);
            }
          }
        }
      }

      const indentedBody = enhancedBody
        ? '      ' + enhancedBody.split('\n').join('\n      ')
        : '      // Function body was empty';

      return `
  // Handler for ${func.name} (${func.id})
  '${func.id}': async function(${paramsSignature}) {
    try {
      console.log('[Main Process Debug] Executing ${func.name} with args:', ${paramsSignature});
${indentedBody}
    } catch (error) {
      console.error('[Main Handler] Error in ${func.name} (${func.id}):', error);
      throw error;
    }
  }`;
    })
    .join(',\n');

  // Exact format from test file
  return `/* vite-plugin-use-electron - Main Process Handlers */
const { ipcMain } = require('electron');
${requireStatements}

// Function implementations mapped by ID
const functionImplementations = {${handlerEntries}
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
      console.log(\`[Main Handler Debug] Executing '\${functionId}' with args:\`, args);
      const result = await handler(...args);
      console.log(\`[Main Handler Debug] '\${functionId}' returned:\`, result);
      return result;
    } catch (error) {
      console.error(\`[Main Handler] Error executing '\${functionId}':\`, error);
      throw error;
    }
  });
  
  console.log('[Main Process] Handlers setup complete.');
}

// Export the setup function
exports.setupMainHandlers = setupMainHandlers;`;
}

/**
 * Generate preload bridge code for Electron
 */
function generatePreloadBridgeCode(
  functions: UseMainFunctionManifestEntry[],
  logger: ResolvedConfig['logger']
): string {
  logger.info(
    `[${PLUGIN_NAME}:preload] Generating bridge code for ${functions.length} functions.`
  );
  // Sort by NAME for predictable bridge API structure
  const sortedFunctions = [...functions].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const bridgeFunctions = sortedFunctions
    .map((func) => {
      const paramNames = func.params.map((p) => p.name.replace('...', ''));
      const paramsSignature = paramNames.join(', ');
      const argsArray =
        paramNames.length > 0 ? `[${paramNames.join(', ')}]` : '[]';
      return `
  // Bridge for ${func.name} (${func.id})
  ${func.name}: async (${paramsSignature}) => {
    try {
      console.log('[Electron Bridge Debug] Calling ${func.name} with args:', ${argsArray});
      const result = await ipcRenderer.invoke('ipc-use-electron', '${func.id}', ${argsArray});
      console.log('[Electron Bridge Debug] ${func.name} returned:', result);
      return result; // Ensure values are returned from bridge
    } catch (error) {
      console.error('[Preload Bridge] Error invoking ${func.name} (${func.id}):', error?.message || error);
      if (error instanceof Error) { throw error; } else { throw new Error(String(error ?? 'Unknown IPC Error')); }
    }
  }`;
    })
    .join(',\n');
console.log('bridgeFunctions', bridgeFunctions)
  // Exact format from test file
  return `/* vite-plugin-use-electron - Preload Bridge API */
const { contextBridge, ipcRenderer } = require('electron');

// Create API object with all main process functions
const mainApi = {${bridgeFunctions}
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
}`.trim();
}

function generateTypeDefinitions(
  functions: UseMainFunctionManifestEntry[],
  logger: ResolvedConfig['logger']
): string {
  // (Implementation remains the same - assumed correct)
  logger.info(
    `[${PLUGIN_NAME}:renderer] Generating type definitions for ${functions.length} functions.`
  );
  const sortedFunctions = [...functions].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  return `// Generated by ${PLUGIN_NAME} - Do not edit manually!\nexport interface MainApi {\n${sortedFunctions
    .map((func) => {
      let paramsWithType = func.paramsString?.trim();
      if (!paramsWithType)
        paramsWithType = func.params
          .map((p) => `${p.name}: ${p.typeString || 'any'}`)
          .join(', ');
      let returnType = func.returnTypeString?.trim();
      if (!returnType || returnType === 'any' || returnType === 'unknown')
        returnType = 'Promise<any>';
      else if (returnType === 'void') returnType = 'Promise<void>';
      else if (
        !returnType.startsWith('Promise<') &&
        !returnType.startsWith('Promise <')
      )
        returnType = `Promise<${returnType}>`;
      returnType = returnType || 'Promise<any>';
      return `  /**\n   * Defined in: ${func.filePath}\n   */\n  ${func.name}(${paramsWithType}): ${returnType};`;
    })
    .join(
      '\n\n'
    )}\n}\ndeclare global { interface Window { mainApi: MainApi; } }\nexport {};`;
}

// --- Main Plugin Function ---

export function useElectronMainPlugin(
  target: 'renderer' | 'preload' | 'main',
  options: useElectronMainPluginOptions = {}
): Plugin {
  let config: ResolvedConfig;
  let logger: ResolvedConfig['logger'];
  let isDev = false;
  const generateTypes = options.generateTypes === true;
  directiveKeyword = options.directiveKeyword || 'use electron';

  // Function to update manifest and potentially dev files
  async function updateManifestAndDevFiles(logContext: string) {
    try {
      await fs.ensureDir(tempDirPath);
      const manifestData = Object.fromEntries(accumulatedFunctions.entries());
      const sortedManifestData = Object.keys(manifestData)
        .sort()
        .reduce((acc, key) => {
          acc[key] = manifestData[key];
          return acc;
        }, {} as UseMainManifest);
      await fs.writeJson(manifestPath, sortedManifestData, { spaces: 2 });
      logger.info(
        `[${PLUGIN_NAME}:${logContext}] Updated manifest (${manifestPath}) with ${accumulatedFunctions.size} total functions.`
      );

      if (isDev) {
        const allFunctions = Array.from(accumulatedFunctions.values());
        if (allFunctions.length > 0) {
          try {
            const mainCode = generateMainHandlerCode(allFunctions, logger);

            // // Final sanitizing pass for known patterns
            // mainCode = mainCode.replace(
            //   /let\s+hostname\s*:\s*string\s*\|\s*undefined;/g,
            //   'let hostname;'
            // );

            await fs.writeFile(
              path.join(tempDirPath, GENERATED_MAIN_HANDLERS),
              mainCode
            );
            const preloadCode = generatePreloadBridgeCode(allFunctions, logger);
            await fs.writeFile(
              path.join(tempDirPath, GENERATED_PRELOAD_BRIDGE),
              preloadCode
            );
            if (generateTypes) {
              const typeDefinitions = generateTypeDefinitions(
                allFunctions,
                logger
              );
              const typesOutputPath = normalizePath(
                path.resolve(rootDir, 'src', GENERATED_TYPES_FILE)
              );
              await fs.outputFile(typesOutputPath, typeDefinitions);
            }
            logger.info(
              `[${PLUGIN_NAME}:dev] Updated generated files in temp dir${
                generateTypes ? ' and types' : ''
              }.`
            );
          } catch (devError: any) {
            logger.error(
              `[${PLUGIN_NAME}:dev] Error generating dev files: ${devError.message}`
            );
          }
        }
      }
    } catch (err: any) {
      logger.error(
        `[${PLUGIN_NAME}:${logContext}] Error writing manifest: ${err.message}`
      );
    }
  }

  return {
    name: `${PLUGIN_NAME}-${target}`,
    enforce: 'pre',

    configResolved(resolvedConfig: ResolvedConfig) {
      /* (Same as before) */
      config = resolvedConfig;
      logger = config.logger;
      rootDir = config.root;
      isDev = config.command === 'serve';
      tempDirPath = ensureTempDir(rootDir, logger);
      manifestPath = normalizePath(path.join(tempDirPath, MANIFEST_FILE));
      logger.info(
        `[${PLUGIN_NAME}:${target}] Initialized. Mode: ${
          isDev ? 'dev' : 'build'
        }. Directive: "${directiveKeyword}". Temp dir: ${tempDirPath}`
      );
      if (target === 'renderer') {
        accumulatedFunctions.clear();
        logger.info(
          `[${PLUGIN_NAME}:${target}] Cleared in-memory function manifest.`
        );
        if (isDev && fs.existsSync(manifestPath)) {
          try {
            const manifest: UseMainManifest = fs.readJsonSync(manifestPath);
            Object.values(manifest).forEach((entry) =>
              accumulatedFunctions.set(entry.id, entry)
            );
            logger.info(
              `[${PLUGIN_NAME}:${target}] Pre-loaded ${accumulatedFunctions.size} functions from manifest: ${manifestPath}`
            );
          } catch (err: unknown) {
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            logger.warn(
              `[${PLUGIN_NAME}:${target}] Failed to pre-load manifest: ${errorMessage}. Deleting potentially corrupt file.`
            );
            try {
              fs.removeSync(manifestPath);
            } catch {
              /* ignore */
            }
          }
        }
      }
    },

    configureServer(server) {
      /* (Same as before) */
      if (target === 'renderer' && generateTypes && isDev) {
        logger.info(
          `[${PLUGIN_NAME}:renderer] Watching for changes to update types file.`
        );
        server.watcher.on('change', async (filePath) => {
          const normalizedPath = normalizePath(filePath);
          if (
            /\.(t|j)sx?$/.test(normalizedPath) &&
            !normalizedPath.includes('/node_modules/') &&
            !normalizedPath.startsWith(tempDirPath)
          ) {
            setTimeout(async () => {
              try {
                const functions = Array.from(accumulatedFunctions.values());
                const typeDefinitions = generateTypeDefinitions(
                  functions,
                  logger
                );
                const typesOutputPath = normalizePath(
                  path.resolve(rootDir, 'src', GENERATED_TYPES_FILE)
                );
                await fs.outputFile(typesOutputPath, typeDefinitions);
                logger.info(
                  `[${PLUGIN_NAME}:dev] Updated types (${typesOutputPath}) after change in ${normalizedPath}`
                );
              } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                logger.error(
                  `[${PLUGIN_NAME}:dev] Error updating types on change: ${errorMessage}`
                );
              }
            }, 150);
          }
        });
      }
    },

    async buildStart() {
      /* (Same as before) */
      if (target === 'renderer' && generateTypes && !isDev) {
        logger.info(
          `[${PLUGIN_NAME}:renderer] Ensuring types file exists for production build.`
        );
        try {
          if (fs.existsSync(manifestPath)) {
            try {
              const manifest: UseMainManifest = await fs.readJson(manifestPath);
              accumulatedFunctions.clear();
              Object.values(manifest).forEach((entry) =>
                accumulatedFunctions.set(entry.id, entry)
              );
              logger.info(
                `[${PLUGIN_NAME}:buildStart] Loaded ${accumulatedFunctions.size} functions from manifest for type generation.`
              );
            } catch (err: unknown) {
              const errorMessage =
                err instanceof Error ? err.message : String(err);
              logger.warn(
                `[${PLUGIN_NAME}:buildStart] Failed to read manifest for type generation: ${errorMessage}`
              );
            }
          }
          const functions = Array.from(accumulatedFunctions.values());
          const typeDefinitions = generateTypeDefinitions(functions, logger);
          const typesOutputPath = normalizePath(
            path.resolve(rootDir, 'src', GENERATED_TYPES_FILE)
          );
          await fs.outputFile(typesOutputPath, typeDefinitions);
          logger.info(
            `[${PLUGIN_NAME}:renderer] Ensured/Updated types file at buildStart: ${typesOutputPath} (${functions.length} functions)`
          );
        } catch (e: unknown) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          logger.error(
            `[${PLUGIN_NAME}:renderer] Failed writing types during buildStart: ${errorMessage}`
          );
        }
      }
    },

    async transform(code: string, id: string) {
      if (target !== 'renderer') return null;
      const VITE_INTERNAL_QUERY = '?';
      const cleanId = id.includes(VITE_INTERNAL_QUERY)
        ? id.split(VITE_INTERNAL_QUERY)[0]
        : id;
      const normalizedId = normalizePath(cleanId);
      if (
        !/\.(t|j)sx?$/.test(normalizedId) ||
        normalizedId.includes('/node_modules/') ||
        (tempDirPath && normalizedId.startsWith(tempDirPath)) ||
        !code.includes(directiveKeyword)
      )
        return null;

      logger.info(`[${PLUGIN_NAME}:${target}] Transforming: ${normalizedId}`);
      let ast: BabelTypes.File;
      try {
        const parserPlugins: ParserPlugin[] = ['typescript'];
        if (normalizedId.endsWith('.jsx') || normalizedId.endsWith('.tsx') || normalizedId.endsWith('.ts'))
          parserPlugins.push('jsx');
        ast = babelParse(code, {
          sourceType: 'module',
          plugins: parserPlugins,
          sourceFilename: id,
        });
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        logger.error(
          `[${PLUGIN_NAME}] Parse failed for ${normalizedId}: ${errorMessage}. Skipping.`
        );
        return null;
      }

      const magicString = new MagicString(code, { filename: id });
      let fileChangedOverall = false;
      const functionsInThisFile = new Map<
        string,
        UseMainFunctionManifestEntry
      >();
      interface ImportInfo {
        node: BabelTypes.ImportDeclaration;
        specifier: string;
        localNames: Set<string>;
        usedOutsideElectronFunctions: boolean;
        defaultName: string | null;
        namedImports: string[];
        originalText: string;
      }
      const importsMap = new Map<string, ImportInfo>();
      const allImports: ImportInfo[] = [];
      let transformErrorOccurred = false;

      // Create maps to track identifier usage outside electron functions
      const identifiersOutsideElectronFunctions = new Set<string>();

      try {
        // First pass: collect all imports (Updated to capture more details)
        traverse(ast, {
          ImportDeclaration(pathNode: NodePath<BabelTypes.ImportDeclaration>) {
            const node = pathNode.node;
            if (node.importKind === 'type') return;
            const specifier = node.source.value;
            const importInfo: ImportInfo = {
              node,
              specifier,
              localNames: new Set(),
              usedOutsideElectronFunctions: false,
              defaultName: null,
              namedImports: [],
              originalText: code.substring(node.start ?? 0, node.end ?? 0),
            };
            node.specifiers.forEach((spec) => {
              const localName = spec.local.name;
              importInfo.localNames.add(localName);
              importsMap.set(localName, importInfo);
              if (BabelTypes.isImportDefaultSpecifier(spec)) {
                importInfo.defaultName = localName;
              } else if (BabelTypes.isImportSpecifier(spec)) {
                 if (spec.importKind !== 'type') {
                    importInfo.namedImports.push(spec.imported.type === 'Identifier' ? spec.imported.name : spec.imported.value);
                 }
              }
              // ImportNamespaceSpecifier covers '*' as name - already handled by localNames
            });
            if (importInfo.localNames.size > 0) allImports.push(importInfo);
          },
        });

        // Second pass: mark identifiers used outside 'use electron' functions
        traverse(ast, {
          Identifier(pathNode: NodePath<BabelTypes.Identifier>) {
            // Skip imports/declarations themselves
            if (
              pathNode.parentPath?.isImportSpecifier() ||
              pathNode.parentPath?.isImportDefaultSpecifier() ||
              pathNode.parentPath?.isImportNamespaceSpecifier() ||
              (pathNode.parentPath?.isFunctionDeclaration() &&
                pathNode.key === 'id') ||
              (pathNode.parentPath?.isVariableDeclarator() &&
                pathNode.key === 'id') ||
              (pathNode.parentPath?.isClassMethod() &&
                pathNode.key === 'key') ||
              (pathNode.parentPath?.isObjectMethod() &&
                pathNode.key === 'key') ||
              (pathNode.parentPath?.isObjectProperty() &&
                pathNode.key === 'key' &&
                !pathNode.parentPath.node.computed) ||
              (pathNode.parentPath?.isMemberExpression() &&
                pathNode.key === 'property' &&
                !pathNode.parentPath.node.computed)
            )
              return;

            const localName = pathNode.node.name;

            // Skip builtins other than imports
            if (
              localName === 'console' ||
              localName === 'setTimeout' ||
              localName === 'Promise'
            )
              return;

            const importInfo = importsMap.get(localName);
            if (importInfo) {
              const isInElectronFn = isNodeInElectronFunction(pathNode);
              if (!isInElectronFn) {
                // Mark as used outside electron function if this identifier is not inside a 'use electron' function
                identifiersOutsideElectronFunctions.add(localName);
                importInfo.usedOutsideElectronFunctions = true;
              }
            }
          },
          JSXIdentifier(pathNode: NodePath<BabelTypes.JSXIdentifier>) {
            // Handle JSX element usage (crucial for React detection)
            const name = pathNode.node.name;

            // If this is a JSX element (like <div>), it's definitely using React
            if (
              importsMap.has('React') &&
              pathNode.parent &&
              (pathNode.parent as any).type === 'JSXOpeningElement'
            ) {
              const reactImport = importsMap.get('React');
              if (reactImport) {
                reactImport.usedOutsideElectronFunctions = true;
                identifiersOutsideElectronFunctions.add('React');
              }
            }

            // If this is a JSX identifier from imports (like <Component>)
            if (importsMap.has(name)) {
              const importInfo = importsMap.get(name);
              if (importInfo) {
                importInfo.usedOutsideElectronFunctions = true;
                identifiersOutsideElectronFunctions.add(name);
              }
            }
          },
          MemberExpression(pathNode: NodePath<BabelTypes.MemberExpression>) {
            if (BabelTypes.isIdentifier(pathNode.node.object)) {
              const objectName = pathNode.node.object.name;

              // Handle imported object usage outside electron functions
              const importInfo = importsMap.get(objectName);
              if (importInfo) {
                const isInElectronFn = isNodeInElectronFunction(pathNode);
                if (!isInElectronFn) {
                  identifiersOutsideElectronFunctions.add(objectName);
                  importInfo.usedOutsideElectronFunctions = true;
                }
              }
            }
          },
        });

        // Third pass: process 'use electron' functions
        // Using traditional visitor pattern with promises
        const promises: Promise<void>[] = [];
        
        traverse(ast, {
          Function(pathNode) {
            if (isFunctionWithElectronDirective(pathNode)) {
              promises.push(processFunction(pathNode));
            }
          },
          ClassMethod(pathNode) {
            if (isFunctionWithElectronDirective(pathNode)) {
              promises.push(processFunction(pathNode));
            }
          },
          ObjectMethod(pathNode) {
            if (isFunctionWithElectronDirective(pathNode)) {
              promises.push(processFunction(pathNode));
            }
          }
        });
        
        // Wait for all processing to complete
        await Promise.all(promises);
        
      } catch (traversalError: unknown) {
        const errorMessage =
          traversalError instanceof Error
            ? traversalError.message
            : String(traversalError);

        logger.error(
          `[${PLUGIN_NAME}] Error during AST traversal for ${normalizedId}: ${errorMessage}`,
          {
            error:
              traversalError instanceof Error
                ? traversalError
                : new Error(String(traversalError)),
          }
        );
        transformErrorOccurred = true;
      }

      function isNodeInElectronFunction(pathNode: NodePath<any>): boolean {
        return !!pathNode.findParent(
          (p) =>
            (p.isFunctionDeclaration() ||
              p.isFunctionExpression() ||
              p.isArrowFunctionExpression() ||
              p.isClassMethod() ||
              p.isObjectMethod()) &&
            p.node.body &&
            BabelTypes.isBlockStatement(p.node.body) &&
            ((p.node.body.directives &&
              p.node.body.directives.some(
                (d) => d.value.value === directiveKeyword
              )) ||
              (p.node.body.body &&
                p.node.body.body.length > 0 &&
                isUseElectronDirectiveNode(p.node.body.body[0])))
        );
      }
      
      function isFunctionWithElectronDirective(pathNode: NodePath<any>): boolean {
        const node = pathNode.node;
        if (!('body' in node) || !BabelTypes.isBlockStatement(node.body)) return false;
        const bodyNode = node.body;
        
        // Look for 'use electron' directive
        if (
          bodyNode.directives?.length > 0 &&
          isUseElectronDirectiveNode(bodyNode.directives[0])
        ) {
          return true;
        } else if (
          bodyNode.body?.length > 0 &&
          isUseElectronDirectiveNode(bodyNode.body[0])
        ) {
          return true;
        }
        return false;
      }

      async function processFunction(
        pathNode: NodePath<
          BabelTypes.Function | BabelTypes.ClassMethod | BabelTypes.ObjectMethod
        >
      ): Promise<void> {
        let functionName: string | null = null;

        try {
          const node = pathNode.node;
          if (!('body' in node) || !BabelTypes.isBlockStatement(node.body))
            return;
          const bodyNode = node.body;
          let directiveNode:
            | BabelTypes.Directive
            | BabelTypes.ExpressionStatement
            | null = null;

          // Look for 'use electron' directive
          if (
            bodyNode.directives?.length > 0 &&
            isUseElectronDirectiveNode(bodyNode.directives[0])
          ) {
            directiveNode = bodyNode.directives[0];
          } else if (
            bodyNode.body?.length > 0 &&
            isUseElectronDirectiveNode(bodyNode.body[0])
          ) {
            directiveNode = bodyNode.body[0] as BabelTypes.ExpressionStatement;
          }

          if (!directiveNode) return;

          // Extract function name
          if (
            (BabelTypes.isClassMethod(node) ||
              BabelTypes.isObjectMethod(node)) &&
            BabelTypes.isIdentifier(node.key) &&
            !node.computed
          ) {
            functionName = node.key.name;
          } else if (
            (BabelTypes.isFunctionExpression(node) ||
              BabelTypes.isFunctionDeclaration(node)) &&
            node.id
          ) {
            functionName = node.id.name;
          } else {
            const parent = pathNode.parent;
            if (
              BabelTypes.isVariableDeclarator(parent) &&
              BabelTypes.isIdentifier(parent.id)
            ) {
              functionName = parent.id.name;
            } else if (
              pathNode.parentPath?.isObjectProperty({ value: node }) &&
              BabelTypes.isIdentifier(pathNode.parentPath.node.key)
            ) {
              functionName = pathNode.parentPath.node.key.name;
            } else if (
              pathNode.parentPath?.isClassProperty({ value: node }) &&
              BabelTypes.isIdentifier(pathNode.parentPath.node.key)
            ) {
              functionName = pathNode.parentPath.node.key.name;
            }
          }

          functionName = functionName || '_anonymous_';
          const uniqueId = generateId(rootDir, normalizedId, functionName);
          if (functionsInThisFile.has(uniqueId)) return;

          // Extract parameters and return type
          const paramsInfo: ParamInfo[] = [];
          let paramsStringWithTypes = '';
          if ('params' in node && node.params?.length > 0) {
            node.params.forEach((param: BabelTypes.Node) =>
              paramsInfo.push(extractParamInfo(param, code))
            );
            const firstParam = node.params[0];
            const lastParam = node.params[node.params.length - 1];
            const paramsStartPos = getNodePosition(firstParam).start;
            const paramsEndPos = getNodePosition(lastParam).end;
            const bodyStartPos = getNodePosition(bodyNode).start;
            if (
              paramsStartPos !== null &&
              paramsEndPos !== null &&
              bodyStartPos !== null
            ) {
              const end = Math.min(paramsEndPos, bodyStartPos);
              if (paramsStartPos < end)
                paramsStringWithTypes = code
                  .substring(paramsStartPos, end)
                  .trim()
                  .replace(/,\s*$/, '');
            }
          }
          
          // Get explicit return type annotation if it exists
          let returnTypeString = getTypeAnnotationString(
            (node as any).returnType,
            code
          );
          
          // If no explicit return type, infer it using TypeScript's compiler API
          if (!returnTypeString || returnTypeString === 'any' || returnTypeString === '') {
            try {
              // Create a temporary TypeScript file with the function
              const tempFileName = `temp-${uniqueId.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.ts`;
              const tempFilePath = path.join(
                ensureTempDir(rootDir, logger),
                tempFileName
              );

              // Extract the full function text
              const functionStartPos = getNodePosition(node).start ?? 0;
              const functionEndPos = getNodePosition(node).end ?? 0;
              const functionText = code.substring(functionStartPos, functionEndPos);

              // Create a complete TypeScript file with necessary imports
              const importStatements = allImports
                .filter(imp => imp.originalText)
                .map(imp => imp.originalText)
                .join('\n');

              const tempFileContent = `${importStatements}\n\n${functionText}`;
              
              await fs.writeFile(tempFilePath, tempFileContent);

              // Create a TypeScript program - with more robust config file finding
              let tsConfigPath: string | undefined = undefined;
              
              // Try multiple potential locations for tsconfig.json
              const potentialLocations = [
                rootDir,                                        // Project root 
                path.dirname(normalizedId),                     // Directory of current file
                path.join(rootDir, 'tsconfig.json'),            // Direct path
                path.resolve(rootDir, '..'),                    // Parent directory (for monorepos)
                path.resolve(rootDir, '..', '..'),              // Grandparent directory (for deeper nesting)
                path.join(rootDir, 'apps'),                     // Common monorepo locations
                path.join(rootDir, 'packages'),
                path.join(rootDir, 'libs')
              ];

              // Also check up to 3 parent directories
              let currentDir = rootDir;
              for (let i = 0; i < 3; i++) {
                const parentDir = path.dirname(currentDir);
                if (parentDir !== currentDir) {
                  potentialLocations.push(parentDir);
                  currentDir = parentDir;
                } else {
                  break; // Stop if we've reached the root
                }
              }

              // Try all potential locations
              for (const location of potentialLocations) {
                const configPath = ts.findConfigFile(
                  location,
                  ts.sys.fileExists,
                  "tsconfig.json"
                );
                if (configPath) {
                  tsConfigPath = configPath;
                  logger.info(`[${PLUGIN_NAME}] Found tsconfig.json at ${configPath}`);
                  break;
                }
              }

              if (!tsConfigPath) {
                // Original fallback logic if no tsconfig found
                logger.warn(`[${PLUGIN_NAME}] Could not find tsconfig.json in any standard location. Creating minimal compiler options.`);
                
                // Create a minimal program with default options when no tsconfig is found
                try {
                  const defaultCompilerOptions: ts.CompilerOptions = {
                    target: ts.ScriptTarget.ESNext,
                    module: ts.ModuleKind.ESNext,
                    moduleResolution: ts.ModuleResolutionKind.NodeJs,
                    esModuleInterop: true,
                    strict: true,
                    skipLibCheck: true,
                    jsx: ts.JsxEmit.React,
                    allowJs: true,
                    resolveJsonModule: true,
                  };
                  
                  // Create program with minimal options
                  const program = ts.createProgram([tempFilePath], defaultCompilerOptions);
                  const checker = program.getTypeChecker();
                  const sourceFile = program.getSourceFile(tempFilePath);
                  
                  if (sourceFile) {
                    // Continue with type analysis using the same logic as before
                    let inferredTsType: ts.Type | undefined;
                    
                    // Find the function declaration/expression within the temp file AST
                    const findFunctionNode = (n: ts.Node): ts.Node | undefined => {
                      let foundNode: ts.Node | undefined;
                      if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)) &&
                          (n.getSourceFile()?.fileName === tempFilePath)
                      ) {
                        // Basic check: Does the text match roughly?
                        const nodeText = n.getText(sourceFile);
                        if(nodeText.includes(functionText.substring(0, 50))) {
                          foundNode = n;
                        }
                      }
                      if (!foundNode) {
                        ts.forEachChild(n, child => {
                          if (!foundNode) foundNode = findFunctionNode(child);
                        });
                      }
                      return foundNode;
                    };
                    
                    const targetFunctionNode = findFunctionNode(sourceFile);
                    
                    if (targetFunctionNode) {
                      const functionSymbol = checker.getSymbolAtLocation(
                        (targetFunctionNode as any).name || targetFunctionNode
                      );
                      
                      if (functionSymbol) {
                        const functionType = checker.getTypeOfSymbolAtLocation(
                          functionSymbol,
                          functionSymbol.valueDeclaration || targetFunctionNode
                        );
                        const signatures = checker.getSignaturesOfType(
                          functionType,
                          ts.SignatureKind.Call
                        );
                        
                        if (signatures.length > 0) {
                          inferredTsType = checker.getReturnTypeOfSignature(signatures[0]);
                        }
                      }
                    }
                    
                    if (inferredTsType) {
                      // Convert inferred type to string, handling Promises
                      const inferredTypeString = checker.typeToString(
                        inferredTsType,
                        undefined,
                        ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope
                      );
                      
                      // Check if it's already a Promise
                      if (inferredTypeString.startsWith('Promise<') || inferredTypeString.startsWith('Promise <')) {
                        returnTypeString = inferredTypeString;
                      } else if (inferredTypeString === 'void') {
                        returnTypeString = 'Promise<void>';
                      } else {
                        returnTypeString = `Promise<${inferredTypeString}>`;
                      }
                      
                      logger.info(
                        `[${PLUGIN_NAME}] Successfully inferred return type '${returnTypeString}' for function ${functionName} using fallback compiler options`
                      );
                    } else {
                      logger.warn(`[${PLUGIN_NAME}] Could not infer return type using minimal compiler options. Falling back.`);
                      returnTypeString = 'Promise<any>';
                    }
                  } else {
                    logger.warn(`[${PLUGIN_NAME}] Could not get source file with minimal compiler options. Falling back.`);
                    returnTypeString = 'Promise<any>';
                  }
                } catch (err: any) {
                  logger.warn(`[${PLUGIN_NAME}] Error using minimal compiler options: ${err.message}. Falling back.`);
                  returnTypeString = 'Promise<any>';
                }
              } else {
                // Existing code for when tsconfig is found
                const tsConfigReadResult = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
                if (tsConfigReadResult.error) {
                    logger.warn(`[${PLUGIN_NAME}] Error reading tsconfig.json: ${ts.flattenDiagnosticMessageText(tsConfigReadResult.error.messageText, '\n')}. Falling back to 'any'.`);
                    returnTypeString = 'Promise<any>';
                } else {
                    const parsedConfig = ts.parseJsonConfigFileContent(
                      tsConfigReadResult.config,
                      ts.sys,
                      path.dirname(tsConfigPath),
                      { noEmit: true }
                    );

                    // Add our temp file to the program
                    const rootNames = [...parsedConfig.fileNames, tempFilePath];

                    const program = ts.createProgram({
                      rootNames: rootNames,
                      options: parsedConfig.options,
                    });

                    const checker = program.getTypeChecker();
                    const sourceFile = program.getSourceFile(tempFilePath);

                    if (sourceFile) {
                      let inferredTsType: ts.Type | undefined;

                      // Find the function declaration/expression within the temp file AST
                      const findFunctionNode = (n: ts.Node): ts.Node | undefined => {
                          let foundNode: ts.Node | undefined;
                          if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)) &&
                              (n.getSourceFile()?.fileName === tempFilePath)
                          ) {
                              // Basic check: Does the text match roughly? More robust checks needed if names clash.
                              const nodeText = n.getText(sourceFile);
                              if(nodeText.includes(functionText.substring(0, 50))) {
                                 foundNode = n;
                              }
                          }
                          if (!foundNode) {
                             ts.forEachChild(n, child => {
                                if (!foundNode) foundNode = findFunctionNode(child);
                             });
                          }
                          return foundNode;
                      };

                      const targetFunctionNode = findFunctionNode(sourceFile);

                      if (targetFunctionNode) {
                         const functionSymbol = checker.getSymbolAtLocation(
                            (targetFunctionNode as any).name || targetFunctionNode
                         );

                         if (functionSymbol) {
                           const functionType = checker.getTypeOfSymbolAtLocation(
                             functionSymbol,
                             functionSymbol.valueDeclaration || targetFunctionNode
                           );
                           const signatures = checker.getSignaturesOfType(
                                functionType,
                                ts.SignatureKind.Call
                           );

                           if (signatures.length > 0) {
                             inferredTsType = checker.getReturnTypeOfSignature(signatures[0]);
                           }
                         }
                      }

                      if (inferredTsType) {
                        // Convert inferred type to string, handling Promises
                        const inferredTypeString = checker.typeToString(
                          inferredTsType,
                          undefined,
                          ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope
                        );

                        // Check if it's already a Promise
                        if (inferredTypeString.startsWith('Promise<') || inferredTypeString.startsWith('Promise <')) {
                           returnTypeString = inferredTypeString;
                        } else if (inferredTypeString === 'void') {
                           returnTypeString = 'Promise<void>';
                        } else {
                           returnTypeString = `Promise<${inferredTypeString}>`;
                        }

                        logger.info(
                          `[${PLUGIN_NAME}] Successfully inferred return type '${returnTypeString}' for function ${functionName}`
                        );
                      } else {
                         logger.warn(`[${PLUGIN_NAME}] Could not infer return type for ${functionName} using TS Compiler API. Falling back.`);
                         // Fallback: Analyze return statements (simplified)
                         let hasReturnWithValue = false;
                         pathNode.traverse({
                           ReturnStatement(returnPath) {
                             if (returnPath.node.argument) {
                               hasReturnWithValue = true;
                               returnPath.stop();
                             }
                           }
                         });
                         returnTypeString = hasReturnWithValue ? 'Promise<any>' : 'Promise<void>';
                         logger.info(`[${PLUGIN_NAME}] Fallback return type '${returnTypeString}' for ${functionName} based on return statement analysis.`);
                      }
                    } else {
                       logger.warn(`[${PLUGIN_NAME}] Could not get source file ${tempFilePath} from TS Program. Falling back.`);
                       returnTypeString = 'Promise<any>';
                    }
                }
              }

              // Clean up the temporary file
              try {
                await fs.unlink(tempFilePath);
              } catch (unlinkError: any) {
                logger.warn(`[${PLUGIN_NAME}] Failed to clean up temporary file: ${tempFilePath}: ${unlinkError.message}`);
              }
            } catch (inferError: any) {
              logger.error(
                `[${PLUGIN_NAME}] Error during return type inference for ${functionName} in ${normalizedId}: ${inferError.message}. Falling back to 'Promise<any>'.`, { error: inferError }
              );
              returnTypeString = 'Promise<any>';
            }
          }

          // Extract body and prepare for replacement
          let originalBodyContent = '';
          const bodyBlockPos = getNodePosition(bodyNode);
          const directivePos = getNodePosition(directiveNode);
          const usedImportsInFunc = new Set<string>();

          if (
            bodyBlockPos.start !== null &&
            bodyBlockPos.end !== null &&
            directivePos.start !== null &&
            directivePos.end !== null
          ) {
            const directiveStatementStart = directivePos.start;
            const directiveStatementEnd =
              directivePos.end + (code[directivePos.end] === ';' ? 1 : 0);

            // Remove the directive
            magicString.remove(directiveStatementStart, directiveStatementEnd);

            // Extract body content excluding directive
            const bodyContentStart = bodyBlockPos.start + 1;
            const bodyContentEnd = bodyBlockPos.end - 1;
            if (bodyContentStart < bodyContentEnd) {
              const fullBodyWithDirective = code.substring(
                bodyContentStart,
                bodyContentEnd
              );
              const directiveStringOriginal = code.substring(
                directiveStatementStart,
                directiveStatementEnd
              );

              // Remove directive from body content
              originalBodyContent = fullBodyWithDirective
                .replace(directiveStringOriginal, '')
                .trim();
              
              logger.info(`[${PLUGIN_NAME}] Original body content for ${functionName}: ${originalBodyContent.length} chars`);
              // Check if body contains return statements
              if (originalBodyContent.includes('return ')) {
                logger.info(`[${PLUGIN_NAME}] Function ${functionName} contains return statement(s): ${originalBodyContent.split('return').length - 1} occurrences`);
                
                // Log the context around return statements to help debug
                const returnMatches = Array.from(originalBodyContent.matchAll(/return\s+[^;]*/g));
                returnMatches.forEach((match, index) => {
                  const start = Math.max(0, match.index! - 20);
                  const end = Math.min(originalBodyContent.length, match.index! + match[0].length + 20);
                  logger.info(`[${PLUGIN_NAME}] Return statement #${index + 1} context: ${originalBodyContent.substring(start, end)}`);
                });
                
              } else {
                logger.warn(`[${PLUGIN_NAME}] Function ${functionName} doesn't contain any return statements`);
              }

              // Analyze the body to find imports used within this function
              try {
                const bodyAst = babelParse(originalBodyContent, {
                  sourceType: 'module',
                  plugins: ['typescript', 'jsx'],
                  errorRecovery: true,
                });

                traverse(bodyAst, {
                  Identifier(path) {
                    const name = path.node.name;
                    // Check if this identifier matches any import specifier
                    for (const importInfo of allImports) {
                      if (importInfo.localNames.has(name)) {
                        usedImportsInFunc.add(importInfo.specifier);
                      }
                    }
                  },
                });
              } catch (parseError: unknown) {
                const errorMessage =
                  parseError instanceof Error
                    ? parseError.message
                    : String(parseError);
                logger.warn(
                  `[${PLUGIN_NAME}] Could not parse body for import analysis: ${errorMessage}`
                );
              }

              // Replace with IPC call
              const paramNames = paramsInfo.map((p) =>
                p.name.replace('...', '')
              );
              const argsToPass = paramNames.join(', ');
              const shouldUseAwait = 
                returnTypeString && 
                returnTypeString !== 'void' && 
                returnTypeString !== 'any';
              
              logger.info(`[${PLUGIN_NAME}] Return type for ${functionName}: ${returnTypeString}, using await: ${shouldUseAwait}`);
              
              const replacementBody = ` /* Body replaced by ${PLUGIN_NAME} */
    try {
      console.log('[Renderer Debug] Calling ${functionName}(${argsToPass})');
      if (typeof window === 'undefined' || !window.mainApi || typeof window.mainApi.${functionName} !== 'function') { 
        throw new Error(\`[${PLUGIN_NAME}] Electron main process function '${functionName}' not found on window.mainApi. Check preload script exposure and main process handler setup.\`); 
      }
      const result = await window.mainApi.${functionName}(${argsToPass});
      console.log("[Renderer Debug] ${functionName} returned:", result);
      return result; // Always return the result
    } catch (error) { 
      console.error(\`[${PLUGIN_NAME}] Error calling Electron main function '${functionName}' from renderer:\`, error); 
      throw error; 
    }`;

              logger.info(`[${PLUGIN_NAME}] Generated replacement body for ${functionName}:\n${replacementBody}`);
              
              magicString.overwrite(
                bodyContentStart,
                bodyContentEnd,
                replacementBody
              );
              fileChangedOverall = true;
            } else {
              originalBodyContent = '';
              logger.warn(
                `[${PLUGIN_NAME}] Original body for ${uniqueId} seemed empty after directive.`
              );
            }
          } else {
            logger.warn(
              `[${PLUGIN_NAME}] Could not get positions for directive/body in ${uniqueId}.`
            );
          }

          // Create the function manifest entry
          const functionData: UseMainFunctionManifestEntry = {
            id: uniqueId,
            name: functionName,
            params: paramsInfo,
            paramsString: paramsStringWithTypes,
            returnTypeString,
            body: stripTypesFromCodeBabel(originalBodyContent, logger),
            filePath: normalizedId,
            imports: Array.from(usedImportsInFunc),
          };

          functionsInThisFile.set(uniqueId, functionData);
          accumulatedFunctions.set(uniqueId, functionData);
        } catch (funcError: any) {
          logger.error(
            `[${PLUGIN_NAME}] Error processing function ${
              functionName || 'anonymous'
            } in ${normalizedId}: ${funcError.message}`,
            { error: funcError }
          );
          transformErrorOccurred = true;
        }
      }

      // Handle import removal
      if (!transformErrorOccurred && functionsInThisFile.size > 0) {
        for (const importInfo of allImports) {
          // Only remove imports that aren't used outside of electron functions
          if (!importInfo.usedOutsideElectronFunctions) {
            const importStart = importInfo.node.start ?? 0;
            const importEnd = importInfo.node.end ?? 0;

            logger.info(
              `[${PLUGIN_NAME}:${target}] Removing import '${importInfo.specifier}' as it appears only used in 'use electron' functions.`
            );

            // Find the full line boundaries
            let lineStart = importStart;
            while (lineStart > 0 && code[lineStart - 1] !== '\n') lineStart--;

            let lineEnd = importEnd;
            if (lineEnd < code.length && code[lineEnd] === ';') lineEnd++;
            while (lineEnd < code.length && code[lineEnd] !== '\n') lineEnd++;
            if (lineEnd < code.length && code[lineEnd] === '\n') lineEnd++;

            magicString.remove(lineStart, lineEnd);
            fileChangedOverall = true;
          }
        }
      }

      // Update manifest
      if (!transformErrorOccurred && functionsInThisFile.size > 0) {
        await updateManifestAndDevFiles(
          `transform:${path.basename(normalizedId)}`
        );
      }

      if (fileChangedOverall && !transformErrorOccurred) {
        return {
          code: magicString.toString(),
          map: magicString.generateMap({
            source: id,
            includeContent: true,
            hires: true,
          }),
        };
      }

      return null;
    },

    async generateBundle(
      this: Rollup.PluginContext,
      options: Rollup.OutputOptions
    ) {
      // (Implementation remains the same as previous version - relies on correct manifest)
      if (target === 'renderer') {
        if (generateTypes && !isDev) {
          try {
            const functions = Array.from(accumulatedFunctions.values());
            const typeDefinitions = generateTypeDefinitions(functions, logger);
            const typesOutputPath = normalizePath(
              path.resolve(rootDir, 'src', GENERATED_TYPES_FILE)
            );
            await fs.outputFile(typesOutputPath, typeDefinitions);
            logger.info(
              `[${PLUGIN_NAME}:renderer] Final type generation check during build: ${typesOutputPath}`
            );
          } catch (genErr: any) {
            logger.error(
              `[${PLUGIN_NAME}:renderer] Failed final type generation: ${genErr.message}`
            );
          }
        }
        return;
      }
      logger.info(
        `[${PLUGIN_NAME}:${target}] generateBundle started. Output dir: ${options.dir}`
      );
      if (!manifestPath)
        manifestPath = normalizePath(
          path.join(ensureTempDir(rootDir, logger), MANIFEST_FILE)
        );
      let functions: UseMainFunctionManifestEntry[] = [];
      try {
        if (await fs.pathExists(manifestPath)) {
          const manifest: UseMainManifest = await fs.readJson(manifestPath);
          functions = Object.values(manifest).map((entry) => ({
            ...entry,
            imports: entry.imports || [],
          }));
          logger.info(
            `[${PLUGIN_NAME}:${target}] Loaded ${functions.length} functions from manifest: ${manifestPath}`
          );
        } else {
          logger.warn(
            `[${PLUGIN_NAME}:${target}] Manifest file not found at ${manifestPath}. Using in-memory functions (${accumulatedFunctions.size}).`
          );
          functions = Array.from(accumulatedFunctions.values());
        }
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        logger.error(
          `[${PLUGIN_NAME}:${target}] Failed to read/parse manifest ${manifestPath}: ${errorMessage}. Using in-memory functions (${accumulatedFunctions.size}).`
        );
        functions = Array.from(accumulatedFunctions.values());
      }
      if (functions.length === 0) {
        logger.warn(
          `[${PLUGIN_NAME}:${target}] No 'use electron' functions found. Generating minimal ${target} file.`
        );
        let minimalCode = `// ${PLUGIN_NAME} - No functions found`;
        if (target === 'main')
          minimalCode +=
            '\nexports.setupMainHandlers = () => { console.log("[Main Handler] No functions to handle."); };';
        if (target === 'preload')
          minimalCode +=
            '\nconsole.log("[Preload Bridge] No functions to expose.");';
        this.emitFile({
          type: 'asset',
          fileName:
            target === 'main'
              ? GENERATED_MAIN_HANDLERS
              : GENERATED_PRELOAD_BRIDGE,
          source: minimalCode,
        });
        return;
      }
      try {
        let generatedCode = '';
        let fileName = '';
        if (target === 'main') {
          generatedCode = generateMainHandlerCode(functions, logger);
          fileName = GENERATED_MAIN_HANDLERS;
        } else if (target === 'preload') {
          generatedCode = generatePreloadBridgeCode(functions, logger);
          fileName = GENERATED_PRELOAD_BRIDGE;
        }
        if (fileName && generatedCode) {
          this.emitFile({
            type: 'asset',
            fileName: fileName,
            source: generatedCode,
          });
          logger.info(
            `[${PLUGIN_NAME}:${target}] Emitted generated asset: ${fileName}`
          );
          const outputDir =
            options.dir || path.join(config.build.outDir || 'dist', target);
          try {
            const outputPath = path.resolve(rootDir, outputDir, fileName);
            // Ensure the exact string content is written to disk without any transformation
            await fs.outputFile(outputPath, generatedCode);
            logger.info(
              `[${PLUGIN_NAME}:${target}] Also wrote generated file directly to: ${outputPath}`
            );
          } catch (writeError: any) {
            logger.warn(
              `[${PLUGIN_NAME}:${target}] Failed to write generated file directly to ${outputDir}: ${writeError.message}`
            );
          }
        }
      } catch (error: any) {
        logger.error(
          `[${PLUGIN_NAME}:${target}] Error during ${target} output generation: ${error.message}`,
          { error }
        );
      }
    },
  };
}
