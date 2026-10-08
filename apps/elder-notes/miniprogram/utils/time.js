'use strict';

/**
 * 口语时间：解析 + 显示
 *
 * 解析部分**直接复用旧项目「明白卡」的 time-parser.js** —— 它是纯函数、无环境依赖，
 * 带 70 条真实语料回归测试。搬运理由：老人不会用日期滚轮，只会说"明天下午三点"。
 *
 * 解析不出来时**保留原文、不报错**（沿用旧项目"低置信度降级"的设计）：
 * 这条记事照样存得下，只是不进"今天要做的事"。
 */

var tp = require('./time-parser.js');

var DEFAULT_HOUR = 9; // 只说"明天"没说几点时，默认算早上 9 点

/**
 * 把北京时间的 'YYYY-MM-DD' + 'HH:mm' 转成毫秒时间戳。
 * 北京时间 = UTC+8，所以 UTC 的小时要减 8；Date.UTC 会自动处理跨日。
 */
function toEpoch(dateStr, timeStr) {
  if (!dateStr) return null;
  var p = dateStr.split('-');
  if (p.length !== 3) return null;
  var y = parseInt(p[0], 10), mo = parseInt(p[1], 10), d = parseInt(p[2], 10);
  var hh = DEFAULT_HOUR, mi = 0;
  if (timeStr) {
    var t = timeStr.split(':');
    hh = parseInt(t[0], 10);
    mi = parseInt(t[1], 10) || 0;
  }
  if (isNaN(y) || isNaN(mo) || isNaN(d) || isNaN(hh)) return null;
  return Date.UTC(y, mo - 1, d, hh - 8, mi);
}

/**
 * 只抽钟点（不含日期）的兜底正则。
 *
 * 为什么需要：time-parser 是"期限"解析器，必须见到日期词才出结果。
 * 但记事本里「晚上七点半吃药」这种**只有钟点**的说法极常见——这时日期是隐含的"今天"。
 * 这条兜底就是补上这个场景，中文数字同样要支持。
 */
var CLOCK_ONLY_RE = /(上午|早上|早晨|中午|下午|晚上|傍晚)?\s*(\d{1,2}|[零一二两三四五六七八九十]{1,3})\s*[点時时]\s*(半|[零一二两三四五六七八九十]{1,3}分?|\d{1,2}分?)?/;

function parseClockOnly(text) {
  var m = CLOCK_ONLY_RE.exec(text);
  if (!m) return null;
  var h = tp.cnNumToInt(m[2]);
  if (h == null || h < 0 || h > 23) return null;
  var ap = m[1] || '';
  if ((ap === '中午' || ap === '下午' || ap === '晚上' || ap === '傍晚') && h < 12) h += 12;
  var mi = 0;
  if (m[3] === '半') mi = 30;
  else if (m[3]) mi = tp.cnNumToInt(String(m[3]).replace('分', '')) || 0;
  return { h: h, mi: mi };
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** 取某时刻对应的北京时间日期串 'YYYY-MM-DD' */
function bjDateStr(epochMs) {
  var d = new Date(epochMs + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

/**
 * 解析用户输入的口语时间。
 * @param {string} text 如 "明天下午三点" / "晚上七点半" / "15号" / ""
 * @returns {{rawTime:string, hasTime:boolean, dueAt:number|null, confidence:number}}
 */
function parseWhen(text) {
  var raw = (text || '').trim();
  if (!raw) return { rawTime: '', hasTime: false, dueAt: null, confidence: 1 };

  var ref = tp.refFromBeijingNow(Date.now());
  var r = tp.parseDeadline(raw, ref);

  // 解析不出日期 → 保留原文，不抛错、不阻止保存
  if (!r || !r.date) {
    var clock = parseClockOnly(raw);
    if (clock) {
      // 只有钟点：日期取今天；若这个钟点今天已经过了，推到明天。
      // 推断依据：老人记「晚上七点半吃药」是在为下一次准备，不是补记刚才的事。
      var epoch = toEpoch(bjDateStr(Date.now()), pad2(clock.h) + ':' + pad2(clock.mi));
      if (epoch != null && epoch <= Date.now()) epoch += 24 * 3600 * 1000;
      return { rawTime: raw, hasTime: true, dueAt: epoch, confidence: 0.6 };
    }
    return { rawTime: raw, hasTime: false, dueAt: null, confidence: (r && r.confidence) || 0 };
  }

  var dueAt = toEpoch(r.date, r.time);
  return {
    rawTime: raw,
    hasTime: !!r.time,
    dueAt: dueAt,
    confidence: r.confidence || 0
  };
}

/* ---------------- 显示：一律口语化，不给老人看 "2026-10-09 15:00" ---------------- */

/** 取北京时间的"今天 00:00"对应的时间戳 */
function startOfToday() {
  var now = new Date();
  var bj = new Date(now.getTime() + 8 * 3600 * 1000); // 转北京时间看日历字段
  return Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate()) - 8 * 3600 * 1000;
}

function startOfDayAfter(offsetDays) {
  return startOfToday() + offsetDays * 24 * 3600 * 1000;
}

var WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function hourText(h) {
  if (h < 6) return '凌晨';
  if (h < 12) return '上午';
  if (h === 12) return '中午';   // 12 点叫"中午"不叫"下午"，否则会出现"下午12点"这种别扭说法
  if (h < 18) return '下午';
  return '晚上';
}

/** 把时间戳里的钟点变成口语，如 15:30 → "下午3点半" */
function clockText(epoch) {
  var bj = new Date(epoch + 8 * 3600 * 1000);
  var h = bj.getUTCHours();
  var m = bj.getUTCMinutes();
  var tail = m === 0 ? '点' : (m === 30 ? '点半' : '点' + m + '分');
  return hourText(h) + (h > 12 ? h - 12 : h) + tail;
}

/**
 * 口语化显示时间。
 * @param {number} dueAt
 * @param {boolean} hasTime 用户是否真的指定了钟点（没指定就不编造钟点）
 * @returns {string}
 */
function display(dueAt, hasTime) {
  if (!dueAt) return '';
  var t0 = startOfToday();
  var dayDiff = Math.floor((dueAt - t0) / (24 * 3600 * 1000));

  var dayPart;
  if (dayDiff === 0) dayPart = '今天';
  else if (dayDiff === 1) dayPart = '明天';
  else if (dayDiff === 2) dayPart = '后天';
  else if (dayDiff === -1) dayPart = '昨天';
  else if (dayDiff < -1 && dayDiff > -7) dayPart = Math.abs(dayDiff) + '天前';
  else if (dayDiff < 0) dayPart = dateText(dueAt);
  else if (dayDiff < 7) {
    var bj = new Date(dueAt + 8 * 3600 * 1000);
    dayPart = WEEK_CN[bj.getUTCDay()];
  } else {
    dayPart = dateText(dueAt);
  }

  if (hasTime) return dayPart + ' ' + clockText(dueAt);
  return dayPart;
}

function dateText(epoch) {
  var bj = new Date(epoch + 8 * 3600 * 1000);
  var y = bj.getUTCFullYear();
  var nowY = new Date(Date.now() + 8 * 3600 * 1000).getUTCFullYear();
  var s = (bj.getUTCMonth() + 1) + '月' + bj.getUTCDate() + '日';
  return y !== nowY ? y + '年' + s : s;
}

/** 是否已过期（用于标"已过"文字标记；状态不能只靠颜色区分 [S2][S4]） */
function isOverdue(dueAt) {
  return !!dueAt && dueAt < Date.now();
}

/** 是否属于"今天要做的事"：有时间且已过或就在今天 */
function isDueToday(dueAt) {
  if (!dueAt) return false;
  return dueAt < startOfDayAfter(1);
}

module.exports = {
  parseWhen: parseWhen,
  display: display,
  isOverdue: isOverdue,
  isDueToday: isDueToday,
  startOfToday: startOfToday,
  clockText: clockText
};
