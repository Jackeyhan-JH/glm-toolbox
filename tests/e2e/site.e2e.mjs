/**
 * 全站回归测试（issue #23 收尾）：
 *   1. 读取生成的 tools/index.json，动态遍历**全部**工具：
 *      浅色 / 深色 × 桌面 1280×800 / 手机 375×667 下挂载成功、标题正确、
 *      无横向滚动、无控制台错误 / 未捕获异常 / 外部请求（由夹具保证）；
 *   2. axe 无障碍扫描（首页 + 每个工具页 × 两种主题）无 serious / critical 违规；
 *   3. 键盘可用性（跳转链接、Ctrl+K 搜索、Tab 序、方向键）与 prefers-reduced-motion；
 *   4. 移动端抽屉（Esc / 焦点管理）与工具页连续切换 20 次的清理回归。
 * 新增工具自动被本文件覆盖，无需登记。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures.mjs';
import { generate } from '../../scripts/gen-index.mjs';

/* ---------------- 工具清单（读取生成的 tools/index.json） ---------------- */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX_PATH = path.join(REPO_ROOT, 'tools', 'index.json');

// e2e 直接启动（npm run e2e）时 pretest 未运行，先确保索引存在
if (!fs.existsSync(INDEX_PATH)) generate();

const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
const tools = index.tools;
const toolIds = tools.map((t) => t.id);

/* ---------------- 辅助 ---------------- */

/** 断言当前页面无横向滚动 */
async function expectNoHorizontalScroll(page, viewportWidth) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(
    scrollWidth,
    `横向溢出：scrollWidth=${scrollWidth} > 视口 ${viewportWidth}（${page.url()}）`,
  ).toBeLessThanOrEqual(viewportWidth);
}

/**
 * 颜色工具的「示例预览」区域本身就是在演示一对可能不达标的对比色
 * （默认 #777777 / #ffffff，其工具 e2e 固定了该行为），不属于界面自身
 * 的对比度缺陷 —— 扫描时排除该演示区，其余区域照常检查。
 */
const AXE_EXCLUDES = {
  color: ['.color-sample'],
};

/** 断言 axe 扫描无 serious / critical 违规 */
async function expectAxeClean(page, label) {
  let builder = new AxeBuilder({ page });
  for (const selector of AXE_EXCLUDES[label.split(' ')[0]] ?? []) builder = builder.exclude(selector);
  const results = await builder.analyze();
  const blocking = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  const summary = blocking
    .map((v) => `${v.id}（${v.impact}）：${v.nodes.map((n) => n.target.join(' ')).slice(0, 4).join('， ')}`)
    .join('\n  ');
  expect(
    blocking,
    `${label} 存在 ${blocking.length} 类 serious / critical 无障碍违规：\n  ${summary}`,
  ).toEqual([]);
}

/** 切到指定主题（经主题按钮，走 setTheme 通知链路），并等待过渡动画结束 */
async function setTheme(page, theme) {
  const current = await page.locator('html').getAttribute('data-theme');
  if (current !== theme) {
    await page.getByRole('button', { name: '切换主题' }).click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  // 等待主题色的过渡动画结束（部分工具有 background 过渡，中途采样对比度会误报）
  await page.waitForTimeout(300);
}

/* ==================== 1. 全站回归：动态遍历全部工具 ==================== */

test.describe('全站回归', () => {
  test(`遍历 tools/index.json 全部 ${tools.length} 个工具（首页与侧边栏完整呈现）`, async ({ page }) => {
    console.log(`[site.e2e] 全站回归遍历到 ${tools.length} 个工具：${toolIds.join('、')}`);

    // 与磁盘上的 tools/*/tool.json 数量一致（生成的索引没有遗漏）
    const dirCount = fs
      .readdirSync(path.join(REPO_ROOT, 'tools'), { withFileTypes: true })
      .filter((d) => d.isDirectory()).length;
    expect(tools.length, 'index.json 应覆盖每个 tools/<id>/ 目录').toBe(dirCount);
    expect(tools.length).toBeGreaterThanOrEqual(21); // 字数统计 + 20 个工具 issue

    await page.goto('/');
    for (const tool of tools) {
      await expect(
        page.locator(`.nav-item[data-tool-id="${tool.id}"]`),
        `${tool.id} 应出现在侧边栏`,
      ).toBeAttached();
    }
  });

  for (const tool of tools) {
    test(`回归：${tool.name}（${tool.id}）× 2 主题 × 2 视口`, async ({ page }) => {
      // —— 桌面 1280×800 ——
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/#/${tool.id}`);
      await page.locator(`[data-tool-ready="${tool.id}"]`).waitFor();
      await expect(page).toHaveTitle(`${tool.name} - 码工具箱`);
      await expectNoHorizontalScroll(page, 1280);

      // 浅色 + 深色各扫一次 axe（深色经主题按钮切换，覆盖 onThemeChange 链路）
      await setTheme(page, 'light');
      await expectAxeClean(page, `${tool.id} 浅色`);
      await setTheme(page, 'dark');
      await expectAxeClean(page, `${tool.id} 深色`);
      await expectNoHorizontalScroll(page, 1280);

      // —— 手机 375×667（直接缩放视口，页面即时重排）——
      await page.setViewportSize({ width: 375, height: 667 });
      await expectNoHorizontalScroll(page, 375);
      await setTheme(page, 'light');
      await expectNoHorizontalScroll(page, 375);
    });
  }

  test('在任一工具页之间连续切换 20 次（随机顺序）后无报错（清理函数生效）', async ({ page }) => {
    await page.goto('/');
    // 固定种子的伪随机：顺序随机但可复现
    let seed = 0x20261023;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const order = Array.from({ length: 20 }, () => toolIds[Math.floor(rnd() * toolIds.length)]);

    for (const id of order) {
      await page.evaluate((hash) => {
        location.hash = hash;
      }, `#/${id}`);
      await page.locator(`[data-tool-ready="${id}"]`).waitFor({ timeout: 10_000 });
    }

    // 停留片刻：若上一工具残留的定时器仍存活并抛错，夹具会让本用例失败
    await page.waitForTimeout(1500);
    const last = order[order.length - 1];
    await expect(page.locator(`[data-tool-ready="${last}"]`)).toBeAttached();
  });
});

/* ==================== 2. 首页 / 搜索 / 路由 / 主题冒烟 ==================== */

test.describe('首页冒烟回归', () => {
  test('首页按分类完整呈现，axe 两种主题无 serious / critical 违规', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '离线开发者工具箱' })).toBeVisible();
    for (const tool of tools) {
      await expect(page.locator('.card', { hasText: tool.name }).first()).toBeVisible();
    }

    await setTheme(page, 'light');
    await expectAxeClean(page, '首页浅色');
    await setTheme(page, 'dark');
    await expectAxeClean(page, '首页深色');
  });

  test('搜索 → 回车进入工具 → 后退回首页 → 主题切换持久化', async ({ page }) => {
    await page.goto('/');
    const search = page.getByLabel('搜索工具');
    await search.fill('json');
    const first = page.locator('#tool-nav .nav-item').first();
    await expect(first).toHaveAttribute('data-tool-id', 'json-format');
    await search.press('Enter');
    await expect(page.locator('[data-tool-ready="json-format"]')).toBeAttached();

    await page.goBack();
    await expect(page.getByRole('heading', { name: '离线开发者工具箱' })).toBeVisible();

    await setTheme(page, 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

/* ==================== 3. 无障碍：键盘与动效 ==================== */

test.describe('键盘可用性', () => {
  test('Tab 第一个焦点是「跳到主要内容」，Enter 跳到主区域', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: '跳到主要内容' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#content')).toBeFocused();
    // URL 不变（跳转链接不触发 hash 路由）
    await expect(page).toHaveURL(/\/$|#\/$/);
  });

  test('Ctrl+K / ⌘K 聚焦搜索；输入 json 回车进入 JSON 格式化；Tab 到达输入框与按钮，Enter 触发', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await expect(page.getByLabel('搜索工具')).toBeFocused();

    await page.keyboard.type('json');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-tool-ready="json-format"]')).toBeAttached();

    // Tab 能到达工具的输入框（textarea）与「格式化」按钮
    const textarea = page.locator('#json-format-input');
    await tabUntilFocused(page, textarea, 60);
    await textarea.fill('{"b":1,"a":[1,2]}');

    const formatBtn = page.getByRole('button', { name: '格式化', exact: true });
    await tabUntilFocused(page, formatBtn, 60);
    await page.keyboard.press('Enter');

    const output = page.locator('[data-testid="json-format-output"]');
    await expect(output).toHaveValue(/"b":\s*1/);
  });

  test('侧边栏列表可用 ↑ / ↓ 方向键移动焦点', async ({ page }) => {
    await page.goto('/');
    const items = page.locator('#tool-nav .nav-item');
    const count = await items.count();
    expect(count).toBe(tools.length);

    await items.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(items.first()).toBeFocused();
    // 列表末尾再按 ↓ 回到开头（循环）
    await items.nth(count - 1).focus();
    await page.keyboard.press('ArrowDown');
    await expect(items.first()).toBeFocused();
  });
});

/** 连续按 Tab 直到目标元素获得焦点（或超限失败） */
async function tabUntilFocused(page, locator, maxPresses) {
  for (let i = 0; i < maxPresses; i++) {
    if ((await locator.evaluate((n) => n === document.activeElement)) === true) return;
    await page.keyboard.press('Tab');
  }
  await expect(locator, '应能通过 Tab 到达').toBeFocused();
}

test.describe('prefers-reduced-motion', () => {
  test('reduce 时关键元素 transition-duration 为 0s', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const durations = await page.evaluate(() => {
      const pick = (sel) => document.querySelector(sel);
      const nodes = [pick('.card'), pick('.skip-link'), pick('.icon-btn'), pick('.nav-item')].filter(
        Boolean,
      );
      return nodes.map((n) => getComputedStyle(n).transitionDuration);
    });
    expect(durations.length).toBeGreaterThan(0);
    for (const d of durations) expect(d).toBe('0s');
  });
});

/* ==================== 4. 移动端抽屉 ==================== */

test.describe('移动端 375×667：抽屉与焦点管理', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('打开抽屉焦点移入；Esc 关闭且焦点回到汉堡按钮；选工具后抽屉关闭并进入工具', async ({ page }) => {
    await page.goto('/');
    const menuBtn = page.getByRole('button', { name: '打开菜单' });
    await expect(menuBtn).toBeVisible();

    // 打开：焦点移入抽屉（搜索框）
    await menuBtn.click();
    await expect(page.locator('#sidebar')).toHaveClass(/open/);
    await expect(page.getByLabel('搜索工具')).toBeFocused();

    // Esc 关闭，焦点回到汉堡按钮
    await page.keyboard.press('Escape');
    await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
    await expect(menuBtn).toBeFocused();

    // 点遮罩关闭
    await menuBtn.click();
    await page.locator('.sidebar-backdrop').click();
    await expect(page.locator('#sidebar')).not.toHaveClass(/open/);

    // 选中工具后抽屉关闭并进入工具
    await menuBtn.click();
    await page.locator('#tool-nav').getByRole('link', { name: '字数统计' }).click();
    await expect(page.locator('[data-tool-ready="word-count"]')).toBeAttached();
    await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
  });

  test('抽屉打开时 Tab 在抽屉内循环（不跑到遮罩后的内容）', async ({ page }) => {
    await page.goto('/');
    const menuBtn = page.getByRole('button', { name: '打开菜单' });
    await menuBtn.click();
    await expect(page.locator('#sidebar')).toHaveClass(/open/);

    // 从搜索框一直 Tab 到抽屉最后一个可聚焦元素，再 Tab 应回到抽屉开头
    const sidebarId = await page.evaluate(() => {
      const focusables = [...document.querySelectorAll('#sidebar a[href], #sidebar button, #sidebar input')];
      focusables[focusables.length - 1].focus();
      return document.activeElement.closest('#sidebar') ? 'in' : 'out';
    });
    expect(sidebarId).toBe('in');
    await page.keyboard.press('Tab');
    const after = await page.evaluate(() =>
      document.activeElement && document.activeElement.closest('#sidebar') ? 'in' : 'out',
    );
    expect(after, '焦点应循环回抽屉内第一个元素').toBe('in');
  });
});
