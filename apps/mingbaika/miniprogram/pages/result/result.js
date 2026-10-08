'use strict';

var store = require('../../utils/store.js');
var tts = require('../../utils/tts.js');
var app = getApp();

Page({
  data: {
    card: null,
    dangers: [],     // level === 'danger' 的风险，交给顶部拦截条
    notFound: false,
  },

  onLoad: function (options) {
    var id = (options && options.id) ? decodeURIComponent(options.id) : '';
    var card = null;
    if (id) {
      var rec = store.getCard(id);
      card = rec ? rec.card : null;
    }
    if (!card) {
      this.setData({ notFound: true });
      return;
    }
    var dangers = (card.risks || []).filter(function (r) {
      return r.level === 'danger';
    });
    this.setData({ card: card, dangers: dangers });
  },

  // 读给我听
  onSpeak: function () {
    tts.speak(this.data.card);
  },

  // 一键拨号（底部常驻）
  onCall: function () {
    var phone = app.globalData.contactPhone;
    if (!phone) {
      wx.showToast({ title: '还没设置电话号码', icon: 'none' });
      return;
    }
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: function () {},  // 用户取消，不提示
    });
  },

  onBackHome: function () {
    wx.redirectTo({ url: '/pages/index/index' });
  },

  onOpenHistory: function () {
    wx.navigateTo({ url: '/pages/history/history' });
  },
});
