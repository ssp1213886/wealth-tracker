#!/usr/bin/env node
// 多引擎无头驱动：chromium / firefox / **webkit（真 Safari 内核）**，可带设备描述符做"接近真机"的验证。
// 用法：
//   node scripts/e2e/driver-engine.mjs --file <脚本> [--engine webkit] [--device "iPhone 13"] [--no-touch]
// 说明：界面与 driver.mjs 一致（注入 page/pages/context/browser），额外注入 device 描述符。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

function fail(message) {
  console.error('ERR: ' + message);
  process.exit(1);
}
function findPlaywrightCore() {
  if (process.env.PW_CORE_PATH) return process.env.PW_CORE_PATH;
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  const base = join(local, 'OpenAI', 'Codex', 'runtimes', 'cua_node');
  if (!existsSync(base)) return null;
  for (const version of readdirSync(base)) {
    const candidate = join(base, version, 'bin', 'node_modules', 'playwright-core');
    if (existsSync(join(candidate, 'index.js'))) return candidate;
  }
  return null;
}

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const file = arg('--file', null);
const engine = arg('--engine', 'chromium');
const deviceName = arg('--device', null);
const exeArg = arg('--exe', null);
if (!file || !existsSync(file)) fail('用法：node scripts/e2e/driver-engine.mjs --file <脚本> [--engine webkit|firefox|chromium] [--device "iPhone 13"]');

const pwPath = findPlaywrightCore() || (existsSync('node_modules/playwright-core/index.js') ? 'node_modules/playwright-core' : null);
if (!pwPath) fail('找不到 playwright-core，可用环境变量 PW_CORE_PATH 指定路径');
const require = createRequire(import.meta.url);
const pw = require(pwPath);
if (!pw[engine]) fail('不支持的引擎：' + engine);

// 浏览器可执行文件：--exe 优先；否则 chromium 回退到系统 Chrome；再否则用 playwright 自带的
//
// ⚠️ v370 修复：候选路径以前只有 Windows 两条 —— CI 跑在 ubuntu-latest，`npm i --no-save playwright-core`
// **不含浏览器二进制**，于是 `pw.chromium.launch()` 直接失败，`npm run e2e:all` 的「真机模拟」那一段整段红。
// 这一步只出现在 e2e:all 里（主套件/回归/专项/同步都用 driver.mjs，它本来就有 Linux 候选），
// 所以 v369 之前的 CI 一直是「test 绿、e2e 红在 Run npm run e2e:all」，本地 Windows 却全绿。
// 修法就是**跟 driver.mjs 用同一份候选路径**（下面这 6 条），另外 ci.yml 里再显式给一个 CHROME_PATH 兜底。
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
let exe = exeArg;
if (!exe && engine === 'chromium') exe = CHROME_CANDIDATES.find((x) => existsSync(x)) || null;
const launchOpts = { headless: true, args: engine === 'chromium' ? ['--no-first-run', '--no-default-browser-check', '--disable-extensions'] : [] };
if (exe) launchOpts.executablePath = exe;
let browser;
try {
  browser = await pw[engine].launch(launchOpts);
} catch (error) {
  /* v370：把"找不到浏览器"这件事说清楚 —— playwright-core 不含二进制，CI 上少了系统 Chrome 就是这个报错 */
  const hint = exe ? '' : ('\n提示：没找到可用的浏览器（试过：' + CHROME_CANDIDATES.join(', ') + '）。' +
    'playwright-core 不自带浏览器二进制 —— 装一个系统 Chrome / Chromium、给 CHROME_PATH，' +
    '或运行 `npx playwright install ' + engine + '`。');
  fail('启动 ' + engine + ' 失败：' + ((error && error.message) || error) + hint);
}
const device = deviceName ? (pw.devices[deviceName] || null) : null;
if (deviceName && !device) fail('未知设备描述符：' + deviceName);
const context = await browser.newContext(device ? Object.assign({}, device) : {});
const pages = context.pages();
const page = pages[0] ?? (await context.newPage());

let result;
try {
  const run = new Function('page', 'pages', 'context', 'browser', 'engine', 'device', 'return (async () => {\n' + readFileSync(file, 'utf8') + '\n})();');
  result = await run(page, pages, context, browser, engine, device);
} catch (error) {
  await browser.close().catch(() => {});
  fail('执行出错: ' + (error && error.stack ? error.stack : error));
}
await browser.close().catch(() => {});
if (result === undefined) console.log('(无返回值)');
else if (typeof result === 'string') console.log(result);
else {
  try { console.log(JSON.stringify(result, null, 2)); } catch { console.log(String(result)); }
}
process.exit(0);
