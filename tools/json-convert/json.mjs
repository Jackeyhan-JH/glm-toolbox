/**
 * JSON 解析（严格语法，报中文错误并定位行列）。
 *
 * 不直接用 JSON.parse：V8 的报错信息不带位置（"… is not valid JSON"），
 * 无法满足「非法输入给出中文错误提示并尽量指出位置」的要求。
 * 这里按 JSON 语法（RFC 8259）手写递归下降解析器，错误一律抛 ConvertError。
 */

import { ConvertError } from './errors.mjs';

const MAX_DEPTH = 512; // 防止深层嵌套把调用栈打穿

/**
 * 解析 JSON 文本，返回 JS 值。
 * @param {string} text
 * @returns {unknown}
 * @throws {ConvertError} 输入为空或有语法错误时
 */
export function parseJson(text) {
  if (typeof text !== 'string') throw new ConvertError('JSON 解析失败：输入必须是文本');
  // 宽容处理 BOM 与结尾多余空白
  const src = text.replace(/^﻿/, '');
  const parser = new JsonParser(src);
  const value = parser.parseValue(0);
  parser.skipWhitespace();
  if (!parser.atEnd()) {
    parser.fail('顶层值之后有多余内容');
  }
  return value;
}

class JsonParser {
  constructor(src) {
    this.src = src;
    this.pos = 0;
  }

  atEnd() {
    return this.pos >= this.src.length;
  }

  peek() {
    return this.src[this.pos];
  }

  /** 跳过空白（空格、制表符、换行） */
  skipWhitespace() {
    while (!this.atEnd()) {
      const c = this.src[this.pos];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') this.pos += 1;
      else break;
    }
  }

  /** 抛出带行列号的中文错误 */
  fail(message) {
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < this.pos && i < this.src.length; i += 1) {
      if (this.src[i] === '\n') {
        line += 1;
        lineStart = i + 1;
      }
    }
    const column = this.pos - lineStart + 1;
    throw new ConvertError(`JSON 解析失败：第 ${line} 行第 ${column} 列：${message}`, { line, column });
  }

  /** 读取下一个非空白字符；若已到结尾则报「意外结束」 */
  next() {
    this.skipWhitespace();
    if (this.atEnd()) this.fail('输入不完整（意外结束，可能缺少 }、] 或值）');
    const c = this.src[this.pos];
    return c;
  }

  /** 断言下一个非空白字符是指定字符并越过它 */
  expect(ch, what) {
    const c = this.next();
    if (c !== ch) this.fail(`应为「${ch}」${what ? `（${what}）` : ''}，实际是「${c}」`);
    this.pos += 1;
  }

  parseValue(depth) {
    if (depth > MAX_DEPTH) this.fail(`嵌套层级超过 ${MAX_DEPTH}，过深`);
    const c = this.next();
    if (c === '{') return this.parseObject(depth);
    if (c === '[') return this.parseArray(depth);
    if (c === '"') return this.parseString();
    if (c === 't') return this.expectKeyword('true', true);
    if (c === 'f') return this.expectKeyword('false', false);
    if (c === 'n') return this.expectKeyword('null', null);
    if (c === '-' || (c >= '0' && c <= '9')) return this.parseNumber();
    if (c === "'" || c === '`') this.fail('字符串必须用双引号 " 包裹（JSON 不支持单引号）');
    if (c === '}') this.fail('多了「}」：可能上一行末尾多了逗号');
    if (c === ']') this.fail('多了「]」：可能上一行末尾多了逗号');
    if (c === '+') this.fail('数字前不能有「+」');
    if (c === '.') this.fail('数字必须以数字开头，不能以「.」开头');
    if (c === 'N' || c === 'I') this.fail('JSON 不支持 NaN / Infinity');
    this.fail(`意外的字符「${c}」，此处应为值`);
    return undefined; // 不可达
  }

  expectKeyword(word, value) {
    if (this.src.startsWith(word, this.pos)) {
      this.pos += word.length;
      return value;
    }
    this.fail(`应为 ${word}（注意全小写）`);
    return undefined; // 不可达
  }

  parseObject(depth) {
    this.expect('{', '对象开始');
    const result = {};
    this.skipWhitespace();
    if (this.peek() === '}') {
      this.pos += 1;
      return result;
    }
    for (;;) {
      const c = this.next();
      if (c !== '"') {
        this.fail(
          c === "'" || c === '`'
            ? '字符串必须用双引号 " 包裹（JSON 不支持单引号）'
            : `对象的键必须是双引号字符串，实际是「${c}」`,
        );
      }
      const key = this.parseString();
      this.expect(':', '键后必须有冒号');
      result[key] = this.parseValue(depth + 1); // 重复键后者覆盖，与 JSON.parse 一致
      const t = this.next();
      if (t === ',') {
        this.pos += 1;
        const after = this.next();
        if (after === '}') this.fail('多了「,」：最后一个成员后不能有逗号');
        continue;
      }
      if (t === '}') {
        this.pos += 1;
        return result;
      }
      this.fail(`应为「,」或「}」，实际是「${t}」`);
    }
  }

  parseArray(depth) {
    this.expect('[', '数组开始');
    const result = [];
    this.skipWhitespace();
    if (this.peek() === ']') {
      this.pos += 1;
      return result;
    }
    for (;;) {
      result.push(this.parseValue(depth + 1));
      const t = this.next();
      if (t === ',') {
        this.pos += 1;
        const after = this.next();
        if (after === ']') this.fail('多了「,」：最后一个元素后不能有逗号');
        continue;
      }
      if (t === ']') {
        this.pos += 1;
        return result;
      }
      this.fail(`应为「,」或「]」，实际是「${t}」`);
    }
  }

  parseString() {
    // 进入时 pos 指向开头的 "
    this.pos += 1;
    let out = '';
    for (;;) {
      if (this.atEnd()) this.fail('字符串没有闭合（缺少结尾的 "）');
      const c = this.src[this.pos];
      if (c === '"') {
        this.pos += 1;
        return out;
      }
      if (c === '\n') this.fail('字符串中不能直接换行，请用 \\n 转义');
      if (c === '\\') {
        this.pos += 1;
        if (this.atEnd()) this.fail('转义不完整（反斜杠后没有字符）');
        const e = this.src[this.pos];
        if (e === 'u') {
          const hex = this.src.slice(this.pos + 1, this.pos + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('「\\u」后必须是 4 位十六进制数');
          out += String.fromCharCode(parseInt(hex, 16));
          this.pos += 5;
          continue;
        }
        const mapped = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[e];
        if (mapped === undefined) this.fail(`非法转义「\\${e}」`);
        out += mapped;
        this.pos += 1;
        continue;
      }
      if (c < ' ' || c === '\u007f') this.fail('字符串中不能包含未转义的控制字符');
      out += c;
      this.pos += 1;
    }
  }

  parseNumber() {
    const rest = this.src.slice(this.pos);
    const m = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(rest);
    if (!m || m[0] === '' || m[0] === '-') this.fail('数字格式不合法');
    const text = m[0];
    this.pos += text.length;
    const nextCh = this.src[this.pos];
    if (nextCh !== undefined && /[0-9a-zA-Z_.+-]/.test(nextCh)) {
      this.pos += 1;
      this.fail(`数字后面不能紧跟「${nextCh}」`);
    }
    return Number(text);
  }
}
