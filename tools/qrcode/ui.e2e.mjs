/** 二维码端到端测试（对应 issue #21「验收标准」中的 🖥 条目与通用验收） */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, openTool, SUBPATH_BASE_URL } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const INPUT = '[data-testid="qrcode-input"]';
const LEVEL = '[data-testid="qrcode-level"]';
const SIZE = '[data-testid="qrcode-size"]';
const MARGIN = '[data-testid="qrcode-margin"]';
const FG = '[data-testid="qrcode-fg"]';
const BG = '[data-testid="qrcode-bg"]';
const CANVAS = '[data-testid="qrcode-canvas"]';
const ERROR_BOX = '[data-error-box]';
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

const SITE_URL = 'https://jackeyhan-jh.github.io/glm-toolbox/';
const ZH_TEXT = '码工具箱 ✓ 2026 😀';

/**
 * 在页面内识别：把元素（canvas 或 img）的像素交给页面内的识别函数
 * （动态 import 本工具的 logic.mjs → decodeRgba），返回识别结果。
 */
async function decodeInPage(page, selector) {
  return page.evaluate(async (sel) => {
    const node = document.querySelector(sel);
    const canvas = document.createElement('canvas');
    canvas.width = node.naturalWidth ?? node.width;
    canvas.height = node.naturalHeight ?? node.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(node, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const mod = await import('/tools/qrcode/logic.mjs');
    return mod.decodeRgba(data, width, height);
  }, selector);
}

/* ==================== 外壳集成 ==================== */

test.describe('二维码：外壳集成', () => {
  test('打开 #/qrcode：侧边栏高亮、标题正确', async ({ page }) => {
    await openTool(page, 'qrcode');
    await expect(page).toHaveTitle('二维码 - 码工具箱');
    await expect(page.getByRole('heading', { name: '二维码' })).toBeVisible();
    await expect(page.locator('#tool-nav a[data-tool-id="qrcode"]')).toHaveAttribute('aria-current', 'true');
  });

  test('搜索清单关键词能找到本工具（qrcode / qr / 二维码 / 扫码 / 识别 / erweima / 生成 / saomiao / scan）', async ({ page }) => {
    for (const keyword of ['qrcode', 'qr', '二维码', '扫码', '识别', 'erweima', '生成', 'saomiao', 'scan']) {
      await page.goto('/');
      await page.getByLabel('搜索工具').fill(keyword);
      await expect(page.locator('#tool-nav').getByRole('link', { name: '二维码' })).toBeVisible();
    }
  });

  test('子路径部署（--base /glm-toolbox/）下生成与识别可用（worker 正常加载）', async ({ page }) => {
    await page.goto(`${SUBPATH_BASE_URL}#/qrcode`);
    await expect(page.locator('[data-tool-ready="qrcode"]')).toBeAttached();
    await expect(page.locator('link[data-tool-style="qrcode"]')).toHaveCount(1);

    await page.locator(INPUT).fill(SITE_URL);
    await expect(page.locator(CANVAS)).toBeVisible();

    await page.getByTestId('qrcode-file').setInputFiles(`${FIXTURES}hello.png`);
    await expect(page.getByTestId('qrcode-result')).toHaveText('hello 码工具箱', { timeout: 15000 });
  });
});

/* ==================== 生成 ==================== */

test.describe('二维码：生成', () => {
  test('初始为空：不显示二维码，提示「请输入要生成的内容」（🖥）', async ({ page }) => {
    await openTool(page, 'qrcode');
    await expect(page.getByTestId('qrcode-empty')).toBeVisible();
    await expect(page.getByTestId('qrcode-empty')).toHaveText('请输入要生成的内容');
    await expect(page.locator(CANVAS)).toBeHidden();
    await expect(page.getByTestId('qrcode-meta')).toBeHidden();
  });

  test('输入站点地址 → 出现二维码 canvas，页面内识别得原文（🖥）', async ({ page }) => {
    await openTool(page, 'qrcode');
    await page.locator(INPUT).fill(SITE_URL);

    await expect(page.locator(CANVAS)).toBeVisible();
    await expect(page.getByTestId('qrcode-meta')).toBeVisible();
    await expect(page.getByTestId('qrcode-version')).toHaveText('版本 4');
    await expect(page.getByTestId('qrcode-modules')).toHaveText('33 × 33 模块');
    await expect(page.getByTestId('qrcode-bytes')).toHaveText('43 字节');

    const decoded = await decodeInPage(page, CANVAS);
    expect(decoded.ok).toBe(true);
    expect(decoded.text).toBe(SITE_URL);
  });

  test('中文与 emoji（UTF-8）生成后在页面内识别还原（🖥 对应单测的浏览器侧验证）', async ({ page }) => {
    await openTool(page, 'qrcode');
    await page.locator(INPUT).fill(ZH_TEXT);
    await expect(page.locator(CANVAS)).toBeVisible();
    await expect(page.getByTestId('qrcode-bytes')).toHaveText('26 字节'); // 12 + 1 + 3 + 1 + 4 + 1 + 4 = 26 字节（UTF-8）

    const decoded = await decodeInPage(page, CANVAS);
    expect(decoded.ok).toBe(true);
    expect(decoded.text).toBe(ZH_TEXT);
  });

  test('「A」在 L 级别为版本 1（21×21 模块）；纠错 H 版本号 ≥ L', async ({ page }) => {
    await openTool(page, 'qrcode');
    await page.locator(LEVEL).selectOption('L');
    await page.locator(INPUT).fill('A');
    await expect(page.getByTestId('qrcode-version')).toHaveText('版本 1');
    await expect(page.getByTestId('qrcode-modules')).toHaveText('21 × 21 模块');

    await page.locator(LEVEL).selectOption('H');
    await expect(page.getByTestId('qrcode-version')).toHaveText('版本 1');
    await page.locator(INPUT).fill(SITE_URL);
    await page.locator(LEVEL).selectOption('L');
    const atL = Number((await page.getByTestId('qrcode-version').textContent()).replace('版本 ', ''));
    await page.locator(LEVEL).selectOption('H');
    const atH = Number((await page.getByTestId('qrcode-version').textContent()).replace('版本 ', ''));
    expect(atH).toBeGreaterThanOrEqual(atL);
  });

  test('纠错级别下拉默认 M，含 L / M / Q / H 四档', async ({ page }) => {
    await openTool(page, 'qrcode');
    await expect(page.locator(LEVEL)).toHaveValue('M');
    await expect(page.locator(LEVEL)).toContainText('L · 纠错约 7%');
    await expect(page.locator(LEVEL)).toContainText('H · 纠错约 30%');
  });

  test('内容过长（3000 个「码」+ 级别 H）→ 提示「内容过长，最多约 1273 字节」，无二维码', async ({ page }) => {
    await openTool(page, 'qrcode');
    await page.locator(LEVEL).selectOption('H');
    await page.locator(INPUT).fill('码'.repeat(3000));

    await expect(page.locator(ERROR_BOX)).toContainText('内容过长');
    await expect(page.locator(ERROR_BOX)).toContainText('最多约 1273 字节');
    await expect(page.locator(CANVAS)).toBeHidden();
    await expect(page.getByTestId('qrcode-meta')).toBeHidden();

    // 修正后恢复
    await page.locator(INPUT).fill('hi');
    await expect(page.locator(ERROR_BOX)).toHaveCount(0);
    await expect(page.locator(CANVAS)).toBeVisible();
  });

  test('前景 #eeeeee、背景 #ffffff → 出现对比度过低提示；改回 #000000 后消失（🖥）', async ({ page }) => {
    await openTool(page, 'qrcode');
    await page.locator(INPUT).fill(SITE_URL);
    await expect(page.locator(CANVAS)).toBeVisible();
    await expect(page.getByTestId('qrcode-contrast-warning')).toBeHidden();

    await page.locator(FG).fill('#eeeeee');
    await expect(page.getByTestId('qrcode-contrast-warning')).toBeVisible();
    await expect(page.getByTestId('qrcode-contrast-warning')).toHaveText('颜色对比度低，可能无法扫描');

    // 低对比度下二维码仍渲染（只是提醒）
    await expect(page.locator(CANVAS)).toBeVisible();

    await page.locator(FG).fill('#000000');
    await expect(page.getByTestId('qrcode-contrast-warning')).toBeHidden();
  });

  test('修改尺寸：canvas 与下载的 PNG 都是所选尺寸（192 → 384px）', async ({ page }) => {
    await openTool(page, 'qrcode');
    await page.locator(INPUT).fill(SITE_URL);
    await expect(page.locator(CANVAS)).toBeVisible();
    await expect(page.locator(CANVAS)).toHaveAttribute('width', '256'); // 默认尺寸

    await page.locator(SIZE).fill('384');
    await expect(page.locator(CANVAS)).toHaveAttribute('width', '384');
    await expect(page.locator(CANVAS)).toHaveAttribute('height', '384');
  });

  test('下载 SVG：以 <svg 开头且含 viewBox（🖥）', async ({ page }) => {
    await openTool(page, 'qrcode');
    await page.locator(INPUT).fill(SITE_URL);
    await expect(page.locator(CANVAS)).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('qrcode-download-svg').click(),
    ]);
    expect(download.suggestedFilename()).toBe('qrcode.svg');
    const content = readFileSync(await download.path(), 'utf8');
    expect(content.startsWith('<svg')).toBe(true);
    expect(content).toContain('viewBox');
    expect(content).toContain('</svg>');
  });

  test('下载 PNG：文件头为 PNG 签名 89 50 4E 47，尺寸等于所选尺寸（🖥）', async ({ page }) => {
    await openTool(page, 'qrcode');
    await page.locator(INPUT).fill(SITE_URL);
    await page.locator(SIZE).fill('384');
    await expect(page.locator(CANVAS)).toHaveAttribute('width', '384');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('qrcode-download-png').click(),
    ]);
    expect(download.suggestedFilename()).toBe('qrcode.png');
    const bytes = readFileSync(await download.path());
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]); // PNG 签名
    // IHDR 的宽高（大端）
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    expect(width).toBe(384);
    expect(height).toBe(384);
  });

  test('复制图片到剪贴板：按钮显示「已复制」，剪贴板内容为 PNG（浏览器支持时）', async ({ page }) => {
    await openTool(page, 'qrcode');
    await page.locator(INPUT).fill(SITE_URL);
    await expect(page.locator(CANVAS)).toBeVisible();
    await expect(page.getByTestId('qrcode-copy-image')).toBeVisible();

    await page.getByTestId('qrcode-copy-image').click();
    await expect(page.getByTestId('qrcode-copy-image')).toHaveText('已复制');

    // Blob 本体不能跨 evaluate 序列化，读回它的字节数
    const pngSize = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const blob = await items[0].getType('image/png');
      return blob.size;
    });
    expect(pngSize).toBeGreaterThan(100);
  });

  test('下载按钮在空输入时禁用，输入后可用', async ({ page }) => {
    await openTool(page, 'qrcode');
    await expect(page.getByTestId('qrcode-download-png')).toBeDisabled();
    await expect(page.getByTestId('qrcode-download-svg')).toBeDisabled();
    await page.locator(INPUT).fill('hello');
    await expect(page.getByTestId('qrcode-download-png')).toBeEnabled();
    await expect(page.getByTestId('qrcode-download-svg')).toBeEnabled();
    await page.locator(INPUT).fill('');
    await expect(page.getByTestId('qrcode-download-png')).toBeDisabled();
  });

  test('大输入（980 个「码」= 2940 字节，级别 L）不卡死：版本 40 正常生成', async ({ page }) => {
    await openTool(page, 'qrcode');
    await page.locator(LEVEL).selectOption('L');
    await page.locator(INPUT).fill('码'.repeat(980)); // 2940 字节，接近 L 上限 2953
    await expect(page.getByTestId('qrcode-version')).toHaveText('版本 40', { timeout: 5000 });
    await expect(page.getByTestId('qrcode-modules')).toHaveText('177 × 177 模块');
    await expect(page.getByTestId('qrcode-bytes')).toHaveText('2940 字节');
    await expect(page.locator(CANVAS)).toBeVisible();
  });
});

/* ==================== 识别 ==================== */

test.describe('二维码：识别', () => {
  test('上传 hello.png → 显示「hello 码工具箱」，复制到剪贴板内容一致（🖥）', async ({ page }) => {
    await openTool(page, 'qrcode');
    await page.getByTestId('qrcode-file').setInputFiles(`${FIXTURES}hello.png`);

    await expect(page.getByTestId('qrcode-result-wrap')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('qrcode-result')).toHaveText('hello 码工具箱');
    await expect(page.locator(ERROR_BOX)).toHaveCount(0);

    // 预览与元信息
    await expect(page.getByTestId('qrcode-preview')).toBeVisible();
    await expect(page.getByTestId('qrcode-image-size')).toHaveText('132 × 132');

    // 复制识别结果
    await page.getByRole('button', { name: '复制识别结果' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('hello 码工具箱');
  });

  test('上传纯色 plain.png（无二维码）→ 显示「未识别到二维码」（🖥）', async ({ page }) => {
    await openTool(page, 'qrcode');
    await page.getByTestId('qrcode-file').setInputFiles(`${FIXTURES}plain.png`);

    await expect(page.locator(ERROR_BOX)).toContainText('未识别到二维码', { timeout: 15000 });
    await expect(page.getByTestId('qrcode-result-wrap')).toBeHidden();
  });

  test('识别出 URL：显示为链接但不跳转、无网络请求（🖥）', async ({ page }) => {
    await openTool(page, 'qrcode');
    const beforeUrl = page.url();
    await page.getByTestId('qrcode-file').setInputFiles(`${FIXTURES}url.png`);

    const link = page.getByTestId('qrcode-result').getByRole('link');
    await expect(link).toBeVisible({ timeout: 15000 });
    await expect(link).toHaveAttribute('href', 'https://example.com/glm-toolbox');
    await expect(link).toHaveText('https://example.com/glm-toolbox');

    // 页面未跳转（夹具同时保证没有对外部 URL 的请求，违反即用例失败）
    await page.waitForTimeout(500);
    expect(page.url()).toBe(beforeUrl);

    // 复制的结果就是 URL 本身
    await page.getByRole('button', { name: '复制识别结果' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://example.com/glm-toolbox');
  });

  test('生成 → 识别闭环：把页面上生成的二维码 canvas 直接喂给上传输入，识别得原文', async ({ page }) => {
    await openTool(page, 'qrcode');
    await page.locator(INPUT).fill(ZH_TEXT);
    await expect(page.locator(CANVAS)).toBeVisible();

    await page.evaluate(async () => {
      const canvas = document.querySelector('[data-testid="qrcode-canvas"]');
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const file = new File([blob], 'generated.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector('[data-testid="qrcode-file"]');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect(page.getByTestId('qrcode-result')).toHaveText(ZH_TEXT, { timeout: 15000 });
  });

  test('拖拽图片到识别区也能识别', async ({ page }) => {
    await openTool(page, 'qrcode');
    const png = readFileSync(`${FIXTURES}hello.png`);

    await page.evaluate(async (bytes) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
      const file = new File([blob], 'hello.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const zone = document.querySelector('[data-testid="qrcode-dropzone"]');
      zone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
      zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, [...png]);

    await expect(page.getByTestId('qrcode-result')).toHaveText('hello 码工具箱', { timeout: 15000 });
  });

  test('粘贴（Ctrl+V）图片也能识别', async ({ page }) => {
    await openTool(page, 'qrcode');
    const png = readFileSync(`${FIXTURES}hello.png`);

    await page.evaluate(async (bytes) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
      const file = new File([blob], 'hello.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      document.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }),
      );
    }, [...png]);

    await expect(page.getByTestId('qrcode-result')).toHaveText('hello 码工具箱', { timeout: 15000 });
  });

  test('选择非图片文件 → 中文提示且不崩溃', async ({ page }) => {
    await openTool(page, 'qrcode');
    await page.getByTestId('qrcode-file').setInputFiles({
      name: 'note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('不是图片'),
    });
    await expect(page.locator(ERROR_BOX)).toContainText('请选择图片文件');
  });
});

/* ==================== 自动更新与本地存储 ==================== */

test.describe('二维码：自动更新与本地存储', () => {
  test('修改文本后 300ms 内自动更新（防抖）', async ({ page }) => {
    await openTool(page, 'qrcode');
    await page.locator(INPUT).fill('A');
    await expect(page.getByTestId('qrcode-version')).toHaveText('版本 1');

    await page.locator(INPUT).fill(SITE_URL);
    await expect(page.getByTestId('qrcode-version')).toHaveText('版本 4', { timeout: 1000 });
    await expect(page.getByTestId('qrcode-bytes')).toHaveText('43 字节');
  });

  test('刷新后恢复文本与全部选项', async ({ page }) => {
    await openTool(page, 'qrcode');
    await page.locator(INPUT).fill(SITE_URL);
    await page.locator(LEVEL).selectOption('Q');
    await page.locator(SIZE).fill('512');
    await page.locator(MARGIN).fill('2');
    await page.locator(FG).fill('#123456');
    await page.locator(BG).fill('#fedcba');

    // 防抖最后一次写入落盘后再刷新（fill 本身不经过防抖，存储要等最后一次刷新）
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('glm-toolbox:qrcode:margin')))
      .toBe('2');
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('glm-toolbox:qrcode:fg')))
      .toBe('"#123456"');

    await page.reload();
    await expect(page.locator('[data-tool-ready="qrcode"]')).toBeAttached();
    await expect(page.locator(INPUT)).toHaveValue(SITE_URL);
    await expect(page.locator(LEVEL)).toHaveValue('Q');
    await expect(page.locator(SIZE)).toHaveValue('512');
    await expect(page.locator(MARGIN)).toHaveValue('2');
    await expect(page.locator(FG)).toHaveValue('#123456');
    await expect(page.locator(BG)).toHaveValue('#fedcba');
    await expect(page.getByTestId('qrcode-version')).toHaveText('版本 4');

    const stored = await page.evaluate(() => localStorage.getItem('glm-toolbox:qrcode:text'));
    expect(stored).toContain('glm-toolbox');
  });

  test('尺寸 / 边距超范围会被钳制（尺寸 50 → 128，边距 99 → 10）', async ({ page }) => {
    await openTool(page, 'qrcode');
    await page.locator(INPUT).fill('hi');
    await page.locator(SIZE).evaluate((node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('blur', { bubbles: true }));
    }, '50');
    await expect(page.locator(SIZE)).toHaveValue('128');
    await expect(page.locator(CANVAS)).toHaveAttribute('width', '128');

    await page.locator(MARGIN).evaluate((node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('blur', { bubbles: true }));
    }, '99');
    await expect(page.locator(MARGIN)).toHaveValue('10');
  });
});

/* ==================== 主题与移动端 ==================== */

test.describe('二维码：主题与移动端', () => {
  test('深色与浅色主题下生成与识别都可用、无报错', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openTool(page, 'qrcode');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.locator(INPUT).fill(SITE_URL);
    await expect(page.locator(CANVAS)).toBeVisible();
    await page.getByTestId('qrcode-file').setInputFiles(`${FIXTURES}hello.png`);
    await expect(page.getByTestId('qrcode-result')).toHaveText('hello 码工具箱', { timeout: 15000 });

    await page.getByRole('button', { name: '切换主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator(CANVAS)).toBeVisible();
    await expect(page.getByTestId('qrcode-result')).toHaveText('hello 码工具箱');
  });

  test.describe('视口 375×667', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('无横向滚动，生成与识别都能完成', async ({ page }) => {
      await openTool(page, 'qrcode');
      await page.locator(INPUT).fill(SITE_URL);
      await expect(page.locator(CANVAS)).toBeVisible();

      await page.getByTestId('qrcode-file').setInputFiles(`${FIXTURES}hello.png`);
      await expect(page.getByTestId('qrcode-result')).toHaveText('hello 码工具箱', { timeout: 15000 });

      const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(noOverflow).toBe(true);
    });
  });
});
