/** 进制转换与位运算端到端测试（对应 issue #22「进制转换与位运算」验收标准） */

import { test, expect, openTool } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

/** 常用定位器：进制输入框按可访问名称取 */
const field = (page, name) => page.getByLabel(name, { exact: true });
const BIN = '二进制';
const OCT = '八进制';
const DEC = '十进制';
const HEX = '十六进制';

/* ==================== 外壳集成 ==================== */

test.describe('进制转换：外壳集成', () => {
  test('打开 #/number-base：侧边栏高亮、标题正确、初始为空、默认 32 位', async ({ page }) => {
    await openTool(page, 'number-base');
    await expect(page).toHaveTitle('进制转换 - 码工具箱');
    await expect(page.getByRole('heading', { name: '进制转换' })).toBeVisible();
    await expect(page.locator('#tool-nav a[data-tool-id="number-base"]')).toHaveAttribute(
      'aria-current',
      'true',
    );

    // 输入框全部为空
    for (const name of [BIN, OCT, DEC, HEX, '自定义进制值']) {
      await expect(field(page, name)).toHaveValue('');
    }
    // 补码视图按 0 展示，位网格 32 格
    await expect(page.getByTestId('number-base-comp-unsigned')).toHaveText('0');
    await expect(page.getByTestId('number-base-comp-signed')).toHaveText('0');
    await expect(page.getByTestId('number-base-comp-bits')).toHaveText(
      '0000 0000 0000 0000 0000 0000 0000 0000',
    );
    await expect(page.locator('.nb-bit')).toHaveCount(32);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('搜索清单关键词能找到本工具（进制 / 二进制 / 十六进制 / hex / binary / 位运算 / bitwise / jinzhi）', async ({ page }) => {
    for (const keyword of [
      '进制',
      '进制转换',
      '二进制',
      '十六进制',
      'hex',
      'binary',
      '位运算',
      'bitwise',
      '补码',
      'jinzhi',
    ]) {
      await page.goto('/');
      await page.getByLabel('搜索工具').fill(keyword);
      await expect(page.locator('#tool-nav').getByRole('link', { name: '进制转换' })).toBeVisible();
    }
  });
});

/* ==================== 进制转换 ==================== */

test.describe('进制转换：互转', () => {
  test('十进制 255 → 二进制 1111 1111、八进制 377、十六进制 FF、36 进制 73', async ({ page }) => {
    await openTool(page, 'number-base');
    await field(page, DEC).fill('255');
    await expect(field(page, BIN)).toHaveValue('1111 1111');
    await expect(field(page, OCT)).toHaveValue('377');
    await expect(field(page, HEX)).toHaveValue('FF');
    await expect(field(page, '自定义进制值')).toHaveValue('73');
  });

  test('在十六进制框改为 100 → 十进制框变为 256（任一框输入，其余同步）', async ({ page }) => {
    await openTool(page, 'number-base');
    await field(page, DEC).fill('255');
    await expect(field(page, BIN)).toHaveValue('1111 1111');
    await field(page, HEX).fill('100');
    await expect(field(page, DEC)).toHaveValue('256');
    await expect(field(page, BIN)).toHaveValue('1 0000 0000');
    await expect(field(page, OCT)).toHaveValue('400');
  });

  test('前缀与分隔符：0x1F / 0b1010_1010 / 0o777 / 1,000,000', async ({ page }) => {
    await openTool(page, 'number-base');

    await field(page, DEC).fill('0x1F');
    await expect(field(page, BIN)).toHaveValue('1 1111');
    await expect(field(page, OCT)).toHaveValue('37');
    await expect(field(page, HEX)).toHaveValue('1F');

    await field(page, DEC).fill('0b1010_1010');
    await expect(field(page, BIN)).toHaveValue('1010 1010');
    await expect(field(page, OCT)).toHaveValue('252');
    await expect(field(page, HEX)).toHaveValue('AA');

    await field(page, DEC).fill('0o777');
    await expect(field(page, BIN)).toHaveValue('1 1111 1111');
    await expect(field(page, HEX)).toHaveValue('1FF');

    await field(page, DEC).fill('1,000,000');
    await expect(field(page, HEX)).toHaveValue('F 42 40');
    await expect(field(page, '自定义进制值')).toHaveValue('LFLS'); // 1000000 的 36 进制表示
  });

  test('大数与负数：12345678901234567890 → AB54A98CEB1F0AD2；-255 → -FF（关闭分组）', async ({ page }) => {
    await openTool(page, 'number-base');
    await page.getByLabel('分组显示').uncheck();

    await field(page, DEC).fill('12345678901234567890');
    await expect(field(page, HEX)).toHaveValue('AB54A98CEB1F0AD2');
    await expect(field(page, BIN)).toHaveValue('1010 1011 0101 0100 1010 1001 1000 1100 1110 1011 0001 1111 0000 1010 1101 0010');

    await field(page, DEC).fill('-255');
    await expect(field(page, HEX)).toHaveValue('-FF');
    await expect(field(page, BIN)).toHaveValue('-11111111');
  });

  test('非法输入给出中文错误：0b102 / xyz / 基数 37，修正后恢复', async ({ page }) => {
    await openTool(page, 'number-base');

    await field(page, BIN).fill('0b102');
    await expect(page.getByRole('alert')).toHaveText('「2」不是合法的二进制数字');
    await expect(field(page, DEC)).toHaveValue('');

    await field(page, HEX).fill('xyz');
    await expect(page.getByRole('alert')).toHaveText('「x」不是合法的十六进制数字');

    await field(page, HEX).fill('FF');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(field(page, DEC)).toHaveValue('255');

    // 基数超出 2–36
    await page.getByLabel('自定义进制基数').fill('37');
    await expect(page.getByRole('alert')).toHaveText('进制范围为 2–36');
    await expect(field(page, '自定义进制值')).toHaveValue('');

    // 修正基数后恢复
    await page.getByLabel('自定义进制基数').fill('36');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(field(page, '自定义进制值')).toHaveValue('73');

    // 清空输入：不报错，其余框同步清空
    await field(page, DEC).fill('');
    await expect(field(page, BIN)).toHaveValue('');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('分组与大小写开关：二进制 1111 1111 ↔ 11111111，十六进制 FF ↔ ff', async ({ page }) => {
    await openTool(page, 'number-base');
    await field(page, DEC).fill('255');

    await expect(field(page, BIN)).toHaveValue('1111 1111');
    await page.getByLabel('分组显示').uncheck();
    await expect(field(page, BIN)).toHaveValue('11111111');
    await expect(page.getByTestId('number-base-comp-bits')).toHaveText('00000000000000000000000011111111');

    await page.getByLabel('分组显示').check();
    await expect(field(page, BIN)).toHaveValue('1111 1111');

    await page.getByRole('button', { name: '小写' }).click();
    await expect(field(page, HEX)).toHaveValue('ff');
    await page.getByRole('button', { name: '大写' }).click();
    await expect(field(page, HEX)).toHaveValue('FF');
  });

  test('自定义进制也可作为输入框：基数 2 时输入 1111 1111 → 十进制 255', async ({ page }) => {
    await openTool(page, 'number-base');
    await page.getByLabel('自定义进制基数').fill('2');
    await field(page, '自定义进制值').fill('1111 1111');
    await expect(field(page, DEC)).toHaveValue('255');
    await expect(field(page, HEX)).toHaveValue('FF');
  });

  test('「复制二进制」读回剪贴板，与输入框一致', async ({ page }) => {
    await openTool(page, 'number-base');
    await field(page, DEC).fill('255');
    await expect(field(page, BIN)).toHaveValue('1111 1111');

    await page.getByRole('button', { name: '复制二进制' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('1111 1111');
  });
});

/* ==================== 补码视图 ==================== */

test.describe('进制转换：补码视图', () => {
  test('8 位下 -1 → 11111111（无符号 255、有符号 -1）', async ({ page }) => {
    await openTool(page, 'number-base');
    await page.getByRole('button', { name: '8 位' }).click();
    await field(page, DEC).fill('-1');
    await expect(page.getByTestId('number-base-comp-bits')).toHaveText('1111 1111');
    await expect(page.getByTestId('number-base-comp-unsigned')).toHaveText('255');
    await expect(page.getByTestId('number-base-comp-signed')).toHaveText('-1');
    await expect(page.getByTestId('number-base-comp-warn')).toBeHidden();
    await expect(page.locator('.nb-bit')).toHaveCount(8);
  });

  test('8 位下 -128 → 10000000', async ({ page }) => {
    await openTool(page, 'number-base');
    await page.getByRole('button', { name: '8 位' }).click();
    await field(page, DEC).fill('-128');
    await expect(page.getByTestId('number-base-comp-bits')).toHaveText('1000 0000');
    await expect(page.getByTestId('number-base-comp-unsigned')).toHaveText('128');
    await expect(page.getByTestId('number-base-comp-signed')).toHaveText('-128');
  });

  test('8 位下 128 → 提示超出有符号范围，无符号为 128', async ({ page }) => {
    await openTool(page, 'number-base');
    await page.getByRole('button', { name: '8 位' }).click();
    await field(page, DEC).fill('128');
    await expect(page.getByTestId('number-base-comp-warn')).toBeVisible();
    await expect(page.getByTestId('number-base-comp-warn')).toHaveText(
      '超出 8 位有符号范围（-128 – 127），无符号值为 128',
    );
    await expect(page.getByTestId('number-base-comp-unsigned')).toHaveText('128');
    await expect(page.getByTestId('number-base-comp-signed')).toHaveText('-128');
  });

  test('8 位下 256 → 提示超出 8 位范围，截断为 0', async ({ page }) => {
    await openTool(page, 'number-base');
    await page.getByRole('button', { name: '8 位' }).click();
    await field(page, DEC).fill('256');
    await expect(page.getByTestId('number-base-comp-warn')).toBeVisible();
    await expect(page.getByTestId('number-base-comp-warn')).toHaveText('超出 8 位范围，截断为 0');
    await expect(page.getByTestId('number-base-comp-bits')).toHaveText('0000 0000');
    await expect(page.getByTestId('number-base-comp-unsigned')).toHaveText('0');
  });
});

/* ==================== 位运算 ==================== */

test.describe('进制转换：位运算', () => {
  test('32 位：0b1100 AND/OR/XOR 0b1010 → 8（1000）/ 14 / 6', async ({ page }) => {
    await openTool(page, 'number-base');
    await field(page, '操作数 A').fill('0b1100');
    await field(page, '操作数 B').fill('0b1010');

    await page.getByLabel('运算').selectOption('AND');
    await expect(page.getByTestId('number-base-result-bits')).toHaveText('1000');
    await expect(page.getByTestId('number-base-result-unsigned')).toHaveText('8');
    await expect(page.getByTestId('number-base-result-signed')).toHaveText('8');
    await expect(page.getByTestId('number-base-result-hex')).toHaveText('8');

    await page.getByLabel('运算').selectOption('OR');
    await expect(page.getByTestId('number-base-result-unsigned')).toHaveText('14');
    await expect(page.getByTestId('number-base-result-bits')).toHaveText('1110');

    await page.getByLabel('运算').selectOption('XOR');
    await expect(page.getByTestId('number-base-result-unsigned')).toHaveText('6');
    await expect(page.getByTestId('number-base-result-bits')).toHaveText('110');
  });

  test('8 位：NOT 0x0F → 0xF0（无符号 240，有符号 -16），操作数 B 禁用', async ({ page }) => {
    await openTool(page, 'number-base');
    await page.getByRole('button', { name: '8 位' }).click();
    await page.getByLabel('运算').selectOption('NOT');
    await expect(field(page, '操作数 B')).toBeDisabled();
    await field(page, '操作数 A').fill('0x0F');

    await expect(page.getByTestId('number-base-result-bits')).toHaveText('1111 0000');
    await expect(page.getByTestId('number-base-result-hex')).toHaveText('F0');
    await expect(page.getByTestId('number-base-result-unsigned')).toHaveText('240');
    await expect(page.getByTestId('number-base-result-signed')).toHaveText('-16');
  });

  test('32 位移位：1 << 31 → 有符号 -2147483648、无符号 2147483648；-16 >> 2 = -4；-16 >>> 28 = 15', async ({ page }) => {
    await openTool(page, 'number-base');
    await field(page, '操作数 A').fill('1');
    await page.getByLabel('运算').selectOption('SHL');
    // 选择移位运算后第二个操作数的标签变为「移位量」
    await field(page, '移位量').fill('31');
    await expect(page.getByTestId('number-base-result-signed')).toHaveText('-2147483648');
    await expect(page.getByTestId('number-base-result-unsigned')).toHaveText('2147483648');
    await expect(page.getByTestId('number-base-result-hex')).toHaveText('80 00 00 00');

    await field(page, '操作数 A').fill('-16');
    await page.getByLabel('运算').selectOption('SAR');
    await field(page, '移位量').fill('2');
    await expect(page.getByTestId('number-base-result-signed')).toHaveText('-4');

    await page.getByLabel('运算').selectOption('SHR');
    await field(page, '移位量').fill('28');
    await expect(page.getByTestId('number-base-result-unsigned')).toHaveText('15');
    await expect(page.getByTestId('number-base-result-signed')).toHaveText('15');
  });

  test('64 位：1 << 63 → 无符号 9223372036854775808', async ({ page }) => {
    await openTool(page, 'number-base');
    await page.getByRole('button', { name: '64 位' }).click();
    await expect(page.locator('.nb-bit')).toHaveCount(64);
    await field(page, '操作数 A').fill('1');
    await page.getByLabel('运算').selectOption('SHL');
    await field(page, '移位量').fill('63');
    await expect(page.getByTestId('number-base-result-unsigned')).toHaveText('9223372036854775808');
    await expect(page.getByTestId('number-base-result-signed')).toHaveText('-9223372036854775808');
  });

  test('移位量非法（负数或 ≥ 位宽）与非法操作数 → 中文提示', async ({ page }) => {
    await openTool(page, 'number-base');
    await field(page, '操作数 A').fill('1');
    await page.getByLabel('运算').selectOption('SHL');

    await field(page, '移位量').fill('32');
    await expect(page.getByRole('alert')).toHaveText('移位量须为 0 到 31 之间的整数，当前为 32');
    await expect(page.getByTestId('number-base-result-unsigned')).toHaveText('');

    await field(page, '移位量').fill('-1');
    await expect(page.getByRole('alert')).toHaveText('移位量须为 0 到 31 之间的整数，当前为 -1');

    await field(page, '移位量').fill('zz');
    await expect(page.getByRole('alert')).toHaveText('移位量：「z」不是合法的十进制数字');

    await field(page, '操作数 A').fill('12x');
    await expect(page.getByRole('alert')).toHaveText('操作数 A：「x」不是合法的十进制数字');

    // 修正后错误消失、结果恢复
    await field(page, '操作数 A').fill('1');
    await field(page, '移位量').fill('4');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('number-base-result-unsigned')).toHaveText('16');
  });

  test('操作数超出位宽：按补码截断并提示（8 位下 256 AND 1 = 0）', async ({ page }) => {
    await openTool(page, 'number-base');
    await page.getByRole('button', { name: '8 位' }).click();
    await field(page, '操作数 A').fill('256');
    await page.getByLabel('运算').selectOption('AND');
    await field(page, '操作数 B').fill('1');
    await expect(page.getByTestId('number-base-result-warn')).toBeVisible();
    await expect(page.getByTestId('number-base-result-warn')).toHaveText(
      '操作数 A 超出 8 位范围，已按补码截断为 0',
    );
    await expect(page.getByTestId('number-base-result-unsigned')).toHaveText('0');
  });

  test('「复制结果二进制」读回剪贴板一致', async ({ page }) => {
    await openTool(page, 'number-base');
    await field(page, '操作数 A').fill('0b1100');
    await page.getByLabel('运算').selectOption('AND');
    await field(page, '操作数 B').fill('0b1010');
    await expect(page.getByTestId('number-base-result-bits')).toHaveText('1000');

    await page.getByRole('button', { name: '复制结果二进制' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('1000');
  });
});

/* ==================== 位网格 ==================== */

test.describe('进制转换：位网格', () => {
  test('从 0 开始点击第 0 位和第 4 位 → 十进制显示 17', async ({ page }) => {
    await openTool(page, 'number-base');
    await expect(field(page, DEC)).toHaveValue('');

    await page.getByTestId('number-base-bit-0').click();
    await expect(field(page, DEC)).toHaveValue('1');
    await expect(page.getByTestId('number-base-bit-0')).toContainText('1');

    await page.getByTestId('number-base-bit-4').click();
    await expect(field(page, DEC)).toHaveValue('17');
    await expect(field(page, BIN)).toHaveValue('1 0001');
    await expect(page.getByTestId('number-base-comp-unsigned')).toHaveText('17');

    // 再点一次第 4 位翻回
    await page.getByTestId('number-base-bit-4').click();
    await expect(field(page, DEC)).toHaveValue('1');
  });

  test('位网格随输入变化：255 的低 8 位为 1，点击第 0 位 → 254', async ({ page }) => {
    await openTool(page, 'number-base');
    await field(page, DEC).fill('255');
    for (const bit of [0, 1, 2, 3, 4, 5, 6, 7]) {
      await expect(page.getByTestId(`number-base-bit-${bit}`)).toHaveAttribute(
        'aria-label',
        `第 ${bit} 位，当前 1，点击翻转`,
      );
    }
    await expect(page.getByTestId('number-base-bit-8')).toContainText('0');

    await page.getByTestId('number-base-bit-0').click();
    await expect(field(page, DEC)).toHaveValue('254');
  });
});

/* ==================== 持久化 / 主题 / 移动端 ==================== */

test.describe('进制转换：持久化、主题与移动端', () => {
  test('刷新后恢复选项与输入（ctx.storage）', async ({ page }) => {
    await openTool(page, 'number-base');
    await page.getByRole('button', { name: '8 位' }).click();
    await page.getByRole('button', { name: '小写' }).click();
    await page.getByLabel('分组显示').uncheck();
    await field(page, DEC).fill('-1');
    await field(page, '操作数 A').fill('0x0F');
    await page.getByLabel('运算').selectOption('NOT');
    await expect(page.getByTestId('number-base-result-unsigned')).toHaveText('240');

    await page.reload();
    await expect(page.locator('[data-tool-ready="number-base"]')).toBeAttached();
    await expect(field(page, DEC)).toHaveValue('-1');
    await expect(field(page, HEX)).toHaveValue('-ff');
    await expect(page.getByTestId('number-base-comp-bits')).toHaveText('11111111');
    await expect(page.locator('.nb-bit')).toHaveCount(8);
    await expect(page.getByRole('button', { name: '8 位' })).toHaveAttribute('aria-pressed', 'true');
    await expect(field(page, '操作数 A')).toHaveValue('0x0F');
    await expect(page.getByLabel('运算')).toHaveValue('NOT');
    await expect(page.getByTestId('number-base-result-unsigned')).toHaveText('240');
  });

  test('清空按钮：全部输入与结果复位', async ({ page }) => {
    await openTool(page, 'number-base');
    await field(page, DEC).fill('255');
    await field(page, '操作数 A').fill('0b1100');
    await page.getByLabel('运算').selectOption('AND');
    await field(page, '操作数 B').fill('0b1010');
    await expect(page.getByTestId('number-base-result-unsigned')).toHaveText('8');

    await page.getByRole('button', { name: '清空' }).click();
    for (const name of [BIN, OCT, DEC, HEX, '自定义进制值', '操作数 A', '操作数 B']) {
      await expect(field(page, name)).toHaveValue('');
    }
    await expect(page.getByTestId('number-base-comp-unsigned')).toHaveText('0');
    await expect(page.getByTestId('number-base-result-unsigned')).toHaveText('');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('深色与浅色主题下界面都可用、无报错', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openTool(page, 'number-base');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await field(page, DEC).fill('255');
    await expect(field(page, BIN)).toHaveValue('1111 1111');
    await page.getByTestId('number-base-bit-8').click();
    await expect(field(page, DEC)).toHaveValue('511');

    await page.getByRole('button', { name: '切换主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await field(page, DEC).fill('1');
    await expect(field(page, HEX)).toHaveValue('1');
    await expect(page.getByTestId('number-base-comp-bits')).toHaveText(
      '0000 0000 0000 0000 0000 0000 0000 0001',
    );
  });

  test.describe('视口 375×667', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('无横向滚动，64 位网格下转换与位运算正常', async ({ page }) => {
      await openTool(page, 'number-base');
      await field(page, DEC).fill('255');
      await expect(field(page, BIN)).toHaveValue('1111 1111');

      await page.getByRole('button', { name: '64 位' }).click();
      await field(page, '操作数 A').fill('1');
      await page.getByLabel('运算').selectOption('SHL');
      await field(page, '移位量').fill('63');
      await expect(page.getByTestId('number-base-result-unsigned')).toHaveText('9223372036854775808');

      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(noOverflow).toBe(true);
    });
  });
});
