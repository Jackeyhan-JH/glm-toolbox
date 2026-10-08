/** JSON 转换端到端测试（对应 issue #4 的验收标准；标 🖥 的条目在无头浏览器中真实操作） */

import fs from 'node:fs';
import { test, expect, openTool } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const INPUT = '[data-testid="json-convert-input"]';
const OUTPUT = '[data-testid="json-convert-output"]';

const JSON_EXAMPLE = '{"name":"码工具箱","tags":["json","yaml"],"meta":{"stars":5,"draft":false}}';
const YAML_EXAMPLE_OUTPUT = [
  'name: 码工具箱',
  'tags:',
  '  - json',
  '  - yaml',
  'meta:',
  '  stars: 5',
  '  draft: false',
  '',
].join('\n');

const CSV_JSON_INPUT = '[{"id":1,"name":"张三","note":"a,b"},{"id":2,"name":"李\\"四","extra":true}]';
// textarea 的 value 会把 CRLF 规范成 LF，因此页面断言用 \n（单测里保留 \r\n 原文）
const CSV_OUTPUT = 'id,name,note,extra\n1,张三,"a,b",\n2,"李""四",,true';

/** 切换转换方向（按钮可访问名称即模式标签） */
async function switchMode(page, label) {
  await page.getByRole('button', { name: label }).click();
}

test.describe('JSON 转换', () => {
  test('挂载：文档标题、侧边栏高亮、模式切换可用', async ({ page }) => {
    await openTool(page, 'json-convert');
    await expect(page).toHaveTitle('JSON 转换 - 码工具箱');
    await expect(page.getByRole('heading', { name: 'JSON 转换' })).toBeVisible();
    await expect(page.locator('#tool-nav a[data-tool-id="json-convert"]')).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(page.getByRole('button', { name: 'JSON → YAML' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // 输入不进 URL
    await page.locator(INPUT).fill(JSON_EXAMPLE);
    await expect(page).toHaveURL(/#\/json-convert$/);
  });

  test('搜索关键词（拼音 / 英文）能搜到本工具', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('#tool-nav');
    for (const kw of ['zhuanhuan', 'yaml', 'excel']) {
      await page.getByLabel('搜索工具').fill(kw);
      await expect(nav.getByRole('link', { name: 'JSON 转换' })).toBeVisible();
    }
  });

  test('JSON → YAML：验收例 + 输入变化自动更新', async ({ page }) => {
    await openTool(page, 'json-convert');
    await page.locator(INPUT).fill(JSON_EXAMPLE);
    await expect(page.locator(OUTPUT)).toHaveValue(YAML_EXAMPLE_OUTPUT);

    // 防抖后自动更新，无需点按钮
    await page.locator(INPUT).fill('{"a":1}');
    await expect(page.locator(OUTPUT)).toHaveValue('a: 1\n');
  });

  test('JSON → YAML：字符串保型加引号', async ({ page }) => {
    await openTool(page, 'json-convert');
    await page.locator(INPUT).fill('{"v":"123","b":"true","n":"null"}');
    await expect(page.locator(OUTPUT)).toHaveValue("v: '123'\nb: 'true'\nn: 'null'\n");
  });

  test('YAML → JSON：验收例与多文档提示', async ({ page }) => {
    await openTool(page, 'json-convert');
    await switchMode(page, 'YAML → JSON');
    await page.locator(INPUT).fill('a: 1\nb: [x, y]\nc:\n  d: true\n  e: ~');
    await expect(page.locator(OUTPUT)).toHaveValue(
      '{\n  "a": 1,\n  "b": [\n    "x",\n    "y"\n  ],\n  "c": {\n    "d": true,\n    "e": null\n  }\n}\n',
    );

    // 多文档 → JSON 数组 + 提示
    await page.locator(INPUT).fill('---\na: 1\n---\nb: 2\n');
    await expect(page.locator(OUTPUT)).toHaveValue('[\n  {\n    "a": 1\n  },\n  {\n    "b": 2\n  }\n]\n');
    await expect(page.getByTestId('json-convert-notice')).toBeVisible();
    await expect(page.getByTestId('json-convert-notice')).toContainText('2 个 YAML 文档');
  });

  test('YAML 错误：中文提示 + 行号，页面不崩溃', async ({ page }) => {
    await openTool(page, 'json-convert');
    await switchMode(page, 'YAML → JSON');

    await page.locator(INPUT).fill('a: [1, 2');
    await expect(page.getByRole('alert')).toContainText('第 1 行');
    await expect(page.getByRole('alert')).toContainText('未闭合');

    await page.locator(INPUT).fill('a: 1\n  b: 2');
    await expect(page.getByRole('alert')).toContainText('第 2 行');
    await expect(page.getByRole('alert')).toContainText('缩进');

    // 修正后错误消失
    await page.locator(INPUT).fill('a: 1');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator(OUTPUT)).toHaveValue('{\n  "a": 1\n}\n');
  });

  test('JSON → CSV：验收例；非对象数组给中文错误', async ({ page }) => {
    await openTool(page, 'json-convert');
    await switchMode(page, 'JSON → CSV');

    await page.locator(INPUT).fill(CSV_JSON_INPUT);
    await expect(page.locator(OUTPUT)).toHaveValue(CSV_OUTPUT);

    await page.locator(INPUT).fill('{"a":1}');
    await expect(page.getByRole('alert')).toContainText('CSV 转换需要对象数组');

    await page.locator(INPUT).fill('[1,2]');
    await expect(page.getByRole('alert')).toContainText('CSV 转换需要对象数组');
  });

  test('CSV → JSON：自动识别开关与分隔符选项', async ({ page }) => {
    await openTool(page, 'json-convert');
    await switchMode(page, 'CSV → JSON');

    // 默认：自动识别数字和布尔（开）+ 自动识别分隔符
    await page.locator(INPUT).fill('id,ok,name\r\n1,true,"多\n行"\r\n2,,x');
    await expect(page.locator(OUTPUT)).toHaveValue(/"id": 1/);
    await expect(page.locator(OUTPUT)).toHaveValue(/"ok": true/);
    await expect(page.locator(OUTPUT)).toHaveValue(/"name": "多\\n行"/);

    // 关闭自动识别 → 全字符串
    await page.getByLabel('自动识别数字和布尔').uncheck();
    await expect(page.locator(OUTPUT)).toHaveValue(/"id": "1"/);
    await expect(page.locator(OUTPUT)).toHaveValue(/"ok": "true"/);
    await page.getByLabel('自动识别数字和布尔').check();

    // 显式选择分号分隔
    await page.getByLabel('分隔符').selectOption('semicolon');
    await page.locator(INPUT).fill('a;b\n1;2');
    await expect(page.locator(OUTPUT)).toHaveValue(/"a": 1/);
    await expect(page.locator(OUTPUT)).toHaveValue(/"b": 2/);

    // 引号未闭合 → 第 2 行
    await page.getByLabel('分隔符').selectOption('auto');
    await page.locator(INPUT).fill('a,b\n"1,2');
    await expect(page.getByRole('alert')).toContainText('第 2 行');
  });

  test('🖥 JSON → CSV 勾选「带 BOM」：下载文件以 EF BB BF 开头、文件名 .csv 结尾', async ({ page }) => {
    await openTool(page, 'json-convert');
    await switchMode(page, 'JSON → CSV');
    await page.getByLabel('带 BOM（Excel 打开不乱码）').check();
    await page.locator(INPUT).fill(CSV_JSON_INPUT);
    await expect(page.locator(OUTPUT)).toHaveValue(CSV_OUTPUT);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('json-convert-download').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const bytes = fs.readFileSync(await download.path());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    // 不勾选时无 BOM
    await page.getByLabel('带 BOM（Excel 打开不乱码）').uncheck();
    const [download2] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('json-convert-download').click(),
    ]);
    const bytes2 = fs.readFileSync(await download2.path());
    expect([...bytes2.slice(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
  });

  test('🖥 交换：输出放回输入、模式反转、结果仍正确', async ({ page }) => {
    await openTool(page, 'json-convert');
    await page.locator(INPUT).fill(JSON_EXAMPLE);
    await expect(page.locator(OUTPUT)).toHaveValue(YAML_EXAMPLE_OUTPUT);

    await page.getByTestId('json-convert-swap').click();
    // 输入区为之前的输出
    await expect(page.locator(INPUT)).toHaveValue(YAML_EXAMPLE_OUTPUT);
    // 模式反转
    await expect(page.getByRole('button', { name: 'YAML → JSON' })).toHaveAttribute('aria-pressed', 'true');
    // 结果仍正确：转回原始 JSON
    await expect(page.locator(OUTPUT)).toHaveValue(
      '{\n  "name": "码工具箱",\n  "tags": [\n    "json",\n    "yaml"\n  ],\n  "meta": {\n    "stars": 5,\n    "draft": false\n  }\n}\n',
    );
  });

  test('「复制结果」把输出写入剪贴板', async ({ page }) => {
    await openTool(page, 'json-convert');
    await page.locator(INPUT).fill(JSON_EXAMPLE);
    await expect(page.locator(OUTPUT)).toHaveValue(YAML_EXAMPLE_OUTPUT);

    await page.getByRole('button', { name: '复制结果' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(YAML_EXAMPLE_OUTPUT);
  });

  test('浅色 / 深色主题下都能正常转换（各打开一次）', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openTool(page, 'json-convert');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator(INPUT).fill(JSON_EXAMPLE);
    await expect(page.locator(OUTPUT)).toHaveValue(YAML_EXAMPLE_OUTPUT);

    await page.getByRole('button', { name: '切换主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator(INPUT).fill('{"k":"深色浅色都可读"}');
    await expect(page.locator(OUTPUT)).toHaveValue('k: 深色浅色都可读\n');
  });

  test('刷新后恢复上次的模式与输入（ctx.storage）', async ({ page }) => {
    await openTool(page, 'json-convert');
    await switchMode(page, 'CSV → JSON');
    await page.locator(INPUT).fill('a,b\n1,2');
    await expect(page.locator(OUTPUT)).toHaveValue(/"a": 1/);

    await page.reload();
    await expect(page.locator('[data-tool-ready="json-convert"]')).toBeAttached();
    await expect(page.getByRole('button', { name: 'CSV → JSON' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(INPUT)).toHaveValue('a,b\n1,2');
    await expect(page.locator(OUTPUT)).toHaveValue(/"a": 1/);
  });

  test('性能：1 万行 × 10 列 CSV 转 JSON 在 1 秒内完成', async ({ page }) => {
    await openTool(page, 'json-convert');
    await switchMode(page, 'CSV → JSON');
    // 在输出 textarea 的 value 赋值处打时间戳：计入防抖 + 解析 + 结果写入的完整转换路径，
    // 不把浏览器渲染超大文本的异步排版耗时（与转换无关、任何实现都无法避免）算进来。
    await page.evaluate(() => {
      const ta = document.querySelector('[data-testid="json-convert-input"]');
      const out = document.querySelector('[data-testid="json-convert-output"]');
      const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      window.__perfDone = null;
      Object.defineProperty(out, 'value', {
        set(v) {
          desc.set.call(this, v);
          window.__perfDone = performance.now();
        },
        get() {
          return desc.get.call(this);
        },
        configurable: true,
      });
      const header = Array.from({ length: 10 }, (_, i) => `col${i}`).join(',');
      const rows = [];
      for (let r = 0; r < 10000; r += 1) {
        rows.push(Array.from({ length: 10 }, (_, c) => (c === 0 ? String(r) : `v${r}-${c}`)).join(','));
      }
      ta.value = `${header}\n${rows.join('\n')}`;
      window.__perfStart = performance.now();
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => window.__perfDone !== null, null, { timeout: 10_000, polling: 100 });
    const elapsed = await page.evaluate(() => window.__perfDone - window.__perfStart);
    expect(elapsed).toBeLessThan(1000);
    await expect(page.locator(OUTPUT)).toHaveValue(/"col9": "v9999-9"/);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test.describe('移动端 375×667', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('四个模式按钮可用，无横向滚动', async ({ page }) => {
      await openTool(page, 'json-convert');
      for (const label of ['YAML → JSON', 'JSON → CSV', 'CSV → JSON', 'JSON → YAML']) {
        await switchMode(page, label);
      }
      await page.locator(INPUT).fill(JSON_EXAMPLE);
      await expect(page.locator(OUTPUT)).toHaveValue(YAML_EXAMPLE_OUTPUT);

      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(noOverflow).toBe(true);
    });
  });
});
