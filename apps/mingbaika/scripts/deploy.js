#!/usr/bin/env node
'use strict';

/**
 * 明白卡 · 部署脚本（基于 miniprogram-ci）
 * ===========================================================================
 *
 * 为什么不用「微信开发者工具」自带 CLI：
 *   本机 Windows 把 TCP 3713–3812 列为保留端口段（Hyper-V / winnat 占用），
 *   而开发者工具 CLI 的桥接端口固定为 3799，正好落在该段内，导致
 *   `listen EACCES: permission denied 127.0.0.1:3799` —— CLI 在这台机器上
 *   完全不可用（`--port` 参数改的是 IDE 的 HTTP 端口，改不了这个）。
 *   miniprogram-ci 是官方从开发者工具中抽离的编译模块，不依赖开发者工具、
 *   不占 3799，本来就是给 CI/CD 用的，因此改用这条路。
 *
 * 用法：
 *   node scripts/deploy.js check                   仅做前置检查（默认命令）
 *   node scripts/deploy.js preview                 生成体验版预览二维码
 *   node scripts/deploy.js upload [版本号] [备注]    上传代码 → 产生一个开发版本
 *   node scripts/deploy.js fn                      部署云函数 parseNotice
 *   node scripts/deploy.js all [版本号] [备注]      部署云函数 + 上传代码
 *
 * 三项前置条件只能人工完成，脚本无法代劳（脚本会检查并明确报出来）：
 *   1. project.config.json 的 appid        换成真实 AppID
 *   2. miniprogram/app.js 的 ENV_ID        换成真实云环境 ID
 *   3. 代码上传密钥 private.<appid>.key     放到项目根目录，并配好 IP 白名单
 *      （公众平台 → 管理 → 开发管理 → 开发设置 → 小程序代码上传 → 生成密钥）
 *
 * 设计约定：
 *   - AppID 只从 project.config.json 读，ENV_ID 只从 miniprogram/app.js 读，
 *     不在本脚本里再存一份，避免两处不一致。
 *   - 上传前强制跑一遍 scripts/check.js，静态校验不过就不允许上传。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// 路径
// ---------------------------------------------------------------------------
const ROOT = path.resolve(__dirname, '..');
const MP_DIR = path.join(ROOT, 'miniprogram');
const FN_NAME = 'parseNotice';
const FN_DIR = path.join(ROOT, 'cloudfunctions', FN_NAME);
const PROJECT_CONFIG = path.join(ROOT, 'project.config.json');
const APP_JS = path.join(MP_DIR, 'app.js');
const CHECK_SCRIPT = path.join(__dirname, 'check.js');
const CONFIG_FILE = path.join(ROOT, 'deploy.config.json');

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : String(s));
const bold = paint('1');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const dim = paint('2');

const log = (...a) => console.log(...a);
const ok = (m) => log(green('  ✅ ' + m));
const warn = (m) => log(yellow('  ⚠️  ' + m));
const bad = (m) => log(red('  ❌ ' + m));
const info = (m) => log(dim('     ' + m));

function heading(t) {
  log('\n' + bold(t));
  log(dim('─'.repeat(64)));
}

// ---------------------------------------------------------------------------
// 读取配置（单一数据源）
// ---------------------------------------------------------------------------

/** 判断是不是还没替换的占位值。 */
function isPlaceholder(v) {
  if (!v || typeof v !== 'string') return true;
  return /YOUR_|your_|<.*>|xxx|占位|待填|^wx\s*$/i.test(v.trim());
}

function readAppId() {
  if (!fs.existsSync(PROJECT_CONFIG)) {
    return { value: null, error: `找不到 ${path.relative(ROOT, PROJECT_CONFIG)}` };
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(PROJECT_CONFIG, 'utf8'));
    return { value: cfg.appid || null, source: 'project.config.json' };
  } catch (e) {
    return { value: null, error: `project.config.json 不是合法 JSON：${e.message}` };
  }
}

function readEnvId() {
  if (!fs.existsSync(APP_JS)) {
    return { value: null, error: `找不到 ${path.relative(ROOT, APP_JS)}` };
  }
  const src = fs.readFileSync(APP_JS, 'utf8');
  const m = /var\s+ENV_ID\s*=\s*['"]([^'"]*)['"]/.exec(src);
  if (!m) return { value: null, error: 'app.js 里没有找到 `var ENV_ID = "..."` 声明' };
  return { value: m[1], source: 'miniprogram/app.js' };
}

/**
 * 找代码上传密钥。优先级：
 *   1. 环境变量 MP_PRIVATE_KEY_PATH
 *   2. deploy.config.json 的 privateKeyPath
 *   3. 项目根目录下的 private.*.key（自动匹配）
 */
function findPrivateKey() {
  if (process.env.MP_PRIVATE_KEY_PATH) {
    const p = process.env.MP_PRIVATE_KEY_PATH;
    return fs.existsSync(p)
      ? { value: path.resolve(p), source: '环境变量 MP_PRIVATE_KEY_PATH' }
      : { value: null, error: `环境变量 MP_PRIVATE_KEY_PATH 指向的文件不存在：${p}` };
  }

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (cfg.privateKeyPath) {
        const p = path.resolve(ROOT, cfg.privateKeyPath);
        return fs.existsSync(p)
          ? { value: p, source: 'deploy.config.json' }
          : { value: null, error: `deploy.config.json 里的 privateKeyPath 不存在：${p}` };
      }
    } catch (e) {
      return { value: null, error: `deploy.config.json 不是合法 JSON：${e.message}` };
    }
  }

  const found = fs
    .readdirSync(ROOT)
    .filter((f) => /^private\..+\.key$/i.test(f))
    .map((f) => path.join(ROOT, f));
  if (found.length === 1) return { value: found[0], source: '自动匹配根目录 private.*.key' };
  if (found.length > 1) {
    return {
      value: null,
      error: `根目录匹配到多个密钥文件，无法确定用哪个：\n       ${found
        .map((f) => path.basename(f))
        .join('\n       ')}\n       请用 deploy.config.json 的 privateKeyPath 指定。`,
    };
  }
  return { value: null };
}

// ---------------------------------------------------------------------------
// 运行环境兜底
// ---------------------------------------------------------------------------

/**
 * miniprogram-ci 依赖 npm-conf，后者在 win32 下执行：
 *     path.resolve(process.env.APPDATA, 'npm-cache')
 * 若 APPDATA 为空（某些 Git Bash / CI 会话不继承该变量），就会抛
 * ERR_INVALID_ARG_TYPE: The "paths[0]" argument must be of type string.
 * 这个报错完全看不出和 APPDATA 有关，所以这里主动补一个默认值。
 */
function ensureWindowsEnv() {
  if (process.platform !== 'win32') return;
  if (process.env.APPDATA) return;
  const guess = path.join(os.homedir(), 'AppData', 'Roaming');
  if (fs.existsSync(guess)) process.env.APPDATA = guess;
}

// ---------------------------------------------------------------------------
// 前置检查
// ---------------------------------------------------------------------------
function preflight(needKey = true) {
  heading('前置检查');

  const problems = [];

  // AppID
  const app = readAppId();
  if (app.error) {
    bad(`AppID 读取失败：${app.error}`);
    problems.push('appid');
  } else if (isPlaceholder(app.value)) {
    bad(`AppID 还是占位值：「${app.value}」`);
    info('改 project.config.json 的 appid 字段为你的真实 AppID（wx 开头 18 位）');
    problems.push('appid');
  } else {
    ok(`AppID = ${app.value}  ${dim('(来源 ' + app.source + ')')}`);
  }

  // ENV_ID
  const env = readEnvId();
  if (env.error) {
    bad(`云环境 ID 读取失败：${env.error}`);
    problems.push('env');
  } else if (isPlaceholder(env.value)) {
    bad(`云环境 ID 还是占位值：「${env.value}」`);
    info('改 miniprogram/app.js 的 ENV_ID 为真实云环境 ID（云开发控制台可查）');
    problems.push('env');
  } else {
    ok(`云环境 ID = ${env.value}  ${dim('(来源 ' + env.source + ')')}`);
  }

  // 云函数目录
  if (fs.existsSync(path.join(FN_DIR, 'index.js'))) {
    ok(`云函数目录存在：cloudfunctions/${FN_NAME}/`);
  } else {
    bad(`找不到云函数入口：cloudfunctions/${FN_NAME}/index.js`);
    problems.push('fn');
  }

  // 部署依赖
  if (fs.existsSync(path.join(ROOT, 'node_modules', 'miniprogram-ci'))) {
    ok('部署依赖 miniprogram-ci 已安装');
  } else {
    bad('还没安装 miniprogram-ci（preview / upload / fn 都要用它）');
    info('在本目录执行：npm install');
    problems.push('deps');
  }

  // 密钥
  let key = { value: null };
  if (needKey) {
    key = findPrivateKey();
    if (key.value) {
      const size = fs.statSync(key.value).size;
      ok(`代码上传密钥：${path.basename(key.value)}  ${dim(`(${size} 字节, ${key.source})`)}`);
    } else {
      bad('没找到代码上传密钥');
      if (key.error) info(key.error);
      info('公众平台 → 管理 → 开发管理 → 开发设置 → 小程序代码上传 → 生成密钥');
      info('下载后放到项目根目录（文件名形如 private.wx1234.key），并配置 IP 白名单');
      problems.push('key');
    }
  } else {
    info('（本命令不需要上传密钥，已跳过该项检查）');
  }

  return { problems, appId: app.value, envId: env.value, privateKeyPath: key.value };
}

// ---------------------------------------------------------------------------
// 静态校验作为上传闸门
// ---------------------------------------------------------------------------
function gateByCheck() {
  if (!fs.existsSync(CHECK_SCRIPT)) {
    warn('未找到 scripts/check.js，跳过静态校验');
    return true;
  }
  heading('静态校验（上传闸门）');
  const r = spawnSync(process.execPath, [CHECK_SCRIPT], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  // 只打印结论行，避免刷屏
  out
    .split(/\r?\n/)
    .filter((l) => /检查|通过|失败|❌|Error|错误/.test(l))
    .slice(-8)
    .forEach((l) => log('     ' + l.trim()));
  if (r.status !== 0) {
    bad('静态校验未通过 —— 已阻止上传。修完再重试。');
    return false;
  }
  ok('静态校验通过');
  return true;
}

// ---------------------------------------------------------------------------
// miniprogram-ci
// ---------------------------------------------------------------------------
function loadCI() {
  try {
    return require('miniprogram-ci');
  } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND' && /miniprogram-ci/.test(e.message || '')) {
      bad('没有安装 miniprogram-ci');
      info('在本目录执行：npm install');
      info('（它会装到 apps/mingbaika/node_modules/，该目录已在 .gitignore 中）');
    } else {
      // 这里必须区分「没装」和「装了但加载失败」——把后者说成前者会让人白折腾半天。
      bad('加载 miniprogram-ci 失败（它已安装，是运行环境的问题）');
      info('错误：' + (e && e.message));
      if (process.platform === 'win32' && !process.env.APPDATA) {
        info('原因很可能是环境变量 APPDATA 为空：miniprogram-ci 依赖的 npm-conf 在');
        info('Windows 下会读 APPDATA 拼缓存路径，读不到就抛 ERR_INVALID_ARG_TYPE。');
        info('本脚本已尝试自动补默认值；若仍失败，请手动设置后重试：');
        info('  export APPDATA="$USERPROFILE\\\\AppData\\\\Roaming"');
      }
    }
    process.exit(1);
  }
}

function makeProject(ci, appId, privateKeyPath) {
  return new ci.Project({
    appid: appId,
    type: 'miniProgram',
    projectPath: ROOT,
    privateKeyPath,
    ignores: ['node_modules/**/*', 'tests/**/*', 'docs/**/*', '*.md'],
  });
}

function buildSetting() {
  // 与 project.config.json 的 setting 保持一致，编译结果才和开发者工具一样。
  return { es6: true, minify: true, minifyWXSS: true, minifyWXML: true, autoPrefixWXSS: true };
}

// ---------------------------------------------------------------------------
// 命令实现
// ---------------------------------------------------------------------------
async function cmdCheck() {
  const { problems } = preflight(true);
  heading('结论');
  if (problems.length === 0) {
    ok('前置条件齐备，可以执行 preview / upload / fn / all');
    return 0;
  }
  bad(`还有 ${problems.length} 项没就绪：${problems.join('、')}`);
  info('这些都属于账号层面的操作，脚本无法代劳。补齐后重跑本命令即可。');
  return 1;
}

async function cmdPreview() {
  const { problems, appId, privateKeyPath } = preflight(true);
  if (problems.length) {
    bad('前置检查未通过，已中止');
    return 1;
  }
  const ci = loadCI();
  if (!gateByCheck()) return 1;

  heading('生成预览二维码');
  const outFile = path.join(ROOT, 'preview-qrcode.jpg');
  const project = makeProject(ci, appId, privateKeyPath);
  const res = await ci.preview({
    project,
    desc: '明白卡 预览',
    setting: buildSetting(),
    qrcodeFormat: 'image',
    qrcodeOutputDest: outFile,
    onProgressUpdate: () => {},
  });
  ok('预览二维码已生成：' + outFile);
  if (res && res.subPackageInfo) info(JSON.stringify(res.subPackageInfo));
  info('用微信扫码即可在真机上打开体验版（开发者需在项目成员里）');
  return 0;
}

async function cmdUpload(version, desc) {
  const { problems, appId, privateKeyPath } = preflight(true);
  if (problems.length) {
    bad('前置检查未通过，已中止');
    return 1;
  }
  const ci = loadCI();
  if (!gateByCheck()) return 1;

  heading('上传代码');
  const project = makeProject(ci, appId, privateKeyPath);
  const res = await ci.upload({
    project,
    version,
    desc,
    setting: buildSetting(),
    robot: 1,
    onProgressUpdate: () => {},
  });
  ok(`上传成功：version=${version} desc=${desc}`);
  if (res && res.subPackageInfo) {
    res.subPackageInfo.forEach((p) => info(`包 ${p.name}: ${(p.size / 1024).toFixed(1)} KB`));
  }
  info('下一步：公众平台 → 管理 → 版本管理 → 提交审核（这一步脚本做不了）');
  return 0;
}

async function cmdFn() {
  const { problems, appId, envId, privateKeyPath } = preflight(true);
  if (problems.length) {
    bad('前置检查未通过，已中止');
    return 1;
  }
  const ci = loadCI();

  heading(`部署云函数 ${FN_NAME}`);
  const project = makeProject(ci, appId, privateKeyPath);
  const res = await ci.cloud.uploadFunction({
    project,
    env: envId,
    name: FN_NAME,
    path: FN_DIR,
    remoteNpmInstall: true, // 云端装依赖，不上传本地 node_modules
  });
  ok(`云函数已部署到环境 ${envId}`);
  if (res) info(JSON.stringify(res));
  info('云端装依赖首次约 1–3 分钟；部署后在云开发控制台可看到该函数');
  return 0;
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------
async function main() {
  ensureWindowsEnv(); // 必须在 require miniprogram-ci 之前执行
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'check';

  log(bold('\n明白卡 · 部署脚本') + dim('  (miniprogram-ci)'));
  info('项目目录 ' + ROOT);

  if (cmd === '-h' || cmd === '--help' || cmd === 'help') {
    heading('用法');
    log(`  node scripts/deploy.js check                 仅做前置检查（默认）`);
    log(`  node scripts/deploy.js preview               生成体验版预览二维码`);
    log(`  node scripts/deploy.js upload [版本号] [备注]  上传代码`);
    log(`  node scripts/deploy.js fn                    部署云函数 ${FN_NAME}`);
    log(`  node scripts/deploy.js all [版本号] [备注]     云函数 + 上传代码`);
    heading('前置条件');
    log('  1. project.config.json 的 appid 换成真实 AppID');
    log('  2. miniprogram/app.js 的 ENV_ID 换成真实云环境 ID');
    log('  3. 代码上传密钥 private.<appid>.key 放到项目根目录 + 配 IP 白名单');
    return 0;
  }

  const version = argv[1] || '0.1.' + String(Math.floor(Date.now() / 1000) % 10000);
  const desc = argv[2] || '明白卡 开发版';

  switch (cmd) {
    case 'check':
      return cmdCheck();
    case 'preview':
      return cmdPreview();
    case 'upload':
      return cmdUpload(version, desc);
    case 'fn':
      return cmdFn();
    case 'all': {
      const a = await cmdFn();
      if (a !== 0) return a;
      return cmdUpload(version, desc);
    }
    default:
      bad(`未知命令：${cmd}`);
      info('可用命令：check / preview / upload / fn / all（-h 查看帮助）');
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    log('');
    bad('执行失败：' + (e && (e.message || e.errMsg) || e));
    if (e && e.errCode) info('errCode = ' + e.errCode);
    info('常见原因：');
    info('  · 未配置 IP 白名单（公众平台的「小程序代码上传」页面）');
    info('  · 密钥文件与 AppID 不匹配');
    info('  · AppID 或云环境 ID 填错');
    process.exit(1);
  });
