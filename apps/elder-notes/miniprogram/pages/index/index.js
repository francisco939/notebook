'use strict';

var store = require('../../utils/store.js');
var quest = require('../../utils/quest.js');

var app = getApp();
var UNDO_MS = 10000; // 撤销条停留 10 秒 [S2] 充足操作时间

var STATUS_TOAST = { done: '完成了', skipped: '已跳过', todo: '撤回了' };

/** 取正文"首行之后"的部分作为描述，避免和标题重复显示 */
function restOf(content) {
  if (!content) return '';
  var lines = String(content).trim().split('\n');
  if (lines.length <= 1) return '';
  return lines.slice(1).join('\n').trim();
}

/**
 * 把一条 note 变成卡片要显示的形状。
 * 老数据没有 title / status / author，这里一律给兜底值，不报错。
 */
function decorate(note) {
  var hasTitle = !!note.title;
  return {
    id: note.id,
    title: quest.titleOf(note),
    desc: hasTitle ? (note.content || '') : restOf(note.content),
    author: note.author || '',
    status: quest.statusOf(note)
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
    keyword: '',
    strip: [],
    levels: [],
    filterKey: '',
    filterLabel: '',
    undoTitle: ''
  },

  onLoad: function () {
    var scale = (app && app.globalData && app.globalData.scale) || 'large';
    this.setData({ scaleClass: 'scale-' + scale });
  },

  onShow: function () {
    var scale = (app && app.globalData && app.globalData.scale) || 'large';
    this.setData({ scaleClass: 'scale-' + scale });

    // 从详情页删完回来，这里接住撤销信号
    var pending = (app && app.globalData && app.globalData.pendingUndoId) || '';
    if (pending) {
      var n = store.getNote(pending);
      app.globalData.pendingUndoId = '';
      this.showUndo(n ? quest.titleOf(n) : '这条');
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
    var filterKey = this.data.filterKey || '';
    var now = Date.now();

    var all = store.list();
    if (kw) {
      all = all.filter(function (n) {
        return looseMatch((n.title || '') + (n.content || '') + ' ' + (n.author || ''), kw);
      });
    }

    var levels = quest.buildLevels(all, now);

    // 进度条：完成 + 跳过都算"已处理"
    levels.forEach(function (lv) {
      var handled = lv.done + lv.skipped;
      lv.pct = lv.total ? Math.round(handled / lv.total * 100) : 0;
      var items = lv.items.map(decorate);
      lv.items = items;
    });

    var strip = quest.calendarStrip(now, 3, 10, levels.map(function (l) { return l.key; }));

    var shown = levels;
    var filterLabel = '';
    if (filterKey) {
      shown = levels.filter(function (l) { return l.key === filterKey; });
      if (shown.length) {
        var lb = shown[0].label;
        filterLabel = lb.md + (lb.rel ? '（' + lb.rel + '）' : '');
      }
    }

    this.setData({ levels: shown, strip: strip, filterLabel: filterLabel });
  },

  onSearch: function (e) {
    this.setData({ keyword: e.detail.value || '' });
    this.refresh();
  },

  clearSearch: function () {
    this.setData({ keyword: '' });
    this.refresh();
  },

  /** 点日历条：只看那一天；再点同一天 → 回到全部 */
  pickDay: function (e) {
    var k = e.currentTarget.dataset.k;
    if (!k) return;
    var next = (this.data.filterKey === k) ? '' : k;
    this.setData({ filterKey: next });
    wx.vibrateShort({ type: 'light', fail: function () {} });
    this.refresh();
  },

  clearDay: function () {
    this.setData({ filterKey: '' });
    this.refresh();
  },

  /** 完成 / 跳过 / 撤销。用 catchtap 调用，不会冒泡到卡片打开详情。 */
  setStatus: function (e) {
    var id = e.currentTarget.dataset.id;
    var s = e.currentTarget.dataset.s;
    if (!id || !s) return;

    store.setStatus(id, s);
    wx.vibrateShort({ type: 'light', fail: function () {} });
    wx.showToast({ title: STATUS_TOAST[s] || '好了', icon: 'none', duration: 900 });
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
    wx.vibrateShort({ type: 'light', fail: function () {} });
    wx.showToast({ title: '找回来了', icon: 'none', duration: 1500 });
    this.refresh();
  }
});
