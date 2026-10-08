/** Cron 解析端到端测试（对应 issue #14「Cron 解析」验收标准） */

import { test, expect, openTool } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

/** 验收基准时刻：2026-10-08T03:44:00Z = 2026-10-07 23:44 America/New_York */
const FIXED_TIME = '2026-10-08T03:44:00Z';

const INPUT = '[data-testid="cron-input"]';
const FIRST_RUN = '[data-testid="cron-run"] >> nth=0';

/** 固定时钟后打开本工具 */
async function openCron(page) {
  await page.clock.setFixedTime(FIXED_TIME);
  await openTool(page, 'cron');
}

/* ==================== 外壳集成 ==================== */

test.describe('Cron 解析：外壳集成', () => {
  test('打开 #/cron：侧边栏高亮、标题正确、默认示例已解析', async ({ page }) => {
    await openCron(page);
    await expect(page).toHaveTitle('Cron 解析 - 码工具箱');
    await expect(page.getByRole('heading', { name: 'Cron 解析' })).toBeVisible();
    await expect(page.locator('#tool-nav a[data-tool-id="cron"]')).toHaveAttribute('aria-current', 'true');

    // 默认预填表达式，描述随挂载立即出现
    await expect(page.locator(INPUT)).toHaveValue('*/15 9-18 * * 1-5');
    await expect(page.getByTestId('cron-description')).toHaveText('周一至周五，9 点至 18 点，每 15 分钟');
  });

  test('搜索清单关键词能找到本工具（cron / crontab / 定时 / 计划任务 / schedule / dingshi）', async ({ page }) => {
    for (const keyword of ['cron', 'crontab', '定时', '计划任务', 'schedule', 'dingshi', '表达式']) {
      await page.goto('/');
      await page.getByLabel('搜索工具').fill(keyword);
      await expect(page.locator('#tool-nav').getByRole('link', { name: 'Cron 解析' })).toBeVisible();
    }
  });
});

/* ==================== 解析与未来时间（固定时钟） ==================== */

test.describe('Cron 解析：中文描述与未来执行时间', () => {
  test('0 12 13 * 5（纽约时区）：描述含「每月 13 日或每周五」，第一行 2026-10-09 12:00', async ({ page }) => {
    await openCron(page);
    await page.getByLabel('时区').selectOption('America/New_York');
    await page.locator(INPUT).fill('0 12 13 * 5');

    await expect(page.getByTestId('cron-description')).toHaveText('每月 13 日或每周五 12:00');
    await expect(page.locator(FIRST_RUN).locator('.cron-run-time')).toHaveText('2026-10-09 12:00 星期五');
    await expect(page.locator(FIRST_RUN).locator('.cron-run-meta')).toHaveText('距现在 1 天 12 小时（UTC-04:00）');
    await expect(page.getByTestId('cron-runs')).toBeVisible();
  });

  test('切换时区到 Asia/Shanghai 后列表随之变化（偏移与距现在均更新）', async ({ page }) => {
    await openCron(page);
    await page.getByLabel('时区').selectOption('America/New_York');
    await page.locator(INPUT).fill('0 12 13 * 5');
    await expect(page.locator(FIRST_RUN).locator('.cron-run-meta')).toHaveText('距现在 1 天 12 小时（UTC-04:00）');

    await page.getByLabel('时区').selectOption('Asia/Shanghai');
    // 墙钟时间相同（同一天 12:00），但绝对时刻早 12 小时：UTC 偏移与「距现在」都变了
    await expect(page.locator(FIRST_RUN).locator('.cron-run-time')).toHaveText('2026-10-09 12:00 星期五');
    await expect(page.locator(FIRST_RUN).locator('.cron-run-meta')).toHaveText('距现在 1 天 16 分钟（UTC+08:00）');
  });

  test('点击「工作日 9 点」示例 → 输入框填入 0 9 * * 1-5，描述随之更新', async ({ page }) => {
    await openCron(page);
    await page.getByLabel('时区').selectOption('America/New_York');
    await page.getByRole('button', { name: '工作日 9 点' }).click();
    await expect(page.locator(INPUT)).toHaveValue('0 9 * * 1-5');
    await expect(page.getByTestId('cron-description')).toHaveText('周一至周五 09:00');
    // now 为周三 23:44（纽约），下一个工作日 9 点是周四早上
    await expect(page.locator(FIRST_RUN).locator('.cron-run-time')).toHaveText('2026-10-08 09:00 星期四');
  });

  test('其他示例按钮也能填入并解析（每分钟 / 每小时 / 每天 0 点 / 每月 1 号）', async ({ page }) => {
    await openCron(page);
    const cases = [
      ['每分钟', '* * * * *', '每分钟'],
      ['每小时', '0 * * * *', '每小时的 00 分'],
      ['每天 0 点', '0 0 * * *', '每天 00:00'],
      ['每月 1 号', '0 0 1 * *', '每月 1 日 00:00'],
    ];
    for (const [label, expr, description] of cases) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.locator(INPUT)).toHaveValue(expr);
      await expect(page.getByTestId('cron-description')).toHaveText(description);
    }
  });

  test('6 段含秒：*/20 * * * * * 显示到秒（23:44:20 / 23:44:40 / 23:45:00）', async ({ page }) => {
    await openCron(page);
    await page.getByLabel('时区').selectOption('America/New_York');
    await page.locator(INPUT).fill('*/20 * * * * *');
    await expect(page.getByTestId('cron-description')).toHaveText('每 20 秒');
    const times = page.locator('[data-testid="cron-run"] .cron-run-time');
    await expect(times.nth(0)).toHaveText('2026-10-07 23:44:20 星期三');
    await expect(times.nth(1)).toHaveText('2026-10-07 23:44:40 星期三');
    await expect(times.nth(2)).toHaveText('2026-10-07 23:45:00 星期三');
  });

  test('@daily 宏：等价展开提示 + 下一次 2026-10-08 00:00', async ({ page }) => {
    await openCron(page);
    await page.getByLabel('时区').selectOption('America/New_York');
    await page.locator(INPUT).fill('@daily');
    await expect(page.getByTestId('cron-description')).toHaveText('每天 00:00');
    await expect(page.getByTestId('cron-macro-hint')).toHaveText('@daily 等价于 0 0 * * *');
    await expect(page.locator(FIRST_RUN).locator('.cron-run-time')).toHaveText('2026-10-08 00:00 星期四');
  });

  test('JAN,jul 与 1,7 解析结果一致', async ({ page }) => {
    await openCron(page);
    await page.getByLabel('时区').selectOption('America/New_York');
    await page.locator(INPUT).fill('0 9 * JAN,jul MON-FRI');
    await expect(page.getByTestId('cron-description')).toHaveText('1 月、7 月，周一至周五 09:00');
    await expect(page.locator(FIRST_RUN).locator('.cron-run-time')).toHaveText('2027-01-01 09:00 星期五');

    await page.locator(INPUT).fill('0 9 * 1,7 1-5');
    await expect(page.getByTestId('cron-description')).toHaveText('1 月、7 月，周一至周五 09:00');
    await expect(page.locator(FIRST_RUN).locator('.cron-run-time')).toHaveText('2027-01-01 09:00 星期五');
  });

  test('显示次数切换：5 / 20 次列表行数正确', async ({ page }) => {
    await openCron(page);
    await page.locator(INPUT).fill('* * * * *');
    await expect(page.locator('[data-testid="cron-run"]')).toHaveCount(10); // 默认 10 次

    await page.getByLabel('显示次数').selectOption('5');
    await expect(page.locator('[data-testid="cron-run"]')).toHaveCount(5);

    await page.getByLabel('显示次数').selectOption('20');
    await expect(page.locator('[data-testid="cron-run"]')).toHaveCount(20);
  });

  test('逐段解释表：原文与展开后的取值', async ({ page }) => {
    await openCron(page);
    await page.locator(INPUT).fill('*/15 9-18 * * 1-5');
    const rows = page.locator('.cron-table tbody tr');
    await expect(rows).toHaveCount(5);
    const cell = (row, col) => rows.nth(row).locator('th, td').nth(col);
    await expect(cell(0, 0)).toHaveText('分钟');
    await expect(cell(0, 1)).toHaveText('*/15');
    await expect(cell(0, 2)).toHaveText('0、15、30、45');
    await expect(cell(1, 0)).toHaveText('小时');
    await expect(cell(1, 1)).toHaveText('9-18');
    await expect(cell(1, 2)).toHaveText('9–18');
    await expect(cell(2, 2)).toHaveText('1–31 全部');
    await expect(cell(3, 2)).toHaveText('1–12 全部');
    await expect(cell(4, 1)).toHaveText('1-5');
    await expect(cell(4, 2)).toHaveText('1–5');
  });

  test('「复制描述」与「复制执行时间」读回一致', async ({ page }) => {
    await openCron(page);
    await page.getByLabel('时区').selectOption('America/New_York');
    await page.locator(INPUT).fill('0 12 13 * 5');
    await expect(page.getByTestId('cron-description')).toHaveText('每月 13 日或每周五 12:00');

    await page.getByRole('button', { name: '复制描述' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('每月 13 日或每周五 12:00');

    await page.getByRole('button', { name: '复制执行时间' }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('2026-10-09 12:00 星期五');
    expect(copied).toContain('UTC-04:00');
  });
});

/* ==================== 错误与边界 ==================== */

test.describe('Cron 解析：错误提示与永不执行', () => {
  test('非法输入给出中文错误提示，结果区隐藏', async ({ page }) => {
    await openCron(page);
    const cases = [
      ['60 * * * *', '分钟字段超出范围（0–59）：60'],
      ['* * *', '字段数量应为 5 或 6 个'],
      ['*/0 * * * *', '步长不能为 0'],
      ['5-1 * * * *', '范围起点不能大于终点'],
      ['0 0 L * *', '暂不支持 Quartz 语法：L'],
    ];
    for (const [expr, message] of cases) {
      await page.locator(INPUT).fill(expr);
      await expect(page.getByRole('alert')).toHaveText(message);
      await expect(page.getByTestId('cron-description')).toBeHidden();
    }
    // 修正输入后错误消失、结果恢复
    await page.locator(INPUT).fill('0 9 * * 1-5');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('cron-description')).toHaveText('周一至周五 09:00');
  });

  test('0 0 31 2 * → 提示「该表达式永远不会执行（或 5 年内不会执行）」', async ({ page }) => {
    await openCron(page);
    await page.locator(INPUT).fill('0 0 31 2 *');
    await expect(page.getByTestId('cron-never')).toBeVisible();
    await expect(page.getByTestId('cron-never')).toHaveText('该表达式永远不会执行（或 5 年内不会执行）');
    await expect(page.locator('[data-testid="cron-run"]')).toHaveCount(0);
    // 描述与解释表仍正常显示
    await expect(page.getByTestId('cron-description')).toHaveText('2 月 31 日 00:00');
  });

  test('清空输入：不报错，结果区收起', async ({ page }) => {
    await openCron(page);
    await page.locator(INPUT).fill('0 9 * * 1-5');
    await expect(page.getByTestId('cron-description')).toHaveText('周一至周五 09:00');
    await page.locator(INPUT).fill('');
    await expect(page.getByTestId('cron-description')).toBeHidden();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('刷新后恢复上次输入与选项（ctx.storage）', async ({ page }) => {
    await openCron(page);
    await page.getByLabel('时区').selectOption('Asia/Shanghai');
    await page.getByLabel('显示次数').selectOption('5');
    await page.locator(INPUT).fill('0 12 13 * 5');
    // 等描述更新，意味着防抖回调已执行、输入已写入 storage
    await expect(page.getByTestId('cron-description')).toHaveText('每月 13 日或每周五 12:00');
    await expect(page.locator('[data-testid="cron-run"]')).toHaveCount(5);

    await page.reload();
    await expect(page.locator('[data-tool-ready="cron"]')).toBeAttached();
    await expect(page.locator(INPUT)).toHaveValue('0 12 13 * 5');
    await expect(page.getByLabel('时区')).toHaveValue('Asia/Shanghai');
    await expect(page.getByTestId('cron-description')).toHaveText('每月 13 日或每周五 12:00');
    await expect(page.locator('[data-testid="cron-run"]')).toHaveCount(5);
  });
});

/* ==================== 主题与移动端 ==================== */

test.describe('Cron 解析：主题与移动端', () => {
  test('深色与浅色主题下界面都可用、无报错', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openCron(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator(INPUT).fill('0 9 * * 1-5');
    await expect(page.getByTestId('cron-description')).toHaveText('周一至周五 09:00');

    await page.getByRole('button', { name: '切换主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator(INPUT).fill('30 2 * * 0');
    await expect(page.getByTestId('cron-description')).toHaveText('每周日 02:30');
    await expect(page.locator(FIRST_RUN).locator('.cron-run-time')).toContainText('02:30');
  });

  test.describe('视口 375×667', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('无横向滚动，解析正常', async ({ page }) => {
      await openCron(page);
      await page.getByLabel('时区').selectOption('America/New_York');
      await page.locator(INPUT).fill('*/15 9-18 * * 1-5');
      await expect(page.getByTestId('cron-description')).toHaveText('周一至周五，9 点至 18 点，每 15 分钟');
      await expect(page.locator(FIRST_RUN).locator('.cron-run-time')).toContainText('2026-10-08 09:00');

      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(noOverflow).toBe(true);
    });
  });
});
