/**
 * CSV 读写（RFC 4180 子集，报中文错误并定位行号）。
 *
 * stringifyCsv：对象数组 → CSV。表头为所有对象键的并集（按首次出现顺序）；
 *   含分隔符 / 双引号 / 换行的值加引号，内部双引号写成两个；
 *   嵌套对象 / 数组写成 JSON 字符串；null / 缺失写成空。
 * parseCsv：CSV → 对象数组。第一行为表头；支持引号内的分隔符与换行、CRLF / LF；
 *   分隔符可选（逗号 / 制表符 / 分号 / 自动识别）；可自动识别数字与布尔。
 */

import { ConvertError, atPosition } from './errors.mjs';

/** 分隔符选项（UI 下拉与逻辑共用） */
export const CSV_DELIMITERS = [
  { id: 'comma', label: '逗号（,）', char: ',' },
  { id: 'semicolon', label: '分号（;）', char: ';' },
  { id: 'tab', label: '制表符（Tab）', char: '\t' },
  { id: 'auto', label: '自动识别', char: ',' }, // 输出方向没有「识别」一说，自动 → 逗号
];

export function delimiterChar(id) {
  return (CSV_DELIMITERS.find((d) => d.id === id) ?? CSV_DELIMITERS[0]).char;
}

/* ==================== JSON → CSV ==================== */

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 单元格 → 文本（嵌套对象 / 数组序列化为 JSON 字符串） */
function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** 按需加引号：包含分隔符、双引号或换行时整个字段用 "..." 包裹，内部 " 写成两个 */
function escapeCell(text, delim) {
  if (text.includes(delim) || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * 对象数组 → CSV 文本（行尾 CRLF，符合 RFC 4180，Excel 友好）。
 * @param {unknown} value
 * @param {{ delimiter?: string }} [options] delimiter 为分隔符字符本身
 * @returns {string}
 */
export function stringifyCsv(value, { delimiter = ',' } = {}) {
  if (!Array.isArray(value)) {
    throw new ConvertError(
      isPlainObject(value)
        ? 'CSV 转换需要对象数组：当前输入是一个对象，请改成 [ { … } ] 形式的数组'
        : 'CSV 转换需要对象数组：当前输入不是数组',
    );
  }
  for (const item of value) {
    if (!isPlainObject(item)) {
      throw new ConvertError('CSV 转换需要对象数组：数组里混有非对象元素（如数字、字符串或嵌套数组）');
    }
  }
  if (value.length === 0) return '';

  // 表头：所有对象键的并集，按首次出现顺序
  const keys = [];
  const seen = new Set();
  for (const item of value) {
    for (const key of Object.keys(item)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }

  const lines = [
    keys.map((k) => escapeCell(k, delimiter)).join(delimiter),
    ...value.map((item) => keys.map((k) => escapeCell(cellText(item[k]), delimiter)).join(delimiter)),
  ];
  return lines.join('\r\n');
}

/* ==================== CSV → JSON ==================== */

/** 在第一个非空行里数候选分隔符（引号内不算），选出现最多的；平手按 逗号 > 分号 > Tab */
export function detectDelimiter(text) {
  const firstLine = text.split(/\r\n|\r|\n/, 1)[0] ?? '';
  let line = '';
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes) line += ch;
  }
  let best = ',';
  let bestCount = 0;
  for (const cand of [',', ';', '\t']) {
    const count = line.split(cand).length - 1;
    if (count > bestCount) {
      best = cand;
      bestCount = count;
    }
  }
  return best;
}

/**
 * @typedef {Object} CsvParseOptions
 * @property {'comma'|'semicolon'|'tab'|'auto'} [delimiter] 分隔符选项，默认 auto
 * @property {boolean} [autoDetect] 自动识别数字和布尔（默认 true）
 */

/**
 * CSV 文本 → 对象数组。
 * @param {string} text
 * @param {CsvParseOptions} [options]
 * @returns {{ rows: object[], delimiter: string }} delimiter 为实际使用的分隔符字符
 */
export function parseCsv(text, { delimiter = 'auto', autoDetect = true } = {}) {
  const src = text.replace(/^﻿/, ''); // 去掉 Excel 常见的 BOM
  const delim = delimiter === 'auto' ? detectDelimiter(src) : delimiterChar(delimiter);
  const rows = scanRows(src, delim);
  if (rows.length === 0) return { rows: [], delimiter: delim };

  const headers = dedupeHeaders(rows[0]);
  const out = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const obj = {};
    for (let c = 0; c < headers.length; c += 1) {
      const raw = c < row.length ? row[c] : '';
      obj[headers[c]] = autoDetect ? typedValue(raw) : raw;
    }
    out.push(obj);
  }
  return { rows: out, delimiter: delim };
}

/** 逐字符扫描出二维字段数组（RFC 4180：引号内的分隔符 / 换行属于字段内容） */
function scanRows(src, delim) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let line = 1; // 当前物理行号（引号内换行也计入）
  let i = 0;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (c === '\r' && src[i + 1] === '\n') {
        field += '\n';
        line += 1;
        i += 2;
        continue;
      }
      if (c === '\n' || c === '\r') {
        field += '\n';
        line += 1;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field === '') {
      inQuotes = true; // 引号只作为字段的开头才生效
      i += 1;
      continue;
    }
    if (c === delim) {
      endField();
      i += 1;
      continue;
    }
    if (c === '\r' && src[i + 1] === '\n') {
      endRow();
      line += 1;
      i += 2;
      continue;
    }
    if (c === '\n' || c === '\r') {
      endRow();
      line += 1;
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }

  if (inQuotes) throw atPosition('引号未闭合（缺少结束引号）', line);
  if (field !== '' || row.length > 0) endRow(); // 结尾没有换行时的最后一个字段 / 行
  return rows;
}

/** 表头重复时后者加 _2、_3 … 后缀（与已有表头不冲突为止） */
function dedupeHeaders(headers) {
  const used = new Set();
  const result = [];
  for (const header of headers) {
    let name = header;
    if (used.has(name)) {
      let n = 2;
      while (used.has(`${header}_${n}`)) n += 1;
      name = `${header}_${n}`;
    }
    used.add(name);
    result.push(name);
  }
  return result;
}

const INT_RE = /^-?\d+$/;
const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const BOOL_RE = /^(true|false)$/i;

/** 「自动识别数字和布尔」：空值保持空字符串，其余按内容识别 */
function typedValue(raw) {
  if (raw === '') return '';
  if (INT_RE.test(raw) || FLOAT_RE.test(raw)) return Number(raw);
  if (BOOL_RE.test(raw)) return raw.toLowerCase() === 'true';
  return raw;
}
