#!/usr/bin/env node
// e2e 总入口：拉起假云端 → 依次跑爬查与两条业务流 → 汇总结果。
// 用法：npm run e2e
// 默认用 **无头 Chrome**（scripts/e2e/driver.mjs）：不弹窗、不占用你的调试窗口。
// 想用可视化的调试 Chrome 跑（需要看画面时）：E2E_USE_DEBUG_CHROME=1 npm run e2e
// 可用环境变量：CHROME_PATH、PW_CORE_PATH、CDP、E2E_PORT
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS = ['crawl.mjs', 'flows-data.mjs', 'flows-interactions.mjs', 'flows-marketcap.mjs'];
const PORT = process.env.E2E_PORT || '8790';
const BASE = 'http://127.0.0.1:' + PORT + '/';
const DEFAULT_CDP = 'C:/Users/topeasejs/.codex/skills/chrome-debug/scripts/cdp.mjs';
const useDebugChrome = process.env.E2E_USE_DEBUG_CHROME === '1';
const DRIVER = useDebugChrome ? (process.env.CDP || DEFAULT_CDP) : path.join(HERE, 'driver.mjs');

if (!existsSync(DRIVER)) {
  console.error('找不到驱动：' + DRIVER);
  console.error('无头模式无需额外准备；若要连调试 Chrome，请设置 CDP 并确保端口 9222 可用。');
  process.exit(1);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url + '_log');
      if (res.ok) return true;
    } catch (e) { /* 还没起来，继续等 */ }
    await wait(200);
  }
  return false;
}
function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out: out.trim() }));
  });
}

const cloud = spawn(process.execPath, [path.join(HERE, 'mock-cloud.mjs')], {
  env: { ...process.env, E2E_PORT: PORT },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let cloudOut = '';
cloud.stdout.on('data', (d) => { cloudOut += d; });
cloud.stderr.on('data', (d) => { cloudOut += d; });

const results = [];
const ready = await waitReady(BASE, 8000);
if (!ready) {
  cloud.kill();
  console.error('假云端没起来：\n' + cloudOut);
  process.exit(1);
}

for (const scenario of SCENARIOS) {
  process.stdout.write('\n=== ' + scenario + ' ===\n');
  const res = await runNode([DRIVER, '--file', path.join(HERE, scenario)], { E2E_BASE: BASE });
  if (res.out) console.log(res.out);
  results.push({ scenario, ok: res.code === 0 });
}
cloud.kill();

const failed = results.filter((r) => !r.ok);
console.log('\n===== e2e 汇总（' + (useDebugChrome ? '调试 Chrome' : '无头 Chrome') + '）=====');
results.forEach((r) => console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.scenario));
if (failed.length) {
  console.error('失败 ' + failed.length + ' 项。');
  process.exit(1);
}
console.log('全部通过（' + results.length + ' 项）');
