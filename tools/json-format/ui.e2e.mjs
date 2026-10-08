/** JSON 格式化端到端测试（对应 issue #3 的验收标准，🖥 条目逐条覆盖） */

import fs from 'node:fs';
import { test, expect, openTool } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const INPUT = '[data-testid="json-format-input"]';
const OUTPUT = '[data-testid="json-format-output"]';
const GUTTER = '[data-testid="json-format-gutter"]';

const MISSING_COMMA = '{\n  "a": 1\n  "b": 2\n}';
const MISSING_COMMA_FIXED = '{\n  "a": 1,\n  "b": 2\n}';

/** 清空 localStorage 后打开工具，避免上一个用例留下的输入干扰 */
async function openToolFresh(page, id) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  return openTool(page, id);
}

test.describe('JSON 格式化', () => {
  test('打开工具：标题、侧边栏高亮', async ({ page }) => {
    await openTool(page, 'json-format');
    await expect(page).toHaveTitle('JSON 格式化 - 码工具箱');
    await expect(page.locator('.nav-item[data-tool-id="json-format"]')).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('搜索：清单 keywords 中的每个关键词都能搜到本工具', async ({ page }) => {
    const manifest = JSON.parse(fs.readFileSync(new URL('./tool.json', import.meta.url), 'utf8'));
    const navItem = page.locator('.nav-item[data-tool-id="json-format"]');
    await page.goto('/');
    for (const keyword of manifest.keywords) {
      await page.locator('#search-input').fill(keyword);
      await expect(navItem).toBeVisible();
    }
  });

  test('空输入：显示「请输入 JSON」，不显示为错误', async ({ page }) => {
    await openToolFresh(page, 'json-format');
    await expect(page.getByTestId('json-format-status')).toContainText('请输入 JSON');
    await expect(page.getByTestId('json-format-error')).toHaveCount(0);
    await expect(page.getByTestId('json-format-ok')).toHaveCount(0);
  });

  test('输入后自动格式化（防抖，无需点击）', async ({ page }) => {
    await openToolFresh(page, 'json-format');
    await page.locator(INPUT).fill('{"b":1,"a":[1,2,{"c":null}]}');
    await expect(page.locator(OUTPUT)).toHaveValue(
      '{\n  "b": 1,\n  "a": [\n    1,\n    2,\n    {\n      "c": null\n    }\n  ]\n}',
    );
    await expect(page.getByTestId('json-format-ok')).toHaveText('JSON 合法');
    // 统计：28 个字符 / 深度 3 / 3 个键（b、a、c）
    await expect(page.getByTestId('json-format-chars')).toHaveText('28');
    await expect(page.getByTestId('json-format-depth')).toHaveText('3');
    await expect(page.getByTestId('json-format-keys')).toHaveText('3');
  });

  test('🖥 缺逗号示例：显示「第 3 行第 3 列」并标记输入区第 3 行；修正后恢复', async ({ page }) => {
    await openToolFresh(page, 'json-format');
    await page.locator(INPUT).fill(MISSING_COMMA);

    await expect(page.getByTestId('json-format-error')).toContainText('第 3 行第 3 列');
    await expect(page.getByTestId('json-format-error')).toContainText('缺少逗号');
    await expect(page.getByTestId('json-format-error-context')).toBeVisible();
    const errorCell = page.locator(`${GUTTER} [data-line="3"]`);
    await expect(errorCell).toHaveAttribute('data-error', 'true');
    await expect(errorCell).toHaveClass(/is-error/);
    // 其余行未被标记
    await expect(page.locator(`${GUTTER} [data-line="1"]`)).not.toHaveAttribute('data-error', 'true');

    await page.locator(INPUT).fill(MISSING_COMMA_FIXED);
    await expect(page.getByTestId('json-format-ok')).toHaveText('JSON 合法');
    await expect(page.getByTestId('json-format-error')).toHaveCount(0);
    await expect(errorCell).not.toHaveAttribute('data-error', 'true');
  });

  test('🖥 切换缩进为 4 空格后格式化，输出第二行以 4 个空格开头', async ({ page }) => {
    await openToolFresh(page, 'json-format');
    await page.locator(INPUT).fill('{"b":1,"a":[1,2,{"c":null}]}');
    await expect(page.getByTestId('json-format-ok')).toBeVisible();

    await page.getByLabel('缩进').selectOption('4');
    await expect
      .poll(() =>
        page.evaluate(
          () => document.querySelector('[data-testid="json-format-output"]').value.split('\n')[1],
        ),
      )
      .toBe('    "b": 1,');
  });

  test('压缩与「按键名排序」选项', async ({ page }) => {
    await openToolFresh(page, 'json-format');
    await page.locator(INPUT).fill('{ "b" : 1 , "a" : 0 }');
    await page.getByRole('button', { name: '压缩', exact: true }).click();
    await expect(page.locator(OUTPUT)).toHaveValue('{"b":1,"a":0}');

    await page.getByLabel('按键名排序').check();
    await expect(page.locator(OUTPUT)).toHaveValue('{"a":0,"b":1}');
  });

  test('校验模式：合法显示「JSON 合法」，非法给出位置', async ({ page }) => {
    await openToolFresh(page, 'json-format');
    await page.locator(INPUT).fill('{"a":1,}');
    await page.getByRole('button', { name: '校验', exact: true }).click();
    await expect(page.getByTestId('json-format-error')).toContainText('第 1 行第 8 列');
    await expect(page.locator(OUTPUT)).toHaveValue('');

    await page.locator(INPUT).fill('["abc", 123]');
    await expect(page.getByTestId('json-format-ok')).toHaveText('JSON 合法');
    await expect(page.locator(OUTPUT)).toHaveValue('');
  });

  test('中文不转义、大整数保真（页面展示）', async ({ page }) => {
    await openToolFresh(page, 'json-format');
    await page.locator(INPUT).fill('{"id": 12345678901234567890, "p": 1.10}');
    await page.getByRole('button', { name: '压缩', exact: true }).click();
    await expect(page.locator(OUTPUT)).toHaveValue('{"id":12345678901234567890,"p":1.10}');

    await page.locator(INPUT).fill('{"名字":"码工具箱"}');
    await page.getByRole('button', { name: '格式化', exact: true }).click();
    await expect(page.locator(OUTPUT)).toHaveValue('{\n  "名字": "码工具箱"\n}');
  });

  test('复制结果与输出区一致', async ({ page }) => {
    await openToolFresh(page, 'json-format');
    await page.locator(INPUT).fill('{"名字":"码工具箱"}');
    await expect(page.getByTestId('json-format-ok')).toBeVisible();

    await page.getByRole('button', { name: '复制结果' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    const output = await page.evaluate(
      () => document.querySelector('[data-testid="json-format-output"]').value,
    );
    expect(clipboard).toBe(output);
    expect(clipboard).toContain('"名字": "码工具箱"');
  });

  test('🖥 下载：文件名以 .json 结尾，内容等于输出区', async ({ page }) => {
    await openToolFresh(page, 'json-format');
    await page.locator(INPUT).fill('{"a":1}');
    await expect(page.getByTestId('json-format-ok')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '下载 .json' }).click(),
    ]);
    expect(download.suggestedFilename().endsWith('.json')).toBe(true);
    const content = fs.readFileSync(await download.path(), 'utf8');
    const output = await page.evaluate(
      () => document.querySelector('[data-testid="json-format-output"]').value,
    );
    expect(content).toBe(output);
  });

  test('刷新后恢复上次输入与选项（ctx.storage）', async ({ page }) => {
    await openToolFresh(page, 'json-format');
    await page.locator(INPUT).fill('{"a":1}');
    await expect(page.getByTestId('json-format-ok')).toBeVisible();
    await page.getByLabel('缩进').selectOption('tab');

    await page.reload();
    await page.locator('[data-tool-ready="json-format"]').waitFor({ state: 'attached' });
    await expect(page.locator(INPUT)).toHaveValue('{"a":1}');
    await expect(page.getByTestId('json-format-ok')).toBeVisible();
    await expect(page.getByLabel('缩进')).toHaveValue('tab');
    // ctx.storage 的值经 JSON 序列化存储
    const stored = await page.evaluate(() => localStorage.getItem('glm-toolbox:json-format:input'));
    expect(JSON.parse(stored)).toBe('{"a":1}');
  });

  test('🖥 5MB 输入：暂停自动格式化并提示，点按钮后完成，页面不卡死', async ({ page }) => {
    test.setTimeout(120_000);
    await openToolFresh(page, 'json-format');
    await page.evaluate(() => {
      const parts = ['['];
      for (let i = 0; i < 40000; i++) {
        if (i > 0) parts.push(',');
        parts.push(
          `{"id":${i},"名称":"码工具箱测试数据第${i}条","tags":["alpha","beta","gamma"],"valid":true,"score":${i}.25,"备注":"一些额外的描述内容用来把体积撑到五兆以上"}`,
        );
      }
      parts.push(']');
      const ta = document.querySelector('[data-testid="json-format-input"]');
      ta.value = parts.join('');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const inputLength = await page.evaluate(
      () => document.querySelector('[data-testid="json-format-input"]').value.length,
    );
    expect(inputLength).toBeGreaterThan(4 * 1024 * 1024); // > 4MB（约 5MB）

    // 暂停自动执行：出现提示，且不会自动跑出结果
    await expect(page.getByTestId('json-format-pause-hint')).toBeVisible();
    await expect(page.getByTestId('json-format-ok')).toHaveCount(0);

    // 点击「格式化」手动执行，能正常完成
    await page.getByRole('button', { name: '格式化', exact: true }).click();
    await expect(page.getByTestId('json-format-ok')).toBeVisible({ timeout: 60_000 });
    const outputLength = await page.evaluate(
      () => document.querySelector('[data-testid="json-format-output"]').value.length,
    );
    expect(outputLength).toBeGreaterThan(inputLength); // 格式化后比输入更长

    // 页面仍然可交互（未卡死）：换小输入后自动恢复
    await page.locator(INPUT).fill('{}');
    await expect(page.getByTestId('json-format-pause-hint')).toBeHidden();
    await expect(page.locator(OUTPUT)).toHaveValue('{}');
  });

  test.describe('主题与响应式', () => {
    for (const theme of ['light', 'dark']) {
      test(`${theme} 主题下打开并正常使用`, async ({ page }) => {
        await page.addInitScript(
          (t) => localStorage.setItem('glm-toolbox:theme', t),
          theme,
        );
        await openTool(page, 'json-format');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

        await page.locator(INPUT).fill('{"a":1,}');
        await expect(page.getByTestId('json-format-error')).toContainText('第 1 行第 8 列');
        await page.locator(INPUT).fill('{"a":1}');
        await expect(page.getByTestId('json-format-ok')).toBeVisible();
      });
    }

    test('375×667 视口下无横向滚动', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await openToolFresh(page, 'json-format');
      await page.locator(INPUT).fill('{"a":"' + '很长的一段内容'.repeat(20) + '"}');
      await expect(page.getByTestId('json-format-ok')).toBeVisible();

      const overflowed = await page.evaluate(() => {
        const doc = document.documentElement;
        const body = document.body;
        return (
          doc.scrollWidth - doc.clientWidth > 0 ||
          body.scrollWidth - body.clientWidth > 0
        );
      });
      expect(overflowed).toBe(false);
    });
  });
});
