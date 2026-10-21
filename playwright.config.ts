import { defineConfig } from '@playwright/test';

// 端到端测试：用容器里的系统 chromium（不下载 playwright 自带浏览器）
export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173',
    launchOptions: { executablePath: process.env.CHROME_BIN ?? '/usr/bin/chromium' },
    viewport: { width: 412, height: 915 },
    locale: 'zh-CN',
    screenshot: 'only-on-failure',
  },
});
