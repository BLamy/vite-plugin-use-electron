// Export plugin from the main file
export { useElectronMainPlugin } from './vite-plugin-use-electron';

// Export the plugin options interface for TypeScript users
export interface useElectronMainPluginOptions {
  generateTypes?: boolean;
  directiveKeyword?: 'use electron' | 'use electron-main' | 'use main';
} 