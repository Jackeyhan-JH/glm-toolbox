import { defineConfig } from '@playwright/test';

/**
 * 端到端测试配置。
 *
 * 端口约定（多 worktree 并行时必须错开，见 CONTRIBUTING.md）：
 *   E2E_PORT        主服务端口（--base /），默认 4173
 *   E2E_PORT + 1    子路径服务端口（--base /glm-toolbox/，模拟 GitHub Pages）
 * 运行：E2E_PORT=41020 npm run e2e
 */

const PORT = Number(process.env.E2E_PORT || 4173);
const SUBPATH_PORT = PORT + 1;

export default defineConfig({
  testMatch: '**/*.e2e.mjs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
    screenshot: 'retain-on-failure',
  },
  webServer: [
    {
      command: `node scripts/serve.mjs --port ${PORT}`,
      url: `http://localhost:${PORT}/tools/index.json`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `node scripts/serve.mjs --port ${SUBPATH_PORT} --base /glm-toolbox/`,
      url: `http://localhost:${SUBPATH_PORT}/glm-toolbox/tools/index.json`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
