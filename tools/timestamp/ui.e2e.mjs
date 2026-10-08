/** 时间戳转换端到端测试（对应 issue #13 验收标准中标 🖥 的条目） */

import { test, expect, openTool, SUBPATH_BASE_URL } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const TS_INPUT = '[data-testid="timestamp-input"]';
const DATE_INPUT = '[data-testid="timestamp-date-input"]';

test.describe('时间戳转换：外壳集成', () => {
  test('打开 #/timestamp：侧边栏高亮、标题正确', async ({ page }) => {
    await openTool(page, 'timestamp');
    await expect(page).toHaveTitle('时间戳转换 - 码工具箱');
    await expect(page.getByRole('heading', { name: '时间戳转换' })).toBeVisible();
    await expect(page.locator('#tool-nav a[data-tool-id="timestamp"]')).toHaveAttribute('aria-current', 'true');
  });

  test('搜索清单关键词能找到本工具（timestamp / 时间戳 / shijianchuo）', async ({ page }) => {
    for (const keyword of ['timestamp', '时间戳', 'shijianchuo']) {
      await page.goto('/');
      await page.getByLabel('搜索工具').fill(keyword);
      await expect(page.locator('#tool-nav').getByRole('link', { name: '时间戳转换' })).toBeVisible();
    }
  });

  test('子路径部署（--base /glm-toolbox/）下工具可用', async ({ page }) => {
    await page.goto(`${SUBPATH_BASE_URL}#/timestamp`);
    await expect(page.locator('[data-tool-ready="timestamp"]')).toBeAttached();
    await expect(page.locator('link[data-tool-style="timestamp"]')).toHaveCount(1);
    await page.locator(TS_INPUT).fill('1700000000');
    await expect(page.getByTestId('timestamp-time-Asia/Shanghai')).toHaveText('2023-11-15 06:13:20');
  });
});

test.describe('时间戳转换：当前时间', () => {
  test('固定时钟 2026-10-08T03:44:00Z → 当前秒时间戳 1791431040', async ({ page }) => {
    await page.clock.setFixedTime('2026-10-08T03:44:00Z');
    await openTool(page, 'timestamp');
    await expect(page.getByTestId('timestamp-now-seconds')).toHaveText('1791431040');
    await expect(page.getByTestId('timestamp-now-millis')).toHaveText('1791431040000');
  });

  test('暂停后不再刷新，继续后恢复', async ({ page }) => {
    await page.clock.pauseAt('2026-10-08T03:44:00Z');
    await openTool(page, 'timestamp');
    await expect(page.getByTestId('timestamp-now-seconds')).toHaveText('1791431040');

    await page.clock.runFor(5000);
    await expect(page.getByTestId('timestamp-now-seconds')).toHaveText('1791431045');

    await page.getByTestId('timestamp-pause').click();
    await expect(page.getByTestId('timestamp-pause')).toHaveText('继续刷新');
    await page.clock.runFor(5000);
    await expect(page.getByTestId('timestamp-now-seconds')).toHaveText('1791431045'); // 冻结

    await page.getByTestId('timestamp-pause').click();
    await page.clock.runFor(1000);
    await expect(page.getByTestId('timestamp-now-seconds')).toHaveText('1791431051');
  });

  test('「复制当前秒时间戳」写入剪贴板', async ({ page }) => {
    await page.clock.setFixedTime('2026-10-08T03:44:00Z');
    await openTool(page, 'timestamp');
    await page.getByRole('button', { name: '复制当前秒时间戳', exact: true }).click();
    await expect(page.getByRole('button', { name: '已复制', exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('1791431040');
  });
});

test.describe('时间戳转换：时间戳 → 日期', () => {
  test('1700000000 → Asia/Shanghai 行显示 2023-11-15 06:13:20，含星期与偏移', async ({ page }) => {
    await openTool(page, 'timestamp');
    await expect(page.getByRole('alert')).toHaveCount(0); // 初始为空时不出错误提示
    await page.locator(TS_INPUT).fill('1700000000');

    await expect(page.getByTestId('timestamp-time-Asia/Shanghai')).toHaveText('2023-11-15 06:13:20');
    await expect(page.getByTestId('timestamp-weekday-Asia/Shanghai')).toHaveText('星期三');
    await expect(page.getByTestId('timestamp-offset-Asia/Shanghai')).toHaveText('UTC+08:00');

    await expect(page.getByTestId('timestamp-time-UTC')).toHaveText('2023-11-14 22:13:20');
    await expect(page.getByTestId('timestamp-weekday-UTC')).toHaveText('星期二');

    await expect(page.getByTestId('timestamp-time-America/New_York')).toHaveText('2023-11-14 17:13:20');
    await expect(page.getByTestId('timestamp-offset-America/New_York')).toHaveText('UTC-05:00');
    await expect(page.getByTestId('timestamp-abbr-America/New_York')).toHaveText('EST');

    await expect(page.getByTestId('timestamp-time-Asia/Tokyo')).toHaveText('2023-11-15 07:13:20');

    await expect(page.getByTestId('timestamp-iso')).toHaveText('2023-11-14T22:13:20.000Z');
    await expect(page.getByTestId('timestamp-rfc2822')).toHaveText('Tue, 14 Nov 2023 22:13:20 GMT');
  });

  test('毫秒时间戳 1700000000123 → 显示 .123；「复制 ISO 8601」一致', async ({ page }) => {
    await openTool(page, 'timestamp');
    await page.locator(TS_INPUT).fill('1700000000123');
    await expect(page.getByTestId('timestamp-time-Asia/Shanghai')).toHaveText('2023-11-15 06:13:20.123');
    await expect(page.getByTestId('timestamp-iso')).toHaveText('2023-11-14T22:13:20.123Z');

    await page.getByRole('button', { name: '复制 ISO 8601', exact: true }).click();
    await expect(page.getByRole('button', { name: '已复制', exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('2023-11-14T22:13:20.123Z');
  });

  test('「复制转换结果」包含各时区行与 ISO / RFC 2822', async ({ page }) => {
    await openTool(page, 'timestamp');
    await page.locator(TS_INPUT).fill('1700000000');
    await expect(page.getByTestId('timestamp-time-Asia/Shanghai')).toHaveText('2023-11-15 06:13:20');

    await page.getByRole('button', { name: '复制转换结果', exact: true }).click();
    await expect(page.getByRole('button', { name: '已复制', exact: true })).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('时间戳 1700000000（秒）');
    expect(clipboard).toContain('Asia/Shanghai：2023-11-15 06:13:20 星期三 UTC+08:00');
    expect(clipboard).toContain('ISO 8601（UTC）：2023-11-14T22:13:20.000Z');
    expect(clipboard).toContain('RFC 2822：Tue, 14 Nov 2023 22:13:20 GMT');
  });

  test('手动指定单位：1700000000 按毫秒 → 1970-01-20 16:13:20 UTC', async ({ page }) => {
    await openTool(page, 'timestamp');
    await page.locator(TS_INPUT).fill('1700000000');
    await expect(page.getByTestId('timestamp-time-UTC')).toHaveText('2023-11-14 22:13:20');

    await page.getByLabel('时间戳单位').selectOption('ms');
    await expect(page.getByTestId('timestamp-time-UTC')).toHaveText('1970-01-20 16:13:20');
  });

  test('非法输入 abc / 12.3.4 / 空字符串 → 中文提示且无 Invalid Date', async ({ page }) => {
    await openTool(page, 'timestamp');

    await page.locator(TS_INPUT).fill('abc');
    await expect(page.getByRole('alert')).toContainText('第 1 个字符「a」无法识别');

    await page.locator(TS_INPUT).fill('12.3.4');
    await expect(page.getByRole('alert')).toContainText('第 5 个字符「.」无法识别');

    await page.locator(TS_INPUT).fill('');
    await expect(page.getByRole('alert')).toContainText('请输入时间戳');

    const alertText = await page.getByRole('alert').textContent();
    expect(alertText).not.toContain('Invalid Date');
    // 修正输入后错误自动消失
    await page.locator(TS_INPUT).fill('0');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('timestamp-time-UTC')).toHaveText('1970-01-01 00:00:00');
  });
});

test.describe('时间戳转换：日期 → 时间戳', () => {
  test('2026-10-08 12:00:00 + Asia/Shanghai → 1791432000 / 1791432000000', async ({ page }) => {
    await openTool(page, 'timestamp');
    await page.getByLabel('所在时区').selectOption('Asia/Shanghai');
    await page.locator(DATE_INPUT).fill('2026-10-08 12:00:00');

    await expect(page.getByTestId('timestamp-date-seconds')).toHaveText('1791432000');
    await expect(page.getByTestId('timestamp-date-millis')).toHaveText('1791432000000');
    await expect(page.getByTestId('timestamp-date-utc')).toHaveText('2026-10-08 04:00:00 UTC');

    await page.getByRole('button', { name: '复制秒时间戳', exact: true }).click();
    await expect(page.getByRole('button', { name: '已复制', exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('1791432000');
  });

  test('同一字符串 + America/New_York → 1791475200；自带偏移 +08:00 → 1791432000', async ({ page }) => {
    await openTool(page, 'timestamp');
    await page.getByLabel('所在时区').selectOption('America/New_York');
    await page.locator(DATE_INPUT).fill('2026-10-08 12:00:00');
    await expect(page.getByTestId('timestamp-date-seconds')).toHaveText('1791475200');

    // 输入自带偏移时与时区选择无关
    for (const zone of ['Asia/Shanghai', 'America/New_York']) {
      await page.getByLabel('所在时区').selectOption(zone);
      await page.locator(DATE_INPUT).fill('2026-10-08T12:00:00+08:00');
      await expect(page.getByTestId('timestamp-date-seconds')).toHaveText('1791432000');
    }
  });

  test('夏令时跳变：2026-03-08 02:30:00 纽约 → 提示该时刻不存在', async ({ page }) => {
    await openTool(page, 'timestamp');
    await page.getByLabel('所在时区').selectOption('America/New_York');
    await page.locator(DATE_INPUT).fill('2026-03-08 02:30:00');
    await expect(page.getByRole('alert')).toHaveText('该时区不存在此时刻（夏令时跳变）');
    await expect(page.getByTestId('timestamp-date-unique')).toBeHidden();
  });

  test('夏令时回拨：2026-11-01 01:30:00 纽约 → 夏令时 / 标准时两个时间戳', async ({ page }) => {
    await openTool(page, 'timestamp');
    await page.getByLabel('所在时区').selectOption('America/New_York');
    await page.locator(DATE_INPUT).fill('2026-11-01 01:30:00');

    await expect(page.getByTestId('timestamp-amb-0-seconds')).toHaveText('1793511000');
    await expect(page.getByTestId('timestamp-amb-0-millis')).toHaveText('1793511000000');
    await expect(page.locator('.timestamp-amb-row').first().locator('dt')).toHaveText('夏令时 EDT（UTC-04:00）');

    await expect(page.getByTestId('timestamp-amb-1-seconds')).toHaveText('1793514600');
    await expect(page.getByTestId('timestamp-amb-1-millis')).toHaveText('1793514600000');
    await expect(page.locator('.timestamp-amb-row').nth(1).locator('dt')).toHaveText('标准时 EST（UTC-05:00）');
  });

  test('非法日期 2026-02-30 → 中文提示', async ({ page }) => {
    await openTool(page, 'timestamp');
    await page.getByLabel('所在时区').selectOption('Asia/Shanghai');
    await page.locator(DATE_INPUT).fill('2026-02-30 12:00:00');
    await expect(page.getByRole('alert')).toContainText('2026 年 2 月只有 28 天');
  });
});

test.describe('时间戳转换：时区列表管理', () => {
  test('添加 Australia/Sydney → 列表多出一行；刷新后仍在；删除后消失', async ({ page }) => {
    await openTool(page, 'timestamp');
    await expect(page.getByTestId('timestamp-zone-row-Australia/Sydney')).toHaveCount(0);

    await page.getByLabel('搜索时区').fill('Sydney');
    await page.getByRole('option', { name: /Australia\/Sydney/ }).click();
    await expect(page.getByTestId('timestamp-zone-row-Australia/Sydney')).toBeVisible();

    // 刷新后仍在（保存在 ctx.storage）
    await page.reload();
    await page.locator('[data-tool-ready="timestamp"]').waitFor({ state: 'attached' });
    await expect(page.getByTestId('timestamp-zone-row-Australia/Sydney')).toBeVisible();

    // 删除后消失，再刷新也不在
    await page.getByRole('button', { name: '删除 Australia/Sydney' }).click();
    await expect(page.getByTestId('timestamp-zone-row-Australia/Sydney')).toHaveCount(0);
    await page.reload();
    await page.locator('[data-tool-ready="timestamp"]').waitFor({ state: 'attached' });
    await expect(page.getByTestId('timestamp-zone-row-Australia/Sydney')).toHaveCount(0);
  });

  test('上移 / 下移调整顺序，「恢复默认时区」还原', async ({ page }) => {
    await openTool(page, 'timestamp');
    const rows = page.locator('tbody tr[data-testid]');
    await expect(rows).toHaveCount(6); // 默认 6 个时区

    await page.getByRole('button', { name: '上移 Asia/Tokyo' }).click();
    await expect(rows.nth(4)).toHaveAttribute('data-testid', 'timestamp-zone-row-Asia/Tokyo');
    await expect(rows.nth(3)).toHaveAttribute('data-testid', 'timestamp-zone-row-America/New_York');
    await expect(rows.nth(5)).toHaveAttribute('data-testid', 'timestamp-zone-row-Europe/London');

    await page.getByRole('button', { name: '下移 Asia/Tokyo' }).click();
    await expect(rows.nth(5)).toHaveAttribute('data-testid', 'timestamp-zone-row-Asia/Tokyo');
    await expect(rows.nth(4)).toHaveAttribute('data-testid', 'timestamp-zone-row-Europe/London');

    await page.getByTestId('timestamp-reset-zones').click();
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(5)).toHaveAttribute('data-testid', 'timestamp-zone-row-Asia/Tokyo');
  });

  test('添加时区后，时区下拉（日期 → 时间戳）同步出现新选项', async ({ page }) => {
    await openTool(page, 'timestamp');
    await page.getByLabel('搜索时区').fill('Berlin');
    await page.getByRole('option', { name: /Europe\/Berlin/ }).click();
    await expect(page.getByTestId('timestamp-zone-row-Europe/Berlin')).toBeVisible();
    await expect(page.getByLabel('所在时区').locator('option[value="Europe/Berlin"]')).toHaveCount(1);
  });
});

test.describe('时间戳转换：主题与移动端', () => {
  for (const theme of ['light', 'dark']) {
    test(`${theme} 主题下打开并正常使用`, async ({ page }) => {
      await page.addInitScript(
        (t) => localStorage.setItem('glm-toolbox:theme', t),
        theme,
      );
      await openTool(page, 'timestamp');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.locator(TS_INPUT).fill('1700000000');
      await expect(page.getByTestId('timestamp-time-Asia/Shanghai')).toHaveText('2023-11-15 06:13:20');
      await page.locator(DATE_INPUT).fill('2026-10-08 12:00:00');
      await page.getByLabel('所在时区').selectOption('Asia/Shanghai');
      await expect(page.getByTestId('timestamp-date-seconds')).toHaveText('1791432000');
    });
  }

  test('视口 375×667 下无横向滚动，可完成基本操作', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openTool(page, 'timestamp');
    await page.locator(TS_INPUT).fill('1700000000');
    await expect(page.getByTestId('timestamp-time-Asia/Shanghai')).toHaveText('2023-11-15 06:13:20');
    await page.locator(DATE_INPUT).fill('2026-10-08 12:00:00');
    await page.getByLabel('所在时区').selectOption('Asia/Shanghai');
    await expect(page.getByTestId('timestamp-date-seconds')).toHaveText('1791432000');

    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noOverflow).toBe(true);
  });
});
