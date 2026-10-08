## 关联 issue

Closes #

## 改动说明

<!-- 做了什么、为什么这样做；工具 PR 请说明清单字段（id / name / category / order）-->

## 检查清单

- [ ] 只改了本工具目录 `tools/<id>/` 内的文件（地基 / 收尾 PR 除外，须在 issue 允许范围内）
- [ ] 新建工具目录包含 `tool.json`、`index.mjs`、`logic.mjs`、`logic.test.mjs`、`ui.e2e.mjs`
- [ ] `npm run check` 通过
- [ ] `npm test` 通过
- [ ] `npm run e2e` 通过（只跑本工具：`npx playwright test tools/<id>`）
- [ ] 未修改 `package.json` / `package-lock.json` / 其他共享文件
- [ ] 未引入构建工具、框架、运行时 CDN 或新的 npm 依赖（vendored 库除外，附许可证）

## 验收标准对照

<!-- 逐条列出 issue 的验收标准及满足方式（测试文件 / 测试名，或说明合并后才能验证的项）-->
