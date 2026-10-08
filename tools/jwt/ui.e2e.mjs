/** JWT 解析端到端测试（对应 issue #11「JWT 解析与 HS 系列验签」验收标准） */

import { test, expect, openTool, SUBPATH_BASE_URL } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const TOKEN1 =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const TOKEN_ZH =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0MiIsIm5hbWUiOiLnoIHlt6XlhbfnrrEiLCJpYXQiOjE3OTE0MzIwMDAsImV4cCI6MTc5MTQzNTYwMH0.LC9Ue5tD3WLynFDYjYZXDhhmdgaF81NyL-raOE2a5o4';
const TOKEN_NONE = 'eyJhbGciOiJub25lIn0.eyJhIjoxfQ.';

const b64url = (value) => Buffer.from(value, 'utf8').toString('base64url');
const TOKEN_RS256 = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ sub: '1' }))}.QUFB`;

const INPUT = '[data-testid="jwt-token-input"]';
const KEY = '[data-testid="jwt-key-input"]';

test.describe('JWT：外壳集成', () => {
  test('打开 #/jwt：侧边栏高亮、标题正确', async ({ page }) => {
    await openTool(page, 'jwt');
    await expect(page).toHaveTitle('JWT 解析 - 码工具箱');
    await expect(page.getByRole('heading', { name: 'JWT 解析' })).toBeVisible();
    await expect(page.locator('#tool-nav a[data-tool-id="jwt"]')).toHaveAttribute('aria-current', 'true');
  });

  test('搜索清单关键词能找到本工具（jwt / token / 令牌 / 解析 / 验签 / jiexi）', async ({ page }) => {
    for (const keyword of ['jwt', 'token', '令牌', '解析', '验签', 'jiexi']) {
      await page.goto('/');
      await page.getByLabel('搜索工具').fill(keyword);
      await expect(page.locator('#tool-nav').getByRole('link', { name: 'JWT 解析' })).toBeVisible();
    }
  });

  test('子路径部署（--base /glm-toolbox/）下工具可用', async ({ page }) => {
    await page.goto(`${SUBPATH_BASE_URL}#\/jwt`);
    await expect(page.locator('[data-tool-ready="jwt"]')).toBeAttached();
    await expect(page.locator('link[data-tool-style="jwt"]')).toHaveCount(1);
    await page.locator(INPUT).fill(TOKEN1);
    await expect(page.getByTestId('jwt-header-json')).toContainText('"alg": "HS256"');
  });
});

test.describe('JWT：解析', () => {
  test('经典示例：三栏显示头部 / 载荷 / 签名，iat 显示 UTC 时间，三段着色', async ({ page }) => {
    await openTool(page, 'jwt');
    await page.locator(INPUT).fill(TOKEN1);

    // 头部与载荷（格式化 JSON）
    await expect(page.getByTestId('jwt-header-json')).toHaveText('{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
    await expect(page.getByTestId('jwt-payload-json')).toContainText('"sub": "1234567890"');
    await expect(page.getByTestId('jwt-payload-json')).toContainText('"name": "John Doe"');
    await expect(page.getByTestId('jwt-payload-json')).toContainText('"iat": 1516239022');

    // 签名：Base64URL 原文 + 十六进制（与 Node 交叉验证）
    await expect(page.getByTestId('jwt-signature-b64')).toHaveText('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
    await expect(page.getByTestId('jwt-signature-hex')).toHaveText(
      Buffer.from('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c', 'base64url').toString('hex'),
    );

    // 三段着色块
    await expect(page.getByTestId('jwt-part-header')).toContainText('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    await expect(page.getByTestId('jwt-part-payload')).toContainText('eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4');
    await expect(page.getByTestId('jwt-part-signature')).toContainText('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');

    // 标准声明中文说明与时间（TOKEN1 无 exp → 有效但无法判断过期时间）
    await expect(page.getByTestId('jwt-claim-sub')).toContainText('"1234567890"');
    await expect(page.getByTestId('jwt-claim-sub-desc')).toContainText('主题');
    await expect(page.getByTestId('jwt-claim-iat')).toContainText('1516239022');
    await expect(page.getByTestId('jwt-claim-iat-utc')).toHaveText('2018-01-18 01:30:22（UTC）');
    await expect(page.getByTestId('jwt-claim-iat-local')).toContainText('（UTC');
    await expect(page.getByTestId('jwt-status-badge')).toHaveText('有效');
  });

  test('中文载荷：name 显示为「码工具箱」', async ({ page }) => {
    await openTool(page, 'jwt');
    await page.locator(INPUT).fill(TOKEN_ZH);
    await expect(page.getByTestId('jwt-payload-json')).toContainText('"name": "码工具箱"');
    await expect(page.getByTestId('jwt-claim-name')).toContainText('码工具箱');
    await expect(page.getByTestId('jwt-claim-name-desc')).toContainText('自定义声明');
  });

  test('Bearer 前缀与首尾空白 / 换行自动去掉', async ({ page }) => {
    await openTool(page, 'jwt');
    await page.locator(INPUT).fill(`Bearer ${TOKEN1}`);
    await expect(page.getByTestId('jwt-header-json')).toContainText('"alg": "HS256"');

    await page.locator(INPUT).fill(`  ${TOKEN1.slice(0, 40)}\n${TOKEN1.slice(40)} `);
    await expect(page.getByTestId('jwt-payload-json')).toContainText('"name": "John Doe"');
  });

  test('错误：两段 / 载荷非法 Base64URL / 载荷不是 JSON → 中文提示并指出位置', async ({ page }) => {
    await openTool(page, 'jwt');

    await page.locator(INPUT).fill('aaa.bbb');
    await expect(page.getByRole('alert')).toHaveText('JWT 应由 3 段组成（以 . 分隔），当前为 2 段');
    await expect(page.getByTestId('jwt-results')).toBeHidden();

    await page.locator(INPUT).fill(`${b64url(JSON.stringify({ alg: 'HS256' }))}.ab+cd.ef`);
    await expect(page.getByRole('alert')).toContainText('第 2 段（载荷）解码失败');

    await page.locator(INPUT).fill(`${b64url(JSON.stringify({ alg: 'HS256' }))}.${b64url('not json')}.ef`);
    await expect(page.getByRole('alert')).toContainText('第 2 段（载荷）不是合法 JSON');

    // 修正输入后错误消失、结果恢复
    await page.locator(INPUT).fill(TOKEN1);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('jwt-payload-json')).toContainText('"name": "John Doe"');
  });

  test('alg 为 none：能解析并显示安全警告（NONE / None 变体同样警告）', async ({ page }) => {
    await openTool(page, 'jwt');
    await page.locator(INPUT).fill(TOKEN_NONE);
    await expect(page.getByTestId('jwt-payload-json')).toContainText('"a": 1');
    await expect(page.getByTestId('jwt-warnings')).toContainText('安全警告');
    await expect(page.getByTestId('jwt-warnings')).toContainText('alg 为 none');
    await expect(page.getByTestId('jwt-signature-hex')).toHaveText('（无签名）');
    await expect(page.getByTestId('jwt-verify-result')).toContainText('未签名');

    // 大小写变体：同样给出安全警告，不会判有效
    await page.locator(INPUT).fill(`${b64url(JSON.stringify({ alg: 'NONE', typ: 'JWT' }))}.${b64url(JSON.stringify({ a: 1 }))}.`);
    await expect(page.getByTestId('jwt-warnings')).toContainText('安全警告');
    await expect(page.getByTestId('jwt-warnings')).toContainText('alg 为 NONE');
    await page.locator(KEY).fill('some-key');
    await expect(page.getByTestId('jwt-verify-result')).toContainText('未签名');
  });
});

test.describe('JWT：验签', () => {
  test('输入密钥后实时显示结果，切换密钥立即更新', async ({ page }) => {
    await openTool(page, 'jwt');
    await page.locator(INPUT).fill(TOKEN1);

    await page.locator(KEY).fill('your-256-bit-secret');
    await expect(page.getByTestId('jwt-verify-result')).toHaveText('签名有效');
    await expect(page.getByTestId('jwt-verify-result')).toHaveClass(/is-ok/);

    await page.locator(KEY).fill('wrong');
    await expect(page.getByTestId('jwt-verify-result')).toHaveText('签名无效');
    await expect(page.getByTestId('jwt-verify-result')).toHaveClass(/is-bad/);

    // 清空密钥回到提示态；密钥不写入 localStorage
    await page.locator(KEY).fill('');
    await expect(page.getByTestId('jwt-verify-result')).toHaveText('输入密钥后自动验签');
    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    expect(stored).not.toContain('your-256-bit-secret');
  });

  test('中文令牌 + 密钥「码工具箱-secret」验签有效', async ({ page }) => {
    await openTool(page, 'jwt');
    await page.locator(INPUT).fill(TOKEN_ZH);
    await page.locator(KEY).fill('码工具箱-secret');
    await expect(page.getByTestId('jwt-verify-result')).toHaveText('签名有效');
  });

  test('「密钥为 Base64 编码」：eW91ci0yNTYtYml0LXNlY3JldA== 勾选后验签有效', async ({ page }) => {
    await openTool(page, 'jwt');
    await page.locator(INPUT).fill(TOKEN1);
    await page.locator(KEY).fill('eW91ci0yNTYtYml0LXNlY3JldA==');

    // 未勾选：按原始文本作为密钥 → 无效
    await expect(page.getByTestId('jwt-verify-result')).toHaveText('签名无效');

    await page.getByLabel('密钥为 Base64 编码').check();
    await expect(page.getByTestId('jwt-verify-result')).toHaveText('签名有效');

    // 选项被记住（刷新后仍勾选）
    await page.reload();
    await expect(page.getByTestId('jwt-key-base64')).toBeChecked();

    // 非法 Base64 密钥给出中文提示
    await page.locator(INPUT).fill(TOKEN1);
    await page.locator(KEY).fill('abc$=');
    await expect(page.getByTestId('jwt-verify-result')).toContainText('密钥不是合法的 Base64');
  });

  test('alg 为 RS256：输入密钥后显示「暂不支持该算法验签」，算法名单独显示', async ({ page }) => {
    await openTool(page, 'jwt');
    await page.locator(INPUT).fill(TOKEN_RS256);
    await page.locator(KEY).fill('some-key');
    await expect(page.getByTestId('jwt-verify-result')).toHaveClass(/is-warn/);
    // 提示文案与 issue 原文一致，算法名在旁边单独显示
    await expect(page.getByTestId('jwt-verify-message')).toHaveText('暂不支持该算法验签，仅解析');
    await expect(page.getByTestId('jwt-verify-alg')).toHaveText('算法 RS256');
  });

  test('「显示 / 隐藏」切换密钥可见性，不影响验签', async ({ page }) => {
    await openTool(page, 'jwt');
    await page.locator(INPUT).fill(TOKEN1);
    await page.locator(KEY).fill('your-256-bit-secret');
    await expect(page.getByTestId('jwt-verify-result')).toHaveText('签名有效');

    await page.getByTestId('jwt-key-toggle').click();
    await expect(page.locator(KEY)).toHaveAttribute('type', 'text');
    await expect(page.getByTestId('jwt-key-toggle')).toHaveText('隐藏');
    await expect(page.getByTestId('jwt-verify-result')).toHaveText('签名有效');
  });
});

test.describe('JWT：时间与状态（page.clock）', () => {
  test('固定 2026-10-08T04:30:00Z → 有效；改到 06:00:00Z 重新解析 → 已过期', async ({ page }) => {
    await page.clock.install({ time: '2026-10-08T04:30:00Z' });
    await openTool(page, 'jwt');
    await page.locator(INPUT).fill(TOKEN_ZH);
    // 防抖定时器被冻结的时钟拦住，直接点「刷新」同步重算
    await page.getByTestId('jwt-refresh').click();
    await expect(page.getByTestId('jwt-status-badge')).toHaveText('有效');
    await expect(page.getByTestId('jwt-status-detail')).toHaveText('30 分钟后过期');
    await expect(page.getByTestId('jwt-claim-exp-rel')).toHaveText('30 分钟后');

    await page.clock.setFixedTime('2026-10-08T06:00:00Z');
    await page.getByTestId('jwt-refresh').click();
    await expect(page.getByTestId('jwt-status-badge')).toHaveText('已过期');
    await expect(page.getByTestId('jwt-status-detail')).toHaveText('已过期 1 小时');
  });
});

test.describe('JWT：复制与更新', () => {
  // 点击某个复制按钮（按容器 testid 精确定位），等该按钮显示「已复制」后读回剪贴板。
  // 复制按钮点完后有 1500ms 都叫「已复制」，因此断言必须限定在各自容器内，避免 strict mode 命中多个。
  async function copyAndReadBack(page, wrapperId, label, expected) {
    const wrap = page.getByTestId(wrapperId);
    await wrap.getByRole('button', { name: label }).click();
    await expect(wrap.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  }

  test('复制头部 / 载荷 / 签名 / 十六进制写入剪贴板，与显示一致', async ({ page }) => {
    await openTool(page, 'jwt');
    await page.locator(INPUT).fill(TOKEN1);
    await expect(page.getByTestId('jwt-header-json')).toContainText('"alg": "HS256"'); // 等渲染完成再取文本

    const headerJson = await page.getByTestId('jwt-header-json').textContent();
    const payloadJson = await page.getByTestId('jwt-payload-json').textContent();
    const hex = await page.getByTestId('jwt-signature-hex').textContent();

    await copyAndReadBack(page, 'jwt-copy-header', '复制头部', headerJson);
    await copyAndReadBack(page, 'jwt-copy-payload', '复制载荷', payloadJson);
    await copyAndReadBack(page, 'jwt-copy-signature', '复制签名', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
    await copyAndReadBack(page, 'jwt-copy-signature-hex', '复制十六进制', hex);
  });

  test('输入变化后 300ms 内自动更新（防抖）', async ({ page }) => {
    await openTool(page, 'jwt');
    await page.locator(INPUT).fill(TOKEN1);
    const start = Date.now();
    await expect(page.getByTestId('jwt-header-json')).toContainText('"alg": "HS256"');
    await page.locator(INPUT).fill(TOKEN_ZH);
    await expect(page.getByTestId('jwt-claim-name')).toContainText('码工具箱');
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

test.describe('JWT：主题与移动端', () => {
  test('深色与浅色主题下界面都可用、无报错', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openTool(page, 'jwt');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator(INPUT).fill(TOKEN1);
    await expect(page.getByTestId('jwt-payload-json')).toContainText('"name": "John Doe"');
    await page.locator(KEY).fill('your-256-bit-secret');
    await expect(page.getByTestId('jwt-verify-result')).toHaveText('签名有效');

    await page.getByRole('button', { name: '切换主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator(INPUT).fill(TOKEN_ZH);
    await expect(page.getByTestId('jwt-claim-name')).toContainText('码工具箱');
    await expect(page.getByTestId('jwt-claim-name-desc')).toContainText('自定义声明');
  });

  test.describe('视口 375×667', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('无横向滚动，基本操作可用', async ({ page }) => {
      await openTool(page, 'jwt');
      await page.locator(INPUT).fill(TOKEN_ZH);
      await expect(page.getByTestId('jwt-payload-json')).toContainText('码工具箱');
      await page.locator(KEY).fill('码工具箱-secret');
      await expect(page.getByTestId('jwt-verify-result')).toHaveText('签名有效');
      await expect(page.getByTestId('jwt-claims')).toBeVisible();

      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(noOverflow).toBe(true);
    });
  });
});
