/**
 * Cron 解析 —— 纯逻辑模块（不碰 DOM / window，node --test 直接测试）。
 *
 * 支持：
 *   - 标准 5 段（分 时 日 月 周）与可选 6 段（首段为秒）；
 *   - 语法：*、,、-、/（含 a-b/n、a/n）；月份 JAN–DEC、星期 SUN–SAT（不区分大小写）；
 *   - 星期 0 与 7 都表示周日；宏 @yearly @annually @monthly @weekly @daily @midnight @hourly；
 *   - 语义同 Vixie cron：「日」与「周」都被限定（非 *）时，两者满足其一即执行（OR）；
 *   - 夏令时：本地不存在的时刻跳过；重复出现的时刻只执行一次（取第一次）。
 *
 * 所有涉及「当前时间」的函数都允许注入 now（epoch 毫秒或 Date），保证测试确定。
 * 时区计算基于 Intl.DateTimeFormat（ICU 数据），不依赖系统本地时区。
 */

export const SEARCH_LIMIT_YEARS = 5;

const DAY_MS = 24 * 3600 * 1000;
/** 探测偏移用的窗口：任何时区的 UTC 偏移都在 ±14 小时内，±26h 足以覆盖一天用到的所有候选偏移 */
const OFFSET_PROBE_MS = 26 * 3600 * 1000;

/** 宏 → 等价的 5 段表达式（Vixie cron 约定） */
export const MACROS = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DOW_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export const WEEKDAY_NAMES = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
export const DOW_SHORT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 字段规格：显示名与（输入侧的）合法取值范围 */
const FIELD_SPECS = {
  sec: { label: '秒', min: 0, max: 59 },
  min: { label: '分钟', min: 0, max: 59 },
  hour: { label: '小时', min: 0, max: 23 },
  dom: { label: '日', min: 1, max: 31 },
  month: { label: '月', min: 1, max: 12, names: MONTH_NAMES },
  // 星期输入允许 0–7（0 与 7 都是周日），内部归一化到 0–6
  dow: { label: '星期', min: 0, max: 7, names: DOW_NAMES, wrap: 7 },
};

/** Quartz 专有字符（小写 → 规范大写）。仅在非法片段里出现时报「暂不支持」，
    避免误伤 @daily（含 l）、jul、@weekly（含 w）等合法写法 */
const QUARTZ_CHARS = new Map([
  ['?', '?'],
  ['l', 'L'],
  ['w', 'W'],
  ['#', '#'],
]);

/** 语法错误（中文消息，尽量指出出错位置） */
export class CronError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CronError';
  }
}

/* ============================================================
 * 解析
 * ============================================================ */

/** 把单个端点（数字或英文缩写）解析成数值；失败抛 CronError */
function resolvePoint(raw, spec) {
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (spec.names) {
    const idx = spec.names.indexOf(raw.toUpperCase());
    if (idx >= 0) return idx + (spec.key === 'month' ? 1 : 0);
  }
  throw new CronError(`${spec.label}字段的值无法识别：${raw}`);
}

/** 解析单个字段（如 「* / 15」「9-18」「JAN,jul」）；返回排序去重后的取值集合 */
function parseField(text, key) {
  const spec = { ...FIELD_SPECS[key], key };

  const values = new Set();
  for (const part of text.split(',')) {
    const m = part.match(/^(\*|\d+|[A-Za-z]{3})(?:-(\*|\d+|[A-Za-z]{3}))?(?:\/(\d+))?$/);
    if (!m || m[2] === '*') {
      const quartz = [...part].map((ch) => QUARTZ_CHARS.get(ch.toLowerCase())).find(Boolean);
      if (quartz !== undefined) throw new CronError(`暂不支持 Quartz 语法：${quartz}`);
      throw new CronError(`${spec.label}字段的值无法识别：${part}`);
    }

    const step = m[3] === undefined ? 1 : parseInt(m[3], 10);
    if (step === 0) throw new CronError('步长不能为 0');

    let from;
    let to;
    if (m[1] === '*') {
      from = spec.min;
      to = spec.max;
    } else {
      from = resolvePoint(m[1], spec);
      to = m[2] === undefined ? from : resolvePoint(m[2], spec);
      if (from > to) throw new CronError('范围起点不能大于终点');
    }

    for (let v = from; v <= to; v += step) {
      if (v < spec.min || v > spec.max) {
        throw new CronError(`${spec.label}字段超出范围（${spec.min}–${spec.max}）：${v}`);
      }
      values.add(spec.wrap !== undefined && v === spec.wrap ? 0 : v);
    }
  }

  const list = [...values].sort((a, b) => a - b);
  // 归一化后的范围（星期 0–6），用于判断「是否覆盖全部」
  const normMax = spec.wrap !== undefined ? 6 : spec.max;
  return {
    key,
    label: spec.label,
    text,
    values: list,
    set: new Set(list),
    min: spec.min,
    max: normMax,
    full: list.length === normMax - spec.min + 1 && list[0] === spec.min && list[list.length - 1] === normMax,
    // Vixie 语义：字段原文不是 * 就算「限定」，日与周都限定时按 OR 匹配
    restricted: text !== '*',
  };
}

/** 完整解析表达式；语法错误抛 CronError。 */
function parseOrThrow(expr) {
  const source = String(expr ?? '').trim();
  if (source === '') throw new CronError('表达式不能为空');

  let macro = null;
  let text = source;
  if (source.startsWith('@')) {
    const lower = source.toLowerCase();
    if (!(lower in MACROS)) throw new CronError(`暂不支持的宏：${source}`);
    macro = lower;
    text = MACROS[lower];
  }

  const rawFields = text.split(/\s+/);
  let order;
  if (rawFields.length === 5) {
    order = ['min', 'hour', 'dom', 'month', 'dow'];
  } else if (rawFields.length === 6) {
    order = ['sec', 'min', 'hour', 'dom', 'month', 'dow'];
  } else {
    throw new CronError('字段数量应为 5 或 6 个');
  }

  const fields = {};
  for (const key of ['sec', 'min', 'hour', 'dom', 'month', 'dow']) {
    const index = order.indexOf(key);
    // 5 段表达式没有秒字段，按固定第 0 秒处理
    fields[key] = parseField(index >= 0 ? rawFields[index] : '0', key);
  }

  return {
    source,
    macro,
    hasSeconds: order.length === 6,
    fields,
    domRestricted: fields.dom.restricted,
    dowRestricted: fields.dow.restricted,
  };
}

/** 解析表达式：成功返回 { ok: true, cron }，失败返回 { ok: false, message }（不抛错）。 */
export function parseCron(expr) {
  try {
    return { ok: true, cron: parseOrThrow(expr) };
  } catch (error) {
    if (error instanceof CronError) return { ok: false, message: error.message };
    throw error;
  }
}

/* ============================================================
 * 时区工具（全部基于 Intl，可任意注入时区）
 * ============================================================ */

/** 浏览器 / Node 的本地 IANA 时区名 */
export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function makeWallFormatter(tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new CronError(`无法识别的时区：${tz}`);
  }
}

/** 某个时刻（epoch 毫秒）在目标时区的墙钟时间与 UTC 偏移（毫秒） */
function wallOf(instant, formatter) {
  const parts = {};
  for (const { type, value } of formatter.formatToParts(instant)) {
    if (type !== 'literal') parts[type] = value;
  }
  const y = Number(parts.year);
  const mo = Number(parts.month);
  const d = Number(parts.day);
  const h = Number(parts.hour);
  const mi = Number(parts.minute);
  const s = Number(parts.second);
  const asUTC = Date.UTC(y, mo - 1, d, h, mi, s);
  return { y, mo, d, h, mi, s, offsetMs: asUTC - instant };
}

/** 墙钟时间（Date.UTC 表示的 naive epoch）对应的 UTC epoch；不存在（夏令时跳变）返回 null，重复时取第一次出现 */
function wallToInstant(wall, dayOffsets, offsetAt) {
  let best = null;
  for (const off of dayOffsets) {
    const candidate = wall - off;
    if (offsetAt(candidate) === off && (best === null || candidate < best)) best = candidate;
  }
  return best;
}

/* ============================================================
 * 未来执行时间
 * ============================================================ */

/**
 * 计算未来的执行时间。
 *
 * @param {string} expr Cron 表达式（5 段或 6 段，或 @daily 等宏）
 * @param {{ now?: number | Date, tz?: string, count?: number }} [options]
 *   now    起算时刻（默认当前时间，可注入）；返回的执行时间都严格晚于 now
 *   tz     IANA 时区（默认本地）；表达式按该时区的墙钟时间匹配
 *   count  最多返回多少个（默认 10）
 * @returns {Array<{epoch:number, year:number, month:number, day:number, hour:number,
 *                   minute:number, second:number, weekday:number, offsetMs:number}>}
 *   返回个数少于 count（尤其为 0）说明 5 年内不会再执行。
 * @throws {CronError} 表达式或时区非法
 */
export function nextRuns(expr, { now, tz, count } = {}) {
  return searchRuns(parseOrThrow(expr), { now, tz, count });
}

function searchRuns(cron, { now, tz, count } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.now();
  const zone = typeof tz === 'string' && tz !== '' ? tz : localTimeZone();
  const total = Number.isFinite(count) && count > 0 ? Math.min(Math.floor(count), 500) : 10;
  if (total === 0) return [];

  const formatter = makeWallFormatter(zone); // 非法时区在此抛 CronError
  const offsetAt = (instant) => {
    const { y, mo, d, h, mi, s } = wallOf(instant, formatter);
    return Date.UTC(y, mo - 1, d, h, mi, s) - instant;
  };

  const { sec, min, hour, dom, month, dow } = cron.fields;
  const domRes = cron.domRestricted;
  const dowRes = cron.dowRestricted;

  // 搜索上限：从 now 起 5 年
  const cutoff = nowMs + (SEARCH_LIMIT_YEARS * 366 + 2) * DAY_MS;
  const maxDays = Math.ceil((cutoff - nowMs) / DAY_MS) + 3;

  // 一天内可能出现的 UTC 偏移集合（按天缓存；夏令时跳变日会有两个）
  const offsetsByDay = new Map();
  const dayOffsets = (dayStartMs) => {
    let offsets = offsetsByDay.get(dayStartMs);
    if (!offsets) {
      const probes = new Set();
      for (const delta of [-OFFSET_PROBE_MS, 0, OFFSET_PROBE_MS, 2 * OFFSET_PROBE_MS]) {
        probes.add(offsetAt(dayStartMs + delta));
      }
      offsets = [...probes];
      offsetsByDay.set(dayStartMs, offsets);
    }
    return offsets;
  };

  const runs = [];
  const start = wallOf(nowMs, formatter);
  let cursor = Date.UTC(start.y, start.mo - 1, start.d);

  for (let i = 0; i < maxDays; i++) {
    const date = new Date(cursor);
    const y = date.getUTCFullYear();
    const mo = date.getUTCMonth() + 1;
    const d = date.getUTCDate();
    const weekday = date.getUTCDay();

    if (month.set.has(mo)) {
      // Vixie 语义：日与周都限定时取 OR，否则按各自集合匹配（未限定 = 全部）
      const dayOk =
        domRes && dowRes ? dom.set.has(d) || dow.set.has(weekday) : dom.set.has(d) && dow.set.has(weekday);
      if (dayOk) {
        const offsets = dayOffsets(cursor);
        for (const h of hour.values) {
          for (const mi of min.values) {
            for (const s of sec.values) {
              const wall = Date.UTC(y, mo - 1, d, h, mi, s);
              const instant = wallToInstant(wall, offsets, offsetAt);
              if (instant === null) continue; // 本地不存在的时刻（夏令时向前跳变）
              if (instant <= nowMs) continue; // 已过去（含夏令时回拨后的重复时刻）
              if (instant > cutoff) return runs; // 超出 5 年搜索范围
              runs.push({
                epoch: instant,
                year: y,
                month: mo,
                day: d,
                hour: h,
                minute: mi,
                second: s,
                weekday,
                offsetMs: wall - instant,
              });
              if (runs.length >= total) return runs;
            }
          }
        }
      }
    }
    cursor += DAY_MS;
  }
  return runs; // 5 年内没有（更多）执行时间
}

/* ============================================================
 * 中文描述
 * ============================================================ */

const joinNums = (values) => values.join('、');
const pad2 = (n) => String(n).padStart(2, '0');

/** 值序列是否恰好覆盖 [min, max] */
function isFullRange(values, min, max) {
  return values.length === max - min + 1 && values[0] === min && values[values.length - 1] === max;
}

/** 识别 a、a+d、…直到字段末尾 的等差序列（d ≥ 2），返回 { start, step } */
function stepPattern(values, min, max) {
  if (values.length < 2) return null;
  const step = values[1] - values[0];
  if (step < 2) return null;
  for (let i = 1; i < values.length; i++) {
    if (values[i] - values[i - 1] !== step) return null;
  }
  if (values[values.length - 1] + step <= max) return null; // 没有延伸到字段末尾，不算步长写法
  return { start: values[0], step };
}

/** 星期取值是否首尾相接成环（如 5、6、0 = 周五至周日），返回 { start, length } */
function cyclicRun(values) {
  const set = new Set(values);
  for (const start of values) {
    let ok = true;
    for (let i = 1; i < values.length; i++) {
      if (!set.has((start + i) % 7)) {
        ok = false;
        break;
      }
    }
    if (ok) return { start, length: values.length };
  }
  return null;
}

function dowPhrase(dows) {
  if (dows.length === 1) return `每${DOW_SHORT[dows[0]]}`;
  const run = cyclicRun(dows);
  if (run) return `${DOW_SHORT[run.start]}至${DOW_SHORT[(run.start + run.length - 1) % 7]}`;
  return `每${dows.map((d) => DOW_SHORT[d]).join('、')}`;
}

function domPhrase(doms) {
  return `每月 ${joinNums(doms)} 日`;
}

function monthPhrase(months) {
  return joinNums(months.map((m) => `${m} 月`));
}

function hourText(hours) {
  if (hours.length === 1) return `${hours[0]} 点`;
  if (hours[hours.length - 1] - hours[0] + 1 === hours.length) {
    return `${hours[0]} 点至 ${hours[hours.length - 1]} 点`;
  }
  return `${joinNums(hours)} 点`;
}

/** 分 / 时 / 秒部分的描述 */
function timePhrase(minutes, hours, seconds, hasSeconds) {
  const minFull = isFullRange(minutes, 0, 59);
  const hourFull = isFullRange(hours, 0, 23);
  // 秒覆盖全部、或固定为第 0 秒（含 5 段表达式的隐式秒）时，按分钟精度描述
  const secOmitted =
    !hasSeconds || isFullRange(seconds, 0, 59) || (seconds.length === 1 && seconds[0] === 0);

  let main;
  const minStep = stepPattern(minutes, 0, 59);
  if (minFull && hourFull) {
    main = '每分钟';
  } else if (minStep) {
    const minPart = minStep.start === 0 ? `每 ${minStep.step} 分钟` : `从第 ${minStep.start} 分钟起每 ${minStep.step} 分钟`;
    main = hourFull ? minPart : `${hourText(hours)}，${minPart}`;
  } else if (minutes.length === 1 && hours.length === 1) {
    main = `${pad2(hours[0])}:${pad2(minutes[0])}`;
  } else if (minutes.length === 1) {
    main = hourFull ? `每小时的 ${pad2(minutes[0])} 分` : `${hourText(hours)}的每小时 ${pad2(minutes[0])} 分`;
  } else if (hourFull) {
    main = `${joinNums(minutes)} 分`;
  } else {
    main = `${hourText(hours)}的 ${joinNums(minutes)} 分`;
  }

  if (secOmitted) return main;

  if (main === '每分钟') {
    const secStep = stepPattern(seconds, 0, 59);
    if (secStep) {
      return secStep.start === 0 ? `每 ${secStep.step} 秒` : `从第 ${secStep.start} 秒起每 ${secStep.step} 秒`;
    }
    if (seconds.length === 1) return `每分钟的第 ${seconds[0]} 秒`;
    return `每分钟的第 ${joinNums(seconds)} 秒`;
  }
  if (/^\d{2}:\d{2}$/.test(main) && seconds.length === 1) {
    return `${main}:${pad2(seconds[0])}`; // 单一时刻 + 单一秒 → HH:MM:SS
  }
  const secStep = stepPattern(seconds, 0, 59);
  let secPart;
  if (secStep) {
    secPart = secStep.start === 0 ? `每 ${secStep.step} 秒` : `从第 ${secStep.start} 秒起每 ${secStep.step} 秒`;
  } else if (seconds.length === 1) {
    secPart = `第 ${seconds[0]} 秒`;
  } else {
    secPart = `第 ${joinNums(seconds)} 秒`;
  }
  return `${main}，${secPart}`;
}

/** 生成中文描述，如「周一至周五，9 点至 18 点，每 15 分钟」 */
export function describeCron(cron) {
  const { fields, hasSeconds } = cron;
  const months = fields.month.values;
  const doms = fields.dom.values;
  const dows = fields.dow.values;
  const monthRes = !fields.month.full;
  const domRes = cron.domRestricted;
  const dowRes = cron.dowRestricted;

  const segments = [];
  let daySeg;

  if (domRes && dowRes) {
    if (monthRes) segments.push(monthPhrase(months));
    daySeg = `${domPhrase(doms)}或${dowPhrase(dows)}`;
  } else if (domRes) {
    if (monthRes && months.length === 1) {
      daySeg = `${months[0]} 月 ${joinNums(doms)} 日`; // 如「1 月 1 日」
    } else {
      if (monthRes) segments.push(monthPhrase(months));
      daySeg = domPhrase(doms);
    }
  } else if (dowRes) {
    if (monthRes) segments.push(monthPhrase(months));
    daySeg = dowPhrase(dows);
  } else {
    daySeg = '每天';
    if (monthRes) daySeg = `${monthPhrase(months)}的每天`;
  }
  segments.push(daySeg);
  const head = segments.join('，');

  const phrase = timePhrase(fields.min.values, fields.hour.values, fields.sec.values, hasSeconds);
  const plainClock = /^\d{2}:\d{2}(:\d{2})?$/.test(phrase);
  if (head === '每天') return plainClock ? `每天 ${phrase}` : phrase;
  return plainClock ? `${head} ${phrase}` : `${head}，${phrase}`;
}

/* ============================================================
 * 逐段解释
 * ============================================================ */

/** 取值列表的展示文本：全覆盖 → 「0–59 全部」，连续段（≥3）压缩成 a–b */
function formatValues(field) {
  if (field.full) return `${field.min}–${field.max} 全部`;
  const parts = [];
  let start = field.values[0];
  let prev = start;
  for (let i = 1; i <= field.values.length; i++) {
    const v = field.values[i];
    if (v !== prev + 1) {
      if (prev - start >= 2) parts.push(`${start}–${prev}`);
      else if (prev - start === 1) parts.push(`${start}、${prev}`);
      else parts.push(`${start}`);
      start = v;
    }
    prev = v;
  }
  return parts.join('、');
}

/** 逐段解释表：每个字段的原文与展开后的取值（秒行只在 6 段表达式时出现） */
export function explainCron(cron) {
  const order = cron.hasSeconds
    ? ['sec', 'min', 'hour', 'dom', 'month', 'dow']
    : ['min', 'hour', 'dom', 'month', 'dow'];
  return order.map((key) => {
    const field = cron.fields[key];
    return { key, label: field.label, source: field.text, values: formatValues(field) };
  });
}

/* ============================================================
 * 展示格式化
 * ============================================================ */

/** 单次执行时间的展示文本：`YYYY-MM-DD HH:mm(:ss) 星期X` */
export function formatRunTime(run, { withSeconds = false } = {}) {
  const date = `${run.year}-${pad2(run.month)}-${pad2(run.day)}`;
  const time = withSeconds
    ? `${pad2(run.hour)}:${pad2(run.minute)}:${pad2(run.second)}`
    : `${pad2(run.hour)}:${pad2(run.minute)}`;
  return `${date} ${time} ${WEEKDAY_NAMES[run.weekday]}`;
}

/** UTC 偏移展示：`UTC+08:00` / `UTC-04:00` */
export function formatOffset(offsetMs) {
  const sign = offsetMs < 0 ? '-' : '+';
  const abs = Math.abs(offsetMs);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  return `UTC${sign}${pad2(h)}:${pad2(m)}`;
}

const DURATION_UNITS = [
  ['年', 31557600],
  ['个月', 2629800],
  ['天', 86400],
  ['小时', 3600],
  ['分钟', 60],
  ['秒', 1],
];

/** 时长的人话描述（取最大的两个非零单位），如「1 天 12 小时后」 */
export function humanizeDuration(ms) {
  if (ms > 0 && ms < 1000) return '不足 1 秒后';
  let rest = Math.floor(ms / 1000);
  const parts = [];
  for (const [name, size] of DURATION_UNITS) {
    if (rest >= size) {
      parts.push(`${Math.floor(rest / size)} ${name}`);
      rest %= size;
      if (parts.length === 2) break;
    }
  }
  return parts.length > 0 ? `${parts.join(' ')}后` : '马上';
}

/* ============================================================
 * 一站式入口（UI 用）
 * ============================================================ */

/**
 * 解析 + 描述 + 解释 + 未来时间，一次算齐。
 * @returns {{ ok:false, message:string } | { ok:true, cron, description, fields, runs, hasSeconds, macro, expanded }}
 */
export function analyze(expr, { now, tz, count } = {}) {
  let cron;
  try {
    cron = parseOrThrow(expr);
  } catch (error) {
    if (error instanceof CronError) return { ok: false, message: error.message };
    throw error;
  }
  let runs;
  try {
    runs = searchRuns(cron, { now, tz, count });
  } catch (error) {
    if (error instanceof CronError) return { ok: false, message: error.message };
    throw error;
  }
  return {
    ok: true,
    cron,
    description: describeCron(cron),
    fields: explainCron(cron),
    runs,
    hasSeconds: cron.hasSeconds,
    macro: cron.macro,
    expanded: cron.macro ? MACROS[cron.macro] : null,
  };
}
