'use strict';

/**
 * 日期 / 金额 的中文展示格式化。
 * 全部为纯函数，不依赖任何 wx.*，方便单测。
 */

var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 把 YYYY-MM-DD 转成「10月10日 周五」。
 * 非法日期返回空字符串。
 * @param {string} dateStr
 * @returns {string}
 */
function formatDateCN(dateStr) {
  if (typeof dateStr !== 'string') return '';
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateStr.trim());
  if (!m) return '';
  var y = +m[1], mo = +m[2], d = +m[3];
  var dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return '';
  }
  var wd = WEEKDAYS[dt.getUTCDay()];
  return mo + '月' + d + '日 ' + wd;
}

/**
 * 把时间 HH:mm 转中文（保留原样，仅做合法性过滤）。
 * @param {string} timeStr
 * @returns {string}
 */
function formatTimeCN(timeStr) {
  if (typeof timeStr !== 'string') return '';
  var m = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
  if (!m) return '';
  var h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return '';
  return (h < 10 ? '0' + h : '' + h) + ':' + (mi < 10 ? '0' + mi : '' + mi);
}

/**
 * 把金额对象 { value, currency } 转成中文展示。
 * value 为 null 时返回空串（调用方应改展 raw 原文）。
 * @param {{value:?number, currency:string}} amount
 * @returns {string}
 */
function formatAmountCN(amount) {
  if (!amount || typeof amount.value !== 'number') return '';
  var v = amount.value;
  // 整数不显示小数
  var s = (Math.round(v * 100) / 100).toString();
  if (amount.currency && amount.currency !== 'CNY') {
    return s + ' ' + amount.currency;
  }
  return s + '元';
}

/**
 * 把 deadline 对象拼成一句中文（含日期与时间）。
 * @param {{date:string, rangeEnd:string, time:string, text:string}} deadline
 * @returns {string} 例如「10月10日 周五 前」「10月10日 至 10月12日」
 */
function formatDeadlineCN(deadline) {
  if (!deadline) return '';
  var parts = [];
  if (deadline.date) {
    var d = formatDateCN(deadline.date);
    if (deadline.rangeEnd) {
      parts.push(d + ' 至 ' + formatDateCN(deadline.rangeEnd));
    } else {
      parts.push(d);
    }
  } else if (deadline.text) {
    parts.push(deadline.text);
  }
  if (deadline.time) {
    var t = formatTimeCN(deadline.time);
    if (t) parts.push(t);
  }
  if (!parts.length) return '';
  // 只有「日期」这一种情况（无 rangeEnd/无 time）才加「前」字，更贴合老人理解；
  // 若原本就是 text（如「本周五前」），则原样返回，避免重复成「本周五前 前」。
  if (parts.length === 1 && deadline.date && !deadline.rangeEnd && !deadline.time) {
    return parts[0] + ' 前';
  }
  return parts.join(' ');
}

module.exports = {
  formatDateCN: formatDateCN,
  formatTimeCN: formatTimeCN,
  formatAmountCN: formatAmountCN,
  formatDeadlineCN: formatDeadlineCN,
};
