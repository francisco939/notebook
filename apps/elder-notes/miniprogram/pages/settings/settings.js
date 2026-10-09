'use strict';

var store = require('../../utils/store.js');

var app = getApp();

Page({
  data: {
    scaleClass: 'scale-large',
    scale: 'large',
    author: ''
  },

  onLoad: function () {
    var scale = (app && app.globalData && app.globalData.scale) || 'large';
    this.setData({
      scale: scale,
      scaleClass: 'scale-' + scale,
      author: store.getAuthor() || ''
    });
  },

  pickScale: function (e) {
    var s = e.currentTarget.dataset.s;
    if (!s) return;
    if (app && typeof app.setScale === 'function') app.setScale(s);

    this.setData({ scale: s, scaleClass: 'scale-' + s });
    wx.vibrateShort({ type: 'light', fail: function () {} }); // 触感确认 [S22]
    wx.showToast({ title: '字改好了', icon: 'none', duration: 1200 });
  },

  onAuthor: function (e) {
    this.setData({ author: e.detail.value || '' });
  },

  /** 失焦即保存。不要求点"保存"按钮——少一步操作，也少一个可能点不中的热区。 */
  saveAuthor: function () {
    var name = (this.data.author || '').trim();
    store.setAuthor(name);
    if (name) {
      wx.showToast({ title: '记住了', icon: 'none', duration: 1200 });
    }
  }
});
