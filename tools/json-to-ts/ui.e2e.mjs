/** JSON 转 TS 类型端到端测试（对应 issue #5「验收标准」） */

import { test, expect, openTool } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const INPUT = '[data-testid="json-to-ts-input"]';
const OUTPUT = '[data-testid="json-to-ts-output"]';

/** issue #5 验收标准的第一个例子 */
const EXAMPLE_1 =
  '{"id":1,"user_name":"a","tags":["x"],"profile":{"age":3,"avatar":null},' +
  '"items":[{"sku":"A","qty":1},{"sku":"B","price":9.5}]}';

const EXAMPLE_1_EXPECTED = `export interface Root {
  id: number;
  user_name: string;
  tags: string[];
  profile: Profile;
  items: Item[];
}

export interface Profile {
  age: number;
  avatar: null;
}

export interface Item {
  sku: string;
  qty?: number;
  price?: number;
}`;

/** 读取输出文本（textContent 原样保留换行，不做空白归一化） */
async function outputText(page) {
  return page.locator(OUTPUT).textContent();
}

test.describe('JSON 转 TS 类型', () => {
  test('标题与侧边栏高亮', async ({ page }) => {
    await openTool(page, 'json-to-ts');
    await expect(page).toHaveTitle('JSON 转 TS 类型 - 码工具箱');
    await expect(
      page.locator('#tool-nav .nav-item[data-tool-id="json-to-ts"]'),
    ).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('heading', { name: 'JSON 转 TS 类型' })).toBeVisible();
  });

  test('搜索关键词能找到本工具', async ({ page }) => {
    await page.goto('/');
    for (const keyword of ['leixing', 'typescript', '类型']) {
      await page.getByLabel('搜索工具').fill(keyword);
      await expect(
        page.locator('#tool-nav').getByRole('link', { name: 'JSON 转 TS 类型' }),
      ).toBeVisible();
    }
    // 回车进入工具
    await page.getByLabel('搜索工具').press('Enter');
    await expect(page.locator('[data-tool-ready="json-to-ts"]')).toBeAttached();
  });

  test('初始状态：无输入、无错误、输出为空', async ({ page }) => {
    await openTool(page, 'json-to-ts');
    await expect(page.locator(INPUT)).toHaveValue('');
    await expect(page.locator(OUTPUT)).toHaveText('');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('综合示例：默认选项下逐字生成预期类型（防抖自动更新）', async ({ page }) => {
    await openTool(page, 'json-to-ts');
    await page.locator(INPUT).fill(EXAMPLE_1);
    // expect.poll 自动重试，等防抖更新完成后精确比较整段输出
    await expect.poll(outputText.bind(null, page)).toBe(EXAMPLE_1_EXPECTED);
  });

  test('特殊键加双引号、根数组、空对象与空数组', async ({ page }) => {
    await openTool(page, 'json-to-ts');

    await page.locator(INPUT).fill('{"a-b":1,"2x":true,"ok":"y"}');
    await expect(page.locator(OUTPUT)).toContainText('"a-b": number;');
    await expect(page.locator(OUTPUT)).toContainText('"2x": boolean;');
    await expect(page.locator(OUTPUT)).toContainText('ok: string;');

    await page.locator(INPUT).fill('[1,"a",null]');
    await expect(page.locator(OUTPUT)).toContainText('export type Root = (number | string | null)[];');

    await page.locator(INPUT).fill('{}');
    await expect(page.locator(OUTPUT)).toContainText('export interface Root {}');

    await page.locator(INPUT).fill('[]');
    await expect(page.locator(OUTPUT)).toContainText('export type Root = unknown[];');
  });

  test('type 模式：Profile 以 export type Profile = { 开头', async ({ page }) => {
    await openTool(page, 'json-to-ts');
    await page.locator(INPUT).fill(EXAMPLE_1);
    await page.getByRole('button', { name: 'type', exact: true }).click();
    await expect(page.locator(OUTPUT)).toContainText('export type Profile = {');
    await expect(page.locator(OUTPUT)).toContainText('  avatar: null;\n};');
  });

  test('去掉 export 选项后输出中不含 export', async ({ page }) => {
    await openTool(page, 'json-to-ts');
    await page.locator(INPUT).fill(EXAMPLE_1);
    await expect(page.locator(OUTPUT)).toContainText('export interface Root {');
    await page.getByLabel('加 export').uncheck();
    await expect
      .poll(async () => (await outputText(page)).includes('export'))
      .toBe(false);
    await expect(page.locator(OUTPUT)).toContainText('interface Root {');
  });

  test('可选属性写法切换为 | undefined', async ({ page }) => {
    await openTool(page, 'json-to-ts');
    await page.locator(INPUT).fill(EXAMPLE_1);
    await expect(page.locator(OUTPUT)).toContainText('qty?: number;');
    await page.getByRole('button', { name: '| undefined', exact: true }).click();
    await expect(page.locator(OUTPUT)).toContainText('qty: number | undefined;');
  });

  test('修改根类型名为 ApiResponse → 第一行为 export interface ApiResponse {', async ({ page }) => {
    await openTool(page, 'json-to-ts');
    await page.locator(INPUT).fill(EXAMPLE_1);
    await page.getByLabel('根类型名').fill('ApiResponse');
    await expect(page.locator(OUTPUT)).toContainText('export interface ApiResponse {');
    await expect
      .poll(async () => (await outputText(page)).split('\n')[0])
      .toBe('export interface ApiResponse {');
  });

  test('非法 JSON：中文错误提示，且不输出半截类型；修正后恢复', async ({ page }) => {
    await openTool(page, 'json-to-ts');
    await page.locator(INPUT).fill('{a:1}'); // 键名未加引号，非法
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('JSON 格式有误，无法解析');
    await expect.poll(outputText.bind(null, page)).toBe(''); // 不残留半截类型

    // 修正为合法 JSON 后错误消失
    await page.locator(INPUT).fill('{"a":1,"b":"x"}');
    await expect(alert).toHaveCount(0);
    await expect(page.locator(OUTPUT)).toContainText('b: string;');
  });

  test('「复制类型定义」复制的内容与输出完全一致', async ({ page }) => {
    await openTool(page, 'json-to-ts');
    await page.locator(INPUT).fill(EXAMPLE_1);
    await expect(page.locator(OUTPUT)).toContainText('export interface Item {');

    await page.getByRole('button', { name: '复制类型定义' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(await outputText(page));
    expect(clipboard).toContain('export interface Root {');
  });

  test('刷新后恢复上次输入与选项', async ({ page }) => {
    await openTool(page, 'json-to-ts');
    await page.locator(INPUT).fill(EXAMPLE_1);
    await page.getByLabel('根类型名').fill('ApiResponse');
    await expect(page.locator(OUTPUT)).toContainText('export interface ApiResponse {');

    await page.reload();
    await expect(page.locator('[data-tool-ready="json-to-ts"]')).toBeAttached();
    await expect(page.locator(INPUT)).toHaveValue(EXAMPLE_1);
    await expect(page.getByLabel('根类型名')).toHaveValue('ApiResponse');
    await expect(page.locator(OUTPUT)).toContainText('export interface ApiResponse {');

    const stored = await page.evaluate(() => localStorage.getItem('glm-toolbox:json-to-ts:text'));
    expect(JSON.parse(stored)).toBe(EXAMPLE_1); // storage 值经 JSON 序列化
  });

  test('浅色主题下界面可读且工作正常', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openTool(page, 'json-to-ts');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator(INPUT).fill(EXAMPLE_1);
    await expect(page.locator(OUTPUT)).toContainText('export interface Root {');
  });

  test('深色主题下界面可读且工作正常', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openTool(page, 'json-to-ts');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator(INPUT).fill(EXAMPLE_1);
    await expect(page.locator(OUTPUT)).toContainText('export interface Root {');
  });

  test('1MB JSON 不卡死，正常生成结果', async ({ page }) => {
    await openTool(page, 'json-to-ts');
    await page.locator(INPUT).fill('{"a":1}');
    await expect(page.locator(OUTPUT)).toContainText('a: number;');

    // 直接设置大 value 并触发 input（fill 1MB 太慢）
    await page.evaluate(() => {
      const ta = document.querySelector('[data-testid="json-to-ts-input"]');
      const items = Array.from({ length: 12000 }, (_, i) => ({
        id: i,
        name: `name-${i}`,
        active: i % 2 === 0,
        tags: ['a', 'b', 'c'],
        profile: { created: true, score: i * 0.5, city: `city-${i % 99}` },
      }));
      ta.value = JSON.stringify({ items });
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator(OUTPUT)).toContainText('items: Item[];', { timeout: 10_000 });
    await expect(page.locator(OUTPUT)).toContainText('score: number;');
    // 页面仍可响应
    expect(await page.evaluate(() => 1 + 1)).toBe(2);
  });
});

test.describe('JSON 转 TS 类型（移动端 375×667）', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('无横向滚动，输入输出正常', async ({ page }) => {
    await openTool(page, 'json-to-ts');
    await page.locator(INPUT).fill(EXAMPLE_1);
    await expect(page.locator(OUTPUT)).toContainText('export interface Item {');

    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noOverflow).toBe(true);
  });
});
