/** Markdown 预览纯逻辑的单元测试（node --test 自动发现）。
 *  对应 issue #20「验收标准」中的每条「输入 → 输出」例子与安全要求。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAMPLE_DOC,
  TABLE_SNIPPET,
  blockedImageHtml,
  buildStandaloneHtml,
  countText,
  decodeEntities,
  filterHtml,
  insertAtCursor,
  isExternalUrl,
  renderMarkdown,
  sanitizeUrl,
  toggleLinePrefix,
  wrapSelection,
} from './logic.mjs';

/* ==================== 基础语法（验收标准逐条） ==================== */

test('`# 标题` → <h1>标题</h1>', () => {
  assert.equal(renderMarkdown('# 标题'), '<h1>标题</h1>');
});

test('各级 ATX 标题与 Setext 标题', () => {
  assert.equal(renderMarkdown('### 三级'), '<h3>三级</h3>');
  assert.equal(renderMarkdown('## 标题 ##'), '<h2>标题</h2>');
  assert.equal(renderMarkdown('标题\n==='), '<h1>标题</h1>');
  assert.equal(renderMarkdown('标题\n---'), '<h2>标题</h2>');
});

test('表格：3 列，第二列 text-align: center，第三列右对齐', () => {
  const html = renderMarkdown('| 左 | 中 | 右 |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
  assert.ok(html.includes('<table>'), html);
  assert.ok(html.includes('<thead>'), html);
  assert.ok(html.includes('<th style="text-align: left">左</th>'), html);
  assert.ok(html.includes('<th style="text-align: center">中</th>'), html);
  assert.ok(html.includes('<th style="text-align: right">右</th>'), html);
  assert.ok(html.includes('<td style="text-align: center">2</td>'), html);
  assert.ok(html.includes('<td style="text-align: right">3</td>'), html);
  assert.equal(html.match(/<th[ >]/g)?.length, 3);
  assert.equal(html.match(/<td[ >]/g)?.length, 3);
});

test('任务列表：2 个 disabled 复选框，第一个 checked', () => {
  const html = renderMarkdown('- [x] 完成\n- [ ] 未完成');
  assert.ok(html.includes('<ul>'), html);
  const boxes = html.match(/<input type="checkbox" disabled[^>]*>/g) ?? [];
  assert.equal(boxes.length, 2);
  assert.match(boxes[0], /checked/);
  assert.doesNotMatch(boxes[1], /checked/);
  assert.ok(html.includes('完成'), html);
  assert.ok(html.includes('未完成'), html);
});

test('~~删除~~ → <del>；`code` → <code>；js 代码块 → language-js', () => {
  assert.equal(renderMarkdown('~~删除~~'), '<p><del>删除</del></p>');
  assert.equal(renderMarkdown('`code`'), '<p><code>code</code></p>');
  const html = renderMarkdown('```js\nlet a = 1;\n```');
  assert.equal(html, '<pre><code class="language-js">let a = 1;\n</code></pre>');
});

test('无语言代码块与缩进代码块不输出 class', () => {
  assert.equal(renderMarkdown('```\ntext\n```'), '<pre><code>text\n</code></pre>');
  assert.equal(renderMarkdown('    indented'), '<pre><code>indented\n</code></pre>');
});

test('自动链接：href / rel / target 齐全', () => {
  const html = renderMarkdown('https://example.com');
  assert.ok(
    html.includes('<a href="https://example.com" rel="noopener noreferrer" target="_blank">https://example.com</a>'),
    html,
  );
});

test('尖括号自动链接与 mailto', () => {
  const html = renderMarkdown('<https://example.com/a?b=1>');
  assert.ok(html.includes('<a href="https://example.com/a?b=1"'), html);
  const mail = renderMarkdown('<someone@example.com>');
  assert.ok(mail.includes('<a href="mailto:someone@example.com"'), mail);
});

test('普通链接带 rel 与 target，标题可用', () => {
  const html = renderMarkdown('[点我](https://example.com "标题")');
  assert.ok(html.includes('<a href="https://example.com" title="标题" rel="noopener noreferrer" target="_blank">点我</a>'), html);
});

test('嵌套列表 `- a\\n  - b` → 嵌套 <ul>', () => {
  const html = renderMarkdown('- a\n  - b');
  assert.ok(html.includes('<ul>'), html);
  const outer = /<ul>\s*<li>a\s*<ul>\s*<li>b<\/li>\s*<\/ul>\s*<\/li>\s*<\/ul>/.test(html);
  assert.ok(outer, html);
});

test('有序列表与 start 属性', () => {
  const html = renderMarkdown('3. 三\n4. 四');
  assert.ok(html.includes('<ol start="3">'), html);
  assert.ok(html.includes('<li>三</li>'), html);
});

test('松散列表段落包 <p>，紧凑列表不包', () => {
  const loose = renderMarkdown('- a\n\n- b');
  assert.ok(loose.includes('<p>a</p>'), loose);
  const tight = renderMarkdown('- a\n- b');
  assert.doesNotMatch(tight, /<p>/);
});

test('引用块', () => {
  const html = renderMarkdown('> 引用内容');
  assert.equal(html, '<blockquote>\n<p>引用内容</p>\n</blockquote>');
});

test('原生 HTML `<b>粗</b>` 保留为 <b>', () => {
  assert.equal(renderMarkdown('<b>粗</b>'), '<b>粗</b>');
  const inline = renderMarkdown('段落 <b>粗</b> 继续');
  assert.ok(inline.includes('<p>段落 <b>粗</b> 继续</p>'), inline);
});

test('主题分割线与硬换行', () => {
  assert.equal(renderMarkdown('---'), '<hr>');
  assert.ok(renderMarkdown('第一行  \n第二行').includes('<br>'), '两个空格的硬换行');
});

test('文本中的 < > & 被转义，实体按原文显示', () => {
  const html = renderMarkdown('a < b & c');
  assert.ok(html.includes('a &lt; b &amp; c'), html);
  assert.ok(renderMarkdown('&amp;').includes('&amp;'), '实体解码后重新转义');
});

test('反斜杠转义字面输出', () => {
  const html = renderMarkdown('\\*不是斜体\\*');
  assert.ok(html.includes('*不是斜体*'), html);
  assert.doesNotMatch(html, /<em>/);
});

test('强调嵌套：***x*** → em + strong', () => {
  const html = renderMarkdown('***x***');
  assert.ok(/<em><strong>x<\/strong><\/em>|<strong><em>x<\/em><\/strong>/.test(html), html);
});

test('下划线词内不强调，星号词内强调', () => {
  assert.doesNotMatch(renderMarkdown('snake_case_word'), /<em>/);
  assert.ok(renderMarkdown('a*b*c').includes('<em>b</em>'));
});

test('引用式链接（全写 / 省略 / 快捷）', () => {
  const md = '[foo][bar]\n\n[bar]: https://example.com "标题"';
  const html = renderMarkdown(md);
  assert.ok(html.includes('<a href="https://example.com" title="标题"'), html);
  const collapsed = renderMarkdown('[foo][]\n\n[foo]: /x');
  assert.ok(collapsed.includes('<a href="/x"'), collapsed);
  const shortcut = renderMarkdown('[foo]\n\n[foo]: /y');
  assert.ok(shortcut.includes('<a href="/y"'), shortcut);
});

test('表格支持转义竖线，行内语法在单元格内生效', () => {
  const html = renderMarkdown('| a\\|b | **加粗** |\n| --- | --- |\n| `c` | x |');
  assert.ok(html.includes('a|b'), html);
  assert.ok(html.includes('<strong>加粗</strong>'), html);
  assert.ok(html.includes('<code>c</code>'), html);
});

/* ==================== 安全：XSS ==================== */

const XSS_INPUT = [
  '<img src=x onerror="window.__xss=1">',
  '<script>window.__xss=2</script>',
  '[点我](javascript:window.__xss=3)',
  '<a href="JaVaScRiPt:alert(1)">x</a>',
  '<iframe src="about:blank"></iframe>',
].join('\n\n');

test('XSS：无 script / iframe / on* 属性 / javascript: 链接', () => {
  const html = renderMarkdown(XSS_INPUT);
  const lower = html.toLowerCase();
  assert.ok(!lower.includes('<script'), html);
  assert.ok(!lower.includes('<iframe'), html);
  assert.ok(!lower.includes('onerror'), html);
  assert.ok(!lower.includes('javascript:'), html);
  assert.ok(!lower.includes('window.__xss'), html);
});

test('XSS：实体编码与控制字符混淆的 javascript: 被拒绝', () => {
  const vectors = [
    '<a href="&#106;avascript:alert(1)">x</a>',
    '<a href="java\tscript:alert(1)">x</a>',
    '<a href=" \n javascript:alert(1)">x</a>',
    '<a href="jAvAsCrIpT:alert(1)">x</a>',
    '[a](vbscript:alert(1))',
    '[a](data:text/html;base64,PHNjcmlwdD4=)',
    '<img src="data:text/html,x">',
    '<a href="file:///etc/passwd">x</a>',
  ];
  for (const md of vectors) {
    const html = renderMarkdown(md).toLowerCase();
    assert.ok(!html.includes('javascript:'), `${md} → ${html}`);
    assert.ok(!html.includes('vbscript:'), `${md} → ${html}`);
    assert.ok(!html.includes('data:text/html'), `${md} → ${html}`);
    assert.ok(!html.includes('file:'), `${md} → ${html}`);
  }
});

test('XSS：危险标签连同内容移除，未知标签移除但保留文本', () => {
  assert.equal(filterHtml('<script>alert(1)</script>ok'), 'ok');
  assert.equal(filterHtml('<iframe src="about:blank">内文</iframe>after'), 'after');
  assert.equal(filterHtml('<style>p{}</style>tail'), 'tail');
  assert.equal(filterHtml('<form><b>粗</b></form>'), '<b>粗</b>');
  assert.equal(filterHtml('a<!-- 注释 -->b'), 'ab');
  assert.equal(filterHtml('<div onclick="x()">文本</div>'), '<div>文本</div>');
  assert.equal(filterHtml('<p onmouseover="x" title="t">文字</p>'), '<p title="t">文字</p>');
});

test('XSS：filterHtml 转义非标签文本', () => {
  assert.equal(filterHtml('1 < 2 且 3 > 2'), '1 &lt; 2 且 3 &gt; 2');
  assert.equal(filterHtml('<b>a</b》'), '<b>a&lt;/b》', '不完整的闭标签按文本转义');
});

test('sanitizeUrl：scheme 白名单', () => {
  assert.equal(sanitizeUrl('https://a.com/x'), 'https://a.com/x');
  assert.equal(sanitizeUrl('HTTP://A.COM'), 'HTTP://A.COM');
  assert.equal(sanitizeUrl('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(sanitizeUrl('/relative/path'), '/relative/path');
  assert.equal(sanitizeUrl('#anchor'), '#anchor');
  assert.equal(sanitizeUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeUrl(' vbscript:x'), null);
  assert.equal(sanitizeUrl('JaVaScRiPt:alert(1)'), null);
  assert.equal(sanitizeUrl('data:text/html,x'), null);
  assert.equal(sanitizeUrl(''), null);
  assert.equal(sanitizeUrl('https://x/a.png', { isImage: true }), null, '外部图片默认拦截');
  assert.equal(sanitizeUrl('https://x/a.png', { isImage: true, allowExternalImages: true }), 'https://x/a.png');
  assert.equal(sanitizeUrl('data:image/png;base64,AAAA', { isImage: true }), 'data:image/png;base64,AAAA');
  assert.equal(sanitizeUrl('data:image/png;base64,AAAA'), null, '链接不允许 data:');
});

test('isExternalUrl 识别协议相对地址', () => {
  assert.equal(isExternalUrl('//example.com/a.png'), true);
  assert.equal(isExternalUrl('https://example.com/a.png'), true);
  assert.equal(isExternalUrl('/local.png'), false);
  assert.equal(isExternalUrl('data:image/png;base64,x'), false);
});

/* ==================== 外部图片策略 ==================== */

test('外部图片默认拦截为占位，不发 <img>', () => {
  const html = renderMarkdown('![远程](https://example.com/a.png)');
  assert.ok(!html.includes('<img'), html);
  assert.ok(html.includes(blockedImageHtml('https://example.com/a.png')), html);
  assert.ok(html.includes('外部图片已拦截'), html);
  assert.ok(html.includes('https://example.com/a.png'), '占位中展示原地址');
});

test('allowExternalImages: true 时放行外部图片', () => {
  const html = renderMarkdown('![远程](https://example.com/a.png)', { allowExternalImages: true });
  assert.ok(html.includes('<img src="https://example.com/a.png"'), html);
});

test('data:image 图片正常显示', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const html = renderMarkdown(`![点](${png})`);
  assert.ok(html.includes(`<img src="${png}"`), html);
});

test('原生 HTML 图片同样遵守拦截策略', () => {
  const html = renderMarkdown('<img src="https://example.com/x.png" alt="远程">');
  assert.ok(!html.includes('<img'), html);
  assert.ok(html.includes('外部图片已拦截'), html);
});

/* ==================== 导出与示例 ==================== */

test('独立 HTML：包含 DOCTYPE 与正文，不含 link/script 引用', () => {
  const body = renderMarkdown('# 标题\n\n内容');
  const html = buildStandaloneHtml('测试文档', body);
  assert.ok(html.startsWith('<!DOCTYPE html>'), html.slice(0, 40));
  assert.ok(html.includes('<h1>标题</h1>'), html);
  assert.ok(!html.includes('<link'), html);
  assert.ok(!html.includes('<script'), html);
  assert.ok(!/<(?:link|script)[^>]*https?:\/\//.test(html), html);
  assert.ok(html.includes('<style>'), '样式内联');
});

test('示例文档渲染成功且包含核心元素', () => {
  const html = renderMarkdown(SAMPLE_DOC);
  assert.ok(html.includes('<h1>'), html);
  assert.ok(html.includes('码工具箱'), html);
  assert.ok(html.includes('language-js'), html);
  assert.ok(html.includes('外部图片已拦截'), html);
  assert.ok(html.includes('data:image/png;base64,'), html);
  assert.ok(html.includes('text-align: center'), html);
  assert.ok(!html.includes('<script'), html);
});

test('空输入渲染为空字符串', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown('   \n\n  '), '');
});

/* ==================== 编辑器辅助 ==================== */

test('wrapSelection：包裹选中文字「测试」→ **测试**', () => {
  const result = wrapSelection('测试', 0, 2, '**', '**');
  assert.equal(result.text, '**测试**');
  assert.equal(result.start, 2);
  assert.equal(result.end, 4);
});

test('wrapSelection：已包裹时解包（再次点击取消）', () => {
  const result = wrapSelection('前**测试**后', 3, 5, '**', '**');
  assert.equal(result.text, '前测试后');
});

test('wrapSelection：空选区插入占位并选中', () => {
  const result = wrapSelection('abc', 1, 1, '[', '](https://)', { placeholder: '链接文字' });
  assert.equal(result.text, 'a[链接文字](https://)bc');
  assert.equal(result.start, 2);
  assert.equal(result.end, 6);
});

test('toggleLinePrefix：加 / 去标题前缀', () => {
  assert.equal(toggleLinePrefix('正文', 0, 0, '## ').text, '## 正文');
  assert.equal(toggleLinePrefix('## 正文', 0, 0, '## ').text, '正文');
  const two = toggleLinePrefix('a\nb', 0, 3, '- ');
  assert.equal(two.text, '- a\n- b');
  assert.equal(toggleLinePrefix('- a\n- b', 0, 6, '- ').text, 'a\nb');
});

test('insertAtCursor：插入表格模板', () => {
  const result = insertAtCursor('ab', 1, 1, TABLE_SNIPPET);
  assert.equal(result.text, `a${TABLE_SNIPPET}b`);
  assert.equal(TABLE_SNIPPET.includes(':--:'), true);
});

test('countText：字数不含空白、行数按换行计', () => {
  assert.deepEqual(countText('Hello 世界！\n\n第二行'), { chars: 11, lines: 3 });
  assert.deepEqual(countText(''), { chars: 0, lines: 0 });
});

/* ==================== 工具函数 ==================== */

test('decodeEntities：命名与数字实体', () => {
  assert.equal(decodeEntities('a&amp;b'), 'a&b');
  assert.equal(decodeEntities('&#x4e16;'), '世');
  assert.equal(decodeEntities('&#19990;'), '世');
  assert.equal(decodeEntities('&notanentity;'), '&notanentity;');
  assert.equal(decodeEntities('&#0;'), '�');
});

/* ==================== 性能 ==================== */

test('性能：5000 行 Markdown 在 1 秒内完成渲染', () => {
  const lines = [];
  for (let i = 0; i < 1000; i += 1) {
    lines.push(`## 标题 ${i}`, '', `- 列表项 **加粗** \`code\``, '', '正文段落 [链接](https://example.com) 与 *斜体*。', '');
  }
  const md = lines.join('\n');
  assert.ok(md.split('\n').length >= 5000, '至少 5000 行');
  const start = performance.now();
  const html = renderMarkdown(md);
  const elapsed = performance.now() - start;
  assert.ok(html.includes('<h2>标题 999</h2>'));
  assert.ok(elapsed < 1000, `耗时 ${elapsed}ms，应小于 1000ms`);
});
