#!/usr/bin/env node
// 常跑总入口（v322）：把"按需再跑"的专项脚本一起跑掉，防止它们随产品演进悄悄腐烂。
//
// 用法：npm run e2e:all            （主套件 + 全站回归 + 三个专项 + 同步全链路 + 真机模拟）
//      SOAK_MINUTES=3 npm run e2e:all   （附赠一轮长时运行；默认不跑，它按分钟计）
//
// 设计要点：
// - 每个阶段自己起一个假云端，用完就杀；端口不冲突（各脚本都认 E2E_BASE）。
// - 任何一个阶段失败都会在最后汇总，并以非 0 退出码结束（CI 直接红）。
// - 只碰本地假云端，绝不接触生产数据。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(base + '_log')).ok) return true; } catch (e) { /* 还没起来 */ }
    await wait(200);
  }
  return false;
}

function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out: out.trim() }));
  });
}

/** 起假云端 → 依次跑若干脚本 → 杀云端。 */
async function stage(title, { port, env: mockEnv = {} }, scripts) {
  const base = 'http://127.0.0.1:' + port + '/';
  const cloud = spawn(process.execPath, [path.join(HERE, 'mock-cloud.mjs')], {
    cwd: ROOT,
    env: { ...process.env, E2E_PORT: String(port), ...mockEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let cloudOut = '';
  cloud.stdout.on('data', (d) => { cloudOut += d; });
  cloud.stderr.on('data', (d) => { cloudOut += d; });

  const ready = await waitReady(base, 8000);
  if (!ready) {
    cloud.kill();
    console.error('\n=== ' + title + ' ===\n假云端没起来：\n' + cloudOut);
    return scripts.map((s) => ({ name: s.name, ok: false, out: '假云端没起来' }));
  }

  const results = [];
  for (const s of scripts) {
    process.stdout.write('\n=== ' + title + ' · ' + s.name + ' ===\n');
    const res = await runNode([s.driver, '--file', s.file, ...(s.args || [])], { E2E_BASE: base, ...(s.env || {}) });
    if (res.out) console.log(res.out);
    results.push({ name: s.name, ok: res.code === 0, out: res.out });
  }
  cloud.kill();
  return results;
}

const DRIVER = path.join(HERE, 'driver.mjs');
const ENGINE = path.join(HERE, 'driver-engine.mjs');
const all = [];

// ① 主套件（crawl / 数据流 / 交互流 / 市值与敞口 / 使用文档 / 登录门禁 / 清除数据）
process.stdout.write('\n=== 主套件（7 场景）===\n');
const mainSuite = await runNode([path.join(HERE, 'run.mjs')], { E2E_PORT: '8790' });
if (mainSuite.out) console.log(mainSuite.out);
all.push({ name: '主套件 npm run e2e', ok: mainSuite.code === 0 });

// ② 全站回归 + 三个专项（共用 8788 的假云端）
all.push(...await stage('回归与专项（共用 8788）', { port: 8788 }, [
  { name: '全站回归（47 项）', driver: DRIVER, file: path.join(ROOT, 'scripts', 'e2e-full.mjs') },
  { name: '专项：期权', driver: DRIVER, file: path.join(ROOT, 'scripts', 'test-options.mjs') },
  { name: '专项：备份', driver: DRIVER, file: path.join(ROOT, 'scripts', 'test-backup.mjs') },
  { name: '专项：分析卡', driver: DRIVER, file: path.join(ROOT, 'scripts', 'test-analytics.mjs') },
]));

// ③ 同步全链路（需要鉴权开关，专门起一个带 token 的假云端）
all.push(...await stage('同步全链路', { port: 8791, env: { E2E_AUTH_TOKEN: 'good-token' } }, [
  { name: '同步全链路（推送/拉取/409/401）', driver: DRIVER, file: path.join(HERE, 'sync-full.mjs'), env: { E2E_AUTH_TOKEN: 'good-token' } },
]));

// ④ 真机模拟（触摸端；用 driver-engine + iPhone 描述符）
all.push(...await stage('真机模拟', { port: 8789 }, [
  { name: '触摸端（iPhone 13）', driver: ENGINE, file: path.join(HERE, 'mobile-real.mjs'), args: ['--device', 'iPhone 13'] },
]));

// ⑤ 长时运行（可选：SOAK_MINUTES 有值才跑）
if (Number(process.env.SOAK_MINUTES) > 0) {
  all.push(...await stage('长时运行', { port: 8792 }, [
    { name: '长时运行 ' + process.env.SOAK_MINUTES + ' 分钟', driver: DRIVER, file: path.join(HERE, 'soak.mjs'), env: { SOAK_MINUTES: process.env.SOAK_MINUTES } },
  ]));
}

const failed = all.filter((r) => !r.ok);
console.log('\n===== e2e:all 汇总 =====');
all.forEach((r) => console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name));
if (failed.length) {
  console.error('失败 ' + failed.length + ' 项 / 共 ' + all.length + ' 项。');
  process.exit(1);
}
console.log('全部通过（' + all.length + ' 项）');
