'use strict';

/**
 * 口语时间解析 · 回归测试
 *
 * 为什么能直接在 Node 里跑：time.js 与 time-parser.js 都是纯函数，不依赖 wx.*。
 * 跑法：node scripts/time.test.js
 */

var time = require('../miniprogram/utils/time.js');

var pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('=== 1. 解析：应该能识别出日期 ===');
[
  '明天下午三点',
  '明天',
  '后天',
  '今天',
  '下周三',
  '10月12日',
  '15号',
  '本周日前'
].forEach(function (s) {
  var r = time.parseWhen(s);
  check('解析「' + s + '」', r.dueAt !== null, JSON.stringify(r));
  console.log('  「' + s + '」 → ' + (r.dueAt ? time.display(r.dueAt, r.hasTime) : '(未解析)') +
    '  conf=' + r.confidence + (r.hasTime ? ' 有钟点' : ''));
});

console.log('');
console.log('=== 1b. 中文数字钟点（老人口语最常见，原实现缺这一种）===');
[
  ['明天下午三点', 15, 0],
  ['晚上七点半', 19, 30],
  ['中午十二点', 12, 0],
  ['上午十点', 10, 0],
  ['后天下午四点二十分', 16, 20]
].forEach(function (c) {
  var r = time.parseWhen(c[0]);
  var okHour = false;
  if (r.dueAt && r.hasTime) {
    var bj = new Date(r.dueAt + 8 * 3600 * 1000);
    okHour = (bj.getUTCHours() === c[1] && bj.getUTCMinutes() === c[2]);
  }
  check('「' + c[0] + '」→ ' + c[1] + ':' + c[2], okHour,
    r.dueAt ? time.display(r.dueAt, r.hasTime) + ' (hasTime=' + r.hasTime + ')' : '未解析');
  console.log('  「' + c[0] + '」 → ' + (r.dueAt ? time.display(r.dueAt, r.hasTime) : '(未解析)'));
});

console.log('');
console.log('=== 2. 解析：不该胡乱识别 ===');
[
  '买降压药',
  '孙女放学时间',
  '血压 130/85'
].forEach(function (s) {
  var r = time.parseWhen(s);
  check('「' + s + '」不应解析出日期', r.dueAt === null, 'got ' + r.dueAt);
  console.log('  「' + s + '」 → ' + (r.dueAt === null ? '(正确：不解析)' : '⚠ 误判为 ' + time.display(r.dueAt, r.hasTime)));
});

console.log('');
console.log('=== 3. 显示：必须口语化，不能出现 2026-10-09 这种格式 ===');
var t0 = time.startOfToday();
var H = 3600 * 1000, D = 24 * H;
var cases = [
  [t0 + 15 * H, true, '今天'],
  [t0 + 9 * H, false, '今天'],
  [t0 + D + 15 * H, true, '明天'],
  [t0 + 2 * D + 10 * H, false, '后天'],
  [t0 - D, false, '昨天'],
  [t0 + 6 * D, false, '周'],
  [t0 + 40 * D, false, '月']
];
cases.forEach(function (c) {
  var s = time.display(c[0], c[1]);
  check('显示含「' + c[2] + '」', s.indexOf(c[2]) >= 0, s);
  console.log('  ' + c[2] + ' → 「' + s + '」');
});

console.log('');
console.log('=== 4. 过期判定 ===');
check('过去算过期', time.isOverdue(t0 - H) === true);
// 注意：不能用 t0 + 3H —— 若当前已过凌晨 3 点，那其实是过去时间。用 now 为基准才稳。
check('未来不算过期', time.isOverdue(Date.now() + 3 * H) === false);
check('今天内算今天要做', time.isDueToday(t0 + 3 * H) === true);
check('明天不算今天要做', time.isDueToday(t0 + D + 3 * H) === false);
check('已过期的今天也算今天要做', time.isDueToday(t0 - 3 * H) === true);

console.log('');
console.log('=== 5. 空输入 ===');
var empty = time.parseWhen('');
check('空输入不报错', empty.dueAt === null && empty.rawTime === '');

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail > 0 ? 1 : 0);
