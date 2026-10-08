'use strict';

/**
 * 本地存储层 —— 本项目的数据权威在本地，云端只是备份镜像。
 *
 * 依据 [S11]：wx.setStorage 单 key 上限 1MB、总量 10MB、按用户隔离、不跨设备。
 * 纯文本记事按每条 200 字估算，10MB 可存 2 万条以上，容量不构成现实约束。
 *
 * 设计约定：
 *   1. 所有写失败（超容量等）**静默降级**，不向老人报错。本地写不进去也要能继续用。
 *   2. 删除一律是软删除（deleted=true），为"删错了能找回"提供基础 [S9][S10]。
 */

var KEY_NOTES = 'notes_v1';
var SETTINGS_PREFIX = 'set_';

/* ---------------- 底层读写 ---------------- */

function get(key, def) {
  try {
    var v = wx.getStorageSync(key);
    if (v === '' || v === undefined || v === null) return def;
    return v;
  } catch (e) {
    return def;
  }
}

function set(key, val) {
  try {
    wx.setStorageSync(key, val);
    return true;
  } catch (e) {
    return false; // 静默失败，不打扰用户
  }
}

function getSetting(name, def) { return get(SETTINGS_PREFIX + name, def); }
function setSetting(name, val) { return set(SETTINGS_PREFIX + name, val); }

/* ---------------- 工具 ---------------- */

function newId() {
  return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function loadRaw() {
  var arr = get(KEY_NOTES, []);
  return Object.prototype.toString.call(arr) === '[object Array]' ? arr : [];
}

function saveRaw(arr) { return set(KEY_NOTES, arr); }

/* ---------------- 记事 CRUD ---------------- */

/** 返回全部未删除的记事。排序：有时间的在前按时间升序，没时间的在后按创建时间倒序。 */
function list() {
  var arr = loadRaw().filter(function (n) { return n && !n.deleted; });
  arr.sort(function (a, b) {
    var at = a.dueAt, bt = b.dueAt;
    if (at && bt) return at - bt;
    if (at && !bt) return -1;
    if (!at && bt) return 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  return arr;
}

function getNote(id) {
  var arr = loadRaw();
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] && arr[i].id === id) return arr[i];
  }
  return null;
}

/** 新增。返回新建的 note（写入失败时仍返回对象，保证 UI 不卡住）。 */
function add(content, when) {
  var now = Date.now();
  var note = {
    id: newId(),
    content: content || '',
    rawTime: (when && when.rawTime) || '',
    hasTime: !!(when && when.hasTime),
    dueAt: (when && when.dueAt) || null,
    createdAt: now,
    updatedAt: now,
    deleted: false
  };
  var arr = loadRaw();
  arr.unshift(note);
  saveRaw(arr);
  return note;
}

/** 局部更新。返回更新后的 note，找不到返回 null。 */
function update(id, patch) {
  var arr = loadRaw();
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] && arr[i].id === id) {
      for (var k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) arr[i][k] = patch[k];
      }
      arr[i].updatedAt = Date.now();
      saveRaw(arr);
      return arr[i];
    }
  }
  return null;
}

/** 软删除。返回被删的 note（撤销时用得着），找不到返回 null。 */
function softDelete(id) {
  var n = getNote(id);
  if (!n) return null;
  update(id, { deleted: true, deletedAt: Date.now() });
  return n;
}

function restore(id) { return update(id, { deleted: false, deletedAt: 0 }); }

/** 清理 30 天前软删除的记录，避免软删除数据无限堆积。 */
function purgeDeleted() {
  var arr = loadRaw();
  var cut = Date.now() - 30 * 24 * 3600 * 1000;
  var kept = arr.filter(function (n) {
    return !(n && n.deleted && n.deletedAt && n.deletedAt < cut);
  });
  if (kept.length !== arr.length) saveRaw(kept);
  return arr.length - kept.length;
}

/* ---------------- 设置 ---------------- */

function getFontScale() { return getSetting('fontScale', ''); }
function setFontScale(s) { return setSetting('fontScale', s); }

module.exports = {
  get: getSetting,
  set: setSetting,
  list: list,
  getNote: getNote,
  add: add,
  update: update,
  softDelete: softDelete,
  restore: restore,
  purgeDeleted: purgeDeleted,
  getFontScale: getFontScale,
  setFontScale: setFontScale
};
