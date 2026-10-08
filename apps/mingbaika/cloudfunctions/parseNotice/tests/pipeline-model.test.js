'use strict';

/**
 * 「模型原始文本 → 行动卡」这一段链路的回归测试。
 *
 * 覆盖的是真机上最容易出问题的地方：模型不老实输出 JSON。
 * 这一段不依赖云环境，可以离线跑。
 *
 * 运行：node apps/mingbaika/cloudfunctions/parseNotice/tests/pipeline-model.test.js
 */

const path = require('path');
const core = require(path.join(__dirname, '..', 'core', 'index.js'));
const { extractJson, buildActionCard } = core;

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log('  \u2713 ' + name); }
  catch (e) { fail++; failures.push({ name, msg: e.message }); console.log('  \u2717 ' + name + '\n      ' + e.message); }
}
function eq(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${m || '值不相等'}\n      期望: ${y}\n      实际: ${x}`); }
function ok(v, m) { if (!v) throw new Error(m || '断言失败'); }
function group(n) { console.log('\n' + n); }

const NOW = Date.UTC(2026, 9, 8, 4, 0, 0); // 2026-10-08 12:00 北京时间

// ---------------------------------------------------------------------------
group('1. 从模型自由文本中抽 JSON json-extract');
// ---------------------------------------------------------------------------

t('裸 JSON 直接解析', () => {
  eq(extractJson('{"a":1}'), { a: 1 });
});

t('带 markdown 代码块围栏', () => {
  eq(extractJson('```json\n{"a":1}\n```'), { a: 1 });
});

t('带围栏但没写语言标记', () => {
  eq(extractJson('```\n{"a":1}\n```'), { a: 1 });
});

t('前后有解释文字', () => {
  const s = '好的，我来分析这条通知。\n{"a":1,"b":[2,3]}\n以上是我的分析。';
  eq(extractJson(s), { a: 1, b: [2, 3] });
});

t('尾随逗号可被修复', () => {
  eq(extractJson('{"a":1,"b":2,}'), { a: 1, b: 2 });
});

t('中文引号可被修复', () => {
  eq(extractJson('{\u201ca\u201d:1}'), { a: 1 });
});

t('完全不是 JSON → null（触发降级）', () => {
  eq(extractJson('抱歉，我无法理解这张图片的内容。'), null);
  eq(extractJson(''), null);
  eq(extractJson(null), null);
});

t('JSON 数组原样返回（由上层决定是否可用）', () => {
  eq(extractJson('[1,2,3]'), [1, 2, 3]);
});

// ---------------------------------------------------------------------------
group('2. 模型文本 → 行动卡（端到端）');
// ---------------------------------------------------------------------------

/** 模拟一次真实的模型返回：带围栏 + 一点解释。 */
const MODEL_TEXT = '好的，我读到了这条通知。\n```json\n' + JSON.stringify({
  title: '秋游通知',
  summary: '周五前交钱，周日晚上装包，周一早上校门口集合',
  confidence: 0.91,
  publisher: { name: '王老师', evidence: '三年二班王老师', confidence: 0.72 },
  items: [
    {
      what: '交秋游费',
      deadline: { text: '10月10日前', date: null, confidence: 0.9, raw: '请于10月10日前交秋游费200元' },
      amount: { value: 200, currency: 'CNY', confidence: 0.95, raw: '交秋游费200元' },
      carry: [],
      location: null,
      note: null,
      confidence: 0.9,
      raw: '请于10月10日前交秋游费200元',
    },
    {
      what: '准备雨衣、运动鞋和午餐',
      deadline: { text: '10月12日晚上', date: null, confidence: 0.8, raw: '10月12日晚上装好书包' },
      amount: null,
      carry: ['雨衣', '运动鞋', '午餐'],
      location: null,
      note: '装进书包',
      confidence: 0.85,
      raw: '10月12日晚上装好书包',
    },
    {
      what: '集合出发',
      deadline: { text: '10月13日早7:30', date: null, confidence: 0.9, raw: '10月13日早7:30校门口集合' },
      amount: null,
      carry: [],
      location: '校门口',
      note: null,
      confidence: 0.88,
      raw: '10月13日早7:30校门口集合',
    },
  ],
  risks: [],
  rawText: '各位家长：定于10月13日组织秋游。请于10月10日前交秋游费200元。10月12日晚上装好书包。10月13日早7:30校门口集合。',
}, null, 2) + '\n```';

t('带围栏的模型输出能被完整解析成卡片', () => {
  const parsed = extractJson(MODEL_TEXT);
  ok(parsed, 'JSON 抽取失败');
  const { card, debug } = buildActionCard({ modelOutput: parsed, nowMs: NOW });

  eq(debug.schemaOk, true, '契约校验失败：' + JSON.stringify(debug.schemaErrors));
  eq(card.degraded, false, '不应降级');
  eq(card.title, '秋游通知');
  eq(card.items.length, 3);
  eq(card.items[0].deadline.date, '2026-10-10', '日期应由本地解析器算出');
  eq(card.items[0].amount.value, 200);
  eq(card.items[1].carry, ['雨衣', '运动鞋', '午餐']);
  eq(card.items[2].deadline.time, '07:30');
  eq(card.publisher.name, '王老师');
});

t('模型没说清日期时，本地解析器从 raw 里补出来', () => {
  const parsed = extractJson(MODEL_TEXT);
  // 模型把所有 date 都填了 null，逻辑上我们仍然要能算出日期
  ok(parsed.items.every((it) => it.deadline.date === null), '前置条件：模型未给日期');
  const { card } = buildActionCard({ modelOutput: parsed, nowMs: NOW });
  ok(card.items.every((it) => it.deadline.date), '每条都应有解析出的日期');
});

t('模型返回垃圾 → 降级卡，且保留原文供核对', () => {
  const parsed = extractJson('抱歉，这张图片我看不清，无法识别内容。');
  eq(parsed, null);
  // index.js 在这个分支会构造降级卡
  const card = core.buildDegradedCard('原始通知文本占位', 'modelFailed', { now: NOW });
  eq(card.degraded, true);
  eq(card.items.length, 0);
  eq(card.degradeReason, 'modelFailed');
  ok(card.rawText.length > 0, '降级卡必须带原文');
});

t('图片场景：模型自报的 rawText 被保留（降级时唯一的原文来源）', () => {
  const parsed = {
    title: '看不清',
    items: [],
    confidence: 0.1,
    rawText: '图片中识别到的文字：明天下午三点开会。',
  };
  const { card } = buildActionCard({ modelOutput: parsed, rawText: null, nowMs: NOW });
  eq(card.degraded, true);
  eq(card.rawText, '图片中识别到的文字：明天下午三点开会。');
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
