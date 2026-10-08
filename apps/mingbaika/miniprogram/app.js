'use strict';

// TODO: 把 YOUR_ENV_ID 替换成你自己的微信云开发环境 ID（在云开发控制台查看）。
//       不填会导致 wx.cloud.callFunction 调用失败。
var ENV_ID = 'YOUR_ENV_ID';

App({
  globalData: {
    envId: ENV_ID,
    // TODO: 配置「一键拨号」的默认号码（通常是子女或老师的电话）。
    //       留空时点击拨号会提示去设置。建议子女首次帮老人配置。
    contactPhone: '',
    // 转发进入时暂存的参数（文件 ID / 原文）
    pendingForward: null,
    // index 页解析完成后，临时存放卡片，供 result 页立即读取（避免 URL 超长）
    tempCard: null,
  },

  onLaunch: function () {
    if (!wx.cloud) {
      console.error('当前基础库不支持云开发，请升级微信客户端');
      return;
    }
    wx.cloud.init({
      env: ENV_ID,
      traceUser: true,
    });
  },

  /**
   * 从聊天转发消息进入小程序时触发。
   * 微信把转发参数放在 onShow / onLaunch 的 options 里（scene=1037/1038 等），
   * 具体字段以真机实测为准（方案文档标注为「待实测」）。
   * 这里做容错读取：优先 query，再退一步看 referrerInfo。
   */
  onShow: function (options) {
    if (!options) return;
    var q = options.query || {};
    var hasForward = q.rawText || q.fileID || (options.referrerInfo && options.referrerInfo.extraData);
    if (hasForward) {
      this.globalData.pendingForward = {
        rawText: q.rawText || '',
        fileID: q.fileID || '',
        extraData: (options.referrerInfo && options.referrerInfo.extraData) || null,
      };
    }
  },
});
