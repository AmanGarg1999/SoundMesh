import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';

import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
    https: {
      key: fs.readFileSync(path.resolve(__dirname, 'certs/server.key')),
      cert: fs.readFileSync(path.resolve(__dirname, 'certs/server.cert')),
    },
    proxy: {
      '/ws': {
        target: 'https://127.0.0.1:3000',
        ws: true,
        changeOrigin: true,
        secure: false, // Ignore self-signed certs
      },
      '/api': {
        target: 'https://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
      },
      '/worklets': {
        target: 'https://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
