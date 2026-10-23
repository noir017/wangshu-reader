import { defineConfig } from '@playwright/test';

// 端到端测试：默认用 playwright 自带的 chromium（npx playwright install chromium），CHROME_BIN 可换成别的浏览器。
// 怎么跑见 .github/workflows/ci.yml 的 e2e job
export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173',
    launchOptions: process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {},
    viewport: { width: 412, height: 915 },
    locale: 'zh-CN',
    screenshot: 'only-on-failure',
  },
});
