import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { useElectronMainPlugin } from 'vite-plugin-use-electron'

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin(),
      // Add the plugin for main process
      useElectronMainPlugin('main', {
        directiveKeyword: 'use electron' // Match the directive used in the renderer
      })
    ],
    build: {
      outDir: 'dist/main'
    }
  },
  preload: {
    plugins: [
      externalizeDepsPlugin(),
      // Add the plugin for preload process
      useElectronMainPlugin('preload', {
        directiveKeyword: 'use electron' // Match the directive used in the renderer
      })
    ],
    build: {
      outDir: 'dist/preload'
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [
      react(),
      // Add the plugin for renderer process
      useElectronMainPlugin('renderer', {
        generateTypes: false, // Disable TypeScript definitions generation
        directiveKeyword: 'use electron'
      })
    ],
    build: {
      outDir: 'dist/renderer'
    }
  }
}) 