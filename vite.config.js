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
    https: (() => {
      const keyPath = path.resolve(__dirname, 'certs/server.key');
      const certPath = path.resolve(__dirname, 'certs/server.cert');
      if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        return {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath),
        };
      }
      return false; // Fallback to HTTP for build/dev if certs are missing
    })(),
    proxy: {
      '/ws': {
        target: 'https://127.0.0.1:3000',
        ws: true,
        changeOrigin: true,
        secure: false, // Ignore self-signed certs
        // [Reliability] Suppress noisy socket resets during dev/mobile reconnects
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            const silent = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECANCELED'].includes(err.code);
            if (silent) return;
            console.warn('[Vite Proxy] Socket Error:', err.message);
          });
          proxy.on('proxyReqWs', (proxyReq, req, socket, options, head) => {
            socket.on('error', (err) => {
              const silent = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECANCELED'].includes(err.code);
              if (silent) return;
              console.warn('[Vite Proxy] WS Socket Error:', err.message);
            });
          });
        },
      },
      '/api': {
        target: 'https://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
