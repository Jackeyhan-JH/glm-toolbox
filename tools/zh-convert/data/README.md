# 简繁转换词表数据

## 文件

| 文件 | 说明 |
|---|---|
| `zh-dict.json` | 运行时使用的全部词表 / 字表（进入工具后 `fetch` 本地加载），约 343 KB |
| `gen-from-opencc.mjs` | 生成脚本（开发期离线运行，浏览器不执行） |
| `LICENSE` | OpenCC 采用的 Apache-2.0 许可证原文 |

## 来源

数据整理自 [OpenCC](https://github.com/BYVoid/OpenCC)（Apache-2.0），
master 分支 commit `3ac34aa439a9908dd49fa92b5174b46314787ac2` 的
`data/dictionary/` 下五个词典文件：

| 原始文件 | 整理为 | 条目数（整理后 / 原始） |
|---|---|---|
| `STCharacters.txt` | `s2tChars`（简→繁字表，取首选候选） | 3881 / 4029 |
| `STPhrases.txt` | `s2tPhrases`（简→繁词表） | 9788 / 49270 |
| `TSCharacters.txt` | `t2sChars`（繁→简字表，取首选候选） | 3221 / 5062 |
| `TSPhrases.txt` | `t2sPhrases`（繁→简词表） | 412 / 487 |
| `TWPhrases.txt` | `twPhrases`（繁体→台湾常用繁体词） | 818 / 818 |

重新生成：

```bash
git clone https://github.com/BYVoid/OpenCC   # 任意本地副本均可
node tools/zh-convert/data/gen-from-opencc.mjs <OpenCC仓库>/data/dictionary
```

## 整理规则

目标是在**不改变转换结果**的前提下把数据控制在 1.5MB 以内（最终 343 KB）：

1. **字表取首选候选**：OpenCC 一个简化字可能对应多个繁体字（发→發/髮），
   多候选的消歧由词表负责，字表只保留首选候选；首选与原字相同的条目
   （如 `了→了 瞭`）略去。
2. **词表裁掉冗余条目**：本工具的算法是「词表最长匹配优先，未命中逐字回退」。
   若某词表条目的值与逐字回退的结果完全相同（如 `发展→發展`，逐字也是 發展），
   该条目删除后输出不变，故只保留有修正作用的条目（如 `头发→頭髮`，
   逐字会得到 頭發）。恒等条目（如 `皇后→皇后`）在逐字转换会改变原文时
   （后→後）依然保留——它们本身就是消歧信息。
3. **输出用字归一**：`麪 → 麵`（OpenCC 首选是大陆规范异体字形，这里统一为
   更通行的 `麵`，与 `面条→麵條` 的常见预期一致）。
4. 其余保持 OpenCC 原样：`里面→裏面`（用 `裏` 而非 `裡`）、`后台→後臺`
   （用 `後臺` 而非 `後台`），与数据一致并在 `logic.test.mjs` 中固定断言。

## 覆盖校验（生成时人工核验）

- 《通用规范汉字表》一级字（3500 字）中与首选繁体候选不同的字共 1240 个，
  全部包含在 `s2tChars` 中且映射与 OpenCC 首选一致（对照
  [通用规范汉字表(2013)一级字表](https://github.com/lqfeng/ChineseCharacters)
  的官方字表校验，该清单未随仓库提交）；
  `logic.test.mjs` 中有覆盖数下限与代表字的回归断言。
- 数据总大小 343 KB ≤ 1.5MB（`logic.test.mjs` 断言）。
