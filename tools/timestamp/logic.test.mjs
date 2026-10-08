/** 时间戳转换单元测试（对应 issue #13 验收标准，所有「输入 → 输出」逐条断言） */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ZONE_LIST,
  dateTimeToTimestamp,
  daysInMonth,
  detectUnit,
  describeInZone,
  filterTimeZones,
  formatOffset,
  formatRelative,
  fractionText,
  isValidTimeZone,
  isoString,
  listTimeZones,
  parseDateTime,
  parseTimestamp,
  rfc2822,
  sanitizeZones,
  zoneAbbreviation,
  zoneOffsetMs,
  zoneWeekday,
} from './logic.mjs';

/* ==================== 时间戳 → 日期：验收样例 ==================== */

test('1700000000：自动识别为秒，各时区日期时间 / 星期 / 偏移 / 缩写', () => {
  const r = parseTimestamp('1700000000');
  assert.equal(r.ok, true);
  assert.equal(r.unit, 's');
  assert.equal(r.seconds, 1700000000);
  assert.equal(r.fractionText, '');

  const utc = describeInZone(r.ms, r.fractionText, 'UTC');
  assert.equal(utc.datetime, '2023-11-14 22:13:20');

  const shanghai = describeInZone(r.ms, r.fractionText, 'Asia/Shanghai');
  assert.equal(shanghai.datetime, '2023-11-15 06:13:20');
  assert.equal(shanghai.weekday, '星期三');
  assert.equal(shanghai.offset, 'UTC+08:00');
  assert.equal(shanghai.abbr, null); // 上海无缩写（GMT+8 不算缩写）

  const newYork = describeInZone(r.ms, r.fractionText, 'America/New_York');
  assert.equal(newYork.datetime, '2023-11-14 17:13:20');
  assert.equal(newYork.offset, 'UTC-05:00');
  assert.equal(newYork.abbr, 'EST');

  const tokyo = describeInZone(r.ms, r.fractionText, 'Asia/Tokyo');
  assert.equal(tokyo.datetime, '2023-11-15 07:13:20');

  assert.equal(isoString(r.ns), '2023-11-14T22:13:20.000Z');
  assert.equal(rfc2822(r.ms), 'Tue, 14 Nov 2023 22:13:20 GMT');
});

test('1700000000000：识别为毫秒，结果与秒一致；1700000000123 → 显示 .123', () => {
  const ms13 = parseTimestamp('1700000000000');
  assert.equal(ms13.ok, true);
  assert.equal(ms13.unit, 'ms');
  assert.equal(describeInZone(ms13.ms, ms13.fractionText, 'UTC').datetime, '2023-11-14 22:13:20');
  assert.equal(
    describeInZone(ms13.ms, ms13.fractionText, 'Asia/Shanghai').datetime,
    '2023-11-15 06:13:20',
  );

  const withMs = parseTimestamp('1700000000123');
  assert.equal(withMs.unit, 'ms');
  assert.equal(withMs.fractionText, '.123');
  assert.equal(
    describeInZone(withMs.ms, withMs.fractionText, 'Asia/Shanghai').datetime,
    '2023-11-15 06:13:20.123',
  );
  assert.equal(isoString(withMs.ns), '2023-11-14T22:13:20.123Z');
});

test('微秒 / 纳秒时间戳换算到同一时间', () => {
  const us = parseTimestamp('1700000000000000'); // 16 位 → 微秒
  assert.equal(us.ok, true);
  assert.equal(us.unit, 'us');
  assert.equal(us.ms, 1700000000000);
  assert.equal(describeInZone(us.ms, us.fractionText, 'UTC').datetime, '2023-11-14 22:13:20');

  const ns = parseTimestamp('1700000000000000000'); // 19 位 → 纳秒
  assert.equal(ns.ok, true);
  assert.equal(ns.unit, 'ns');
  assert.equal(ns.ms, 1700000000000);
  assert.equal(describeInZone(ns.ms, ns.fractionText, 'UTC').datetime, '2023-11-14 22:13:20');
});

test('微秒级小数：1700000000123456 → .123456（ISO 保留 6 位小数）', () => {
  const us = parseTimestamp('1700000000123456');
  assert.equal(us.fractionText, '.123456');
  assert.equal(isoString(us.ns), '2023-11-14T22:13:20.123456Z');
});

test('0 与 -1：Unix 纪元前后', () => {
  const zero = parseTimestamp('0');
  assert.equal(zero.ok, true);
  assert.equal(describeInZone(zero.ms, zero.fractionText, 'UTC').datetime, '1970-01-01 00:00:00');

  const minus = parseTimestamp('-1');
  assert.equal(minus.ok, true);
  assert.equal(minus.seconds, -1);
  assert.equal(describeInZone(minus.ms, minus.fractionText, 'UTC').datetime, '1969-12-31 23:59:59');
});

test('负数与小数秒：-1.5 → UTC 1969-12-31 23:59:58.5', () => {
  const r = parseTimestamp('-1.5');
  assert.equal(r.ok, true);
  assert.equal(r.unit, 's');
  assert.equal(r.relativeSeconds, -1.5);
  assert.equal(r.fractionText, '.5');
  assert.equal(describeInZone(r.ms, r.fractionText, 'UTC').datetime, '1969-12-31 23:59:58.5');
  assert.equal(isoString(r.ns), '1969-12-31T23:59:58.5Z');
});

test('fractionText：去除尾部 0，整秒为空', () => {
  assert.equal(fractionText(123_000_000n), '.123');
  assert.equal(fractionText(500_000_000n), '.5');
  assert.equal(fractionText(123_456_789n), '.123456789');
  assert.equal(fractionText(0n), '');
});

/* ==================== 单位自动识别与手动指定 ==================== */

test('单位自动识别的位数边界', () => {
  assert.equal(detectUnit('1').unit, 's');
  assert.equal(detectUnit('99999999999').unit, 's'); // 11 位
  assert.equal(detectUnit('100000000000').unit, 'ms'); // 12 位
  assert.equal(detectUnit('99999999999999').unit, 'ms'); // 14 位
  assert.equal(detectUnit('100000000000000').unit, 'us'); // 15 位
  assert.equal(detectUnit('99999999999999999').unit, 'us'); // 17 位
  assert.equal(detectUnit('100000000000000000').unit, 'ns'); // 18 位
  assert.equal(detectUnit('9999999999999999999').unit, 'ns'); // 19 位
  assert.equal(detectUnit('-1700000000').unit, 's'); // 正负号不计入位数

  const tooLong = detectUnit('12345678901234567890'); // 20 位
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.error, /最多 19 位/);
  assert.equal(tooLong.unit, undefined);
});

test('手动指定单位：1700000000 按毫秒 → 1970-01-20 17:13:20 UTC', () => {
  const r = parseTimestamp('1700000000', 'ms');
  assert.equal(r.ok, true);
  assert.equal(r.unit, 'ms');
  assert.equal(r.seconds, 1_700_000);
  assert.equal(describeInZone(r.ms, r.fractionText, 'UTC').datetime, '1970-01-20 16:13:20');
});

test('超出可表示范围 → 中文提示', () => {
  const r = parseTimestamp('999999999999999999999999'); // 24 位
  assert.equal(r.ok, false);
  assert.match(r.error, /最多 19 位/);
});

/* ==================== 非法输入（中文提示，不出 Invalid Date） ==================== */

test('非法时间戳：abc / 12.3.4 / 空字符串', () => {
  const abc = parseTimestamp('abc');
  assert.equal(abc.ok, false);
  assert.match(abc.error, /第 1 个字符「a」/);

  const dots = parseTimestamp('12.3.4');
  assert.equal(dots.ok, false);
  assert.match(dots.error, /第 5 个字符「\.」/);

  const empty = parseTimestamp('');
  assert.equal(empty.ok, false);
  assert.match(empty.error, /请输入时间戳/);

  // 所有错误提示都是中文句子，且不含 Invalid Date
  for (const r of [abc, dots, empty]) {
    assert.equal(typeof r.error, 'string');
    assert.doesNotMatch(r.error, /Invalid Date/);
  }
});

test('其他非法时间戳：小数点后无数字 / 小数位过多', () => {
  const trailingDot = parseTimestamp('12.');
  assert.equal(trailingDot.ok, false);
  assert.match(trailingDot.error, /缺少小数数字/);

  const tooPrecise = parseTimestamp('0.1234567891'); // 秒单位最多 9 位小数
  assert.equal(tooPrecise.ok, false);
  assert.match(tooPrecise.error, /小数位数过多/);

  const nsFrac = parseTimestamp('1.23', 'ns');
  assert.equal(nsFrac.ok, false);
  assert.match(nsFrac.error, /以纳秒为单位时不支持小数/);
});

/* ==================== 日期 → 时间戳：验收样例 ==================== */

test('2026-10-08 12:00:00 + Asia/Shanghai → 1791432000 / 1791432000000', () => {
  const r = dateTimeToTimestamp('2026-10-08 12:00:00', 'Asia/Shanghai');
  assert.equal(r.ok, true);
  assert.equal(r.status, 'unique');
  assert.equal(r.seconds, 1791432000);
  assert.equal(r.millis, 1791432000000);
  assert.equal(r.offset, 'UTC+08:00');
  assert.equal(r.utcDatetime, '2026-10-08 04:00:00');
});

test('同一字符串 + America/New_York → 1791475200', () => {
  const r = dateTimeToTimestamp('2026-10-08 12:00:00', 'America/New_York');
  assert.equal(r.ok, true);
  assert.equal(r.status, 'unique');
  assert.equal(r.seconds, 1791475200);
  assert.equal(r.offset, 'UTC-04:00'); // 10 月仍在夏令时
  assert.equal(r.abbr, 'EDT');
});

test('自带 UTC 偏移时以偏移为准（时区选什么都一样）', () => {
  for (const zone of ['Asia/Shanghai', 'America/New_York', 'Europe/London']) {
    const r = dateTimeToTimestamp('2026-10-08T12:00:00+08:00', zone);
    assert.equal(r.ok, true, zone);
    assert.equal(r.status, 'unique');
    assert.equal(r.seconds, 1791432000, zone);
  }
  const z = dateTimeToTimestamp('2026-10-08T12:00:00Z', 'America/New_York');
  assert.equal(z.seconds, 1791460800); // 12:00 UTC
});

test('日期时间解析的多种写法', () => {
  // 仅日期 → 当天 00:00
  const dateOnly = dateTimeToTimestamp('2026-10-08', 'UTC');
  assert.equal(dateOnly.seconds, 1791417600);
  // 斜杠分隔
  assert.equal(dateTimeToTimestamp('2026/10/08 12:00:00', 'Asia/Shanghai').seconds, 1791432000);
  // T 分隔、省略秒
  assert.equal(dateTimeToTimestamp('2026-10-08T12:00', 'Asia/Shanghai').seconds, 1791432000);
  // 小数秒
  const frac = dateTimeToTimestamp('2026-10-08 12:00:00.5', 'Asia/Shanghai');
  assert.equal(frac.millis, 1791432000500);
  // ±HHMM 紧凑偏移
  assert.equal(dateTimeToTimestamp('2026-10-08T12:00:00+0800', 'UTC').seconds, 1791432000);
});

test('日期时间非法输入 → 中文提示并指出问题', () => {
  const cases = [
    ['abc', /日期格式不正确/],
    ['2026-13-01', /月份必须在 1–12/],
    ['2026-02-30', /只有 28 天/],
    ['2024-02-30', /只有 29 天/], // 闰年
    ['2026-10-08 25:00', /小时必须在 0–23/],
    ['2026-10-08 12:61', /分钟必须在 0–59/],
    ['2026-10-08T12:00:00+15:00', /偏移超出范围/],
    ['', /请输入日期时间/],
  ];
  for (const [input, re] of cases) {
    const r = dateTimeToTimestamp(input, 'Asia/Shanghai');
    assert.equal(r.ok, false, input);
    assert.match(r.error, re, input);
  }
});

test('daysInMonth 含闰年', () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(1900, 2), 28); // 世纪年非闰
  assert.equal(daysInMonth(2000, 2), 29); // 400 年闰
});

/* ==================== 夏令时 ==================== */

test('夏令时跳变：2026-03-08 02:30:00 纽约 → 该时刻不存在', () => {
  const r = dateTimeToTimestamp('2026-03-08 02:30:00', 'America/New_York');
  assert.equal(r.ok, true);
  assert.equal(r.status, 'missing');
});

test('夏令时回拨：2026-11-01 01:30:00 纽约 → 两个时间戳并标注夏令时 / 标准时', () => {
  const r = dateTimeToTimestamp('2026-11-01 01:30:00', 'America/New_York');
  assert.equal(r.ok, true);
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.candidates.length, 2);

  const [dst, std] = r.candidates;
  assert.equal(dst.seconds, 1793511000);
  assert.equal(dst.kind, 'dst');
  assert.equal(dst.kindLabel, '夏令时');
  assert.equal(dst.abbr, 'EDT');
  assert.equal(dst.offset, 'UTC-04:00');

  assert.equal(std.seconds, 1793514600);
  assert.equal(std.kind, 'standard');
  assert.equal(std.kindLabel, '标准时');
  assert.equal(std.abbr, 'EST');
  assert.equal(std.offset, 'UTC-05:00');

  assert.ok(dst.ms < std.ms); // 夏令时（拨快）时刻在前
});

test('跳变前后一小时都正常解析', () => {
  const before = dateTimeToTimestamp('2026-03-08 01:30:00', 'America/New_York');
  assert.equal(before.status, 'unique');
  assert.equal(before.offset, 'UTC-05:00'); // EST

  const after = dateTimeToTimestamp('2026-03-08 03:30:00', 'America/New_York');
  assert.equal(after.status, 'unique');
  assert.equal(after.offset, 'UTC-04:00'); // EDT
});

/* ==================== 相对时间（注入 now） ==================== */

test('相对时间：now = 1700003600 时的验收样例', () => {
  assert.equal(formatRelative(1700000000, 1700003600), '1 小时前');
  assert.equal(formatRelative(1700090000, 1700003600), '1 天后');
});

test('相对时间的舍入规则（差值四舍五入到整秒后逐档进位）', () => {
  const now = 1700003600;
  assert.equal(formatRelative(now, now), '刚刚');
  assert.equal(formatRelative(now - 30, now), '30 秒前');
  assert.equal(formatRelative(now - 59, now), '59 秒前');
  assert.equal(formatRelative(now - 90, now), '2 分钟前'); // 1.5 分钟 → 四舍五入 2
  assert.equal(formatRelative(now - 3599, now), '1 小时前'); // 60 分钟 → 进位为小时
  assert.equal(formatRelative(now + 5400, now), '2 小时后'); // 1.5 小时 → 四舍五入 2
  assert.equal(formatRelative(now + 86399, now), '1 天后'); // 24 小时差 1 秒 → 进位为天
  assert.equal(formatRelative(now + 15 * 86400, now), '15 天后');
  assert.equal(formatRelative(now + 40 * 86400, now), '1 个月后'); // 40 天 ≈ 1.33 月
  assert.equal(formatRelative(now + 2 * 365 * 86400, now), '2 年后');
});

/* ==================== 时区工具函数 ==================== */

test('formatOffset：整点 / 半小时 / 负偏移', () => {
  assert.equal(formatOffset(28_800_000), 'UTC+08:00');
  assert.equal(formatOffset(-18_000_000), 'UTC-05:00');
  assert.equal(formatOffset(19_800_000), 'UTC+05:30'); // Asia/Kolkata
  assert.equal(formatOffset(0), 'UTC+00:00');
});

test('zoneOffsetMs 与 zoneAbbreviation', () => {
  const ms = 1700000000000; // 2023-11-14（纽约已结束夏令时）
  assert.equal(zoneOffsetMs(ms, 'Asia/Shanghai'), 28_800_000);
  assert.equal(zoneOffsetMs(ms, 'America/New_York'), -18_000_000);
  assert.equal(zoneOffsetMs(Date.UTC(2023, 7, 1), 'Asia/Kolkata'), 19_800_000);

  assert.equal(zoneAbbreviation(ms, 'America/New_York'), 'EST');
  assert.equal(zoneAbbreviation(Date.UTC(2023, 7, 1), 'America/New_York'), 'EDT');
  assert.equal(zoneAbbreviation(ms, 'Asia/Shanghai'), null); // 无缩写（GMT+8）
  assert.equal(zoneAbbreviation(ms, 'UTC'), null);
});

test('zoneWeekday：中文星期', () => {
  assert.equal(zoneWeekday(1700000000000, 'UTC'), '星期二');
  assert.equal(zoneWeekday(1700000000000, 'Asia/Shanghai'), '星期三');
});

test('isValidTimeZone / listTimeZones', () => {
  assert.equal(isValidTimeZone('Asia/Shanghai'), true);
  assert.equal(isValidTimeZone('Not/AZone'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.ok(listTimeZones().includes('Asia/Shanghai'));
});

test('sanitizeZones：非数组回退默认、过滤非法、去重', () => {
  assert.deepEqual(sanitizeZones(null), DEFAULT_ZONE_LIST);
  assert.deepEqual(sanitizeZones(['UTC', 'UTC']), ['UTC']);
  assert.deepEqual(sanitizeZones(['local', 'Not/AZone', 'Asia/Tokyo']), ['local', 'Asia/Tokyo']);
});

test('filterTimeZones：忽略大小写与分隔符、排除已有、限制数量', () => {
  const all = listTimeZones();
  assert.ok(filterTimeZones('Sydney', all).includes('Australia/Sydney'));
  assert.ok(filterTimeZones('new york', all).includes('America/New_York'));
  assert.ok(filterTimeZones('shanghai', all).includes('Asia/Shanghai'));
  assert.equal(filterTimeZones('Sydney', all, ['Australia/Sydney']).includes('Australia/Sydney'), false);
  assert.equal(filterTimeZones('', all).length, 0);
  assert.ok(filterTimeZones('a', all).length <= 20);
});

/* ==================== ISO / RFC 2822 细节 ==================== */

test('isoString：整秒补 .000，毫秒 3 位，微秒 6 位', () => {
  assert.equal(isoString(parseTimestamp('1700000000').ns), '2023-11-14T22:13:20.000Z');
  assert.equal(isoString(parseTimestamp('1700000000123').ns), '2023-11-14T22:13:20.123Z');
  assert.equal(isoString(parseTimestamp('1700000000123456').ns), '2023-11-14T22:13:20.123456Z');
  assert.equal(isoString(parseTimestamp('0').ns), '1970-01-01T00:00:00.000Z');
  assert.equal(isoString(parseTimestamp('-1').ns), '1969-12-31T23:59:59.000Z');
});

test('rfc2822：与 toUTCString 一致的英文格式', () => {
  assert.equal(rfc2822(0), 'Thu, 01 Jan 1970 00:00:00 GMT');
  assert.equal(rfc2822(-1000), 'Wed, 31 Dec 1969 23:59:59 GMT');
});
