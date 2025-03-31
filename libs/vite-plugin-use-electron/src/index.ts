// Export plugin from the main file
import { useElectronMainPlugin } from './lib/use-electron';
export { useElectronMainPlugin } 

// Export the plugin options interface for TypeScript users
export interface useElectronMainPluginOptions {
  /**
   * Whether to generate TypeScript type definitions (rpcTree.gen.ts)
   * @default false
   */
  generateTypes?: boolean;
  /**
   * The directive keyword to identify functions that should be exposed to the renderer
   * @default 'use electron'
   */
  directiveKeyword?: 'use electron' | 'use electron-main' | 'use main';
}

// Default export for compatibility
export default useElectronMainPlugin;
