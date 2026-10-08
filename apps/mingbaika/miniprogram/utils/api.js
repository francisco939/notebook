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

/** 云存储允许的图片扩展名。 */
var IMG_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

/**
 * 从字符串里猜图片扩展名；猜不出返回 ''。
 * 注意末尾允许带 ?query 或 #hash —— 聊天素材给的是 URL，直接黏 `\.(\w+)$` 会漏掉。
 */
function guessExt(s) {
  var m = /\.([A-Za-z0-9]+)(?:[?#].*)?$/.exec(String(s || ''));
  if (!m) return '';
  var ext = m[1].toLowerCase();
  return IMG_EXTS.indexOf(ext) >= 0 ? ext : '';
}

/**
 * 上传本地图片到云存储，返回 fileID。
 * @param {string} tempFilePath  wx.chooseMessageFile / wx.chooseMedia 拿到的临时路径
 * @param {string} [requestId]   幂等 ID，用于去重/缓存
 * @param {string} [extHint]     扩展名提示（素材是 URL 时用它，临时路径往往没有后缀）
 * @returns {Promise<string>}
 */
function uploadImage(tempFilePath, requestId, extHint) {
  // 云存储对象名要与真实内容一致，不要硬编码 .png。
  var ext = guessExt(extHint) || guessExt(tempFilePath) || 'jpg';
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
 * 上传「聊天素材」（scene 1173 的 forwardMaterials[].path）。
 *
 * 官方对该字段的说明是「文件路径或 URL」，所以有两条分支：
 *   - http(s) URL  → 必须先 wx.downloadFile 落到本地临时文件
 *   - 本地临时路径 → 直接走 uploadImage
 *
 * ⚠️ 待实测：若素材 URL 指向微信自己的域名，wx.downloadFile 可能因「合法域名」
 *    校验失败。真正保险的做法是把 URL 直接交给云函数去取（云函数出网不受域名白名单
 *    限制）。目前先走客户端下载，若真机报 downloadFile:fail url not in domain list，
 *    就改为把 URL 作为参数传给云函数。
 *
 * @param {string} pathOrUrl
 * @param {string} [requestId]
 * @returns {Promise<string>} fileID
 */
function uploadFromMaterialPath(pathOrUrl, requestId) {
  var p = String(pathOrUrl || '').trim();
  if (!p) return Promise.reject(new Error('素材路径为空'));

  if (/^https?:\/\//i.test(p)) {
    return new Promise(function (resolve, reject) {
      wx.downloadFile({
        url: p,
        success: function (res) {
          if (res && res.statusCode === 200 && res.tempFilePath) {
            // 用 URL 猜扩展名：下载后的临时路径通常不带后缀
            uploadImage(res.tempFilePath, requestId, p).then(resolve).catch(reject);
          } else {
            reject(new Error('下载聊天素材失败'));
          }
        },
        fail: function (err) {
          reject(new Error((err && err.errMsg) || '下载聊天素材失败'));
        },
      });
    });
  }

  return uploadImage(p, requestId);
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
  uploadFromMaterialPath: uploadFromMaterialPath,
  parseNotice: parseNotice,
  genRequestId: genRequestId,
};
