'use strict';

var api = require('../../utils/api.js');
var store = require('../../utils/store.js');
var app = getApp();

Page({
  data: {
    loading: false,
    loadingText: '',
  },

  onLoad: function (options) {
    // 转发 / 扫码等带参数进入时，options.query 可能携带 rawText / fileID
    this._tryForward(options);
  },

  onShow: function () {
    // 从 App.onShow 暂存的转发参数
    this._tryForward(app.globalData.pendingForward);
  },

  /**
   * 统一入口：尝试用转发参数直接解析。参数形式：
   *   { rawText: string, fileID: string }
   * 两者都没有则什么都不做（留在首页）。
   */
  _tryForward: function (src) {
    if (!src) return;
    var rawText = (src.rawText || '').trim();
    var fileID = (src.fileID || '').trim();
    if (!rawText && !fileID) return;
    // 消费掉，避免重复触发
    app.globalData.pendingForward = null;
    this._runParse({ rawText: rawText, fileID: fileID });
  },

  // 入口 1：从聊天记录选择图片（主入口）
  onChooseFromChat: function () {
    var self = this;
    wx.chooseMessageFile({
      count: 1,
      type: 'image',
      success: function (res) {
        var file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        self._runParse({ tempFilePath: file.path });
      },
      fail: function () {
        // 用户取消不选，不提示
      },
    });
  },

  // 入口 2：拍照或从相册选图
  onChooseMedia: function () {
    var self = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        var f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        self._runParse({ tempFilePath: f.tempFilePath });
      },
      fail: function () {},
    });
  },

  /**
   * 统一解析流程：上传（如有临时文件）→ 调云函数 → 存历史 → 跳结果页。
   * @param {{tempFilePath?:string, fileID?:string, rawText?:string}} param
   */
  _runParse: function (param) {
    var self = this;
    if (this.data.loading) return;

    var fileID = param.fileID || '';
    var rawText = param.rawText || '';
    var requestId = api.genRequestId();

    self.setData({ loading: true, loadingText: '正在识别通知…' });

    var doCall = function (fid) {
      api.parseNotice({ fileID: fid, rawText: rawText, requestId: requestId })
        .then(function (result) {
          var card = result.card;
          var id = store.addCard(card);
          app.globalData.tempCard = card;
          wx.redirectTo({
            url: '/pages/result/result?id=' + encodeURIComponent(id),
          });
        })
        .catch(function (err) {
          wx.showToast({ title: (err && err.message) || '识别失败', icon: 'none' });
          self.setData({ loading: false });
        });
    };

    if (param.tempFilePath) {
      api.uploadImage(param.tempFilePath, requestId)
        .then(function (fid) { doCall(fid); })
        .catch(function (err) {
          wx.showToast({ title: (err && err.message) || '上传失败', icon: 'none' });
          self.setData({ loading: false });
        });
    } else if (fileID || rawText) {
      doCall(fileID);
    } else {
      self.setData({ loading: false });
      wx.showToast({ title: '没有可识别的内容', icon: 'none' });
    }
  },

  // 进入历史列表
  onOpenHistory: function () {
    wx.navigateTo({ url: '/pages/history/history' });
  },
});
