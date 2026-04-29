import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';

const pluginsDir = resolve(import.meta.dirname, '..', 'plugins');

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        { src: 'assets', dest: '' },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      '@plugins': pluginsDir,
      // Plugin client code lives outside client/ and has no node_modules of its own.
      // Vite walks up from each plugin file looking for `react`/`react-dom` and finds
      // nothing (the deps are in client/node_modules). Aliasing them explicitly lets
      // plugin-authored .jsx use bare `import { useState } from 'react'`.
      react: resolve(import.meta.dirname, 'node_modules/react'),
      'react-dom': resolve(import.meta.dirname, 'node_modules/react-dom'),
      'react/jsx-runtime': resolve(import.meta.dirname, 'node_modules/react/jsx-runtime.js'),
      'react/jsx-dev-runtime': resolve(import.meta.dirname, 'node_modules/react/jsx-dev-runtime.js'),
    },
  },
  // Plugin glob discovery (client/src/lib/plugins/loader.js) globs `/../plugins/*`.
  // Vite resolves globs relative to the project root, so we need fs.allow to expose
  // the parent plugins/ directory alongside the client/.
  server: {
    fs: {
      allow: [
        resolve(import.meta.dirname, '..'),
      ],
    },
    proxy: {
      '/v1': 'http://localhost:3000',
    },
  },
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'index.html'),
    },
  },
});
