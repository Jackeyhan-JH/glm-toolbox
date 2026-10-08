/** 应用外壳端到端测试（对应 issue #2「外壳」验收标准） */

import { test, expect, openTool, allowExpectedErrors, SUBPATH_BASE_URL } from './fixtures.mjs';

const HOME_TITLE = '码工具箱 - 离线开发者工具';

test.describe('首页与文档标题', () => {
  test('打开 /：标题正确，首页按分类显示工具卡片', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(HOME_TITLE);
    // 分类标题
    await expect(page.getByRole('heading', { name: '文本处理' })).toBeVisible();
    // 工具卡片（首页）
    await expect(page.locator('.card', { hasText: '字数统计' })).toBeVisible();
    await expect(page.locator('.card', { hasText: '字数统计' })).toContainText('字数统计');
  });
});

test.describe('hash 路由', () => {
  test('点击侧边栏工具 → URL、标题、data-tool-ready；后退 / 前进正常', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.card', { hasText: '字数统计' })).toBeVisible();

    await page.locator('#tool-nav').getByRole('link', { name: '字数统计' }).click();
    await expect(page).toHaveURL(/#\/word-count$/);
    await expect(page).toHaveTitle('字数统计 - 码工具箱');
    await expect(page.locator('[data-tool-ready="word-count"]')).toBeAttached();
    await expect(page.getByRole('heading', { name: '字数统计' })).toBeVisible();

    // 后退回到首页
    await page.goBack();
    await expect(page).toHaveURL(/\/$|#\/$/);
    await expect(page).toHaveTitle(HOME_TITLE);
    await expect(page.locator('.card', { hasText: '字数统计' })).toBeVisible();

    // 前进又回到工具
    await page.goForward();
    await expect(page).toHaveURL(/#\/word-count$/);
    await expect(page.locator('[data-tool-ready="word-count"]')).toBeAttached();
  });

  test('访问未知 id：显示「找不到工具」与返回首页链接，无控制台错误', async ({ page }) => {
    await page.goto('/#/not-exist');
    await expect(page.getByText('找不到工具「not-exist」')).toBeVisible();
    const backHome = page.getByRole('link', { name: '返回首页' });
    await expect(backHome).toBeVisible();
    await backHome.click();
    await expect(page.locator('.card', { hasText: '字数统计' })).toBeVisible();
  });
});

test.describe('搜索', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.card', { hasText: '字数统计' })).toBeVisible();
  });

  test('按名称 / 拼音（不区分大小写）过滤，无结果有提示，回车打开，Esc 清空，/ 聚焦', async ({ page }) => {
    const search = page.getByLabel('搜索工具');
    const nav = page.locator('#tool-nav');

    // 名称子串过滤
    await search.fill('字数');
    await expect(nav.getByRole('link')).toHaveCount(1);
    await expect(nav.getByRole('link', { name: '字数统计' })).toBeVisible();

    // 大写拼音也能匹配（keywords 含 zishu）
    await search.fill('ZISHU');
    await expect(nav.getByRole('link', { name: '字数统计' })).toBeVisible();

    // 无匹配
    await search.fill('xyz不存在');
    await expect(nav.getByText('没有匹配的工具')).toBeVisible();
    await expect(nav.getByRole('link')).toHaveCount(0);

    // 回车打开第一个结果
    await search.fill('字数');
    await expect(nav.getByRole('link')).toHaveCount(1);
    await search.press('Enter');
    await expect(page).toHaveURL(/#\/word-count$/);
    await expect(page.locator('[data-tool-ready="word-count"]')).toBeAttached();

    // Esc 清空搜索并恢复完整列表
    await page.goto('/');
    await search.fill('字数');
    await expect(nav.getByRole('link')).toHaveCount(1);
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(nav.getByText('没有匹配的工具')).toBeHidden();
    await expect(nav.getByText('文本处理')).toBeVisible();

    // 在页面空白处按 / 聚焦搜索框
    await page.locator('h1').click();
    await page.keyboard.press('/');
    await expect(page.getByLabel('搜索工具')).toBeFocused();
  });
});

test.describe('主题', () => {
  test('跟随系统深色；点击切换为浅色并持久化', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.getByRole('button', { name: '切换主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // 刷新后保持，且写入约定键
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const stored = await page.evaluate(() => localStorage.getItem('glm-toolbox:theme'));
    expect(stored).toBe('light');
  });
});

test.describe('工具加载失败兜底', () => {
  test('模块抛错时显示「工具加载失败」，侧边栏与首页不受影响', async ({ page }) => {
    // 该用例会故意触发错误，豁免匹配 boom 的预期错误
    allowExpectedErrors(page, /boom/);
    await page.route('**/tools/word-count/index.mjs', (route) =>
      route.fulfill({
        contentType: 'text/javascript; charset=utf-8',
        body: "throw new Error('boom');",
      }),
    );

    await page.goto('/#/word-count');
    await expect(page.getByText('工具加载失败')).toBeVisible();
    await expect(page.locator('.state-page pre')).toContainText('boom');

    // 侧边栏仍在，可正常返回首页
    await page.locator('#sidebar .brand').click();
    await expect(page.getByText('工具加载失败')).toBeHidden();
    await expect(page.locator('.card', { hasText: '字数统计' })).toBeVisible();
  });
});

test.describe('子路径部署', () => {
  test('以 --base /glm-toolbox/ 启动服务，工具正常工作（无绝对路径假设）', async ({ page }) => {
    await page.goto(`${SUBPATH_BASE_URL}#/word-count`);
    await expect(page.locator('[data-tool-ready="word-count"]')).toBeAttached();
    await expect(page.getByRole('heading', { name: '字数统计' })).toBeVisible();

    // 私有样式也被正确挂载（相对路径解析）
    await expect(page.locator('link[data-tool-style="word-count"]')).toHaveCount(1);
  });
});

test.describe('夹具自检', () => {
  // 故意让页面请求外部地址：夹具应让本用例失败（test.fail 声明「预期失败」，
  // 若夹具失效、用例通过，Playwright 会报 unexpected pass）。
  test.fail('任何非本地请求都会导致测试失败', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      return fetch('https://example.com/').catch(() => {});
    });
  });
});

test.describe('移动端 375×667', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('侧边栏折叠为菜单按钮，点开后能选工具，无横向滚动', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.card', { hasText: '字数统计' })).toBeVisible();

    // 侧边栏收起（渲染在屏幕外），菜单按钮可见
    const menuBtn = page.getByRole('button', { name: '打开菜单' });
    await expect(menuBtn).toBeVisible();
    const box = await page.locator('#sidebar').boundingBox();
    expect(box).not.toBeNull();
    expect(box.x + box.width).toBeLessThanOrEqual(1); // 完全移出可视区

    // 点开菜单选择工具
    await menuBtn.click();
    await expect(page.locator('#sidebar')).toHaveClass(/open/);
    await page.locator('#tool-nav').getByRole('link', { name: '字数统计' }).click();
    await expect(page.locator('[data-tool-ready="word-count"]')).toBeAttached();

    // 无横向滚动
    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noOverflow).toBe(true);
  });
});
