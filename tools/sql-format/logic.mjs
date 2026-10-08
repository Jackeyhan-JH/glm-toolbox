/**
 * SQL 格式化 —— 纯逻辑模块（不碰 DOM / window，node --test 直接测试）。
 *
 * 自写分词器 + 排版器（不引入第三方库），风格与 sql-formatter 默认风格一致，
 * 以 issue #6 的验收例子为准：
 *   - 主句关键字（SELECT / FROM / WHERE / GROUP BY / ORDER BY / LIMIT …）独占一行、顶格，
 *     子句内容缩进一级；一级内的逗号分隔项各占一行；
 *   - LEFT JOIN … ON … 整体一行（ON 条件里的 AND / OR 再缩进一级断行）；
 *   - WHERE 条件里的 AND / OR 独占一行，与条件项同缩进；
 *   - 多条语句以「;」分隔，语句之间恰好一个空行；
 *   - 含子查询的括号组展开（括号留在行尾，内层再缩进一级，「)」回到括号所在行的缩进）；
 *     普通括号组（函数调用、IN 列表、VALUES 元组…）保持一行；
 *   - 运算符两侧加空格（一元正负号紧随操作数），「::」两侧不加空格；
 *   - 字符串 / 引号标识符 / 注释内容原样保留，关键字按选项转换大小写。
 *
 * 压缩：所有 token 以单空格拼接（按 needSpace 规则），「--」行注释改写为「/* *\/」
 * 以免吞掉后续内容，可选删除全部注释。
 */

/* ============================================================
 * 选项
 * ============================================================ */

export const DIALECTS = ['standard', 'mysql', 'postgresql', 'sqlite'];
export const KEYWORD_CASES = ['upper', 'lower', 'preserve'];

/** 归一化选项，容忍未知值 */
export function normalizeOptions(options = {}) {
  const indent = Math.floor(Number(options.indent));
  return {
    dialect: DIALECTS.includes(options.dialect) ? options.dialect : 'standard',
    keywordCase: KEYWORD_CASES.includes(options.keywordCase) ? options.keywordCase : 'upper',
    indent: Number.isFinite(indent) && indent >= 0 && indent <= 8 ? indent : 2,
    removeComments: Boolean(options.removeComments),
  };
}

/* ============================================================
 * 错误
 * ============================================================ */

/** 语法明显错误（字符串 / 注释 / 引号标识符未闭合），message 含行列号 */
export class SqlFormatError extends Error {
  constructor(message, line, column) {
    super(message);
    this.name = 'SqlFormatError';
    this.line = line;
    this.column = column;
  }
}

/* ============================================================
 * 关键字表
 * ============================================================ */

/** 基础（保守取各方言公共的保留字；不含 COUNT/MAX 等函数名与 INT 等类型名，避免改动其大小写） */
const BASE_KEYWORDS = new Set(
  `ABORT ADD AFTER ALL ALTER ANALYZE AND ANY AS ASC ATTACH BEFORE BEGIN BETWEEN BY
   CASCADE CASE CAST CHECK COLLATE COLUMN COMMIT CONFLICT CONSTRAINT CREATE CROSS
   CURRENT CURSOR DATABASE DECLARE DEFAULT DEFERRED DELETE DESC DETACH DISTINCT DO
   DROP EACH ELSE END ESCAPE EXCEPT EXCLUSIVE EXISTS EXPLAIN FAIL FETCH FIRST
   FOREIGN FROM FULL GLOB GRANT GROUP HAVING IF IGNORE IMMEDIATE IN INDEX INNER
   INSERT INSTEAD INTERSECT INTO IS ISNULL JOIN KEY LAST LEFT LIKE LIMIT MATCH
   NATURAL NOT NOTNULL NULL OF OFFSET ON OR ORDER OUTER PLAN PRAGMA PRIMARY QUERY
   RAISE RECURSIVE REFERENCES REGEXP REINDEX RELEASE RENAME REPLACE RESTRICT
   RETURNING RIGHT ROLLBACK ROW ROWS SAVEPOINT SELECT SET TABLE TEMP TEMPORARY
   THEN TO TRANSACTION TRIGGER TRUE FALSE UNKNOWN UNION UNIQUE UPDATE USING
   VACUUM VALUES VIEW WHEN WHERE WINDOW WITH WITHOUT`.split(/\s+/).filter(Boolean),
);

/** 各方言补充的保留字 */
const DIALECT_KEYWORDS = {
  standard: new Set(),
  mysql: new Set(
    `AUTO_INCREMENT UNSIGNED SIGNED ZEROFILL CHARSET DELAYED DUPLICATE ENABLE
     ENCLOSED ESCAPED LINES TERMINATED LOCK UNLOCK SHARE MODE STRAIGHT_JOIN
     SQL_NO_CACHE SQL_CALC_FOUND_ROWS`.split(/\s+/).filter(Boolean),
  ),
  postgresql: new Set(
    `ILIKE VARIADIC LATERAL MATERIALIZED TABLESPACE CONFLICT CONCURRENTLY
     UNLOGGED LISTEN NOTIFY`.split(/\s+/).filter(Boolean),
  ),
  sqlite: new Set(`VIRTUAL ROWID`.split(/\s+/).filter(Boolean)),
};

/** 会开启新「主句」的关键字（语句顶格独占一行） */
const CLAUSE_STARTERS = new Set(
  `SELECT FROM WHERE GROUP HAVING ORDER LIMIT OFFSET FETCH UNION INTERSECT EXCEPT
   VALUES SET RETURNING WITH WINDOW INSERT REPLACE UPDATE DELETE CREATE DROP ALTER
   RENAME TRUNCATE GRANT REVOKE EXPLAIN ANALYZE VACUUM BEGIN COMMIT ROLLBACK START
   SHOW DESCRIBE USE CALL ATTACH DETACH PRAGMA`.split(/\s+/).filter(Boolean),
);

/** 主句关键字后需要并入同一行的后续词（如 ORDER BY / INSERT INTO / UNION ALL） */
const CLAUSE_ABSORB = {
  SELECT: ['DISTINCT', 'ALL'],
  UNION: ['ALL', 'DISTINCT'],
  INTERSECT: ['ALL', 'DISTINCT'],
  EXCEPT: ['ALL', 'DISTINCT'],
  GROUP: ['BY'],
  ORDER: ['BY'],
  INSERT: ['INTO'],
  REPLACE: ['INTO'],
  DELETE: ['FROM'],
  WITH: ['RECURSIVE'],
  EXPLAIN: ['ANALYZE', 'QUERY', 'PLAN'],
  START: ['TRANSACTION'],
  CREATE: [
    'OR', 'REPLACE', 'TABLE', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA', 'TRIGGER', 'FUNCTION',
    'PROCEDURE', 'UNIQUE', 'TEMP', 'TEMPORARY', 'GLOBAL', 'LOCAL', 'IF', 'NOT', 'EXISTS',
    'VIRTUAL', 'MATERIALIZED', 'UNLOGGED',
  ],
  DROP: ['TABLE', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA', 'TRIGGER', 'IF', 'EXISTS'],
  ALTER: ['TABLE', 'COLUMN', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA'],
};

/** JOIN 短语的组成词 */
const JOIN_WORDS = new Set(['JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'NATURAL', 'STRAIGHT_JOIN']);

/** 集合运算（其后紧跟的 SELECT / VALUES 是新的查询，不当作函数位置） */
const SET_OPS = new Set(['UNION', 'INTERSECT', 'EXCEPT']);

const keywordSetCache = new Map();

/** 方言对应的完整关键字集合（带缓存） */
function getKeywords(dialect) {
  if (!keywordSetCache.has(dialect)) {
    const set = new Set(BASE_KEYWORDS);
    for (const word of DIALECT_KEYWORDS[dialect] ?? []) set.add(word);
    keywordSetCache.set(dialect, set);
  }
  return keywordSetCache.get(dialect);
}

/* ============================================================
 * 分词器
 * ============================================================ */

const RE_WORD_RUN = /[A-Za-z0-9_$\p{L}\p{N}]+/yu; // 前缀（@/:/$）之后的连续主体
const RE_WORD_START = /[A-Za-z_$\p{L}]/u;
const RE_NUMBER = /(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/y;
const RE_PARAM = /\$\d+/y;
const RE_DOLLAR_TAG = /\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/y; // PostgreSQL $$ / $tag$

/** 多字符运算符（先长后短匹配） */
const MULTI_OPERATORS = ['->>', '<<=', '>>=', '||', '<<', '>>', '<=', '>=', '<>', '!=', ':=', '::', '->', '=>'];
const SINGLE_OPERATORS = new Set('=<>+-*/%^|&~!');

const PUNCTUATIONS = new Set([',', ';', '(', ')', '.']);

/** 记为「值结尾」的 token 类型：决定前导点号是否属于数字（.5） */
const VALUEY_TYPES = new Set(['word', 'number', 'string', 'quoted', 'param']);

/**
 * 把 SQL 文本切成 token 数组。
 * 每个 token：{ type, text, isKeyword?, unary?, line, col }
 * type：word | number | string | quoted | param | operator | punct | lineComment | blockComment
 * 未闭合的字符串 / 注释 / 引号标识符抛 SqlFormatError（中文信息 + 行列号）。
 */
export function tokenize(sql, { dialect = 'standard' } = {}) {
  if (typeof sql !== 'string') throw new TypeError('sql 必须是字符串');
  const keywords = getKeywords(dialect);
  const tokens = [];
  const n = sql.length;
  let i = 0;
  let line = 1;
  let col = 1;

  const fail = (message, atLine, atCol) => {
    throw new SqlFormatError(`第 ${atLine} 行第 ${atCol} 列：${message}`, atLine, atCol);
  };
  const advance = (text) => {
    for (const ch of text) {
      if (ch === '\n') {
        line += 1;
        col = 1;
      } else {
        col += 1;
      }
    }
  };
  const push = (type, text, extra) => {
    const token = { type, text, line, col };
    if (extra) Object.assign(token, extra);
    tokens.push(token);
    advance(text);
    i += text.length;
  };
  /** 读到下一个配对的引号为止（quote 为 ' " ` 之一，成对重复表示转义）；行列由 advance 统一推进 */
  const scanQuoted = (quote, kind) => {
    const startLine = line;
    const startCol = col;
    let j = i + 1;
    for (;;) {
      if (j >= n) fail(kind === 'string' ? '字符串未闭合' : '标识符未闭合', startLine, startCol);
      const ch = sql[j];
      if (ch === quote) {
        if (sql[j + 1] === quote) {
          j += 2;
          continue;
        }
        j += 1;
        break;
      }
      j += 1;
    }
    const text = sql.slice(i, j);
    tokens.push({ type: kind, text, line: startLine, col: startCol });
    advance(text);
    i = j;
  };
  const readLineComment = () => {
    let j = i + (sql[i] === '-' ? 2 : 1);
    while (j < n && sql[j] !== '\n' && sql[j] !== '\r') j += 1;
    push('lineComment', sql.slice(i, j));
  };

  while (i < n) {
    const ch = sql[i];

    // 空白
    if (/\s/.test(ch)) {
      advance(ch);
      i += 1;
      continue;
    }

    // 字符串 / 引号标识符
    if (ch === "'") {
      scanQuoted("'", 'string');
      continue;
    }
    if (ch === '"' || ch === '`') {
      scanQuoted(ch, 'quoted');
      continue;
    }

    // 注释：-- 与 /* */（MySQL 另有 # 行注释）
    if (ch === '-' && sql[i + 1] === '-') {
      readLineComment();
      continue;
    }
    if (ch === '#' && dialect === 'mysql') {
      readLineComment();
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const startLine = line;
      const startCol = col;
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) fail('注释未闭合', startLine, startCol);
      push('blockComment', sql.slice(i, end + 2));
      continue;
    }

    // PostgreSQL：$1 参数与 $$…$$ / $tag$…$tag$ 美元引用字符串
    if (ch === '$') {
      if (dialect === 'postgresql') {
        RE_DOLLAR_TAG.lastIndex = i;
        const tag = RE_DOLLAR_TAG.exec(sql);
        if (tag) {
          const close = sql.indexOf(tag[0], i + tag[0].length);
          if (close !== -1) {
            push('string', sql.slice(i, close + tag[0].length));
            continue;
          }
        }
      }
      RE_PARAM.lastIndex = i;
      const param = RE_PARAM.exec(sql);
      if (param) {
        push('param', param[0]);
        continue;
      }
    }
    if (ch === '?') {
      push('param', '?');
      continue;
    }

    // 数字（含 0x / 1.5e3 / 1.；前导点号 0.5 需要看前一个 token）
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(sql[i + 1] ?? '') && !isValueyEnd(tokens))) {
      RE_NUMBER.lastIndex = i;
      const num = RE_NUMBER.exec(sql);
      if (num) {
        push('number', num[0]);
        continue;
      }
    }

    // := / :: 运算符（先于 :name 前缀判断）
    if (ch === ':' && (sql[i + 1] === '=' || sql[i + 1] === ':')) {
      push('operator', sql.slice(i, i + 2));
      continue;
    }

    // @var / :name
    if (ch === ':' || ch === '@') {
      RE_WORD_RUN.lastIndex = i + 1;
      const run = RE_WORD_RUN.exec(sql);
      if (run) {
        push('word', ch + run[0]);
        continue;
      }
      push('operator', ch);
      continue;
    }

    // 标点
    if (PUNCTUATIONS.has(ch)) {
      push('punct', ch);
      continue;
    }

    // 标识符 / 关键字（可含中文等 Unicode 字母）
    if (RE_WORD_START.test(ch)) {
      RE_WORD_RUN.lastIndex = i;
      const run = RE_WORD_RUN.exec(sql);
      const text = run && run.index === i ? run[0] : ch;
      const upper = text.toUpperCase();
      push('word', text, { isKeyword: keywords.has(upper) });
      continue;
    }

    // 运算符（先多字符）
    const multi = MULTI_OPERATORS.find((op) => sql.startsWith(op, i));
    if (multi) {
      pushOperator(multi);
      continue;
    }
    if (SINGLE_OPERATORS.has(ch)) {
      pushOperator(ch);
      continue;
    }

    // 其余罕见字符：按单字符运算符处理，保证不丢内容
    push('operator', ch);
  }

  return tokens;

  /** 压入运算符；一元 +/- 与独立星号（SELECT * / count(*)）依上下文标记 */
  function pushOperator(text) {
    const extra = {};
    if (text === '-' || text === '+' || text === '*') {
      const prev = tokens[tokens.length - 1];
      const unaryContext =
        !prev ||
        prev.type === 'operator' ||
        (prev.type === 'punct' && (prev.text === '(' || prev.text === ',')) ||
        (prev.type === 'word' && prev.isKeyword);
      extra.unary = unaryContext;
    }
    push('operator', text, extra);
  }
}

/** 上一个 token 是否「值结尾」（决定 .5 是否解析为数字） */
function isValueyEnd(tokens) {
  const prev = tokens[tokens.length - 1];
  if (!prev) return false;
  return VALUEY_TYPES.has(prev.type) || (prev.type === 'punct' && prev.text === ')');
}

/* ============================================================
 * 排版（格式化）
 * ============================================================ */

/** 按「;」切分语句（字符串 / 注释里的分号已是独立 token，不会误切） */
function splitStatements(tokens) {
  const statements = [];
  let current = [];
  for (const token of tokens) {
    if (token.type === 'punct' && token.text === ';') {
      if (current.length > 0) statements.push({ tokens: current, hasSemicolon: true });
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length > 0) statements.push({ tokens: current, hasSemicolon: false });
  return statements;
}

/** 括号组内（相对深度 0）是否直接含主句关键字 → 是则展开排版 */
function groupHasClause(tokens, openIndex) {
  let depth = 0;
  for (let j = openIndex; j < tokens.length; j += 1) {
    const token = tokens[j];
    if (token.type === 'punct' && token.text === '(') {
      depth += 1;
    } else if (token.type === 'punct' && token.text === ')') {
      depth -= 1;
      if (depth === 0) return false;
    } else if (depth === 1 && token.type === 'word' && CLAUSE_STARTERS.has(token.text.toUpperCase())) {
      return true;
    }
  }
  return false;
}

/** 从 i 开始的 JOIN 词序列是否构成完整连接短语（须以 JOIN 结束，排除 LEFT( 函数） */
function joinPhraseAhead(tokens, i) {
  let j = i;
  while (j < tokens.length && tokens[j].type === 'word' && JOIN_WORDS.has(tokens[j].text.toUpperCase())) j += 1;
  if (j === i) return false;
  const last = tokens[j - 1].text.toUpperCase();
  return last === 'JOIN' || last === 'STRAIGHT_JOIN';
}

/**
 * 两个 token 之间是否需要空格（格式化的行内与压缩共用）。
 * prevSig：上一个「非注释」token。
 */
function needSpace(prev, token) {
  if (!prev) return false;
  const t = token.type;
  const x = token.text;

  if (t === 'punct') {
    if (x === ',' || x === ';' || x === ')' || x === '.') return false;
    if (x === '(') {
      // 函数调用名后不加空格：count( ；关键字后保留：IN (
      if (prev.type === 'word' && !prev.isKeyword) return false;
      if (prev.type === 'punct' && (prev.text === ')' || prev.text === '.')) return false;
      if (prev.type === 'number' || prev.type === 'string' || prev.type === 'quoted' || prev.type === 'param') {
        return false;
      }
      return true;
    }
    return true;
  }
  if (prev.type === 'punct') {
    if (prev.text === '(') return false;
    if (prev.text === '.') return false;
    return true;
  }
  if (prev.type === 'operator') {
    if (prev.text === '::') return false;
    if (prev.unary) return false;
    return true;
  }
  if (t === 'operator') {
    if (x === '::') return false;
    if (token.unary) return !(prev.type === 'punct' && prev.text === '('); // (-1 紧贴，= -1 保留空格
    return true;
  }
  return true;
}

/** 按选项渲染 token 文本（关键字大小写转换；其余原样） */
function renderToken(token, { keywordCase }) {
  if (token.type === 'word' && token.isKeyword) {
    if (keywordCase === 'upper') return token.text.toUpperCase();
    if (keywordCase === 'lower') return token.text.toLowerCase();
  }
  return token.text;
}

/** 单条语句排版为行数组 */
function layoutStatement(tokens, opts) {
  const { indent } = opts;
  const out = [];
  const groups = []; // 括号组栈：{ block, savedHeader, savedContent, close }

  let headerIndent = 0; // 当前作用域主句顶格缩进
  let contentIndent = 1; // 当前作用域子句内容缩进
  let line = null; // 当前行 { indent, parts: [] }
  let pendingIndent = null; // 下一个 token 需另起一行时的缩进
  let prevSig = null; // 上一个非注释 token（空格与结构判断用）
  let inJoinLine = false; // 当前行是 JOIN 短语行（LEFT JOIN … 连续追加）
  let joinOn = false; // 处于 JOIN … ON 条件延续（AND/OR 再缩进一级）
  let afterClauseHeader = false; // 刚输出主句头部、尚无内容（抑制把 REPLACE( 等误判为主句）
  let clauseExpectsQuery = false; // 当前主句是集合运算（UNION…），其后紧跟的 SELECT 是新查询
  let betweenPending = false; // 上一个词是 BETWEEN：其范围里的 AND 不换行（BETWEEN 1 AND 9）

  const canBreak = () => groups.every((g) => g.block);
  const indentStr = (level) => ' '.repeat(indent * level);
  const flush = () => {
    if (line && line.parts.length > 0) out.push(indentStr(line.indent) + line.parts.join(''));
    line = null;
  };
  const startLine = (targetIndent) => {
    if (line && line.parts.length === 0) {
      line.indent = targetIndent;
      return;
    }
    flush();
    line = { indent: targetIndent, parts: [] };
  };
  const appendRaw = (token) => {
    if (!line) startLine(contentIndent);
    if (line.parts.length > 0 && needSpace(prevSig, token)) line.parts.push(' ');
    line.parts.push(renderToken(token, opts));
    if (token.type !== 'lineComment' && token.type !== 'blockComment') {
      prevSig = token;
      afterClauseHeader = false;
    }
  };
  const appendTok = (token) => {
    if (pendingIndent !== null) {
      startLine(pendingIndent);
      pendingIndent = null;
    }
    appendRaw(token);
  };
  /** 主句头部：顶格一行，内容待续行 */
  const emitClause = (index) => {
    flush();
    inJoinLine = false;
    joinOn = false;
    betweenPending = false;
    startLine(headerIndent);
    appendRaw(tokens[index]);
    const absorb = CLAUSE_ABSORB[tokens[index].text.toUpperCase()];
    let j = index + 1;
    while (
      absorb &&
      j < tokens.length &&
      tokens[j].type === 'word' &&
      absorb.includes(tokens[j].text.toUpperCase())
    ) {
      appendRaw(tokens[j]);
      j += 1;
    }
    pendingIndent = contentIndent;
    afterClauseHeader = true;
    clauseExpectsQuery = SET_OPS.has(tokens[index].text.toUpperCase());
    return j - 1; // 外层循环从返回值继续
  };
  /** 主句关键字在此处能否断句：须处于可断行上下文，且不像 SELECT REPLACE( / a, COUNT( 中的函数位置。
   *  例外：跟在「(」后的 SELECT 是子查询开头；独立星号（SELECT * FROM）与集合运算后的查询允许断句。 */
  const clauseAllowed = () => {
    if (!canBreak()) return false;
    if (afterClauseHeader && !clauseExpectsQuery) return false;
    if (!prevSig) return true;
    if (prevSig.type === 'operator' && !prevSig.unary) return false;
    if (prevSig.type === 'punct' && prevSig.text === ',') return false;
    return true;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const upper = token.type === 'word' ? token.text.toUpperCase() : '';

    // 字符串 / 引号标识符 / 数字 / 参数 / 普通关键字：直接追加
    if (token.type === 'string' || token.type === 'quoted' || token.type === 'number' || token.type === 'param') {
      appendTok(token);
      continue;
    }

    if (token.type === 'word') {
      // 主句关键字
      if (CLAUSE_STARTERS.has(upper) && clauseAllowed()) {
        i = emitClause(i);
        continue;
      }
      // JOIN 短语：另起一行（同行已有的 JOIN 词继续追加）
      if (JOIN_WORDS.has(upper) && canBreak() && joinPhraseAhead(tokens, i)) {
        if (!inJoinLine) {
          flush();
          startLine(contentIndent);
          inJoinLine = true;
          joinOn = false;
          betweenPending = false;
        }
        appendRaw(token);
        continue;
      }
      if (upper === 'AND' || upper === 'OR') {
        if (upper === 'AND' && betweenPending) {
          betweenPending = false;
          appendTok(token); // BETWEEN 的范围连接词，保持在同一行
          continue;
        }
        if (canBreak()) {
          flush();
          startLine(joinOn ? contentIndent + 1 : contentIndent);
          inJoinLine = false;
          appendRaw(token);
          continue;
        }
        appendTok(token);
        continue;
      }
      if (upper === 'ON' && inJoinLine) {
        joinOn = true; // 后续 AND/OR 缩进一级
      }
      if (upper === 'BETWEEN') betweenPending = true;
      appendTok(token);
      continue;
    }

    if (token.type === 'punct') {
      if (token.text === '(') {
        const block = canBreak() && groupHasClause(tokens, i);
        const openIndent = line ? line.indent : (pendingIndent !== null ? pendingIndent : contentIndent);
        appendTok(token);
        if (block) {
          flush();
          groups.push({ block: true, savedHeader: headerIndent, savedContent: contentIndent, close: openIndent });
          headerIndent = openIndent + 1;
          contentIndent = openIndent + 2;
          pendingIndent = contentIndent;
          inJoinLine = false;
        } else {
          groups.push({ block: false });
        }
        continue;
      }
      if (token.text === ')') {
        const group = groups.pop();
        if (group && group.block) {
          headerIndent = group.savedHeader;
          contentIndent = group.savedContent;
          pendingIndent = null;
          flush();
          startLine(group.close);
          appendRaw(token);
          inJoinLine = false;
        } else {
          appendTok(token);
        }
        continue;
      }
      if (token.text === ',') {
        appendTok(token);
        if (canBreak()) {
          pendingIndent = line ? line.indent : contentIndent; // 逗号后的新项回到本行起始缩进
          inJoinLine = false;
          joinOn = false;
          betweenPending = false;
        }
        continue;
      }
      appendTok(token); // . ;
      continue;
    }

    if (token.type === 'operator') {
      appendTok(token);
      continue;
    }

    // 注释
    if (token.type === 'lineComment') {
      const hadPending = pendingIndent !== null;
      appendTok(token); // 附着在当前行行尾
      const ind = line ? line.indent : contentIndent;
      flush(); // 行注释之后必须换行
      pendingIndent = hadPending ? contentIndent : ind;
      inJoinLine = false;
      continue;
    }
    if (token.type === 'blockComment') {
      if (canBreak() && token.text.includes('\n')) {
        // 跨行块注释独占一行，保持原文
        const ind = pendingIndent !== null ? pendingIndent : line && line.parts.length > 0 ? line.indent : contentIndent;
        startLine(ind);
        appendRaw(token);
        flush();
        pendingIndent = ind;
      } else {
        appendTok(token); // 单行块注释行内保留
      }
      continue;
    }
  }
  flush();
  return out;
}

/**
 * 格式化 SQL。
 * @param {string} sql
 * @param {{ dialect?: string, keywordCase?: string, indent?: number }} [options]
 * @returns {string}
 */
export function formatSql(sql, options = {}) {
  const opts = normalizeOptions(options);
  if (typeof sql !== 'string' || sql.trim() === '') return '';
  const tokens = tokenize(sql, opts);
  return splitStatements(tokens)
    .map(({ tokens: stmtTokens, hasSemicolon }) => {
      const lines = layoutStatement(stmtTokens, opts);
      if (lines.length === 0) return hasSemicolon ? ';' : '';
      if (hasSemicolon) lines[lines.length - 1] += ';';
      return lines.join('\n');
    })
    .filter((text) => text !== '')
    .join('\n\n');
}

/** 把「-- 内容」改写为「/* 内容 *\/」（去首尾空白，两侧各留一个空格；空注释写成 /\**\/） */
function lineCommentToBlock(text) {
  const content = text.slice(2).trim();
  return content === '' ? '/**/' : `/* ${content} */`;
}

/**
 * 压缩 SQL：去掉多余空白与换行，单空格拼接；字符串内容不变。
 * @param {{ dialect?: string, keywordCase?: string, removeComments?: boolean }} [options]
 */
export function compressSql(sql, options = {}) {
  const opts = normalizeOptions(options);
  if (typeof sql !== 'string' || sql.trim() === '') return '';
  const tokens = tokenize(sql, opts);
  const parts = [];
  let prevSig = null;
  for (const token of tokens) {
    let text;
    if (token.type === 'lineComment') {
      if (opts.removeComments) continue;
      text = lineCommentToBlock(token.text);
    } else if (token.type === 'blockComment') {
      if (opts.removeComments) continue;
      text = token.text;
    } else {
      text = renderToken(token, opts);
    }
    if (parts.length > 0 && needSpace(prevSig, token)) parts.push(' ');
    parts.push(text);
    if (token.type !== 'lineComment' && token.type !== 'blockComment') prevSig = token;
  }
  return parts.join('');
}
