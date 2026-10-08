/** 进制转换与位运算纯逻辑的单元测试（node --test 自动发现，对应 issue #22 验收标准） */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_RANGE_ERROR,
  OPERATIONS,
  bitwise,
  complementView,
  evaluateOperation,
  formatNumber,
  groupDigits,
  parseNumber,
  toggleBit,
  validateBase,
} from './logic.mjs';

/* ==================== 进制转换 ==================== */

test('255（十进制）→ 二进制 11111111、八进制 377、十六进制 FF、36 进制 73', () => {
  const { status, value } = parseNumber('255', 10);
  assert.equal(status, 'ok');
  assert.equal(value, 255n);
  assert.equal(formatNumber(value, 2, { group: false }), '11111111');
  assert.equal(formatNumber(value, 8, { group: false }), '377');
  assert.equal(formatNumber(value, 16, { group: false }), 'FF');
  assert.equal(formatNumber(value, 36, { group: false }), '73');
});

test('分组显示：二进制按 4 位、十六进制按 2 位，可关闭', () => {
  assert.equal(formatNumber(255n, 2, { group: true }), '1111 1111');
  assert.equal(formatNumber(255n, 16, { group: true }), 'FF');
  assert.equal(formatNumber(0xf4240n, 16, { group: true }), 'F 42 40');
  assert.equal(formatNumber(0xf4240n, 16, { group: false }), 'F4240');
  assert.equal(formatNumber(0xf4240n, 2, { group: true }), '1111 0100 0010 0100 0000');
  // 八进制 / 十进制 / 自定义进制不分组
  assert.equal(formatNumber(255n, 8, { group: true }), '377');
  assert.equal(formatNumber(1_000_000n, 10, { group: true }), '1000000');
  assert.equal(formatNumber(1234n, 36, { group: true }), 'YA');
});

test('groupDigits：从右往左分组，不足一组原样返回', () => {
  assert.equal(groupDigits('11111111', 4), '1111 1111');
  assert.equal(groupDigits('FF', 2), 'FF');
  assert.equal(groupDigits('F4240', 2), 'F 42 40');
  assert.equal(groupDigits('1000', 4), '1000');
  assert.equal(groupDigits('12345', 3), '12 345');
  assert.equal(groupDigits('110', 0), '110');
});

test('前缀：0x1F → 31；0b1010_1010 → 170；0o777 → 511（在任一进制框内输入均可）', () => {
  assert.equal(parseNumber('0x1F', 10).value, 31n);
  assert.equal(parseNumber('0X1f', 10).value, 31n);
  assert.equal(parseNumber('0b1010_1010', 10).value, 170n);
  assert.equal(parseNumber('0o777', 10).value, 511n);
  // 前缀在「别的进制」框里也生效
  assert.equal(parseNumber('0x1F', 2).value, 31n);
  assert.equal(parseNumber('0b1010', 16).value, 10n);
  assert.equal(parseNumber('0o17', 16).value, 15n);
  // 前缀与分隔符、符号组合
  assert.equal(parseNumber('-0x_FF', 10).value, -255n);
  assert.equal(parseNumber(' 0x ff ', 10).value, 255n);
});

test('分隔符：1,000,000 → 十六进制 F4240', () => {
  const { status, value } = parseNumber('1,000,000', 10);
  assert.equal(status, 'ok');
  assert.equal(value, 1_000_000n);
  assert.equal(formatNumber(value, 16), 'F 42 40');
  assert.equal(formatNumber(value, 16, { group: false }), 'F4240');
});

test('大数：12345678901234567890 → 十六进制 AB54A98CEB1F0AD2，2–36 进制往返不丢精度', () => {
  const value = 12345678901234567890n;
  assert.equal(parseNumber('12345678901234567890', 10).value, value);
  assert.equal(formatNumber(value, 16, { group: false }), 'AB54A98CEB1F0AD2');
  for (let base = 2; base <= 36; base += 1) {
    const text = formatNumber(value, base, { group: false });
    const back = parseNumber(text, base);
    assert.equal(back.status, 'ok', `base ${base}`);
    assert.equal(back.value, value, `base ${base} 往返不一致`);
  }
});

test('负数：-255 → 十六进制 -FF', () => {
  const { status, value } = parseNumber('-255', 10);
  assert.equal(status, 'ok');
  assert.equal(value, -255n);
  assert.equal(formatNumber(value, 16, { group: false }), '-FF');
  assert.equal(formatNumber(value, 2, { group: false }), '-11111111');
});

test('十六进制大小写可选：lower 输出小写', () => {
  assert.equal(formatNumber(255n, 16, { upper: true }), 'FF');
  assert.equal(formatNumber(255n, 16, { upper: false }), 'ff');
  assert.equal(formatNumber(-3735928559n, 16, { upper: false, group: false }), '-deadbeef');
});

test('空输入与符号：空文本为 empty；单独的 - / + 报错', () => {
  assert.equal(parseNumber('', 10).status, 'empty');
  assert.equal(parseNumber('  _ , ', 10).status, 'empty');
  assert.equal(parseNumber('-', 10).status, 'error');
  assert.equal(parseNumber('+', 10).status, 'error');
  assert.equal(parseNumber('+255', 10).value, 255n);
});

/* ==================== 非法输入（中文错误） ==================== */

test('非法数字：0b102 → 「「2」不是合法的二进制数字」', () => {
  const r = parseNumber('0b102', 10);
  assert.equal(r.status, 'error');
  assert.equal(r.message, '「2」不是合法的二进制数字');
});

test('非法数字：十六进制框输入 xyz → 「「x」不是合法的十六进制数字」', () => {
  const r = parseNumber('xyz', 16);
  assert.equal(r.status, 'error');
  assert.equal(r.message, '「x」不是合法的十六进制数字');
});

test('非法数字：十进制框输入 12a9 → 指出第一个非法字符', () => {
  const r = parseNumber('12a9', 10);
  assert.equal(r.status, 'error');
  assert.equal(r.message, '「a」不是合法的十进制数字');
});

test('非法数字：八进制框输入 129 → 「2」之后先报 9？——按首个非法字符 9 报错', () => {
  // '1'、'2' 合法，'9' 非法
  const r = parseNumber('129', 8);
  assert.equal(r.status, 'error');
  assert.equal(r.message, '「9」不是合法的八进制数字');
});

test('基数范围：37 / 1 / 0.5 / NaN → 「进制范围为 2–36」；2 / 36 合法', () => {
  assert.equal(validateBase(37), BASE_RANGE_ERROR);
  assert.equal(validateBase(1), BASE_RANGE_ERROR);
  assert.equal(validateBase(0), BASE_RANGE_ERROR);
  assert.equal(validateBase(2.5), BASE_RANGE_ERROR);
  assert.equal(validateBase(Number.NaN), BASE_RANGE_ERROR);
  assert.equal(validateBase(2), null);
  assert.equal(validateBase(36), null);
  // 基数非法时解析同样报错
  assert.deepEqual(parseNumber('10', 37), { status: 'error', message: BASE_RANGE_ERROR });
});

/* ==================== 补码视图 ==================== */

test('补码：-1 在 8 位 → 11111111（无符号 255，有符号 -1）', () => {
  const view = complementView(-1n, 8);
  assert.equal(view.bits, '11111111');
  assert.equal(view.unsigned, 255n);
  assert.equal(view.signed, -1n);
  assert.equal(view.range, 'fit');
  assert.equal(view.message, '');
});

test('补码：-128 在 8 位 → 10000000', () => {
  const view = complementView(-128n, 8);
  assert.equal(view.bits, '10000000');
  assert.equal(view.unsigned, 128n);
  assert.equal(view.signed, -128n);
  assert.equal(view.range, 'fit');
});

test('补码：128 在 8 位 → 提示超出有符号范围，无符号为 128', () => {
  const view = complementView(128n, 8);
  assert.equal(view.range, 'signed-overflow');
  assert.equal(view.unsigned, 128n);
  assert.equal(view.signed, -128n);
  assert.equal(view.bits, '10000000');
  assert.equal(view.message, '超出 8 位有符号范围（-128 – 127），无符号值为 128');
});

test('补码：256 在 8 位 → 提示超出 8 位范围，截断为 0', () => {
  const view = complementView(256n, 8);
  assert.equal(view.range, 'overflow');
  assert.equal(view.pattern, 0n);
  assert.equal(view.bits, '00000000');
  assert.equal(view.message, '超出 8 位范围，截断为 0');
});

test('补码：负数超范围（-129 在 8 位）→ 截断为 127', () => {
  const view = complementView(-129n, 8);
  assert.equal(view.range, 'overflow');
  assert.equal(view.pattern, 127n);
  assert.equal(view.message, '超出 8 位范围，截断为 127');
});

test('补码：64 位与正数', () => {
  const view = complementView(1n << 63n, 64);
  assert.equal(view.range, 'signed-overflow');
  assert.equal(view.unsigned, 1n << 63n);
  assert.equal(view.signed, -(1n << 63n));
  assert.equal(view.bits.length, 64);
  assert.equal(view.bits[0], '1');

  const ok = complementView(255n, 16);
  assert.equal(ok.range, 'fit');
  assert.equal(ok.bits, '0000000011111111');
  assert.equal(ok.signed, 255n);
});

/* ==================== 位运算 ==================== */

test('位运算（32 位）：0b1100 AND 0b1010 = 8（1000）；OR = 14；XOR = 6', () => {
  const a = parseNumber('0b1100', 10).value;
  const b = parseNumber('0b1010', 10).value;

  const and = bitwise({ a, b, op: 'AND', width: 32 });
  assert.equal(and.status, 'ok');
  assert.equal(and.unsigned, 8n);
  assert.equal(and.signed, 8n);
  assert.equal(and.bits, '1000');
  assert.equal(formatNumber(and.pattern, 16), '8');

  const or = bitwise({ a, b, op: 'OR', width: 32 });
  assert.equal(or.unsigned, 14n);
  assert.equal(or.bits, '1110');

  const xor = bitwise({ a, b, op: 'XOR', width: 32 });
  assert.equal(xor.unsigned, 6n);
  assert.equal(xor.bits, '110');
});

test('位运算：NOT 0x0F（8 位）= 0xF0（无符号 240，有符号 -16）', () => {
  const r = bitwise({ a: 0x0fn, op: 'NOT', width: 8 });
  assert.equal(r.status, 'ok');
  assert.equal(r.pattern, 0xf0n);
  assert.equal(r.unsigned, 240n);
  assert.equal(r.signed, -16n);
  assert.equal(r.bits, '11110000');
  assert.deepEqual(r.warnings, []);
});

test('移位（32 位）：1 << 31 → 有符号 -2147483648、无符号 2147483648', () => {
  const r = bitwise({ a: 1n, b: 31n, op: 'SHL', width: 32 });
  assert.equal(r.status, 'ok');
  assert.equal(r.signed, -2147483648n);
  assert.equal(r.unsigned, 2147483648n);
});

test('移位（32 位）：-16 >> 2 = -4（算术右移保留符号）', () => {
  const r = bitwise({ a: -16n, b: 2n, op: 'SAR', width: 32 });
  assert.equal(r.status, 'ok');
  assert.equal(r.signed, -4n);
  assert.equal(r.unsigned, 4294967292n);
});

test('移位（32 位）：-16 >>> 28 = 15（逻辑右移补 0）', () => {
  const r = bitwise({ a: -16n, b: 28n, op: 'SHR', width: 32 });
  assert.equal(r.status, 'ok');
  assert.equal(r.unsigned, 15n);
  assert.equal(r.signed, 15n);
});

test('移位（64 位）：1 << 63 → 无符号 9223372036854775808', () => {
  const r = bitwise({ a: 1n, b: 63n, op: 'SHL', width: 64 });
  assert.equal(r.status, 'ok');
  assert.equal(r.unsigned, 9223372036854775808n);
  assert.equal(r.signed, -9223372036854775808n);
});

test('移位量非法：负数或 ≥ 位宽 → 中文提示', () => {
  const tooBig = bitwise({ a: 1n, b: 32n, op: 'SHL', width: 32 });
  assert.equal(tooBig.status, 'error');
  assert.equal(tooBig.message, '移位量须为 0 到 31 之间的整数，当前为 32');

  const negative = bitwise({ a: 1n, b: -1n, op: 'SHL', width: 32 });
  assert.equal(negative.status, 'error');
  assert.equal(negative.message, '移位量须为 0 到 31 之间的整数，当前为 -1');

  const tooBig64 = bitwise({ a: 1n, b: 64n, op: 'SAR', width: 64 });
  assert.equal(tooBig64.message, '移位量须为 0 到 63 之间的整数，当前为 64');
});

test('位运算操作数超出位宽：按补码截断并给出提示', () => {
  const r = bitwise({ a: 256n, b: 1n, op: 'AND', width: 8 });
  assert.equal(r.status, 'ok');
  assert.equal(r.pattern, 0n);
  assert.deepEqual(r.warnings, ['操作数 A 超出 8 位范围，已按补码截断为 0']);

  const neg = bitwise({ a: -129n, b: 1n, op: 'OR', width: 8 });
  assert.equal(neg.pattern, 127n);
  assert.deepEqual(neg.warnings, ['操作数 A 超出 8 位范围，已按补码截断为 127']);
});

test('运算清单：7 种运算、NOT 单目、三种移位', () => {
  assert.deepEqual(
    OPERATIONS.map((o) => o.id),
    ['AND', 'OR', 'XOR', 'NOT', 'SHL', 'SAR', 'SHR'],
  );
  assert.equal(OPERATIONS.find((o) => o.id === 'NOT').unary, true);
  assert.deepEqual(
    OPERATIONS.filter((o) => o.shift).map((o) => o.id),
    ['SHL', 'SAR', 'SHR'],
  );
});

/* ==================== evaluateOperation（文本级封装） ==================== */

test('evaluateOperation：前缀操作数文本直接可算', () => {
  const r = evaluateOperation({ aText: '0b1100', bText: '0b1010', opId: 'AND', width: 32 });
  assert.equal(r.status, 'ok');
  assert.equal(r.unsigned, 8n);
});

test('evaluateOperation：NOT 为单目，忽略操作数 B；移位时 B 是移位量', () => {
  const not = evaluateOperation({ aText: '0x0F', bText: '', opId: 'NOT', width: 8 });
  assert.equal(not.status, 'ok');
  assert.equal(not.unsigned, 240n);

  const shl = evaluateOperation({ aText: '1', bText: '31', opId: 'SHL', width: 32 });
  assert.equal(shl.unsigned, 2147483648n);
});

test('evaluateOperation：操作数为空 → empty（不算错误）', () => {
  assert.equal(evaluateOperation({ aText: '', bText: '1', opId: 'AND', width: 32 }).status, 'empty');
  assert.equal(evaluateOperation({ aText: '1', bText: '', opId: 'AND', width: 32 }).status, 'empty');
});

test('evaluateOperation：非法操作数给出中文错误并指明是哪个操作数', () => {
  const a = evaluateOperation({ aText: 'zz', bText: '1', opId: 'AND', width: 32 });
  assert.equal(a.status, 'error');
  assert.equal(a.message, '操作数 A：「z」不是合法的十进制数字');

  const b = evaluateOperation({ aText: '1', bText: 'zz', opId: 'AND', width: 32 });
  assert.equal(b.message, '操作数 B：「z」不是合法的十进制数字');

  const shift = evaluateOperation({ aText: '1', bText: 'zz', opId: 'SHL', width: 32 });
  assert.equal(shift.message, '移位量：「z」不是合法的十进制数字');
});

test('evaluateOperation：移位量越界 → 中文提示（0–31 / 0–63）', () => {
  const r = evaluateOperation({ aText: '1', bText: '32', opId: 'SHL', width: 32 });
  assert.equal(r.status, 'error');
  assert.equal(r.message, '移位量须为 0 到 31 之间的整数，当前为 32');

  const neg = evaluateOperation({ aText: '1', bText: '-1', opId: 'SAR', width: 32 });
  assert.equal(neg.message, '移位量须为 0 到 31 之间的整数，当前为 -1');

  const w64 = evaluateOperation({ aText: '1', bText: '63', opId: 'SHL', width: 64 });
  assert.equal(w64.status, 'ok');
  assert.equal(w64.unsigned, 9223372036854775808n);
});

/* ==================== 位网格 ==================== */

test('位网格：从 0 点击第 0 位和第 4 位 → 17', () => {
  let v = toggleBit(0n, 0, 32);
  assert.equal(v, 1n);
  v = toggleBit(v, 4, 32);
  assert.equal(v, 17n);
  // 再点一次第 4 位翻回
  assert.equal(toggleBit(v, 4, 32), 1n);
});

test('位网格：按补码有符号解释回写（8 位第 7 位置 1 → -128）', () => {
  assert.equal(toggleBit(0n, 7, 8), -128n);
  // -1（11111111）翻转第 7 位 → 01111111 = 127
  assert.equal(toggleBit(-1n, 7, 8), 127n);
});

test('位网格：值超出位宽时按位型编辑', () => {
  // 300 在 8 位下的位型是 44（00101100），翻转第 0 位 → 45
  assert.equal(toggleBit(300n, 0, 8), 45n);
});
