'use strict';

/**
 * 闯关日历的纯逻辑层：按天分组、编关卡号、算进度、出日历条。
 *
 * 为什么单独成文件：
 *   1. 这些是本项目新主线（每日闯关）的核心规则，必须能在 Node 里单测，
 *      不能等真机才发现"关卡号错了""跨天归组错了"。
 *   2. 保持纯函数（不碰 wx.*），与 time.js / time-parser.js 同一约定。
 *
 * 日期口径统一为**北京时间**（UTC+8），与 utils/time.js 一致。
 */

var DAY = 24 * 3600 * 1000;
var WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** 某时刻对应的北京时间日期串 'YYYY-MM-DD' */
function dayKey(epochMs) {
  var d = new Date(epochMs + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

/** 今天 0 点（北京时间）的时间戳 */
function startOfTodayMs(nowMs) {
  var d = new Date((nowMs || Date.now()) + 8 * 3600 * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 8 * 3600 * 1000;
}

/**
 * 事件状态。老数据没有 status 字段，一律按 'todo' 处理 —— 不得报错。
 */
function statusOf(note) {
  var s = note && note.status;
  return (s === 'done' || s === 'skipped') ? s : 'todo';
}

/** 事件标题：优先 title，没有就用正文首行（老数据兼容） */
function titleOf(note) {
  if (!note) return '';
  if (note.title) return note.title;
  var c = (note.content || '').trim();
  if (!c) return '(没写内容)';
  var line = c.split('\n')[0].trim();
  return line.length > 30 ? line.slice(0, 30) + '…' : line;
}

/**
 * 按天分组并编关卡号。
 *
 * 关卡号规则：**按日期升序，从 1 开始**。最早有事件的那天是第 1 关，
 * 这样"闯关"有推进感，且不会因新增过去日期而让已有关卡号整体错位（只在前面插队时才变）。
 *
 * 归属日期：优先 dueAt（事件预定发生的那天），没有就用 createdAt 兜底，
 * 保证**每条事件一定落在某一关里**，不会无家可归。
 *
 * 软删除的记录**在这里再过滤一次**（不放权给调用方）—— 少一处"调用方忘了过滤"
 * 就少一类真机上才暴露的 bug。
 *
 * @param {Array} notes 记事数组（可以包含已软删除的，会被剔除）
 * @param {number} nowMs 用于判定"今天/明天/昨天"
 * @returns {Array} [{ key, ts, level, items, total, done, skipped, todo, allDone, label }]
 */
function buildLevels(notes, nowMs) {
  var now = nowMs || Date.now();
  var todayKey = dayKey(now);
  var buckets = {};
  var keys = [];

  (notes || []).forEach(function (n) {
    if (!n || n.deleted) return;
    var ts = n.dueAt || n.createdAt || now;
    var k = dayKey(ts);
    if (!buckets[k]) {
      buckets[k] = { key: k, ts: ts, items: [] };
      keys.push(k);
    }
    buckets[k].items.push(n);
  });

  // 'YYYY-MM-DD' 字典序即时间序，直接 sort 即可
  keys.sort();

  var todayMs = startOfTodayMs(now);

  return keys.map(function (k, i) {
    var b = buckets[k];
    var done = 0, skipped = 0;
    b.items.forEach(function (n) {
      var s = statusOf(n);
      if (s === 'done') done++;
      else if (s === 'skipped') skipped++;
    });
    var total = b.items.length;
    return {
      key: k,
      ts: b.ts,
      level: i + 1,
      items: b.items,
      total: total,
      done: done,
      skipped: skipped,
      todo: total - done - skipped,
      allDone: total > 0 && (done + skipped) === total,
      label: dayLabel(b.ts, todayKey, todayMs)
    };
  });
}

/**
 * 日期显示：几月几日 + 星期 + 今天/明天/昨天。
 * @returns {{md:string, week:string, rel:string, isToday:boolean}}
 */
function dayLabel(epochMs, todayKey, todayMs) {
  var k = dayKey(epochMs);
  var d = new Date(epochMs + 8 * 3600 * 1000);
  var md = (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日';
  var week = WEEK_CN[d.getUTCDay()];

  var rel = '';
  if (todayKey) {
    var diff = Math.round((startOfTodayMs(epochMs) - todayMs) / DAY);
    if (k === todayKey || diff === 0) rel = '今天';
    else if (diff === 1) rel = '明天';
    else if (diff === -1) rel = '昨天';
  }

  return { md: md, week: week, rel: rel, isToday: rel === '今天' };
}

/**
 * 顶部横向日历条：以今天为中心，向前 back 天、向后 forward 天。
 * @returns {Array} [{key, d, week, rel, isToday, hasEvent}]
 */
function calendarStrip(nowMs, back, forward, levelKeys) {
  var now = nowMs || Date.now();
  var todayKey = dayKey(now);
  var todayMs = startOfTodayMs(now);
  var b = back == null ? 3 : back;
  var f = forward == null ? 10 : forward;
  var set = {};
  (levelKeys || []).forEach(function (k) { set[k] = true; });

  var out = [];
  for (var i = -b; i <= f; i++) {
    var ts = todayMs + i * DAY;
    var k = dayKey(ts);
    var d = new Date(ts + 8 * 3600 * 1000);
    var lb = dayLabel(ts, todayKey, todayMs);
    out.push({
      key: k,
      d: d.getUTCDate(),
      month: d.getUTCMonth() + 1,
      week: lb.week,
      rel: lb.rel,
      isToday: lb.isToday,
      hasEvent: !!set[k]
    });
  }
  return out;
}

module.exports = {
  DAY: DAY,
  dayKey: dayKey,
  startOfTodayMs: startOfTodayMs,
  statusOf: statusOf,
  titleOf: titleOf,
  buildLevels: buildLevels,
  dayLabel: dayLabel,
  calendarStrip: calendarStrip
};
