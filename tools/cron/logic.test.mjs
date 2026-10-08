/** Cron 解析单元测试（对应 issue #14 验收标准；时间均用注入的 now 固定） */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CronError,
  SEARCH_LIMIT_YEARS,
  analyze,
  describeCron,
  explainCron,
  formatOffset,
  formatRunTime,
  humanizeDuration,
  localTimeZone,
  nextRuns,
  parseCron,
} from './logic.mjs';

/** 验收基准时刻：2026-10-07 23:44 America/New_York（EDT，UTC-4） */
const NOW = Date.UTC(2026, 9, 8, 3, 44, 0);
const NY = 'America/New_York';

/** 取前 n 次执行时间的展示文本 */
function times(expr, { count = 10, now = NOW, tz = NY, withSeconds } = {}) {
  const runs = nextRuns(expr, { now, tz, count });
  const sec = withSeconds ?? parseCron(expr).cron.hasSeconds;
  return runs.map((run) => formatRunTime(run, { withSeconds: sec }));
}

/* ==================== 中文描述与未来时间（验收基准时刻） ==================== */

test('*/15 9-18 * * 1-5 → 周一至周五，9 点至 18 点，每 15 分钟；前 3 次 09:00 / 09:15 / 09:30（星期四）', () => {
  const parsed = parseCron('*/15 9-18 * * 1-5');
  assert.equal(parsed.ok, true);
  assert.equal(describeCron(parsed.cron), '周一至周五，9 点至 18 点，每 15 分钟');
  assert.deepEqual(times('*/15 9-18 * * 1-5', { count: 3 }), [
    '2026-10-08 09:00 星期四',
    '2026-10-08 09:15 星期四',
    '2026-10-08 09:30 星期四',
  ]);
});

test('0 0 1 * * → 每月 1 日 00:00；下一次 2026-11-01 00:00', () => {
  const parsed = parseCron('0 0 1 * *');
  assert.equal(describeCron(parsed.cron), '每月 1 日 00:00');
  assert.deepEqual(times('0 0 1 * *', { count: 1 }), ['2026-11-01 00:00 星期日']);
});

test('30 2 * * 0 → 每周日 02:30；下一次 2026-10-11 02:30', () => {
  const parsed = parseCron('30 2 * * 0');
  assert.equal(describeCron(parsed.cron), '每周日 02:30');
  assert.deepEqual(times('30 2 * * 0', { count: 1 }), ['2026-10-11 02:30 星期日']);
});

test('@daily 等价于 0 0 * * *，描述「每天 00:00」；下一次 2026-10-08 00:00', () => {
  const result = analyze('@daily', { now: NOW, tz: NY, count: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.expanded, '0 0 * * *');
  assert.equal(result.description, '每天 00:00');
  assert.deepEqual(
    result.runs.map((run) => formatRunTime(run)),
    ['2026-10-08 00:00 星期四'],
  );
  assert.deepEqual(
    nextRuns('@midnight', { now: NOW, tz: NY, count: 2 }),
    nextRuns('0 0 * * *', { now: NOW, tz: NY, count: 2 }),
  );
});

test('0 12 13 * 5（日与周 OR）→ 前 5 次 10-09 / 10-13 / 10-16 / 10-23 / 10-30，描述说明「每月 13 日或每周五」', () => {
  const result = analyze('0 12 13 * 5', { now: NOW, tz: NY, count: 5 });
  assert.ok(result.description.includes('每月 13 日或每周五'), result.description);
  assert.deepEqual(
    result.runs.map((run) => formatRunTime(run)),
    [
      '2026-10-09 12:00 星期五',
      '2026-10-13 12:00 星期二',
      '2026-10-16 12:00 星期五',
      '2026-10-23 12:00 星期五',
      '2026-10-30 12:00 星期五',
    ],
  );
});

test('仅限定日或周时是 AND：0 12 13 * * 不含周五 10-09，0 12 * * 5 不含 13 日', () => {
  assert.deepEqual(
    times('0 12 13 * *', { count: 1 }),
    ['2026-10-13 12:00 星期二'],
  );
  assert.deepEqual(
    times('0 12 * * 5', { count: 1 }),
    ['2026-10-09 12:00 星期五'],
  );
});

test('0 9 * JAN,jul MON-FRI 与 0 9 * 1,7 1-5 结果完全一致', () => {
  const named = nextRuns('0 9 * JAN,jul MON-FRI', { now: NOW, tz: NY, count: 5 });
  const numeric = nextRuns('0 9 * 1,7 1-5', { now: NOW, tz: NY, count: 5 });
  assert.deepEqual(named, numeric);
  assert.equal(analyze('0 9 * JAN,jul MON-FRI').description, analyze('0 9 * 1,7 1-5').description);
  // 2027 年首个一月的周一：1 月 1 日就是星期五
  assert.deepEqual(times('0 9 * JAN,jul MON-FRI', { count: 1 }), ['2027-01-01 09:00 星期五']);
});

test('6 段（首段为秒）：*/20 * * * * * → 前 3 次 23:44:20 / 23:44:40 / 23:45:00', () => {
  const result = analyze('*/20 * * * * *', { now: NOW, tz: NY, count: 3 });
  assert.equal(result.ok, true);
  assert.equal(result.hasSeconds, true);
  assert.equal(result.description, '每 20 秒');
  assert.deepEqual(
    result.runs.map((run) => formatRunTime(run, { withSeconds: true })),
    ['2026-10-07 23:44:20 星期三', '2026-10-07 23:44:40 星期三', '2026-10-07 23:45:00 星期三'],
  );
});

test('星期 7 与 0 等价：0 8 * * 7 与 0 8 * * 0 结果相同', () => {
  assert.deepEqual(
    nextRuns('0 8 * * 7', { now: NOW, tz: NY, count: 3 }),
    nextRuns('0 8 * * 0', { now: NOW, tz: NY, count: 3 }),
  );
});

/* ==================== a/n 步长写法（无终点 → 到字段最大值） ==================== */

test('0 9/2 * * *：小时展开为 9 至 23 的奇数列，当天 09:00 后是 11:00', () => {
  const parsed = parseCron('0 9/2 * * *');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.cron.fields.hour.values, [9, 11, 13, 15, 17, 19, 21, 23]);
  assert.equal(describeCron(parsed.cron), '从 9 点起每 2 小时');
  assert.deepEqual(times('0 9/2 * * *', { count: 2 }), ['2026-10-08 09:00 星期四', '2026-10-08 11:00 星期四']);
});

test('0/15 * * * * 与 */15 * * * * 的执行时间完全一致', () => {
  const a = nextRuns('0/15 * * * *', { now: NOW, tz: NY, count: 10 });
  const b = nextRuns('*/15 * * * *', { now: NOW, tz: NY, count: 10 });
  assert.deepEqual(a, b);
  assert.equal(analyze('0/15 * * * *').description, analyze('*/15 * * * *').description);
});

test('a/n 在各字段都到最大值：日 1/5、月 3/4、秒 10/20、星期 5/2', () => {
  assert.deepEqual(parseCron('0 0 1/5 * *').cron.fields.dom.values, [1, 6, 11, 16, 21, 26, 31]);
  assert.deepEqual(parseCron('0 0 * 3/4 *').cron.fields.month.values, [3, 7, 11]);
  assert.deepEqual(parseCron('10/20 0 0 * * *').cron.fields.sec.values, [10, 30, 50]);
  // 星期最大输入值是 7，7 归一化为周日 0
  assert.deepEqual(parseCron('0 0 * * 5/2').cron.fields.dow.values, [0, 5]);
});

test('a/n 起点越界仍报范围错误；纯单值与显式范围不受影响', () => {
  assert.equal(parseCron('60/5 * * * *').message, '分钟字段超出范围（0–59）：60');
  assert.equal(parseCron('* 24/2 * * *').message, '小时字段超出范围（0–23）：24');
  assert.deepEqual(parseCron('9 * * * *').cron.fields.min.values, [9]);
  assert.deepEqual(parseCron('10-40/10 * * * *').cron.fields.min.values, [10, 20, 30, 40]);
  // 55/10：55 之后跨过最大值，只剩 55
  assert.deepEqual(parseCron('55/10 * * * *').cron.fields.min.values, [55]);
});

test('逐段解释表展开 a/n 的取值', () => {
  const rows = explainCron(parseCron('0 9/2 * * *').cron);
  assert.equal(rows.find((row) => row.key === 'hour').values, '9、11、13、15、17、19、21、23');
});

/* ==================== 夏令时 ==================== */

test('夏令时跳变：30 2 * * *，now = 2027-03-13 00:00（纽约）→ 跳过不存在的 03-14 02:30', () => {
  const now = Date.UTC(2027, 2, 13, 5, 0, 0); // 2027-03-13 00:00 EST
  assert.deepEqual(times('30 2 * * *', { now, count: 3 }), [
    '2027-03-13 02:30 星期六',
    '2027-03-15 02:30 星期一',
    '2027-03-16 02:30 星期二',
  ]);
});

test('夏令时回拨：30 1 * * *，now = 2026-10-31 12:00（纽约）→ 11-01 01:30 只出现一次，时间戳 1793511000', () => {
  const now = Date.UTC(2026, 9, 31, 16, 0, 0); // 2026-10-31 12:00 EDT
  const runs = nextRuns('30 1 * * *', { now, tz: NY, count: 5 });
  assert.equal(Math.round(runs[0].epoch / 1000), 1793511000);
  assert.deepEqual(
    runs.slice(0, 3).map((run) => formatRunTime(run)),
    ['2026-11-01 01:30 星期日', '2026-11-02 01:30 星期一', '2026-11-03 01:30 星期二'],
  );
  // 11 月 1 日只出现一次（重复时刻取第一次，即 EDT 05:30Z 那次）
  assert.equal(runs.filter((run) => run.month === 11 && run.day === 1).length, 1);
});

test('夏令时回拨取第一次出现：now 处于两次 01:30 之间时，下一次是 11-02 而不是 11-01 的第二次', () => {
  const now = Date.UTC(2026, 10, 1, 5, 45, 0); // 2026-11-01 01:45 EST（回拨之后）
  assert.deepEqual(times('30 1 * * *', { now, count: 1 }), ['2026-11-02 01:30 星期一']);
});

/* ==================== 错误提示 ==================== */

test('错误：60 * * * * → 分钟字段超出范围（0–59）：60', () => {
  const result = parseCron('60 * * * *');
  assert.equal(result.ok, false);
  assert.equal(result.message, '分钟字段超出范围（0–59）：60');
  assert.throws(() => nextRuns('60 * * * *', { now: NOW }), CronError);
});

test('错误：* * * → 字段数量应为 5 或 6 个', () => {
  assert.equal(parseCron('* * *').message, '字段数量应为 5 或 6 个');
  assert.equal(parseCron('1 2 3 4 5 6 7').message, '字段数量应为 5 或 6 个');
});

test('错误：*/0 * * * * → 步长不能为 0', () => {
  assert.equal(parseCron('*/0 * * * *').message, '步长不能为 0');
});

test('错误：5-1 * * * * → 范围起点不能大于终点', () => {
  assert.equal(parseCron('5-1 * * * *').message, '范围起点不能大于终点');
});

test('错误：0 0 L * * → 暂不支持 Quartz 语法：L', () => {
  assert.equal(parseCron('0 0 L * *').message, '暂不支持 Quartz 语法：L');
});

test('其他错误：Quartz 字符、未知宏、非法值、时区', () => {
  assert.equal(parseCron('0 0 * ? *').message, '暂不支持 Quartz 语法：?');
  assert.equal(parseCron('0 0 15W * *').message, '暂不支持 Quartz 语法：W');
  assert.equal(parseCron('0 0 * * 1#3').message, '暂不支持 Quartz 语法：#');
  assert.equal(parseCron('@reboot').message, '暂不支持的宏：@reboot');
  assert.equal(parseCron('* 24 * * *').message, '小时字段超出范围（0–23）：24');
  assert.equal(parseCron('0 0 32 * *').message, '日字段超出范围（1–31）：32');
  assert.equal(parseCron('0 0 * 13 *').message, '月字段超出范围（1–12）：13');
  assert.equal(parseCron('0 0 * * 8').message, '星期字段超出范围（0–7）：8');
  assert.equal(parseCron('abc * * * *').message, '分钟字段的值无法识别：abc');
  assert.equal(parseCron('* * * * FOO').message, '星期字段的值无法识别：FOO');
  assert.equal(parseCron('MON-FRI * * * *').message, '分钟字段的值无法识别：MON');
  assert.equal(parseCron('60 60 * * * *').message, '秒字段超出范围（0–59）：60');
  // 非法时区
  const tzResult = analyze('* * * * *', { now: NOW, tz: 'Mars/Olympus' });
  assert.equal(tzResult.ok, false);
  assert.equal(tzResult.message, '无法识别的时区：Mars/Olympus');
});

/* ==================== 永不执行与搜索上限 ==================== */

test('0 0 31 2 * → 该表达式永远不会执行（5 年内无结果），且不卡死', () => {
  const start = Date.now();
  const runs = nextRuns('0 0 31 2 *', { now: NOW, tz: NY, count: 50 });
  const elapsed = Date.now() - start;
  assert.deepEqual(runs, []);
  assert.ok(elapsed < 3000, `搜索耗时 ${elapsed}ms`);
  const result = analyze('0 0 31 2 *', { now: NOW, tz: NY, count: 5 });
  assert.equal(result.ok, true);
  assert.equal(result.runs.length, 0); // UI 据此显示「永远不会执行」
});

test('0 0 29 2 * → 下一次落在 2028-02-29（闰年），5 年内仅此一次', () => {
  // 搜索上限 5 年（约到 2031-10），2032-02-29 超出范围
  assert.deepEqual(times('0 0 29 2 *', { count: 5 }), ['2028-02-29 00:00 星期二']);
});

test('默认返回 10 次，count 可注入', () => {
  assert.equal(nextRuns('0 0 * * *', { now: NOW, tz: NY }).length, 10);
  assert.equal(nextRuns('0 0 * * *', { now: NOW, tz: NY, count: 20 }).length, 20);
});

/* ==================== 时区 ==================== */

test('按所选时区计算：0 12 13 * 5 在 Asia/Shanghai 的首次执行是 2026-10-09 12:00（UTC+8）', () => {
  const [first] = nextRuns('0 12 13 * 5', { now: NOW, tz: 'Asia/Shanghai', count: 1 });
  assert.equal(first.epoch, Date.UTC(2026, 9, 9, 4, 0, 0));
  assert.equal(formatOffset(first.offsetMs), 'UTC+08:00');
  assert.equal(formatRunTime(first), '2026-10-09 12:00 星期五');
});

test('同一表达式在不同时区得到不同的绝对时刻', () => {
  const [ny] = nextRuns('0 12 13 * 5', { now: NOW, tz: NY, count: 1 });
  const [sh] = nextRuns('0 12 13 * 5', { now: NOW, tz: 'Asia/Shanghai', count: 1 });
  assert.equal(ny.epoch - sh.epoch, 12 * 3600 * 1000);
  assert.equal(formatOffset(ny.offsetMs), 'UTC-04:00');
});

test('now 缺省用当前时间、tz 缺省用本地时区，均可运行', () => {
  const runs = nextRuns('* * * * *', { count: 1 });
  assert.equal(runs.length, 1);
  assert.ok(runs[0].epoch > Date.now() - 60_000);
  assert.equal(typeof localTimeZone(), 'string');
});

test('now 支持 Date 对象注入', () => {
  const runs = nextRuns('0 0 * * *', { now: new Date(NOW), tz: NY, count: 1 });
  assert.equal(formatRunTime(runs[0]), '2026-10-08 00:00 星期四');
});

/* ==================== 描述与解释表 ==================== */

test('描述：常见表达式', () => {
  const cases = [
    ['* * * * *', '每分钟'],
    ['0 9 * * 1-5', '周一至周五 09:00'],
    ['*/20 * * * *', '每 20 分钟'],
    ['0 * * * *', '每小时的 00 分'],
    ['0 0 1 1 *', '1 月 1 日 00:00'],
    ['0 0 * * 0', '每周日 00:00'],
    ['@weekly', '每周日 00:00'],
    ['@yearly', '1 月 1 日 00:00'],
    ['@hourly', '每小时的 00 分'],
    ['30 12 0 * * *', '每天 00:12:30'],
    ['0 0 * 1 *', '1 月的每天 00:00'],
    ['0 0 * * 5-7', '周五至周日 00:00'],
    ['0 9 * 1,7 1-5', '1 月、7 月，周一至周五 09:00'],
  ];
  for (const [expr, expected] of cases) {
    const parsed = parseCron(expr);
    assert.equal(parsed.ok, true, expr);
    assert.equal(describeCron(parsed.cron), expected, expr);
  }
});

test('逐段解释表：原文与展开后的取值', () => {
  const parsed = parseCron('*/15 9-18 * * 1-5');
  assert.deepEqual(
    explainCron(parsed.cron).map(({ label, source, values }) => [label, source, values]),
    [
      ['分钟', '*/15', '0、15、30、45'],
      ['小时', '9-18', '9–18'],
      ['日', '*', '1–31 全部'],
      ['月', '*', '1–12 全部'],
      ['星期', '1-5', '1–5'],
    ],
  );
});

test('逐段解释表：6 段表达式多一行秒，星期 7 归一化为 0', () => {
  const parsed = parseCron('0-20/10 30 12 1 JAN SUN-THU');
  const rows = explainCron(parsed.cron);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[0], { key: 'sec', label: '秒', source: '0-20/10', values: '0、10、20' });
  assert.deepEqual(rows[4], { key: 'month', label: '月', source: 'JAN', values: '1' });
  assert.deepEqual(rows[5], { key: 'dow', label: '星期', source: 'SUN-THU', values: '0–4' });
});

/* ==================== 展示格式化 ==================== */

test('formatRunTime：5 段不带秒、6 段带秒', () => {
  const [five] = nextRuns('0 12 13 * 5', { now: NOW, tz: NY, count: 1 });
  assert.equal(formatRunTime(five), '2026-10-09 12:00 星期五');
  const [six] = nextRuns('*/20 * * * * *', { now: NOW, tz: NY, count: 1 });
  assert.equal(formatRunTime(six, { withSeconds: true }), '2026-10-07 23:44:20 星期三');
});

test('formatOffset：常见偏移', () => {
  assert.equal(formatOffset(-4 * 3600_000), 'UTC-04:00');
  assert.equal(formatOffset(8 * 3600_000), 'UTC+08:00');
  assert.equal(formatOffset(5.5 * 3600_000), 'UTC+05:30');
  assert.equal(formatOffset(0), 'UTC+00:00');
});

test('humanizeDuration：取最大的两个非零单位', () => {
  assert.equal(humanizeDuration(36 * 3600_000 + 16 * 60_000), '1 天 12 小时后');
  assert.equal(humanizeDuration(24 * 3600_000 + 16 * 60_000), '1 天 16 分钟后');
  assert.equal(humanizeDuration(45_000), '45 秒后');
  assert.equal(humanizeDuration(90_000), '1 分钟 30 秒后');
  assert.equal(humanizeDuration(3600_000), '1 小时后');
  assert.equal(humanizeDuration(500), '不足 1 秒后');
});

/* ==================== analyze 一站式入口 ==================== */

test('analyze：成功与失败路径', () => {
  const ok = analyze('0 9 * * 1-5', { now: NOW, tz: NY, count: 5 });
  assert.equal(ok.ok, true);
  assert.equal(ok.description, '周一至周五 09:00');
  assert.equal(ok.fields.length, 5);
  assert.equal(ok.runs.length, 5);
  assert.equal(ok.macro, null);

  const bad = analyze('nonsense');
  assert.equal(bad.ok, false);
  assert.equal(typeof bad.message, 'string');
});

test('搜索上限常量为 5 年', () => {
  assert.equal(SEARCH_LIMIT_YEARS, 5);
});
