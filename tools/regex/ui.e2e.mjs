/** 正则测试端到端测试（对应 issue #15「验收标准」中的 🖥 条目与通用验收） */

import { test, expect, openTool, SUBPATH_BASE_URL } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const PATTERN = '[data-testid="regex-pattern"]';
const TEXT = '[data-testid="regex-text"]';
const REPLACEMENT = '[data-testid="regex-replacement"]';
const COUNT = '[data-testid="regex-match-count"]';
const MARK = 'mark.rx-hl';
const ERROR_BOX = '[data-error-box]';

const DATE_TEXT = '开始 2026-10-07，结束 2026-12-31。';
const DATE_RE = '(\\d{4})-(\\d{2})-(\\d{2})';

/* ==================== 外壳集成 ==================== */

test.describe('正则测试：外壳集成', () => {
  test('打开 #/regex：侧边栏高亮、标题正确', async ({ page }) => {
    await openTool(page, 'regex');
    await expect(page).toHaveTitle('正则测试 - 码工具箱');
    await expect(page.getByRole('heading', { name: '正则测试' })).toBeVisible();
    await expect(page.locator('#tool-nav a[data-tool-id="regex"]')).toHaveAttribute('aria-current', 'true');
  });

  test('搜索清单关键词能找到本工具（regex / regexp / zhengze / 正则 / 表达式 / 匹配 / 替换）', async ({ page }) => {
    for (const keyword of ['regex', 'regexp', 'zhengze', '正则', '表达式', '匹配', '替换']) {
      await page.goto('/');
      await page.getByLabel('搜索工具').fill(keyword);
      await expect(page.locator('#tool-nav').getByRole('link', { name: '正则测试' })).toBeVisible();
    }
  });

  test('子路径部署（--base /glm-toolbox/）下匹配可用（worker 正常加载）', async ({ page }) => {
    await page.goto(`${SUBPATH_BASE_URL}#/regex`);
    await expect(page.locator('[data-tool-ready="regex"]')).toBeAttached();
    await expect(page.locator('link[data-tool-style="regex"]')).toHaveCount(1);

    await page.locator(PATTERN).fill(DATE_RE);
    await page.locator(TEXT).fill(DATE_TEXT);
    await expect(page.locator(COUNT)).toHaveText('2');
  });
});

/* ==================== 匹配与高亮 ==================== */

test.describe('正则测试：匹配与高亮', () => {
  test('初始为空：匹配数为 0，高亮区显示提示', async ({ page }) => {
    await openTool(page, 'regex');
    await expect(page.locator(COUNT)).toHaveText('0');
    await expect(page.locator(MARK)).toHaveCount(0);
    await expect(page.getByTestId('regex-highlight')).toContainText('输入正则表达式');
  });

  test('日期示例：2 个匹配、2 个高亮 <mark>、位置与编号分组正确（🖥）', async ({ page }) => {
    await openTool(page, 'regex');
    await page.locator(PATTERN).fill(DATE_RE);
    await expect(page.getByTestId('regex-flag-g')).toBeChecked(); // 默认勾选全局
    await page.locator(TEXT).fill(DATE_TEXT);

    await expect(page.locator(COUNT)).toHaveText('2');
    await expect(page.locator(MARK)).toHaveCount(2);
    await expect(page.locator(MARK).nth(0)).toHaveText('2026-10-07');
    await expect(page.locator(MARK).nth(1)).toHaveText('2026-12-31');

    // 两种颜色交替
    await expect(page.locator(MARK).nth(0)).toHaveClass('rx-hl rx-a');
    await expect(page.locator(MARK).nth(1)).toHaveClass('rx-hl rx-b');

    const first = page.getByTestId('regex-match-0');
    await expect(first).toContainText('#1');
    await expect(first).toContainText('2026-10-07');
    await expect(first).toContainText('3–13');
    await expect(first).toContainText('1: 2026');
    await expect(first).toContainText('2: 10');
    await expect(first).toContainText('3: 07');

    const second = page.getByTestId('regex-match-1');
    await expect(second).toContainText('2026-12-31');
    await expect(second).toContainText('17–27');
  });

  test('命名分组：列表显示 year / month，替换 $<month>月 生效', async ({ page }) => {
    await openTool(page, 'regex');
    await page.locator(PATTERN).fill('(?<year>\\d{4})-(?<month>\\d{2})');
    await page.locator(TEXT).fill('2026-10-07');
    await expect(page.locator(COUNT)).toHaveText('1');
    await expect(page.getByTestId('regex-match-0')).toContainText('year: 2026');
    await expect(page.getByTestId('regex-match-0')).toContainText('month: 10');

    await page.locator(REPLACEMENT).fill('$<month>月');
    await expect(page.getByTestId('regex-replace-result')).toHaveText('10月-07');
  });

  test('可选分组 a(b)?c：第 1 个匹配的分组 1 显示「未匹配」', async ({ page }) => {
    await openTool(page, 'regex');
    await page.locator(PATTERN).fill('a(b)?c');
    await page.locator(TEXT).fill('ac abc');
    await expect(page.locator(COUNT)).toHaveText('2');
    await expect(page.getByTestId('regex-match-0')).toContainText('1: 未匹配');
    await expect(page.getByTestId('regex-match-1')).toContainText('1: b');
  });

  test('空匹配不死循环：a* 在 baaac 上 4 个匹配，空匹配画细竖线', async ({ page }) => {
    await openTool(page, 'regex');
    await page.locator(PATTERN).fill('a*');
    await page.locator(TEXT).fill('baaac');
    await expect(page.locator(COUNT)).toHaveText('4');
    await expect(page.locator(MARK)).toHaveCount(4);
    await expect(page.locator('mark.rx-empty')).toHaveCount(3);

    await expect(page.getByTestId('regex-match-0')).toContainText('（空匹配）');
    await expect(page.getByTestId('regex-match-0')).toContainText('0–0');
    await expect(page.getByTestId('regex-match-1')).toContainText('aaa');
    await expect(page.getByTestId('regex-match-1')).toContainText('1–4');
    await expect(page.getByTestId('regex-match-2')).toContainText('4–4');
    await expect(page.getByTestId('regex-match-3')).toContainText('5–5');
  });

  test('不带 g 标志：只显示第 1 个匹配', async ({ page }) => {
    await openTool(page, 'regex');
    await page.locator(PATTERN).fill(DATE_RE);
    await page.locator(TEXT).fill(DATE_TEXT);
    await expect(page.locator(COUNT)).toHaveText('2');

    await page.getByTestId('regex-flag-g').uncheck();
    await expect(page.locator(COUNT)).toHaveText('1');
    await expect(page.locator(MARK)).toHaveCount(1);
    await expect(page.getByTestId('regex-match-1')).toHaveCount(0);
  });

  test('粘贴 /hello/gi：正则变为 hello，标志 g、i 被勾选', async ({ page }) => {
    await openTool(page, 'regex');
    await page.locator(PATTERN).fill('/hello/gi');
    await expect(page.locator(PATTERN)).toHaveValue('hello');
    await expect(page.getByTestId('regex-flag-g')).toBeChecked();
    await expect(page.getByTestId('regex-flag-i')).toBeChecked();

    await page.locator(TEXT).fill('Hello world, hello regex');
    await expect(page.locator(COUNT)).toHaveText('2');
  });

  test('标志 i / m / s 各自生效', async ({ page }) => {
    await openTool(page, 'regex');

    // i：HELLO 匹配 hello
    await page.getByTestId('regex-flag-i').check();
    await page.locator(PATTERN).fill('HELLO');
    await page.locator(TEXT).fill('hello');
    await expect(page.locator(COUNT)).toHaveText('1');
    await page.getByTestId('regex-flag-i').uncheck();
    await expect(page.locator(COUNT)).toHaveText('0');

    // m：^b 匹配 a\nb 中的 b
    await page.getByTestId('regex-flag-m').check();
    await page.locator(PATTERN).fill('^b');
    await page.locator(TEXT).fill('a\nb');
    await expect(page.locator(COUNT)).toHaveText('1');
    await page.getByTestId('regex-flag-m').uncheck();
    await expect(page.locator(COUNT)).toHaveText('0');

    // s：a.b 匹配 a\nb
    await page.getByTestId('regex-flag-s').check();
    await page.locator(PATTERN).fill('a.b');
    await expect(page.locator(COUNT)).toHaveText('1');
    await page.getByTestId('regex-flag-s').uncheck();
    await expect(page.locator(COUNT)).toHaveText('0');
  });

  test('语法错误：中文提示附原始信息，结果区清空，修正后恢复', async ({ page }) => {
    await openTool(page, 'regex');
    await page.locator(PATTERN).fill(DATE_RE);
    await page.locator(TEXT).fill(DATE_TEXT);
    await expect(page.locator(COUNT)).toHaveText('2');

    await page.locator(PATTERN).fill('([a-z');
    await expect(page.locator(ERROR_BOX)).toContainText('正则语法错误');
    await expect(page.locator(COUNT)).toHaveText('0');
    await expect(page.locator(MARK)).toHaveCount(0);
    await expect(page.getByTestId('regex-match-list')).toBeEmpty();
    await expect(page.getByTestId('regex-replace-result')).toBeEmpty();

    await page.locator(PATTERN).fill(DATE_RE);
    await expect(page.locator(ERROR_BOX)).toHaveCount(0);
    await expect(page.locator(COUNT)).toHaveText('2');
  });

  test('替换 $3/$2/$1 与特殊符号 [$&$$]，结果实时预览且可复制', async ({ page }) => {
    await openTool(page, 'regex');
    await page.locator(PATTERN).fill(DATE_RE);
    await page.locator(TEXT).fill(DATE_TEXT);
    await page.locator(REPLACEMENT).fill('$3/$2/$1');
    await expect(page.getByTestId('regex-replace-result')).toHaveText('开始 07/10/2026，结束 31/12/2026。');

    await page.getByRole('button', { name: '复制替换结果' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe('开始 07/10/2026，结束 31/12/2026。');

    // $& 整个匹配、$$ 字面量 $
    await page.locator(PATTERN).fill('o');
    await page.locator(TEXT).fill('foo');
    await page.locator(REPLACEMENT).fill('[$&$$]');
    await expect(page.getByTestId('regex-replace-result')).toHaveText('f[o$][o$]');
  });

  test('「复制匹配列表」写入剪贴板，内容含序号、内容与位置', async ({ page }) => {
    await openTool(page, 'regex');
    await page.locator(PATTERN).fill(DATE_RE);
    await page.locator(TEXT).fill(DATE_TEXT);
    await expect(page.locator(COUNT)).toHaveText('2');

    await page.getByRole('button', { name: '复制匹配列表' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('#1 "2026-10-07" 位置 3-13');
    expect(clipboard).toContain('#2 "2026-12-31" 位置 17-27');
  });
});

/* ==================== 防卡死（worker + 超时） ==================== */

test.describe('正则测试：防卡死', () => {
  test('灾难性回溯：2 秒内提示「匹配超时」，之后改正则为 a 立即得到结果（🖥）', async ({ page }) => {
    await openTool(page, 'regex');
    await page.locator(PATTERN).fill('^(a+)+$');
    await page.locator(TEXT).fill('a'.repeat(33) + 'b');

    await expect(page.locator(ERROR_BOX)).toContainText('匹配超时', { timeout: 2000 });
    await expect(page.locator(ERROR_BOX)).toContainText('灾难性回溯');

    // 超时已终止 worker：修正正则后立即得到结果
    await page.locator(PATTERN).fill('a');
    await expect(page.locator(COUNT)).toHaveText('33', { timeout: 2000 });
    await expect(page.locator(MARK)).toHaveCount(33);

    // 页面始终可操作：勾选标志立即引发一次新的、正常的匹配
    await page.getByTestId('regex-flag-i').check();
    await expect(page.locator(COUNT)).toHaveText('33');
  });

  test('点击速查「邮箱」：正则框被填入，测试文本中的邮箱被高亮（🖥）', async ({ page }) => {
    await openTool(page, 'regex');
    await page.locator(TEXT).fill('联系 jack@example.com 或 jill@test.org');
    await page.getByRole('button', { name: '邮箱', exact: true }).click();

    await expect(page.locator(PATTERN)).toHaveValue('[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}');
    await expect(page.locator(COUNT)).toHaveText('2');
    await expect(page.locator(MARK).nth(0)).toHaveText('jack@example.com');
    await expect(page.locator(MARK).nth(1)).toHaveText('jill@test.org');
  });
});

/* ==================== 性能与渲染上限 ==================== */

test.describe('正则测试：性能', () => {
  test('10 万字符、\\w+ 全局匹配 1 秒内显示；超 1 万只高亮前 1 万并提示（🖥）', async ({ page }) => {
    await openTool(page, 'regex');
    await page.locator(PATTERN).fill('\\w+');
    await page.evaluate(() => {
      const ta = document.querySelector('[data-testid="regex-text"]');
      ta.value = 'word '.repeat(20000); // 100 000 字符
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await expect(page.locator(COUNT)).toHaveText('20000', { timeout: 1000 });
    await expect(page.locator(MARK)).toHaveCount(10000);
    await expect(page.getByTestId('regex-truncated')).toBeVisible();
    await expect(page.getByTestId('regex-truncated')).toContainText('仅高亮前 10000 个');
    await expect(page.getByTestId('regex-match-list-hint')).toContainText('仅显示前 200 条');
  });
});

/* ==================== 本地存储 ==================== */

test.describe('正则测试：本地存储', () => {
  test('刷新后恢复正则、标志、测试文本与替换串', async ({ page }) => {
    await openTool(page, 'regex');
    await page.locator(PATTERN).fill(DATE_RE);
    await page.locator(TEXT).fill(DATE_TEXT);
    await page.locator(REPLACEMENT).fill('$3/$2/$1');
    await page.getByTestId('regex-flag-g').uncheck();
    await expect(page.locator(COUNT)).toHaveText('1'); // 防抖回调已执行、状态已写入 storage

    await page.reload();
    await expect(page.locator('[data-tool-ready="regex"]')).toBeAttached();
    await expect(page.locator(PATTERN)).toHaveValue(DATE_RE);
    await expect(page.locator(TEXT)).toHaveValue(DATE_TEXT);
    await expect(page.locator(REPLACEMENT)).toHaveValue('$3/$2/$1');
    await expect(page.getByTestId('regex-flag-g')).not.toBeChecked();
    await expect(page.locator(COUNT)).toHaveText('1');

    const stored = await page.evaluate(() => localStorage.getItem('glm-toolbox:regex:pattern'));
    expect(stored).toContain('\\d{4}');
  });
});

/* ==================== 主题与移动端 ==================== */

test.describe('正则测试：主题与移动端', () => {
  test('深色与浅色主题下界面都可用、无报错', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openTool(page, 'regex');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator(PATTERN).fill(DATE_RE);
    await page.locator(TEXT).fill(DATE_TEXT);
    await expect(page.locator(COUNT)).toHaveText('2');
    await expect(page.locator(MARK).first()).toBeVisible();

    await page.getByRole('button', { name: '切换主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator(REPLACEMENT).fill('$3/$2/$1');
    await expect(page.getByTestId('regex-replace-result')).toHaveText('开始 07/10/2026，结束 31/12/2026。');
  });

  test.describe('视口 375×667', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('无横向滚动，匹配与替换都能完成', async ({ page }) => {
      await openTool(page, 'regex');
      await page.locator(PATTERN).fill(DATE_RE);
      await page.locator(TEXT).fill(DATE_TEXT);
      await expect(page.locator(COUNT)).toHaveText('2');
      await page.locator(REPLACEMENT).fill('$3/$2/$1');
      await expect(page.getByTestId('regex-replace-result')).toHaveText('开始 07/10/2026，结束 31/12/2026。');

      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(noOverflow).toBe(true);
    });
  });
});
