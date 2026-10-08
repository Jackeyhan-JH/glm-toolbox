/** URL 编解码端到端测试（对应 issue #8「URL 编解码与参数解析」验收标准） */

import { test, expect, openTool } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const SAMPLE_URL = 'https://user:pw@example.com:8080/a/b%20c?q=%E7%A0%81&tag=1&tag=2&empty=#sec';
const REBUILT_URL = 'https://user:pw@example.com:8080/a/b%20c?q=%E7%A0%81&tag=1&empty=&lang=%E4%B8%AD%E6%96%87#sec';
const DECODED_URL = 'https://user:pw@example.com:8080/a/b c?q=码&tag=1&tag=2&empty=#sec';

/** 打开工具并切换到「URL 解析」页签，返回 URL 输入框 */
async function openParseTab(page) {
  await openTool(page, 'url-codec');
  await page.getByRole('button', { name: 'URL 解析' }).click();
  return page.getByLabel('URL 或查询字符串');
}

test.describe('编解码', () => {
  test('组件编码：码 a&b=c/d，勾选「空格编码为 +」后 %20 变 +', async ({ page }) => {
    await openTool(page, 'url-codec');
    await page.getByLabel('要编码的文本').fill('码 a&b=c/d');
    await expect(page.getByTestId('url-codec-encode-output')).toHaveText('%E7%A0%81%20a%26b%3Dc%2Fd');

    await page.getByLabel('空格编码为 +（表单格式）').check();
    await expect(page.getByTestId('url-codec-encode-output')).toHaveText('%E7%A0%81+a%26b%3Dc%2Fd');
  });

  test('完整 URL 模式：保留 URL 结构字符', async ({ page }) => {
    await openTool(page, 'url-codec');
    await page.getByRole('button', { name: '完整 URL（encodeURI）' }).click();
    await page.getByLabel('要编码的文本').fill('https://example.com/码 a?x=1&y=中');
    await expect(page.getByTestId('url-codec-encode-output')).toHaveText(
      'https://example.com/%E7%A0%81%20a?x=1&y=%E4%B8%AD',
    );
  });

  test('「复制编码结果」写入剪贴板', async ({ page }) => {
    await openTool(page, 'url-codec');
    await page.getByLabel('要编码的文本').fill('码 a&b=c/d');
    await expect(page.getByTestId('url-codec-encode-output')).toHaveText('%E7%A0%81%20a%26b%3Dc%2Fd');

    await page.getByRole('button', { name: '复制编码结果' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe('%E7%A0%81%20a%26b%3Dc%2Fd');
  });

  test('解码：%E7%A0%81%E5%B7%A5 → 码工；「将 + 解码为空格」开关生效', async ({ page }) => {
    await openTool(page, 'url-codec');
    await page.getByLabel('要解码的文本').fill('%E7%A0%81%E5%B7%A5');
    await expect(page.getByTestId('url-codec-decode-output')).toHaveText('码工');

    await page.getByLabel('要解码的文本').fill('a+b');
    await expect(page.getByTestId('url-codec-decode-output')).toHaveText('a+b'); // 默认 + 原样保留
    await page.getByLabel('将 + 解码为空格').check();
    await expect(page.getByTestId('url-codec-decode-output')).toHaveText('a b');

    await page.getByRole('button', { name: '复制解码结果' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe('a b');
  });

  test('解码失败给中文原因与位置，页面无报错', async ({ page }) => {
    await openTool(page, 'url-codec');
    await page.getByLabel('要解码的文本').fill('%E4%B8');
    await expect(page.getByRole('alert')).toHaveText('不完整的百分号编码 / 非法 UTF-8 序列（第 1 个字符起）');

    await page.getByLabel('要解码的文本').fill('100%');
    await expect(page.getByRole('alert')).toHaveText('% 后缺少两位十六进制数字（第 4 个字符起）');

    // 改回合法输入后提示消失
    await page.getByLabel('要解码的文本').fill('%E7%A0%81');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('url-codec-decode-output')).toHaveText('码');
  });

  test('大输入不卡死：5 万字符在 2 秒内出结果', async ({ page }) => {
    await openTool(page, 'url-codec');
    await page.evaluate(() => {
      const ta = document.querySelector('[data-testid="url-codec-encode-input"]');
      ta.value = '码 a&b=c/d'.repeat(5000);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.getByTestId('url-codec-encode-output')).toHaveText(/%E7%A0%81%20a%26b%3Dc%2Fd/, {
      timeout: 2000,
    });
  });
});

test.describe('URL 解析', () => {
  test('完整 URL：部件表格逐项正确，参数 4 行（重复键保留、空值保留）', async ({ page }) => {
    const urlInput = await openParseTab(page);
    await urlInput.fill(SAMPLE_URL);

    await expect(page.getByTestId('url-codec-part-protocol')).toHaveText('https:');
    await expect(page.getByTestId('url-codec-part-username')).toHaveText('user');
    await expect(page.getByTestId('url-codec-part-password')).toHaveText('pw');
    await expect(page.getByTestId('url-codec-part-hostname')).toHaveText('example.com');
    await expect(page.getByTestId('url-codec-part-port')).toHaveText('8080');
    await expect(page.getByTestId('url-codec-part-pathname')).toHaveText('/a/b%20c');
    await expect(page.getByTestId('url-codec-part-pathnameDecoded')).toHaveText('/a/b c');
    await expect(page.getByTestId('url-codec-part-search')).toHaveText('?q=%E7%A0%81&tag=1&tag=2&empty=');
    await expect(page.getByTestId('url-codec-part-hash')).toHaveText('#sec');

    const rows = page.locator('[data-testid="url-codec-param-row"]');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0).getByLabel('参数键')).toHaveValue('q');
    await expect(rows.nth(0).getByLabel('参数值')).toHaveValue('码');
    await expect(rows.nth(1).getByLabel('参数值')).toHaveValue('1');
    await expect(rows.nth(2).getByLabel('参数键')).toHaveValue('tag');
    await expect(rows.nth(2).getByLabel('参数值')).toHaveValue('2');
    await expect(rows.nth(3).getByLabel('参数键')).toHaveValue('empty');
    await expect(rows.nth(3).getByLabel('参数值')).toHaveValue('');

    // 原样不动时重建结果与输入一致
    await expect(page.getByTestId('url-codec-rebuilt')).toHaveText(SAMPLE_URL);
  });

  test('粘贴非法 URL：表格区显示中文提示，恢复合法输入后消失', async ({ page }) => {
    const urlInput = await openParseTab(page);
    await urlInput.fill('https://[::1');
    await expect(page.getByRole('alert')).toContainText('无法解析此 URL');

    await urlInput.fill('example.com/abc');
    await expect(page.getByRole('alert')).toHaveText('不是完整 URL（缺少协议，如 https://）');

    await urlInput.fill(SAMPLE_URL);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('url-codec-part-hostname')).toHaveText('example.com');
  });

  test('只粘贴查询字符串：?a=1&b=%20x → 参数 a=1、b=空格x', async ({ page }) => {
    const urlInput = await openParseTab(page);
    await urlInput.fill('?a=1&b=%20x');
    const rows = page.locator('[data-testid="url-codec-param-row"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).getByLabel('参数键')).toHaveValue('a');
    await expect(rows.nth(0).getByLabel('参数值')).toHaveValue('1');
    await expect(rows.nth(1).getByLabel('参数值')).toHaveValue(' x');
    await expect(page.getByTestId('url-codec-rebuilt')).toHaveText('a=1&b=%20x');
  });

  test('🖥 参数表编辑：删除 tag=2、新增 lang=中文 → 上方 URL 实时重建', async ({ page }) => {
    const urlInput = await openParseTab(page);
    await urlInput.fill(SAMPLE_URL);
    const rows = page.locator('[data-testid="url-codec-param-row"]');
    await expect(rows).toHaveCount(4);

    // 删除 tag=2（第 3 行）
    await rows.nth(2).getByRole('button', { name: '删除' }).click();
    await expect(rows).toHaveCount(3);

    // 新增一行并填入 lang / 中文
    await page.getByRole('button', { name: '新增参数' }).click();
    await expect(rows).toHaveCount(4);
    const newRow = rows.nth(3);
    await newRow.getByLabel('参数键').fill('lang');
    await newRow.getByLabel('参数值').fill('中文');

    await expect(page.getByTestId('url-codec-rebuilt')).toHaveText(REBUILT_URL);
  });

  test('上移 / 下移调整参数顺序并实时重建', async ({ page }) => {
    const urlInput = await openParseTab(page);
    await urlInput.fill('?a=1&b=2&c=3');
    const rows = page.locator('[data-testid="url-codec-param-row"]');
    await expect(rows).toHaveCount(3);

    await rows.nth(2).getByRole('button', { name: '上移' }).click(); // a c b
    await expect(page.getByTestId('url-codec-rebuilt')).toHaveText('a=1&c=3&b=2');
    await rows.nth(1).getByRole('button', { name: '上移' }).click(); // c a b
    await expect(page.getByTestId('url-codec-rebuilt')).toHaveText('c=3&a=1&b=2');
    await rows.nth(0).getByRole('button', { name: '下移' }).click(); // a c b
    await expect(page.getByTestId('url-codec-rebuilt')).toHaveText('a=1&c=3&b=2');
  });

  test('「复制重建 URL」与「全部解码显示」', async ({ page }) => {
    const urlInput = await openParseTab(page);
    await urlInput.fill(SAMPLE_URL);
    await expect(page.getByTestId('url-codec-rebuilt')).toHaveText(SAMPLE_URL);

    await page.getByRole('button', { name: '复制重建 URL' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(SAMPLE_URL);

    await page.getByLabel('全部解码显示').check();
    await expect(page.getByTestId('url-codec-decoded-url')).toBeVisible();
    await expect(page.getByTestId('url-codec-decoded-url')).toHaveText(DECODED_URL);

    await page.getByRole('button', { name: '复制解码后 URL' }).click();
    const decodedClipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(decodedClipboard).toBe(DECODED_URL);
  });

  test('刷新后恢复上次的页签与 URL 输入（ctx.storage）', async ({ page }) => {
    const urlInput = await openParseTab(page);
    await urlInput.fill('?a=1&b=2');
    await expect(page.getByTestId('url-codec-rebuilt')).toHaveText('a=1&b=2');

    await page.reload();
    await page.locator('[data-tool-ready="url-codec"]').waitFor({ state: 'attached' });
    await expect(page.getByTestId('url-codec-panel-parse')).toBeVisible();
    await expect(page.getByLabel('URL 或查询字符串')).toHaveValue('?a=1&b=2');
    await expect(page.getByTestId('url-codec-rebuilt')).toHaveText('a=1&b=2');

    const stored = await page.evaluate(() => localStorage.getItem('glm-toolbox:url-codec:url-input'));
    expect(stored).toContain('a=1');
  });
});

test.describe('外壳集成', () => {
  test('打开 #/url-codec：标题正确、侧边栏高亮本工具', async ({ page }) => {
    await openTool(page, 'url-codec');
    await expect(page).toHaveTitle('URL 编解码 - 码工具箱');
    await expect(page.getByRole('heading', { name: 'URL 编解码' })).toBeVisible();
    await expect(page.locator('#tool-nav a[data-tool-id="url-codec"]')).toHaveAttribute('aria-current', 'true');
  });

  test('搜索清单 keywords 中的关键词都能搜到本工具', async ({ page }) => {
    await page.goto('/');
    const search = page.getByLabel('搜索工具');
    for (const keyword of ['urlencode', 'bianma', '参数']) {
      await search.fill(keyword);
      await expect(page.locator('#tool-nav').getByRole('link', { name: 'URL 编解码' })).toBeVisible();
    }
  });
});

test.describe('主题', () => {
  for (const scheme of ['light', 'dark']) {
    test(`${scheme === 'dark' ? '深色' : '浅色'}主题下两个页签均可读、无报错`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openTool(page, 'url-codec');
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await expect(page.getByRole('heading', { name: 'URL 编解码' })).toBeVisible();

      await page.getByRole('button', { name: 'URL 解析' }).click();
      await page.getByLabel('URL 或查询字符串').fill(SAMPLE_URL);
      await expect(page.getByTestId('url-codec-part-hostname')).toHaveText('example.com');
    });
  }
});

test.describe('移动端 375×667', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('无横向滚动，两个页签均可操作', async ({ page }) => {
    await openTool(page, 'url-codec');
    await page.getByRole('button', { name: 'URL 解析' }).click();
    await page.getByLabel('URL 或查询字符串').fill(SAMPLE_URL);
    await expect(page.getByTestId('url-codec-part-hostname')).toHaveText('example.com');

    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noOverflow).toBe(true);
  });
});
