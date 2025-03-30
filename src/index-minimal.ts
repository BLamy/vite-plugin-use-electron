import type { Plugin } from 'vite';

export interface useElectronMainPluginOptions {
  generateTypes?: boolean;
}

export function useElectronMainPlugin(
  target: 'renderer' | 'preload' | 'main', 
  options: useElectronMainPluginOptions = {}
): Plugin {
  return {
    name: `vite-plugin-use-electron-${target}`,
    enforce: 'pre'
  };
} 