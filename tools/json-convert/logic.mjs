/**
 * JSON 转换 —— 纯逻辑入口（不碰 DOM / window，node --test 直接测试）。
 *
 * 四种模式：JSON → YAML、YAML → JSON、JSON → CSV、CSV → JSON。
 * 具体实现拆在同目录的几个模块里，这里做编排并统一导出：
 *   json.mjs  JSON 解析（严格语法、中文错误带行列号）
 *   yaml.mjs  YAML 子集解析与序列化
 *   csv.mjs   CSV 读写（RFC 4180）
 */

import { ConvertError } from './errors.mjs';
import { parseJson } from './json.mjs';
import {
  parseYaml,
  stringifyYaml,
  resolvePlain,
  plainNeedsQuote,
  scanQuoted,
} from './yaml.mjs';
import { parseCsv, stringifyCsv, detectDelimiter, delimiterChar, CSV_DELIMITERS } from './csv.mjs';

export { ConvertError, parseJson, parseYaml, stringifyYaml, parseCsv, stringifyCsv };
export { resolvePlain, plainNeedsQuote, scanQuoted, detectDelimiter, delimiterChar, CSV_DELIMITERS };

/* ==================== 模式 ==================== */

/** 模式列表（UI 分段切换与反转映射共用；swapMode 为「交换」按钮的反转方向） */
export const MODES = [
  { id: 'json-yaml', label: 'JSON → YAML', swap: 'yaml-json' },
  { id: 'yaml-json', label: 'YAML → JSON', swap: 'json-yaml' },
  { id: 'json-csv', label: 'JSON → CSV', swap: 'csv-json' },
  { id: 'csv-json', label: 'CSV → JSON', swap: 'json-csv' },
];

export function modeLabel(id) {
  return MODES.find((m) => m.id === id)?.label ?? id;
}

export function swapMode(id) {
  return MODES.find((m) => m.id === id)?.swap ?? id;
}

/* ==================== JSON 可表示性 ==================== */

/** YAML 的 .inf / .nan 无法用 JSON 表示，提前给出中文错误 */
function assertJsonable(value, path) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new ConvertError(`${path}的值「${value}」无法用 JSON 表示（YAML 的 .inf / .nan 超出 JSON 范围）`);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) assertJsonable(value[i], `${path}[${i}]`);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) assertJsonable(v, `${path}.${k}`);
  }
}

/* ==================== 转换入口 ==================== */

/**
 * @typedef {Object} ConvertOptions
 * @property {'comma'|'semicolon'|'tab'|'auto'} [csvDelimiter] CSV 分隔符，默认 auto
 * @property {boolean} [csvAutoDetect] CSV → JSON 自动识别数字和布尔，默认 true
 */

/**
 * 执行一次转换。
 * @param {string} mode 模式 id（见 MODES）
 * @param {string} input 输入文本
 * @param {ConvertOptions} [options]
 * @returns {{ output: string, notice: string }} notice 为给用户的提示（如多文档），可为空串
 * @throws {ConvertError} 输入有语法错误或结构不符合要求时
 */
export function convert(mode, input, options = {}) {
  if (typeof input !== 'string') throw new ConvertError('输入必须是文本');
  if (input.trim() === '') return { output: '', notice: '' };
  const { csvDelimiter = 'auto', csvAutoDetect = true } = options;

  switch (mode) {
    case 'json-yaml': {
      const value = parseJson(input);
      return { output: stringifyYaml(value), notice: '' };
    }
    case 'yaml-json': {
      const { value, docs } = parseYaml(input);
      assertJsonable(value, '根节点');
      const notice =
        docs > 1 ? `检测到 ${docs} 个 YAML 文档（以 --- 分隔），已合并为 JSON 数组` : '';
      return { output: `${JSON.stringify(value, null, 2)}\n`, notice };
    }
    case 'json-csv': {
      const value = parseJson(input);
      const delim = csvDelimiter === 'auto' ? ',' : delimiterChar(csvDelimiter); // 输出方向「自动」按逗号
      return { output: stringifyCsv(value, { delimiter: delim }), notice: '' };
    }
    case 'csv-json': {
      const { rows, delimiter, extraRows } = parseCsv(input, {
        delimiter: csvDelimiter,
        autoDetect: csvAutoDetect,
      });
      const notices = [];
      if (csvDelimiter === 'auto' && rows.length > 0) {
        notices.push(
          `已自动识别分隔符：${delimiter === '\t' ? '制表符' : delimiter === ';' ? '分号 ;' : '逗号 ,'}`,
        );
      }
      if (extraRows > 0) {
        notices.push(`有 ${extraRows} 行的列数比表头多，多出的列已忽略`);
      }
      return { output: `${JSON.stringify(rows, null, 2)}\n`, notice: notices.join('；') };
    }
    default:
      throw new ConvertError(`未知模式：${mode}`);
  }
}

/** 下载文件名（按模式给扩展名） */
export function downloadName(mode) {
  switch (mode) {
    case 'json-yaml':
      return 'json-convert.yaml';
    case 'json-csv':
      return 'json-convert.csv';
    default:
      return 'json-convert.json';
  }
}
