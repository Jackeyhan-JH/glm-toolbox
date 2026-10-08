# glm-toolbox
码工具箱：纯前端、离线可用的中文开发者工具合集（由 GLM 用法参谋统筹，Claude Code + GLM 并行开发）。

在线使用：<https://jackeyhan-jh.github.io/glm-toolbox/>

## 特性

- **打开即用**：纯静态站点，无构建、无框架、无后端。
- **完全离线**：所有数据只在浏览器本地处理，不上传、不发任何外部请求（首次访问后断网也能用，PWA 离线缓存在收尾阶段加入）。
- **全中文界面**：左侧分类 + 搜索，hash 路由 `#/<工具id>`，深色 / 浅色主题跟随系统。
- **可扩展**：新增一个工具 = 新增一个 `tools/<id>/` 目录，不改任何共享文件。

## 本地开发

需要 Node 22（见 `.nvmrc`）：

```bash
npm ci          # 安装开发依赖（只有 @playwright/test 等测试工具）
npm run dev     # 开发服务器 → http://localhost:4173/
```

开发服务器每次请求 `tools/index.json` 时实时扫描 `tools/*/tool.json` 生成 ——
新建工具目录后**刷新页面即可见**，无需重启或改其他文件。

其他命令：

```bash
npm run check   # 清单与目录约定检查
npm test        # 单元测试（node --test）
npm run e2e     # 端到端测试（Playwright + Chromium 无头）
npm run build   # 生成发布产物 dist/
```

> 并行开发时多个 worktree 各自用不同端口跑 e2e：`E2E_PORT=41020 npm run e2e`（占用 E2E_PORT 与 E2E_PORT+1）。

## 如何新增一个工具

复制 `tools/word-count/` 样板目录到 `tools/<你的id>/`，改清单和实现即可 ——
详细的目录约定、模块协议（`mount(root, ctx)`）与测试写法见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 目录结构

```
index.html                 应用外壳入口
assets/                    全站样式、主题变量、公共组件（ui.mjs）
scripts/                   gen-index / check / serve / build 及其单测
tools/<id>/                每个工具独占一个目录（样板：tools/word-count/）
tests/e2e/                 Playwright 公共夹具与外壳 e2e
.github/workflows/         CI（ci.yml）与 Pages 发布（pages.yml）
```

## 许可

工具代码与共享代码随仓库发布；vendored 第三方库保留各自许可（见对应 `tools/<id>/vendor/`）。
