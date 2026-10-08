/** 文本对比端到端测试（对应 issue #16 验收标准，🖥 条目在无头浏览器中真实操作） */

import { test, expect, openTool } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const OLD_INPUT = '[data-testid="text-diff-old"]';
const NEW_INPUT = '[data-testid="text-diff-new"]';
const STATS = '[data-testid="text-diff-stats"]';
const UNIFIED = '[data-testid="text-diff-unified"]';

test.describe('文本对比', () => {
  test('初始为空：两边都为空 → 两段文本完全相同，unified diff 为空', async ({ page }) => {
    await openTool(page, 'text-diff');
    await expect(page.getByTestId('text-diff-same')).toBeVisible();
    await expect(page.getByTestId('text-diff-same')).toContainText('两段文本完全相同');
    await expect(page.locator(STATS)).toHaveText('新增 0 行，删除 0 行');
    await expect(page.locator(UNIFIED)).toHaveText('');
    await expect(page.locator(OLD_INPUT)).toHaveValue('');
    await expect(page.locator(NEW_INPUT)).toHaveValue('');
  });

  test('按行基本示例：统计、unified diff、并排行与字符级高亮', async ({ page }) => {
    await openTool(page, 'text-diff');
    await page.locator(OLD_INPUT).fill('a\nb\nc');
    await page.locator(NEW_INPUT).fill('a\nB\nc\nd');

    // 统计「新增 2 行，删除 1 行」
    await expect(page.locator(STATS)).toHaveText('新增 2 行，删除 1 行');

    // unified diff 逐字一致
    await expect(page.locator(UNIFIED)).toHaveText(
      ['--- 原文', '+++ 新文', '@@ -1,3 +1,4 @@', ' a', '-b', '+B', ' c', '+d'].join('\n'),
    );

    // 并排视图：修改行 b → B 有字符级高亮，新增行 d 有新增样式
    const side = page.getByTestId('text-diff-side');
    await expect(side).toBeVisible();
    await expect(side.locator('[data-testid="text-diff-row"]')).toHaveCount(4);

    const modRow = side.locator('.diff-row.row-mod');
    await expect(modRow).toHaveCount(1);
    await expect(modRow.locator('[data-testid="text-diff-inline-del"]')).toHaveText('b');
    await expect(modRow.locator('[data-testid="text-diff-inline-add"]')).toHaveText('B');
    await expect(modRow.locator('.diff-cell.is-del')).toBeVisible();
    await expect(modRow.locator('.diff-cell.is-add')).toBeVisible();

    const addRow = side.locator('.diff-row.row-add');
    await expect(addRow).toHaveCount(1);
    await expect(addRow.locator('.diff-cell.is-add')).toHaveText('d');
    await expect(addRow.locator('.diff-cell.is-empty')).toBeVisible();
  });

  test('🖥 并排视图：删除行有删除样式；切换合并视图后显示 +/- 前缀', async ({ page }) => {
    await openTool(page, 'text-diff');
    await page.locator(OLD_INPUT).fill('a\nb\nc');
    await page.locator(NEW_INPUT).fill('a\nc');

    const side = page.getByTestId('text-diff-side');
    const delRow = side.locator('.diff-row.row-del');
    await expect(delRow).toHaveCount(1);
    await expect(delRow.locator('.diff-cell.is-del')).toHaveText('b');
    await expect(delRow.locator('.diff-cell.is-empty')).toBeVisible();

    // 切换到合并视图
    await page.getByRole('button', { name: '合并' }).click();
    const merged = page.getByTestId('text-diff-merged');
    await expect(merged).toBeVisible();

    const delU = merged.locator('[data-testid="text-diff-urow-del"]');
    await expect(delU).toHaveCount(1);
    await expect(delU.locator('.diff-prefix')).toHaveText('-');
    await expect(delU).toContainText('b');

    // 有新增行时同样显示 + 前缀
    await page.locator(NEW_INPUT).fill('a\nc\nd');
    await expect(merged.locator('[data-testid="text-diff-urow-add"]')).toHaveCount(1);
    await expect(merged.locator('[data-testid="text-diff-urow-add"] .diff-prefix')).toHaveText('+');
    await expect(merged.locator('[data-testid="text-diff-urow-del"]')).toHaveCount(1);
  });

  test('🖥 点击「交换」→ 两边内容互换，新增 / 删除数字互换', async ({ page }) => {
    await openTool(page, 'text-diff');
    await page.locator(OLD_INPUT).fill('a\nb\nc');
    await page.locator(NEW_INPUT).fill('a\nB\nc\nd');
    await expect(page.locator(STATS)).toHaveText('新增 2 行，删除 1 行');

    await page.getByTestId('text-diff-swap').click();
    await expect(page.locator(OLD_INPUT)).toHaveValue('a\nB\nc\nd');
    await expect(page.locator(NEW_INPUT)).toHaveValue('a\nb\nc');
    await expect(page.locator(STATS)).toHaveText('新增 1 行，删除 2 行');
  });

  test('忽略大小写：只剩新增 d', async ({ page }) => {
    await openTool(page, 'text-diff');
    await page.locator(OLD_INPUT).fill('a\nb\nc');
    await page.locator(NEW_INPUT).fill('a\nB\nc\nd');
    await expect(page.locator(STATS)).toHaveText('新增 2 行，删除 1 行');

    await page.getByLabel('忽略大小写').check();
    await expect(page.locator(STATS)).toHaveText('新增 1 行，删除 0 行');
    await expect(page.getByTestId('text-diff-same')).toBeHidden();
  });

  test('忽略空白与空行选项', async ({ page }) => {
    await openTool(page, 'text-diff');

    // 忽略所有空白差异：a␣␣b 与 a␣b 相同
    await page.locator(OLD_INPUT).fill('a  b');
    await page.locator(NEW_INPUT).fill('a b');
    await expect(page.locator(STATS)).toHaveText('新增 1 行，删除 1 行');
    await page.getByLabel('忽略所有空白差异').check();
    await expect(page.getByTestId('text-diff-same')).toBeVisible();
    await page.getByLabel('忽略所有空白差异').uncheck();

    // 忽略首尾空白：x 与 x␣␣ 相同
    await page.locator(OLD_INPUT).fill('x');
    await page.locator(NEW_INPUT).fill('x  ');
    await expect(page.getByTestId('text-diff-same')).toBeHidden();
    await page.getByLabel('忽略首尾空白').check();
    await expect(page.getByTestId('text-diff-same')).toBeVisible();
    await page.getByLabel('忽略首尾空白').uncheck();

    // 忽略空行：a/空/b 与 a/b 相同
    await page.locator(OLD_INPUT).fill('a\n\nb');
    await page.locator(NEW_INPUT).fill('a\nb');
    await expect(page.locator(STATS)).toHaveText('新增 0 行，删除 1 行');
    await page.getByLabel('忽略空行').check();
    await expect(page.getByTestId('text-diff-same')).toBeVisible();
  });

  test('按字符：码工具箱 vs 码具箱子 → 删除「工」、新增「子」', async ({ page }) => {
    await openTool(page, 'text-diff');
    await page.locator(OLD_INPUT).fill('码工具箱');
    await page.locator(NEW_INPUT).fill('码具箱子');
    await expect(page.locator(STATS)).toHaveText('新增 1 行，删除 1 行');

    await page.getByRole('button', { name: '按字符' }).click();
    await expect(page.locator(STATS)).toHaveText('新增 1 个，删除 1 个');
    // 并排视图：删除 / 新增 token 高亮
    await expect(page.getByTestId('text-diff-side').locator('[data-testid="text-diff-token-del"]')).toHaveText('工');
    await expect(page.getByTestId('text-diff-side').locator('[data-testid="text-diff-token-add"]')).toHaveText('子');

    // 合并视图：带 - / + 前缀
    await page.getByRole('button', { name: '合并' }).click();
    await expect(page.getByTestId('text-diff-merged').locator('[data-testid="text-diff-token-del"]')).toHaveText('-工');
    await expect(page.getByTestId('text-diff-merged').locator('[data-testid="text-diff-token-add"]')).toHaveText('+子');
  });

  test('按词：the quick brown fox vs the slow brown dog', async ({ page }) => {
    await openTool(page, 'text-diff');
    await page.locator(OLD_INPUT).fill('the quick brown fox');
    await page.locator(NEW_INPUT).fill('the slow brown dog');
    await page.getByRole('button', { name: '按词' }).click();
    await expect(page.locator(STATS)).toHaveText('新增 2 个，删除 2 个');
    await expect(
      page.getByTestId('text-diff-side').locator('[data-testid="text-diff-token-del"]'),
    ).toHaveCount(2);
    await expect(
      page.getByTestId('text-diff-side').locator('[data-testid="text-diff-token-add"]'),
    ).toHaveCount(2);
  });

  test('原文为空、新文 a/b → 全部新增，hunk 头 @@ -0,0 +1,2 @@', async ({ page }) => {
    await openTool(page, 'text-diff');
    await page.locator(NEW_INPUT).fill('a\nb');
    await expect(page.locator(STATS)).toHaveText('新增 2 行，删除 0 行');
    const text = await page.locator(UNIFIED).textContent();
    expect(text).toContain('@@ -0,0 +1,2 @@');
    expect(text).toContain('+a');
    expect(text).toContain('+b');
  });

  test('上下文：相距 10 行以上 → 2 个 hunk；相距 6 行 → 1 个 hunk', async ({ page }) => {
    await openTool(page, 'text-diff');
    const make = (changes) =>
      Array.from(
        { length: 20 },
        (_, i) => changes.get(i + 1) ?? `第${i + 1}行`,
      ).join('\n');

    await page.locator(OLD_INPUT).fill(make(new Map()));
    // 第 2 行与第 15 行两处修改（中间 12 行未变）→ 2 个 hunk
    await page.locator(NEW_INPUT).fill(make(new Map([[2, '第二行改'], [15, '第十五行改']])));
    await expect(page.locator(STATS)).toHaveText('新增 2 行，删除 2 行');
    let text = await page.locator(UNIFIED).textContent();
    expect((text.match(/^@@/gm) || []).length).toBe(2);

    // 相距 6 行（中间第 3~8 行未变）→ 1 个 hunk
    await page.locator(NEW_INPUT).fill(make(new Map([[2, '第二行改'], [9, '第九行改']])));
    // 用内容变化的信号等待防抖刷新完成（两种情形统计数字相同）
    await expect(page.locator(UNIFIED)).toContainText('第九行改');
    text = await page.locator(UNIFIED).textContent();
    expect((text.match(/^@@/gm) || []).length).toBe(1);
  });

  test('「复制 unified diff」读回与结果一致', async ({ page }) => {
    await openTool(page, 'text-diff');
    await page.locator(OLD_INPUT).fill('a\nb\nc');
    await page.locator(NEW_INPUT).fill('a\nB\nc\nd');
    const expected = await page.locator(UNIFIED).textContent();

    await page.getByRole('button', { name: '复制 unified diff' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  });

  test('「下载 .diff 文件」触发下载，文件名为 text-diff.diff', async ({ page }) => {
    await openTool(page, 'text-diff');
    await page.locator(OLD_INPUT).fill('a\nb\nc');
    await page.locator(NEW_INPUT).fill('a\nB\nc\nd');

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('text-diff-download').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('text-diff.diff');
  });

  test('刷新后恢复上次输入与选项（ctx.storage）', async ({ page }) => {
    await openTool(page, 'text-diff');
    await page.locator(OLD_INPUT).fill('a\nb\nc');
    await page.locator(NEW_INPUT).fill('a\nB\nc\nd');
    await page.getByLabel('忽略大小写').check();
    await page.getByRole('button', { name: '按词' }).click();
    await expect(page.locator(STATS)).toHaveText('新增 2 个，删除 0 个');

    await page.reload();
    await expect(page.locator('[data-tool-ready="text-diff"]')).toBeAttached();
    await expect(page.locator(OLD_INPUT)).toHaveValue('a\nb\nc');
    await expect(page.locator(NEW_INPUT)).toHaveValue('a\nB\nc\nd');
    await expect(page.getByLabel('忽略大小写')).toBeChecked();
    await expect(page.locator(STATS)).toHaveText('新增 2 个，删除 0 个');
  });

  test('性能：两段各 5000 行、约 5% 不同，2 秒内出结果且页面不卡死', async ({ page }) => {
    await openTool(page, 'text-diff');
    await page.evaluate(() => {
      const oldLines = Array.from({ length: 5000 }, (_, i) => `第${i + 1}行`);
      const newLines = oldLines.map((line, i) => (i % 20 === 0 ? `${line}（改）` : line));
      const old = document.querySelector('[data-testid="text-diff-old"]');
      const cur = document.querySelector('[data-testid="text-diff-new"]');
      old.value = oldLines.join('\n');
      cur.value = newLines.join('\n');
      old.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator(STATS)).toHaveText('新增 250 行，删除 250 行', { timeout: 2000 });

    // 差异较大时中间有省略占位，DOM 不随行数线性膨胀
    await expect(page.getByTestId('text-diff-collapsed').first()).toBeVisible();

    // 页面仍可响应新的输入
    await page.locator(OLD_INPUT).fill('a');
    await page.locator(NEW_INPUT).fill('b');
    await expect(page.locator(STATS)).toHaveText('新增 1 行，删除 1 行');
  });
});

test.describe('文本对比：外壳集成与主题 / 移动端', () => {
  test('打开 #/text-diff：标题正确、侧边栏高亮', async ({ page }) => {
    await openTool(page, 'text-diff');
    await expect(page).toHaveTitle('文本对比 - 码工具箱');
    await expect(page.locator('#tool-nav a[data-tool-id="text-diff"]')).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('搜索清单关键词能找到本工具（diff / 对比 / 比较 / 差异 / compare / duibi / 文本 / text / unified）', async ({ page }) => {
    await page.goto('/');
    const search = page.getByLabel('搜索工具');
    for (const keyword of [
      'diff',
      '对比',
      '比较',
      '差异',
      'compare',
      'duibi',
      '文本',
      'text',
      'unified',
    ]) {
      await search.fill(keyword);
      await expect(page.locator('#tool-nav a[data-tool-id="text-diff"]')).toBeVisible();
    }
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme} 主题下打开并正常使用`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('glm-toolbox:theme', t), theme);
      await openTool(page, 'text-diff');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.locator(OLD_INPUT).fill('a\nb\nc');
      await page.locator(NEW_INPUT).fill('a\nB\nc\nd');
      await expect(page.locator(STATS)).toHaveText('新增 2 行，删除 1 行');
      await expect(page.getByTestId('text-diff-side').locator('[data-testid="text-diff-inline-add"]')).toHaveText('B');

      // 合并视图在深色下也可读（无报错由夹具保证）
      await page.getByRole('button', { name: '合并' }).click();
      await expect(page.getByTestId('text-diff-merged')).toBeVisible();
    });
  }

  test('视口 375×667 下无横向滚动，可完成基本操作', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openTool(page, 'text-diff');
    await page.locator(OLD_INPUT).fill('a\nb\nc');
    await page.locator(NEW_INPUT).fill('a\nB\nc\nd');
    await expect(page.locator(STATS)).toHaveText('新增 2 行，删除 1 行');

    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noOverflow).toBe(true);
  });
});
