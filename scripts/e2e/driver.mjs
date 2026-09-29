#!/usr/bin/env node
// 无头浏览器驱动：与 chrome-debug 的 cdp.mjs 接口一致（注入 page/pages/context/browser），
// 但自己起一个 headless Chrome —— 不碰用户正在用的调试窗口，也不会弹任何原生弹窗。
//   node scripts/e2e/driver.mjs --file <脚本>
// 环境变量：CHROME_PATH、PW_CORE_PATH
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
// 兼容三种环境：本机（默认路径）、CI（linux 上的 google-chrome / chromium）、显式 CHROME_PATH
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) fail('找不到 Chrome，可用 CHROME_PATH 指定（试过：' + CHROME_CANDIDATES.join(', ') + '）');

const argv = process.argv.slice(2);
let file = null;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--file') file = argv[i + 1];
}
if (!file || !existsSync(file)) fail('用法：node scripts/e2e/driver.mjs --file <脚本>');
const code = readFileSync(file, 'utf8');

const pwPath = findPlaywrightCore() || (existsSync('node_modules/playwright-core/index.js') ? 'node_modules/playwright-core' : null);
if (!pwPath) fail('找不到 playwright-core，可用环境变量 PW_CORE_PATH 指定路径');
const require = createRequire(import.meta.url);
const { chromium } = require(pwPath);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,                      // 关键：无窗口，不影响用户
  args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'],
});
const context = await browser.newContext();
const pages = context.pages();
const page = pages[0] ?? (await context.newPage());

let result;
try {
  const run = new Function('page', 'pages', 'context', 'browser', 'return (async () => {\n' + code + '\n})();');
  result = await run(page, pages, context, browser);
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
