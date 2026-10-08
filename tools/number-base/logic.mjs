/**
 * 进制转换与位运算 —— 纯逻辑模块（不碰 DOM / window，node --test 直接测试）。
 *
 * 全部使用 BigInt，任意精度。提供的纯函数：
 *   parseNumber        解析任意进制文本（自动识别 0x / 0o / 0b 前缀，忽略 _ 空格 , 分隔符，负数 - 前缀）
 *   formatNumber       格式化为任意进制文本（二进制按 4 位、十六进制按 2 位分组，可关闭；字母大小写可选）
 *   groupDigits        从右往左每 size 位插入空格
 *   complementView     补码视图：按位宽给出补码二进制与有符号 / 无符号解释，超范围给出中文提示
 *   bitwise            位运算（AND / OR / XOR / NOT / << / >> / >>>），在指定位宽下按补码计算
 *   evaluateOperation  文本级封装（UI 直接调用：解析两个操作数、校验移位量、调用 bitwise）
 *   toggleBit          位网格点击翻转某一位（翻转后按有符号解释返回新值）
 */

export const BASE_MIN = 2;
export const BASE_MAX = 36;
export const WIDTHS = [8, 16, 32, 64];
export const BASE_RANGE_ERROR = '进制范围为 2–36';

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const DIGIT_VALUE = new Map();
for (let i = 0; i < DIGITS.length; i += 1) DIGIT_VALUE.set(DIGITS[i], i);

/** 前缀 → 基数（小写匹配，输入整体转小写后识别） */
const PREFIX_BASES = [
  ['0x', 16],
  ['0o', 8],
  ['0b', 2],
];

/** 进制的中文称呼（错误信息用） */
export function baseName(base) {
  if (base === 2) return '二进制';
  if (base === 8) return '八进制';
  if (base === 10) return '十进制';
  if (base === 16) return '十六进制';
  return `${base} 进制`;
}

/** 校验基数：合法返回 null，否则返回中文错误信息 */
export function validateBase(base) {
  return Number.isInteger(base) && base >= BASE_MIN && base <= BASE_MAX ? null : BASE_RANGE_ERROR;
}

/**
 * 解析数字文本。
 * 规则：
 *   - 忽略空格、下划线 _ 与逗号 ,（如 1,000,000、0b1010_1010）；
 *   - 负数用 - 前缀（也接受 +）；
 *   - 出现 0x / 0o / 0b 前缀时以前缀为准（任一进制框内都可输入）；
 *   - 逐字符校验，遇到第一个非法字符即返回「「x」不是合法的N进制数字」。
 * @param {string} text
 * @param {number} base 2–36
 * @returns {{status:'empty'}} | {{status:'ok', value: bigint}} | {{status:'error', message: string}}
 */
export function parseNumber(text, base) {
  const baseError = validateBase(base);
  if (baseError) return { status: 'error', message: baseError };

  let s = String(text ?? '').toLowerCase().replace(/[\s_,]/g, '');
  if (s === '') return { status: 'empty' };

  let negative = false;
  if (s[0] === '+' || s[0] === '-') {
    negative = s[0] === '-';
    s = s.slice(1);
    if (s === '') return { status: 'error', message: negative ? '「-」后缺少数字' : '「+」后缺少数字' };
  }

  let usedBase = base;
  let usedName = baseName(base);
  for (const [prefix, prefixBase] of PREFIX_BASES) {
    // s.length > 2 保证前缀后至少还有一位数字，纯「0x」不当作前缀
    if (s.length > 2 && s.slice(0, 2) === prefix) {
      usedBase = prefixBase;
      usedName = baseName(prefixBase);
      s = s.slice(2);
      break;
    }
  }

  let value = 0n;
  const bigBase = BigInt(usedBase);
  for (const ch of s) {
    const digit = DIGIT_VALUE.get(ch);
    if (digit === undefined || digit >= usedBase) {
      return { status: 'error', message: `「${ch}」不是合法的${usedName}数字` };
    }
    value = value * bigBase + BigInt(digit);
  }
  return { status: 'ok', value: negative ? -value : value };
}

/** 从右往左每 size 位插入一个空格（size ≤ 1 或不足一组时原样返回） */
export function groupDigits(digits, size) {
  if (!Number.isInteger(size) || size <= 1 || digits.length <= size) return digits;
  const parts = [];
  for (let end = digits.length; end > 0; end -= size) {
    parts.unshift(digits.slice(Math.max(0, end - size), end));
  }
  return parts.join(' ');
}

/** 各进制的分组宽度：二进制 4 位、十六进制 2 位，其余不分组 */
export function groupSizeForBase(base) {
  if (base === 2) return 4;
  if (base === 16) return 2;
  return 0;
}

/**
 * BigInt → 任意进制文本（负数带 - 前缀）。
 * @param {bigint} value
 * @param {number} base 2–36
 * @param {{ upper?: boolean, group?: boolean }} [options] upper：字母大写（默认 true）；group：按进制分组（默认 true）
 */
export function formatNumber(value, base, { upper = true, group = true } = {}) {
  if (validateBase(base)) return '';
  if (typeof value !== 'bigint') return '';
  const sign = value < 0n ? '-' : '';
  let digits = (value < 0n ? -value : value).toString(base);
  if (base > 10 && upper) digits = digits.toUpperCase();
  if (group) digits = groupDigits(digits, groupSizeForBase(base));
  return sign + digits;
}

/* ---------------- 补码 ---------------- */

function maskFor(width) {
  return 1n << BigInt(width);
}

/** 任意 BigInt 在指定位宽下的补码位型（始终落在 [0, 2^width)） */
export function toPattern(value, width) {
  const m = maskFor(width);
  return ((value % m) + m) % m;
}

/** 位型的有符号（补码）解释 */
export function signedValue(pattern, width) {
  const m = maskFor(width);
  return pattern >= m >> 1n ? pattern - m : pattern;
}

/**
 * 补码视图。
 * @param {bigint} value
 * @param {number} width 8 / 16 / 32 / 64
 * @returns {{ width, pattern, bits, unsigned, signed, range: 'fit'|'signed-overflow'|'overflow', message }}
 *   bits     补码二进制（固定位宽，不足补 0，未分组）
 *   range    fit：在有符号范围内；signed-overflow：超出有符号范围但在无符号范围内；
 *            overflow：完全超出位宽范围（按低位截断，如 256 在 8 位 → 0）
 */
export function complementView(value, width) {
  const m = maskFor(width);
  const half = m >> 1n;
  const pattern = ((value % m) + m) % m;
  let range = 'fit';
  let message = '';
  if (value >= -half && value < half) {
    range = 'fit';
  } else if (value >= 0n && value < m) {
    range = 'signed-overflow';
    message = `超出 ${width} 位有符号范围（${-half} – ${half - 1n}），无符号值为 ${pattern}`;
  } else {
    range = 'overflow';
    message = `超出 ${width} 位范围，截断为 ${pattern}`;
  }
  return {
    width,
    pattern,
    bits: pattern.toString(2).padStart(width, '0'),
    unsigned: pattern,
    signed: signedValue(pattern, width),
    range,
    message,
  };
}

/* ---------------- 位运算 ---------------- */

/** 运算列表（id / 中文标签 / 是否单目 / 是否移位） */
export const OPERATIONS = [
  { id: 'AND', label: 'AND（按位与）', unary: false, shift: false },
  { id: 'OR', label: 'OR（按位或）', unary: false, shift: false },
  { id: 'XOR', label: 'XOR（按位异或）', unary: false, shift: false },
  { id: 'NOT', label: 'NOT（按位取反）', unary: true, shift: false },
  { id: 'SHL', label: '<<（左移）', unary: false, shift: true },
  { id: 'SAR', label: '>>（算术右移）', unary: false, shift: true },
  { id: 'SHR', label: '>>>（逻辑右移）', unary: false, shift: true },
];

/** 移位量越界的中文提示（actual 省略时不含「当前为 …」） */
export function shiftRangeMessage(width, actual) {
  const head = `移位量须为 0 到 ${width - 1} 之间的整数`;
  return actual === undefined ? head : `${head}，当前为 ${actual}`;
}

/**
 * 位运算。操作数先按补码截断到指定位宽（超范围时给出 warning），再在位型上计算：
 *   AND / OR / XOR：按位与 / 或 / 异或
 *   NOT（单目）：按位取反
 *   <<：左移，高位移出
 *   >>：算术右移（补符号位）
 *   >>>：逻辑右移（补 0）
 * @returns {{status:'ok', width, pattern, bits, unsigned, signed, warnings: string[]}}
 *          | {{status:'error', message: string}}
 */
export function bitwise({ a, b = 0n, op, width }) {
  const def = OPERATIONS.find((o) => o.id === op);
  if (!def) return { status: 'error', message: `未知运算：${op}` };
  if (!WIDTHS.includes(width)) return { status: 'error', message: '位宽必须是 8 / 16 / 32 / 64 位' };
  if (typeof a !== 'bigint') return { status: 'error', message: '操作数 A 无效' };

  const m = maskFor(width);
  const fits = (v) => (v >= 0n && v < m) || (v >= -(m >> 1n) && v < m >> 1n);
  const warnings = [];
  const pa = toPattern(a, width);
  if (!fits(a)) warnings.push(`操作数 A 超出 ${width} 位范围，已按补码截断为 ${pa}`);

  let pattern;
  if (def.unary) {
    pattern = toPattern(~a, width);
  } else if (!def.shift) {
    if (typeof b !== 'bigint') return { status: 'error', message: '操作数 B 无效' };
    const pb = toPattern(b, width);
    if (!fits(b)) warnings.push(`操作数 B 超出 ${width} 位范围，已按补码截断为 ${pb}`);
    pattern = def.id === 'AND' ? pa & pb : def.id === 'OR' ? pa | pb : pa ^ pb;
  } else {
    if (typeof b !== 'bigint') return { status: 'error', message: '移位量无效' };
    if (b < 0n || b >= BigInt(width)) return { status: 'error', message: shiftRangeMessage(width, b) };
    if (def.id === 'SHL') {
      pattern = toPattern(a << b, width);
    } else if (def.id === 'SAR') {
      pattern = toPattern(signedValue(pa, width) >> b, width);
    } else {
      pattern = pa >> b; // 逻辑右移：位型本身非负，BigInt >> 即补 0
    }
  }

  return {
    status: 'ok',
    width,
    pattern,
    bits: pattern.toString(2), // 不补前导 0，与「0b1100 AND 0b1010 = 1000」的直觉一致
    unsigned: pattern,
    signed: signedValue(pattern, width),
    warnings,
  };
}

/**
 * 文本级封装（UI 直接调用）：解析操作数文本（十进制 + 0x / 0o / 0b 前缀）、
 * 校验移位量并计算。
 * @param {{ aText: string, bText: string, opId: string, width: number }} input
 * @returns 同 bitwise；任一必需操作数为空时返回 {status:'empty'}（结果留空，不算错误）
 */
export function evaluateOperation({ aText, bText, opId, width }) {
  const def = OPERATIONS.find((o) => o.id === opId);
  if (!def) return { status: 'error', message: `未知运算：${opId}` };

  const a = parseNumber(aText, 10);
  if (a.status === 'empty') return { status: 'empty' };
  if (a.status === 'error') return { status: 'error', message: `操作数 A：${a.message}` };

  let bValue = 0n;
  if (!def.unary) {
    const b = parseNumber(bText, 10);
    if (b.status === 'empty') return { status: 'empty' };
    if (b.status === 'error') {
      const field = def.shift ? '移位量' : '操作数 B';
      return { status: 'error', message: `${field}：${b.message}` };
    }
    if (def.shift && (b.value < 0n || b.value >= BigInt(width))) {
      return { status: 'error', message: shiftRangeMessage(width, b.value) };
    }
    bValue = b.value;
  }
  return bitwise({ a: a.value, b: bValue, op: opId, width });
}

/**
 * 位网格：在指定位宽下翻转第 bit 位，返回新值。
 * 位网格编辑的是补码位型，翻转后按有符号解释回写（如 8 位下第 7 位置 1 → -128）。
 */
export function toggleBit(value, bit, width) {
  const pattern = toPattern(value, width) ^ (1n << BigInt(bit));
  return signedValue(pattern, width);
}
