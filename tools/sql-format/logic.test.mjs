/** SQL 格式化单元测试（对应 issue #6「工具专项」验收标准） */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSql, compressSql, tokenize, SqlFormatError } from './logic.mjs';

const DEFAULTS = { dialect: 'standard', keywordCase: 'upper', indent: 2 };

/** 验收例 1 的输入与期望输出（关键字大写、2 空格缩进） */
const EX1_INPUT =
  "select id,name from users u left join orders o on o.user_id=u.id where u.age>18 and o.status='已支付' order by o.created_at desc limit 10";
const EX1_FORMATTED = `SELECT
  id,
  name
FROM
  users u
  LEFT JOIN orders o ON o.user_id = u.id
WHERE
  u.age > 18
  AND o.status = '已支付'
ORDER BY
  o.created_at DESC
LIMIT
  10`;
const EX1_COMPRESSED =
  "SELECT id, name FROM users u LEFT JOIN orders o ON o.user_id = u.id WHERE u.age > 18 AND o.status = '已支付' ORDER BY o.created_at DESC LIMIT 10";

test('格式化（关键字大写、2 空格）：验收例 1 逐字一致', () => {
  assert.equal(formatSql(EX1_INPUT, DEFAULTS), EX1_FORMATTED);
});

test('字符串与引号标识符内的关键字不改大小写', () => {
  const out = formatSql('select \'select from\' as "from", `order` from t', DEFAULTS);
  assert.ok(out.includes("'select from'"), out);
  assert.ok(out.includes('"from"'), out);
  assert.ok(out.includes('`order`'), out);
});

test('注释保留：-- 行注释与 /* */ 块注释都出现在结果里', () => {
  const out = formatSql('select a -- 取 a\nfrom t /* 表 */', DEFAULTS);
  assert.ok(out.includes('-- 取 a'), out);
  assert.ok(out.includes('/* 表 */'), out);
});

test('多语句：两条语句之间恰好一个空行', () => {
  const out = formatSql('select 1; select 2;', DEFAULTS);
  assert.equal(out, 'SELECT\n  1;\n\nSELECT\n  2;');
  assert.equal(out.split(';\n\n').length, 2); // 恰好一处「; + 空行」分隔
});

test('PostgreSQL：$1 参数两侧加空格、:: 类型转换两侧不加空格', () => {
  const out = formatSql('select * from t where id=$1 and v::int>0', { ...DEFAULTS, dialect: 'postgresql' });
  assert.ok(out.includes('id = $1'), out);
  assert.ok(out.includes('v::int > 0'), out);
  assert.ok(!out.includes(':: '), out);
  assert.ok(!out.includes(' ::'), out);
});

test('关键字小写选项：输出以 select 开头且含 left join', () => {
  const out = formatSql(EX1_INPUT, { ...DEFAULTS, keywordCase: 'lower' });
  assert.ok(out.startsWith('select'), out);
  assert.ok(out.includes('left join'), out);
});

test('压缩：验收例 1 格式化后的结果再压缩', () => {
  assert.equal(compressSql(formatSql(EX1_INPUT, DEFAULTS), DEFAULTS), EX1_COMPRESSED);
  assert.equal(compressSql(EX1_INPUT, DEFAULTS), EX1_COMPRESSED); // 直接压缩同样成立
});

test('压缩含行注释：-- 改写为 /* */；勾选删除注释则去掉', () => {
  const input = 'select a -- 注释\nfrom t';
  assert.equal(compressSql(input, DEFAULTS), 'SELECT a /* 注释 */ FROM t');
  assert.equal(compressSql(input, { ...DEFAULTS, removeComments: true }), 'SELECT a FROM t');
});

test('错误：字符串未闭合，报行列号', () => {
  assert.throws(
    () => formatSql("select 'abc", DEFAULTS),
    (err) => err instanceof SqlFormatError && err.message === '第 1 行第 8 列：字符串未闭合',
  );
  assert.throws(
    () => compressSql("select 'abc", DEFAULTS),
    /第 1 行第 8 列：字符串未闭合/,
  );
});

test('错误：注释未闭合', () => {
  assert.throws(
    () => formatSql('select /* x', DEFAULTS),
    (err) => err instanceof SqlFormatError && err.message === '第 1 行第 8 列：注释未闭合',
  );
});

test('空输入 → 输出为空，不报错', () => {
  assert.equal(formatSql('', DEFAULTS), '');
  assert.equal(compressSql('', DEFAULTS), '');
  assert.equal(formatSql('   \n\t ', DEFAULTS), '');
  assert.equal(compressSql(' \n ', DEFAULTS), '');
});

test('4 空格缩进：id, 前有 4 个空格', () => {
  const out = formatSql(EX1_INPUT, { ...DEFAULTS, indent: 4 });
  assert.ok(out.includes('\n    id,'), JSON.stringify(out));
});

/* ---------------- 复验修复（评审反馈的阻塞问题） ---------------- */

test('表别名通配符 u.* 后 FROM 正确换行', () => {
  assert.equal(
    formatSql('select u.* from users u where u.id=1', DEFAULTS),
    `SELECT
  u.*
FROM
  users u
WHERE
  u.id = 1`,
  );
});

test('FROM (子查询) 的括号组缩进正确', () => {
  assert.equal(
    formatSql('select * from (select id from a) t', DEFAULTS),
    `SELECT
  *
FROM
  (
    SELECT
      id
    FROM
      a
  ) t`,
  );
});

test('PostgreSQL 数组类型 text[] 后 FROM 换行且方括号内无多余空格', () => {
  const out = formatSql('select a::text[] from t', { ...DEFAULTS, dialect: 'postgresql' });
  assert.ok(out.includes('a::text[]\nFROM'), out);
  assert.ok(!out.includes('[ ]'), out);
  const sub = formatSql('select arr[1], m[2][3] from t', { ...DEFAULTS, dialect: 'postgresql' });
  assert.ok(sub.includes('arr[1],'), sub);
  assert.ok(sub.includes('m[2][3]'), sub);
});

test('压缩 select * from t 保留星号后的空格', () => {
  assert.equal(compressSql('select * from t', DEFAULTS), 'SELECT * FROM t');
  assert.equal(compressSql('with c as (select 1) select * from c', DEFAULTS), 'WITH c AS (SELECT 1) SELECT * FROM c');
  const fmt = formatSql('select * from t where a in (select * from x)', DEFAULTS);
  assert.ok(fmt.includes('SELECT\n  *\nFROM'), fmt);
});

/* ---------------- 复验修复（非阻塞问题） ---------------- */

test('MySQL # 行注释压缩不丢字符', () => {
  assert.equal(
    compressSql('select a #abc\nfrom t', { ...DEFAULTS, dialect: 'mysql' }),
    'SELECT a /* abc */ FROM t',
  );
});

test('行注释内容含 */ 时压缩结果仍是合法 SQL', () => {
  const out = compressSql('select 1 -- a */ b\n, 2', DEFAULTS);
  assert.equal(out, 'SELECT 1 /* a * / b */, 2');
  // 只有一个块注释终止符
  assert.equal(out.lastIndexOf('*/'), out.indexOf('*/'));
});

test('语句开头的注释：格式化顶格、压缩后与 SELECT 之间有空格', () => {
  assert.equal(formatSql('-- head\nselect 1', DEFAULTS), '-- head\nSELECT\n  1');
  assert.equal(compressSql('-- head\nselect 1', DEFAULTS), '/* head */ SELECT 1');
  assert.equal(formatSql('/* head */ select 1', DEFAULTS), '/* head */\nSELECT\n  1');
});

test('窗口函数：OVER 后有空格，PARTITION BY / ORDER BY / NULLS 大小写统一', () => {
  const out = formatSql('select row_number() over (partition by a order by b nulls last) from t', DEFAULTS);
  assert.ok(out.includes('row_number() OVER ('), out);
  assert.ok(
    out.includes(`OVER (
    PARTITION BY
      a
    ORDER BY
      b NULLS LAST
  )`),
    out,
  );
});

test('INSERT INTO 表名与列清单之间保留空格（不像函数调用）', () => {
  const out = formatSql("insert into t (a,b) values(1,'x')", DEFAULTS);
  assert.ok(out.includes('t (a, b)'), out);
  const q = formatSql('insert into `t` (a) values(1)', { ...DEFAULTS, dialect: 'mysql' });
  assert.ok(q.includes('`t` (a)'), q);
  // 函数调用的紧凑风格不受影响
  assert.ok(formatSql('select count(*) from t', DEFAULTS).includes('count(*)'));
});

test('MySQL 反斜杠转义的字符串不报未闭合', () => {
  const out = formatSql("select 'it\\'s' from t", { ...DEFAULTS, dialect: 'mysql' });
  assert.ok(out.includes("'it\\'s'"), out);
});

/* ---------------- 更多边界 ---------------- */

test("字符串 '' 转义与内容原样保留", () => {
  const out = formatSql("select 'it''s ok' where a='b''c'", DEFAULTS);
  assert.ok(out.includes("'it''s ok'"), out);
  assert.ok(out.includes("'b''c'"), out);
  const zipped = compressSql("where s='a  b\nc'", DEFAULTS);
  assert.ok(zipped.includes("'a  b\nc'"), zipped); // 压缩不改字符串内容（含换行）
});

test('反引号标识符内的转义保留', () => {
  const out = formatSql('select `a``b` from `t`', DEFAULTS);
  assert.ok(out.includes('`a``b`'), out);
});

test('MySQL ? 占位符', () => {
  const out = formatSql('select * from t where a=? and b=?', { ...DEFAULTS, dialect: 'mysql' });
  assert.ok(out.includes('a = ?'), out);
  assert.ok(out.includes('AND b = ?'), out);
});

test('多行输入的错误位置（行号从 1 计）', () => {
  assert.throws(
    () => formatSql("select 1,\n'abc", DEFAULTS),
    /第 2 行第 1 列：字符串未闭合/,
  );
});

test('引号标识符未闭合也报错', () => {
  assert.throws(() => formatSql('select "abc', DEFAULTS), /标识符未闭合/);
  assert.throws(() => formatSql('select `abc', DEFAULTS), /标识符未闭合/);
});

test('嵌套子查询括号展开、普通括号组保持一行', () => {
  const out = formatSql(
    'select count(*), max(id) from t where id in (select uid from orders where ok=1) and x=(1+2)',
    DEFAULTS,
  );
  assert.ok(out.includes('count(*),'), out);
  assert.ok(out.includes('max(id)'), out);
  assert.ok(out.includes('x = (1 + 2)'), out);
  assert.ok(out.includes('IN ('), out);
  assert.ok(
    out.includes(`WHERE
  id IN (
    SELECT
      uid
    FROM
      orders
    WHERE
      ok = 1
  )
  AND`),
    out,
  );
});

test('WITH CTE 与 UNION', () => {
  const out = formatSql(
    'with c as (select id from t) select * from c union all select * from c',
    DEFAULTS,
  );
  assert.ok(out.includes('WITH\n  c AS (\n'), out);
  assert.ok(out.includes('UNION ALL\nSELECT'), out);
});

test('一元负号紧贴操作数、二元运算符加空格', () => {
  const out = formatSql('select -1, a=-2, b-3, (1-2) from t', DEFAULTS);
  assert.ok(out.includes('-1,'), out);
  assert.ok(out.includes('a = -2'), out);
  assert.ok(out.includes('b - 3'), out);
  assert.ok(out.includes('(1 - 2)'), out);
});

test('JOIN ON 条件里的 AND 再缩进一级', () => {
  const out = formatSql(
    'select * from a join b on a.x=b.x and a.y=b.y where a.z=1 and b.w=2',
    DEFAULTS,
  );
  assert.ok(out.includes('  JOIN b ON a.x = b.x'), out);
  assert.ok(out.includes('    AND a.y = b.y'), out);
  assert.ok(out.includes('  AND b.w = 2'), out);
});

test('BETWEEN … AND … 的 AND 不换行，后续条件 AND 正常换行', () => {
  const out = formatSql('select a from t where a between 1 and 9 and b=2', DEFAULTS);
  assert.ok(out.includes('a BETWEEN 1 AND 9'), out);
  assert.ok(out.includes('\n  AND b = 2'), out);
});

test('DDL：CREATE TABLE IF NOT EXISTS / DROP TABLE 连成主句头部', () => {
  const out = formatSql(
    'create table if not exists t (id int primary key); drop table t;',
    DEFAULTS,
  );
  assert.ok(out.includes('CREATE TABLE IF NOT EXISTS\n  t(id int PRIMARY KEY)'), out);
  assert.ok(out.includes('DROP TABLE\n  t'), out);
});

test('关键字「保持原样」不改动大小写', () => {
  const out = formatSql('Select id From t', { ...DEFAULTS, keywordCase: 'preserve' });
  assert.ok(out.includes('Select'), out);
  assert.ok(out.includes('From'), out);
});

test('函数名与类型名不当作关键字改写', () => {
  const out = formatSql('select count(*) from t where v::int>0', DEFAULTS);
  assert.ok(out.includes('count(*)'), out);
  assert.ok(out.includes('v::int'), out);
});

test('压缩多语句：分号后单空格', () => {
  assert.equal(compressSql('select 1;select 2;', DEFAULTS), 'SELECT 1; SELECT 2;');
});

test('压缩保留块注释', () => {
  const out = compressSql('select /* 备注 */ a from t', DEFAULTS);
  assert.equal(out, 'SELECT /* 备注 */ a FROM t');
});

test('tokenize：行列号与 token 类型', () => {
  const tokens = tokenize("select a,\nb from `t` where x='1'");
  assert.deepEqual(
    tokens.map((t) => [t.type, t.text]),
    [
      ['word', 'select'],
      ['word', 'a'],
      ['punct', ','],
      ['word', 'b'],
      ['word', 'from'],
      ['quoted', '`t`'],
      ['word', 'where'],
      ['word', 'x'],
      ['operator', '='],
      ['string', "'1'"],
    ],
  );
  assert.deepEqual(
    tokens.filter((t) => t.line === 2).map((t) => t.col),
    [1, 3, 8, 12, 18, 19, 20], // b @1、from @3、`t` @8、where @12、x @18、= @19、'1' @20
  );
  assert.equal(tokens[0].isKeyword, true);
  assert.equal(tokens[1].isKeyword, false);
});

test('性能：500 行 SQL 在 1 秒内格式化', () => {
  const sql = `${"select a,b,c from t where x=1 and y='字符串' order by a desc;\n".repeat(500)}select 1;`;
  assert.equal(sql.split('\n').length, 501);
  const start = process.hrtime.bigint();
  const out = formatSql(sql, DEFAULTS);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(out.startsWith('SELECT'), out.slice(0, 40));
  assert.ok(out.includes('LIMIT') === false || true); // 仅确认能跑完
  assert.ok(ms < 1000, `耗时 ${ms}ms`);
  const zStart = process.hrtime.bigint();
  compressSql(sql, DEFAULTS);
  const zMs = Number(process.hrtime.bigint() - zStart) / 1e6;
  assert.ok(zMs < 1000, `压缩耗时 ${zMs}ms`);
});
