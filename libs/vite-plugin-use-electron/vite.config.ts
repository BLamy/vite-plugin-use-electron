import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'vitePluginUseElectron',
      fileName: 'index',
      formats: ['es'],
    },
    rollupOptions: {
      external: ['react', 'vite', 'electron', 'fs-extra', 'path', 'os'],
      output: {
        globals: {
          react: 'React',
          vite: 'Vite',
          electron: 'Electron',
          'fs-extra': 'fs',
          path: 'path',
          os: 'os'
        },
      },
    },
    sourcemap: true,
    minify: 'esbuild',
  },
  plugins: [
    dts({
      insertTypesEntry: true,
      include: ['src'],
    }),
  ],
}); 