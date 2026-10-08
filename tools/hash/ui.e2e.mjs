/** 哈希计算端到端测试（对应 issue #10「哈希计算」验收标准） */

import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { test, expect, openTool, SUBPATH_BASE_URL } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const fixtureUrl = (name) => new URL(`./fixtures/${name}`, import.meta.url);

/**
 * 大文件先用 Buffer 上传会被 Playwright 拒绝（> 50MB），
 * 写入 test-results/（Playwright 输出目录，已 gitignore）后按路径上传。
 */
function bigTempFile(name, buffer) {
  fs.mkdirSync('test-results', { recursive: true });
  const filePath = path.join('test-results', name);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

const SAMPLE = fs.readFileSync(fixtureUrl('sample.txt'));
const BYTES_256 = fs.readFileSync(fixtureUrl('bytes-256.bin'));
const nodeHex = (algo, data) => createHash(algo).update(data).digest('hex');
const nodeHmacHex = (algo, key, data) => createHmac(algo, key).update(data).digest('hex');

const MD5_ROW = '[data-testid="hash-value-md5"]';
const SHA1_ROW = '[data-testid="hash-value-sha1"]';
const SHA256_ROW = '[data-testid="hash-value-sha256"]';

const FOX = 'The quick brown fox jumps over the lazy dog';

/* ==================== 外壳集成 ==================== */

test.describe('哈希计算：外壳集成', () => {
  test('打开 #/hash：侧边栏高亮、标题正确', async ({ page }) => {
    await openTool(page, 'hash');
    await expect(page).toHaveTitle('哈希计算 - 码工具箱');
    await expect(page.getByRole('heading', { name: '哈希计算' })).toBeVisible();
    await expect(page.locator('#tool-nav a[data-tool-id="hash"]')).toHaveAttribute('aria-current', 'true');
  });

  test('搜索清单关键词能找到本工具（hash / md5 / sha256 / sha1 / hmac / 哈希 / 摘要 / haxi）', async ({ page }) => {
    for (const keyword of ['hash', 'md5', 'sha256', 'sha1', 'hmac', '哈希', '摘要', 'haxi']) {
      await page.goto('/');
      await page.getByLabel('搜索工具').fill(keyword);
      await expect(page.locator('#tool-nav').getByRole('link', { name: '哈希计算' })).toBeVisible();
    }
  });

  test('子路径部署（--base /glm-toolbox/）下文本与文件计算可用（worker 正常加载）', async ({ page }) => {
    await page.goto(`${SUBPATH_BASE_URL}#\/hash`);
    await expect(page.locator('[data-tool-ready="hash"]')).toBeAttached();
    await expect(page.locator('link[data-tool-style="hash"]')).toHaveCount(1);

    // 文本路径
    await page.getByTestId('hash-text-input').fill('abc');
    await expect(page.locator(MD5_ROW)).toHaveText('900150983cd24fb0d6963f7d28e17f72');

    // 文件路径（worker 以相对模块 URL 加载，验证子路径下同样可用）
    await page.getByRole('button', { name: '文件', exact: true }).click();
    await page.getByTestId('hash-file-input').setInputFiles(fixtureUrl('sample.txt').pathname);
    await expect(page.locator(SHA256_ROW)).toHaveText(nodeHex('sha256', SAMPLE));
  });
});

/* ==================== 文本模式 ==================== */

test.describe('哈希计算：文本', () => {
  test.beforeEach(async ({ page }) => {
    await openTool(page, 'hash');
  });

  test('空输入 → 空串摘要（MD5 d41d8…、SHA-256 e3b0c4…），无报错', async ({ page }) => {
    await expect(page.locator(MD5_ROW)).toHaveText('d41d8cd98f00b204e9800998ecf8427e');
    await expect(page.locator(SHA256_ROW)).toHaveText(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('abc → MD5 / SHA-1 / SHA-256 公认向量；输入统计正确', async ({ page }) => {
    await page.getByTestId('hash-text-input').fill('abc');
    await expect(page.locator(MD5_ROW)).toHaveText('900150983cd24fb0d6963f7d28e17f72');
    await expect(page.locator(SHA1_ROW)).toHaveText('a9993e364706816aba3e25717850c26c9cd0d89d');
    await expect(page.locator(SHA256_ROW)).toHaveText(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    await expect(page.getByTestId('hash-text-stats')).toHaveText('输入 3 字符 · 3 字节（UTF-8）');
  });

  test('码工具箱（UTF-8）→ MD5 / SHA-1 / SHA-256', async ({ page }) => {
    await page.getByTestId('hash-text-input').fill('码工具箱');
    await expect(page.locator(MD5_ROW)).toHaveText('3ea39d488efbc5342bc94f72653f285e');
    await expect(page.locator(SHA1_ROW)).toHaveText('c56ffc62c3fa13106a621ec97d632f474c2d752f');
    await expect(page.locator(SHA256_ROW)).toHaveText(
      '4546f806e2f5dd1b3026790d4429f556fdd1898078899d7c94796d9c84e61323',
    );
    await expect(page.getByTestId('hash-text-stats')).toHaveText('输入 4 字符 · 12 字节（UTF-8）');
  });

  test('输出格式：Base64 与大写十六进制切换即时生效', async ({ page }) => {
    await page.getByTestId('hash-text-input').fill('abc');
    await expect(page.locator(SHA256_ROW)).toHaveText(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );

    const md5Hex = nodeHex('md5', Buffer.from('abc'));
    await page.getByRole('button', { name: 'Base64', exact: true }).click();
    await expect(page.locator(SHA256_ROW)).toHaveText('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
    await expect(page.locator(MD5_ROW)).toHaveText(Buffer.from(md5Hex, 'hex').toString('base64'));

    await page.getByRole('button', { name: '大写十六进制', exact: true }).click();
    await expect(page.locator(SHA256_ROW)).toHaveText(
      'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD',
    );

    await page.getByRole('button', { name: '小写十六进制', exact: true }).click();
    await expect(page.locator(SHA256_ROW)).toHaveText(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('HMAC：密钥 key + The quick brown fox… → 五种算法（384 / 512 与 Node 对拍）', async ({ page }) => {
    await page.getByLabel('启用 HMAC').check();
    await page.getByLabel('HMAC 密钥').fill('key');
    await page.getByTestId('hash-text-input').fill(FOX);

    await expect(page.getByTestId('hash-value-hmac-md5')).toHaveText('80070713463e7749b90c2dc24911e275');
    await expect(page.getByTestId('hash-value-hmac-sha1')).toHaveText('de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9');
    await expect(page.getByTestId('hash-value-hmac-sha256')).toHaveText(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
    const key = Buffer.from('key');
    const fox = Buffer.from(FOX);
    await expect(page.getByTestId('hash-value-hmac-sha384')).toHaveText(nodeHmacHex('sha384', key, fox));
    await expect(page.getByTestId('hash-value-hmac-sha512')).toHaveText(nodeHmacHex('sha512', key, fox));

    // 勾选后摘要（非 HMAC）不受影响
    await expect(page.locator(MD5_ROW)).toHaveText(nodeHex('md5', fox));
  });

  test('十六进制密钥 6b6579 与文本密钥 key 的 HMAC 结果相同', async ({ page }) => {
    await page.getByTestId('hash-text-input').fill(FOX);
    await page.getByLabel('启用 HMAC').check();
    await page.getByLabel('密钥格式').selectOption('十六进制');
    await page.getByLabel('HMAC 密钥').fill('6b6579');
    await expect(page.getByTestId('hash-value-hmac-md5')).toHaveText('80070713463e7749b90c2dc24911e275');
    await expect(page.getByTestId('hash-value-hmac-sha256')).toHaveText(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });

  test('非法十六进制密钥 6b6 → 中文错误；HMAC 行为空；修正后恢复', async ({ page }) => {
    await page.getByTestId('hash-text-input').fill(FOX);
    await page.getByLabel('启用 HMAC').check();
    await page.getByLabel('密钥格式').selectOption('十六进制');
    await page.getByLabel('HMAC 密钥').fill('6b6');

    await expect(page.getByRole('alert')).toContainText('十六进制密钥长度非法');
    await expect(page.getByTestId('hash-value-hmac-md5')).toHaveText('');
    // 明文摘要不受影响
    await expect(page.locator(MD5_ROW)).toHaveText(nodeHex('md5', Buffer.from(FOX)));

    await page.getByLabel('HMAC 密钥').fill('6b6579');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('hash-value-hmac-md5')).toHaveText('80070713463e7749b90c2dc24911e275');
  });

  test('Base64 密钥 a2V5 等价于文本密钥 key；非法 Base64 → 中文错误', async ({ page }) => {
    await page.getByTestId('hash-text-input').fill(FOX);
    await page.getByLabel('启用 HMAC').check();
    await page.getByLabel('密钥格式').selectOption('Base64');
    await page.getByLabel('HMAC 密钥').fill('a2V5');
    await expect(page.getByTestId('hash-value-hmac-md5')).toHaveText('80070713463e7749b90c2dc24911e275');

    await page.getByLabel('HMAC 密钥').fill('a$v');
    await expect(page.getByRole('alert')).toContainText('Base64 密钥包含非法字符');
    await expect(page.getByTestId('hash-value-hmac-md5')).toHaveText('');
  });

  test('空密钥 → 中文提示（WebCrypto 不支持空密钥）', async ({ page }) => {
    await page.getByTestId('hash-text-input').fill('abc');
    await page.getByLabel('启用 HMAC').check();
    await expect(page.getByRole('alert')).toContainText('请输入 HMAC 密钥');
    await expect(page.getByTestId('hash-value-hmac-md5')).toHaveText('');
    await expect(page.locator(MD5_ROW)).toHaveText('900150983cd24fb0d6963f7d28e17f72');
  });

  test('比对：粘贴带空白的大写 SHA-256 → SHA-256 行显示 ✓；不匹配显示 ✗', async ({ page }) => {
    await page.getByTestId('hash-text-input').fill('abc');
    await expect(page.locator(SHA256_ROW)).toHaveText(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );

    const compareBox = page.getByLabel('比对', { exact: true });
    await compareBox.fill('  BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD ');
    await expect(page.getByTestId('hash-match-sha256')).toHaveText('✓');
    await expect(page.getByTestId('hash-match-md5')).toHaveText('✗');
    await expect(page.getByTestId('hash-compare-status')).toHaveText('✓ 与 SHA-256 匹配');

    await compareBox.fill('deadbeef');
    await expect(page.getByTestId('hash-match-sha256')).toHaveText('✗');
    await expect(page.getByTestId('hash-compare-status')).toHaveText('✗ 没有任何算法与期望值匹配');

    // 清空后标记消失
    await compareBox.fill('');
    await expect(page.getByTestId('hash-match-sha256')).toBeHidden();
    await expect(page.getByTestId('hash-compare-status')).toBeHidden();
  });

  test('「复制 MD5」「复制 HMAC-SHA256」写入剪贴板', async ({ page }) => {
    await page.getByTestId('hash-text-input').fill('码工具箱');
    await expect(page.locator(MD5_ROW)).toHaveText('3ea39d488efbc5342bc94f72653f285e');

    await page.getByRole('button', { name: '复制MD5', exact: true }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('3ea39d488efbc5342bc94f72653f285e');

    await page.getByLabel('启用 HMAC').check();
    await page.getByLabel('HMAC 密钥').fill('key');
    const expectedHmac = nodeHmacHex('sha256', Buffer.from('key'), Buffer.from('码工具箱'));
    await expect(page.getByTestId('hash-value-hmac-sha256')).toHaveText(expectedHmac);

    // 两处「已复制」可能短暂并存（各自 1.5 秒后恢复），断言收窄到 HMAC 区
    await page.getByRole('button', { name: '复制HMAC-SHA-256', exact: true }).click();
    await expect(page.getByTestId('hash-hmac-rows').getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expectedHmac);
  });
});

/* ==================== 文件模式 ==================== */

test.describe('哈希计算：文件', () => {
  test.beforeEach(async ({ page }) => {
    await openTool(page, 'hash');
    await page.getByRole('button', { name: '文件', exact: true }).click();
    await expect(page.getByTestId('hash-panel-file')).toBeVisible();
  });

  test('上传 fixture：页面 SHA-256 / MD5 与 Node 计算一致', async ({ page }) => {
    await page.getByTestId('hash-file-input').setInputFiles(fixtureUrl('sample.txt').pathname);
    await expect(page.getByTestId('hash-file-meta')).toContainText('sample.txt');
    await expect(page.locator(SHA256_ROW)).toHaveText(nodeHex('sha256', SAMPLE));
    await expect(page.locator(MD5_ROW)).toHaveText(nodeHex('md5', SAMPLE));
    await expect(page.getByTestId('hash-value-sha512')).toHaveText(nodeHex('sha512', SAMPLE));
    await expect(page.getByTestId('hash-progress-status')).toContainText('计算完成');

    // 二进制 fixture（0x00–0xFF 全字节）
    await page.getByTestId('hash-file-input').setInputFiles(fixtureUrl('bytes-256.bin').pathname);
    await expect(page.locator(SHA256_ROW)).toHaveText(nodeHex('sha256', BYTES_256));
    await expect(page.locator(MD5_ROW)).toHaveText(nodeHex('md5', BYTES_256));
  });

  test('文件 + HMAC：密钥 key 的 HMAC-MD5 / SHA-256 与 Node 一致', async ({ page }) => {
    await page.getByLabel('启用 HMAC').check();
    await page.getByLabel('HMAC 密钥').fill('key');
    await page.getByTestId('hash-file-input').setInputFiles(fixtureUrl('sample.txt').pathname);

    const key = Buffer.from('key');
    await expect(page.getByTestId('hash-value-hmac-md5')).toHaveText(nodeHmacHex('md5', key, SAMPLE));
    await expect(page.getByTestId('hash-value-hmac-sha256')).toHaveText(nodeHmacHex('sha256', key, SAMPLE));
    await expect(page.locator(SHA256_ROW)).toHaveText(nodeHex('sha256', SAMPLE));
  });

  test('50MB 动态文件：显示进度、计算期间可切换输出格式、完成后 MD5 与 Node 一致', async ({ page }) => {
    const big = randomBytes(50 * 1024 * 1024);
    await page.getByTestId('hash-file-input').setInputFiles(bigTempFile('hash-dynamic-50mb.bin', big));

    // 进度区出现（读取分块期间持续更新，完成后保留「计算完成」）
    await expect(page.getByTestId('hash-progress')).toBeVisible();

    // 计算期间界面可点击：切换输出格式（Worker 计算不阻塞主线程）
    await page.getByRole('button', { name: '大写十六进制', exact: true }).click();

    await expect(page.getByTestId('hash-progress-status')).toContainText('计算完成', { timeout: 20_000 });
    await expect(page.locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '100');
    await expect(page.locator(MD5_ROW)).toHaveText(nodeHex('md5', big).toUpperCase(), { timeout: 10_000 });
    await expect(page.locator(SHA256_ROW)).toHaveText(nodeHex('sha256', big).toUpperCase());

    // 切回小写仍然正确
    await page.getByRole('button', { name: '小写十六进制', exact: true }).click();
    await expect(page.locator(MD5_ROW)).toHaveText(nodeHex('md5', big));
  });

  test('点「取消」能中止计算：结果不更新，随后小文件可正常计算', async ({ page }) => {
    const big = randomBytes(50 * 1024 * 1024);
    await page.getByTestId('hash-file-input').setInputFiles(bigTempFile('hash-cancel-50mb.bin', big));
    await expect(page.getByTestId('hash-cancel')).toBeVisible();
    await page.getByTestId('hash-cancel').click();

    await expect(page.getByTestId('hash-progress-status')).toHaveText('已取消');
    await expect(page.locator(MD5_ROW)).toHaveText('');
    await expect(page.locator(SHA256_ROW)).toHaveText('');
    await expect(page.getByTestId('hash-cancel')).toBeHidden();

    // 取消后重新上传小文件：Worker 重建，计算正常
    await page.getByTestId('hash-file-input').setInputFiles(fixtureUrl('sample.txt').pathname);
    await expect(page.locator(MD5_ROW)).toHaveText(nodeHex('md5', SAMPLE), { timeout: 10_000 });
    await expect(page.locator(SHA256_ROW)).toHaveText(nodeHex('sha256', SAMPLE));
  });

  test('超过 200MB 的文件被拒绝并给出中文提示', async ({ page }) => {
    const tooBig = Buffer.alloc(200 * 1024 * 1024 + 1, 0x61);
    await page.getByTestId('hash-file-input').setInputFiles(bigTempFile('hash-too-big.bin', tooBig));
    await expect(page.getByRole('alert')).toContainText('文件过大');
    await expect(page.getByRole('alert')).toContainText('200.0 MB');
    await expect(page.getByTestId('hash-file-meta')).toHaveText('未选择文件');
    await expect(page.getByTestId('hash-progress')).toBeHidden();
    await expect(page.locator(MD5_ROW)).toHaveText('');
  });
});

/* ==================== 主题与移动端 ==================== */

test.describe('哈希计算：主题与移动端', () => {
  test('深色与浅色主题下界面都可用、无报错', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openTool(page, 'hash');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('hash-text-input').fill('abc');
    await expect(page.locator(MD5_ROW)).toHaveText('900150983cd24fb0d6963f7d28e17f72');

    await page.getByRole('button', { name: '切换主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByTestId('hash-text-input').fill('码工具箱');
    await expect(page.locator(MD5_ROW)).toHaveText('3ea39d488efbc5342bc94f72653f285e');

    // 文件模式在浅色主题下也正常
    await page.getByRole('button', { name: '文件', exact: true }).click();
    await page.getByTestId('hash-file-input').setInputFiles(fixtureUrl('sample.txt').pathname);
    await expect(page.locator(SHA256_ROW)).toHaveText(nodeHex('sha256', SAMPLE));
  });

  test.describe('视口 375×667', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('无横向滚动，文本与文件计算都能完成', async ({ page }) => {
      await openTool(page, 'hash');
      await page.getByTestId('hash-text-input').fill('abc');
      await expect(page.locator(SHA256_ROW)).toHaveText(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
      await expect(page.getByTestId('hash-value-sha512')).toHaveText(nodeHex('sha512', Buffer.from('abc')));

      await page.getByRole('button', { name: '文件', exact: true }).click();
      await page.getByTestId('hash-file-input').setInputFiles(fixtureUrl('sample.txt').pathname);
      await expect(page.locator(MD5_ROW)).toHaveText(nodeHex('md5', SAMPLE));

      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(noOverflow).toBe(true);
    });
  });
});
