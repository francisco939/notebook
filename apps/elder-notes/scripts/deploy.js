'use strict';

/**
 * 记得 · 部署脚本（基于 miniprogram-ci）
 *
 * 为什么用 miniprogram-ci 而不是微信开发者工具的命令行：
 *   开发者工具 CLI 在本机会尝试监听 127.0.0.1:3799，该端口落在 Windows
 *   保留端口段（3713–3812）内，直接 EACCES 失败，无法从命令行驱动。
 *   miniprogram-ci 是官方的独立上传通道，不依赖开发者工具进程。
 *
 * 与已归档的明白卡版本的区别：
 *   明白卡有云函数 parseNotice，需要 ENV_ID 和「上传并部署云函数」这一步。
 *   本项目是纯端上实现（数据存本地 wx.setStorage），没有云函数、不需要云环境，
 *   所以这里砍掉了 fn / ENV_ID 相关的一切，只保留 check / preview / upload。
 *
 * 用法：
 *   node scripts/deploy.js check                    仅做前置检查（默认）
 *   node scripts/deploy.js preview                  生成体验版二维码
 *   node scripts/deploy.js upload [版本号] [备注]     上传代码
 *   node scripts/deploy.js -h                       查看帮助
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
const PROJECT_CONFIG = path.join(ROOT, 'project.config.json');
const APP_JSON = path.join(MP_DIR, 'app.json');
const CHECK_SCRIPT = path.join(__dirname, 'check.js');
const CONFIG_FILE = path.join(ROOT, 'deploy.config.json');

// ---------------------------------------------------------------------------
// 输出配色（非 TTY 时自动降级为纯文本，便于 CI 里看日志）
// ---------------------------------------------------------------------------
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : String(s));
const bold = paint('1');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const dim = paint('2');

const log = (...a) => console.log(...a);
const ok = (m) => log(green('  [OK] ' + m));
const warn = (m) => log(yellow('  [!!] ' + m));
const bad = (m) => log(red('  [XX] ' + m));
const info = (m) => log(dim('       ' + m));

function heading(t) {
  log('');
  log(bold('== ' + t + ' ' + '='.repeat(Math.max(0, 50 - t.length))));
}

// ---------------------------------------------------------------------------
// 读取配置
// ---------------------------------------------------------------------------
function isPlaceholder(v) {
  return !v || /^(YOUR_|xxx|todo)/i.test(String(v));
}

/** AppID 只从 project.config.json 读，不硬编码，避免两处不一致。 */
function readAppId() {
  if (!fs.existsSync(PROJECT_CONFIG)) {
    return { value: null, error: '找不到 project.config.json' };
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(PROJECT_CONFIG, 'utf8'));
    if (!cfg.appid) return { value: null, error: 'project.config.json 里没有 appid 字段' };
    return { value: cfg.appid, source: 'project.config.json' };
  } catch (e) {
    return { value: null, error: 'project.config.json 不是合法 JSON：' + e.message };
  }
}

/**
 * 从 startDir 开始逐级向上查找某个相对路径对应的实际位置，
 * 模仿 Node require() 对 node_modules 的解析规则。
 *
 * @param {string} startDir 起始目录
 * @param {string} relPath  相对路径片段，如 node_modules/miniprogram-ci
 * @returns {string|null} 命中的绝对路径；一路找到盘符根仍没有则返回 null
 */
function findUpwards(startDir, relPath) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, relPath);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // 已到盘符根
    dir = parent;
  }
}

/**
 * 找代码上传密钥。优先级：
 *   1. 环境变量 MP_PRIVATE_KEY_PATH
 *   2. deploy.config.json 的 privateKeyPath
 *   3. 项目根目录下的 private.*.key（自动匹配）
 *
 * deploy.config.json 已在 .gitignore 中，密钥路径写进去不会入库。
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
      return { value: null, error: 'deploy.config.json 不是合法 JSON：' + e.message };
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
      error:
        '根目录匹配到多个密钥文件，无法确定用哪个：\n       ' +
        found.map((f) => path.basename(f)).join('\n       ') +
        '\n       请用 deploy.config.json 的 privateKeyPath 指定。',
    };
  }
  return { value: null };
}

/**
 * miniprogram-ci 依赖 npm-conf，后者在 win32 下执行
 *   path.resolve(process.env.APPDATA, 'npm-cache')
 * 若 APPDATA 为空（某些 Git Bash / CI 会话不继承），会抛
 * ERR_INVALID_ARG_TYPE —— 报错完全看不出和 APPDATA 有关，所以主动补默认值。
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
function preflight(needKey) {
  heading('前置检查');
  const problems = [];

  // AppID
  const app = readAppId();
  if (app.error) {
    bad('AppID 读取失败：' + app.error);
    problems.push('appid');
  } else if (isPlaceholder(app.value)) {
    bad(`AppID 还是占位值：「${app.value}」`);
    info('改 project.config.json 的 appid 字段为真实 AppID（wx 开头 18 位）');
    problems.push('appid');
  } else {
    ok(`AppID = ${app.value}  ${dim('(来源 ' + app.source + ')')}`);
  }

  // 小程序入口
  if (fs.existsSync(APP_JSON)) {
    let pageCount = 0;
    try {
      pageCount = (JSON.parse(fs.readFileSync(APP_JSON, 'utf8')).pages || []).length;
    } catch (e) {
      bad('miniprogram/app.json 不是合法 JSON：' + e.message);
      problems.push('appjson');
    }
    if (pageCount) ok(`小程序入口存在：miniprogram/app.json（${pageCount} 个页面）`);
  } else {
    bad('找不到 miniprogram/app.json');
    problems.push('appjson');
  }

  // 部署依赖
  // 注意：node_modules 特意放在工作区根目录（不在本目录），因为 276M / 2.2 万个文件
  // 摆在小程序项目目录里会显著拖慢微信开发者工具的导入与索引。
  // Node 的 require 会自动向上逐级查找，所以这里的检测也必须跟着逐级找，
  // 否则会误报“没安装”。见 RESOLVE_DIRS。
  const miniprogramCiDir = findUpwards(ROOT, path.join('node_modules', 'miniprogram-ci'));
  if (miniprogramCiDir) {
    ok('部署依赖 miniprogram-ci 已安装');
    info(dim(`位置：${miniprogramCiDir}`));
  } else {
    bad('还没安装 miniprogram-ci（preview / upload 都要用它）');
    info(`在本目录或工作区根目录执行：npm install`);
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
      info('获取：mp.weixin.qq.com → 管理 → 开发管理 → 开发设置 → 小程序代码上传 → 生成密钥');
      info('下载后放到项目根目录（文件名形如 private.wx77fb4239f60954f0.key）');
      info('并且必须在该页面配置 IP 白名单，否则上传会被拒绝');
      problems.push('key');
    }
  } else {
    info('（本命令不需要上传密钥，已跳过该项检查）');
  }

  return { problems, appId: app.value, privateKeyPath: key.value };
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
    .filter((l) => /检查|通过|失败|\[XX\]|Error|错误/.test(l))
    .slice(-8)
    .forEach((l) => log('       ' + l.trim()));
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
    } else {
      // 必须区分「没装」和「装了但加载失败」——把后者说成前者会让人白折腾半天。
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
    // node_modules 有 276M，必须排除；scripts/ 与 docs/ 是本地开发与文档，不进包。
    ignores: [
      'node_modules/**/*',
      'scripts/**/*',
      'docs/**/*',
      '*.md',
      'package.json',
      'package-lock.json',
      'deploy.config.json',
      'private.*.key',
    ],
  });
}

/** 与 project.config.json 的 setting 保持一致，编译结果才和开发者工具一样。 */
function buildSetting() {
  return { es6: true, minify: true, minifyWXSS: true, minifyWXML: true, autoPrefixWXSS: true };
}

// ---------------------------------------------------------------------------
// 命令实现
// ---------------------------------------------------------------------------
async function cmdCheck() {
  const { problems } = preflight(true);
  heading('结论');
  if (problems.length === 0) {
    ok('前置条件齐备，可以执行 preview / upload');
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
    desc: '记得 预览',
    setting: buildSetting(),
    qrcodeFormat: 'image',
    qrcodeOutputDest: outFile,
    onProgressUpdate: () => {},
  });
  ok('预览二维码已生成：' + outFile);
  if (res && res.subPackageInfo) info(JSON.stringify(res.subPackageInfo));
  info('用微信扫码即可在真机上打开（开发者需在项目成员里）');
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
  ok(`上传成功：version=${version}  desc=${desc}`);
  if (res && res.subPackageInfo) {
    res.subPackageInfo.forEach((p) =>
      info(`包 ${p.name}: ${(p.size / 1024).toFixed(1)} KB`)
    );
  }
  info('下一步：mp.weixin.qq.com → 管理 → 版本管理 → 提交审核（这一步脚本做不了）');
  return 0;
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------
async function main() {
  ensureWindowsEnv(); // 必须在 require miniprogram-ci 之前执行
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'check';

  log(bold('\n记得 · 部署脚本') + dim('  (miniprogram-ci)'));
  info('项目目录 ' + ROOT);

  if (cmd === '-h' || cmd === '--help' || cmd === 'help') {
    heading('用法');
    log('  node scripts/deploy.js check                    仅做前置检查（默认）');
    log('  node scripts/deploy.js preview                  生成体验版二维码');
    log('  node scripts/deploy.js upload [版本号] [备注]     上传代码');
    heading('前置条件');
    log('  1. project.config.json 的 appid 换成真实 AppID  ✅ 已完成');
    log('  2. 下载代码上传密钥 private.<appid>.key 放到项目根目录');
    log('  3. 在 mp.weixin.qq.com 配置 IP 白名单');
    return 0;
  }

  const version = argv[1] || '0.1.' + String(Math.floor(Date.now() / 1000) % 10000);
  const desc = argv[2] || '记得 开发版';

  switch (cmd) {
    case 'check':
      return cmdCheck();
    case 'preview':
      return cmdPreview();
    case 'upload':
      return cmdUpload(version, desc);
    default:
      bad('未知命令：' + cmd);
      info('可用命令：check / preview / upload（-h 查看帮助）');
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    log('');
    bad('执行失败：' + ((e && (e.message || e.errMsg)) || e));
    if (e && e.errCode) info('errCode = ' + e.errCode);
    info('常见原因：');
    info('  · 未配置 IP 白名单（mp.weixin.qq.com → 开发管理 → 开发设置）');
    info('  · 密钥文件与 AppID 不匹配');
    info('  · AppID 填错');
    info('  · 小程序未开通「小程序代码上传」权限（个人主体一般默认有）');
    process.exit(1);
  });
