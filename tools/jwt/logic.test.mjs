/** JWT 纯逻辑的单元测试（node --test 自动发现），覆盖 issue #11 验收标准中的输入 → 输出示例 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAIM_INFO,
  algFamily,
  annotateClaims,
  bytesToHex,
  decodeKey,
  decodeSegment,
  describeRelative,
  formatDuration,
  formatUnixTime,
  getTokenStatus,
  localOffsetMinutes,
  normalizeToken,
  offsetLabel,
  parseToken,
  toTimeClaim,
  verifyHmacSignature,
  verifyToken,
} from './logic.mjs';

/* ==================== 测试向量与辅助 ==================== */

/** jwt.io 经典示例（HS256） */
const TOKEN1 =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
/** 中文载荷示例（iat = 1791432000，exp = 1791435600） */
const TOKEN_ZH =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0MiIsIm5hbWUiOiLnoIHlt6XlhbfnrrEiLCJpYXQiOjE3OTE0MzIwMDAsImV4cCI6MTc5MTQzNTYwMH0.LC9Ue5tD3WLynFDYjYZXDhhmdgaF81NyL-raOE2a5o4';
/** alg 为 none 的令牌（未签名） */
const TOKEN_NONE = 'eyJhbGciOiJub25lIn0.eyJhIjoxfQ.';

const b64url = (value) => Buffer.from(value, 'utf8').toString('base64url');
/** 构造测试用 JWT（签名段缺省为任意字节，仅用于解析 / 状态类测试） */
const buildJwt = (header, payload, sig = 'QUFB') => `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}.${sig}`;

/* ==================== 解析 ==================== */

test('解析 TOKEN1：头部 {alg,typ}，载荷 sub/name/iat，签名与 Buffer 交叉验证一致', () => {
  const r = parseToken(TOKEN1);
  assert.equal(r.ok, true);
  assert.deepEqual(r.header, { alg: 'HS256', typ: 'JWT' });
  assert.deepEqual(r.payload, { sub: '1234567890', name: 'John Doe', iat: 1516239022 });
  assert.equal(r.alg, 'HS256');
  assert.equal(r.algFamily, 'HS');
  assert.deepEqual(r.warnings, []);
  // 格式化 JSON
  assert.equal(r.headerJson, '{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
  assert.ok(r.payloadJson.includes('"sub": "1234567890"'));
  assert.ok(r.payloadJson.includes('"name": "John Doe"'));
  assert.ok(r.payloadJson.includes('"iat": 1516239022'));
  // 签名：Base64URL 原文 + 十六进制，与 Node Buffer 交叉验证
  assert.equal(r.signature.base64Url, 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
  assert.equal(r.signature.hex, Buffer.from('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c', 'base64url').toString('hex'));
  assert.equal(r.signature.byteLength, 32);
  assert.deepEqual([...r.signature.bytes], [...Buffer.from('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c', 'base64url')]);
});

test('解析中文载荷：name 为「码工具箱」（UTF-8 正确解码）', () => {
  const r = parseToken(TOKEN_ZH);
  assert.equal(r.ok, true);
  assert.equal(r.payload.name, '码工具箱');
  assert.equal(r.payload.sub, '42');
  assert.equal(r.payload.iat, 1791432000);
  assert.equal(r.payload.exp, 1791435600);
  assert.ok(r.payloadJson.includes('"name": "码工具箱"'));
});

test('normalizeToken：去掉首尾空白、Bearer 前缀（不区分大小写）与正文空白', () => {
  assert.equal(normalizeToken(`  Bearer ${TOKEN1} \n`), TOKEN1);
  assert.equal(normalizeToken(`bearer ${TOKEN1}`), TOKEN1);
  assert.equal(normalizeToken(`BEARER   ${TOKEN1}`), TOKEN1);
  assert.equal(normalizeToken(`${TOKEN_ZH.slice(0, 20)}\n${TOKEN_ZH.slice(20)}`), TOKEN_ZH);
  assert.equal(normalizeToken(TOKEN1), TOKEN1);
  assert.equal(normalizeToken('   '), '');
  assert.equal(normalizeToken(undefined), '');
});

test('解析：带 Bearer 前缀与换行的输入与裸 token 结果一致', () => {
  const plain = parseToken(TOKEN1);
  const prefixed = parseToken(`Bearer\n  ${TOKEN1.slice(0, 30)}${TOKEN1.slice(30)}\n`);
  assert.equal(prefixed.ok, true);
  assert.deepEqual(prefixed.payload, plain.payload);
  assert.deepEqual(prefixed.header, plain.header);
});

test('alg 为 none 的令牌：能解析并给出安全警告', () => {
  const r = parseToken(TOKEN_NONE);
  assert.equal(r.ok, true);
  assert.deepEqual(r.payload, { a: 1 });
  assert.equal(r.alg, 'none');
  assert.equal(r.algFamily, 'none');
  assert.ok(r.warnings.some((w) => w.code === 'alg-none' && w.text.includes('安全警告')));
  assert.ok(r.warnings.some((w) => w.text.includes('alg 为 none')));
  assert.equal(r.signature.byteLength, 0); // 第三段为空
  assert.equal(r.signature.hex, '');
});

test('alg 为 NONE / None 等大小写变体：同样给出安全警告并按未签名处理', () => {
  for (const alg of ['NONE', 'None']) {
    const r = parseToken(buildJwt({ alg, typ: 'JWT' }, { a: 1 }));
    assert.equal(r.ok, true, alg);
    assert.equal(r.algFamily, 'none', alg);
    assert.ok(r.warnings.some((w) => w.code === 'alg-none' && w.text.includes('安全警告')), alg);
    assert.ok(r.warnings.some((w) => w.text.includes(`alg 为 ${alg}`)), alg);
  }
});

test('头部缺少 alg：解析成功但给出警告', () => {
  const r = parseToken(buildJwt({ typ: 'JWT' }, { a: 1 }));
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.code === 'alg-missing'));
});

/* ==================== 解析错误 ==================== */

test('错误：只有两段 aaa.bbb → JWT 应由 3 段组成（以 . 分隔）', () => {
  const r = parseToken('aaa.bbb');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'JWT 应由 3 段组成（以 . 分隔），当前为 2 段');
});

test('错误：四段同样提示段数不符', () => {
  const r = parseToken('a.b.c.d');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'JWT 应由 3 段组成（以 . 分隔），当前为 4 段');
});

test('错误：载荷段不是合法 Base64URL → 指明第 2 段（载荷）解码失败与字符位置', () => {
  const r = parseToken(`${b64url('x')}.ab+cd.ef`);
  assert.equal(r.ok, false);
  assert.equal(r.error, '第 2 段（载荷）解码失败：包含非法字符「+」（第 3 个字符）');
});

test('错误：载荷段长度不正确（余 1）→ 第 2 段（载荷）解码失败', () => {
  const r = parseToken(`${b64url('x')}.abcde.ef`);
  assert.equal(r.ok, false);
  assert.match(r.error, /^第 2 段（载荷）解码失败：有效长度不正确/);
});

test('错误：头部段非法字符 → 第 1 段（头部）解码失败', () => {
  const r = parseToken(`eyJ$hciOiJIUzI1NiJ9.eyJhIjoxfQ.AAAA`);
  assert.equal(r.ok, false);
  assert.equal(r.error, '第 1 段（头部）解码失败：包含非法字符「$」（第 4 个字符）');
});

test('错误：载荷不是 JSON → 第 2 段（载荷）不是合法 JSON', () => {
  const r = parseToken(`${b64url('{"alg":"HS256"}')}.${b64url('not json')}.AAAA`);
  assert.equal(r.ok, false);
  assert.equal(r.error, '第 2 段（载荷）不是合法 JSON');
});

test('错误：头部不是 JSON → 第 1 段（头部）不是合法 JSON', () => {
  const r = parseToken(`${b64url('not json')}.${b64url('{"a":1}')}.AAAA`);
  assert.equal(r.ok, false);
  assert.equal(r.error, '第 1 段（头部）不是合法 JSON');
});

test('错误：载荷是 JSON 但不是对象 → 提示不是 JSON 对象', () => {
  const r = parseToken(`${b64url('{"alg":"HS256"}')}.${b64url('[1,2]')}.AAAA`);
  assert.equal(r.ok, false);
  assert.equal(r.error, '第 2 段（载荷）不是 JSON 对象');
});

test('错误：载荷与签名同时有问题 → 先报载荷的问题（错误优先级）', () => {
  // 载荷不是 JSON + 签名段非法 Base64URL
  const r1 = parseToken(`${b64url('{"alg":"HS256"}')}.${b64url('not json')}.ab+cd`);
  assert.equal(r1.ok, false);
  assert.equal(r1.error, '第 2 段（载荷）不是合法 JSON');
  // 载荷段非法 Base64URL + 签名段非法 Base64URL
  const r2 = parseToken(`${b64url('{"alg":"HS256"}')}.ab+cd.ef$g`);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /^第 2 段（载荷）解码失败/);
  // 头部与签名同时有问题 → 先报头部
  const r3 = parseToken(`eyJ$.${b64url('{"a":1}')}.ef$g`);
  assert.equal(r3.ok, false);
  assert.match(r3.error, /^第 1 段（头部）解码失败/);
});

/* ==================== 状态徽标（注入 now） ==================== */

test('状态：TOKEN_ZH 注入 now = 1791433800 → 有效，30 分钟后过期', () => {
  const { payload } = parseToken(TOKEN_ZH);
  const s = getTokenStatus(payload, 1791433800);
  assert.deepEqual(s, { state: 'valid', label: '有效', detail: '30 分钟后过期' });
});

test('状态：TOKEN_ZH 注入 now = 1791439200 → 已过期（已过期 1 小时）', () => {
  const { payload } = parseToken(TOKEN_ZH);
  const s = getTokenStatus(payload, 1791439200);
  assert.deepEqual(s, { state: 'expired', label: '已过期', detail: '已过期 1 小时' });
});

test('状态：含 nbf = 1791432000，注入 now = 1791430000 → 尚未生效', () => {
  const token = buildJwt(
    { alg: 'HS256', typ: 'JWT' },
    { sub: '42', iat: 1791432000, nbf: 1791432000, exp: 1791435600 },
  );
  const { payload } = parseToken(token);
  const s = getTokenStatus(payload, 1791430000);
  assert.equal(s.state, 'not-yet-valid');
  assert.equal(s.label, '尚未生效');
  assert.equal(s.detail, '距生效还有 33 分钟');
});

test('状态：now 恰好等于 exp → 已过期；无 exp / nbf → 有效但无法判断过期时间', () => {
  const { payload } = parseToken(TOKEN_ZH);
  assert.equal(getTokenStatus(payload, 1791435600).state, 'expired');
  const bare = getTokenStatus({ sub: '1' }, 1791433800);
  assert.deepEqual(bare, { state: 'valid', label: '有效', detail: '未声明 exp，无法判断过期时间' });
});

test('状态：已过期优先于尚未生效（永远不可能有效的令牌）', () => {
  const s = getTokenStatus({ exp: 100, nbf: 200 }, 150);
  assert.equal(s.state, 'expired');
});

/* ==================== 时间格式化 ==================== */

test('formatDuration：单位选择与进位', () => {
  assert.equal(formatDuration(0), '0 秒');
  assert.equal(formatDuration(59), '59 秒');
  assert.equal(formatDuration(60), '1 分钟');
  assert.equal(formatDuration(90), '2 分钟');
  assert.equal(formatDuration(1800), '30 分钟');
  assert.equal(formatDuration(3600), '1 小时');
  assert.equal(formatDuration(3599), '1 小时'); // 59.98 分钟进位
  assert.equal(formatDuration(10800), '3 小时');
  assert.equal(formatDuration(86399), '1 天'); // 23.999 小时进位
  assert.equal(formatDuration(172800), '2 天');
  assert.equal(formatDuration(30 * 86400), '1 个月');
  assert.equal(formatDuration(365 * 86400), '1 年');
  assert.equal(formatDuration(-5), '0 秒'); // 负数按 0 处理
});

test('formatUnixTime：UTC 与指定偏移', () => {
  assert.equal(formatUnixTime(0, 0), '1970-01-01 00:00:00');
  assert.equal(formatUnixTime(0, 480), '1970-01-01 08:00:00');
  assert.equal(formatUnixTime(0, -300), '1969-12-31 19:00:00');
  // 验收标准：iat = 1516239022 → UTC 2018-01-18 01:30:22
  assert.equal(formatUnixTime(1516239022, 0), '2018-01-18 01:30:22');
  assert.equal(formatUnixTime(1516239022, 480), '2018-01-18 09:30:22');
  assert.equal(formatUnixTime(1791432000, 0), '2026-10-08 04:00:00');
});

test('offsetLabel / localOffsetMinutes', () => {
  assert.equal(offsetLabel(0), 'UTC');
  assert.equal(offsetLabel(480), 'UTC+8');
  assert.equal(offsetLabel(-300), 'UTC-5');
  assert.equal(offsetLabel(330), 'UTC+5:30');
  assert.equal(offsetLabel(-210), 'UTC-3:30');
  // 本地偏移与 Node 的时区函数一致
  const at = 1791432000;
  assert.equal(localOffsetMinutes(at), -new Date(at * 1000).getTimezoneOffset());
});

test('describeRelative：前 / 后', () => {
  assert.equal(describeRelative(1000, 1000 + 7200), '2 小时前');
  assert.equal(describeRelative(1000 + 1800, 1000), '30 分钟后');
  assert.equal(describeRelative(1000, 1000), '0 秒后');
});

test('toTimeClaim：数字与数字字符串，非法值返回 null', () => {
  assert.equal(toTimeClaim(42), 42);
  assert.equal(toTimeClaim('42'), 42);
  assert.equal(toTimeClaim('abc'), null);
  assert.equal(toTimeClaim(null), null);
  assert.equal(toTimeClaim(Number.NaN), null);
});

/* ==================== 声明标注 ==================== */

test('annotateClaims：标准声明中文说明 + 时间声明的本地 / UTC / 相对时间', () => {
  const entries = annotateClaims(
    { iss: 'example.com', sub: '42', name: '码工具箱', exp: 1791435600, custom: [1, 2] },
    1791433800, // now
    480, // 本地 UTC+8
  );
  assert.equal(entries.length, 5);

  const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
  assert.equal(byKey.iss.known, true);
  assert.equal(byKey.iss.label, '签发者');
  assert.equal(byKey.iss.valueText, '"example.com"');
  assert.equal(byKey.sub.label, '主题');
  assert.equal(byKey.name.known, false); // 非标准声明
  assert.equal(byKey.custom.valueText, '[1,2]');

  const exp = byKey.exp;
  assert.equal(exp.label, '过期时间');
  assert.equal(exp.time.utc, '2026-10-08 05:00:00');
  assert.equal(exp.time.local, '2026-10-08 13:00:00');
  assert.equal(exp.time.localLabel, 'UTC+8');
  assert.equal(exp.time.relative, '30 分钟后');
  // 声明顺序与载荷一致
  assert.deepEqual(entries.map((e) => e.key), ['iss', 'sub', 'name', 'exp', 'custom']);
});

test('CLAIM_INFO：七个标准声明齐全，时间类标记正确', () => {
  assert.deepEqual(Object.keys(CLAIM_INFO), ['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti']);
  assert.equal(CLAIM_INFO.iss.label, '签发者');
  assert.equal(CLAIM_INFO.sub.label, '主题');
  assert.equal(CLAIM_INFO.aud.label, '受众');
  assert.equal(CLAIM_INFO.exp.label, '过期时间');
  assert.equal(CLAIM_INFO.nbf.label, '生效时间');
  assert.equal(CLAIM_INFO.iat.label, '签发时间');
  assert.equal(CLAIM_INFO.jti.label, '编号');
  for (const key of ['exp', 'nbf', 'iat']) assert.equal(CLAIM_INFO[key].time, true);
});

test('annotateClaims：时间声明值非法时不附带时间信息', () => {
  const entries = annotateClaims({ exp: 'soon' }, 1000, 0);
  assert.equal(entries[0].time, undefined);
  assert.equal(entries[0].valueText, '"soon"');
});

/* ==================== 验签 ==================== */

test('验签：TOKEN1 + 密钥 your-256-bit-secret → 签名有效；wrong → 签名无效', async () => {
  const parsed = parseToken(TOKEN1);
  assert.deepEqual(await verifyToken(parsed, 'your-256-bit-secret'), {
    kind: 'valid',
    message: '签名有效',
    kindClass: 'ok',
  });
  assert.deepEqual(await verifyToken(parsed, 'wrong'), {
    kind: 'invalid',
    message: '签名无效',
    kindClass: 'bad',
  });
});

test('验签：中文载荷 + 密钥「码工具箱-secret」→ 签名有效', async () => {
  const parsed = parseToken(TOKEN_ZH);
  const r = await verifyToken(parsed, '码工具箱-secret');
  assert.equal(r.kind, 'valid');
  assert.equal(r.message, '签名有效');
});

test('验签：密钥为空 → 提示输入密钥', async () => {
  const r = await verifyToken(parseToken(TOKEN1), '');
  assert.equal(r.kind, 'empty-key');
  assert.equal(r.message, '输入密钥后自动验签');
});

test('验签：「密钥为 Base64 编码」选项：eW91ci0yNTYtYml0LXNlY3JldA== → TOKEN1 签名有效', async () => {
  const parsed = parseToken(TOKEN1);
  assert.equal(Buffer.from('eW91ci0yNTYtYml0LXNlY3JldA==', 'base64').toString('utf8'), 'your-256-bit-secret');
  assert.equal((await verifyToken(parsed, 'eW91ci0yNTYtYml0LXNlY3JldA==', { base64: true })).kind, 'valid');
  // 不勾选时按原始文本（UTF-8 字节）作为密钥 → 无效
  assert.equal((await verifyToken(parsed, 'eW91ci0yNTYtYml0LXNlY3JldA==')).kind, 'invalid');
});

test('验签：Base64 密钥非法 → 中文错误提示', async () => {
  const r = await verifyToken(parseToken(TOKEN1), 'abc$=', { base64: true });
  assert.equal(r.kind, 'key-error');
  assert.equal(r.kindClass, 'bad');
  assert.match(r.message, /^密钥不是合法的 Base64：包含非法字符/);
});

test('验签：HS384 / HS512 与 Node crypto 的 HMAC 交叉验证', async () => {
  const { createHmac } = await import('node:crypto');
  for (const [alg, sha] of [
    ['HS384', 'sha384'],
    ['HS512', 'sha512'],
  ]) {
    const header = b64url(JSON.stringify({ alg, typ: 'JWT' }));
    const payload = b64url(JSON.stringify({ sub: '42', iat: 1791432000 }));
    const sig = createHmac(sha, Buffer.from('码工具箱-secret', 'utf8')).update(`${header}.${payload}`).digest('base64url');
    const token = `${header}.${payload}.${sig}`;
    const parsed = parseToken(token);
    assert.equal(parsed.ok, true);
    assert.equal((await verifyToken(parsed, '码工具箱-secret')).kind, 'valid');
    assert.equal((await verifyToken(parsed, 'wrong')).kind, 'invalid');
  }
});

test('验签：alg 为 none → 提示未签名；RS / ES / PS / 未知算法 → 暂不支持该算法验签', async () => {
  const none = await verifyToken(parseToken(TOKEN_NONE), 'any-key');
  assert.equal(none.kind, 'unsigned');
  assert.equal(none.message, '该 JWT 未签名（alg 为 none），无需验签');

  // 大小写变体同样按未签名处理
  const upper = await verifyToken(parseToken(buildJwt({ alg: 'NONE', typ: 'JWT' }, { a: 1 })), 'any-key');
  assert.equal(upper.kind, 'unsigned');
  assert.equal(upper.message, '该 JWT 未签名（alg 为 NONE），无需验签');

  // 提示文案与 issue 原文一致（算法名由界面单独显示）
  for (const alg of ['RS256', 'ES384', 'PS512', 'EdDSA']) {
    const parsed = parseToken(buildJwt({ alg, typ: 'JWT' }, { a: 1 }));
    const r = await verifyToken(parsed, 'some-key');
    assert.equal(r.kind, 'unsupported');
    assert.equal(r.kindClass, 'warn');
    assert.equal(r.message, '暂不支持该算法验签，仅解析');
  }

  const noAlg = await verifyToken(parseToken(buildJwt({ typ: 'JWT' }, { a: 1 })), 'k');
  assert.equal(noAlg.kind, 'unsupported');
  assert.match(noAlg.message, /缺少 alg/);
});

test('验签：Base64 密钥解码后为空（====）→ 中文提示，不出现英文报错', async () => {
  const r = await verifyToken(parseToken(TOKEN1), '====', { base64: true });
  assert.equal(r.kind, 'key-error');
  assert.equal(r.kindClass, 'bad');
  assert.equal(r.message, '密钥解码后为空，无法验签');
  assert.ok(!/[a-z]/.test(r.message)); // 不夹杂英文报错
});

test('verifyHmacSignature：直接比较已知向量', async () => {
  const parsed = parseToken(TOKEN1);
  assert.equal(
    await verifyHmacSignature(parsed.segments, parsed.signature.bytes, new TextEncoder().encode('your-256-bit-secret'), 'SHA-256'),
    true,
  );
  assert.equal(
    await verifyHmacSignature(parsed.segments, parsed.signature.bytes, new TextEncoder().encode('nope'), 'SHA-256'),
    false,
  );
});

/* ==================== 解码辅助 ==================== */

test('decodeSegment：严格 Base64URL（拒绝 + /），容忍结尾填充', () => {
  assert.deepEqual([...decodeSegment('aGVsbG8', 'x')], [...Buffer.from('hello')]);
  assert.deepEqual([...decodeSegment('aGVsbG8=', 'x')], [...Buffer.from('hello')]);
  assert.throws(() => decodeSegment('a+b', 'x'), /包含非法字符「\+」/);
  assert.throws(() => decodeSegment('a/b', 'x'), /包含非法字符「\/」/);
  assert.throws(() => decodeSegment('ab=cd', 'x'), /填充后不能还有其他字符/);
});

test('decodeKey：文本按 UTF-8，Base64 按宽容规则', () => {
  assert.deepEqual([...decodeKey('码')], [...Buffer.from('码', 'utf8')]);
  assert.deepEqual([...decodeKey('eW91cg==', { base64: true })], [...Buffer.from('your')]);
  assert.deepEqual([...decodeKey('eW91cg', { base64: true })], [...Buffer.from('your')]); // 缺填充
  assert.throws(() => decodeKey('a$', { base64: true }), /密钥不是合法的 Base64/);
});

test('bytesToHex：小写连续', () => {
  assert.equal(bytesToHex(new Uint8Array([0x0a, 0xbc, 0xff])), '0abcff');
  assert.equal(bytesToHex(new Uint8Array([])), '');
});

test('algFamily：算法分类（none 不区分大小写）', () => {
  assert.equal(algFamily('HS256'), 'HS');
  assert.equal(algFamily('RS256'), 'RS');
  assert.equal(algFamily('PS256'), 'PS');
  assert.equal(algFamily('ES512'), 'ES');
  assert.equal(algFamily('none'), 'none');
  assert.equal(algFamily('NONE'), 'none');
  assert.equal(algFamily('None'), 'none');
  assert.equal(algFamily('EdDSA'), 'other');
});
