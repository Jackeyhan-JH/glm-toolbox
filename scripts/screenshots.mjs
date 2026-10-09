#!/usr/bin/env node
/**
 * screenshots：生成 docs/screenshots/ 下的 README 截图（Playwright + Chromium）。
 *
 * 产物：首页浅色 / 首页深色 / 手机视图 + 3 个代表性工具
 * （JSON 格式化、正则测试、时间戳转换）。
 *
 * 用法：node scripts/screenshots.mjs [--out docs/screenshots]
 * 需要先 npm run build 或 npx playwright install chromium。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { generate } from './gen-index.mjs';
import { startServer } from './serve.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------- 工具页的示例输入（让截图言之有物） ---------------- */

const TOOL_SAMPLES = {
  'json-format': async (page) => {
    await page.locator('#json-format-input').fill(
      [
        '{"name":"码工具箱","offline":true,"tools":21,',
        ' "features":["格式化","校验","压缩"],',
        ' "tags":{"lang":"zh-CN","pwa":true}}',
      ].join('\n'),
    );
    await page.waitForTimeout(400); // 等防抖格式化完成
  },
  regex: async (page) => {
    await page.locator('[data-testid="regex-pattern"]').fill('(\\w+)@(\\w+\\.\\w+)');
    await page.locator('[data-testid="regex-flag-g"]').click(); // 打开全局标志
    await page
      .locator('[data-testid="regex-text"]')
      .fill('联系人：jack@example.com、rose@test.org\n备用：admin@site.net');
    await page.waitForTimeout(400);
  },
  timestamp: async (page) => {
    await page.waitForTimeout(300); // 等初始渲染与「现在」刷新
  },
};

/* ---------------- 主流程 ---------------- */

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  const outDir = path.resolve(values.out ?? path.join(REPO_ROOT, 'docs', 'screenshots'));
  fs.mkdirSync(outDir, { recursive: true });

  // 工具索引 + 本地服务
  if (!fs.existsSync(path.join(REPO_ROOT, 'tools', 'index.json'))) generate();
  const server = startServer({ port: 0, root: REPO_ROOT });
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://localhost:${port}/`;

  const browser = await chromium.launch();
  try {
    /* 首页：浅色 / 深色 */
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        colorScheme: theme,
      });
      const page = await context.newPage();
      await page.goto(baseUrl);
      await page.locator('.card', { hasText: '字数统计' }).waitFor();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(outDir, `home-${theme}.png`), fullPage: true });
      await context.close();
    }

    /* 手机视图（375×667，浅色） */
    {
      const context = await browser.newContext({
        viewport: { width: 375, height: 667 },
        colorScheme: 'light',
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      await page.goto(baseUrl);
      await page.locator('.card', { hasText: '字数统计' }).waitFor();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(outDir, 'home-mobile.png'), fullPage: true });
      await context.close();
    }

    /* 三个代表性工具（浅色，桌面） */
    for (const id of Object.keys(TOOL_SAMPLES)) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        colorScheme: 'light',
      });
      const page = await context.newPage();
      await page.goto(`${baseUrl}#/${id}`);
      await page.locator(`[data-tool-ready="${id}"]`).waitFor();
      await TOOL_SAMPLES[id](page);
      await page.screenshot({ path: path.join(outDir, `tool-${id}.png`), fullPage: false });
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`已生成截图（${outDir}）：`);
  for (const name of fs.readdirSync(outDir).sort()) console.log(`  ${name}`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
