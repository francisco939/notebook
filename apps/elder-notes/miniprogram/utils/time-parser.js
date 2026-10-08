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

/** 某年某月有多少天。month0 为 0-based（0=一月）。 */
function daysInMonth(y, month0) {
  return new Date(Date.UTC(y, month0 + 1, 0)).getUTCDate();
}

/**
 * 该年该月是否真的有这一天。
 *
 * 必须显式校验：`Date.UTC(2026, 1, 29)` 不会报错，而是**静默溢出**成 2026-03-01。
 * 于是「2月29日前」在非闰年会给出一个差了一个月的日期，而且不报任何错。
 * 日期算错的代价是用户白跑一趟，所以宁可返回 null 交给降级逻辑。
 */
function dayExists(y, month1, d) {
  const dt = new Date(Date.UTC(y, month1 - 1, d));
  return dt.getUTCMonth() + 1 === month1 && dt.getUTCDate() === d;
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

/** 排除「号/日」后面紧跟这些字的情况——它们是编号或设施名，不是日期。 */
const NOT_A_DAY_SUFFIX = '楼线门院馆机表文车厅窗柜栋幢座区号期';

/**
 * 每个模式返回 { date: Date|null, matched: string, confidence: number }。
 * 顺序即优先级。
 *
 * 排列依据：越明确、越不需要推断的写法越靠前。
 *   绝对日期 → 带月份的月日 → 相对天数 → 带月份的日号 → 月首末 → 相对日 → 裸日号 → 周 → 
 * 「裸日号」（只有"15号"、没有月份）刻意排在相对日之后、置信度压到 0.7 以下，
 * 因为它的月份是**推断**出来的，需要前端并列展示原文让用户核对。
 */
function buildPatterns(ref) {
  const patterns = [];

  // 1. 完整日期 2026-10-10 / 2026/10/10 / 2026年10月10日
  patterns.push({
    re: /(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})\s*[日号]?/,
    fn: (m) => {
      const y = +m[1], mo = +m[2], d = +m[3];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      if (!dayExists(y, mo, d)) return null; // 「2026-02-29」这种不存在的日期
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
      const y = ref.getUTCFullYear();
      if (!dayExists(y, mo, d)) return null; // 如非闰年的「2月29日」→ 不硬编
      let dt = toUTC(y, mo, d);
      // 若该月日已过去超过 30 天，认为是明年的（如 1 月发的通知提"12月31日"）
      if (addDays(dt, 30) < ref) {
        if (!dayExists(y + 1, mo, d)) return null;
        dt = toUTC(y + 1, mo, d);
      }
      return { date: dt, matched: m[0], confidence: 0.85 };
    },
  });

  // 3. 相对天数：「3日内 / 5天内 / 七日内」
  //    必须排在「裸日号」之前，否则「3日内」会被裸日模式吃成"3日"。
  //    只认自然日，不认「N个工作日内」——工作日要剔除非工作日，不能按自然日硬算。
  patterns.push({
    re: new RegExp(`([${CN}]{1,3}|\\d{1,2})\\s*[日天]\\s*内`),
    fn: (m) => {
      const n = cnNumToInt(m[1]);
      if (n == null || n < 0 || n > 90) return null;
      return { date: addDays(ref, n), matched: m[0], confidence: 0.75 };
    },
  });

  // 4. 带月份的日号：「本月15号 / 这月20日 / 下月5号」
  //    必须排在裸日号之前，否则「本月5号」会被裸日模式按相对位置重新推断成下月。
  patterns.push({
    re: new RegExp(`(本|这|下个|下)\\s*月\\s*([${CN}]{1,3}|\\d{1,2})\\s*[日号]`),
    fn: (m) => {
      const which = m[1];
      const d = cnNumToInt(m[2]);
      if (d == null || d < 1 || d > 31) return null;
      const y0 = ref.getUTCFullYear();
      const m0 = ref.getUTCMonth() + (which === '下' || which === '下个' ? 1 : 0);
      if (d > daysInMonth(y0, m0)) return null; // 如「下月31号」而该月只有 30 天
      return { date: new Date(Date.UTC(y0, m0, d)), matched: m[0], confidence: 0.8 };
    },
  });

  // 5. 月首末：「月底 / 本月底 / 下月初 / 十月底 / 11月中旬」
  //    中文月份必须支持：「十月底」原先被当成"本月月底"，在非 10 月发送的通知上
  //    会给出完全错误的日期（如 9 月 15 日发的通知里写"十月底"，算成 9-30）。
  patterns.push({
    re: new RegExp(`(本|这|下个|下|[${CN}]{1,3}|\\d{1,2})?\\s*月\\s*(底|末|初|中)`),
    fn: (m) => {
      const token = m[1] || '';
      const where = m[2];
      const y0 = ref.getUTCFullYear();
      let m0 = ref.getUTCMonth();
      let explicit = false; // 是否写明了月份（写明时才有"已过去 → 明年"的问题）
      if (token === '下' || token === '下个') {
        m0 += 1;
      } else if (token && token !== '本' && token !== '这') {
        const mn = cnNumToInt(token);
        if (mn == null || mn < 1 || mn > 12) return null;
        m0 = mn - 1;
        explicit = true;
      }
      const day = where === '初' ? 1 : where === '中' ? 15 : daysInMonth(y0, m0);
      let dt = new Date(Date.UTC(y0, m0, day));
      // 写明了月份的表述若已过去超过 30 天，按明年的算（与「月日」模式同一套规则）
      if (explicit && addDays(dt, 30) < ref) dt = new Date(Date.UTC(y0 + 1, m0, day));
      return { date: dt, matched: m[0], confidence: where === '中' ? 0.6 : 0.75 };
    },
  });

  // 6. 相对日：今天 / 明天 / 后天 / 大后天
  //    故意不收「当天」「当日」——它们指的是"前面提到的那一天"（如"活动当天"），
  //    而不是今天。当成今天会给出错误日期，属于"看起来对、实际错"的那一类。
  const relDays = [
    [/大后天/, 3], [/后天/, 2], [/明天|明日/, 1], [/今天|今日|本日/, 0],
  ];
  relDays.forEach(([re, n]) => {
    patterns.push({
      re,
      fn: (m) => ({ date: addDays(ref, n), matched: m[0], confidence: 0.95 }),
    });
  });

  // 7. 裸日号：「15号前 / 20日之前 / 十号前」——中文通知里最高频的期限写法
  //
  // 这是**推断**而非确证：文本里没有月份，归属靠日号与今天的相对位置判断
  // （日号 > 今天 → 本月；否则 → 下月）。所以置信度刻意压在 0.7 以下，
  // 让前端并列展示原文供老人核对——日期算错一天，代价是白跑一趟。
  patterns.push({
    // 排除编号与设施名：「第2号」文件、「3号楼」、「1号线」、「2号门」、「6号车厢」
    re: new RegExp(`(?<!第)([${CN}]{1,3}|\\d{1,2})\\s*[日号](?![${NOT_A_DAY_SUFFIX}])`),
    fn: (m) => {
      const d = cnNumToInt(m[1]);
      if (d == null || d < 1 || d > 31) return null;
      const y0 = ref.getUTCFullYear();
      // 日号 ≥ 今天 → 本月；否则 → 下月。
      // 用 >= 而非 > 是为了照顾"当天发当天截止"：今天 8 号时说「8号前」，指的就是今天。
      const m0 = ref.getUTCMonth() + (d >= ref.getUTCDate() ? 0 : 1);
      if (d > daysInMonth(y0, m0)) return null; // 如 2 月 30 号
      return { date: new Date(Date.UTC(y0, m0, d)), matched: m[0], confidence: 0.62 };
    },
  });

  // 8. 周表述：本周五 / 这周五 / 下周一 / 周五 / 本周末 / 下周末
  patterns.push({
    re: /(本|这|下|下个)?\s*(周|星期|礼拜)\s*([一二三四五六日天]|末)/,
    fn: (m) => {
      const which = m[1] || '';
      const dayChar = m[3];
      // 「周末」取该周周日。原实现把「末」当成索引 -1，算出的其实是**上一周**的周日，
      // 于是「本周末前」会给出一个已经过去的日期——这种"答案错但不报错"最危险。
      const isWeekend = dayChar === '末';
      const target = isWeekend || dayChar === '日' || dayChar === '天'
        ? 7
        : '一二三四五六'.indexOf(dayChar) + 1;
      const weekStart = startOfWeek(ref);
      let dt = addDays(weekStart, target - 1);
      if (which === '下' || which === '下个') dt = addDays(dt, 7);
      else if (!which && dt < ref) dt = addDays(dt, 7); // 裸"周五"且已过 → 指下周
      return {
        date: dt,
        matched: m[0],
        confidence: which ? (isWeekend ? 0.8 : 0.9) : isWeekend ? 0.6 : 0.7,
      };
    },
  });

  return patterns;
}

/**
 * 期限信号词：出现时说明这句话大概率是"什么时候之前要完成"。
 *
 * 两个刻意的收窄（都是误报代价换来的）：
 *   · 不收裸「内」——它会把「内容」「室内」「国内」全判成期限信号，
 *     进而让一条本来就没有期限的通知被误判为「有期限但没读懂」而整卡降级。
 *     需要覆盖的「3日内」由「以内」和相对天数模式负责。
 *   · 「前」加后视排除「目前」——同样是高频误报源。
 *   · 补上「日内 / 天内」（如「3日内回复」）。用 [日天]内 而不是裸「内」，
 *     既覆盖了这种写法，又不会命中「内容」「室内」。
 */
const DEADLINE_CUES = /(?:之前|以前|以内|截至|截止|日前|务必|尽快|马上|立即|[日天]内|(?<!目)前)/;

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
  //
  // 【本项目新增】钟点支持中文数字：「下午三点」「晚上七点半」「十点」。
  // 原实现只认阿拉伯数字（\d{1,2}），但老人记事时打「三点」比「3点」更自然，
  // 这是搬到记事本场景后暴露出来的缺口——旧项目的书面语料没覆盖到。
  const timeRes = [
    /(\d{1,2})\s*[:：]\s*(\d{2})/,
    /(上午|早上|早晨|中午|下午|晚上|傍晚)?\s*(\d{1,2}|[零一二两三四五六七八九十]{1,3})\s*[点時时]\s*(半|[零一二两三四五六七八九十]{1,3}分?|\d{1,2}分?)?/,
  ];
  let hour = null, minute = null;
  let tm = timeRes[0].exec(text);
  if (tm) { hour = +tm[1]; minute = +tm[2]; }
  else {
    tm = timeRes[1].exec(text);
    if (tm) {
      hour = cnNumToInt(tm[2]);
      const ap = tm[1] || '';
      if ((ap === '中午' || ap === '下午' || ap === '晚上' || ap === '傍晚') && hour != null && hour < 12) hour += 12;
      if (tm[3] === '半') minute = 30;
      else if (tm[3]) minute = cnNumToInt(String(tm[3]).replace('分', '')) || 0;
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
