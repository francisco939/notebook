'use strict';

/**
 * 云函数调用封装。
 *
 * 契约（后端 parseNotice 固定返回）：
 *   成功：{ success: true,  card: <ActionCard>, cached: boolean }
 *   失败：{ success: false, error: '错误信息' }
 *
 * 图片需先 wx.cloud.uploadFile 上传到云存储，拿到 fileID 再传给解析云函数。
 */

/**
 * 上传本地图片到云存储，返回 fileID。
 * @param {string} tempFilePath  wx.chooseMessageFile / wx.chooseMedia 拿到的临时路径
 * @param {string} [requestId]   幂等 ID，用于去重/缓存
 * @returns {Promise<string>}
 */
function uploadImage(tempFilePath, requestId) {
  // 从临时路径里取真实扩展名。不要硬编码 .png——那会让云存储里的对象名与内容不符。
  var m = /\.([A-Za-z0-9]+)$/.exec(tempFilePath || '');
  var ext = m ? m[1].toLowerCase() : 'jpg';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].indexOf(ext) < 0) ext = 'jpg';
  var cloudPath = 'notice/' + (requestId || Date.now()) + '_' + Math.floor(Math.random() * 1e6) + '.' + ext;
  return new Promise(function (resolve, reject) {
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: tempFilePath,
      success: function (res) {
        if (res && res.fileID) resolve(res.fileID);
        else reject(new Error('上传失败：未返回 fileID'));
      },
      fail: function (err) {
        reject(new Error((err && err.errMsg) || '上传图片失败'));
      },
    });
  });
}

/**
 * 调用解析云函数，返回规范化后的行动卡。
 * @param {{fileID?:string, rawText?:string, requestId?:string}} params
 * @returns {Promise<{card:object, cached:boolean}>}
 */
function parseNotice(params) {
  return new Promise(function (resolve, reject) {
    // 图片和文字至少要有一个。纯文字同样走同一条链路（云函数支持只传 rawText），
    // 不要在这里要求 fileID，否则转发的文字消息会被直接拒掉。
    var fileID = (params && params.fileID) ? String(params.fileID).trim() : '';
    var rawText = (params && params.rawText) ? String(params.rawText).trim() : '';
    if (!fileID && !rawText) {
      reject(new Error('没有可识别的内容'));
      return;
    }
    wx.cloud.callFunction({
      name: 'parseNotice',
      data: {
        fileID: fileID,
        rawText: rawText,
        requestId: (params && params.requestId) || '',
      },
      success: function (res) {
        var result = res && res.result;
        if (result && result.success) {
          resolve({ card: result.card, cached: !!result.cached });
        } else {
          reject(new Error((result && result.error) || '解析失败'));
        }
      },
      fail: function (err) {
        reject(new Error((err && err.errMsg) || '调用云函数失败'));
      },
    });
  });
}

/**
 * 生成幂等 requestId。
 * @returns {string}
 */
function genRequestId() {
  return 'mbk_' + Date.now() + '_' + Math.floor(Math.random() * 1e9);
}

module.exports = {
  uploadImage: uploadImage,
  parseNotice: parseNotice,
  genRequestId: genRequestId,
};
