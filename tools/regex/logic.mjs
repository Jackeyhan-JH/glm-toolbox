/**
 * 正则测试 —— 纯逻辑模块（不碰 DOM / window，node --test 直接测试）。
 *
 * 职责：
 *   - parsePatternLiteral：识别粘贴的 /pattern/flags 字面量并拆出标志；
 *   - compileRegex：编译正则，语法错误返回中文提示（附原始错误信息）；
 *   - findMatches：找出全部匹配（空匹配前进一位避免死循环，与 matchAll 语义一致），
 *     返回序号无关的匹配明细（内容、起止 UTF-16 下标、编号与命名分组）；
 *   - replaceWith：替换预览（$1、$<name>、$&、$`、$'、$$ 均为原生语义）；
 *   - run：worker 一次完整运行（匹配 + 替换）；
 *   - formatMatchesText：把匹配列表格式化为可复制的文本。
 *
 * 本模块同时被 index.mjs（主线程常量 / 格式化）与 worker.mjs（执行）加载，
 * 不得引用 DOM / window，也不得依赖当前时间或随机数。
 */

/* ---------------- 常量 ---------------- */

/** 支持的标志（d=hasIndices；v=unicodeSets，与 u 互斥，见 onFlagChange） */
export const FLAG_ITEMS = [
  { flag: 'g', desc: '全局' },
  { flag: 'i', desc: '忽略大小写' },
  { flag: 'm', desc: '多行' },
  { flag: 's', desc: '点号匹配换行' },
  { flag: 'u', desc: 'Unicode' },
  { flag: 'y', desc: '粘性' },
  { flag: 'd', desc: '分组索引' },
  { flag: 'v', desc: 'Unicode 集' },
];

/** 最多保留明细的匹配数（高亮与列表的渲染上限见下面两个常量） */
export const MAX_STORED_MATCHES = 20000;
/** 高亮视图最多渲染的匹配数（验收：超过 1 万个只高亮前 1 万个） */
export const MAX_RENDERED_HIGHLIGHTS = 10000;
/** 匹配列表最多渲染的条数（避免几万行 DOM） */
export const MAX_RENDERED_MATCH_ROWS = 200;
/** 统计匹配数的硬上限（防御性：超过即停止并标记 countedAll=false） */
export const MAX_COUNTED_MATCHES = 1000000;

/** 常用正则速查（点击填入正则框） */
export const PRESETS = [
  { name: '邮箱', source: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', flags: ['g'] },
  { name: '中国大陆手机号', source: '1[3-9]\\d{9}', flags: ['g'] },
  {
    name: 'IPv4 地址',
    source: '(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)',
    flags: ['g'],
  },
  { name: '日期 YYYY-MM-DD', source: '\\d{4}-\\d{2}-\\d{2}', flags: ['g'] },
  { name: '中文字符', source: '[\\u4e00-\\u9fa5]+', flags: ['g'] },
  { name: 'URL', source: 'https?://[^\\s]+', flags: ['g'] },
];

/* ---------------- 字面量解析 ---------------- */

/**
 * 识别粘贴的 /pattern/flags 字面量。
 * 闭合斜杠必须未转义且不在字符类内；flags 只能由 gimsuydv 组成且不重复。
 * 不是合法字面量（如 "hello"、"/foo/bar"）返回 null，整个字符串当作正则源文本。
 * @param {string} raw
 * @returns {{ source: string, flags: string[] } | null}
 */
export function parsePatternLiteral(raw) {
  if (typeof raw !== 'string' || raw.length < 2 || raw[0] !== '/') return null;
  let escaped = false;
  let inClass = false;
  for (let i = 1; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
    } else if (inClass) {
      if (ch === ']') inClass = false;
    } else if (ch === '[') {
      inClass = true;
    } else if (ch === '/') {
      const flags = raw.slice(i + 1);
      if (/^[gimsuydv]*$/.test(flags) && new Set(flags).size === flags.length) {
        return { source: raw.slice(1, i), flags: [...flags] };
      }
      return null; // 斜杠后不是合法标志 → 当作普通正则源文本
    }
  }
  return null;
}

/* ---------------- 编译 ---------------- */

/** 归并标志：接受数组或字符串，去掉非法字符与重复项，返回字符串 */
export function normalizeFlags(flags) {
  const raw = Array.isArray(flags) ? flags.join('') : String(flags ?? '');
  return [...new Set(raw.replace(/[^gimsuydv]/g, ''))].join('');
}

/**
 * 编译正则。
 * @returns {{ ok: true, regex: RegExp } | { ok: false, message: string }}
 *   语法错误时 message 为「正则语法错误：<原始信息>」。
 */
export function compileRegex(source, flags) {
  const flagString = normalizeFlags(flags);
  try {
    return { ok: true, regex: new RegExp(source, flagString) };
  } catch (err) {
    return { ok: false, message: `正则语法错误：${err instanceof Error ? err.message : String(err)}` };
  }
}

/* ---------------- 匹配 ---------------- */

/** 把一次 exec 结果整理为可结构化克隆的普通对象；分组值为 null 表示「未匹配」 */
function toMatchInfo(m) {
  const groups = [];
  for (let i = 1; i < m.length; i++) {
    groups.push({ label: String(i), kind: 'number', value: m[i] === undefined ? null : m[i] });
  }
  if (m.groups) {
    for (const [name, value] of Object.entries(m.groups)) {
      groups.push({ label: name, kind: 'name', value: value === undefined ? null : value });
    }
  }
  return { text: m[0], index: m.index, end: m.index + m[0].length, groups };
}

/**
 * 找出全部匹配。
 *   - 不带 g（且不带 y）只取第 1 个匹配；
 *   - 带 g / y 时循环 exec，空匹配时 lastIndex 前进 1，与 String#matchAll 语义一致，不会死循环；
 *   - 明细最多保留 maxStored 条，count 继续累计到 maxCounted 为止。
 * @returns {{ ok: true, matches: object[], count: number, countedAll: boolean } |
 *           { ok: false, message: string }}
 */
export function findMatches(text, source, flags, { maxStored = MAX_STORED_MATCHES, maxCounted = MAX_COUNTED_MATCHES } = {}) {
  const textString = String(text ?? '');
  const compiled = compileRegex(source, flags);
  if (!compiled.ok) return { ok: false, message: compiled.message };
  const regex = compiled.regex;

  const matches = [];
  let count = 0;
  let countedAll = true;
  const push = (m) => {
    count += 1;
    if (matches.length < maxStored) matches.push(toMatchInfo(m));
  };

  if (!regex.global && !regex.sticky) {
    const m = regex.exec(textString);
    if (m) push(m);
    return { ok: true, matches, count, countedAll };
  }

  let m;
  while ((m = regex.exec(textString)) !== null) {
    push(m);
    if (m[0] === '') regex.lastIndex += 1; // 空匹配前进一位，否则 lastIndex 原地踏步
    if (count >= maxCounted) {
      countedAll = false;
      break;
    }
  }
  return { ok: true, matches, count, countedAll };
}

/* ---------------- 替换 ---------------- */

/**
 * 替换预览。$1、$<name>、$&、$`、$'、$$ 均为原生 String#replace 语义；
 * 带 g 替换全部，否则只替换第 1 处。
 * @returns {{ ok: true, result: string } | { ok: false, message: string }}
 */
export function replaceWith(text, source, flags, replacement) {
  const compiled = compileRegex(source, flags);
  if (!compiled.ok) return { ok: false, message: compiled.message };
  try {
    return { ok: true, result: String(text ?? '').replace(compiled.regex, String(replacement ?? '')) };
  } catch (err) {
    return { ok: false, message: `替换出错：${err instanceof Error ? err.message : String(err)}` };
  }
}

/* ---------------- 一次完整运行（worker 调用） ---------------- */

/**
 * 匹配 + 替换一起算（worker 里一次往返完成）。
 * @param {{ source: string, flags: string[] | string, text: string, replacement: string }} input
 * @returns {{ ok: true, matches: object[], count: number, countedAll: boolean, replaceResult: string } |
 *           { ok: false, message: string }}
 */
export function run({ source, flags, text, replacement }) {
  const matched = findMatches(text, source, flags);
  if (!matched.ok) return matched;
  const replaced = replaceWith(text, source, flags, replacement);
  if (!replaced.ok) return replaced;
  return {
    ok: true,
    matches: matched.matches,
    count: matched.count,
    countedAll: matched.countedAll,
    replaceResult: replaced.result,
  };
}

/* ---------------- 复制格式化 ---------------- */

/**
 * 把匹配结果格式化为多行纯文本（「复制匹配列表」用）。
 * @param {{ matches: object[], count: number }} result
 * @param {number} [listLimit] 实际展示的条数（默认全部明细）
 */
export function formatMatchesText(result, listLimit = result?.matches.length ?? 0) {
  if (!result) return '（暂无匹配结果）';
  const { matches, count } = result;
  if (!count) return '（无匹配）';
  const lines = matches.slice(0, listLimit).map((m, i) => {
    const groups = m.groups
      .map((g) => `${g.label}=${g.value === null ? '未匹配' : JSON.stringify(g.value)}`)
      .join(' ');
    return `#${i + 1} ${JSON.stringify(m.text)} 位置 ${m.index}-${m.end}${groups ? ` | ${groups}` : ''}`;
  });
  if (count > listLimit) lines.push(`…… 共 ${count} 个匹配，仅列出前 ${listLimit} 条`);
  return lines.join('\n');
}
