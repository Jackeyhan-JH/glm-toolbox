/**
 * 正则测试 —— 匹配 / 替换 Worker（module worker，由 index.mjs 创建）。
 *
 * 协议：
 *   主线程 → worker：{ type: 'run', id, source, flags, text, replacement }
 *   worker → 主线程：{ type: 'result', id, ok: true,  matches, count, countedAll, replaceResult }
 *                     { type: 'result', id, ok: false, message }
 *
 * 主线程每次运行都新建 worker、超过 1 秒未得到结果即 terminate（灾难性回溯保护），
 * 因此本 worker 无需排队 / 取消逻辑；纯逻辑全部来自 ./logic.mjs（无 DOM 依赖）。
 */

import { run } from './logic.mjs';

self.addEventListener('message', (event) => {
  const { type, id } = event.data ?? {};
  if (type !== 'run') return;
  let payload;
  try {
    payload = run(event.data);
  } catch (err) {
    // run 内部已捕获编译错误，这里兜底意外异常，避免向主线程抛 messageerror
    payload = { ok: false, message: `正则执行出错：${err instanceof Error ? err.message : String(err)}` };
  }
  self.postMessage({ type: 'result', id, ...payload });
});
