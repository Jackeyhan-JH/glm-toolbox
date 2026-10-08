/**
 * 二维码识别 Worker（module worker，由 index.mjs 创建）。
 *
 * 协议：
 *   主线程 → worker：{ type: 'decode', id, data: ArrayBuffer, width, height }
 *                     （data 为 RGBA 像素，postMessage 时 transfer，主线程副本被分离）
 *   worker → 主线程：{ type: 'result', id, ok: true, text }
 *                     { type: 'result', id, ok: false, error }
 *
 * 识别在 worker 中运行，大图也不会卡住页面；主线程每次识别新建 worker，
 * 超时即 terminate，因此本 worker 无需排队 / 取消逻辑。
 */

import { decodeRgba } from './logic.mjs';

self.addEventListener('message', (event) => {
  const { type, id } = event.data ?? {};
  if (type !== 'decode') return;
  let payload;
  try {
    payload = decodeRgba(new Uint8ClampedArray(event.data.data), event.data.width, event.data.height);
  } catch (err) {
    payload = { ok: false, error: `识别出错：${err instanceof Error ? err.message : String(err)}` };
  }
  self.postMessage({ type: 'result', id, ...payload });
});
