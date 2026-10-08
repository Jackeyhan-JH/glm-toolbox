/**
 * 时间戳转换 —— 纯逻辑模块（不碰 DOM / window，node --test 直接测试）。
 *
 * 约定：
 *   - 内部统一用纳秒（BigInt）表示一个时刻，保证微秒 / 纳秒时间戳不丢精度；
 *     需要构造 Date 时换算成整数毫秒（先 floorDiv 再转 Number，全程精确）。
 *   - 所有时区计算只用 Intl.DateTimeFormat，不引入时区库；
 *     涉及「当前时间」的函数都允许注入 now，测试才能确定。
 *   - 单位自动识别（按整数部分位数，不含正负号）：
 *       ≤ 11 位按秒、12–14 位按毫秒、15–17 位按微秒、18–19 位按纳秒；
 *     可手动指定单位。支持负数与小数秒。
 */

/* ==================== 常量 ==================== */

/** 「本地」伪时区条目：界面层把它解析为运行环境的本地时区 */
export const LOCAL_ZONE = 'local';

/** 默认时区列表（第一项为「本地」伪条目） */
export const DEFAULT_ZONE_LIST = [
  LOCAL_ZONE,
  'UTC',
  'Asia/Shanghai',
  'America/New_York',
  'Europe/London',
  'Asia/Tokyo',
];

/** 单位选项（value 与界面下拉框一致） */
export const UNIT_OPTIONS = [
  { value: 'auto', label: '自动识别' },
  { value: 's', label: '秒' },
  { value: 'ms', label: '毫秒' },
  { value: 'us', label: '微秒' },
  { value: 'ns', label: '纳秒' },
];

const UNIT_LABEL = Object.fromEntries(UNIT_OPTIONS.map((u) => [u.value, u.label]));

/** 各单位对应的纳秒数与所允许的最大小数位数 */
const UNIT_NS = { s: 10n ** 9n, ms: 10n ** 6n, us: 10n ** 3n, ns: 1n };
const UNIT_FRAC_DIGITS = { s: 9, ms: 6, us: 3, ns: 0 };

/** 自动识别的位数区间（整数部分位数从大到小试探） */
const AUTO_RANGES = [
  { max: 11, unit: 's' },
  { max: 14, unit: 'ms' },
  { max: 17, unit: 'us' },
  { max: 19, unit: 'ns' },
];

const NS_PER_SECOND = 10n ** 9n;
const DAY_MS = 86_400_000;

/** Date 可表示的毫秒范围（约公元前 271821 年 ～ 公元 275760 年） */
const MS_MIN = -8.64e15;
const MS_MAX = 8.64e15;

/* ==================== 基础工具 ==================== */

/** BigInt 向下取整除法（负数也向 −∞ 方向取整） */
function floorDiv(a, b) {
  const q = a / b;
  if (a % b !== 0n && (a < 0n) !== (b < 0n)) return q - 1n;
  return q;
}

/** 纳秒 → { sec（整秒，向下取整）, fracNs（0..999999999） } */
function splitNs(ns) {
  const sec = floorDiv(ns, NS_PER_SECOND);
  return { sec, fracNs: ns - sec * NS_PER_SECOND };
}

/** 秒内小数部分文本：123000000 → ".123"，500000000 → ".5"，0 → "" */
export function fractionText(fracNs) {
  const digits = String(fracNs).padStart(9, '0').replace(/0+$/, '');
  return digits === '' ? '' : `.${digits}`;
}

const pad2 = (n) => String(n).padStart(2, '0');

/* ==================== 时区格式化器（带缓存） ==================== */

const partsFormatterCache = new Map();
const weekdayFormatterCache = new Map();
const abbrFormatterCache = new Map();
const timeZoneValidCache = new Map();

function getPartsFormatter(timeZone) {
  let dtf = partsFormatterCache.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatterCache.set(timeZone, dtf);
  }
  return dtf;
}

/** 某时刻在指定时区的 各分量（数字） */
function getZoneParts(ms, timeZone) {
  const map = {};
  for (const part of getPartsFormatter(timeZone).formatToParts(ms)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === '24' ? '0' : map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** 运行环境的本地时区（IANA id） */
export function systemTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** 'local' → 实际本地时区，其余原样返回 */
export function resolveZone(zone) {
  return zone === LOCAL_ZONE ? systemTimeZone() : zone;
}

/** 是否为有效 IANA 时区（带缓存） */
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone === '') return false;
  if (timeZoneValidCache.has(timeZone)) return timeZoneValidCache.get(timeZone);
  let ok = true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    ok = false;
  }
  timeZoneValidCache.set(timeZone, ok);
  return ok;
}

/** Intl.supportedValuesOf('timeZone')（不可用时返回空数组） */
export function listTimeZones() {
  try {
    const values = Intl.supportedValuesOf('timeZone');
    return Array.isArray(values) ? values : [];
  } catch {
    return [];
  }
}

/**
 * 按关键词过滤时区（用于「添加时区」搜索）：
 * 大小写不敏感；忽略 / 与 _（"new york" 可匹配 America/New_York）；已有时区不重复出现。
 */
export function filterTimeZones(query, all, exclude = [], limit = 20) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s/_]/g, '');
  if (q === '') return [];
  const excluded = new Set(exclude);
  const out = [];
  for (const tz of all) {
    if (excluded.has(tz)) continue;
    if (tz.toLowerCase().replace(/[_/]/g, '').includes(q)) {
      out.push(tz);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** 校正存储的时区列表：只保留合法条目并去重；非数组时回退默认列表 */
export function sanitizeZones(stored) {
  if (!Array.isArray(stored)) return [...DEFAULT_ZONE_LIST];
  const zones = stored.filter(
    (z) => typeof z === 'string' && (z === LOCAL_ZONE || isValidTimeZone(z)),
  );
  return [...new Set(zones)];
}

/* ==================== 时区换算 ==================== */

/** 某时刻在指定时区的 UTC 偏移（毫秒，东八区为 28800000） */
export function zoneOffsetMs(ms, timeZone) {
  const p = getZoneParts(ms, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - Math.floor(ms / 1000) * 1000;
}

/** 偏移毫秒 → "UTC+08:00" / "UTC-05:00"（支持半小时偏移） */
export function formatOffset(offsetMs) {
  const sign = offsetMs < 0 ? '-' : '+';
  const abs = Math.abs(offsetMs);
  const hours = Math.floor(abs / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  return `UTC${sign}${pad2(hours)}:${pad2(minutes)}`;
}

/** 时区缩写（如 EDT / EST / CST）；只有 GMT/UTC+偏移而无缩写时返回 null */
export function zoneAbbreviation(ms, timeZone) {
  let dtf = abbrFormatterCache.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' });
    abbrFormatterCache.set(timeZone, dtf);
  }
  const part = dtf.formatToParts(ms).find((p) => p.type === 'timeZoneName');
  const name = part ? part.value : '';
  if (name === '' || /^(GMT|UTC)/i.test(name)) return null;
  return name;
}

/** 星期（中文，如「星期三」） */
export function zoneWeekday(ms, timeZone) {
  let dtf = weekdayFormatterCache.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('zh-CN', { timeZone, weekday: 'long' });
    weekdayFormatterCache.set(timeZone, dtf);
  }
  return dtf.format(ms);
}

/**
 * 某时刻在某时区的展示行：日期时间（可带小数秒文本）、星期、UTC 偏移、缩写。
 * @param {number} ms 整数毫秒时刻
 * @param {string} fracText 秒内小数文本（如 ".123"），追加在每行日期时间后
 */
export function describeInZone(ms, fracText, timeZone) {
  const p = getZoneParts(ms, timeZone);
  return {
    zone: timeZone,
    datetime: `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}${fracText}`,
    weekday: zoneWeekday(ms, timeZone),
    offset: formatOffset(zoneOffsetMs(ms, timeZone)),
    abbr: zoneAbbreviation(ms, timeZone),
  };
}

/* ==================== 时间戳 → 日期 ==================== */

/**
 * 单位自动识别：按整数部分位数判断（≤11 秒 / 12–14 毫秒 / 15–17 微秒 / 18–19 纳秒）。
 * @returns {{ ok: true, unit: 's'|'ms'|'us'|'ns' } | { ok: false, error: string }}
 */
export function detectUnit(input) {
  const s = String(input ?? '').trim();
  const m = /^([+-]?)(\d+)/.exec(s);
  if (!m) return { ok: false, error: '无法识别时间戳：请输入数字' };
  const digits = m[2].length;
  for (const range of AUTO_RANGES) {
    if (digits <= range.max) return { ok: true, unit: range.unit };
  }
  return { ok: false, error: `时间戳过长：整数部分最多 19 位（纳秒），当前 ${digits} 位` };
}

/**
 * 解析时间戳字符串 → 时刻。
 * 逐字符解析，出错时给出位置（第 N 个字符）。
 * @param {string} input 时间戳文本
 * @param {'auto'|'s'|'ms'|'us'|'ns'} [unit] 单位，默认自动识别
 * @returns {{
 *   ok: true, unit, ns: bigint, ms: number, seconds: number,
 *   fractionText: string, relativeSeconds: number
 * } | { ok: false, error: string }}
 */
export function parseTimestamp(input, unit = 'auto') {
  const s = String(input ?? '').trim();
  if (s === '') return { ok: false, error: '请输入时间戳' };

  /* ----- 逐字符解析：[+-]? 数字+ ( "." 数字+ )? ----- */
  let i = 0;
  if (s[i] === '+' || s[i] === '-') i += 1;
  const negative = s[0] === '-';
  const intStart = i;
  while (i < s.length && s[i] >= '0' && s[i] <= '9') i += 1;
  const intDigits = s.slice(intStart, i);
  let fracDigits = '';
  if (s[i] === '.') {
    const dotAt = i;
    i += 1;
    const fracStart = i;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') i += 1;
    fracDigits = s.slice(fracStart, i);
    if (fracDigits === '') {
      return { ok: false, error: `第 ${dotAt + 2} 个字符处缺少小数数字（小数点后应为数字）` };
    }
  }
  if (i !== s.length) {
    return {
      ok: false,
      error: `第 ${i + 1} 个字符「${s[i]}」无法识别：时间戳只能包含数字、一个小数点与开头的正负号`,
    };
  }
  if (intDigits === '') {
    return { ok: false, error: `第 ${intStart + 1} 个字符处缺少数字` };
  }

  /* ----- 单位 ----- */
  let unitValue = unit;
  if (unitValue === 'auto') {
    const detected = detectUnit(s);
    if (!detected.ok) return detected;
    unitValue = detected.unit;
  } else if (!(unitValue in UNIT_NS)) {
    return { ok: false, error: `未知的时间戳单位：${unitValue}` };
  }

  const fracMax = UNIT_FRAC_DIGITS[unitValue];
  if (fracDigits.length > fracMax) {
    return {
      ok: false,
      error:
        fracMax === 0
          ? `以${UNIT_LABEL[unitValue]}为单位时不支持小数`
          : `小数位数过多：以${UNIT_LABEL[unitValue]}为单位时最多 ${fracMax} 位小数（当前 ${fracDigits.length} 位）`,
    };
  }

  /* ----- 换算为纳秒（BigInt，全程精确） ----- */
  const unitNanos = UNIT_NS[unitValue];
  let ns = BigInt(intDigits) * unitNanos;
  if (fracDigits !== '') {
    ns += (BigInt(fracDigits) * unitNanos) / 10n ** BigInt(fracDigits.length);
  }
  if (negative) ns = -ns;

  const { sec, fracNs } = splitNs(ns);
  const ms = Number(sec) * 1000 + Number(fracNs / 1_000_000n);
  if (ms < MS_MIN || ms > MS_MAX) {
    return { ok: false, error: '时间超出可换算范围（约公元前 271821 年 ～ 公元 275760 年）' };
  }

  return {
    ok: true,
    unit: unitValue,
    unitLabel: UNIT_LABEL[unitValue],
    ns,
    ms, // 整数毫秒（Date 可直接使用）
    seconds: Number(sec), // 整秒部分
    fractionText: fractionText(fracNs),
    relativeSeconds: Number(ns) / 1e9, // 相对时间用（秒，含小数）
  };
}

/** ISO 8601（UTC）：至少保留毫秒位（.000），小数最多到纳秒 9 位 */
export function isoString(ns) {
  const { sec, fracNs } = splitNs(ns);
  let base;
  try {
    base = new Date(Number(sec) * 1000).toISOString();
  } catch {
    return null; // 公元前等超出 ISO 基本表示范围的时刻
  }
  const frac = String(fracNs).padStart(9, '0').replace(/0+$/, '');
  return base.replace(/\.\d{3}Z$/, `.${frac === '' ? '000' : frac}Z`);
}

/** RFC 2822（UTC），如 "Tue, 14 Nov 2023 22:13:20 GMT" */
export function rfc2822(ms) {
  return new Date(ms).toUTCString();
}

/**
 * 相对时间（中文）。舍入规则（在 logic.test.mjs 中逐条验证）：
 *   差值先四舍五入到整秒；随后在「秒 → 分 → 时 → 天 → 月 → 年」中取
 *   第一个数量足够的档位，每档再对单位数四舍五入；恰好凑满下一档
 *   （如 60 分钟、24 小时）时自然换算成下一档单位。
 * @param {number} targetSeconds 目标时刻（秒）
 * @param {number} nowSeconds 参考时刻（秒，可注入）
 */
export function formatRelative(targetSeconds, nowSeconds) {
  const diff = Math.round(targetSeconds - nowSeconds);
  if (!Number.isFinite(diff)) return '—';
  if (diff === 0) return '刚刚';
  const abs = Math.abs(diff);
  const suffix = diff < 0 ? '前' : '后';
  if (abs < 60) return `${abs} 秒${suffix}`;
  const minutes = Math.round(abs / 60);
  if (minutes < 60) return `${minutes} 分钟${suffix}`;
  const hours = Math.round(abs / 3600);
  if (hours < 24) return `${hours} 小时${suffix}`;
  const days = Math.round(abs / 86400);
  if (days < 30) return `${days} 天${suffix}`;
  const months = Math.round(abs / 2_592_000); // 30 天为一月（近似）
  if (months < 12) return `${months} 个月${suffix}`;
  return `${Math.round(abs / 31_536_000)} 年${suffix}`; // 365 天为一年（近似）
}

/* ==================== 日期 → 时间戳 ==================== */

/** 各月天数（含闰年） */
export function daysInMonth(year, month) {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

const DATE_TIME_RE =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,9}))?)?\s*(Z|z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * 解析日期时间文本。接受：
 *   2026-10-08、2026-10-08 12:00、2026-10-08 12:00:00、2026-10-08T12:00、
 *   2026/10/08 12:00:00、2026-10-08T12:00:00.500+08:00、…Z
 * 自带偏移（Z 或 ±HH:MM）时 offsetMinutes 非 null，换算以偏移为准。
 */
export function parseDateTime(input) {
  const s = String(input ?? '').trim();
  if (s === '') return { ok: false, error: '请输入日期时间' };
  const m = DATE_TIME_RE.exec(s);
  if (!m) {
    return {
      ok: false,
      error: '日期格式不正确，支持如 2026-10-08 12:00:00、2026-10-08T12:00 或 2026-10-08T12:00:00+08:00',
    };
  }
  const [, yS, moS, dS, hS = '0', miS = '0', secS = '0', fracS = '', zoneS = ''] = m;
  const year = Number(yS);
  const month = Number(moS);
  const day = Number(dS);
  const hour = Number(hS);
  const minute = Number(miS);
  const second = Number(secS);
  if (month < 1 || month > 12) return { ok: false, error: `月份必须在 1–12 之间，当前为 ${month}` };
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) {
    return { ok: false, error: `${year} 年 ${month} 月只有 ${maxDay} 天，当前日期为 ${day}` };
  }
  if (hour > 23) return { ok: false, error: `小时必须在 0–23 之间，当前为 ${hour}` };
  if (minute > 59) return { ok: false, error: `分钟必须在 0–59 之间，当前为 ${minute}` };
  if (second > 59) return { ok: false, error: `秒必须在 0–59 之间，当前为 ${second}` };

  let offsetMinutes = null;
  if (zoneS === 'Z' || zoneS === 'z') {
    offsetMinutes = 0;
  } else if (zoneS !== '') {
    const om = /^([+-])(\d{2}):?(\d{2})$/.exec(zoneS);
    const oh = Number(om[2]);
    const omin = Number(om[3]);
    if (oh > 14 || (oh === 14 && omin > 0)) {
      return { ok: false, error: `UTC 偏移超出范围（最大 ±14:00），当前为 ${zoneS}` };
    }
    if (omin > 59) return { ok: false, error: `UTC 偏移的分钟部分必须在 0–59 之间，当前为 ${omin}` };
    offsetMinutes = (om[1] === '-' ? -1 : 1) * (oh * 60 + omin);
  }

  const nanos = fracS === '' ? 0n : BigInt((fracS + '000000000').slice(0, 9));
  return {
    ok: true,
    parts: { year, month, day, hour, minute, second },
    nanos,
    offsetMinutes,
    hasOffset: zoneS !== '',
  };
}

/**
 * 组装日期 → 时间戳的结果；nanos（0..999999999）是小数秒部分，
 * 计入毫秒输出（如 12:00:00.5 → 毫秒多 500）。
 */
function timestampResult(ms, offsetMs, timeZone, nanos = 0n, extra = {}) {
  const millis = ms + Math.floor(Number(nanos) / 1e6);
  return {
    status: 'unique',
    ms,
    seconds: Math.floor(millis / 1000),
    millis,
    offsetMs,
    offset: formatOffset(offsetMs),
    abbr: zoneAbbreviation(ms, timeZone),
    utcDatetime: describeInZone(ms, '', 'UTC').datetime,
    ...extra,
  };
}

/**
 * 日期时间 + 时区 → 时间戳，处理夏令时：
 *   - 普通时刻 → status 'unique'；
 *   - 本地时刻不存在（春季跳变）→ status 'missing'；
 *   - 本地时刻重复（秋季回拨）→ status 'ambiguous'，candidates 按时间先后排序，
 *     偏移较大（拨快）的一个标注 kind 'dst'（夏令时），较小的一个 'standard'（标准时）。
 * @param {string} input 日期时间文本
 * @param {string} timeZone IANA 时区（'local' 表示运行环境本地时区）
 */
export function dateTimeToTimestamp(input, timeZone) {
  const parsed = parseDateTime(input);
  if (!parsed.ok) return parsed;
  const zone = resolveZone(timeZone);
  if (!isValidTimeZone(zone)) return { ok: false, error: `未知时区：${timeZone}` };

  const { year, month, day, hour, minute, second } = parsed.parts;
  const nanos = parsed.nanos;

  // 自带 UTC 偏移（Z / ±HH:MM）时以偏移为准，忽略所选时区
  if (parsed.hasOffset) {
    const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - parsed.offsetMinutes * 60_000;
    if (utcMs < MS_MIN || utcMs > MS_MAX) {
      return { ok: false, error: '时间超出可换算范围（约公元前 271821 年 ～ 公元 275760 年）' };
    }
    return { ok: true, ...timestampResult(utcMs, -parsed.offsetMinutes * 60_000, 'UTC', nanos) };
  }

  // 把墙上时间当作 UTC 求出猜测值，再按时区偏移反推候选时刻
  const wallGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  if (wallGuess < MS_MIN - DAY_MS || wallGuess > MS_MAX + DAY_MS) {
    return { ok: false, error: '时间超出可换算范围（约公元前 271821 年 ～ 公元 275760 年）' };
  }

  const candidates = new Map(); // instant(ms) -> offset(ms)，只有「换算回去仍是原墙上时间」的才算数
  for (const probe of [wallGuess - DAY_MS, wallGuess, wallGuess + DAY_MS]) {
    if (probe < MS_MIN || probe > MS_MAX) continue;
    const offsetMs = zoneOffsetMs(probe, zone);
    const instant = wallGuess - offsetMs;
    if (instant < MS_MIN || instant > MS_MAX) continue;
    if (zoneOffsetMs(instant, zone) !== offsetMs) continue;
    const p = getZoneParts(instant, zone);
    if (
      p.year !== year ||
      p.month !== month ||
      p.day !== day ||
      p.hour !== hour ||
      p.minute !== minute ||
      p.second !== second
    ) {
      continue;
    }
    candidates.set(instant, offsetMs);
  }

  const instants = [...candidates.keys()].sort((a, b) => a - b);
  if (instants.length === 0) {
    return { ok: true, status: 'missing' };
  }
  if (instants.length === 1) {
    const ms = instants[0];
    return { ok: true, ...timestampResult(ms, candidates.get(ms), zone, nanos) };
  }

  // 两个有效时刻（秋季回拨）：偏移大的是夏令时，偏移小的是标准时
  const sortedByOffset = [...instants].sort((a, b) => candidates.get(b) - candidates.get(a));
  const kindByInstant = new Map();
  kindByInstant.set(sortedByOffset[0], 'dst');
  kindByInstant.set(sortedByOffset[1], 'standard');
  return {
    ok: true,
    status: 'ambiguous',
    candidates: instants.map((ms) => ({
      ...timestampResult(ms, candidates.get(ms), zone, nanos),
      kind: kindByInstant.get(ms),
      kindLabel: kindByInstant.get(ms) === 'dst' ? '夏令时' : '标准时',
    })),
  };
}
