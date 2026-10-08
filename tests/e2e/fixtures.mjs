/**
 * 公共 e2e 夹具：所有 e2e 测试一律从这里引入 test / expect。
 *
 *   import { test, expect, openTool } from '../../tests/e2e/fixtures.mjs';
 *
 * 自动生效的约束（违反即测试失败）：
 *   - 任何发往非 localhost / 127.0.0.1 的请求（禁止外部网络）；
 *   - 任何 console.error；
 *   - 任何未捕获异常（pageerror）。
 *
 * 个别用例确实会触发预期中的错误（如「工具加载失败」用例），
 * 用 allowExpectedErrors(page, /关键字/) 显式豁免。
 *
 * 多个 worktree 并行跑 e2e 时通过环境变量 E2E_PORT 错开端口（见 CONTRIBUTING.md）。
 */

import { test as base, expect } from '@playwright/test';

export { expect };

/** 主服务（--base /）端口：默认 4173，可用 E2E_PORT 覆盖 */
export const E2E_PORT = Number(process.env.E2E_PORT || 4173);

/** 子路径服务（--base /glm-toolbox/）端口：主端口 + 1 */
export const SUBPATH_PORT = E2E_PORT + 1;

export const BASE_URL = `http://localhost:${E2E_PORT}/`;

/** 子路径部署（模拟 GitHub Pages）的根地址 */
export const SUBPATH_BASE_URL = `http://localhost:${SUBPATH_PORT}/glm-toolbox/`;

/* ---------------- 预期错误豁免 ---------------- */

const allowances = new WeakMap(); // page -> RegExp[]

/** 豁免匹配某正则的 console.error / 未捕获异常（仅限确实要触发错误的用例） */
export function allowExpectedErrors(page, pattern) {
  const list = allowances.get(page) ?? [];
  list.push(pattern);
  allowances.set(page, list);
}

function isAllowed(page, text) {
  return (allowances.get(page) ?? []).some((re) => re.test(text));
}

/* ---------------- 本地请求判定 ---------------- */

function isLocalUrl(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

/* ---------------- 扩展后的 test ---------------- */

export const test = base.test.extend({
  page: async ({ page }, use) => {
    const problems = [];

    page.on('request', (request) => {
      const url = request.url();
      if (!isLocalUrl(url)) {
        problems.push(`非本地请求：${request.method()} ${url}`);
      }
    });

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (!isAllowed(page, text)) {
        problems.push(`console.error：${text}`);
      }
    });

    page.on('pageerror', (error) => {
      const text = `${error.name ?? 'Error'}: ${error.message}`;
      if (!isAllowed(page, text) && !isAllowed(page, error.message)) {
        problems.push(`未捕获异常：${text}`);
      }
    });

    await use(page);

    if (problems.length > 0) {
      throw new Error(`检测到未预期的页面问题（${problems.length} 处）：\n  - ${problems.join('\n  - ')}`);
    }
  },
});

/* ---------------- 辅助函数 ---------------- */

/**
 * 打开某个工具页并等待挂载完成。
 * 外壳在 mount() 成功后会给主区域加 data-tool-ready="<id>"。
 */
export async function openTool(page, id) {
  await page.goto(`/#/${id}`);
  await page.locator(`[data-tool-ready="${id}"]`).waitFor({ state: 'attached' });
  return page.locator(`[data-tool-ready="${id}"]`);
}
