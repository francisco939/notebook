'use strict';

var store = require('../../utils/store.js');
var time = require('../../utils/time.js');

var app = getApp();

Page({
  data: {
    scaleClass: 'scale-large',
    isEdit: false,
    id: '',
    content: '',
    rawTime: '',
    parsedText: '',
    showUnparsed: false
  },

  onLoad: function (options) {
    var scale = (app && app.globalData && app.globalData.scale) || 'large';
    var id = (options && options.id) || '';

    if (id) {
      var n = store.getNote(id);
      if (n) {
        this.setData({
          scaleClass: 'scale-' + scale,
          isEdit: true,
          id: id,
          content: n.content || '',
          rawTime: n.rawTime || ''
        });
        this.updateParsedHint(n.rawTime || '');
        return;
      }
      // id 找不到（数据被清了）→ 退化成新建，不报错给老人看
    }

    this.setData({ scaleClass: 'scale-' + scale });
  },

  onContent: function (e) {
    this.setData({ content: e.detail.value || '' });
  },

  onWhen: function (e) {
    var v = e.detail.value || '';
    this.setData({ rawTime: v });
    this.updateParsedHint(v);
  },

  /** 实时反馈：让老人当场知道"看懂了没有" [S12] */
  updateParsedHint: function (text) {
    if (!text.trim()) {
      this.setData({ parsedText: '', showUnparsed: false });
      return;
    }
    var r = time.parseWhen(text);
    if (r.dueAt) {
      this.setData({
        parsedText: time.display(r.dueAt, r.hasTime),
        showUnparsed: false
      });
    } else {
      this.setData({ parsedText: '', showUnparsed: true });
    }
  },

  pickQuick: function (e) {
    var w = e.currentTarget.dataset.w;
    this.setData({ rawTime: w });
    this.updateParsedHint(w);
    wx.vibrateShort({ type: 'light', fail: function () {} });
  },

  save: function () {
    var content = (this.data.content || '').trim();

    // 空内容不拦着写库，但要明确告诉老人发生了什么 [S12]
    if (!content) {
      wx.showToast({ title: '还没写内容呢', icon: 'none', duration: 2000 });
      return;
    }

    var when = time.parseWhen(this.data.rawTime);

    if (this.data.isEdit && this.data.id) {
      store.update(this.data.id, {
        content: content,
        rawTime: when.rawTime,
        hasTime: when.hasTime,
        dueAt: when.dueAt
      });
    } else {
      store.add(content, when);
    }

    wx.vibrateShort({ type: 'light', fail: function () {} }); // 触感确认 [S22]
    wx.showToast({
      title: this.data.isEdit ? '改好了' : '记好了',
      icon: 'none',
      duration: 1200
    });

    var self = this;
    setTimeout(function () {
      wx.navigateBack({
        fail: function () {
          wx.redirectTo({ url: '/pages/index/index' });
        }
      });
    }, 600);
  }
});
