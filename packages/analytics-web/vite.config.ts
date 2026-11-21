import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Connect, type Plugin } from 'vite';

const target = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8080';
const sdkDir = resolve(fileURLToPath(new URL('../sdk-web/dist', import.meta.url)));

/**
 * 把 /sdk/* 映射到 packages/sdk-web/dist，
 * 让管理后台一键复制的接入代码在本地（dev / preview）就能直接跑通。
 */
function serveTrackSdk(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url ?? '';
    if (!url.startsWith('/sdk/')) {
      next();
      return;
    }
    const relative = decodeURIComponent(url.slice('/sdk/'.length).split('?')[0] ?? '');
    const file = resolve(sdkDir, relative);
    if (!file.startsWith(sdkDir) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end('sdk not found');
      return;
    }
    res.setHeader('content-type', extname(file) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream');
    res.setHeader('cache-control', 'no-cache');
    createReadStream(file).pipe(res);
  };

  return {
    name: 'serve-track-sdk',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [vue(), serveTrackSdk()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': { target, changeOrigin: true },
    },
  },
  preview: {
    port: 4174,
    proxy: {
      '/api': { target, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
