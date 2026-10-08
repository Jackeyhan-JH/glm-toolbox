/** 颜色工具端到端测试（对应 issue #19「颜色格式转换与对比度检查」验收标准） */

import { test, expect, openTool } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const INPUT = '[data-testid="color-input"]';
const FG = '[data-testid="color-fg"]';
const BG = '[data-testid="color-bg"]';

/** 等待某格式输出为指定文本 */
const expectFormat = (page, key, text) =>
  expect(page.getByTestId(`color-${key}`)).toHaveText(text);

/* ==================== 外壳集成 ==================== */

test.describe('颜色工具：外壳集成', () => {
  test('打开 #/color：侧边栏高亮、标题正确、默认示例已渲染', async ({ page }) => {
    await openTool(page, 'color');
    await expect(page).toHaveTitle('颜色工具 - 码工具箱');
    await expect(page.getByRole('heading', { name: '颜色工具' })).toBeVisible();
    await expect(page.locator('#tool-nav a[data-tool-id="color"]')).toHaveAttribute('aria-current', 'true');

    // 默认预填 #1e90ff，结果随挂载立即出现
    await expect(page.locator(INPUT)).toHaveValue('#1e90ff');
    await expectFormat(page, 'hex', '#1e90ff');
    await expectFormat(page, 'rgb', 'rgb(30, 144, 255)');
    // 对比度默认 #777777 / #ffffff → 4.48:1
    await expect(page.getByTestId('color-ratio')).toHaveText('4.48:1');
  });

  test('搜索清单关键词能找到本工具（color / 颜色 / hex / rgb / hsl / 对比度 / wcag / yanse）', async ({ page }) => {
    for (const keyword of ['color', '颜色', 'hex', 'rgb', 'hsl', 'hwb', 'oklch', '对比度', 'wcag', 'yanse', '取色', '色板', '无障碍']) {
      await page.goto('/');
      await page.getByLabel('搜索工具').fill(keyword);
      await expect(page.locator('#tool-nav').getByRole('link', { name: '颜色工具' })).toBeVisible();
    }
  });
});

/* ==================== 格式转换（真实输入） ==================== */

test.describe('颜色工具：格式转换', () => {
  test('🖥 输入 #1e90ff → 各格式输出、命名颜色精确、预览色块计算背景色为 rgb(30, 144, 255)', async ({ page }) => {
    await openTool(page, 'color');
    await page.locator(INPUT).fill('#1e90ff');

    await expectFormat(page, 'hex', '#1e90ff');
    await expectFormat(page, 'rgb', 'rgb(30, 144, 255)');
    await expectFormat(page, 'hsl', 'hsl(210, 100%, 56%)');
    await expectFormat(page, 'hwb', 'hwb(210 12% 0%)');
    await expect(page.getByTestId('color-oklch')).toContainText('oklch(0.652 0.190 253.205)');
    await expect(page.getByTestId('color-named')).toHaveText('dodgerblue');
    await expect(page.getByTestId('color-named-exact')).toBeVisible();
    await expect(page.getByTestId('color-named-exact')).toHaveText('精确');

    // 预览色块的计算背景色
    await expect(page.getByTestId('color-swatch')).toHaveCSS('background-color', 'rgb(30, 144, 255)');
    await expect(page.getByTestId('color-swatch-hex')).toHaveText('#1e90ff');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('#fff → #ffffff；#0008 → #00000088 与 rgba(0, 0, 0, 0.53)', async ({ page }) => {
    await openTool(page, 'color');
    await page.locator(INPUT).fill('#fff');
    await expectFormat(page, 'hex', '#ffffff');
    await expectFormat(page, 'named', 'white');
    await expect(page.getByTestId('color-named-exact')).toBeVisible();

    await page.locator(INPUT).fill('#0008');
    await expectFormat(page, 'hex', '#00000088');
    await expectFormat(page, 'rgb', 'rgba(0, 0, 0, 0.53)');
    await expect(page.getByTestId('color-swatch')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.533)');
  });

  test('rgb(255 0 0 / 50%) 与 rgba(255,0,0,.5) → #ff000080', async ({ page }) => {
    await openTool(page, 'color');
    await page.locator(INPUT).fill('rgb(255 0 0 / 50%)');
    await expectFormat(page, 'hex', '#ff000080');
    await page.locator(INPUT).fill('rgba(255,0,0,.5)');
    await expectFormat(page, 'hex', '#ff000080');
    await expectFormat(page, 'rgb', 'rgba(255, 0, 0, 0.5)');

    // 逗号语法省略 alpha：默认不透明，命名颜色标「精确」
    await page.locator(INPUT).fill('rgb(255, 0, 0)');
    await expectFormat(page, 'hex', '#ff0000');
    await expectFormat(page, 'named', 'red');
    await expect(page.getByTestId('color-named-exact')).toBeVisible();
  });

  test('hsl(120, 100%, 25%) → #008000（green 精确）；rebeccapurple → #663399；RED → #ff0000', async ({ page }) => {
    await openTool(page, 'color');
    await page.locator(INPUT).fill('hsl(120, 100%, 25%)');
    await expectFormat(page, 'hex', '#008000');
    await expectFormat(page, 'named', 'green');
    await expect(page.getByTestId('color-named-exact')).toBeVisible();

    await page.locator(INPUT).fill('rebeccapurple');
    await expectFormat(page, 'hex', '#663399');
    await expectFormat(page, 'named', 'rebeccapurple');

    await page.locator(INPUT).fill('RED');
    await expectFormat(page, 'hex', '#ff0000');
    await expectFormat(page, 'named', 'red');
    await expect(page.getByTestId('color-named-exact')).toBeVisible();
  });

  test('oklch 输出：#ffffff → oklch(1.000 0.000 0)，#ff0000 → oklch(0.628 0.258 29.234)', async ({ page }) => {
    await openTool(page, 'color');
    await page.locator(INPUT).fill('#ffffff');
    await expectFormat(page, 'oklch', 'oklch(1.000 0.000 0)');
    await page.locator(INPUT).fill('#ff0000');
    await expectFormat(page, 'oklch', 'oklch(0.628 0.258 29.234)');
  });

  test('🖥 在取色器中选择颜色后输入框同步更新', async ({ page }) => {
    await openTool(page, 'color');
    // 原生取色器无法直接弹开，模拟用户选色：改值并派发 input 事件
    await page.getByTestId('color-picker').evaluate((el, value) => {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, '#00aa33');
    await expect(page.locator(INPUT)).toHaveValue('#00aa33');
    await expectFormat(page, 'hex', '#00aa33');
    await expect(page.getByTestId('color-swatch')).toHaveCSS('background-color', 'rgb(0, 170, 51)');
  });

  test('非法输入给出中文提示「无法识别的颜色」，修正后恢复', async ({ page }) => {
    await openTool(page, 'color');
    for (const bad of ['#12', 'rgb(300,0,0,0,0)', 'hsl(abc)', 'notacolor']) {
      await page.locator(INPUT).fill(bad);
      await expect(page.getByRole('alert')).toHaveText('无法识别的颜色');
    }
    await expectFormat(page, 'hex', '—'); // 结果区复位

    // 修正输入后错误消失、结果恢复
    await page.locator(INPUT).fill('#1e90ff');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expectFormat(page, 'hex', '#1e90ff');
  });

  test('rgb(300,0,0) 截断为 #ff0000，并提示「数值已被限制在 0–255」', async ({ page }) => {
    await openTool(page, 'color');
    await page.locator(INPUT).fill('rgb(300,0,0)');
    await expectFormat(page, 'hex', '#ff0000');
    await expect(page.getByTestId('color-note')).toBeVisible();
    await expect(page.getByTestId('color-note')).toHaveText('数值已被限制在 0–255');
    await expect(page.getByRole('alert')).toHaveCount(0); // 截断是提示，不是错误
  });

  test('transparent → #00000000，预览显示棋盘格（半透明）', async ({ page }) => {
    await openTool(page, 'color');
    await page.locator(INPUT).fill('transparent');
    await expectFormat(page, 'hex', '#00000000');
    await expectFormat(page, 'rgb', 'rgba(0, 0, 0, 0)');
    await expectFormat(page, 'named', 'transparent');
    await expect(page.getByTestId('color-named-exact')).toBeVisible();
    await expect(page.getByTestId('color-swatch')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });

  test('「复制全部格式」「复制 RGB」读回一致', async ({ page }) => {
    await openTool(page, 'color');
    await page.locator(INPUT).fill('#1e90ff');
    await expectFormat(page, 'rgb', 'rgb(30, 144, 255)');

    await page.getByRole('button', { name: '复制 RGB' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('rgb(30, 144, 255)');

    await page.getByRole('button', { name: '复制全部格式' }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('HEX: #1e90ff');
    expect(copied).toContain('HSL: hsl(210, 100%, 56%)');
  });
});

/* ==================== 对比度检查（WCAG 2.x） ==================== */

test.describe('颜色工具：对比度检查', () => {
  test('#777777 字 / #ffffff 底 → 4.48:1；AA 大字通过，其余不通过；示例预览着色', async ({ page }) => {
    await openTool(page, 'color');
    await page.locator(FG).fill('#777777');
    await page.locator(BG).fill('#ffffff');
    await expect(page.getByTestId('color-ratio')).toHaveText('4.48:1');
    await expect(page.getByTestId('color-wcag-aaNormal')).toContainText('不通过');
    await expect(page.getByTestId('color-wcag-aaLarge')).toContainText('通过');
    await expect(page.getByTestId('color-wcag-aaaNormal')).toContainText('不通过');
    await expect(page.getByTestId('color-wcag-aaaLarge')).toContainText('不通过');

    // 示例文字预览：背景与文字颜色按输入着色
    const sample = page.getByTestId('color-sample');
    await expect(sample).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(sample.locator('.color-sample-normal')).toHaveCSS('color', 'rgb(119, 119, 119)');
  });

  test('#000 / #fff → 21.00:1 全部通过；相同颜色 → 1.00:1 全部不通过', async ({ page }) => {
    await openTool(page, 'color');
    await page.locator(FG).fill('#000');
    await page.locator(BG).fill('#fff');
    await expect(page.getByTestId('color-ratio')).toHaveText('21.00:1');
    for (const key of ['aaNormal', 'aaLarge', 'aaaNormal', 'aaaLarge']) {
      await expect(page.getByTestId(`color-wcag-${key}`)).toContainText('通过');
    }

    await page.locator(FG).fill('#1e90ff');
    await page.locator(BG).fill('#1e90ff');
    await expect(page.getByTestId('color-ratio')).toHaveText('1.00:1');
    for (const key of ['aaNormal', 'aaLarge', 'aaaNormal', 'aaaLarge']) {
      await expect(page.getByTestId(`color-wcag-${key}`)).toContainText('不通过');
    }
  });

  test('半透明前景 rgba(0,0,0,0.5) 在 #ffffff 上 → 约 3.95:1，并提示已混合', async ({ page }) => {
    await openTool(page, 'color');
    await page.locator(FG).fill('rgba(0,0,0,0.5)');
    await page.locator(BG).fill('#ffffff');
    await expect(page.getByTestId('color-ratio')).toHaveText('3.95:1');
    await expect(page.getByTestId('color-blend-note')).toBeVisible();
    await expect(page.getByTestId('color-blend-note')).toContainText('#808080');
  });

  test('🖥 点击「交换前景 / 背景」→ 两个输入互换，对比度数值不变', async ({ page }) => {
    await openTool(page, 'color');
    await page.locator(FG).fill('#777777');
    await page.locator(BG).fill('#ffffff');
    await expect(page.getByTestId('color-ratio')).toHaveText('4.48:1');

    await page.getByRole('button', { name: '交换前景 / 背景' }).click();
    await expect(page.locator(FG)).toHaveValue('#ffffff');
    await expect(page.locator(BG)).toHaveValue('#777777');
    await expect(page.getByTestId('color-ratio')).toHaveText('4.48:1');
  });

  test('对比度输入非法时给出中文提示、结果复位', async ({ page }) => {
    await openTool(page, 'color');
    await page.locator(FG).fill('notacolor');
    await expect(page.getByRole('alert')).toHaveText('无法识别的颜色');
    await expect(page.getByTestId('color-ratio')).toHaveText('—');

    await page.locator(FG).fill('#777777');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('color-ratio')).toHaveText('4.48:1');
  });

  test('「复制对比度」读回一致', async ({ page }) => {
    await openTool(page, 'color');
    await page.locator(FG).fill('#777777');
    await page.locator(BG).fill('#ffffff');
    await expect(page.getByTestId('color-ratio')).toHaveText('4.48:1');
    await page.getByRole('button', { name: '复制对比度' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('4.48:1');
  });
});

/* ==================== 明度阶梯色板 ==================== */

test.describe('颜色工具：明度阶梯色板', () => {
  test('显示 10 级色板，随输入变化；点击色块复制对应 HEX', async ({ page }) => {
    await openTool(page, 'color');
    await page.locator(INPUT).fill('#1e90ff');
    await expect(page.locator('.color-shade')).toHaveCount(10);
    await expect(page.getByTestId('color-shade-0')).toHaveAttribute('title', '#000d19');
    await expect(page.getByTestId('color-shade-9')).toHaveAttribute('title', '#e5f2ff');

    await page.getByTestId('color-shade-0').click();
    await expect(page.getByTestId('color-shade-copied')).toHaveText('已复制 #000d19');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('#000d19');

    // 换一个颜色后色板随之更新
    await page.locator(INPUT).fill('#ff0000');
    await expect(page.getByTestId('color-shade-0')).toHaveAttribute('title', '#190000');
    await expect(page.getByTestId('color-shade-9')).toHaveAttribute('title', '#ffe5e5');
  });
});

/* ==================== 状态记忆 ==================== */

test.describe('颜色工具：状态记忆', () => {
  test('刷新后恢复上次输入（ctx.storage）', async ({ page }) => {
    await openTool(page, 'color');
    await page.locator(INPUT).fill('rebeccapurple');
    await page.locator(FG).fill('#123456');
    await page.locator(BG).fill('rgb(240 248 255)');
    // 等结果更新，意味着防抖回调已执行、输入已写入 storage
    await expectFormat(page, 'hex', '#663399');
    await expect(page.getByTestId('color-ratio')).toHaveText('11.85:1');

    await page.reload();
    await expect(page.locator('[data-tool-ready="color"]')).toBeAttached();
    await expect(page.locator(INPUT)).toHaveValue('rebeccapurple');
    await expectFormat(page, 'hex', '#663399');
    await expect(page.locator(FG)).toHaveValue('#123456');
    await expect(page.locator(BG)).toHaveValue('rgb(240 248 255)');
    await expect(page.getByTestId('color-ratio')).toHaveText('11.85:1');
  });
});

/* ==================== 主题与移动端 ==================== */

test.describe('颜色工具：主题与移动端', () => {
  test('深色与浅色主题下界面都可用、无报错', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openTool(page, 'color');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator(INPUT).fill('#1e90ff');
    await expectFormat(page, 'hex', '#1e90ff');
    await expect(page.getByTestId('color-ratio')).toHaveText('4.48:1');

    await page.getByRole('button', { name: '切换主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator(INPUT).fill('hsl(120, 100%, 25%)');
    await expectFormat(page, 'hex', '#008000');
    await page.locator(FG).fill('rgba(0,0,0,0.5)');
    await expect(page.getByTestId('color-ratio')).toHaveText('3.95:1');
  });

  test.describe('视口 375×667', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('无横向滚动，转换与对比度检查正常', async ({ page }) => {
      await openTool(page, 'color');
      await page.locator(INPUT).fill('#1e90ff');
      await expectFormat(page, 'hex', '#1e90ff');
      await expect(page.getByTestId('color-ratio')).toHaveText('4.48:1');

      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(noOverflow).toBe(true);
    });
  });
});
