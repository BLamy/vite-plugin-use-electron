import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
// Import your plugin (adjust path if needed)
import { useElectronMainPlugin } from './vite-plugin-use-electron' // <--- Make sure this path is correct

export default defineConfig({
  main: {
    plugins: [
      useElectronMainPlugin('main'), // Move before externalizeDepsPlugin
      externalizeDepsPlugin()
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
          assetFileNames: '[name].[ext]'
        }
      },
      outDir: 'out/main', // Matches package.json
    }
  },
  preload: {
    plugins: [
      useElectronMainPlugin('preload'), // Move before externalizeDepsPlugin
      externalizeDepsPlugin()
    ],
     build: {
       rollupOptions: {
          output: {
              entryFileNames: '[name].js',
              chunkFileNames: '[name].js',
              assetFileNames: '[name].[ext]',
          }
       },
       outDir: 'out/preload',
     }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [
      useElectronMainPlugin('renderer'), // Move before react plugin
      react()
    ],
     build: {
       outDir: 'out/renderer',
     }
  }
})