#!/usr/bin/env node
'use strict';

/**
 * 明白卡 · 建云开发数据库集合（notices）
 * ===========================================================================
 *
 * 为什么需要这个脚本：
 *   「建集合」本来只能在云开发控制台里手点。但那是账号权限操作，
 *   AI 无法代你登录网页点按钮。微信官方提供了云开发 HTTP API
 *   （`tcb/databasecollectionadd`），只要拿到 access_token，脚本就能代劳。
 *
 * access_token 从哪来：
 *   用 AppID + AppSecret 换。AppID 本脚本自动从 project.config.json 读，
 *   AppSecret **必须由你提供**（它等同于账号密码，脚本里不存在、也不会打印）。
 *
 * ── 安全约定（重要）─────────────────────────────────────────────────────
 *   AppSecret 只从**环境变量**读，不落盘、不进 git、不打印到终端。
 *   请在你自己的终端里设置后再运行，不要把它贴进聊天窗口或任何文档：
 *
 *     # Git Bash
 *     export WX_APPSECRET=你的AppSecret
 *     node scripts/setup-db.js
 *
 *     # Windows CMD
 *     set WX_APPSECRET=你的AppSecret
 *     node scripts/setup-db.js
 *
 *     # PowerShell
 *     $env:WX_APPSECRET="你的AppSecret"
 *     node scripts/setup-db.js
 *
 * ── 脚本代劳不了的事 ────────────────────────────────────────────────────
 *   1. AppSecret 只能你去拿：mp.weixin.qq.com → 开发管理 → 开发设置 → AppSecret
 *      （若从未生成过，需先点「生成」，且只显示一次，务必当场复制保存）
 *   2. **集合权限的确认**：HTTP API 只负责「建」，不带权限参数。
 *      据多方资料，云开发新建集合默认权限即「仅创建者可读写」，正是我们要的，
 *      但本脚本**没有实测过** API 建出来的默认值，所以结束后会提示你去控制台核对一眼。
 *      权限不对 = 数据可能被其他用户读到，这一步不能省。
 *
 * 用法：
 *   node scripts/setup-db.js              建 notices 集合（默认）
 *   node scripts/setup-db.js notices      指定集合名
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_CONFIG = path.join(ROOT, 'project.config.json');
const APP_JS = path.join(ROOT, 'miniprogram', 'app.js');

const API_HOST = 'https://api.weixin.qq.com';
const DEFAULT_COLLECTION = 'notices';

// ---------------------------------------------------------------------------
// 输出配色（与 deploy.js 保持一致）
// ---------------------------------------------------------------------------
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const C = {
  red: (s) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
};
const ok = (m) => console.log(C.green('  ✓ ') + m);
const bad = (m) => console.log(C.red('  ✗ ') + m);
const warn = (m) => console.log(C.yellow('  ! ') + m);
const info = (m) => console.log('    ' + m);
const step = (m) => console.log('\n' + C.bold(m));

// ---------------------------------------------------------------------------
// 官方错误码对照（来源：微信开放文档 databaseCollectionAdd）
// ---------------------------------------------------------------------------
const ERR_MAP = {
  0: '请求成功',
  '-1': '系统错误',
  '-1000': '系统错误',
  40014: 'AccessToken 不合法',
  40097: '请求参数错误',
  40101: '缺少必填参数',
  41001: '缺少 AccessToken',
  42001: 'AccessToken 过期',
  43002: 'HTTP METHOD 错误',
  44002: 'POST BODY 为空',
  47001: 'POST BODY 格式错误',
  85088: '该 APP 未开通云开发',
  40001: 'AppSecret 错误，或 access_token 无效',
  45009: '接口调用超过限额（access_token 每日有调用上限）',
};

// ---------------------------------------------------------------------------
// 读取配置
// ---------------------------------------------------------------------------
function readConfig() {
  const appid = JSON.parse(fs.readFileSync(PROJECT_CONFIG, 'utf8')).appid;
  const appJs = fs.readFileSync(APP_JS, 'utf8');
  const m = appJs.match(/var\s+ENV_ID\s*=\s*'([^']+)'/);
  const envId = m ? m[1] : '';
  return { appid, envId };
}

function readSecret() {
  return (
    process.env.WX_APPSECRET ||
    process.env.APPSECRET ||
    ''
  ).trim();
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
async function getAccessToken(appid, secret) {
  const url =
    `${API_HOST}/cgi-bin/token?grant_type=client_credential` +
    `&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.access_token) return { token: json.access_token, expiresIn: json.expires_in };
  return { error: json };
}

async function addCollection(token, env, collectionName) {
  const url = `${API_HOST}/tcb/databasecollectionadd?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ env, collection_name: collectionName }),
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
(async function main() {
  const collectionName = (process.argv[2] || DEFAULT_COLLECTION).trim();

  console.log(C.bold('明白卡 · 建云开发集合'));
  console.log(C.dim(`目标集合：${collectionName}`));

  // --- 1. 读 AppID / 环境 ID ---
  step('1. 读取项目配置');
  let cfg;
  try {
    cfg = readConfig();
  } catch (e) {
    bad('读 project.config.json 或 miniprogram/app.js 失败：' + e.message);
    process.exit(1);
  }

  if (!cfg.appid || cfg.appid === 'YOUR_APPID') {
    bad('project.config.json 里还是占位 AppID，先替换成真实值');
    process.exit(1);
  }
  ok(`AppID：${cfg.appid}`);

  if (!cfg.envId || cfg.envId === 'YOUR_ENV_ID') {
    bad('miniprogram/app.js 里还是占位 ENV_ID，先替换成真实云环境 ID');
    process.exit(1);
  }
  ok(`云环境：${cfg.envId}`);

  // --- 2. 读 AppSecret ---
  step('2. 读取 AppSecret');
  const secret = readSecret();
  if (!secret) {
    bad('没找到 AppSecret');
    info('请在你自己的终端里设置环境变量后重跑（不要贴进聊天）：');
    info(C.dim('  Git Bash  : export WX_APPSECRET=xxx && node scripts/setup-db.js'));
    info(C.dim('  CMD       : set WX_APPSECRET=xxx && node scripts/setup-db.js'));
    info(C.dim('  PowerShell: $env:WX_APPSECRET="xxx"; node scripts/setup-db.js'));
    info('');
    info('AppSecret 在哪拿：mp.weixin.qq.com → 开发管理 → 开发设置 → AppSecret');
    process.exit(1);
  }
  ok(`已读到（长度 ${secret.length}，出于安全不显示内容）`);

  // --- 3. 换 access_token ---
  step('3. 换取 access_token');
  let token;
  const tokenRes = await getAccessToken(cfg.appid, secret);
  if (tokenRes.error) {
    const e = tokenRes.error;
    bad(`换取失败：errcode=${e.errcode} errmsg=${e.errmsg}`);
    if (e.errcode === 40001 || e.errcode === 40013) {
      warn('最常见原因：AppSecret 抄错了，或抄的是别的环境的');
    } else if (e.errcode === 45009) {
      warn('access_token 每日调用已达上限，明天再试');
    }
    info(ERR_MAP[String(e.errcode)] ? C.dim(ERR_MAP[String(e.errcode)]) : '');
    process.exit(1);
  }
  token = tokenRes.token;
  ok(`拿到 token（有效期 ${tokenRes.expiresIn} 秒）`);

  // --- 4. 建集合 ---
  step(`4. 创建集合 ${collectionName}`);
  let result;
  try {
    result = await addCollection(token, cfg.envId, collectionName);
  } catch (e) {
    bad('请求失败（网络问题？）：' + e.message);
    process.exit(1);
  }

  const code = result.errcode;
  const msg = result.errmsg || '';

  if (code === 0) {
    ok(`集合 ${collectionName} 创建成功`);
  } else if (/exist|已存在|already/i.test(msg)) {
    ok(`集合 ${collectionName} 已存在（无需重复创建）`);
  } else {
    bad(`创建失败：errcode=${code} errmsg=${msg}`);
    if (ERR_MAP[String(code)]) warn(ERR_MAP[String(code)]);
    if (code === 85088) {
      warn('该 AppID 还没开通云开发 —— 去开发者工具点「云开发」→ 开通');
    }
    if (code === 40097 || code === 40101) {
      warn('环境 ID 可能写错了，确认 miniprogram/app.js 的 ENV_ID 与控制台一致');
    }
    process.exit(1);
  }

  // --- 5. 收尾提示 ---
  step('5. 还需要你亲自确认的一件事');
  warn('去云开发控制台 → 数据库 → 点开 ' + collectionName + ' → 权限设置');
  info('确认是「仅创建者可读写」。理由：notices 存的是各家的群通知，');
  info('若被设成「所有用户可读」，别人就能读到别人家孩子的通知内容。');
  info('');
  info(C.dim('注：多方资料称云开发新建集合默认即「仅创建者可读写」，'));
  info(C.dim('但本脚本未实测 API 创建时的默认值，所以这一步请你亲自看一眼。'));

  console.log('');
  ok('本步完成，接下来可以做「第 4 步 · 部署云函数」');
})();
