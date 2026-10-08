/** Markdown 预览端到端测试（对应 issue #20「验收标准」中的 🖥 条目与通用验收） */

import { test, expect, openTool, allowExpectedErrors, SUBPATH_BASE_URL } from '../../tests/e2e/fixtures.mjs';

// 复制按钮用例需要读写剪贴板
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const INPUT = '[data-testid="markdown-input"]';
const PREVIEW = '[data-testid="markdown-preview"]';

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 清空本地存储后打开工具，保证从「首次打开」状态开始 */
async function openToolFresh(page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  return openTool(page, 'markdown');
}

/* ==================== 外壳集成 ==================== */

test.describe('Markdown 预览：外壳集成', () => {
  test('打开 #/markdown：侧边栏高亮、标题正确', async ({ page }) => {
    await openTool(page, 'markdown');
    await expect(page).toHaveTitle('Markdown 预览 - 码工具箱');
    await expect(page.getByRole('heading', { name: 'Markdown 预览', exact: true })).toBeVisible();
    await expect(page.locator('#tool-nav a[data-tool-id="markdown"]')).toHaveAttribute('aria-current', 'true');
  });

  test('搜索清单关键词能找到本工具（markdown / md / 预览 / gfm / readme / yulan）', async ({ page }) => {
    for (const keyword of ['markdown', 'md', '预览', 'gfm', 'readme', 'yulan', '渲染', '标记']) {
      await page.goto('/');
      await page.getByLabel('搜索工具').fill(keyword);
      await expect(page.locator('#tool-nav').getByRole('link', { name: 'Markdown 预览' })).toBeVisible();
    }
  });

  test('子路径部署（--base /glm-toolbox/）下渲染正常', async ({ page }) => {
    await page.goto(`${SUBPATH_BASE_URL}#/markdown`);
    await expect(page.locator('[data-tool-ready="markdown"]')).toBeAttached();
    await expect(page.locator('link[data-tool-style="markdown"]')).toHaveCount(1);
    await page.locator(INPUT).fill('# 子路径');
    await expect(page.locator(`${PREVIEW} h1`)).toHaveText('子路径');
  });
});

/* ==================== 基础渲染（验收标准逐条） ==================== */

test.describe('Markdown 预览：渲染', () => {
  test('首次打开显示中文示例文档', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await expect(page.locator(`${PREVIEW} h1`)).toContainText('码工具箱');
    await expect(page.locator(INPUT)).toHaveValue(/# 码工具箱 · Markdown 预览/);
    await expect(page.locator(PREVIEW)).toContainText('不会上传');
  });

  test('`# 标题` → 预览中有 <h1>，文本「标题」', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill('# 标题');
    const h1 = page.locator(`${PREVIEW} h1`);
    await expect(h1).toHaveText('标题');
    expect(await h1.evaluate((node) => node.tagName)).toBe('H1');
  });

  test('表格：3 列，第二列居中对齐（th 与 td）', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill('| 左 | 中 | 右 |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
    const table = page.locator(`${PREVIEW} table`);
    await expect(table).toBeVisible();
    await expect(table.locator('th')).toHaveCount(3);
    await expect(table.locator('td')).toHaveCount(3);
    await expect(table.locator('th').nth(1)).toHaveAttribute('style', /center/);
    await expect(table.locator('td').nth(1)).toHaveAttribute('style', /center/);
    await expect(table.locator('th').nth(2)).toHaveAttribute('style', /right/);
  });

  test('任务列表：2 个 disabled 复选框，第一个 checked', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill('- [x] 完成\n- [ ] 未完成');
    const boxes = page.locator(`${PREVIEW} input[type="checkbox"]`);
    await expect(boxes).toHaveCount(2);
    await expect(boxes.first()).toBeChecked();
    await expect(boxes.first()).toBeDisabled();
    await expect(boxes.nth(1)).not.toBeChecked();
    await expect(boxes.nth(1)).toBeDisabled();
  });

  test('删除线 / 行内代码 / 代码块 language-js', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill('~~删除~~ 与 `code`\n\n```js\nlet a = 1;\n```');
    await expect(page.locator(`${PREVIEW} del`)).toHaveText('删除');
    await expect(page.locator(`${PREVIEW} p code`)).toHaveText('code');
    const block = page.locator(`${PREVIEW} pre code`);
    await expect(block).toHaveAttribute('class', 'language-js');
    await expect(block).toHaveText('let a = 1;');
  });

  test('自动链接：href / rel="noopener noreferrer" / target="_blank"', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill('https://example.com');
    const link = page.locator(`${PREVIEW} a`).first();
    await expect(link).toHaveAttribute('href', 'https://example.com');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveText('https://example.com');
  });

  test('嵌套列表 `- a\\n  - b` → 嵌套的 <ul>', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill('- a\n  - b');
    const nested = page.locator(`${PREVIEW} ul li ul`);
    await expect(nested).toHaveCount(1);
    await expect(nested.locator('li')).toHaveText('b');
  });

  test('原生 HTML `<b>粗</b>` 保留为 <b>', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill('<b>粗</b>');
    const bold = page.locator(`${PREVIEW} b`);
    await expect(bold).toHaveText('粗');
    expect(await bold.evaluate((node) => node.tagName)).toBe('B');
  });

  test('字数统计随输入更新', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill('你好 world\n第二行');
    await expect(page.getByTestId('markdown-stats')).toHaveText('10 字 · 2 行');
  });
});

/* ==================== 安全：XSS 与外部图片 ==================== */

test.describe('Markdown 预览：安全', () => {
  // `<img src=x onerror=…>` 经净化后留下相对地址图片，加载本地 404 属预期
  test('XSS：无 script / iframe / on* 属性 / javascript: 链接，点击后 window.__xss 仍为 undefined 🖥', async ({ page }) => {
    // 净化后 `<img src=x>` 保留相对地址，加载本地 404 资源属预期
    allowExpectedErrors(page, /Failed to load resource/);
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill(
      [
        '<img src=x onerror="window.__xss=1">',
        '<script>window.__xss=2</script>',
        '[点我](javascript:window.__xss=3)',
        '<a href="JaVaScRiPt:alert(1)">x</a>',
        '<iframe src="about:blank"></iframe>',
      ].join('\n\n'),
    );
    await expect(page.locator(PREVIEW)).toContainText('点我');

    const audit = await page.evaluate((sel) => {
      const root = document.querySelector(sel);
      const problems = [];
      problems.push(`script:${root.querySelectorAll('script').length}`);
      problems.push(`iframe:${root.querySelectorAll('iframe').length}`);
      const onAttrs = [];
      for (const node of root.querySelectorAll('*')) {
        for (const attr of node.attributes) {
          if (/^on/i.test(attr.name)) onAttrs.push(`${node.tagName}:${attr.name}`);
        }
      }
      problems.push(`onAttrs:${onAttrs.join(',')}`);
      const badHref = [...root.querySelectorAll('a')].map((a) => a.getAttribute('href') || '').filter((h) => /javascript:/i.test(h));
      problems.push(`jsHref:${badHref.join(',')}`);
      return problems;
    }, PREVIEW);
    expect(audit).toEqual(['script:0', 'iframe:0', 'onAttrs:', 'jsHref:']);

    // 点击「点我」不执行任何脚本
    await page.getByText('点我').click();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('外部图片默认拦截：显示占位且无网络请求；data:image 正常显示 🖥', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill(`![远程](https://example.com/a.png)\n\n![本地](${TINY_PNG})`);
    // 夹具会拦截任何非本地请求；占位与 data 图片都不应触发
    await expect(page.locator(`${PREVIEW} .md-ext-img`)).toHaveCount(1);
    await expect(page.locator(`${PREVIEW} .md-ext-img`)).toContainText('外部图片已拦截');
    await expect(page.locator(`${PREVIEW} .md-ext-img`)).toContainText('https://example.com/a.png');

    const img = page.locator(`${PREVIEW} img`);
    await expect(img).toHaveCount(1);
    await expect(img).toHaveAttribute('src', TINY_PNG);
    expect(await img.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);
    expect(await page.locator(PREVIEW).innerHTML()).not.toContain('https://example.com/a.png"');
  });

  test('「允许加载外部图片」开关：默认关闭，可打开，刷新后回到关闭（不持久化）', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill('# 标题');
    const box = page.getByLabel('允许加载外部图片');
    await expect(box).not.toBeChecked();
    await box.check();
    await expect(box).toBeChecked();
    await page.reload();
    await expect(page.locator('[data-tool-ready="markdown"]')).toBeAttached();
    await expect(page.getByLabel('允许加载外部图片')).not.toBeChecked();
  });
});

/* ==================== 工具栏与编辑 ==================== */

test.describe('Markdown 预览：工具栏', () => {
  test('点击「加粗」并选中「测试」→ 编辑区变为 **测试** 🖥', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill('测试');
    await page.locator(INPUT).evaluate((node) => {
      node.setSelectionRange(0, 2);
    });
    await page.getByRole('button', { name: '加粗', exact: true }).click();
    await expect(page.locator(INPUT)).toHaveValue('**测试**');
  });

  test('再次点击加粗可取消格式；标题按钮切换 ## 前缀', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill('**测试**');
    await page.locator(INPUT).evaluate((node) => node.setSelectionRange(2, 4));
    await page.getByRole('button', { name: '加粗', exact: true }).click();
    await expect(page.locator(INPUT)).toHaveValue('测试');

    await page.locator(INPUT).fill('正文');
    await page.getByRole('button', { name: '标题', exact: true }).click();
    await expect(page.locator(INPUT)).toHaveValue('## 正文');
    await expect(page.locator(`${PREVIEW} h2`)).toHaveText('正文');
    await page.getByRole('button', { name: '标题', exact: true }).click();
    await expect(page.locator(INPUT)).toHaveValue('正文');
  });

  test('插入表格模板并渲染为表格', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill('');
    await page.getByRole('button', { name: '表格', exact: true }).click();
    await expect(page.locator(`${PREVIEW} table`)).toBeVisible();
    await expect(page.locator(`${PREVIEW} th`)).toHaveCount(3);
  });

  test('链接按钮：空选区时插入占位并选中', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill('ab');
    await page.locator(INPUT).evaluate((node) => {
      node.setSelectionRange(1, 1);
    });
    await page.getByRole('button', { name: '链接', exact: true }).click();
    await expect(page.locator(INPUT)).toHaveValue('a[链接文字](https://example.com)b');
  });
});

/* ==================== 导出与持久化 ==================== */

test.describe('Markdown 预览：导出与持久化', () => {
  test('下载的 .html 包含 <!DOCTYPE html> 与渲染内容，无外部 link/script 🖥', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill('# 导出标题\n\n**加粗内容**');
    await expect(page.locator(`${PREVIEW} h1`)).toHaveText('导出标题');

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('markdown-download-html').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('markdown.html');

    const fs = await import('node:fs');
    const content = fs.readFileSync(await download.path(), 'utf8');
    expect(content.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(content).toContain('<h1>导出标题</h1>');
    expect(content).toContain('<strong>加粗内容</strong>');
    expect(content).toContain('<style>');
    expect(content).not.toMatch(/<link/i);
    expect(content).not.toMatch(/<script/i);
  });

  test('下载的 .md 是原始 Markdown 源文本', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill('# 源文档\n\n- 项目');
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('markdown-download-md').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('markdown.md');

    const fs = await import('node:fs');
    const content = fs.readFileSync(await download.path(), 'utf8');
    expect(content).toBe('# 源文档\n\n- 项目');
  });

  test('「复制 HTML」复制渲染后的 HTML', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill('# 复制标题');
    await expect(page.locator(`${PREVIEW} h1`)).toHaveText('复制标题');
    await page.getByRole('button', { name: '复制 HTML' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('<h1>复制标题</h1>');
  });

  test('刷新页面后编辑区内容保留（ctx.storage）🖥', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill('# 保留我\n\n一些内容');
    await expect(page.locator(`${PREVIEW} h1`)).toHaveText('保留我'); // 等防抖渲染完成（已写入 storage）

    await page.reload();
    await expect(page.locator('[data-tool-ready="markdown"]')).toBeAttached();
    await expect(page.locator(INPUT)).toHaveValue('# 保留我\n\n一些内容');
    await expect(page.locator(`${PREVIEW} h1`)).toHaveText('保留我');
    const stored = await page.evaluate(() => localStorage.getItem('glm-toolbox:markdown:text'));
    expect(stored).toContain('保留我');
  });
});

/* ==================== 布局 / 滚动 / 性能 ==================== */

test.describe('Markdown 预览：布局与性能', () => {
  test('视图切换：左右 / 仅编辑 / 仅预览', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    const editor = page.locator(INPUT);
    const preview = page.locator(PREVIEW);
    await expect(editor).toBeVisible();
    await expect(preview).toBeVisible();

    await page.getByRole('button', { name: '仅编辑' }).click();
    await expect(preview).toBeHidden();
    await expect(editor).toBeVisible();

    await page.getByRole('button', { name: '仅预览' }).click();
    await expect(editor).toBeHidden();
    await expect(preview).toBeVisible();

    await page.getByRole('button', { name: '左右' }).click();
    await expect(editor).toBeVisible();
    await expect(preview).toBeVisible();
  });

  test('编辑区滚动时预览按比例同步', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    const lines = Array.from({ length: 120 }, (_, i) => `第 ${i + 1} 行内容`);
    await page.locator(INPUT).fill(lines.join('\n'));
    await expect(page.locator(`${PREVIEW} p`).filter({ hasText: '第 120 行内容' })).toHaveCount(1);

    await page.locator(INPUT).evaluate((node) => {
      node.scrollTop = Math.round((node.scrollHeight - node.clientHeight) / 2);
      node.dispatchEvent(new Event('scroll', { bubbles: false }));
    });
    await page.waitForFunction((sel) => {
      const preview = document.querySelector(sel);
      return preview.scrollTop > 0;
    }, PREVIEW);
    const ratio = await page.evaluate((sel) => {
      const preview = document.querySelector(sel);
      const editor = document.querySelector('[data-testid="markdown-input"]');
      const p = preview.scrollTop / (preview.scrollHeight - preview.clientHeight);
      const e = editor.scrollTop / (editor.scrollHeight - editor.clientHeight);
      return { p, e };
    }, PREVIEW);
    expect(Math.abs(ratio.p - ratio.e)).toBeLessThan(0.2);
  });

  test('性能：5000 行 Markdown 渲染在 1 秒内完成 🖥', async ({ page }) => {
    await openToolFresh(page, 'markdown');
    await page.evaluate(() => {
      const lines = [];
      for (let i = 0; i < 1000; i += 1) {
        lines.push(`## 标题 ${i}`, '', `- 列表项 **加粗** \`code\``, '', '正文段落 [链接](https://example.com) 与 *斜体*。', '');
      }
      const ta = document.querySelector('[data-testid="markdown-input"]');
      ta.value = lines.join('\n');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction((sel) => {
      const preview = document.querySelector(sel);
      return Number(preview.dataset.renderCount || 0) > 0;
    }, PREVIEW, { timeout: 5000 });
    const ms = await page.evaluate((sel) => Number(document.querySelector(sel).dataset.renderMs), PREVIEW);
    expect(ms).toBeLessThan(1000);
    await expect(page.locator(`${PREVIEW} h2`).last()).toHaveText('标题 999');
  });
});

/* ==================== 主题与移动端 ==================== */

test.describe('Markdown 预览：主题与移动端', () => {
  for (const theme of ['light', 'dark']) {
    test(`${theme} 主题下打开并正常使用`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('glm-toolbox:theme', t), theme);
      await openTool(page, 'markdown');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.locator(INPUT).fill('# 主题\n\n**加粗** 与 `代码`');
      await expect(page.locator(`${PREVIEW} h1`)).toHaveText('主题');
      await expect(page.locator(`${PREVIEW} strong`)).toHaveText('加粗');
    });
  }

  test('视口 375×667 下无横向滚动，可完成基本操作', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openToolFresh(page, 'markdown');
    await page.locator(INPUT).fill('| 很长的表头一 | 很长的表头二 |\n| --- | --- |\n| 内容内容内容 | 内容内容内容 |');
    await expect(page.locator(`${PREVIEW} table`)).toBeVisible();

    const overflowed = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      return doc.scrollWidth - doc.clientWidth > 0 || body.scrollWidth - body.clientWidth > 0;
    });
    expect(overflowed).toBe(false);
  });
});
