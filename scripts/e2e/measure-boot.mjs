#!/usr/bin/env node
// 冷启动延迟测量的入口：起假云端 → 跑 measure-boot-scenario.mjs → 打印结果。
//
// 用法（默认量当前 public/）：
//   DELAY=2000 node scripts/e2e/measure-boot.mjs
//
// 对比旧构建（推荐做法，用 git worktree 拉出旧提交，量完删掉）：
//   git worktree add ../_wt-old <旧提交>
//   DELAY=2000 PUB=../_wt-old/public TAG="旧版 v309" PORT=8792 node scripts/e2e/measure-boot.mjs
//   DELAY=2000 TAG="现版" PORT=8793 node scripts/e2e/measure-boot.mjs
//   git worktree remove ../_wt-old
//
// 环境变量：DELAY（每请求人为延迟 ms，默认 2000）/ PUB（服务哪个目录，默认仓库 public/）
//          TAG（结果标题）/ PORT（假云端端口）/ RUN_MS（测量时长）
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SCENARIO = path.join(HERE, 'measure-boot-scenario.mjs');
const DRIVER = path.join(HERE, 'driver.mjs');
if (!existsSync(DRIVER)) { console.error('找不到 driver.mjs'); process.exit(1); }

const PUB = process.env.PUB ? path.resolve(process.env.PUB) : path.join(ROOT, 'public');
const PORT = process.env.PORT || '8794';
const BASE = 'http://127.0.0.1:' + PORT + '/';
const WAIT_MS = 2000;

const cloud = spawn(process.execPath, [path.join(HERE, 'mock-cloud.mjs')], {
  env: { ...process.env, E2E_PUBLIC: PUB, E2E_PORT: PORT },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ready = false;
for (let i = 0; i < 40 && !ready; i += 1) {
  await wait(200);
  try { ready = (await fetch(BASE + '_log')).ok } catch { /* 还没起来 */ }
}
if (!ready) { console.error('假云端没起来（端口 ' + PORT + ' 被占用？）'); cloud.kill(); process.exit(1); }

const driver = spawn(process.execPath, [DRIVER, '--file', SCENARIO], {
  env: { ...process.env, E2E_BASE: BASE },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
driver.stdout.on('data', (d) => { out += d; });
driver.stderr.on('data', (d) => { out += d; });
await new Promise((r) => driver.on('close', r));
cloud.kill();
console.log('===== ' + (process.env.TAG || '启动延迟测量') + '（每请求人为延迟 ' + (process.env.DELAY || WAIT_MS) + 'ms，服务 ' + PUB + '）=====');
console.log(out.trim());
