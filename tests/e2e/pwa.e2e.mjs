/**
 * PWA 离线缓存端到端测试（issue #23）：
 *   - manifest 字段与图标齐全（可在 Chrome 中识别为可安装 PWA）；
 *   - Service Worker 预缓存全部站点文件：离线后首页与全部工具仍可打开
 *     （含简繁转换词表、正则 / 二维码的 Worker 与 vendor 库）；
 *   - 新版本就绪提示「有新版本，点击刷新」，点击后加载新版本；
 *   - npm run dev（源目录）不注册 Service Worker。
 *
 * dist 用 scripts/build.mjs 构建到临时目录，由 scripts/serve.mjs 以
 * --base /glm-toolbox/（模拟 GitHub Pages 子路径）服务。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, BASE_URL } from './fixtures.mjs';
import { buildSite, generateServiceWorker } from '../../scripts/build.mjs';
import { startServer } from '../../scripts/serve.mjs';
import { generate } from '../../scripts/gen-index.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// 直接启动 e2e 时 pretest 未运行，先确保索引存在
if (!fs.existsSync(path.join(REPO_ROOT, 'tools', 'index.json'))) generate();

/**
 * 构建站点到临时目录并以 --base /glm-toolbox/ 启动静态服务。
 * 返回 { origin, baseUrl, distDir, server, close }。
 */
async function startDistSite() {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glm-toolbox-pwa-'));
  buildSite({ root: REPO_ROOT, out: distDir });
  const server = startServer({ port: 0, root: distDir, base: '/glm-toolbox/', dist: true });
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return {
    distDir,
    server,
    origin: `http://localhost:${port}`,
    baseUrl: `http://localhost:${port}/glm-toolbox/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** 等待当前页面的 Service Worker 激活并接管 */
async function waitForActivation(page) {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.active) throw new Error('Service Worker 未激活');
  });
}

const tools = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools', 'index.json'), 'utf8')).tools;

/* ==================== manifest 与图标 ==================== */

test.describe('PWA manifest', () => {
  test('字段齐全（码工具箱 / start_url ./ / scope ./ / 192 与 512 图标可访问）', async ({ request }) => {
    const site = await startDistSite();
    try {
      const response = await request.get(`${site.baseUrl}manifest.webmanifest`);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('application/manifest+json');
      const manifest = await response.json();

      expect(manifest.name).toBe('码工具箱');
      expect(manifest.short_name).toBe('码工具箱');
      expect(manifest.lang).toBe('zh-CN');
      expect(manifest.start_url).toBe('./');
      expect(manifest.scope).toBe('./');
      expect(manifest.display).toBe('standalone');
      expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);

      const icons = manifest.icons ?? [];
      const sizes = new Set(icons.map((i) => i.sizes));
      expect(sizes.has('192x192'), '应有 192 图标').toBe(true);
      expect(sizes.has('512x512'), '应有 512 图标').toBe(true);
      expect(icons.some((i) => i.purpose === 'maskable'), '应有 maskable 图标').toBe(true);

      for (const icon of icons) {
        const res = await request.get(new URL(icon.src, site.baseUrl).href);
        expect(res.status(), `${icon.src} 应可访问`).toBe(200);
        expect(res.headers()['content-type']).toContain('image/png');
      }
    } finally {
      await site.close();
    }
  });
});

/* ==================== 离线可用 ==================== */

test.describe('PWA 离线', () => {
  test('SW 激活后断网：首页可用，全部工具依次打开并完成挂载', async ({ page }) => {
    test.setTimeout(180_000);
    const site = await startDistSite();
    try {
      await page.goto(site.baseUrl);
      await waitForActivation(page);

      // 断网后刷新：导航请求由 SW 回退到缓存的 index.html
      await page.context().setOffline(true);
      await page.reload();
      await expect(page.getByRole('heading', { name: '离线开发者工具箱' })).toBeVisible();

      // 依次打开全部工具（含 zh-convert 词表、regex/qrcode 的 Worker 与 vendor）
      console.log(`[pwa.e2e] 离线遍历 ${tools.length} 个工具`);
      for (const tool of tools) {
        await page.goto(`${site.baseUrl}#/${tool.id}`);
        await page.locator(`[data-tool-ready="${tool.id}"]`).waitFor({ timeout: 20_000 });
      }

      // 回到首页仍正常
      await page.goto(`${site.baseUrl}#/`);
      await expect(page.getByRole('heading', { name: '离线开发者工具箱' })).toBeVisible();
    } finally {
      await page.context().setOffline(false);
      await site.close();
    }
  });
});

/* ==================== 新版本提示 ==================== */

test.describe('PWA 新版本', () => {
  test('重新构建后刷新 → 出现「有新版本，点击刷新」，点击后加载新版本', async ({ page }) => {
    const site = await startDistSite();
    try {
      await page.goto(site.baseUrl);
      await waitForActivation(page);
      await expect(page.getByRole('heading', { name: '离线开发者工具箱' })).toBeVisible();
      await expect(page.locator('[data-sw-update]')).toHaveCount(0); // 首次安装无提示

      // 模拟发布新版本：修改 dist 里的工具文件并重新生成 sw.js（版本号变化）
      const toolEntry = path.join(site.distDir, 'tools', 'word-count', 'index.mjs');
      fs.appendFileSync(toolEntry, '\n/* v2-marker 新版本标记 */\n', 'utf8');
      generateServiceWorker(REPO_ROOT, site.distDir);

      // 刷新页面：浏览器发现新 sw.js → 安装 → 等待接管 → 出现提示
      await page.reload();
      await expect(page.getByRole('button', { name: '有新版本，点击刷新' })).toBeVisible({ timeout: 20_000 });

      // 点击 → skipWaiting → controllerchange → 自动刷新加载新版本
      await page.getByRole('button', { name: '有新版本，点击刷新' }).click();
      await page.waitForFunction(
        () => document.querySelector('[data-sw-update]') === null,
        null,
        { timeout: 20_000 },
      );
      // 新版本已接管：刷新后 word-count 正常挂载（新代码生效）
      await page.goto(`${site.baseUrl}#/word-count`);
      await page.locator('[data-tool-ready="word-count"]').waitFor();
      await expect(page.getByRole('heading', { name: '字数统计' })).toBeVisible();
    } finally {
      await site.close();
    }
  });
});

/* ==================== dev 不注册 ==================== */

test.describe('开发模式', () => {
  test('npm run dev（源目录）不注册 Service Worker', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.getByRole('heading', { name: '离线开发者工具箱' })).toBeVisible();
    const controller = await page.evaluate(() => navigator.serviceWorker.controller);
    expect(controller).toBeNull();
    const registrations = await page.evaluate(() => navigator.serviceWorker.getRegistrations());
    expect(registrations).toHaveLength(0);
  });
});
