/** Base64 编解码端到端测试（对应 issue #7「Base64 编解码」验收标准） */

import fs from 'node:fs';
import { test, expect, openTool, SUBPATH_BASE_URL } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板；下载用例需要接受下载
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const fixtureUrl = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const PNG_BYTES = fs.readFileSync(fixtureUrl('pixel.png'));
const PNG_BASE64 = PNG_BYTES.toString('base64');
const NOTE_BYTES = fs.readFileSync(fixtureUrl('note.txt'));
const NOTE_BASE64 = NOTE_BYTES.toString('base64');

const TEXT_INPUT = '[data-testid="base64-text-input"]';
const TEXT_OUTPUT = '[data-testid="base64-text-output"]';

test.describe('Base64：外壳集成', () => {
  test('打开 #/base64：侧边栏高亮、标题正确', async ({ page }) => {
    await openTool(page, 'base64');
    await expect(page).toHaveTitle('Base64 - 码工具箱');
    await expect(page.getByRole('heading', { name: 'Base64' })).toBeVisible();
    await expect(page.locator('#tool-nav a[data-tool-id="base64"]')).toHaveAttribute('aria-current', 'true');
  });

  test('搜索清单关键词能找到本工具（base64 / b64 / bianma）', async ({ page }) => {
    for (const keyword of ['base64', 'b64', 'bianma']) {
      await page.goto('/');
      await page.getByLabel('搜索工具').fill(keyword);
      await expect(page.locator('#tool-nav').getByRole('link', { name: 'Base64' })).toBeVisible();
    }
  });

  test('子路径部署（--base /glm-toolbox/）下工具可用', async ({ page }) => {
    await page.goto(`${SUBPATH_BASE_URL}#\/base64`);
    await expect(page.locator('[data-tool-ready="base64"]')).toBeAttached();
    await expect(page.locator('link[data-tool-style="base64"]')).toHaveCount(1);
    await page.locator(TEXT_INPUT).fill('Hi 码');
    await expect(page.locator(TEXT_OUTPUT)).toHaveText('SGkg56CB');
  });
});

test.describe('Base64：文本模式', () => {
  test('编码：码工具箱 → 56CB5bel5YW3566x；Hi 码 → SGkg56CB', async ({ page }) => {
    await openTool(page, 'base64');
    await page.locator(TEXT_INPUT).fill('码工具箱');
    await expect(page.locator(TEXT_OUTPUT)).toHaveText('56CB5bel5YW3566x');
    await expect(page.getByTestId('base64-text-input-stats')).toHaveText('输入 4 字符 · 12 字节（UTF-8）');
    await expect(page.getByTestId('base64-text-output-count')).toHaveText('16 字符');

    await page.locator(TEXT_INPUT).fill('Hi 码');
    await expect(page.locator(TEXT_OUTPUT)).toHaveText('SGkg56CB');
    await expect(page.getByTestId('base64-text-input-stats')).toHaveText('输入 4 字符 · 6 字节（UTF-8）');
  });

  test('编码：hello?>~ → aGVsbG8/Pn4=；URL 安全 → aGVsbG8_Pn4', async ({ page }) => {
    await openTool(page, 'base64');
    await page.locator(TEXT_INPUT).fill('hello?>~');
    await expect(page.locator(TEXT_OUTPUT)).toHaveText('aGVsbG8/Pn4=');

    await page.getByLabel('URL 安全').check();
    await expect(page.locator(TEXT_OUTPUT)).toHaveText('aGVsbG8_Pn4');

    // 取消勾选恢复标准字母表
    await page.getByLabel('URL 安全').uncheck();
    await expect(page.locator(TEXT_OUTPUT)).toHaveText('aGVsbG8/Pn4=');
  });

  test('解码：缺填充 / 含换行 / URL 安全字母表', async ({ page }) => {
    await openTool(page, 'base64');
    await page.getByRole('button', { name: '解码', exact: true }).click();

    await page.locator(TEXT_INPUT).fill('aGVsbG8');
    await expect(page.locator(TEXT_OUTPUT)).toHaveText('hello');

    await page.locator(TEXT_INPUT).fill('aGVs\nbG8=');
    await expect(page.locator(TEXT_OUTPUT)).toHaveText('hello');

    await page.locator(TEXT_INPUT).fill('aGVsbG8_Pn4');
    await expect(page.locator(TEXT_OUTPUT)).toHaveText('hello?>~');

    await expect(page.getByTestId('base64-text-output-count')).toHaveText('8 字节');
  });

  test('解码：abc$ → 提示包含非法字符「$」（第 4 个字符）', async ({ page }) => {
    await openTool(page, 'base64');
    await page.getByRole('button', { name: '解码', exact: true }).click();
    await page.locator(TEXT_INPUT).fill('abc$');
    await expect(page.getByRole('alert')).toHaveText('包含非法字符「$」（第 4 个字符）');
    // 修正输入后错误自动消失
    await page.locator(TEXT_INPUT).fill('aGVsbG8');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator(TEXT_OUTPUT)).toHaveText('hello');
  });

  test('解码：长度非法 a → 中文提示（Base64 长度不正确）', async ({ page }) => {
    await openTool(page, 'base64');
    await page.getByRole('button', { name: '解码', exact: true }).click();
    await page.locator(TEXT_INPUT).fill('a');
    await expect(page.getByRole('alert')).toContainText('Base64 长度不正确');
  });

  test('解码：/w== → 不是有效 UTF-8，十六进制预览 ff，可下载为文件', async ({ page }) => {
    await openTool(page, 'base64');
    await page.getByRole('button', { name: '解码', exact: true }).click();
    await page.locator(TEXT_INPUT).fill('/w==');
    await expect(page.getByRole('alert')).toContainText('解码结果不是有效的 UTF-8 文本');
    await expect(page.getByTestId('base64-hex')).toHaveText('ff');
    await expect(page.getByTestId('base64-download-bytes')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('base64-download-bytes').click(),
    ]);
    expect(await download.suggestedFilename()).toBe('decoded.bin');
    const saved = fs.readFileSync(await download.path());
    expect(saved.equals(Buffer.from([0xff]))).toBe(true);
  });

  test('空输入 → 空输出，不报错（编码与解码两个方向）', async ({ page }) => {
    await openTool(page, 'base64');
    await expect(page.locator(TEXT_OUTPUT)).toHaveText('');
    await expect(page.getByRole('alert')).toHaveCount(0);

    await page.getByRole('button', { name: '解码', exact: true }).click();
    await page.locator(TEXT_INPUT).fill('');
    await expect(page.locator(TEXT_OUTPUT)).toHaveText('');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('「复制结果」写入剪贴板；超长输出截断显示但复制 / 下载完整结果', async ({ page }) => {
    await openTool(page, 'base64');
    await page.locator(TEXT_INPUT).fill('码工具箱');
    await expect(page.locator(TEXT_OUTPUT)).toHaveText('56CB5bel5YW3566x');

    await page.getByRole('button', { name: '复制结果' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('56CB5bel5YW3566x');

    // 2 万字符输入 → 输出 26668 字符，只显示前 1 万
    const expected = Buffer.from('a'.repeat(20000), 'utf8').toString('base64');
    await page.locator(TEXT_INPUT).fill('a'.repeat(20000));
    await expect(page.getByTestId('base64-text-output-truncated')).toBeVisible();
    await expect(page.getByTestId('base64-text-output-truncated')).toHaveText(
      '已截断显示，可复制 / 下载完整结果',
    );
    expect((await page.locator(TEXT_OUTPUT).textContent()).length).toBe(10000);

    // 复制到的是完整结果
    await page.getByRole('button', { name: '复制结果' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);

    // 下载完整结果
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '下载完整结果' }).click(),
    ]);
    expect(await download.suggestedFilename()).toBe('base64-result.txt');
    expect(fs.readFileSync(await download.path(), 'utf8')).toBe(expected);
  });
});

test.describe('Base64：图片模式', () => {
  test.beforeEach(async ({ page }) => {
    await openTool(page, 'base64');
    await page.getByRole('button', { name: '图片', exact: true }).click();
    await expect(page.getByTestId('base64-panel-image')).toBeVisible();
  });

  test('上传 1×1 PNG：预览、尺寸、大小、MIME、data URL 与纯 Base64', async ({ page }) => {
    await page.getByTestId('base64-image-file').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PNG_BYTES });

    // <img> 的 naturalWidth === 1（真实解码）
    await expect(page.getByTestId('base64-img-meta')).toBeVisible();
    await expect(page.getByTestId('base64-img-size')).toHaveText('1 × 1');
    expect(await page.getByTestId('base64-img-preview').evaluate((img) => img.naturalWidth)).toBe(1);
    expect(await page.getByTestId('base64-img-preview').evaluate((img) => img.naturalHeight)).toBe(1);

    await expect(page.getByTestId('base64-img-bytes')).toHaveText('70 字节');
    await expect(page.getByTestId('base64-img-mime')).toHaveText('image/png');

    const dataUrl = await page.getByTestId('base64-dataurl-output').textContent();
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(dataUrl).toBe(`data:image/png;base64,${PNG_BASE64}`);
    await expect(page.getByTestId('base64-b64-output')).toHaveText(PNG_BASE64);
    await expect(page.getByTestId('base64-dataurl-output-count')).toHaveText(`${dataUrl.length} 字符`);
  });

  test('粘贴上一步的 data URL 反向还原：预览出现，下载文件与 fixture 字节一致', async ({ page }) => {
    await page.getByTestId('base64-img-input').fill(`data:image/png;base64,${PNG_BASE64}`);
    await expect(page.getByTestId('base64-img-rev-meta')).toBeVisible();
    await expect(page.getByTestId('base64-img-rev-size')).toHaveText('1 × 1');
    expect(await page.getByTestId('base64-img-rev-preview').evaluate((img) => img.naturalWidth)).toBe(1);
    await expect(page.getByTestId('base64-img-rev-mime')).toHaveText('image/png');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('base64-img-download').click(),
    ]);
    expect(await download.suggestedFilename()).toBe('image.png');
    const saved = fs.readFileSync(await download.path());
    expect(saved.equals(PNG_BYTES)).toBe(true); // 与 fixture 逐字节一致
  });

  test('纯 Base64 + 自动检测 MIME 同样可还原', async ({ page }) => {
    await page.getByTestId('base64-img-input').fill(PNG_BASE64);
    await expect(page.getByTestId('base64-img-rev-meta')).toBeVisible();
    await expect(page.getByTestId('base64-img-rev-mime')).toHaveText('image/png');
    await expect(page.getByTestId('base64-img-rev-bytes')).toHaveText('70 字节');
  });

  test('「复制 Data URL」写入剪贴板', async ({ page }) => {
    await page.getByTestId('base64-image-file').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PNG_BYTES });
    await expect(page.getByTestId('base64-b64-output')).toHaveText(PNG_BASE64);

    await page.getByRole('button', { name: '复制 Data URL' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`data:image/png;base64,${PNG_BASE64}`);
  });
});

test.describe('Base64：文件模式', () => {
  test.beforeEach(async ({ page }) => {
    await openTool(page, 'base64');
    await page.getByRole('button', { name: '文件', exact: true }).click();
    await expect(page.getByTestId('base64-panel-file')).toBeVisible();
  });

  test('上传文本 fixture：输出与 Node Buffer.toString("base64") 一致', async ({ page }) => {
    await page.getByTestId('base64-file-input').setInputFiles(fixtureUrl('note.txt').pathname);
    await expect(page.getByTestId('base64-file-output')).toHaveText(NOTE_BASE64);
    await expect(page.getByTestId('base64-file-meta')).toContainText('note.txt');
    await expect(page.getByTestId('base64-file-output-count')).toHaveText(`${NOTE_BASE64.length} 字符`);
  });

  test('Base64 → 文件：可自定义文件名，下载内容与源一致', async ({ page }) => {
    await page.getByTestId('base64-file-b64-input').fill(NOTE_BASE64);
    await expect(page.getByTestId('base64-file-rev-stats')).toContainText('字节');
    await expect(page.getByTestId('base64-file-download')).toBeEnabled();

    await page.getByTestId('base64-file-name-input').fill('还原的笔记.txt');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('base64-file-download').click(),
    ]);
    expect(await download.suggestedFilename()).toBe('还原的笔记.txt');
    expect(fs.readFileSync(await download.path(), 'utf8')).toBe(NOTE_BYTES.toString('utf8'));
  });

  test('Base64 → 文件：非法输入给出中文提示，下载不可用', async ({ page }) => {
    await page.getByTestId('base64-file-b64-input').fill('abc$');
    await expect(page.getByRole('alert')).toHaveText('包含非法字符「$」（第 4 个字符）');
    await expect(page.getByTestId('base64-file-download')).toBeDisabled();
  });

  test('超过 20MB 的文件被拒绝并给出中文提示', async ({ page }) => {
    const tooBig = Buffer.alloc(20 * 1024 * 1024 + 1, 0x61);
    await page.getByTestId('base64-file-input').setInputFiles({ name: 'big.bin', mimeType: 'application/octet-stream', buffer: tooBig });
    await expect(page.getByRole('alert')).toContainText('文件过大');
    await expect(page.getByRole('alert')).toContainText('20.0 MB');
  });

  test('性能：5MB 文件编码在 2 秒内完成且页面不卡死（超长只显示前 1 万字符）', async ({ page }) => {
    const big = Buffer.alloc(5 * 1024 * 1024, 0x61); // 'a' × 5MB
    const expected = big.toString('base64');
    const startedAt = Date.now();
    await page.getByTestId('base64-file-input').setInputFiles({ name: 'perf-5mb.bin', mimeType: 'application/octet-stream', buffer: big });

    await expect(page.getByTestId('base64-file-output-truncated')).toBeVisible({ timeout: 2000 });
    await expect(page.getByTestId('base64-file-output-truncated')).toHaveText(
      '已截断显示，可复制 / 下载完整结果',
    );
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect((await page.getByTestId('base64-file-output').textContent()).length).toBe(10000);
    await expect(page.getByTestId('base64-file-output-count')).toHaveText(`${expected.length} 字符`);

    // 页面仍可交互（未卡死）：切换模式并继续编码
    await page.getByRole('button', { name: '文本', exact: true }).click();
    await expect(page.getByTestId('base64-panel-text')).toBeVisible();
    await page.locator(TEXT_INPUT).fill('码工具箱');
    await expect(page.locator(TEXT_OUTPUT)).toHaveText('56CB5bel5YW3566x');

    // 复制到的仍是完整结果
    await page.getByRole('button', { name: '文件', exact: true }).click();
    await page.getByRole('button', { name: '复制结果' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  });
});

test.describe('Base64：主题与移动端', () => {
  test('深色与浅色主题下界面都可用、无报错', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openTool(page, 'base64');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator(TEXT_INPUT).fill('码工具箱');
    await expect(page.locator(TEXT_OUTPUT)).toHaveText('56CB5bel5YW3566x');

    await page.getByRole('button', { name: '切换主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator(TEXT_INPUT).fill('Hi 码');
    await expect(page.locator(TEXT_OUTPUT)).toHaveText('SGkg56CB');

    // 图片模式在浅色主题下也正常
    await page.getByRole('button', { name: '图片', exact: true }).click();
    await page.getByTestId('base64-image-file').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PNG_BYTES });
    await expect(page.getByTestId('base64-img-size')).toHaveText('1 × 1');
  });

  test.describe('视口 375×667', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('无横向滚动，三种模式都能完成基本操作', async ({ page }) => {
      await openTool(page, 'base64');
      await page.locator(TEXT_INPUT).fill('码工具箱');
      await expect(page.locator(TEXT_OUTPUT)).toHaveText('56CB5bel5YW3566x');

      await page.getByRole('button', { name: '图片', exact: true }).click();
      await expect(page.getByTestId('base64-panel-image')).toBeVisible();

      await page.getByRole('button', { name: '文件', exact: true }).click();
      await expect(page.getByTestId('base64-panel-file')).toBeVisible();

      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(noOverflow).toBe(true);
    });
  });
});
