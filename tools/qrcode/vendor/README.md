# vendor —— 二维码工具的第三方库

按仓库约定（issue #1 / #21），第三方库 vendored 进本目录，仅以相对路径 ES module 方式引用，
不新增 npm 依赖、不使用 CDN。两个库均为纯 JavaScript、无网络行为，可离线运行。

| 目录 | 库 | 版本 | 许可 | 来源 |
|---|---|---|---|---|
| `qrcode-generator/` | qrcode-generator（Kazuhiko Arase） | 1.4.4 | MIT | https://www.npmjs.com/package/qrcode-generator |
| `jsQR/` | jsQR（Cosmo Wolfe 等） | 1.4.0 | Apache-2.0 | https://www.npmjs.com/package/jsqr |

## 本地改动说明（包一层 ES module）

两个库上游发布的都是 UMD / 全局脚本，浏览器无法直接 `import`。按 issue #21
「如为 UMD 需包一层 ES module」的约定，对 npm 包内文件做了**最少限度**的封装，
除下列标注的封装行外，其余内容与上游发布内容逐字一致（可用 diff 校验）：

- `qrcode-generator/qrcode.mjs`：来自包内 `qrcode.js`，仅在文件**末尾追加**
  `export default qrcode; export { qrcode };`（UMD 尾部的 `module.exports` 分支
  在 ES module 中不生效，顶层 `var qrcode` 留在模块作用域内，故可直接导出）。
- `jsQR/jsQR.mjs`：来自包内 `dist/jsQR.js`，改动两处：
  - 文件**开头**插入 `var self = globalThis;`（上游 UMD 头部以
    `typeof self !== 'undefined' ? self : this` 取挂载对象；Node 的 ES module
    作用域里 `self` 与顶层 `this` 均为 `undefined`，会抛 TypeError。浏览器中
    `globalThis === self`，行为完全不变）；
  - 文件**末尾追加** `export default globalThis.jsQR;`（UMD 把库挂到
    `globalThis.jsQR`，这里重新导出）。

## 用途

- `qrcode-generator`：生成二维码模块矩阵（`logic.mjs` 的 `createQr`），
  并把 `qrcode.stringToBytes` 切到其内置 `UTF-8` 实现以支持中文 / emoji。
- `jsQR`：从 RGBA 像素数组识别二维码（`logic.mjs` 的 `decodeRgba`，
  页面里在 `../worker.mjs` 中运行）。

## 许可证文件

- `qrcode-generator/LICENSE`：MIT（原包未单独携带 LICENSE 文件，此处为 MIT 标准文本，
  版权声明取自源文件头部 "Copyright (c) 2009 Kazuhiko Arase"）。
- `jsQR/LICENSE`：Apache-2.0，原样复制自 npm 包内 `LICENSE`。
