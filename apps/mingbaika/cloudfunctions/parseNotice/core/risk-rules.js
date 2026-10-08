'use strict';

/**
 * 风险启发式规则（对应产品模块 F4）。
 *
 * 定位（必须在产品说明与答辩中反复强调，不能含糊）：
 *   本模块做的是**基于通知内容特征的启发式判断**，不是身份认证，也不是事实核验。
 *   小程序读不到聊天记录，也无法验证群成员真实身份。命中规则只代表"这条内容具备
 *   某些可疑特征，建议先核实"，不代表"这条是诈骗"。
 *
 * 取舍原则：宁可误报，不可漏报。因此规则刻意偏宽松，且每条都返回 evidence
 *   原文片段，让用户能自己核对，而不是让用户信任一个结论。
 *
 * 纯函数模块，不依赖任何环境，可在 Node 中直接单测。
 */

const { RISK_CODES, LIMITS } = require('./schema');

/** 从匹配位置截取上下文片段作为"证据"。 */
function excerptAround(text, index, len) {
  const start = Math.max(0, index - 8);
  const end = Math.min(text.length, index + len + 12);
  let s = text.slice(start, end).replace(/\s+/g, ' ').trim();
  const cps = Array.from(s);
  if (cps.length > LIMITS.rawExcerpt) s = cps.slice(0, LIMITS.rawExcerpt).join('') + '…';
  return s;
}

/**
 * 规则定义。
 *   test(text, ctx) → null | { level, code, title, evidence }
 * ctx 携带已经结构化出来的信息（金额、是否有对公账户线索、发布者线索），
 * 使规则既能看文本特征，也能看结构特征。
 */
const RULES = [
  // ── 催办话术：制造时间压力，压缩用户核实的时间窗口 ──────────────────
  {
    code: RISK_CODES.URGENCY_PRESSURE,
    test(text) {
      const re = /(今天内|今日内|当天内|立即|马上|立刻|尽快|最后期限|最后一天|逾期|过期不候|后果自负|影响.{0,4}(上课|学习|评优|入学|报名)|抓紧|仅限今天|倒计时|过期作废)/;
      const m = re.exec(text);
      if (!m) return null;
      return {
        level: 'warn',
        code: RISK_CODES.URGENCY_PRESSURE,
        title: `用了催办话术"${m[0]}"`,
        evidence: excerptAround(text, m.index, m[0].length),
      };
    },
  },

  // ── 紧急/权威话术：冒充式通知的典型开场 ────────────────────────────
  {
    code: RISK_CODES.AUTHORITY_CLAIM,
    test(text) {
      const re = /(紧急通知|重要通知|紧急|特急|接到.{0,6}(通知|要求)|学校要求|上级要求|统一要求|最后一次通知)/;
      const m = re.exec(text);
      if (!m) return null;
      return {
        level: 'info',
        code: RISK_CODES.AUTHORITY_CLAIM,
        title: `以"${m[0]}"开头`,
        evidence: excerptAround(text, m.index, m[0].length),
      };
    },
  },

  // ── 个人收款：正规学校/单位收费应走对公账户或官方平台 ──────────────
  {
    code: RISK_CODES.PERSONAL_PAY,
    test(text, ctx) {
      // 有金额、且出现个人收款特征，才报
      const hasMoney = (ctx && ctx.hasAmount) || /(\d+(\.\d+)?)\s*(元|块|￥|¥)/.test(text);
      if (!hasMoney) return null;
      const re = /(个人收款|私人收款|收款码|扫码(支付|付款|转账)|微信转账|转账给我|私发|红包|加我微信|加微信(好友)?(转账|付款|支付)|直接转|支付宝转账|发红包)/;
      const m = re.exec(text);
      if (!m) return null;
      const multiPerson = /(班长|家委|某某家长|一位家长|热心家长|代收|帮忙收|暂由.{0,4}代收)/.test(text);
      return {
        level: multiPerson ? 'danger' : 'warn',
        code: RISK_CODES.PERSONAL_PAY,
        title: multiPerson ? '由个人代收，且非老师本人' : `收款方式为"${m[0]}"，不是对公账户`,
        evidence: excerptAround(text, m.index, m[0].length),
      };
    },
  },

  // ── 金额异常：非整数金额 + 收费名义，是骗局的高频组合 ────────────────
  {
    code: RISK_CODES.AMOUNT_ODD,
    test(text, ctx) {
      const amounts = extractAmounts(text);
      if (!amounts.length) return null;
      const v = amounts[0].value;
      const feeWords = /(资料费|材料费|补课费|学费|保证金|押金|激活费|认证费|手续费|服务费|报名费)/.test(text);
      const odd = (v >= 100 && v % 10 !== 0 && /(\.\d+|[2-9])$/.test(String(v)));
      if (!(feeWords && odd)) return null;
      return {
        level: 'info',
        code: RISK_CODES.AMOUNT_ODD,
        title: `金额 ${v} 元非整数，且以"收费"名义出现`,
        evidence: excerptAround(text, amounts[0].index, amounts[0].raw.length),
      };
    },
  },

  // ── 引导离开群聊：把沟通挪到私聊或站外，规避留痕 ────────────────────
  {
    code: RISK_CODES.OFF_CHANNEL,
    test(text) {
      const re = /(加我(的)?(私人)?微信|私聊我|私我|不要(在群里|公开)(说|发)|单独(联系|发给我)|点(击)?(链接|下方链接)|复制链接|扫码进群)/;
      const m = re.exec(text);
      if (!m) return null;
      return {
        level: 'warn',
        code: RISK_CODES.OFF_CHANNEL,
        title: `引导"${m[0]}"，离开群聊沟通`,
        evidence: excerptAround(text, m.index, m[0].length),
      };
    },
  },
];

/** 抽取文本中的所有金额。返回 [{value, raw, index}]。 */
function extractAmounts(text) {
  const out = [];
  const re = /(?:(?:￥|¥|RMB|人民币)\s*)?(\d{1,7}(?:\.\d{1,2})?)\s*(?:元|块钱|块|圆)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const value = parseFloat(m[1]);
    if (!isFinite(value) || value <= 0) continue;
    out.push({ value, raw: m[0], index: m.index });
  }
  return out;
}

/**
 * 运行全部规则。
 *
 * @param {string} text            原始通知文本（图片未 OCR 时可为空，此时只能靠结构特征）
 * @param {object} [ctx]
 * @param {boolean} [ctx.hasAmount] 结构化结果中是否含金额
 * @returns {Array<{level,code,title,evidence}>} 去重后按危险度降序，最多 3 条
 */
function detectRisks(text, ctx = {}) {
  const t = typeof text === 'string' ? text : '';
  if (!t && !ctx.hasAmount) return [];

  const hits = [];
  const seen = new Set();
  for (const r of RULES) {
    let hit = null;
    try {
      hit = r.test(t, ctx);
    } catch (e) {
      hit = null; // 单条规则出错不影响其它规则
    }
    if (!hit || seen.has(hit.code)) continue;
    seen.add(hit.code);
    hits.push(hit);
  }

  const order = { danger: 0, warn: 1, info: 2 };
  hits.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));
  return hits.slice(0, LIMITS.maxRisks);
}

/** 命中任意 danger 级风险 → 需要前端显著拦截。 */
function hasBlockingRisk(risks) {
  return Array.isArray(risks) && risks.some((r) => r && r.level === 'danger');
}

module.exports = {
  detectRisks,
  extractAmounts,
  hasBlockingRisk,
  RULES,
};
