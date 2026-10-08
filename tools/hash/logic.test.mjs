/** 哈希计算单元测试（对应 issue #10「验收标准」中全部「输入 → 输出」例子） */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import {
  HMAC_ALGORITHMS,
  Md5,
  PLAIN_ALGORITHMS,
  beginHmacMd5,
  bytesToBase64,
  bytesToHex,
  compareDigests,
  computeDigests,
  computeHmacs,
  formatDigest,
  hmacMd5,
  hmacSha,
  md5,
  parseKey,
  subtleDigest,
  textToBytes,
} from './logic.mjs';

/** 确定性伪随机源（mulberry32），保证测试可重复 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBytes(length, rand) {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = Math.floor(rand() * 256);
  return bytes;
}

const nodeHex = (algo, bytes) => createHash(algo).update(bytes).digest('hex');
const nodeHmacHex = (algo, key, bytes) => createHmac(algo, key).update(bytes).digest('hex');

/* ==================== 验收标准的向量 ==================== */

test('空字符串：MD5 与 SHA-256 的公认空输入摘要', async () => {
  const digests = await computeDigests(textToBytes(''));
  assert.equal(bytesToHex(digests.md5), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(bytesToHex(digests.sha256), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('abc：MD5 / SHA-1 / SHA-256 公认向量', async () => {
  const digests = await computeDigests(textToBytes('abc'));
  assert.equal(bytesToHex(digests.md5), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(bytesToHex(digests.sha1), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(bytesToHex(digests.sha256), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('abc 的 SHA-256 Base64 输出 → ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=', async () => {
  const sha256 = await subtleDigest('SHA-256', textToBytes('abc'));
  assert.equal(formatDigest(sha256, 'base64'), 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
});

test('码工具箱（UTF-8）：MD5 / SHA-1 / SHA-256', async () => {
  const bytes = textToBytes('码工具箱');
  assert.equal(bytes.length, 12); // 4 个汉字各 3 字节
  const digests = await computeDigests(bytes);
  assert.equal(bytesToHex(digests.md5), '3ea39d488efbc5342bc94f72653f285e');
  assert.equal(bytesToHex(digests.sha1), 'c56ffc62c3fa13106a621ec97d632f474c2d752f');
  assert.equal(bytesToHex(digests.sha256), '4546f806e2f5dd1b3026790d4429f556fdd1898078899d7c94796d9c84e61323');
});

test('HMAC：密钥 key，消息 The quick brown fox jumps over the lazy dog', async () => {
  const key = textToBytes('key');
  const message = textToBytes('The quick brown fox jumps over the lazy dog');
  const hmacs = await computeHmacs(key, message);
  assert.equal(bytesToHex(hmacs.md5), '80070713463e7749b90c2dc24911e275');
  assert.equal(bytesToHex(hmacs.sha1), 'de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9');
  assert.equal(bytesToHex(hmacs.sha256), 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  // 其余算法与 Node crypto 对拍补齐（384 / 512 无公认向量可引用）
  assert.equal(bytesToHex(hmacs.sha384), nodeHmacHex('sha384', key, message));
  assert.equal(bytesToHex(hmacs.sha512), nodeHmacHex('sha512', key, message));
});

/* ==================== MD5 与 Node crypto 对拍 ==================== */

test('自写 MD5 与 Node crypto.createHash 对拍：0–1000 字节随机输入全部一致（含 55/56/63/64/65 边界）', () => {
  const rand = mulberry32(20261008);
  for (let length = 0; length <= 1000; length++) {
    const bytes = randomBytes(length, rand);
    assert.equal(
      bytesToHex(md5(bytes)),
      nodeHex('md5', bytes),
      `MD5 不一致：长度 ${length}`,
    );
  }
  // 显式再断言一次分组填充边界（55、56、63、64、65 字节）便于阅读
  const boundaryRand = mulberry32(42);
  for (const length of [55, 56, 63, 64, 65]) {
    const bytes = randomBytes(length, boundaryRand);
    assert.equal(bytesToHex(md5(bytes)), nodeHex('md5', bytes), `MD5 边界长度 ${length} 不一致`);
  }
});

test('MD5 增量分块计算与一次性、Node crypto 一致（随机分块）', () => {
  const rand = mulberry32(9527);
  for (let round = 0; round < 30; round++) {
    const bytes = randomBytes(Math.floor(rand() * 5000), rand);
    const hasher = new Md5();
    let pos = 0;
    while (pos < bytes.length) {
      const size = 1 + Math.floor(rand() * 100); // 1–100 字节随机分块
      hasher.update(bytes.subarray(pos, Math.min(pos + size, bytes.length)));
      pos += size;
    }
    assert.equal(bytesToHex(hasher.digest()), nodeHex('md5', bytes), `增量 MD5 不一致：轮次 ${round}`);
    assert.equal(bytesToHex(hasher.digest()), nodeHex('md5', bytes), '重复 digest 结果应一致');
  }
});

test('Md5 生成摘要后冻结：重复 digest 幂等、继续 update 抛错', () => {
  const hasher = new Md5().update(textToBytes('abc'));
  const first = bytesToHex(hasher.digest());
  assert.equal(bytesToHex(hasher.digest()), first);
  assert.throws(() => hasher.update(textToBytes('x')), /不能继续输入/);
});

/* ==================== SHA 系列与 Node 对拍 ==================== */

test('SHA-1/256/384/512 与 Node crypto 一致（多种输入）', async () => {
  const rand = mulberry32(2026);
  const inputs = [
    new Uint8Array(0),
    textToBytes('abc'),
    textToBytes('码工具箱'),
    randomBytes(10_000, rand),
  ];
  const nodeNames = { sha1: 'sha1', sha256: 'sha256', sha384: 'sha384', sha512: 'sha512' };
  for (const bytes of inputs) {
    const digests = await computeDigests(bytes);
    for (const [id, nodeName] of Object.entries(nodeNames)) {
      assert.equal(bytesToHex(digests[id]), nodeHex(nodeName, bytes), `${id} 不一致`);
    }
  }
});

/* ==================== HMAC 与 Node 对拍 ==================== */

test('HMAC-MD5 与 Node createHmac 对拍：含空密钥、超 64 字节密钥等边界', () => {
  const rand = mulberry32(777);
  const cases = [
    { key: new Uint8Array(0), message: new Uint8Array(0) },
    { key: textToBytes('key'), message: textToBytes('The quick brown fox jumps over the lazy dog') },
    { key: randomBytes(64, rand), message: randomBytes(1000, rand) }, // 恰好 64 字节
    { key: randomBytes(65, rand), message: randomBytes(1, rand) }, // 超长密钥 → 先 MD5 压缩
    { key: randomBytes(200, rand), message: randomBytes(5000, rand) },
  ];
  for (const { key, message } of cases) {
    assert.equal(
      bytesToHex(hmacMd5(key, message)),
      nodeHmacHex('md5', key, message),
    );
  }
});

test('HMAC-SHA 系列与 Node createHmac 对拍（含超长密钥）', async () => {
  const rand = mulberry32(888);
  const nodeNames = { sha1: 'sha1', sha256: 'sha256', sha384: 'sha384', sha512: 'sha512' };
  // 注：crypto.subtle 不接受空密钥（WebCrypto 规范），界面层会提示「请输入 HMAC 密钥」
  for (const keyLength of [20, 100, 64]) {
    const key = randomBytes(keyLength, rand);
    const message = randomBytes(keyLength * 7, rand);
    for (const [id, nodeName] of Object.entries(nodeNames)) {
      const algo = { sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' }[id];
      assert.equal(bytesToHex(await hmacSha(algo, key, message)), nodeHmacHex(nodeName, key, message));
    }
  }
});

test('beginHmacMd5 分块喂入与一次性结果一致', () => {
  const rand = mulberry32(31337);
  const key = randomBytes(80, rand); // 触发密钥压缩分支
  const message = randomBytes(3000, rand);
  const state = beginHmacMd5(key);
  let pos = 0;
  while (pos < message.length) {
    const size = 1 + Math.floor(rand() * 200);
    state.update(message.subarray(pos, Math.min(pos + size, message.length)));
    pos += size;
  }
  assert.equal(bytesToHex(state.digest()), nodeHmacHex('md5', key, message));
});

/* ==================== 密钥格式 ==================== */

test('十六进制密钥 6b6579 与文本密钥 key 的 HMAC 全部相同（5 种算法）', async () => {
  const message = textToBytes('The quick brown fox jumps over the lazy dog');
  const fromHex = await computeHmacs(parseKey('6b6579', 'hex'), message);
  const fromText = await computeHmacs(parseKey('key', 'utf8'), message);
  for (const { id } of PLAIN_ALGORITHMS) {
    assert.equal(bytesToHex(fromHex[id]), bytesToHex(fromText[id]), `HMAC-${id} 应相同`);
  }
});

test('非法十六进制密钥 6b6 → 中文错误', () => {
  assert.throws(() => parseKey('6b6', 'hex'), /十六进制密钥长度非法/);
  assert.throws(() => parseKey('6b6z', 'hex'), /非法字符「z」（第 4 个字符）/);
  assert.throws(() => parseKey('zz', 'hex'), /非法字符「z」（第 1 个字符）/);
});

test('十六进制密钥允许空白分隔：6b 65 79 等价于 6b6579', () => {
  assert.deepEqual(Array.from(parseKey('6b 65 79', 'hex')), Array.from(parseKey('6b6579', 'hex')));
});

test('Base64 密钥：a2V5 → key；非法输入给出中文错误', async () => {
  assert.deepEqual(Array.from(parseKey('a2V5', 'base64')), Array.from(textToBytes('key')));
  // 缺失填充 / 换行 / URL 安全字母表都容忍
  assert.deepEqual(Array.from(parseKey('a2V 5', 'base64')), [0x6b, 0x65, 0x79]);
  const message = textToBytes('msg');
  const fromBase64 = await computeHmacs(parseKey('a2V5', 'base64'), message);
  const fromText = await computeHmacs(textToBytes('key'), message);
  assert.equal(bytesToHex(fromBase64.md5), bytesToHex(fromText.md5));

  assert.throws(() => parseKey('a$v', 'base64'), /非法字符「\$」（第 2 个有效字符）/);
  assert.throws(() => parseKey('abcde', 'base64'), /长度非法/);
  assert.throws(() => parseKey('aa=b==', 'base64'), /「=」只能出现在结尾/);
});

test('未知密钥格式 → 中文错误', () => {
  assert.throws(() => parseKey('x', 'rot13'), /未知的密钥格式/);
});

/* ==================== 输出格式 ==================== */

test('formatDigest：小写 / 大写十六进制与 Base64', async () => {
  const sha256 = await subtleDigest('SHA-256', textToBytes('abc'));
  assert.equal(formatDigest(sha256, 'hex-lower'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(formatDigest(sha256, 'hex-upper'), 'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD');
  assert.equal(formatDigest(sha256, 'base64'), 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
  assert.equal(bytesToBase64(new Uint8Array([0xff])), '/w==');
});

/* ==================== 比对 ==================== */

test('比对：粘贴带首尾空白的大写 SHA-256 → 命中 sha256 行', async () => {
  const digests = await computeDigests(textToBytes('abc'));
  const entries = PLAIN_ALGORITHMS.map((a) => ({ id: a.id, bytes: digests[a.id] }));
  const result = compareDigests(
    '  BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD ',
    entries,
  );
  assert.deepEqual(result.matched, ['sha256']);
  assert.equal(result.matches.sha256, true);
  assert.equal(result.matches.md5, false);
});

test('比对：Base64 形式的期望值也能命中；都不匹配时 matched 为空', async () => {
  const digests = await computeDigests(textToBytes('abc'));
  const entries = PLAIN_ALGORITHMS.map((a) => ({ id: a.id, bytes: digests[a.id] }));
  assert.deepEqual(compareDigests('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=', entries).matched, ['sha256']);
  const none = compareDigests('deadbeef', entries);
  assert.deepEqual(none.matched, []);
  assert.equal(none.active, true);
  // 空白期望值不参与比对
  const blank = compareDigests('   ', entries);
  assert.equal(blank.active, false);
});

test('比对：HMAC 结果也参与比对', async () => {
  const key = textToBytes('key');
  const message = textToBytes('The quick brown fox jumps over the lazy dog');
  const hmacs = await computeHmacs(key, message);
  const entries = HMAC_ALGORITHMS.map((a) => ({ id: a.id, bytes: hmacs[a.id.replace('hmac-', '')] }));
  assert.deepEqual(compareDigests('80070713463e7749b90c2dc24911e275', entries).matched, ['hmac-md5']);
});
