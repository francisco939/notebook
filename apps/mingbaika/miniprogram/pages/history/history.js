'use strict';

var store = require('../../utils/store.js');

Page({
  data: {
    list: [],
  },

  onShow: function () {
    this.refresh();
  },

  refresh: function () {
    var records = store.listCards();
    var list = records.map(function (rec) {
      var card = rec.card || {};
      var d = new Date(rec.createdAt);
      var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      var time = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      var danger = (card.risks || []).some(function (r) { return r.level === 'danger'; });
      return {
        id: rec.id,
        title: card.title || '这条通知',
        summary: card.summary || (card.degraded ? '（没看懂，已给原文）' : ''),
        time: time,
        danger: danger,
      };
    });
    this.setData({ list: list });
  },

  onTapItem: function (e) {
    var id = e.currentTarget.dataset.id;
    wx.redirectTo({ url: '/pages/result/result?id=' + encodeURIComponent(id) });
  },

  onClear: function () {
    var self = this;
    wx.showModal({
      title: '清空历史',
      content: '确定要删除全部历史记录吗？',
      success: function (res) {
        if (res.confirm) {
          store.clearAll();
          self.refresh();
        }
      },
    });
  },

  onBackHome: function () {
    wx.redirectTo({ url: '/pages/index/index' });
  },
});
