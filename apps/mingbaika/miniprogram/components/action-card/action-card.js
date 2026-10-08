'use strict';

var format = require('../../utils/format.js');

// 字段低置信度阈值：低于此值并列展示原文供老人核对
var LOW_CONF = 0.7;

Component({
  properties: {
    // 行动卡 JSON（契约见 cloudfunctions/parseNotice/core/schema.js）
    card: {
      type: Object,
      value: null,
      observer: 'buildView',
    },
  },

  data: {
    view: null,
  },

  methods: {
    /**
     * card 变化时，预计算所有需要展示的字段（含中文化格式与低置信度标记），
     * 避免在 WXML 里做复杂运算。
     */
    buildView: function (card) {
      if (!card || typeof card !== 'object') {
        this.setData({ view: null });
        return;
      }

      // 降级卡：只展示原文 + 提示
      if (card.degraded) {
        this.setData({
          view: {
            degraded: true,
            title: card.title || '这条我没看懂',
            summary: card.summary || '请对着原文核对，或打电话问问孩子',
            rawText: card.rawText || '',
          },
        });
        return;
      }

      var self = this;
      var items = (card.items || []).map(function (it) {
        var dlText = it.deadline ? format.formatDeadlineCN(it.deadline) : '';
        var dlLow = !!(it.deadline && typeof it.deadline.confidence === 'number'
          && it.deadline.confidence < LOW_CONF && it.deadline.raw);
        var amountText = (it.amount && typeof it.amount.value === 'number')
          ? format.formatAmountCN(it.amount) : '';
        var amountLow = !!(it.amount && typeof it.amount.value === 'number'
          && typeof it.amount.confidence === 'number' && it.amount.confidence < LOW_CONF && it.amount.raw);
        var carryText = (Array.isArray(it.carry) && it.carry.length) ? it.carry.join('、') : '';
        return {
          what: it.what || '',
          dlText: dlText,
          dlRaw: dlLow ? it.deadline.raw : '',
          amountText: amountText,
          amountRaw: amountLow ? it.amount.raw : '',
          location: it.location || '',
          carryText: carryText,
          note: it.note || '',
        };
      });

      // 风险提示：info / warn 在卡内展示；danger 由父页面顶部拦截条负责
      var risks = (card.risks || [])
        .filter(function (r) { return r.level === 'info' || r.level === 'warn'; })
        .map(function (r) {
          return { level: r.level, title: r.title || '', evidence: r.evidence || '' };
        });

      this.setData({
        view: {
          degraded: false,
          title: card.title || '这条通知',
          summary: card.summary || '',
          publisher: (card.publisher && card.publisher.name) ? card.publisher.name : '',
          items: items,
          risks: risks,
        },
      });
    },
  },
});
