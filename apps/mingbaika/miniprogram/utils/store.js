'use strict';

/**
 * 本地历史存储。基于 wx.getStorageSync / setStorageSync。
 * 最多保留 50 条，超出时丢弃最旧的。
 */

var STORAGE_KEY = 'mingbaika_history';
var MAX_ITEMS = 50;

/**
 * 读取全部历史（按时间倒序，最新在前）。
 * @returns {Array<{id:string, card:object, createdAt:number}>}
 */
function listCards() {
  try {
    var arr = wx.getStorageSync(STORAGE_KEY);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

/**
 * 新增一条历史记录。返回该记录的 id。
 * @param {object} card  规范化后的行动卡
 * @returns {string} id
 */
function addCard(card) {
  var id = 'c_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
  var record = { id: id, card: card, createdAt: Date.now() };
  var list = listCards();
  list.unshift(record);
  if (list.length > MAX_ITEMS) list = list.slice(0, MAX_ITEMS);
  try {
    wx.setStorageSync(STORAGE_KEY, list);
  } catch (e) {
    // 存储失败（极端情况，如空间不足）不影响主流程
  }
  return id;
}

/**
 * 按 id 取一条记录。
 * @param {string} id
 * @returns {object|null}
 */
function getCard(id) {
  var list = listCards();
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

/**
 * 删除一条记录。
 * @param {string} id
 */
function removeCard(id) {
  var list = listCards().filter(function (r) { return r.id !== id; });
  try {
    wx.setStorageSync(STORAGE_KEY, list);
  } catch (e) {}
}

/**
 * 清空全部历史。
 */
function clearAll() {
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (e) {}
}

module.exports = {
  listCards: listCards,
  addCard: addCard,
  getCard: getCard,
  removeCard: removeCard,
  clearAll: clearAll,
};
