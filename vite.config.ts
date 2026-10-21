/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// mode=single：把 JS/CSS/字体/worker 全部内联进一个 html（dist-single/index.html），可直接 file:// 打开
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: [react(), ...(single ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      },
    },
    define: {
      __BUILD_MODE__: JSON.stringify(single ? 'single' : 'standard'),
    },
    build: {
      outDir: single ? 'dist-single' : 'dist',
      target: 'es2022',
      chunkSizeWarningLimit: 4096,
      ...(single ? { assetsInlineLimit: () => true, cssCodeSplit: false } : {}),
    },
    worker: { format: 'es' },
    server: {
      proxy: { '/api': 'http://127.0.0.1:8090' },
    },
    test: {
      environment: 'happy-dom',
      include: ['src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts', 'server/**/*.test.ts', 'tests/unit/**/*.test.{ts,tsx}'],
      setupFiles: ['tests/setup.ts'],
    },
  };
});
