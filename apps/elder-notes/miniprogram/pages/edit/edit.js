'use strict';

var store = require('../../utils/store.js');
var time = require('../../utils/time.js');

var app = getApp();

Page({
  data: {
    scaleClass: 'scale-large',
    isEdit: false,
    id: '',
    title: '',
    content: '',
    rawTime: '',
    author: '',
    parsedText: '',
    showUnparsed: false
  },

  onLoad: function (options) {
    var scale = (app && app.globalData && app.globalData.scale) || 'large';
    var id = (options && options.id) || '';
    // 添加人：自动带入上次用过的名字，省掉每次重打
    var author = store.getAuthor() || '';

    if (id) {
      var n = store.getNote(id);
      if (n) {
        var t = n.title || '';
        var c = n.content || '';
        // 老数据没有 title：把正文首行当标题、其余当描述。
        // 这样编辑一次老记事就自然迁移到新结构，不用写迁移脚本。
        if (!t && c) {
          var lines = String(c).trim().split('\n');
          t = lines[0].trim();
          c = lines.slice(1).join('\n').trim();
        }
        this.setData({
          scaleClass: 'scale-' + scale,
          isEdit: true,
          id: id,
          title: t,
          content: c,
          rawTime: n.rawTime || '',
          author: n.author || author
        });
        this.updateParsedHint(n.rawTime || '');
        return;
      }
      // id 找不到（数据被清了）→ 退化成新建，不报错给老人看
    }

    this.setData({ scaleClass: 'scale-' + scale, author: author });
  },

  onTitle: function (e) {
    this.setData({ title: e.detail.value || '' });
  },

  onContent: function (e) {
    this.setData({ content: e.detail.value || '' });
  },

  onAuthor: function (e) {
    this.setData({ author: e.detail.value || '' });
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
    var title = (this.data.title || '').trim();
    var content = (this.data.content || '').trim();

    // 标题和描述都空才拦。只写标题也该让记下来 —— 随手记一条就该这么轻。
    if (!title && !content) {
      wx.showToast({ title: '还没写内容呢', icon: 'none', duration: 2000 });
      return;
    }

    var when = time.parseWhen(this.data.rawTime);
    var author = (this.data.author || '').trim();

    // 记住这个名字，下次新增自动带上
    if (author) store.setAuthor(author);

    var fields = {
      title: title,
      content: content,
      rawTime: when.rawTime,
      hasTime: when.hasTime,
      dueAt: when.dueAt,
      author: author
    };

    if (this.data.isEdit && this.data.id) {
      store.update(this.data.id, fields);
    } else {
      store.add(content, when, { title: title, author: author, status: 'todo' });
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
