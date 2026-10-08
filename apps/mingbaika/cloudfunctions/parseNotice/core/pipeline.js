'use strict';

/**
 * 解构管线：把模型输出 → 最终可下发的行动卡。
 *
 * 这是纯函数链路，不依赖 wx.* / cloud.*，因此可以在 Node 中完整回归。
 * 云函数只负责"取图 + 调模型 + 调本管线 + 落库"。
 *
 * 链路：
 *   模型原始输出
 *     → normalizeActionCard   结构规范化（截断/夹值/丢弃非法）
 *     → validateActionCard    契约断言
 *     → 重算期限              用本地解析器覆盖模型算的日期（模型算日期不可靠）
 *     → detectRisks           风险启发式
 *     → applyFallback         证据不足则降级为原文
 *     → 最终卡片
 */

const {
  normalizeActionCard,
  validateActionCard,
  clipConfidence,
  THRESHOLDS,
} = require('./schema');
const { parseDeadline, makeRef, refFromBeijingNow, DEADLINE_CUES } = require('./time-parser');
const { detectRisks } = require('./risk-rules');
const { applyFallback } = require('./fallback');

/**
 * 重算某个行动项的期限。
 *
 * 策略（顺序即优先级）：
 *   1. 本地解析器在原文片段上解析成功 → 采纳本地结果（确定性、可测）
 *   2. 本地失败但模型给出了合法日期 → 采纳模型结果，但置信度打折
 *   3. 都不行 → 置空，让前端走"展示原文核对"路径
 */
function recomputeDeadline(item, ref, fallbackText) {
  const dl = item.deadline || null;
  const source = (dl && (dl.raw || dl.text)) || item.raw || fallbackText || '';
  const local = parseDeadline(source, ref);

  const modelDate = dl && dl.date && parseDeadline(dl.date, ref).date ? dl.date : null;

  if (local.date) {
    return {
      text: (dl && dl.text) || local.matched || null,
      date: local.date,
      rangeEnd: (dl && dl.rangeEnd) || null,
      time: local.time || (dl && dl.time) || null,
      confidence: Math.max(local.confidence, 0.6),
      raw: (dl && dl.raw) || local.matched || null,
    };
  }

  if (modelDate) {
    return {
      text: (dl && dl.text) || null,
      date: modelDate,
      rangeEnd: (dl && dl.rangeEnd) || null,
      time: (dl && dl.time) || null,
      // 本地无法复算 → 对模型给的日期不信任，压到低置信度，前端会并列展示原文
      confidence: Math.min(clipConfidence(dl.confidence, 0.5), THRESHOLDS.fieldLowConfidence - 0.05),
      raw: (dl && dl.raw) || null,
    };
  }

  if (!dl) return null;
  return {
    text: dl.text || null,
    date: null,
    rangeEnd: null,
    time: dl.time || null,
    confidence: 0.25,
    raw: dl.raw || null,
  };
}

/**
 * 主入口。
 *
 * @param {object} params
 * @param {object} params.modelOutput  模型返回的原始对象（未经校验）
 * @param {string} [params.rawText]    模型识别到的原文；缺省时用 modelOutput.rawText
 * @param {number} [params.nowMs]      当前时间戳（毫秒）；缺省 Date.now()
 * @param {Date}   [params.ref]        参考日；缺省由 nowMs 按北京时间推导
 * @param {string} [params.source]     来源标记
 * @returns {{card: object, debug: object}}
 */
function buildActionCard(params = {}) {
  const modelOutput = params.modelOutput && typeof params.modelOutput === 'object'
    ? params.modelOutput
    : {};
  const nowMs = typeof params.nowMs === 'number' ? params.nowMs : Date.now();
  const ref = params.ref || refFromBeijingNow(nowMs);

  // 模型识别到的原文：优先显式传入，其次模型自报
  const rawText = params.rawText != null ? params.rawText : modelOutput.rawText;

  // 1) 规范化 + 2) 校验
  let card = normalizeActionCard(modelOutput, {
    rawText,
    source: params.source || 'model',
    now: nowMs,
  });
  const validation = validateActionCard(card);

  // 3) 重算期限
  card.items = card.items.map((it) => Object.assign({}, it, {
    deadline: recomputeDeadline(it, ref, rawText),
  }));

  // 4) 风险启发式（同时看原文与结构特征）
  const textForRisk = typeof rawText === 'string' && rawText ? rawText : '';
  const hasAmount = card.items.some((it) => it.amount && it.amount.value !== null);
  const detected = detectRisks(textForRisk, { hasAmount });
  if (detected.length) {
    // 模型自报的风险与规则命中的合并去重，规则优先（可复现）
    const byCode = new Map();
    detected.forEach((r) => byCode.set(r.code, r));
    card.risks.forEach((r) => {
      if (!byCode.has(r.code)) byCode.set(r.code, r);
    });
    card.risks = Array.from(byCode.values()).slice(0, 3);
  }

  // 5) 降级判定
  const deadlineCue = typeof textForRisk === 'string' && DEADLINE_CUES.test(textForRisk);
  const finalCard = applyFallback(card, {
    schemaOk: validation.ok,
    deadlineCue,
    now: nowMs,
  });

  return {
    card: finalCard,
    debug: {
      schemaOk: validation.ok,
      schemaErrors: validation.errors,
      riskHits: detected.map((r) => r.code),
      itemCount: finalCard.items.length,
      degraded: finalCard.degraded,
      degradeReason: finalCard.degradeReason || null,
    },
  };
}

module.exports = {
  buildActionCard,
  recomputeDeadline,
  makeRef,
  refFromBeijingNow,
};
