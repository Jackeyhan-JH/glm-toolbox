/** 转义工具端到端测试（对应 issue #9「HTML 实体 / Unicode / 字符串转义」验收标准） */

import { test, expect, openTool, SUBPATH_BASE_URL } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const INPUT = '[data-testid="escape-input"]';
const OUTPUT = '[data-testid="escape-output"]';

/** 切换类型（HTML 实体 / Unicode / JS 字符串） */
const pickType = (page, name) => page.getByRole('button', { name, exact: true }).click();

/** 切换方向（转义 / 还原） */
const pickDirection = (page, name) => page.getByRole('button', { name, exact: true }).click();

/**
 * 大文本填充：fill() 对含大量换行的值耗时随换行数平方增长（实测 3000 换行即超时），
 * 超大输入改用 evaluate 直接赋值并派发 input 事件（与 fill 等价，毫秒级）。
 */
async function fillBig(page, value) {
  await page.locator(INPUT).evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test.describe('转义工具：外壳集成', () => {
  test('打开 #/escape：侧边栏高亮、标题正确', async ({ page }) => {
    await openTool(page, 'escape');
    await expect(page).toHaveTitle('转义工具 - 码工具箱');
    await expect(page.getByRole('heading', { name: '转义工具' })).toBeVisible();
    await expect(page.locator('#tool-nav a[data-tool-id="escape"]')).toHaveAttribute('aria-current', 'true');
  });

  test('搜索清单关键词能找到本工具（html / entity / 实体 / unicode / 转义 / escape / zhuanyi）', async ({ page }) => {
    for (const keyword of ['html', 'entity', '实体', 'unicode', '转义', 'escape', 'zhuanyi']) {
      await page.goto('/');
      await page.getByLabel('搜索工具').fill(keyword);
      await expect(page.locator('#tool-nav').getByRole('link', { name: '转义工具' })).toBeVisible();
    }
  });

  test('子路径部署（--base /glm-toolbox/）下工具可用', async ({ page }) => {
    await page.goto(`${SUBPATH_BASE_URL}#/escape`);
    await expect(page.locator('[data-tool-ready="escape"]')).toBeAttached();
    await expect(page.locator('link[data-tool-style="escape"]')).toHaveCount(1);
    await page.locator(INPUT).fill('<码>');
    await expect(page.locator(OUTPUT)).toHaveText('&lt;码&gt;');
  });

  test('输入内容不写入 URL', async ({ page }) => {
    await openTool(page, 'escape');
    await page.locator(INPUT).fill('<script>alert(1)</script>&密文');
    await expect(page.locator(OUTPUT)).toHaveText('&lt;script&gt;alert(1)&lt;/script&gt;&amp;密文');
    await expect(page).toHaveURL(/#\/escape$/);
  });

  test('类型 / 方向 / 选项设置在刷新后仍保留', async ({ page }) => {
    await openTool(page, 'escape');
    await pickType(page, 'Unicode');
    await page.getByLabel('输出格式').selectOption('u-brace');
    await pickDirection(page, '还原');
    await page.reload();
    await page.locator('[data-tool-ready="escape"]').waitFor({ state: 'attached' });
    await expect(page.getByTestId('escape-unicode-options')).toBeHidden(); // 还原方向不显示转义选项
    await pickDirection(page, '转义');
    await expect(page.getByTestId('escape-format')).toHaveValue('u-brace');
    await page.locator(INPUT).fill('码');
    await expect(page.locator(OUTPUT)).toHaveText('\\u{7801}');
  });
});

test.describe('转义工具：HTML 实体', () => {
  test.beforeEach(async ({ page }) => {
    await openTool(page, 'escape');
  });

  test('转义（仅必要）：<a href="x">码&\'</a> → &lt;a href=&quot;x&quot;&gt;码&amp;&#39;&lt;/a&gt;', async ({ page }) => {
    await page.locator(INPUT).fill(`<a href="x">码&'</a>`);
    await expect(page.locator(OUTPUT)).toHaveText('&lt;a href=&quot;x&quot;&gt;码&amp;&#39;&lt;/a&gt;');
    await expect(page.getByTestId('escape-input-stats')).toHaveText('输入 19 字符 · 21 字节（UTF-8）');
  });

  test('转义（非 ASCII 全转）：码a → &#x7801;a；产物是纯 ASCII', async ({ page }) => {
    await page.getByLabel('转义模式').selectOption('nonAscii');
    await page.locator(INPUT).fill('码a');
    await expect(page.locator(OUTPUT)).toHaveText('&#x7801;a');
    // 必要字符在该模式下同样转义
    await page.locator(INPUT).fill('码&<>"\'a');
    await expect(page.locator(OUTPUT)).toHaveText('&#x7801;&amp;&lt;&gt;&quot;&#39;a');
  });

  test('转义（命名优先）：© ± → &copy; &plusmn;', async ({ page }) => {
    await page.getByLabel('转义模式').selectOption('named');
    await page.locator(INPUT).fill('© ±');
    await expect(page.locator(OUTPUT)).toHaveText('&copy; &plusmn;');
    await page.locator(INPUT).fill('&<>"\'');
    await expect(page.locator(OUTPUT)).toHaveText('&amp;&lt;&gt;&quot;&apos;');
  });

  test('还原：&lt;p&gt;&nbsp;… → <p>、U+00A0、©码码&lt; 依次拼接', async ({ page }) => {
    await pickDirection(page, '还原');
    await page.locator(INPUT).fill('&lt;p&gt;&nbsp;&copy;&#x7801;&#30721;&amp;lt;');
    // NBSP 不便用 toHaveText（会做空白归一化），轮询读到 textContent 后逐字符断言
    await expect.poll(async () => page.locator(OUTPUT).textContent()).toBe('<p>\u00A0©码码&lt;');
    const text = await page.locator(OUTPUT).textContent();
    expect(text.charCodeAt(3)).toBe(0xa0);
  });

  test('还原：非法实体原样保留（&foo; &#xZZ; & 单独 → 原样输出）', async ({ page }) => {
    await pickDirection(page, '还原');
    await page.locator(INPUT).fill('&foo; &#xZZ; & 单独');
    await expect(page.locator(OUTPUT)).toHaveText('&foo; &#xZZ; & 单独');
    await expect(page.getByRole('alert')).toHaveCount(0); // 不是错误，不弹提示
  });

  test('还原：缺分号、超范围数值等边界同样原样保留', async ({ page }) => {
    await pickDirection(page, '还原');
    await page.locator(INPUT).fill('&lt &#0; &#x110000; &NBSP;');
    await expect(page.locator(OUTPUT)).toHaveText('&lt &#0; &#x110000; &NBSP;');
  });
});

test.describe('转义工具：Unicode', () => {
  test.beforeEach(async ({ page }) => {
    await openTool(page, 'escape');
    await pickType(page, 'Unicode');
  });

  test('转义（\\uXXXX，默认只转非 ASCII + 大写）：码😀a → \\u7801\\uD83D\\uDE00a', async ({ page }) => {
    await page.locator(INPUT).fill('码😀a');
    await expect(page.locator(OUTPUT)).toHaveText('\\u7801\\uD83D\\uDE00a');
  });

  test('转义（\\u{} 格式）：码😀a → \\u{7801}\\u{1F600}a', async ({ page }) => {
    await page.getByLabel('输出格式').selectOption('u-brace');
    await page.locator(INPUT).fill('码😀a');
    await expect(page.locator(OUTPUT)).toHaveText('\\u{7801}\\u{1F600}a');
  });

  test('转义（U+ 格式）：码😀a → U+7801 U+1F600 U+0061，且「只转非 ASCII」被禁用', async ({ page }) => {
    await page.getByLabel('输出格式').selectOption('u-plus');
    await expect(page.getByLabel('只转非 ASCII')).toBeDisabled();
    await page.locator(INPUT).fill('码😀a');
    await expect(page.locator(OUTPUT)).toHaveText('U+7801 U+1F600 U+0061');
  });

  test('转义（&#x…; 格式）：码a → &#x7801;a；取消「十六进制大写」后 😀 → &#x1f600;', async ({ page }) => {
    await page.getByLabel('输出格式').selectOption('html-hex');
    await page.locator(INPUT).fill('码a');
    await expect(page.locator(OUTPUT)).toHaveText('&#x7801;a');
    await page.getByLabel('十六进制大写').uncheck();
    await page.locator(INPUT).fill('😀');
    await expect(page.locator(OUTPUT)).toHaveText('&#x1f600;');
  });

  test('转义（CSS 格式）：码😀a → \\7801 \\1F600 a', async ({ page }) => {
    await page.getByLabel('输出格式').selectOption('css');
    await page.locator(INPUT).fill('码😀a');
    await expect(page.locator(OUTPUT)).toHaveText('\\7801 \\1F600 a');
  });

  test('转义：关闭「只转非 ASCII」后 ASCII 也转（Ma → \\u004D\\u0061）', async ({ page }) => {
    await page.getByLabel('只转非 ASCII').uncheck();
    await page.locator(INPUT).fill('Ma');
    await expect(page.locator(OUTPUT)).toHaveText('\\u004D\\u0061');
  });

  test('还原：\\u7801\\u5DE5 \\u{1F600} U+7BB1 &#x5177; → 码工 😀 箱 具（全格式混合）', async ({ page }) => {
    await pickDirection(page, '还原');
    await page.locator(INPUT).fill('\\u7801\\u5DE5 \\u{1F600} U+7BB1 &#x5177;');
    await expect(page.locator(OUTPUT)).toHaveText('码工 😀 箱 具');
  });

  test('还原：孤立代理 \\uD83D → 原文保留并提示「存在不成对的代理项」，不崩溃', async ({ page }) => {
    await pickDirection(page, '还原');
    await page.locator(INPUT).fill('\\uD83D');
    await expect(page.locator(OUTPUT)).toHaveText('\\uD83D');
    await expect(page.getByTestId('escape-warning')).toBeVisible();
    await expect(page.getByTestId('escape-warning')).toHaveText('存在不成对的代理项');
    await expect(page.getByRole('alert')).toHaveCount(0); // 是提示不是错误
    // 修正为成对代理后提示消失
    await page.locator(INPUT).fill('\\uD83D\\uDE00');
    await expect(page.locator(OUTPUT)).toHaveText('😀');
    await expect(page.getByTestId('escape-warning')).toBeHidden();
  });

  test('还原：CSS 形式 \\7801 \\1F600 a → 码😀a', async ({ page }) => {
    await pickDirection(page, '还原');
    await page.locator(INPUT).fill('\\7801 \\1F600 a');
    await expect(page.locator(OUTPUT)).toHaveText('码😀a');
  });
});

test.describe('转义工具：JS 字符串', () => {
  test.beforeEach(async ({ page }) => {
    await openTool(page, 'escape');
    await pickType(page, 'JS 字符串');
  });

  test('转义：他说："hi" + 换行 + 制表符 + 反斜杠 → 他说：\\"hi\\"\\n\\t\\\\', async ({ page }) => {
    await page.locator(INPUT).fill('他说："hi"\n\t\\');
    await expect(page.locator(OUTPUT)).toHaveText('他说：\\"hi\\"\\n\\t\\\\');
  });

  test('还原：用「交换输入输出」往返，结果与原输入逐字相同', async ({ page }) => {
    const original = '他说："hi"\n\t\\';
    await page.locator(INPUT).fill(original);
    await expect(page.locator(OUTPUT)).toHaveText('他说：\\"hi\\"\\n\\t\\\\');

    await page.getByTestId('escape-swap').click();
    await expect(page.getByRole('button', { name: '还原', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.locator(INPUT).inputValue()).toBe('他说：\\"hi\\"\\n\\t\\\\');
    const restored = await page.locator(OUTPUT).textContent();
    expect(restored).toBe(original);
  });

  test('还原：非法转义 \\x4 → 中文错误并指出位置（第 1 个字符）', async ({ page }) => {
    await pickDirection(page, '还原');
    await page.locator(INPUT).fill('\\x4');
    await expect(page.getByRole('alert')).toContainText('非法的转义序列');
    await expect(page.getByRole('alert')).toContainText('\\x4');
    await expect(page.getByRole('alert')).toContainText('第 1 个字符');
    // 修正输入后错误自动消失
    await page.locator(INPUT).fill('\\x41');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator(OUTPUT)).toHaveText('A');
  });

  test('还原：其他非法转义（\\q、结尾反斜杠）都给出中文错误', async ({ page }) => {
    await pickDirection(page, '还原');
    await page.locator(INPUT).fill('ab\\q');
    await expect(page.getByRole('alert')).toContainText('第 3 个字符');
    await page.locator(INPUT).fill('x\\');
    await expect(page.getByRole('alert')).toContainText('「\\」之后没有字符');
  });

  test('还原：\\u 代理对合并为 emoji；孤代理原样还原为字符', async ({ page }) => {
    await pickDirection(page, '还原');
    await page.locator(INPUT).fill('\\ud83d\\ude00');
    await expect(page.locator(OUTPUT)).toHaveText('😀');
  });
});

test.describe('转义工具：安全（HTML 还原不得执行脚本）', () => {
  test('HTML 转义 <img onerror> 后再还原：结果一致，window.__xss 未定义', async ({ page }) => {
    await openTool(page, 'escape');
    const payload = '<img src=x onerror="window.__xss=1">';
    await page.locator(INPUT).fill(payload);
    await expect(page.locator(OUTPUT)).toHaveText('&lt;img src=x onerror=&quot;window.__xss=1&quot;&gt;');

    // 交换：输出进入输入框并切到还原方向
    await page.getByTestId('escape-swap').click();
    await expect(page.locator(OUTPUT)).toHaveText(payload);
    expect(await page.locator(INPUT).inputValue()).toBe('&lt;img src=x onerror=&quot;window.__xss=1&quot;&gt;');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('HTML 转义 <script>alert(1)</script> 往返：无弹窗、无异常、结果一致', async ({ page }) => {
    let dialogs = 0;
    page.on('dialog', async (dialog) => {
      dialogs += 1;
      await dialog.dismiss();
    });
    await openTool(page, 'escape');
    const payload = '<script>alert(1)</script>';
    await page.locator(INPUT).fill(payload);
    await expect(page.locator(OUTPUT)).toHaveText('&lt;script&gt;alert(1)&lt;/script&gt;');

    await page.getByTestId('escape-swap').click();
    await expect(page.locator(OUTPUT)).toHaveText(payload);
    expect(dialogs).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});

test.describe('转义工具：复制 / 明细 / 主题 / 移动端', () => {
  test('「复制结果」写入剪贴板，超长输出截断显示但复制完整结果', async ({ page }) => {
    await openTool(page, 'escape');
    await page.locator(INPUT).fill('码&<');
    await expect(page.locator(OUTPUT)).toHaveText('码&amp;&lt;');

    await page.getByRole('button', { name: '复制结果' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('码&amp;&lt;');

    // 3 万字符输入 → 输出超过 1 万，只显示前 1 万
    const long = '码&<>\n'.repeat(6000);
    const expected = '码&amp;&lt;&gt;\n'.repeat(6000);
    await fillBig(page, long);
    await expect(page.getByTestId('escape-output-truncated')).toBeVisible();
    expect((await page.locator(OUTPUT).textContent()).length).toBe(10000);
    await expect(page.getByTestId('escape-output-count')).toHaveText(`${[...expected].length} 字符`);

    // 复制到的是完整结果
    await page.getByRole('button', { name: '复制结果' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);

    // 下载完整结果
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '下载完整结果' }).click(),
    ]);
    expect(await download.suggestedFilename()).toBe('escape-result.txt');
  });

  test('字符明细：每个字符的码点与 UTF-8 字节', async ({ page }) => {
    await openTool(page, 'escape');
    await page.locator(INPUT).fill('码 a');
    await page.getByTestId('escape-details').locator('summary').click();
    const rows = page.getByTestId('escape-details').locator('tbody tr');
    await expect(rows).toHaveCount(3);
    const cells = (row) => rows.nth(row).locator('td');
    await expect(cells(0).nth(0)).toHaveText('码');
    await expect(cells(0).nth(1)).toHaveText('U+7801');
    await expect(cells(0).nth(2)).toHaveText('E7 A0 81');
    await expect(cells(1).nth(1)).toHaveText('U+0020');
    await expect(cells(1).nth(2)).toHaveText('20');
    await expect(cells(2).nth(1)).toHaveText('U+0061');
    await expect(cells(2).nth(2)).toHaveText('61');
  });

  test('深色与浅色主题下界面都可用、无报错', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openTool(page, 'escape');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator(INPUT).fill('© ±');
    await page.getByLabel('转义模式').selectOption('named');
    await expect(page.locator(OUTPUT)).toHaveText('&copy; &plusmn;');

    await page.getByRole('button', { name: '切换主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await pickType(page, 'Unicode');
    await page.locator(INPUT).fill('码');
    await expect(page.locator(OUTPUT)).toHaveText('\\u7801');
  });

  test.describe('视口 375×667', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('无横向滚动，三种类型都能完成基本操作', async ({ page }) => {
      await openTool(page, 'escape');
      await page.locator(INPUT).fill('<码>');
      await expect(page.locator(OUTPUT)).toHaveText('&lt;码&gt;');

      await pickType(page, 'Unicode');
      await page.locator(INPUT).fill('码😀a');
      await expect(page.locator(OUTPUT)).toHaveText('\\u7801\\uD83D\\uDE00a');

      await pickType(page, 'JS 字符串');
      await page.locator(INPUT).fill('a"b');
      await expect(page.locator(OUTPUT)).toHaveText('a\\"b');

      // 展开字符明细也不产生横向滚动
      await page.getByTestId('escape-details').locator('summary').click();
      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(noOverflow).toBe(true);
    });
  });
});

test.describe('转义工具：性能', () => {
  test('10 万字符的转义 / 还原在 1 秒内完成（浏览器内实测三类转换）', async ({ page }) => {
    await openTool(page, 'escape');
    const elapsed = await page.evaluate(async () => {
      const logic = await import('/tools/escape/logic.mjs');
      const text = '码a<>"😀\n\t\\'.repeat(12500); // 12.5 万字符
      const t0 = performance.now();
      const html = logic.unescapeHtml(logic.escapeHtml(text));
      const unicode = logic.unescapeUnicode(logic.escapeUnicode(text)).text;
      const js = logic.unescapeJsString(logic.escapeJsString(text));
      const t1 = performance.now();
      if (html !== text || unicode !== text || js !== text) throw new Error('round-trip mismatch');
      return t1 - t0;
    });
    expect(elapsed).toBeLessThan(1000);
  });

  test('大输入下页面不卡死：输出截断显示、统计正确、可继续交互', async ({ page }) => {
    await openTool(page, 'escape');
    const input = '码a&<>\n'.repeat(20000); // 12 万字符
    const expected = '码a&amp;&lt;&gt;\n'.repeat(20000);
    await fillBig(page, input);
    await expect(page.getByTestId('escape-output-truncated')).toBeVisible();
    await expect(page.getByTestId('escape-input-stats')).toHaveText(`输入 ${[...input].length} 字符 · ${Buffer.byteLength(input, 'utf8')} 字节（UTF-8）`);
    await expect(page.getByTestId('escape-output-count')).toHaveText(`${[...expected].length} 字符`);

    // 页面仍可交互：点击切换类型（真实点击）并完成一次小转换
    await pickType(page, 'JS 字符串');
    await fillBig(page, '码"\\');
    await expect(page.locator(OUTPUT)).toHaveText('码\\"\\\\');
  });
});
