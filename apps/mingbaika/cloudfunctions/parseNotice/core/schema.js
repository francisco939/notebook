'use strict';

/**
 * 行动卡 Schema —— 前后端唯一契约（v1.0）
 *
 * 三条设计原则：
 *  1. 模型输出不可信。所有字段必须经规范化与边界裁剪：超长截断、越界夹值、类型纠正、非法丢弃。
 *  2. 低置信度不隐藏。关键字段保留 raw 原文片段，前端在 confidence 低于阈值时展示原文供用户核对，
 *     而不是直接给一个可能是错的结论。
 *  3. 降级是一等状态。当无法产出可信结构时，整卡降级为「原文 + 语音朗读」，
 *     绝不让用户看到半成品的抽取结果。
 *
 * 本文件是纯函数模块，不 import 任何 wx.* / cloud.*，可在 Node 中直接单测。
 */

const SCHEMA_VERSION = '1.0';

/** 各字段长度/数量上限。模型很容易输出超长文本，必须在入口处裁剪。 */
const LIMITS = {
  title: 14,          // 卡片标题
  summary: 48,        // 一句话说明
  itemWhat: 18,       // 行动项动词短语
  itemNote: 24,       // 补充说明
  itemLocation: 16,   // 地点
  carryItem: 10,      // 单个携带物
  maxCarry: 6,        // 携带物数量
  maxItems: 3,        // 行动项数量（一屏最多三条）
  maxRisks: 3,        // 风险提示数量
  rawExcerpt: 60,     // 原文片段截取长度
  rawText: 2000,      // 原文全文保留上限
  publisher: 16,      // 发布者名称
};

/** 置信度阈值。 */
const THRESHOLDS = {
  /** 整卡低于此值 → 降级为原文 */
  cardDegrade: 0.45,
  /** 字段低于此值 → 前端并列展示原文供核对 */
  fieldLowConfidence: 0.7,
};

/** 风险等级。 */
const RISK_LEVELS = ['info', 'warn', 'danger'];

/** 风险码枚举。规则实现见 risk-rules.js。 */
const RISK_CODES = {
  URGENCY_PRESSURE: 'URGENCY_PRESSURE',   // 催办话术
  PERSONAL_PAY: 'PERSONAL_PAY',           // 个人收款方式
  AMOUNT_ODD: 'AMOUNT_ODD',               // 金额异常
  AUTHORITY_CLAIM: 'AUTHORITY_CLAIM',     // 紧急/权威话术
  OFF_CHANNEL: 'OFF_CHANNEL',             // 引导加私聊/站外
};

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 裁剪字符串：去首尾空白、压缩连续空白、按字符数截断。非字符串一律返回 null。 */
function clipStr(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // 按 Unicode 码点截断，避免把 emoji / 生僻字切成半个
  const cps = Array.from(s);
  if (cps.length <= max) return s;
  return cps.slice(0, max).join('') + '…';
}

/** 夹到 [0,1]，非数字返回 fallback。 */
function clipConfidence(v, fallback = 0.5) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!isFinite(n)) return fallback;
  // 只有 n>=2 才可能是百分数（模型输出 85 表示 85%）。
  // 1<n<2 的语义是"略超 1 的小数"，应夹到 1——若当成百分数会变成 0.015，是危险的静默错误。
  if (n >= 2 && n <= 100) return clamp(n / 100, 0, 1);
  return clamp(n, 0, 1);
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** 严格校验 YYYY-MM-DD 且日期真实存在（挡掉 2026-02-30 这类）。 */
function isValidDateStr(s) {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** 校验 HH:mm。 */
function isValidTimeStr(s) {
  if (typeof s !== 'string') return false;
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return false;
  const h = +m[1], mi = +m[2];
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
}

// ---------------------------------------------------------------------------
// 字段级规范化
// ---------------------------------------------------------------------------

function normalizeDeadline(raw) {
  if (!isPlainObject(raw)) return null;
  const date = isValidDateStr(raw.date) ? raw.date : null;
  const rangeEnd = isValidDateStr(raw.rangeEnd) ? raw.rangeEnd : null;
  const time = isValidTimeStr(raw.time) ? raw.time : null;
  const text = clipStr(raw.text, 20);
  const excerpt = clipStr(raw.raw, LIMITS.rawExcerpt);

  // 一个日期都没解析出来，且没有原文兜底 → 整个 deadline 无意义，丢弃
  if (!date && !text && !excerpt) return null;

  return {
    text,
    date,
    rangeEnd,
    time,
    confidence: clipConfidence(raw.confidence, date ? 0.7 : 0.3),
    raw: excerpt,
  };
}

function normalizeAmount(raw) {
  if (!isPlainObject(raw)) {
    // 容忍模型直接给数字
    if (typeof raw === 'number') {
      return { value: raw, currency: 'CNY', confidence: 0.6, raw: null };
    }
    return null;
  }
  let value = typeof raw.value === 'number' ? raw.value : parseFloat(raw.value);
  if (!isFinite(value) || value < 0) value = null;
  if (value !== null) value = Math.round(value * 100) / 100;
  const currency = typeof raw.currency === 'string' && raw.currency.trim()
    ? raw.currency.trim().toUpperCase().slice(0, 3)
    : 'CNY';
  if (value === null && !clipStr(raw.raw, LIMITS.rawExcerpt)) return null;
  return {
    value,
    currency,
    confidence: clipConfidence(raw.confidence, value === null ? 0.3 : 0.7),
    raw: clipStr(raw.raw, LIMITS.rawExcerpt),
  };
}

function normalizeItem(raw, index) {
  if (!isPlainObject(raw)) return null;
  const what = clipStr(raw.what, LIMITS.itemWhat);
  const note = clipStr(raw.note, LIMITS.itemNote);
  const location = clipStr(raw.location, LIMITS.itemLocation);
  const excerpt = clipStr(raw.raw, LIMITS.rawExcerpt);

  // 行动项的核心是 what。没有 what 且没有任何兜底 → 丢弃
  if (!what && !excerpt) return null;

  let carry = [];
  if (Array.isArray(raw.carry)) {
    carry = raw.carry
      .map((x) => clipStr(x, LIMITS.carryItem))
      .filter(Boolean)
      .slice(0, LIMITS.maxCarry);
  }

  return {
    id: clipStr(raw.id, 12) || `i${index + 1}`,
    what: what || '（原文见下）',
    deadline: normalizeDeadline(raw.deadline),
    amount: normalizeAmount(raw.amount),
    carry,
    location,
    note,
    confidence: clipConfidence(raw.confidence, 0.6),
    raw: excerpt,
  };
}

function normalizePublisher(raw) {
  if (!isPlainObject(raw)) return null;
  const name = clipStr(raw.name, LIMITS.publisher);
  const evidence = clipStr(raw.evidence, LIMITS.rawExcerpt);
  if (!name && !evidence) return null;
  return {
    name,
    evidence,
    confidence: clipConfidence(raw.confidence, 0.4),
  };
}

function normalizeRisk(raw) {
  if (!isPlainObject(raw)) return null;
  const title = clipStr(raw.title, 24);
  if (!title) return null;
  const level = RISK_LEVELS.indexOf(raw.level) >= 0 ? raw.level : 'warn';
  const code = typeof raw.code === 'string' && raw.code.trim()
    ? raw.code.trim().slice(0, 32)
    : 'UNKNOWN';
  return {
    level,
    code,
    title,
    evidence: clipStr(raw.evidence, LIMITS.rawExcerpt),
  };
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 把任意来源（模型输出 / 缓存 / 旧版本）的对象规范化为受契约约束的行动卡。
 * 不抛异常：输入再脏也产出一张结构完整的卡（最差是降级卡）。
 *
 * @param {object} raw   原始输入
 * @param {object} [opts]
 * @param {string} [opts.rawText]  原始通知文本，用于兜底与降级
 * @param {string} [opts.source]   来源标记：model | cache | manual
 * @returns {object} 规范化后的行动卡
 */
function normalizeActionCard(raw, opts = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const rawText = clipStr(opts.rawText != null ? opts.rawText : input.rawText, LIMITS.rawText);

  const itemsRaw = Array.isArray(input.items) ? input.items : [];
  let items = itemsRaw
    .slice(0, LIMITS.maxItems + 3) // 多取几个再规范化，丢弃掉无效的之后仍可能凑够 3 条
    .map((it, i) => normalizeItem(it, i))
    .filter(Boolean)
    .slice(0, LIMITS.maxItems);

  // 重排 id，保证连续
  items = items.map((it, i) => Object.assign({}, it, { id: `i${i + 1}` }));

  const risks = (Array.isArray(input.risks) ? input.risks : [])
    .map(normalizeRisk)
    .filter(Boolean)
    .slice(0, LIMITS.maxRisks);

  // 整体置信度：优先用模型自评，缺失时由行动项均值推导
  let confidence;
  if (input.confidence != null) {
    confidence = clipConfidence(input.confidence, 0.6);
  } else if (items.length) {
    confidence = items.reduce((s, it) => s + it.confidence, 0) / items.length;
  } else {
    confidence = 0.2;
  }

  return {
    version: SCHEMA_VERSION,
    title: clipStr(input.title, LIMITS.title) || '这条通知',
    summary: clipStr(input.summary, LIMITS.summary),
    confidence: Math.round(confidence * 1000) / 1000,
    publisher: normalizePublisher(input.publisher),
    items,
    risks,
    rawText,
    degraded: input.degraded === true,
    degradeReason: clipStr(input.degradeReason, 32),
    source: clipStr(opts.source || input.source, 12) || 'model',
    normalizedAt: typeof opts.now === 'number' ? opts.now : Date.now(),
  };
}

/**
 * 契约校验。normalize 已保证结构正确，这里用于断言关键不变量，
 * 并返回可观测的错误列表（用于埋点与回归测试）。
 *
 * @returns {{ok: boolean, errors: string[], card: object}}
 */
function validateActionCard(card) {
  const errors = [];
  if (!isPlainObject(card)) {
    return { ok: false, errors: ['card 不是对象'], card: null };
  }
  if (card.version !== SCHEMA_VERSION) errors.push(`version 应为 ${SCHEMA_VERSION}`);
  if (typeof card.title !== 'string' || !card.title) errors.push('title 缺失');
  if (typeof card.confidence !== 'number' || card.confidence < 0 || card.confidence > 1) {
    errors.push('confidence 越界');
  }
  if (!Array.isArray(card.items)) errors.push('items 不是数组');
  else {
    if (card.items.length > LIMITS.maxItems) errors.push(`items 超过 ${LIMITS.maxItems} 条`);
    card.items.forEach((it, i) => {
      if (!isPlainObject(it)) return errors.push(`items[${i}] 不是对象`);
      if (typeof it.what !== 'string' || !it.what) errors.push(`items[${i}].what 缺失`);
      if (it.deadline && it.deadline.date && !isValidDateStr(it.deadline.date)) {
        errors.push(`items[${i}].deadline.date 非法`);
      }
      if (it.amount && it.amount.value !== null && typeof it.amount.value !== 'number') {
        errors.push(`items[${i}].amount.value 非数字`);
      }
    });
  }
  if (!Array.isArray(card.risks)) errors.push('risks 不是数组');
  card.risks.forEach((r, i) => {
    if (RISK_LEVELS.indexOf(r && r.level) < 0) errors.push(`risks[${i}].level 非法`);
  });
  if (typeof card.degraded !== 'boolean') errors.push('degraded 非布尔');

  return { ok: errors.length === 0, errors, card };
}

/**
 * 构造一张降级卡：不展示任何抽取结果，只把原文交还给用户并允许朗读。
 * 这是"宁可说没看懂，也不给半成品"原则的落地形态。
 */
function buildDegradedCard(rawText, reason, opts = {}) {
  return normalizeActionCard(
    {
      title: '这条我没看懂',
      summary: '请对着原文核对，或打电话问问孩子',
      confidence: 0,
      items: [],
      risks: Array.isArray(opts.risks) ? opts.risks : [],
      degraded: true,
      degradeReason: reason || 'unknown',
    },
    { rawText, source: opts.source || 'fallback', now: opts.now }
  );
}

module.exports = {
  SCHEMA_VERSION,
  LIMITS,
  THRESHOLDS,
  RISK_LEVELS,
  RISK_CODES,
  normalizeActionCard,
  validateActionCard,
  buildDegradedCard,
  // 导出供测试与复用
  clipStr,
  clipConfidence,
  isValidDateStr,
  isValidTimeStr,
};
