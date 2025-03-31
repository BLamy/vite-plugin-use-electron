/// <reference types='vitest' />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { useElectronMainPlugin } from '../../libs/vite-plugin-use-electron/src/index';

export default defineConfig({
  plugins: [
    react(),
    // Add the plugin for renderer process (transforms "use electron" directives)
    useElectronMainPlugin('renderer', {
      generateTypes: false,
      directiveKeyword: 'use electron' // Use the specified directive
    }),
  ],
  resolve: {
    alias: {
      '@renderer': '/src/renderer',
    },
  },
  server: {
    port: 3000,
  },
  // prevent vite from obscuring rust errors
  clearScreen: false,
  // Root path for our renderer application
  root: 'src/renderer',
  // Base directory for resolving imports
  base: './',
  // Where to build renderer output
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  publicDir: '../../public',
  test: {
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
});
