/** SQL 格式化端到端测试（对应 issue #6 验收标准，🖥 条目均在此真实操作并断言） */

import { test, expect, openTool } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

/** 验收例 1 的输入与期望输出（默认：关键字大写、2 空格缩进） */
const EX1_INPUT =
  "select id,name from users u left join orders o on o.user_id=u.id where u.age>18 and o.status='已支付' order by o.created_at desc limit 10";
const EX1_FORMATTED = `SELECT
  id,
  name
FROM
  users u
  LEFT JOIN orders o ON o.user_id = u.id
WHERE
  u.age > 18
  AND o.status = '已支付'
ORDER BY
  o.created_at DESC
LIMIT
  10`;

test.describe('SQL 格式化', () => {
  test('格式化验收例 1：输入后自动更新（无执行按钮）', async ({ page }) => {
    await openTool(page, 'sql-format');
    await page.getByLabel('SQL 输入').fill(EX1_INPUT);
    await expect(page.getByLabel('结果')).toHaveValue(EX1_FORMATTED);
  });

  test('填入示例与清空按钮', async ({ page }) => {
    await openTool(page, 'sql-format');
    await page.getByRole('button', { name: '填入示例' }).click();
    await expect(page.getByLabel('结果')).toHaveValue(EX1_FORMATTED);
    await page.getByRole('button', { name: '清空' }).click();
    await expect(page.getByLabel('SQL 输入')).toHaveValue('');
    await expect(page.getByLabel('结果')).toHaveValue('');
  });

  test('空输入：输出为空、不报错', async ({ page }) => {
    await openTool(page, 'sql-format');
    await page.getByLabel('SQL 输入').fill('select 1');
    await expect(page.getByLabel('结果')).toHaveValue('SELECT\n  1');
    await page.getByLabel('SQL 输入').fill('');
    await expect(page.getByLabel('结果')).toHaveValue('');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('关键字小写选项', async ({ page }) => {
    await openTool(page, 'sql-format');
    await page.getByLabel('关键字大小写').selectOption('lower');
    await page.getByLabel('SQL 输入').fill(EX1_INPUT);
    await expect(page.getByLabel('结果')).toHaveValue(/^select/);
    await expect(page.getByLabel('结果')).toHaveValue(/left join/);
  });

  test('🖥 切换方言为 PostgreSQL 并格式化含 $1 的语句，结果正确显示', async ({ page }) => {
    await openTool(page, 'sql-format');
    await page.getByLabel('方言').selectOption('postgresql');
    await page.getByLabel('SQL 输入').fill('select * from t where id=$1 and v::int>0');
    await expect(page.getByLabel('结果')).toHaveValue(/id = \$1/);
    await expect(page.getByLabel('结果')).toHaveValue(/v::int > 0/);
  });

  test('🖥 切换缩进为 4 空格后「id,」前有 4 个空格', async ({ page }) => {
    await openTool(page, 'sql-format');
    await page.getByLabel('缩进').selectOption('4');
    await page.getByLabel('SQL 输入').fill(EX1_INPUT);
    await expect(page.getByLabel('结果')).toHaveValue(/\n {4}id,/);
  });

  test('压缩：行注释改写为 /* */，勾选删除注释后去掉', async ({ page }) => {
    await openTool(page, 'sql-format');
    await page.getByRole('button', { name: '压缩', exact: true }).click();
    await page.getByLabel('SQL 输入').fill('select a -- 注释\nfrom t');
    await expect(page.getByLabel('结果')).toHaveValue('SELECT a /* 注释 */ FROM t');
    await page.getByLabel('压缩时删除注释').check();
    await expect(page.getByLabel('结果')).toHaveValue('SELECT a FROM t');
  });

  test('非法输入：中文错误提示含行列号，页面不崩溃，修正后恢复', async ({ page }) => {
    await openTool(page, 'sql-format');
    await page.getByLabel('SQL 输入').fill("select 'abc");
    await expect(page.getByRole('alert')).toContainText('第 1 行第 8 列：字符串未闭合');
    await expect(page.getByLabel('结果')).toHaveValue('');

    await page.getByLabel('SQL 输入').fill('select /* x');
    await expect(page.getByRole('alert')).toContainText('注释未闭合');

    await page.getByLabel('SQL 输入').fill('select 1');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByLabel('结果')).toHaveValue('SELECT\n  1');
  });

  test('复制结果：剪贴板内容与结果一致', async ({ page }) => {
    await openTool(page, 'sql-format');
    await page.getByLabel('SQL 输入').fill(EX1_INPUT);
    await expect(page.getByLabel('结果')).toHaveValue(EX1_FORMATTED);
    await page.getByRole('button', { name: '复制结果' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(EX1_FORMATTED);
  });

  test('刷新后恢复上次输入与选项（ctx.storage）', async ({ page }) => {
    await openTool(page, 'sql-format');
    await page.getByLabel('方言').selectOption('postgresql');
    await page.getByLabel('关键字大小写').selectOption('lower');
    await page.getByLabel('SQL 输入').fill('select id from t');
    await expect(page.getByLabel('结果')).toHaveValue('select\n  id\nfrom\n  t');

    await page.reload();
    await page.locator('[data-tool-ready="sql-format"]').waitFor({ state: 'attached' });
    await expect(page.getByLabel('方言')).toHaveValue('postgresql');
    await expect(page.getByLabel('关键字大小写')).toHaveValue('lower');
    await expect(page.getByLabel('SQL 输入')).toHaveValue('select id from t');
    await expect(page.getByLabel('结果')).toHaveValue('select\n  id\nfrom\n  t');

    const stored = await page.evaluate(() => localStorage.getItem('glm-toolbox:sql-format:text'));
    expect(stored).toContain('select id from t');
  });

  test('性能：500 行 SQL 在 1 秒内格式化完成', async ({ page }) => {
    await openTool(page, 'sql-format');
    await page.evaluate(() => {
      const ta = document.querySelector('[data-testid="sql-format-input"]');
      ta.value = "select a,b,c from t where x=1 and y='字符串' order by a desc;\n".repeat(500);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.getByLabel('结果')).toHaveValue(/ORDER BY\n {2}a DESC/, { timeout: 1000 });
    const value = await page.getByLabel('结果').inputValue();
    expect(value.split('\n').length).toBeGreaterThan(2500);
  });

  test('外壳集成：标题、侧边栏高亮、关键词搜索', async ({ page }) => {
    await openTool(page, 'sql-format');
    await expect(page).toHaveTitle('SQL 格式化 - 码工具箱');
    await expect(page.getByRole('heading', { name: 'SQL 格式化' })).toBeVisible();
    await expect(page.locator('#tool-nav a[data-tool-id="sql-format"]')).toHaveAttribute('aria-current', 'true');

    // 清单 keywords 中的关键词都能搜到本工具
    await page.goto('/');
    const search = page.getByLabel('搜索工具');
    for (const keyword of ['sql', '格式化', 'mysql', 'geshihua']) {
      await search.fill(keyword);
      await expect(page.locator('#tool-nav').getByRole('link', { name: 'SQL 格式化' })).toBeVisible();
    }
    await search.fill('sql');
    await page.locator('#tool-nav').getByRole('link', { name: 'SQL 格式化' }).click();
    await expect(page.locator('[data-tool-ready="sql-format"]')).toBeAttached();
  });
});

test.describe('SQL 格式化 · 主题与视口', () => {
  test('深色主题下打开并完成格式化，无报错', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('glm-toolbox:theme', 'dark'));
    await openTool(page, 'sql-format');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByLabel('SQL 输入').fill(EX1_INPUT);
    await expect(page.getByLabel('结果')).toHaveValue(EX1_FORMATTED);
    await expect(readable(page)).resolves.toBe(true);
  });

  test('浅色主题下打开并完成格式化，无报错', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('glm-toolbox:theme', 'light'));
    await openTool(page, 'sql-format');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByLabel('SQL 输入').fill(EX1_INPUT);
    await expect(page.getByLabel('结果')).toHaveValue(EX1_FORMATTED);
    await expect(readable(page)).resolves.toBe(true);
  });

});

test.describe('SQL 格式化 · 移动端 375×667', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('窄屏无横向滚动，功能可用', async ({ page }) => {
    await openTool(page, 'sql-format');
    await page.getByLabel('SQL 输入').fill(EX1_INPUT);
    await expect(page.getByLabel('结果')).toHaveValue(EX1_FORMATTED);
    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noOverflow).toBe(true);
  });
});

/** 输出区文字颜色与背景可区分（深浅主题下都可读的粗略校验） */
async function readable(page) {
  return page.evaluate(() => {
    const ta = document.getElementById('sql-format-output');
    const color = getComputedStyle(ta).color;
    const bg = getComputedStyle(ta).backgroundColor;
    return typeof color === 'string' && typeof bg === 'string' && color !== bg;
  });
}
