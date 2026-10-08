/** 简繁转换端到端测试（对应 issue #18 验收标准，🖥 条目在无头浏览器中真实操作） */

import { test, expect, openTool, SUBPATH_BASE_URL } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const INPUT = '[data-testid="zh-convert-input"]';
const OUTPUT = '[data-testid="zh-convert-output"]';
const COUNT = '[data-testid="zh-convert-count"]';
const DICT_URL = '**/tools/zh-convert/data/zh-dict.json';

test.describe('简繁转换', () => {
  test('🖥 词表异步加载：先显示「正在加载词表」，完成后可转换，输入 头发 输出 頭髮', async ({ page }) => {
    // 推迟词表请求，让加载提示可被稳定观察
    await page.route(DICT_URL, async (route) => {
      await page.waitForTimeout(700);
      await route.continue();
    });
    await openTool(page, 'zh-convert');

    await expect(page.getByTestId('zh-convert-loading')).toBeVisible();
    await expect(page.getByTestId('zh-convert-loading')).toHaveText(/正在加载词表/);

    // 加载完成后提示消失，可以转换
    await expect(page.getByTestId('zh-convert-loading')).toBeHidden();
    await page.locator(INPUT).fill('头发');
    await expect(page.locator(OUTPUT)).toHaveText('頭髮');
    await expect(page.locator(COUNT)).toHaveText('2');
  });

  test('简 → 繁：词组消歧与字数统计', async ({ page }) => {
    await openTool(page, 'zh-convert');
    // 验收清单里的词组逐个断言（词与词之间用空格隔开，互不影响）
    await page.locator(INPUT).fill('头发 发展 面条 表面 以后 皇后 干净 干部 里面 台风 钟表');
    await expect(page.locator(OUTPUT)).toHaveText('頭髮 發展 麵條 表面 以後 皇后 乾淨 幹部 裏面 颱風 鐘錶');

    // 长句：后台 → 後臺（与数据一致）
    await page.locator(INPUT).fill('我们的软件开发团队在后台处理头发问题');
    await expect(page.locator(OUTPUT)).toHaveText('我們的軟件開發團隊在後臺處理頭髮問題');

    // 非中文原样保留
    await page.locator(INPUT).fill('Hello 世界 😀 123');
    await expect(page.locator(OUTPUT)).toHaveText('Hello 世界 😀 123');
    await expect(page.locator(COUNT)).toHaveText('0');
  });

  test('🖥 台湾常用词开关：开 软件→軟體、内存→記憶體、网络→網路；关 软件→軟件', async ({ page }) => {
    await openTool(page, 'zh-convert');

    await page.locator(INPUT).fill('软件');
    await expect(page.locator(OUTPUT)).toHaveText('軟件'); // 默认关闭

    await page.getByLabel('台湾常用词').check();
    await expect(page.locator(OUTPUT)).toHaveText('軟體');

    await page.locator(INPUT).fill('内存 网络');
    await expect(page.locator(OUTPUT)).toHaveText('記憶體 網路');

    await page.getByLabel('台湾常用词').uncheck();
    await expect(page.locator(OUTPUT)).toHaveText('內存 網絡');
  });

  test('🖥 高亮变化的字：头发 → 頭、髮 各自有高亮元素；以后 只高亮 後', async ({ page }) => {
    await openTool(page, 'zh-convert');

    await page.getByLabel('高亮变化的字').check();
    await page.locator(INPUT).fill('头发');
    await expect(page.locator(OUTPUT)).toHaveText('頭髮');
    const marks = page.locator('[data-testid="zh-convert-mark"]');
    await expect(marks).toHaveCount(2);
    await expect(marks.nth(0)).toHaveText('頭');
    await expect(marks.nth(1)).toHaveText('髮');

    // 长度相同的转换逐字比较：以后 → 以後，只有 後 变化
    await page.locator(INPUT).fill('以后');
    await expect(page.locator(OUTPUT)).toHaveText('以後');
    await expect(marks).toHaveCount(1);
    await expect(marks.nth(0)).toHaveText('後');

    // 关闭高亮后不再有高亮元素，结果文本不变
    await page.getByLabel('高亮变化的字').uncheck();
    await expect(page.locator(OUTPUT)).toHaveText('以後');
    await expect(marks).toHaveCount(0);
  });

  test('🖥 繁 → 简：頭髮發展 → 头发发展；軟體 → 软体（不做台湾词反向替换）', async ({ page }) => {
    await openTool(page, 'zh-convert');
    await page.getByRole('button', { name: '繁 → 简' }).click();

    // 切到繁 → 简后「台湾常用词」不可用
    await expect(page.getByLabel('台湾常用词')).toBeDisabled();

    await page.locator(INPUT).fill('頭髮發展');
    await expect(page.locator(OUTPUT)).toHaveText('头发发展');

    await page.locator(INPUT).fill('乾淨 後臺 軟體');
    await expect(page.locator(OUTPUT)).toHaveText('干净 后台 软体');

    // 非中文原样保留
    await page.locator(INPUT).fill('Hello 世界 😀 123');
    await expect(page.locator(OUTPUT)).toHaveText('Hello 世界 😀 123');

    // 切回简 → 繁恢复正常
    await page.getByRole('button', { name: '简 → 繁' }).click();
    await page.locator(INPUT).fill('软件');
    await expect(page.locator(OUTPUT)).toHaveText('軟件');
    await expect(page.getByLabel('台湾常用词')).toBeEnabled();
  });

  test('🖥 词表请求是同源相对路径（子路径部署同样可用）', async ({ page }) => {
    const seen = [];
    page.on('request', (request) => {
      if (request.url().includes('zh-convert/data/')) seen.push(request.url());
    });
    await openTool(page, 'zh-convert');
    await page.locator(INPUT).fill('头发');
    await expect(page.locator(OUTPUT)).toHaveText('頭髮');

    expect(seen.length).toBeGreaterThan(0);
    const origin = new URL(page.url()).origin;
    for (const url of seen) {
      // 同源请求（夹具同时保证任何非本地请求都会让测试失败）
      expect(new URL(url).origin).toBe(origin);
      expect(url).toMatch(/\/tools\/zh-convert\/data\/[\w.-]+$/);
    }
  });

  test('子路径部署（--base /glm-toolbox/）下词表可用，转换正常', async ({ page }) => {
    await page.goto(`${SUBPATH_BASE_URL}#/zh-convert`);
    await expect(page.locator('[data-tool-ready="zh-convert"]')).toBeAttached();
    await expect(page.getByTestId('zh-convert-loading')).toBeHidden();
    await page.locator(INPUT).fill('头发面条');
    await expect(page.locator(OUTPUT)).toHaveText('頭髮麵條');
    await expect(page.locator(COUNT)).toHaveText('4');
  });

  test('输入变化后自动更新结果（防抖 ≤ 300ms）', async ({ page }) => {
    await openTool(page, 'zh-convert');
    await page.locator(INPUT).fill('皇后');
    await expect(page.locator(OUTPUT)).toHaveText('皇后', { timeout: 1000 });
    await page.locator(INPUT).fill('台风');
    await expect(page.locator(OUTPUT)).toHaveText('颱風', { timeout: 1000 });
  });

  test('「复制结果」读回与输出一致', async ({ page }) => {
    await openTool(page, 'zh-convert');
    await page.locator(INPUT).fill('我们的软件开发团队在后台处理头发问题');
    await expect(page.locator(OUTPUT)).toHaveText('我們的軟件開發團隊在後臺處理頭髮問題');

    await page.getByRole('button', { name: '复制结果' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      '我們的軟件開發團隊在後臺處理頭髮問題',
    );
  });

  test('刷新后恢复上次输入与选项（ctx.storage）', async ({ page }) => {
    await openTool(page, 'zh-convert');
    await page.locator(INPUT).fill('头发面条');
    await page.getByLabel('台湾常用词').check();
    await page.getByLabel('高亮变化的字').check();
    await expect(page.locator(OUTPUT)).toHaveText('頭髮麵條');

    await page.reload();
    await expect(page.locator('[data-tool-ready="zh-convert"]')).toBeAttached();
    await expect(page.locator(INPUT)).toHaveValue('头发面条');
    await expect(page.getByLabel('台湾常用词')).toBeChecked();
    await expect(page.getByLabel('高亮变化的字')).toBeChecked();
    await expect(page.locator(OUTPUT)).toHaveText('頭髮麵條');
    await expect(page.locator('[data-testid="zh-convert-mark"]')).toHaveCount(4);
  });

  test('性能：10 万字在页面中 2 秒内出结果，且页面仍可响应', async ({ page }) => {
    await openTool(page, 'zh-convert');
    await page.evaluate(() => {
      const line = '我们的软件开发团队在后台处理头发问题，网络基础设施持续完善。';
      const input = document.querySelector('[data-testid="zh-convert-input"]');
      input.value = Array.from({ length: 3400 }, () => line).join('\n'); // 约 10.5 万字
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // 每行 30 字、转换 18 字：3400 行 → 61200（防抖后一次性转换）
    await expect(page.locator(COUNT)).toHaveText('61200', { timeout: 2000 });

    // 页面仍可响应新的输入
    await page.locator(INPUT).fill('皇后');
    await expect(page.locator(OUTPUT)).toHaveText('皇后');
  });
});

test.describe('简繁转换：外壳集成与主题 / 移动端', () => {
  test('打开 #/zh-convert：标题正确、侧边栏高亮', async ({ page }) => {
    await openTool(page, 'zh-convert');
    await expect(page).toHaveTitle('简繁转换 - 码工具箱');
    await expect(page.locator('#tool-nav a[data-tool-id="zh-convert"]')).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('搜索清单关键词能找到本工具（简体 / 繁体 / 简繁 / 繁简 / chinese / jianfan / s2t / t2s）', async ({ page }) => {
    await page.goto('/');
    const search = page.getByLabel('搜索工具');
    for (const keyword of ['简体', '繁体', '简繁', '繁简', 'chinese', 'jianfan', 's2t', 't2s', '汉字']) {
      await search.fill(keyword);
      await expect(page.locator('#tool-nav a[data-tool-id="zh-convert"]')).toBeVisible();
    }
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme} 主题下打开并正常使用（含高亮）`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('glm-toolbox:theme', t), theme);
      await openTool(page, 'zh-convert');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      await page.getByLabel('高亮变化的字').check();
      await page.locator(INPUT).fill('头发');
      await expect(page.locator(OUTPUT)).toHaveText('頭髮');
      const mark = page.locator('[data-testid="zh-convert-mark"]');
      await expect(mark).toHaveCount(2);

      // 高亮在两种主题下都可见（有背景色，不是透明）
      const bg = await mark.nth(0).evaluate((node) => getComputedStyle(node).backgroundColor);
      expect(bg).not.toBe('rgba(0, 0, 0, 0)');
      expect(bg).not.toBe('transparent');
    });
  }

  test('视口 375×667 下无横向滚动，可完成基本操作', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openTool(page, 'zh-convert');
    await page.locator(INPUT).fill('头发面条台风');
    await expect(page.locator(OUTPUT)).toHaveText('頭髮麵條颱風');

    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noOverflow).toBe(true);
  });
});
