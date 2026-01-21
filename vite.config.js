import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron/simple';
import { resolve } from 'path';

const rootDir = __dirname;

export default defineConfig(({ command }) => ({
  // Use web/ as the single source of truth for the renderer
  root: 'web',

  // Build with relative asset paths so the same output works for:
  // - GitHub Pages (/repo/)
  // - Electron loadFile() (file://.../dist/index.html)
  base: command === 'build' ? './' : '/',

  plugins: [
    electron({
      main: {
        entry: resolve(rootDir, 'electron/main.js'),
        vite: {
          build: {
            outDir: resolve(rootDir, 'dist-electron'),
          },
        },
      },
      preload: {
        input: resolve(rootDir, 'electron/preload.js'),
        vite: {
          build: {
            outDir: resolve(rootDir, 'dist-electron'),
          },
        },
      },
    }),
  ],
  build: {
    outDir: resolve(rootDir, 'dist'),
    emptyOutDir: true
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
  }
}));
