/** 随机生成器端到端测试（对应 issue #12 的验收标准，🖥 条目逐条覆盖）。 */

import fs from 'node:fs';
import { test, expect, openTool, SUBPATH_BASE_URL } from '../../tests/e2e/fixtures.mjs';
import { PASSWORD_SYMBOLS } from './logic.mjs';

// 复制按钮用例需要读写剪贴板；下载用例需要接受下载
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const OUTPUT = '[data-testid="random-output"]';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ULID_LOWER_RE = /^[0-9a-hjkmnp-tv-z]{26}$/;
/** 默认密码字符池：26 大写 + 26 小写 + 10 数字 + 符号集 */
const PASSWORD_POOL = 26 + 26 + 10 + PASSWORD_SYMBOLS.length;
const SYMBOL_RE = /[!@#$%^&*()\-_=+\[\]{};:,.?/]/;

/** 清空 localStorage 后打开工具，避免上一个用例留下的选项干扰 */
async function openToolFresh(page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  return openTool(page, 'random');
}

async function outputLines(page) {
  const text = await page.locator(OUTPUT).textContent();
  return text.split('\n').filter((line) => line !== '');
}

/** 轮询等待（防抖后的）重新生成使结果区出现 count 行，返回这些行 */
async function waitForLines(page, count) {
  await expect
    .poll(async () => (await outputLines(page)).length, { timeout: 10_000 })
    .toBe(count);
  return outputLines(page);
}

/** 轮询等待结果区每一行都满足 predicate（避免读到防抖刷新前的旧结果），返回这些行 */
async function waitForEveryLine(page, predicate) {
  await expect
    .poll(
      async () => {
        const lines = await outputLines(page);
        return lines.length > 0 && lines.every(predicate) ? lines : null;
      },
      { timeout: 10_000 },
    )
    .toBeTruthy();
  return outputLines(page);
}

/** 用键盘逐格拨动密码长度滑块（每次按键触发 input 事件，与拖动等效） */
async function nudgeSlider(slider, key, times) {
  await slider.focus();
  for (let i = 0; i < times; i += 1) await slider.press(key);
}

test.describe('随机生成器：外壳集成', () => {
  test('打开 #/random：标题、侧边栏高亮', async ({ page }) => {
    await openTool(page, 'random');
    await expect(page).toHaveTitle('随机生成器 - 码工具箱');
    await expect(page.getByRole('heading', { name: '随机生成器' })).toBeVisible();
    await expect(page.locator('.nav-item[data-tool-id="random"]')).toHaveAttribute('aria-current', 'true');
  });

  test('搜索：清单 keywords 中的每个关键词都能搜到本工具', async ({ page }) => {
    const manifest = JSON.parse(fs.readFileSync(new URL('./tool.json', import.meta.url), 'utf8'));
    const navItem = page.locator('.nav-item[data-tool-id="random"]');
    for (const keyword of manifest.keywords) {
      await page.goto('/');
      await page.getByLabel('搜索工具').fill(keyword);
      await expect(navItem).toBeVisible();
    }
  });

  test('子路径部署（--base /glm-toolbox/）下工具可用', async ({ page }) => {
    await page.goto(`${SUBPATH_BASE_URL}#/random`);
    await expect(page.locator('[data-tool-ready="random"]')).toBeAttached();
    await expect(page.locator('link[data-tool-style="random"]')).toHaveCount(1);
    const lines = await outputLines(page);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(UUID_V4_RE);
  });

  test('默认打开即生成 1 个 UUID v4，结果区与计数正确', async ({ page }) => {
    await openToolFresh(page);
    const lines = await outputLines(page);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(UUID_V4_RE);
    await expect(page.getByTestId('random-result-count')).toHaveText('共 1 个');
    await expect(page.getByRole('button', { name: '复制全部' })).toBeEnabled();
  });
});

test.describe('随机生成器：UUID', () => {
  test('🖥 选择 UUID v4、数量 5 → 结果区 5 行；复制全部读回 5 行；重新生成后结果变化', async ({ page }) => {
    await openToolFresh(page);
    await page.getByLabel('数量').fill('5');
    const first = await waitForLines(page, 5);
    await expect(page.getByTestId('random-result-count')).toHaveText('共 5 个');
    for (const line of first) expect(line).toMatch(UUID_V4_RE);

    await page.getByRole('button', { name: '复制全部' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard.split('\n')).toHaveLength(5);
    expect(clipboard).toBe(first.join('\n'));

    await page.getByTestId('random-generate').click();
    const second = await waitForLines(page, 5);
    expect(second.join('\n')).not.toBe(first.join('\n'));
    for (const line of second) expect(line).toMatch(UUID_V4_RE);
  });

  test('🖥 UUID v7：结果匹配 v7 正则且按行升序（同一毫秒内也递增）', async ({ page }) => {
    await openToolFresh(page);
    await page.getByRole('button', { name: 'UUID v7', exact: true }).click();
    await page.getByLabel('数量').fill('100');
    const lines = await waitForLines(page, 100);
    for (const line of lines) expect(line).toMatch(UUID_V7_RE);
    expect(lines).toEqual([...lines].sort());
  });

  test('UUID 格式选项：大写 / 去掉连字符 / 加花括号', async ({ page }) => {
    await openToolFresh(page);
    const panel = page.getByTestId('random-panel-uuid');
    await panel.getByLabel('大写', { exact: true }).check();
    await panel.getByLabel('去掉连字符').check();
    await panel.getByLabel('加花括号').check();
    const lines = await waitForEveryLine(page, (line) => /^\{[0-9A-F]{32}\}$/.test(line));
    expect(lines.length).toBeGreaterThan(0);
  });

  test('数量越界给出中文错误，结果区清空且不可复制；修正后恢复', async ({ page }) => {
    await openToolFresh(page);
    await page.getByLabel('数量').fill('1001');
    await expect(page.getByRole('alert')).toHaveText('数量必须在 1 到 1000 之间');
    await expect(page.locator(OUTPUT)).toHaveText('');
    await expect(page.getByRole('button', { name: '复制全部' })).toBeDisabled();

    await page.getByLabel('数量').fill('1000');
    await expect(page.getByRole('alert')).toHaveCount(0);
    const lines = await waitForLines(page, 1000);
    expect(new Set(lines).size).toBe(1000);
  });

  test('下载 .txt：文件名以 .txt 结尾，内容与结果区一致', async ({ page }) => {
    await openToolFresh(page);
    await page.getByLabel('数量').fill('5');
    const lines = await waitForLines(page, 5);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('random-download').click(),
    ]);
    expect(download.suggestedFilename().endsWith('.txt')).toBe(true);
    expect(fs.readFileSync(await download.path(), 'utf8')).toBe(lines.join('\n'));
  });
});

test.describe('随机生成器：ULID', () => {
  test('默认大写 26 位 Crockford Base32；取消「大写」后为小写', async ({ page }) => {
    await openToolFresh(page);
    await page.getByTestId('random-tab-ulid').click();
    await page.getByLabel('数量').fill('50');
    const upper = await waitForLines(page, 50);
    for (const line of upper) expect(line).toMatch(ULID_RE);
    expect(upper).toEqual([...upper].sort());

    await page.getByTestId('random-panel-ulid').getByLabel('大写', { exact: true }).uncheck();
    const lower = await waitForEveryLine(page, (line) => ULID_LOWER_RE.test(line));
    expect(lower).toHaveLength(50);
    for (const line of lower) expect(line).toMatch(ULID_LOWER_RE);
    expect(lower).toEqual([...lower].sort());
  });
});

test.describe('随机生成器：NanoID', () => {
  test('默认 21 位；预设「数字」；自定义字母表 abc + 长度 10；非法字母表中文错误', async ({ page }) => {
    await openToolFresh(page);
    await page.getByTestId('random-tab-nanoid').click();
    const panel = page.getByTestId('random-panel-nanoid');

    const defaults = await waitForEveryLine(page, (line) => /^[A-Za-z0-9_-]{21}$/.test(line));
    expect(defaults).toHaveLength(1);

    await panel.getByLabel('预设').selectOption('digits');
    await waitForEveryLine(page, (line) => /^\d{21}$/.test(line));

    await panel.getByLabel('字母表').fill('abc');
    await expect(panel.getByLabel('预设')).toHaveValue('custom');
    await panel.getByLabel('长度（2–256）', { exact: true }).fill('10');
    await waitForEveryLine(page, (line) => /^[abc]{10}$/.test(line));

    await panel.getByLabel('字母表').fill('a');
    await expect(page.getByRole('alert')).toHaveText('字母表至少需要 2 个不同字符');
    await panel.getByLabel('字母表').fill('');
    await expect(page.getByRole('alert')).toHaveText('字母表不能为空');
    // 修正后错误自动消失
    await panel.getByLabel('字母表').fill('01');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await waitForEveryLine(page, (line) => /^[01]{10}$/.test(line));
  });

  test('长度越界给出中文错误', async ({ page }) => {
    await openToolFresh(page);
    await page.getByTestId('random-tab-nanoid').click();
    await page.getByTestId('random-nanoid-length').fill('1');
    await expect(page.getByRole('alert')).toHaveText('长度必须在 2 到 256 之间');
  });
});

test.describe('随机生成器：密码', () => {
  test('🖥 拖动长度到 32 → 结果长度 32，熵与强度显示更新', async ({ page }) => {
    await openToolFresh(page);
    await page.getByTestId('random-tab-password').click();
    const panel = page.getByTestId('random-panel-password');

    // 默认长度 16
    await expect(page.getByTestId('random-pw-length-input')).toHaveValue('16');
    const initial = await waitForEveryLine(page, (line) => line.length === 16);
    expect(initial).toHaveLength(1);
    await expect(page.getByTestId('random-pw-entropy')).toHaveText((16 * Math.log2(PASSWORD_POOL)).toFixed(1));
    await expect(page.getByTestId('random-pw-strength')).toHaveText('很强');

    // 键盘逐格拨到 32（与拖动滑块等效，每次触发 input）
    const slider = panel.getByLabel('长度（4–128）', { exact: true });
    await nudgeSlider(slider, 'ArrowRight', 16);
    await expect(page.getByTestId('random-pw-length-input')).toHaveValue('32');
    await waitForEveryLine(page, (line) => line.length === 32);
    await expect(page.getByTestId('random-pw-entropy')).toHaveText((32 * Math.log2(PASSWORD_POOL)).toFixed(1));

    // 拨回最小值 4 → 强度降为「弱」（强度显示随之更新）
    await nudgeSlider(slider, 'ArrowLeft', 28);
    await expect(page.getByTestId('random-pw-length-input')).toHaveValue('4');
    await waitForEveryLine(page, (line) => line.length === 4);
    await expect(page.getByTestId('random-pw-entropy')).toHaveText((4 * Math.log2(PASSWORD_POOL)).toFixed(1));
    await expect(page.getByTestId('random-pw-strength')).toHaveText('弱');
  });

  test('只选数字 → 纯数字且熵 53.2；四类 + 排除易混淆 → 不含 0O1lI 且每类至少一个', async ({ page }) => {
    await openToolFresh(page);
    await page.getByTestId('random-tab-password').click();
    const panel = page.getByTestId('random-panel-password');

    await panel.getByLabel('大写字母（A–Z）', { exact: true }).uncheck();
    await panel.getByLabel('小写字母（a–z）', { exact: true }).uncheck();
    await panel.getByLabel(/符号（/).uncheck();
    await expect(page.getByTestId('random-pw-entropy')).toHaveText('53.2');
    await waitForEveryLine(page, (line) => /^\d{16}$/.test(line));

    await panel.getByLabel('大写字母（A–Z）', { exact: true }).check();
    await panel.getByLabel('小写字母（a–z）', { exact: true }).check();
    await panel.getByLabel(/符号（/).check();
    await panel.getByLabel(/排除易混淆字符/).check();
    const safe = await waitForEveryLine(
      page,
      (line) => /[A-Z]/.test(line) && /[a-z]/.test(line) && /\d/.test(line) && SYMBOL_RE.test(line) && !/[0O1lI]/.test(line),
    );
    expect(safe.length).toBeGreaterThan(0);
    // 批量也满足：数量 20，逐行校验
    await page.getByLabel('数量').fill('20');
    const batch = await waitForLines(page, 20);
    for (const line of batch) {
      expect(line).not.toMatch(/[0O1lI]/);
      expect(line).toMatch(/[A-Z]/);
      expect(line).toMatch(/[a-z]/);
      expect(line).toMatch(/\d/);
      expect(line).toMatch(SYMBOL_RE);
      expect(line).toHaveLength(16);
    }
  });

  test('长度 3 且选 4 类 →「长度不能小于所选字符类别数」；一个类别都不选 →「请至少选择一种字符」', async ({ page }) => {
    await openToolFresh(page);
    await page.getByTestId('random-tab-password').click();
    const panel = page.getByTestId('random-panel-password');

    await page.getByTestId('random-pw-length-input').fill('3');
    await expect(page.getByRole('alert')).toHaveText('长度不能小于所选字符类别数');

    await page.getByTestId('random-pw-length-input').fill('16');
    await expect(page.getByRole('alert')).toHaveCount(0);

    await panel.getByLabel('大写字母（A–Z）', { exact: true }).uncheck();
    await panel.getByLabel('小写字母（a–z）', { exact: true }).uncheck();
    await panel.getByLabel('数字（0–9）', { exact: true }).uncheck();
    await panel.getByLabel(/符号（/).uncheck();
    await expect(page.getByRole('alert')).toHaveText('请至少选择一种字符');
  });
});

test.describe('随机生成器：解析', () => {
  test.beforeEach(async ({ page }) => {
    await openToolFresh(page);
    await page.getByTestId('random-tab-parse').click();
    await expect(page.getByTestId('random-panel-parse')).toBeVisible();
  });

  test('017f22e2-79b0-7cc3-98c4-dc0c0c07398f → 版本 7、变体 RFC 9562、时间 2022-02-22 19:22:22.000 UTC', async ({ page }) => {
    await page.getByTestId('random-parse-input').fill('017f22e2-79b0-7cc3-98c4-dc0c0c07398f');
    await expect(page.getByTestId('random-parse-type')).toHaveText('UUID');
    await expect(page.getByTestId('random-parse-version')).toHaveText(/^7（时间有序/);
    await expect(page.getByTestId('random-parse-variant')).toHaveText('RFC 9562 / RFC 4122');
    await expect(page.getByTestId('random-parse-timestamp')).toHaveText('1645557742000');
    await expect(page.getByTestId('random-parse-utc')).toHaveText('2022-02-22 19:22:22.000 UTC');
    // 本地时间随运行环境时区而不同，只校验格式
    await expect(page.getByTestId('random-parse-local')).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  test('01ARZ3NDEKTSV4RRFFQ69G5FAV → 时间戳 1469922850259 即 2016-07-30 23:54:10.259 UTC', async ({ page }) => {
    await page.getByTestId('random-parse-input').fill('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    await expect(page.getByTestId('random-parse-type')).toHaveText('ULID');
    await expect(page.getByTestId('random-parse-timestamp')).toHaveText('1469922850259');
    await expect(page.getByTestId('random-parse-utc')).toHaveText('2016-07-30 23:54:10.259 UTC');
    await expect(page.getByTestId('random-parse-randomness')).toHaveText('TSV4RRFFQ69G5FAV');
  });

  test('xyz →「无法识别为 UUID 或 ULID」；清空后错误消失', async ({ page }) => {
    await page.getByTestId('random-parse-input').fill('xyz');
    await expect(page.getByRole('alert')).toHaveText('无法识别为 UUID 或 ULID');
    await page.getByTestId('random-parse-input').fill('');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('random-parse-list')).toHaveCount(0);
  });

  test('「复制解析结果」写入剪贴板，与页面内容一致', async ({ page }) => {
    await page.getByTestId('random-parse-input').fill('017f22e2-79b0-7cc3-98c4-dc0c0c07398f');
    await expect(page.getByTestId('random-parse-version')).toBeVisible();

    await page.getByRole('button', { name: '复制解析结果' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('版本：7（时间有序，Unix 毫秒）');
    expect(clipboard).toContain('UTC 时间：2022-02-22 19:22:22.000 UTC');
  });
});

test.describe('随机生成器：记忆与恢复', () => {
  test('刷新后恢复上次的标签、数量与选项（ctx.storage）', async ({ page }) => {
    await openToolFresh(page);
    await page.getByTestId('random-tab-ulid').click();
    await page.getByTestId('random-panel-ulid').getByLabel('大写', { exact: true }).uncheck();
    await page.getByLabel('数量').fill('3');
    const before = await waitForEveryLine(page, (line) => ULID_LOWER_RE.test(line));
    expect(before).toHaveLength(3);

    await page.reload();
    await page.locator('[data-tool-ready="random"]').waitFor({ state: 'attached' });
    await expect(page.getByTestId('random-panel-ulid')).toBeVisible();
    await expect(page.getByTestId('random-panel-uuid')).toBeHidden();
    await expect(page.getByLabel('数量')).toHaveValue('3');
    const after = await waitForEveryLine(page, (line) => ULID_LOWER_RE.test(line));
    expect(after).toHaveLength(3);
    // ctx.storage 的值经 JSON 序列化存储
    const stored = await page.evaluate(() => localStorage.getItem('glm-toolbox:random:tab'));
    expect(JSON.parse(stored)).toBe('ulid');
  });
});

test.describe('随机生成器：主题与响应式', () => {
  for (const theme of ['light', 'dark']) {
    test(`${theme} 主题下打开并正常使用`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('glm-toolbox:theme', t), theme);
      await openTool(page, 'random');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      // 生成类标签可用
      const lines = await outputLines(page);
      expect(lines[0]).toMatch(UUID_V4_RE);
      // 解析标签可用
      await page.getByTestId('random-tab-parse').click();
      await page.getByTestId('random-parse-input').fill('01ARZ3NDEKTSV4RRFFQ69G5FAV');
      await expect(page.getByTestId('random-parse-timestamp')).toHaveText('1469922850259');
    });
  }

  test('375×667 视口下无横向滚动，各标签页都能完成基本操作', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openToolFresh(page);

    await page.getByLabel('数量').fill('5');
    await waitForLines(page, 5);

    for (const tab of ['ulid', 'nanoid', 'password', 'parse']) {
      await page.getByTestId(`random-tab-${tab}`).click();
      await expect(page.getByTestId(`random-panel-${tab}`)).toBeVisible();
    }
    await page.getByTestId('random-parse-input').fill('017f22e2-79b0-7cc3-98c4-dc0c0c07398f');
    await expect(page.getByTestId('random-parse-utc')).toHaveText('2022-02-22 19:22:22.000 UTC');

    const overflowed = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      return doc.scrollWidth - doc.clientWidth > 0 || body.scrollWidth - body.clientWidth > 0;
    });
    expect(overflowed).toBe(false);
  });
});
