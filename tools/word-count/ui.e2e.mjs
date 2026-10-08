/** 字数统计端到端测试（对应 issue #2「字数统计」验收标准） */

import { test, expect, openTool } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const INPUT = '[data-testid="word-count-input"]';

test.describe('字数统计', () => {
  test('初始为空：所有数字为 0', async ({ page }) => {
    await openTool(page, 'word-count');
    for (const key of [
      'charsWithSpace',
      'charsNoSpace',
      'hanzi',
      'words',
      'lines',
      'paragraphs',
      'bytes',
    ]) {
      await expect(page.getByTestId(`word-count-${key}`)).toHaveText('0');
    }
    await expect(page.locator(INPUT)).toHaveValue('');
  });

  test('实时统计综合示例', async ({ page }) => {
    await openTool(page, 'word-count');
    await page.locator(INPUT).fill('Hello 世界！\n\n第二段 abc');
    await expect(page.getByTestId('word-count-charsWithSpace')).toHaveText('16');
    await expect(page.getByTestId('word-count-charsNoSpace')).toHaveText('14');
    await expect(page.getByTestId('word-count-hanzi')).toHaveText('5');
    await expect(page.getByTestId('word-count-words')).toHaveText('2');
    await expect(page.getByTestId('word-count-lines')).toHaveText('3');
    await expect(page.getByTestId('word-count-paragraphs')).toHaveText('2');
    await expect(page.getByTestId('word-count-bytes')).toHaveText('30');
  });

  test('字形簇：家庭 emoji 与单 emoji', async ({ page }) => {
    await openTool(page, 'word-count');
    await page.locator(INPUT).fill('👨‍👩‍👧');
    await expect(page.getByTestId('word-count-charsWithSpace')).toHaveText('1');
    await expect(page.getByTestId('word-count-bytes')).toHaveText('18');

    await page.locator(INPUT).fill('😀');
    await expect(page.getByTestId('word-count-charsWithSpace')).toHaveText('1');
    await expect(page.getByTestId('word-count-bytes')).toHaveText('4');
  });

  test('英文单词：don\'t stop-me now → 3', async ({ page }) => {
    await openTool(page, 'word-count');
    await page.locator(INPUT).fill("don't stop-me now");
    await expect(page.getByTestId('word-count-words')).toHaveText('3');
  });

  test('20 万字在 1 秒内出结果，页面不卡死', async ({ page }) => {
    await openTool(page, 'word-count');
    await page.evaluate(() => {
      const ta = document.querySelector('[data-testid="word-count-input"]');
      ta.value = '码'.repeat(200000);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.getByTestId('word-count-hanzi')).toHaveText('200000', { timeout: 1000 });
    await expect(page.getByTestId('word-count-bytes')).toHaveText('600000', { timeout: 1000 });
  });

  test('刷新后恢复上次输入（ctx.storage）', async ({ page }) => {
    await openTool(page, 'word-count');
    await page.locator(INPUT).fill('Hello 世界！\n\n第二段 abc');
    // 等统计渲染出来，意味着防抖回调已执行、内容已写入 storage
    await expect(page.getByTestId('word-count-hanzi')).toHaveText('5');

    await page.reload();
    await expect(page.locator('[data-tool-ready="word-count"]')).toBeAttached();
    await expect(page.locator(INPUT)).toHaveValue('Hello 世界！\n\n第二段 abc');
    await expect(page.getByTestId('word-count-hanzi')).toHaveText('5');

    const stored = await page.evaluate(() => localStorage.getItem('glm-toolbox:word-count:text'));
    expect(stored).toContain('第二段 abc');
  });

  test('「复制统计结果」复制的内容包含「汉字数：5」', async ({ page }) => {
    await openTool(page, 'word-count');
    await page.locator(INPUT).fill('Hello 世界！\n\n第二段 abc');
    await expect(page.getByTestId('word-count-hanzi')).toHaveText('5');

    await page.getByRole('button', { name: '复制统计结果' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('汉字数：5');
    expect(clipboard).toContain('字符数（含空格）：16');
  });
});
