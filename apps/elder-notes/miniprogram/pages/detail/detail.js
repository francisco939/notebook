'use strict';

var store = require('../../utils/store.js');
var time = require('../../utils/time.js');

var app = getApp();

Page({
  data: {
    scaleClass: 'scale-large',
    id: '',
    content: '',
    timeText: '',
    overdue: false
  },

  onLoad: function (options) {
    var scale = (app && app.globalData && app.globalData.scale) || 'large';
    var id = (options && options.id) || '';
    var n = id ? store.getNote(id) : null;

    if (!n) {
      // 找不到（数据被清了）→ 明确说清楚，然后把人送回首页 [S12]
      wx.showToast({ title: '这条找不到了', icon: 'none', duration: 2000 });
      setTimeout(function () { wx.navigateBack(); }, 800);
      return;
    }

    this.setData({
      scaleClass: 'scale-' + scale,
      id: id,
      content: n.content || '(没写内容)',
      timeText: n.dueAt ? time.display(n.dueAt, n.hasTime) : (n.rawTime || ''),
      overdue: time.isOverdue(n.dueAt)
    });
  },

  goEdit: function () {
    wx.navigateTo({ url: '/pages/edit/edit?id=' + this.data.id });
  },

  /**
   * 删除：不弹确认框。
   * 依据 [S9][S10][S22]——可撤销的操作不该用确认框打断；
   * 撤销入口放在首页底部，停留 10 秒 [S2] 充足操作时间。
   */
  doDelete: function () {
    var id = this.data.id;
    if (!id) return;
    store.softDelete(id);

    if (app && app.globalData) {
      app.globalData.lastDeletedId = id;
      app.globalData.pendingUndoId = id;
    }

    wx.vibrateShort({ type: 'light', fail: function () {} });
    wx.navigateBack({
      fail: function () { wx.redirectTo({ url: '/pages/index/index' }); }
    });
  }
});
