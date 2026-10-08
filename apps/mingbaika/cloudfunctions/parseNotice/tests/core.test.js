'use strict';

/**
 * 纯函数内核离线回归测试。
 *
 * 运行方式（不需要微信环境、不需要云开发）：
 *   node apps/mingbaika/cloudfunctions/parseNotice/tests/core.test.js
 *
 * 固定参考日：2026-10-08（周四）。所有日期断言都基于这一天，保证可复现。
 */

const path = require('path');
const core = require(path.join(__dirname, '..', 'core', 'index.js'));
const { makeRef } = core;

// 参考日 2026-10-08（周四）
const REF = makeRef(2026, 10, 8);

// ---------------------------------------------------------------------------
// 迷你断言器
// ---------------------------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];

function t(name, fn) {
  try {
    fn();
    pass++;
    console.log('  \u2713 ' + name);
  } catch (e) {
    fail++;
    failures.push({ name, msg: e.message });
    console.log('  \u2717 ' + name + '\n      ' + e.message);
  }
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg || '值不相等'}\n      期望: ${b}\n      实际: ${a}`);
}
function ok(v, msg) { if (!v) throw new Error(msg || '断言失败'); }
function group(name) { console.log('\n' + name); }

// ---------------------------------------------------------------------------
group('1. 时间解析器 time-parser');
// ---------------------------------------------------------------------------

t('「本周五前」→ 2026-10-09', () => {
  const r = core.parseDeadline('请在1本周五前交费', REF);
  eq(r.date, '2026-10-09');
});

t('「下周一」→ 2026-10-12', () => {
  eq(core.parseDeadline('下周一开学', REF).date, '2026-10-12');
});

t('裸「周五」（尚未到）→ 2026-10-09', () => {
  eq(core.parseDeadline('周五交', REF).date, '2026-10-09');
});

t('裸「周三」（已过）→ 顺延至下周 2026-10-14', () => {
  eq(core.parseDeadline('周三交', REF).date, '2026-10-14');
});

t('「明天」→ 2026-10-09', () => {
  eq(core.parseDeadline('明天上午集合', REF).date, '2026-10-09');
});

t('「后天」→ 2026-10-10', () => {
  eq(core.parseDeadline('后天交费', REF).date, '2026-10-10');
});

t('「10月10日前」→ 2026-10-10', () => {
  const r = core.parseDeadline('请于10月10日前交秋游费', REF);
  eq(r.date, '2026-10-10');
  eq(r.cue, true, '应识别出期限信号词');
});

t('完整日期「2026-10-15」→ 2026-10-15', () => {
  eq(core.parseDeadline('报名截至2026-10-15', REF).date, '2026-10-15');
});

t('中文数字「十月十日」→ 2026-10-10', () => {
  eq(core.parseDeadline('十月十日之前', REF).date, '2026-10-10');
});

t('「月底」→ 2026-10-31', () => {
  eq(core.parseDeadline('月底前完成', REF).date, '2026-10-31');
});

t('时间点「早7:30」→ 07:30', () => {
  const r = core.parseDeadline('10月13日早7:30校门口集合', REF);
  eq(r.date, '2026-10-13');
  eq(r.time, '07:30');
});

t('时间点「下午3点」→ 15:00', () => {
  eq(core.parseDeadline('明天下午3点开会', REF).time, '15:00');
});

t('模糊表述「尽快」→ 无日期且标记 vague', () => {
  const r = core.parseDeadline('请尽快处理', REF);
  eq(r.date, null);
  eq(r.vague, true);
});

t('已过 30 天以上的月日 → 归到明年', () => {
  eq(core.parseDeadline('1月5日截止', REF).date, '2027-01-05');
});

// ---------------------------------------------------------------------------
group('2. Schema 规范化与校验 schema');
// ---------------------------------------------------------------------------

t('超长标题按码点截断并加省略号', () => {
  const s = core.clipStr('一'.repeat(30), 14);
  eq(Array.from(s).length, 15);
  eq(s.endsWith('…'), true);
});

t('非法日期 2026-02-30 判定为无效', () => {
  eq(core.isValidDateStr('2026-02-30'), false);
  eq(core.isValidDateStr('2026-02-28'), true);
  eq(core.isValidDateStr('2026-2-8'), false, '必须补零');
});

t('置信度：1.5 夹到 1，百分数 85 转 0.85', () => {
  eq(core.clipConfidence(1.5), 1);
  eq(core.clipConfidence(85), 0.85);
  eq(core.clipConfidence(-1), 0);
  eq(core.clipConfidence('abc'), 0.5);
});

t('行动项超过 3 条时截断并重排 id', () => {
  const card = core.normalizeActionCard({
    title: 'x',
    items: [1, 2, 3, 4, 5].map((i) => ({ what: '事项' + i, confidence: 0.9 })),
  }, { rawText: '来源文本' });
  eq(card.items.length, 3);
  eq(card.items.map((i) => i.id), ['i1', 'i2', 'i3']);
});

t('非法日期字段被剥离而非原样透传', () => {
  const card = core.normalizeActionCard({
    title: 'x',
    items: [{ what: '交费', deadline: { date: '2026-02-30', text: '2月30日前' } }],
  }, { rawText: '' });
  eq(card.items[0].deadline.date, null);
});

t('没有 what 也没有原文片段的行动项被丢弃', () => {
  const card = core.normalizeActionCard({
    title: 'x',
    items: [{ what: '' }, { what: '有效事项' }],
  }, { rawText: '' });
  eq(card.items.length, 1);
  eq(card.items[0].what, '有效事项');
});

t('契约校验：合法卡通过、非法卡报错', () => {
  const good = core.normalizeActionCard({ title: '通知', confidence: 0.9, items: [{ what: '交费', confidence: 0.9 }] }, { rawText: 'x' });
  eq(core.validateActionCard(good).ok, true);

  const bad = core.validateActionCard({ version: '0.0', title: '', confidence: 5, items: 'nope', risks: [], degraded: 'yes' });
  eq(bad.ok, false);
  ok(bad.errors.length >= 4, '应报出多项错误，实际 ' + bad.errors.length);
});

// ---------------------------------------------------------------------------
group('3. 风险启发式 risk-rules');
// ---------------------------------------------------------------------------

t('催办话术命中 URGENCY_PRESSURE', () => {
  const risks = core.detectRisks('请各位家长今天内完成，逾期影响孩子上课');
  ok(risks.some((r) => r.code === 'URGENCY_PRESSURE'), '未命中催办话术');
});

t('个人收款命中 PERSONAL_PAY，且带证据片段', () => {
  const risks = core.detectRisks('资料费298元，请扫码支付给班长');
  const hit = risks.find((r) => r.code === 'PERSONAL_PAY');
  ok(hit, '未命中个人收款');
  eq(hit.level, 'danger', '个人代收应升级为 danger');
  ok(hit.evidence && hit.evidence.length > 0, '应带原文证据');
});

t('金额异常命中 AMOUNT_ODD', () => {
  const risks = core.detectRisks('本学期教辅资料费298元');
  ok(risks.some((r) => r.code === 'AMOUNT_ODD'), '未命中金额异常');
});

t('正常通知不产生风险', () => {
  eq(core.detectRisks('明天上午9点在学校门口集合，请带好水杯和帽子'), []);
});

t('风险条目最多 3 条且按危险度降序', () => {
  const risks = core.detectRisks('紧急通知：今天内加我微信私聊，学校要求交资料费298元，请扫码支付，逾期影响上课，过期不候');
  ok(risks.length <= 3, '不应超过 3 条');
  if (risks.length > 1) {
    const order = { danger: 0, warn: 1, info: 2 };
    ok(order[risks[0].level] <= order[risks[1].level], '应按危险度降序');
  }
});

// ---------------------------------------------------------------------------
group('4. 降级判定 fallback');
// ---------------------------------------------------------------------------

t('无行动项 → 降级为原文', () => {
  const card = core.normalizeActionCard({ title: 'x', confidence: 0, items: [] }, { rawText: '一段读不懂的话' });
  const d = core.decideFallback(card, { schemaOk: true });
  eq(d.degraded, true);
  eq(d.reason, 'empty');
});

t('整体置信度过低 → 降级', () => {
  const card = core.normalizeActionCard({ title: 'x', confidence: 0.2, items: [{ what: '交费', confidence: 0.3 }] }, { rawText: 'x' });
  eq(core.decideFallback(card, {}).reason, 'lowConfidence');
});

t('有期限信号词却一个日期都没解析出 → 降级', () => {
  const card = core.normalizeActionCard({ title: 'x', confidence: 0.9, items: [{ what: '交费', confidence: 0.9 }] }, { rawText: '请于规定时间前交费' });
  eq(core.decideFallback(card, { deadlineCue: true }).reason, 'deadlineLost');
});

t('降级时保留风险提示（诈骗拦截不因没读懂而消失）', () => {
  const card = core.normalizeActionCard({
    title: 'x', confidence: 0, items: [], risks: [{ level: 'danger', code: 'PERSONAL_PAY', title: '个人收款' }],
  }, { rawText: '扫码给我转钱' });
  const final = core.applyFallback(card, { schemaOk: true });
  eq(final.degraded, true);
  eq(final.risks.length, 1);
  eq(final.risks[0].level, 'danger');
});

// ---------------------------------------------------------------------------
group('5. 端到端管线 pipeline');
// ---------------------------------------------------------------------------

t('场景 A：秋游通知 → 三个行动项，日期全部由本地解析器算出', () => {
  const { card, debug } = core.buildActionCard({
    modelOutput: {
      title: '秋游通知',
      summary: '周五前交钱，周日晚上装包，周一早集合',
      confidence: 0.9,
      publisher: { name: '王老师', evidence: '三年二班王老师', confidence: 0.7 },
      items: [
        {
          what: '交秋游费',
          deadline: { text: '10月10日前', raw: '请于10月10日前交秋游费200元' },
          amount: { value: 200, currency: 'CNY', confidence: 0.95 },
          confidence: 0.9,
        },
        {
          what: '准备雨衣、运动鞋、午餐',
          deadline: { text: '10月12日晚上', raw: '10月12日晚上装好书包' },
          carry: ['雨衣', '运动鞋', '午餐'],
          confidence: 0.85,
        },
        {
          what: '集合出发',
          deadline: { text: '10月13日早7:30', raw: '10月13日早7:30校门口集合' },
          location: '校门口',
          confidence: 0.85,
        },
      ],
    },
    rawText: '各位家长：定于10月13日组织秋游。请于10月10日前交秋游费200元。10月12日晚上装好书包。10月13日早7:30校门口集合。',
    nowMs: Date.UTC(2026, 9, 8, 4, 0, 0),
  });

  eq(debug.schemaOk, true, '契约应通过：' + JSON.stringify(debug.schemaErrors));
  eq(card.degraded, false, '不应降级');
  eq(card.items.length, 3);
  eq(card.items[0].deadline.date, '2026-10-10');
  eq(card.items[0].amount.value, 200);
  eq(card.items[1].carry.length, 3);
  eq(card.items[2].deadline.date, '2026-10-13');
  eq(card.items[2].deadline.time, '07:30');
  eq(card.items[2].location, '校门口');
});

t('场景 B：可疑收费 → 命中风险且不降级', () => {
  const text = '紧急通知：本学期教辅资料费298元，请各位家长今天内扫码支付给班长，逾期影响孩子上课。';
  const { card, debug } = core.buildActionCard({
    modelOutput: {
      title: '缴费通知',
      confidence: 0.88,
      items: [{ what: '交资料费298元', amount: { value: 298, confidence: 0.9 }, confidence: 0.88 }],
    },
    rawText: text,
    nowMs: Date.UTC(2026, 9, 8, 4, 0, 0),
  });

  eq(card.degraded, false, '不应降级');
  ok(card.risks.length >= 2, '应命中多条风险，实际 ' + card.risks.length);
  ok(card.risks.some((r) => r.code === 'URGENCY_PRESSURE'), '缺催办话术');
  ok(card.risks.some((r) => r.code === 'PERSONAL_PAY'), '缺个人收款');
  ok(debug.riskHits.length >= 2);
});

t('场景 C：模型胡言乱语 → 降级为原文而不是展示半成品', () => {
  const { card, debug } = core.buildActionCard({
    modelOutput: { items: [{ what: '' }, { what: null }], confidence: 0.9 },
    rawText: '这是一段没有结构的长通知，模型没能正确处理。',
    nowMs: Date.UTC(2026, 9, 8, 4, 0, 0),
  });
  eq(card.degraded, true);
  ok(debug.degradeReason, '应有降级原因：' + debug.degradeReason);
  eq(card.items.length, 0);
  ok(card.rawText && card.rawText.length > 0, '降级卡必须保留原文');
});

t('模型算错日期时，本地解析器覆盖为正确答案', () => {
  const { card } = core.buildActionCard({
    modelOutput: {
      title: '交费',
      confidence: 0.9,
      items: [{
        what: '交费',
        // 模型声称 2026-11-20，但原文写的是「本周五前」→ 应为 2026-10-09
        deadline: { date: '2026-11-20', text: '本周五前', raw: '请在本周五前交费' },
        confidence: 0.9,
      }],
    },
    rawText: '请在本周五前交费',
    nowMs: Date.UTC(2026, 9, 8, 4, 0, 0),
  });
  eq(card.items[0].deadline.date, '2026-10-09', '本地解析器应覆盖模型的错误日期');
});

// ---------------------------------------------------------------------------
console.log('\n' + '-'.repeat(56));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('\n失败明细：');
  failures.forEach((f) => console.log('  - ' + f.name + '\n      ' + f.msg));
  process.exit(1);
} else {
  console.log('全部通过 ✅');
}
