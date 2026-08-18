/// <reference types="vitest" />
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { buildInfoDefines, readBuildInfo } from '../../scripts/build-info.mjs';

export default defineConfig({
  // This repo keeps a single .env at the workspace root (created by
  // scripts/bootstrap-dev.mjs and read by the server via --env-file). Vite
  // defaults to its own package directory, which would silently ignore it and
  // leave every VITE_* var undefined.
  envDir: path.resolve(__dirname, '../..'),
  define: buildInfoDefines(readBuildInfo(process.cwd())),
  plugins: [
    react(),
    // Emits dist/stats.html on every build. Open it after `pnpm build` to
    // inspect chunk sizes and confirm route-level code splitting.
    visualizer({
      filename: 'dist/stats.html',
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      // Swagger UI is served by the API server. Both here and when deployed it
      // needs an explicit proxy rule, or the SPA's catch-all route intercepts
      // /docs and redirects to /. The deployed equivalent is a `/docs` route on
      // the reverse proxy.
      '/docs': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Browser telemetry ingress. Points at the OTLP/HTTP port of the local
      // collector, not the API server. The deployed equivalent is a `/otel`
      // route on the reverse proxy pointing at the collector's OTLP/HTTP port.
      '/otel': {
        target: 'http://localhost:4318',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/otel/, ''),
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
        // Cookies set with Path=/auth/refresh would not be sent by the browser
        // to /api/auth/refresh; rewrite the Path attribute on the way back.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const setCookie = proxyRes.headers['set-cookie'];
            if (setCookie) {
              proxyRes.headers['set-cookie'] = setCookie.map((c) =>
                c.replace(/Path=\/(?!api\/)/i, 'Path=/api/'),
              );
            }
          });
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    // Node >= 26 ships Web Storage on by default, so `localStorage` and
    // `sessionStorage` already exist as globals in the worker — inert ones,
    // since they need --localstorage-file to work. Vitest's jsdom environment
    // never overwrites a global that is already defined, so jsdom's working
    // Storage gets skipped and every `localStorage.*` call throws. Dropping the
    // Node feature hands those globals back to jsdom.
    execArgv: ['--no-experimental-webstorage'],
  },
});
