/** 命名风格转换端到端测试（对应 issue #17 验收标准，🖥 条目在无头浏览器中真实操作） */

import { test, expect, openTool } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const INPUT = '[data-testid="case-convert-input"]';

/** 某个风格结果行的文本 */
const result = (page, id) => page.getByTestId(`case-convert-result-${id}`);

test.describe('命名风格转换', () => {
  test('初始为空：所有结果为空、分词预览为空，不报错', async ({ page }) => {
    await openTool(page, 'case-convert');
    await expect(page.locator(INPUT)).toHaveValue('');
    for (const id of [
      'camel',
      'pascal',
      'snake',
      'screaming',
      'kebab',
      'train',
      'dot',
      'path',
      'title',
      'sentence',
      'lower',
      'upper',
      'half',
      'full',
    ]) {
      await expect(result(page, id)).toHaveText('');
      await expect(result(page, id)).toHaveClass(/is-empty/);
    }
    await expect(page.getByTestId('case-convert-tokens')).toHaveText('');
  });

  test('🖥 输入 XMLHttpRequest：snake_case 行显示 xml_http_request，点复制后剪贴板一致', async ({ page }) => {
    await openTool(page, 'case-convert');
    await page.locator(INPUT).fill('XMLHttpRequest');

    await expect(result(page, 'snake')).toHaveText('xml_http_request');
    await expect(page.getByTestId('case-convert-copy-snake')).toBeVisible();

    await page.getByTestId('case-convert-copy-snake').click();
    await expect(page.getByTestId('case-convert-copy-snake')).toHaveClass(/is-copied/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('xml_http_request');
  });

  test('XMLHttpRequest：其余 11 种风格与分词预览全部正确', async ({ page }) => {
    await openTool(page, 'case-convert');
    await page.locator(INPUT).fill('XMLHttpRequest');

    await expect(result(page, 'camel')).toHaveText('xmlHttpRequest');
    await expect(result(page, 'pascal')).toHaveText('XmlHttpRequest');
    await expect(result(page, 'screaming')).toHaveText('XML_HTTP_REQUEST');
    await expect(result(page, 'kebab')).toHaveText('xml-http-request');
    await expect(result(page, 'train')).toHaveText('Xml-Http-Request');
    await expect(result(page, 'dot')).toHaveText('xml.http.request');
    await expect(result(page, 'path')).toHaveText('xml/http/request');
    await expect(result(page, 'title')).toHaveText('Xml Http Request');
    await expect(result(page, 'sentence')).toHaveText('Xml http request');
    await expect(result(page, 'lower')).toHaveText('xml http request');
    await expect(result(page, 'upper')).toHaveText('XML HTTP REQUEST');
    await expect(page.getByTestId('case-convert-tokens')).toHaveText('XML|Http|Request');
  });

  test('分词规则示例：getHTTPResponseCode、user_id-v2 name、iPhone15Pro、用户 name', async ({ page }) => {
    await openTool(page, 'case-convert');
    await page.locator(INPUT).fill('getHTTPResponseCode');
    await expect(result(page, 'snake')).toHaveText('get_http_response_code');

    await page.locator(INPUT).fill('user_id-v2 name');
    await expect(result(page, 'camel')).toHaveText('userIdV2Name');
    await expect(result(page, 'kebab')).toHaveText('user-id-v2-name');

    await page.locator(INPUT).fill('iPhone15Pro');
    await expect(result(page, 'snake')).toHaveText('i_phone15_pro');

    await page.locator(INPUT).fill('用户 name');
    await expect(result(page, 'camel')).toHaveText('用户Name');
    await expect(result(page, 'snake')).toHaveText('用户_name');
  });

  test('多行独立转换、空行保留：foo bar / 空行 / baz_qux', async ({ page }) => {
    await openTool(page, 'case-convert');
    await page.locator(INPUT).fill('foo bar\n\nbaz_qux');
    // toHaveText 会归一化空白：先等防抖更新完成，再用 textContent 精确断言换行与空行
    await expect(result(page, 'camel')).toContainText('fooBar');
    expect(await result(page, 'camel').textContent()).toBe('fooBar\n\nbazQux');
    expect(await result(page, 'snake').textContent()).toBe('foo_bar\n\nbaz_qux');
  });

  test('全角 → 半角：ＡＢＣ１２３，！　ｘ → ABC123，! x（中文逗号保持）', async ({ page }) => {
    await openTool(page, 'case-convert');
    await page.locator(INPUT).fill('ＡＢＣ１２３，！　ｘ');
    await expect(result(page, 'half')).toHaveText('ABC123，! x');
  });

  test('半角 → 全角：Hi 1! → Ｈｉ　１！', async ({ page }) => {
    await openTool(page, 'case-convert');
    await page.locator(INPUT).fill('Hi 1!');
    await expect(result(page, 'full')).toHaveText('Ｈｉ　１！');
  });

  test('多行结果的复制按钮复制完整多行文本', async ({ page }) => {
    await openTool(page, 'case-convert');
    await page.locator(INPUT).fill('foo bar\n\nbaz_qux');
    await expect(result(page, 'camel')).toHaveText('fooBar\n\nbazQux');

    await page.getByTestId('case-convert-copy-camel').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('fooBar\n\nbazQux');
  });

  test('「清空」按钮：结果全部清空', async ({ page }) => {
    await openTool(page, 'case-convert');
    await page.locator(INPUT).fill('hello world');
    await expect(result(page, 'camel')).toHaveText('helloWorld');

    await page.getByTestId('case-convert-clear').click();
    await expect(page.locator(INPUT)).toHaveValue('');
    await expect(result(page, 'camel')).toHaveText('');
    await expect(result(page, 'snake')).toHaveText('');
  });

  test('刷新后恢复上次输入（ctx.storage）', async ({ page }) => {
    await openTool(page, 'case-convert');
    await page.locator(INPUT).fill('XMLHttpRequest');
    await expect(result(page, 'snake')).toHaveText('xml_http_request');

    await page.reload();
    await expect(page.locator('[data-tool-ready="case-convert"]')).toBeAttached();
    await expect(page.locator(INPUT)).toHaveValue('XMLHttpRequest');
    await expect(result(page, 'snake')).toHaveText('xml_http_request');
  });

  test('输入变化后 300ms 内自动更新（防抖）', async ({ page }) => {
    await openTool(page, 'case-convert');
    const start = Date.now();
    await page.locator(INPUT).fill('hello world');
    // expect 默认 5s 超时；断言出现即检查自动更新生效，再核对总耗时 ≤ 1s（含防抖与渲染余量）
    await expect(result(page, 'camel')).toHaveText('helloWorld');
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test('大输入：两万字符一次输入仍可及时更新', async ({ page }) => {
    await openTool(page, 'case-convert');
    const line = 'someCamelCaseVariableName';
    await page.locator(INPUT).fill(`${line}\n`.repeat(1000));
    await expect(result(page, 'snake')).toContainText('some_camel_case_variable_name');
  });
});

test.describe('命名风格转换：外壳集成与主题 / 移动端', () => {
  test('打开 #/case-convert：标题正确、侧边栏高亮', async ({ page }) => {
    await openTool(page, 'case-convert');
    await expect(page).toHaveTitle('命名风格转换 - 码工具箱');
    await expect(page.locator('#tool-nav a[data-tool-id="case-convert"]')).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('搜索清单关键词能找到本工具（case / camelcase / snake_case / 驼峰 / 下划线 / 大小写 / 全角 / tuofeng）', async ({ page }) => {
    await page.goto('/');
    const search = page.getByLabel('搜索工具');
    for (const keyword of [
      'case',
      'camelcase',
      'snake_case',
      '驼峰',
      '下划线',
      '大小写',
      '全角',
      'tuofeng',
    ]) {
      await search.fill(keyword);
      await expect(page.locator('#tool-nav a[data-tool-id="case-convert"]')).toBeVisible();
    }
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme} 主题下打开并正常使用`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('glm-toolbox:theme', t), theme);
      await openTool(page, 'case-convert');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.locator(INPUT).fill('XMLHttpRequest');
      await expect(result(page, 'snake')).toHaveText('xml_http_request');
      await expect(result(page, 'half')).toHaveText('XMLHttpRequest');
    });
  }

  test('视口 375×667 下无横向滚动，可完成基本操作', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openTool(page, 'case-convert');
    await page.locator(INPUT).fill('XMLHttpRequest');
    await expect(result(page, 'snake')).toHaveText('xml_http_request');

    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noOverflow).toBe(true);
  });
});
