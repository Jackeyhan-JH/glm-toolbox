/**
 * 哈希计算 —— 大文件计算 Worker（module worker，由 index.mjs 创建）。
 *
 * 协议：
 *   主线程 → worker：{ type: 'hash', id, file: File, hmacKey: Uint8Array | null }
 *   worker → 主线程：
 *     { type: 'progress', id, loaded, total }   每读完一个分块
 *     { type: 'done', id, digests, hmacs }      全部摘要（ArrayBuffer 已 transfer）
 *     { type: 'error', id, message }            中文错误信息
 *
 * 大文件 MD5 分块增量计算（Md5.update 逐块喂入），SHA 系列用 crypto.subtle
 * 对完整缓冲一次性计算（WebCrypto 不支持流式）。取消由主线程 terminate 实现。
 *
 * 纯逻辑（Md5 / beginHmacMd5 / subtleDigest / hmacSha）来自 ./logic.mjs，
 * 不含 DOM 依赖，因此可在 worker 中直接加载。
 */

import { Md5, SUBTLE_IDS, beginHmacMd5, hmacSha, subtleDigest } from './logic.mjs';

const SUBTLE_NAMES = { sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };
/** 分块读取大小：200MB 文件约 50 次进度更新 */
const CHUNK_SIZE = 4 * 1024 * 1024;

self.addEventListener('message', (event) => {
  const { type, id } = event.data ?? {};
  if (type !== 'hash') return;
  hashFile(event.data).then(
    (result) => {
      const transfer = Object.values(result.digests)
        .concat(result.hmacs ? Object.values(result.hmacs) : [])
        .map((bytes) => bytes.buffer);
      self.postMessage({ type: 'done', id, ...result }, transfer);
    },
    (err) => {
      self.postMessage({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
    },
  );
});

/** 读取文件并计算全部摘要。file 由主线程结构化克隆传入，切片读取控制内存。 */
async function hashFile({ id, file, hmacKey }) {
  const total = file.size;
  const buffer = new Uint8Array(total);
  const md5Hasher = new Md5();
  const hmacState = hmacKey ? beginHmacMd5(hmacKey) : null;

  let offset = 0;
  while (offset < total) {
    const end = Math.min(offset + CHUNK_SIZE, total);
    const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    buffer.set(chunk, offset);
    md5Hasher.update(chunk); // 大文件 MD5 分块增量计算
    if (hmacState) hmacState.update(chunk);
    offset = end;
    self.postMessage({ type: 'progress', id, loaded: offset, total });
  }

  const digests = { md5: md5Hasher.digest() };
  for (const shaId of SUBTLE_IDS) {
    digests[shaId] = await subtleDigest(SUBTLE_NAMES[shaId], buffer);
  }

  let hmacs = null;
  if (hmacState) {
    hmacs = { md5: hmacState.digest() };
    for (const shaId of SUBTLE_IDS) {
      hmacs[shaId] = await hmacSha(SUBTLE_NAMES[shaId], hmacKey, buffer);
    }
  }
  return { digests, hmacs };
}
