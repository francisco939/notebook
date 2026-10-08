'use strict';

/**
 * 相对时间解析器：把通知里的「本周五前」「10 月 10 号」这类表述，解析成绝对日期。
 *
 * 为什么需要它：老人看不懂"届时""本周五前"这类书面语，也不擅长心算日期。
 * 模型即使能抽取出期限原文，也常常算错日期——所以日期一律由本地纯函数计算，
 * 模型只负责"把期限原文指出来"。这样日期是确定性的，可单测、可回归。
 *
 * 中国习惯：一周从周一开始，周日结束。
 *
 * 本文件是纯函数模块，不依赖任何环境，可在 Node 中直接单测。
 */

/** 中文数字 → 阿拉伯数字，处理「十月十日」「十号」这类写法。 */
const CN_DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function cnNumToInt(s) {
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === '十') return 10;
  // 十一~十九
  let m = /^十([零一二三四五六七八九])$/.exec(s);
  if (m) return 10 + CN_DIGITS[m[1]];
  // 二十~九十九
  m = /^([一二三四五六七八九])十([零一二三四五六七八九])?$/.exec(s);
  if (m) return CN_DIGITS[m[1]] * 10 + (m[2] ? CN_DIGITS[m[2]] : 0);
  if (CN_DIGITS[s] != null) return CN_DIGITS[s];
  return null;
}

const CN = '零一二两三四五六七八九十';

// ---------------------------------------------------------------------------
// 日期基础运算（全部用 UTC，避免本地时区把日期推错一天）
// ---------------------------------------------------------------------------

function toUTC(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d));
}

function fmt(dt) {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(dt, n) {
  return new Date(dt.getTime() + n * 86400000);
}

/** 取某天所在周的周一（ISO：周一为一周起点）。 */
function startOfWeek(dt) {
  const dow = dt.getUTCDay(); // 0=周日
  const offset = dow === 0 ? -6 : 1 - dow;
  return addDays(dt, offset);
}

/**
 * 把参考时间归一化到"当天 00:00 UTC"。
 * 注意：调用方必须传入以北京时间为准的 Y/M/D，
 * 勿直接 new Date() 后用本地方法取值（部署环境时区不确定）。
 */
function makeRef(year, month, day) {
  return toUTC(year, month, day);
}

/** 从含北京时间的 Date 对象构造参考日（云函数环境时区可能非 UTC+8，故显式换算）。 */
function refFromBeijingNow(nowMs) {
  const bj = new Date((typeof nowMs === 'number' ? nowMs : Date.now()) + 8 * 3600000);
  return toUTC(bj.getUTCFullYear(), bj.getUTCMonth() + 1, bj.getUTCDate());
}

// ---------------------------------------------------------------------------
// 模式表
// ---------------------------------------------------------------------------

/**
 * 每个模式返回 { date: Date|null, matched: string, confidence: number }。
 * 顺序即优先级：先绝对日期，再相对日，再周，再月。
 */
function buildPatterns(ref) {
  const patterns = [];

  // 1. 完整日期 2026-10-10 / 2026/10/10 / 2026年10月10日
  patterns.push({
    re: /(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})\s*[日号]?/,
    fn: (m) => {
      const y = +m[1], mo = +m[2], d = +m[3];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      return { date: toUTC(y, mo, d), matched: m[0], confidence: 0.95 };
    },
  });

  // 2. 月日（当年）10月10日 / 10/10 / 10-10 / 十月十日
  patterns.push({
    // 注意：中文字符必须写成字符类 [${CN}]{1,3}。
    // 若写成 ${CN}?${CN}? 则只有最后一个字可选，整串会被当成字面量，永远匹配不上「十月十日」。
    re: new RegExp(`([${CN}]{1,3}|\\d{1,2})\\s*[月/\\-.]\\s*([${CN}]{1,3}|\\d{1,2})\\s*[日号]?`),
    fn: (m) => {
      const mo = cnNumToInt(m[1]);
      const d = cnNumToInt(m[2]);
      if (mo == null || d == null) return null;
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      let y = ref.getUTCFullYear();
      let dt = toUTC(y, mo, d);
      // 若该月日已过去超过 30 天，认为是明年的（如 1 月发的通知提"12月31日"）
      if (addDays(dt, 30) < ref) dt = toUTC(y + 1, mo, d);
      return { date: dt, matched: m[0], confidence: 0.85 };
    },
  });

  // 3. 相对日
  const relDays = [
    [/大后天/, 3], [/后天/, 2], [/明天|明日/, 1], [/今天|今日|本日|当天/, 0],
  ];
  relDays.forEach(([re, n]) => {
    patterns.push({
      re,
      fn: (m) => ({ date: addDays(ref, n), matched: m[0], confidence: 0.95 }),
    });
  });

  // 4. 周表述：本周五 / 这周五 / 下周一 / 周五
  patterns.push({
    re: /(本|这|下|下个)?\s*(周|星期|礼拜)\s*([一二三四五六日天末])/,
    fn: (m) => {
      const which = m[1] || '';
      const dayChar = m[3];
      let target = dayChar === '日' || dayChar === '天' ? 7 : '一二三四五六'.indexOf(dayChar) + 1;
      const weekStart = startOfWeek(ref);
      let dt = addDays(weekStart, target - 1);
      if (which === '下' || which === '下个') dt = addDays(dt, 7);
      else if (!which && dt < ref) dt = addDays(dt, 7); // 裸"周五"且已过 → 指下周
      return { date: dt, matched: m[0], confidence: which ? 0.9 : 0.7 };
    },
  });

  // 5. 月表述：月底 / 本月底 / 下月初
  patterns.push({
    re: /(本|这|下|下个)?\s*月\s*(底|末|初|中)/,
    fn: (m) => {
      const which = m[1] || '';
      const where = m[2];
      let base = ref;
      if (which === '下' || which === '下个') {
        base = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1));
      }
      const y = base.getUTCFullYear();
      const mo = base.getUTCMonth() + 1;
      const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      const day = where === '底' || where === '末' ? lastDay : where === '初' ? 1 : 15;
      return { date: toUTC(y, mo, day), matched: m[0], confidence: where === '中' ? 0.55 : 0.75 };
    },
  });

  return patterns;
}

/** 期限信号词：出现时说明这句话大概率是"什么时候之前要完成"。 */
const DEADLINE_CUES = /(前|之前|以前|截止|截至|以内|内|前完成|前交|务必|尽快|马上|立即|日前)/;

/** 明确无法解析为日期的模糊表述。 */
const VAGUE = /(尽快|近期|这几天|过几天|等通知|另行通知|待定|择日)/;

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 从一段文本中解析期限。
 *
 * @param {string} text        待解析文本（一条通知的正文或某个片段）
 * @param {Date}   ref         参考日（当天 00:00 UTC，用 makeRef / refFromBeijingNow 构造）
 * @returns {{date: string|null, time: string|null, confidence: number,
 *            matched: string|null, cue: boolean, vague: boolean}}
 */
function parseDeadline(text, ref) {
  const out = { date: null, time: null, confidence: 0, matched: null, cue: false, vague: false };
  if (typeof text !== 'string' || !text.trim()) return out;

  const cue = DEADLINE_CUES.test(text);
  out.cue = cue;
  out.vague = VAGUE.test(text);

  // 时间点：早 7:30 / 上午9点 / 下午3点 / 19:30
  const timeRes = [
    /(\d{1,2})\s*[:：]\s*(\d{2})/,
    /(上午|早上|早晨|下午|晚上|傍晚)?\s*(\d{1,2})\s*[点時时]\s*(半|\d{1,2}分?)?/,
  ];
  let hour = null, minute = null;
  let tm = timeRes[0].exec(text);
  if (tm) { hour = +tm[1]; minute = +tm[2]; }
  else {
    tm = timeRes[1].exec(text);
    if (tm) {
      hour = +tm[2];
      const ap = tm[1] || '';
      if ((ap === '下午' || ap === '晚上' || ap === '傍晚') && hour < 12) hour += 12;
      if (tm[3] === '半') minute = 30;
      else if (tm[3]) minute = parseInt(tm[3], 10) || 0;
      else minute = 0;
    }
  }
  if (hour != null && hour >= 0 && hour <= 23 && minute != null && minute >= 0 && minute <= 59) {
    out.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const patterns = buildPatterns(ref);
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (!m) continue;
    const r = p.fn(m);
    if (!r || !r.date) continue;
    out.date = fmt(r.date);
    out.matched = r.matched;
    // 有期限信号词 → 置信度上调；模糊表述 → 下调
    let conf = r.confidence;
    if (cue) conf = Math.min(0.98, conf + 0.05);
    out.confidence = Math.round(conf * 100) / 100;
    break;
  }

  // 没解析出日期，但文本里有期限信号词 → 给出"存在期限但未识别"的信号
  if (!out.date && cue) out.confidence = 0.2;

  return out;
}

module.exports = {
  parseDeadline,
  makeRef,
  refFromBeijingNow,
  cnNumToInt,
  addDays,
  startOfWeek,
  fmt,
  toUTC,
  DEADLINE_CUES,
};
