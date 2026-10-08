'use strict';

var store = require('../../utils/store.js');
var time = require('../../utils/time.js');

var app = getApp();
var UNDO_MS = 10000; // 撤销条停留 10 秒 [S2] 充足操作时间

/** 取正文首行作为列表标题（老人看的是第一行） */
function titleOf(note) {
  var c = (note.content || '').trim();
  if (!c) return '(没写内容)';
  var line = c.split('\n')[0].trim();
  return line.length > 30 ? line.slice(0, 30) + '…' : line;
}

function decorate(note) {
  return {
    id: note.id,
    title: titleOf(note),
    timeText: note.dueAt ? time.display(note.dueAt, note.hasTime) : (note.rawTime || ''),
    overdue: time.isOverdue(note.dueAt)
  };
}

/** 宽容匹配：忽略空格与标点，只要字符都出现就算命中 [S6] 老人容易打错字 */
function looseMatch(text, keyword) {
  if (!keyword) return true;
  var t = String(text || '').replace(/[\s，。、；：！？,.!?:;"'（）()【】]/g, '');
  var k = String(keyword).replace(/[\s，。、；：！？,.!?:;"'（）()【】]/g, '');
  if (!k) return true;
  for (var i = 0; i < k.length; i++) {
    if (t.indexOf(k[i]) < 0) return false;
  }
  return true;
}

Page({
  data: {
    scaleClass: 'scale-large',
    showScaleTip: false,
    keyword: '',
    todayList: [],
    otherList: [],
    undoTitle: ''
  },

  onLoad: function () {
    var scale = (app && app.globalData && app.globalData.scale) || 'large';
    this.setData({
      scaleClass: 'scale-' + scale,
      showScaleTip: !(app && app.globalData && app.globalData.scaleConfirmed)
    });
  },

  onShow: function () {
    var scale = (app && app.globalData && app.globalData.scale) || 'large';
    this.setData({ scaleClass: 'scale-' + scale });

    // 从详情页删完回来，这里接住撤销信号
    var pending = (app && app.globalData && app.globalData.pendingUndoId) || '';
    if (pending) {
      var n = store.getNote(pending);
      app.globalData.pendingUndoId = '';
      this.showUndo(n ? titleOf(n) : '这条');
    } else {
      this.setData({ undoTitle: '' });
    }

    store.purgeDeleted();
    this.refresh();
  },

  onUnload: function () {
    if (this._undoTimer) clearTimeout(this._undoTimer);
  },

  refresh: function () {
    var kw = this.data.keyword || '';
    var all = store.list();
    var today = [], other = [];

    all.forEach(function (n) {
      var item = decorate(n);
      if (kw && !looseMatch(n.content + ' ' + (n.rawTime || ''), kw)) return;
      if (time.isDueToday(n.dueAt)) today.push(item);
      else other.push(item);
    });

    this.setData({ todayList: today, otherList: other });
  },

  onSearch: function (e) {
    this.setData({ keyword: e.detail.value || '' });
    this.refresh();
  },

  clearSearch: function () {
    this.setData({ keyword: '' });
    this.refresh();
  },

  openDetail: function (e) {
    var id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },

  goEdit: function () {
    wx.navigateTo({ url: '/pages/edit/edit' });
  },

  goSettings: function () {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  showUndo: function (title) {
    var self = this;
    if (this._undoTimer) clearTimeout(this._undoTimer);
    this.setData({ undoTitle: title });
    this._undoTimer = setTimeout(function () {
      self.setData({ undoTitle: '' });
    }, UNDO_MS);
  },

  undoDelete: function () {
    var id = (app && app.globalData && app.globalData.lastDeletedId) || '';
    if (id) store.restore(id);
    if (this._undoTimer) clearTimeout(this._undoTimer);
    this.setData({ undoTitle: '' });
    wx.vibrateShort({ type: 'light', fail: function () {} }); // 触感确认 [S22]
    wx.showToast({ title: '找回来了', icon: 'none', duration: 1500 });
    this.refresh();
  }
});
