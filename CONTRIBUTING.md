# 贡献指南

本仓库是「码工具箱」：纯前端、完全离线可用的中文开发者工具合集。总体设计与路线图见 issue #1。
本文说明**如何新增一个工具**、文件归属规则与测试命令 —— 并行开发的核心约定是：
**两个工具 PR 改动的文件集合永不相交，按任意顺序合并都不会冲突。**

## 快速开始

```bash
npm ci          # 安装开发依赖（只有 @playwright/test 等）
npm run dev     # 本地开发服务器，默认 http://localhost:4173/
npm run check   # 清单与目录约定检查
npm test        # 单元测试（node --test）
npm run e2e     # Playwright 端到端测试（Chromium 无头）
npm run build   # 生成发布产物 dist/
```

## 如何新增一个工具

**只需要新建一个目录 `tools/<id>/`，不改任何共享文件。** 侧边栏、首页、路由、搜索都会自动出现。

最省事的做法：**复制 `tools/word-count/` 样板目录**，改名并替换内容：

```bash
cp -r tools/word-count tools/<你的id>
```

然后修改这 6 个文件（全部必需，缺一不可，`npm run check` 会校验）：

| 文件 | 作用 |
|---|---|
| `tool.json` | 清单：id / name / description / category / keywords / order |
| `index.mjs` | UI 入口，导出 `mount(root, ctx)` |
| `logic.mjs` | 纯逻辑（不碰 DOM / window），供单测直接 import |
| `logic.test.mjs` | `node --test` 单元测试，测 `logic.mjs` |
| `ui.e2e.mjs` | Playwright 端到端测试 |
| `style.css` | 工具私有样式（可选，但样板里有，建议保留） |

### 1. 写清单 `tool.json`

```json
{
  "id": "json-format",
  "name": "JSON 格式化",
  "description": "格式化、校验、压缩 JSON，并定位语法错误",
  "category": "data",
  "keywords": ["json", "格式化", "geshihua"],
  "order": 10
}
```

规则（`npm run check` / `npm test` 前的 `gen-index` 都会校验）：

- `id`：`^[a-z][a-z0-9-]*$`，必须与目录名一致；
- `name`：中文名，不超过 12 个字；`description`：一句话，不超过 40 个字；
- `category`：只能是下表之一；`order`：数字，同分类内小的在前，重复时按 `name` 排序；
- `keywords`：非空字符串数组，用于侧边栏搜索 —— 建议包含英文名、中文同义词、拼音（全拼或首字母）。

| category | 显示名 |
|---|---|
| `data` | 数据与格式 |
| `encode` | 编码与转义 |
| `crypto` | 加密与安全 |
| `time` | 时间与日期 |
| `text` | 文本处理 |
| `web` | 前端与设计 |
| `number` | 数字与计算 |

### 2. 写纯逻辑 `logic.mjs`

只放纯函数：不碰 `document` / `window`，不直接读 `Date.now()` / `Math.random()`
（涉及「当前时间」或「随机」的函数必须允许注入 `now` / 随机源，测试才能确定）。

### 3. 写 UI `index.mjs`

```js
import { el, copyButton, showError } from '../../assets/js/ui.mjs';
import { format } from './logic.mjs';

export async function mount(root, ctx) {
  ctx.loadStyle('tools/<id>/style.css'); // 注意：相对站点根的路径
  // 用 el() 构建 DOM，挂到 root；逻辑调 logic.mjs
  return () => { /* 可选：清理定时器、Worker、事件监听 */ };
}
```

`ctx` 对象（由外壳提供）：

| 成员 | 说明 |
|---|---|
| `ctx.tool` | 本工具的清单（tool.json 内容） |
| `ctx.storage` | 命名空间化的 localStorage：`get(key, fallback)` / `set(key, value)` / `remove(key)`，实际键为 `glm-toolbox:<id>:<key>`，值自动 JSON 序列化 |
| `ctx.loadStyle(url)` | 加载工具私有 CSS（相对站点根，如 `tools/<id>/style.css`），离开工具时外壳自动移除 |
| `ctx.theme` | 当前主题 `'light' \| 'dark'`（动态读取） |
| `ctx.onThemeChange(fn)` | 订阅主题变更，返回取消订阅函数 |

### 4. 写测试

- **单测 `logic.test.mjs`**（node 内置 runner）：

  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { format } from './logic.mjs';

  test('format 基本行为', () => {
    assert.equal(format('a'), 'A');
  });
  ```

- **e2e `ui.e2e.mjs`**（一律从公共夹具引入 `test` / `expect`）：

  ```js
  import { test, expect, openTool } from '../../tests/e2e/fixtures.mjs';

  test('基本交互', async ({ page }) => {
    await openTool(page, '<id>'); // 打开并等待挂载完成
    await page.getByLabel('输入').fill('hello');
    await expect(page.getByTestId('<id>-output')).toHaveText('HELLO');
  });
  ```

  夹具自动生效的约束（违反即失败）：任何发往非 localhost 的请求、任何 `console.error`、任何未捕获异常。
  个别用例确实要触发预期错误时，先调用 `allowExpectedErrors(page, /关键字/)` 豁免。

  惯例：

  - 选择器优先用可访问名称（`getByRole` / `getByLabel`），实在不好定位再给元素加 `data-testid="<id>-<部件>"`；
  - 涉及时间用 `page.clock`；涉及剪贴板在文件顶部 `test.use({ permissions: ['clipboard-read', 'clipboard-write'] })`；
  - 只跑本工具的 e2e：`npx playwright test tools/<id>`。

### 5. 本地验证

```bash
npm run check
npm test
npm run e2e          # 或 npx playwright test tools/<id>
```

全绿后提交 PR。**不需要**（也不允许）改 `package.json`、侧边栏、路由等任何共享文件 ——
`tools/index.json` 由脚本自动生成（在 `.gitignore` 里，不要提交）。

## 其他脚本（收尾阶段加入）

```bash
node scripts/gen-readme.mjs     # 重新生成 README 的工具清单表（--check 供 CI 校验）
node scripts/screenshots.mjs    # 重新生成 docs/screenshots/ 的 README 截图
node scripts/make-icons.mjs     # 重新生成 assets/icons/ 的 PWA 图标

npm run build                                  # 生成 dist/（含 sw.js 预缓存清单与 manifest）
node scripts/serve.mjs --dist --base /glm-toolbox/ --port 4180   # 以 Pages 子路径模式服务 dist/
```

- `sw.js` 是模板：构建时扫描 `dist/` 注入全部文件的预缓存清单与版本号（任何文件变化即换版本）；
  注册脚本只注入进 `dist/index.html`，`npm run dev`（源目录）不注册 Service Worker。
- README 工具清单表位于 `<!-- tools:start -->` / `<!-- tools:end -->` 之间，由脚本维护，CI 会校验。

## 文件归属规则（并行开发不冲突的关键）

| 路径 | 归属 |
|---|---|
| `tools/<id>/**` | 工具 issue 各自独占，其他 issue 不得触碰 |
| `index.html`、`assets/**`、`scripts/**`、`tests/e2e/fixtures.mjs`、`tests/e2e/shell.e2e.mjs`、`.github/**`、`package.json`、`playwright.config.mjs` | 共享文件：只有地基（#2）与收尾（#23）issue 可改 |
| `CONTRIBUTING.md`、`README.md` | 共享文档，同上 |
| `tools/index.json`、`dist/`、`node_modules/`、`test-results/`、`playwright-report/` | 生成物 / 依赖，**不提交**（已在 .gitignore） |

新增工具时若发现共享组件不够用，优先在本工具目录内实现；确有必要共享的，在工具 issue 里留言说明，由地基 / 收尾 issue 统一处理。

## 技术红线

- 不引入构建工具链（webpack / vite / rollup / esbuild / TypeScript 编译 / Babel 等）与运行时 CDN；`check` 会扫描 `tools/**/*.mjs` 中以 `http(s)://` 开头的 import 并报错。
- 不引入前端框架（React / Vue 等）；原生 HTML / CSS / JavaScript（ES modules，`.mjs`）。
- 不修改 `package.json` / `package-lock.json`；npm 依赖只允许开发依赖，且由地基 issue 统一添加。
- 确需第三方库时 vendored 进 `tools/<id>/vendor/`，附 LICENSE 与版本说明，只接受 MIT / BSD / Apache-2.0 / ISC 等宽松许可。
- 所有路径使用相对路径，站点必须能在子路径 `/glm-toolbox/`（GitHub Pages）下正常工作。
- 颜色一律使用 `assets/css/theme.css` 中的 CSS 变量（`var(--fg)` 等），不写死颜色；深浅两套主题都要可读。
- 全中文界面；所有数据处理只在浏览器本地完成，不发任何外部请求。

## 端到端测试端口（E2E_PORT）

`playwright.config.mjs` 从环境变量 `E2E_PORT` 读取端口（默认 4173），并占用 `E2E_PORT` 与 `E2E_PORT + 1`
两个端口（后者以 `--base /glm-toolbox/` 启动，用于子路径部署用例），`reuseExistingServer: false`。

**本机最多 5 个 worktree 并行跑 e2e，各自必须用不同的 E2E_PORT**：

```bash
E2E_PORT=41020 npm run e2e   # 占用 41020、41021
E2E_PORT=41022 npm run e2e   # 另一个 worktree 用 41022、41023
```

同理，同时起多个 `npm run dev` 时用 `node scripts/serve.mjs --port <端口>` 错开。

## 分支与 PR 约定

- 分支：工具用 `tool/<id>`，地基 `feat/foundation`，收尾 `feat/polish`。
- PR 标题 `feat(<id>): …`，正文写 `Closes #<issue>` 并勾选 PR 模板检查清单。
- CI 必须全绿，且改动范围符合 issue 的「允许改动的文件范围」才能合并。
- 标签流转：`ready`（可开发）→ `in-progress`（开发中）→ 合并关闭；验收不过打 `needs-fix`。
