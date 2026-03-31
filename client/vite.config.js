import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';
import { existsSync, readdirSync, writeFileSync } from 'fs';

/** Generate data/courses/index.json listing all .md files in the directory. */
function courseManifestPlugin() {
  return {
    name: 'course-manifest',
    buildStart() {
      const dir = resolve(import.meta.dirname, 'data/courses');
      if (!existsSync(dir)) return;
      const files = readdirSync(dir).filter(f => f.endsWith('.md'));
      const ids = files.map(f => f.replace(/\.md$/, ''));
      writeFileSync(resolve(dir, 'index.json'), JSON.stringify(ids));
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    courseManifestPlugin(),
    viteStaticCopy({
      targets: [
        { src: 'lib', dest: '' },
        { src: 'data', dest: '' },
        { src: 'prompts', dest: '' },
        { src: 'assets', dest: '' },
        { src: 'js', dest: '' },
        ...(existsSync('.env.js') ? [{ src: '.env.js', dest: '', rename: '.env.js' }] : []),
      ],
    }),
  ],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'index.html'),
    },
  },
});
