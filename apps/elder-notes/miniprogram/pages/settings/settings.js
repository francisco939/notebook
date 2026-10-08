'use strict';

var app = getApp();

Page({
  data: {
    scaleClass: 'scale-large',
    scale: 'large'
  },

  onLoad: function () {
    var scale = (app && app.globalData && app.globalData.scale) || 'large';
    this.setData({ scale: scale, scaleClass: 'scale-' + scale });
  },

  pickScale: function (e) {
    var s = e.currentTarget.dataset.s;
    if (!s) return;
    if (app && typeof app.setScale === 'function') app.setScale(s);

    this.setData({ scale: s, scaleClass: 'scale-' + s });
    wx.vibrateShort({ type: 'light', fail: function () {} }); // 触感确认 [S22]
    wx.showToast({ title: '字改好了', icon: 'none', duration: 1200 });
  }
});
