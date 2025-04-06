import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/lib/use-electron.ts'),
      formats: ['es'],
      fileName: 'index'
    },
    rollupOptions: {
      external: [
        '@babel/parser',
        '@babel/traverse',
        '@babel/types',
        'magic-string',
        'react',
        'vite'
      ]
    }
  },
  plugins: [dts()]
}); 