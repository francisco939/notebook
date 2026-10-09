'use strict';

/**
 * 闯关日历逻辑的回归测试（Node 里跑，不需要真机）。
 *
 * 跑法：node scripts/quest.test.js
 *
 * 重点验证三类容易出错的地方：
 *   1. 北京时间跨日 —— UTC 时间戳加减会跨天，归组不能错
 *   2. 关卡编号 —— 必须是日期升序且从 1 开始
 *   3. 老数据兼容 —— 没有 status / title / dueAt 的记录不能崩
 */

var q = require('../miniprogram/utils/quest.js');

var pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

/* 固定"现在"：2026-10-09 15:00 北京时间 = 2026-10-09 07:00 UTC */
var NOW = Date.UTC(2026, 9, 9, 7, 0) ;
var DAY = 24 * 3600 * 1000;

/** 造一条位于"今天起第 off 天、hour 点"的事件 */
function mk(off, hour, status, extra) {
  var ts = Date.UTC(2026, 9, 9, (hour == null ? 10 : hour) - 8, 0) + off * DAY;
  var n = {
    id: 'n' + off + '_' + hour + '_' + (status || 'todo'),
    content: '内容' + off,
    dueAt: ts,
    createdAt: ts,
    deleted: false,
    status: status || 'todo'
  };
  if (extra) for (var k in extra) n[k] = extra[k];
  return n;
}

console.log('\n=== 1. dayKey 用北京时间口径 ===');
check('2026-10-09 07:00 UTC 应算 10-09', q.dayKey(Date.UTC(2026, 9, 9, 7, 0)) === '2026-10-09');
check('2026-10-09 16:00 UTC(=北京 10-10 00:00) 应算 10-10',
  q.dayKey(Date.UTC(2026, 9, 9, 16, 0)) === '2026-10-10');
check('2026-10-08 23:00 UTC(=北京 10-09 07:00) 应算 10-09',
  q.dayKey(Date.UTC(2026, 9, 8, 23, 0)) === '2026-10-09');

console.log('\n=== 2. 关卡编号：日期升序、从 1 开始 ===');
var lv = q.buildLevels([mk(0, 10), mk(-1, 10), mk(1, 10)], NOW);
check('分成 3 关', lv.length === 3);
check('第 1 关是昨天', lv[0].key === '2026-10-08');
check('第 2 关是今天', lv[1].key === '2026-10-09');
check('第 3 关是明天', lv[2].key === '2026-10-10');
check('关卡号 1/2/3', lv[0].level === 1 && lv[1].level === 2 && lv[2].level === 3);
check('乱序输入也要排好',
  q.buildLevels([mk(2, 10), mk(0, 10), mk(1, 10)], NOW)[0].key === '2026-10-09');

console.log('\n=== 3. 同一天的多条要归并到同一关 ===');
var lv2 = q.buildLevels([mk(0, 8), mk(0, 12), mk(0, 20)], NOW);
check('合成 1 关', lv2.length === 1);
check('关内有 3 条', lv2[0].items.length === 3);
check('total = 3', lv2[0].total === 3);

console.log('\n=== 4. 完成 / 跳过统计 ===');
var lv3 = q.buildLevels([
  mk(0, 8, 'done'), mk(0, 9, 'done'), mk(0, 10, 'skipped'), mk(0, 11, 'todo')
], NOW);
check('done = 2', lv3[0].done === 2);
check('skipped = 1', lv3[0].skipped === 1);
check('todo = 1', lv3[0].todo === 1);
check('未完成 → allDone = false', lv3[0].allDone === false);

var lv4 = q.buildLevels([mk(0, 8, 'done'), mk(0, 9, 'skipped')], NOW);
check('全处理完 → allDone = true', lv4[0].allDone === true);
check('空关卡不算 allDone', q.buildLevels([], NOW).length === 0);

console.log('\n=== 5. 老数据兼容（没有 status / title / dueAt）===');
var legacy = [
  { id: 'old1', content: '老记事没状态', createdAt: NOW, deleted: false },
  { id: 'old2', content: '老记事有 dueAt', dueAt: NOW, createdAt: NOW, deleted: false }
];
var lv5 = q.buildLevels(legacy, NOW);
check('老数据不崩，能分组', lv5.length >= 1);
check('无 status → todo', q.statusOf(legacy[0]) === 'todo');
check('非法 status → todo', q.statusOf({ status: 'weird' }) === 'todo');
check('无 dueAt 时用 createdAt 归组（不会无家可归）', lv5[0].items.length === 2);
check('软删除的被剔除', q.buildLevels([
  { id: 'x', content: 'x', dueAt: NOW, createdAt: NOW, deleted: true }
], NOW).length === 0);

console.log('\n=== 6. titleOf：优先 title，无则用正文首行 ===');
check('有 title 用 title', q.titleOf({ title: '量血压', content: '早饭后' }) === '量血压');
check('无 title 用正文首行', q.titleOf({ content: '吃降压药\n一天一片' }) === '吃降压药');
check('空内容有兜底', q.titleOf({ content: '' }) === '(没写内容)');
check('超长截断', q.titleOf({ content: new Array(60).join('啊') }).indexOf('…') > 0);

console.log('\n=== 7. 日期标签：今天 / 明天 / 昨天 ===');
var lbToday = q.dayLabel(NOW, q.dayKey(NOW), q.startOfTodayMs(NOW));
check('今天', lbToday.rel === '今天' && lbToday.isToday === true);
check('明天', q.dayLabel(NOW + DAY, q.dayKey(NOW), q.startOfTodayMs(NOW)).rel === '明天');
check('昨天', q.dayLabel(NOW - DAY, q.dayKey(NOW), q.startOfTodayMs(NOW)).rel === '昨天');
check('后天不显示相对词',
  q.dayLabel(NOW + 2 * DAY, q.dayKey(NOW), q.startOfTodayMs(NOW)).rel === '');
check('星期正确（2026-10-09 是周五）', lbToday.week === '周五');
check('月日显示', lbToday.md === '10月9日');

console.log('\n=== 8. 顶部日历条 ===');
var strip = q.calendarStrip(NOW, 3, 10, ['2026-10-09', '2026-10-11']);
check('默认 14 天（前3+今天+后10）', strip.length === 14);
check('含今天且只有一天是 isToday',
  strip.filter(function (d) { return d.isToday; }).length === 1);
check('今天在条内', strip.some(function (d) { return d.key === '2026-10-09'; }));
check('有事件的日期被标记', strip.filter(function (d) { return d.hasEvent; }).length === 2);
check('无事件的日期未标记',
  strip.filter(function (d) { return d.key === '2026-10-10'; })[0].hasEvent === false);

console.log('\n=== 9. 新增事件要即时出现在对应日期的关卡里 ===');
/* 模拟：库里已有昨天和明天各一条，现在家人给"今天"随手加一条 */
var before = [mk(-1, 10, 'todo'), mk(1, 10, 'todo')];
var lvBefore = q.buildLevels(before, NOW);
check('加之前今天没有关卡', !lvBefore.some(function (l) { return l.key === '2026-10-09'; }));

var afterAdd = before.concat([mk(0, 15, 'todo', { title: '接孙子', author: '女儿' })]);
var lvAfter = q.buildLevels(afterAdd, NOW);
var today = lvAfter.filter(function (l) { return l.key === '2026-10-09'; })[0];
check('加之后今天出现了关卡', !!today);
check('新事件在今天的关卡里',
  today.items.some(function (n) { return n.title === '接孙子'; }));
check('新增不改变已有条数', today.items.length === 1);
check('新事件默认待完成', q.statusOf(today.items[0]) === 'todo');
check('添加人被带上', today.items[0].author === '女儿');
check('关卡号按日期重排（昨天=1，今天=2，明天=3）',
  lvAfter[0].key === '2026-10-08' && lvAfter[1].level === 2 && lvAfter[2].level === 3);

console.log('\n=== 10. 完成/跳过切换后进度要变 ===');
var lvS = q.buildLevels([mk(0, 8, 'todo'), mk(0, 9, 'todo')], NOW);
check('初始 done = 0', lvS[0].done === 0 && lvS[0].allDone === false);
lvS[0].items[0].status = 'done';
var lvS2 = q.buildLevels(lvS[0].items, NOW);
check('完成一条后 done = 1', lvS2[0].done === 1 && lvS2[0].todo === 1);
lvS[0].items[1].status = 'skipped';
var lvS3 = q.buildLevels(lvS[0].items, NOW);
check('再跳过一条 → allDone', lvS3[0].allDone === true && lvS3[0].todo === 0);
lvS[0].items[0].status = 'todo';
var lvS4 = q.buildLevels(lvS[0].items, NOW);
check('撤销完成后 allDone 回落', lvS4[0].allDone === false && lvS4[0].done === 0);

console.log('\n' + '='.repeat(52));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) process.exit(1);
