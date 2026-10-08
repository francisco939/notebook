'use strict';

/**
 * 降级判定：决定"这张卡能不能给用户看"。
 *
 * 产品原则：抽取不准的金额或日期，比不抽取更糟。因此只要证据不足，
 * 就整卡降级为「原文 + 语音朗读」，而不是展示一个可能有错的结论。
 *
 * 降级触发条件（满足任意一条）：
 *   1. 展示内容为空：没有 title 且没有 items
 *   2. 有行动项，但整体置信度低于阈值
 *   3. 有行动项，但全部行动项置信度都低于阈值
 *   4. 存在"疑似期限"信号却完全没解析出日期（说明模型与解析器都没把握）
 *
 * 纯函数模块，可在 Node 中直接单测。
 */

const { THRESHOLDS, buildDegradedCard } = require('./schema');

const DEGRADE_REASONS = {
  EMPTY: 'empty',                 // 没有产出任何可展示内容
  LOW_CONFIDENCE: 'lowConfidence',
  ALL_ITEMS_WEAK: 'allItemsWeak',
  DEADLINE_LOST: 'deadlineLost',
  SCHEMA_INVALID: 'schemaInvalid',
  MODEL_FAILED: 'modelFailed',
  IMAGE_ONLY: 'imageOnly',        // 图片内容未能转成文字，只能回退
};

/**
 * @param {object} card   已规范化的行动卡
 * @param {object} [opts]
 * @param {boolean} [opts.schemaOk=true] 契约校验是否通过
 * @param {boolean} [opts.deadlineCue=false] 原文是否含"期限"信号词
 * @returns {{degraded: boolean, reason: string|null}}
 */
function decideFallback(card, opts = {}) {
  const schemaOk = opts.schemaOk !== false;

  if (!schemaOk) return { degraded: true, reason: DEGRADE_REASONS.SCHEMA_INVALID };
  if (!card || typeof card !== 'object') return { degraded: true, reason: DEGRADE_REASONS.EMPTY };

  const items = Array.isArray(card.items) ? card.items : [];
  if (!items.length) {
    // 没有任何行动项：如果连原文都没有，那这张卡完全无意义
    if (!card.rawText) return { degraded: true, reason: DEGRADE_REASONS.EMPTY };
    return { degraded: true, reason: DEGRADE_REASONS.EMPTY };
  }

  if (card.confidence < THRESHOLDS.cardDegrade) {
    return { degraded: true, reason: DEGRADE_REASONS.LOW_CONFIDENCE };
  }

  if (items.every((it) => it.confidence < THRESHOLDS.fieldLowConfidence)) {
    return { degraded: true, reason: DEGRADE_REASONS.ALL_ITEMS_WEAK };
  }

  // 原文明显在说一个期限，但一个日期都没解析出来 → 不敢给结论
  if (opts.deadlineCue) {
    const anyDate = items.some((it) => it.deadline && it.deadline.date);
    if (!anyDate) return { degraded: true, reason: DEGRADE_REASONS.DEADLINE_LOST };
  }

  return { degraded: false, reason: null };
}

/**
 * 把判定结果应用到卡片上，必要时返回降级卡。
 *
 * @returns {object} 最终要下发给前端的卡片
 */
function applyFallback(card, opts = {}) {
  const { degraded, reason } = decideFallback(card, opts);
  if (!degraded) return card;

  const final = buildDegradedCard(card && card.rawText, reason, {
    risks: card && card.risks,
    source: (card && card.source) || 'fallback',
    now: opts.now,
  });
  // 保留风险提示——诈骗拦截不应该因为"没读懂"就消失
  if (card && Array.isArray(card.risks) && card.risks.length) {
    final.risks = card.risks;
  }
  // 保留标题线索，帮助用户确认"是不是这条"
  if (card && card.title && card.title !== '这条通知') final.title = card.title;
  return final;
}

module.exports = {
  decideFallback,
  applyFallback,
  DEGRADE_REASONS,
};
