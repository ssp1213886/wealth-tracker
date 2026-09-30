// 防腐烂：**所有会开浏览器的场景脚本，要么被常跑入口引用，要么在白名单里写明"为什么不常跑"**。
//
// 背景（v322）：终测时抓到 sync-full / prod-full 两个"按需再跑"的脚本早已随产品演进腐烂
// （一个没跟上 401 自愈跳登录页，一个没跟上登录门禁）。脚本不常跑就一定会烂，
// 所以这里加一道守卫：新增脚本忘了挂进 run-all（或忘了写白名单理由）→ 这条测试直接红。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/** 常跑入口：这些文件里出现的脚本名，算"已被调度"。 */
const WIRING_FILES = ['scripts/e2e/run.mjs', 'scripts/e2e/run-all.mjs', '.github/workflows/ci.yml'];

/** 不常跑的场景 + 理由（必须能说清，且文件必须还在）。 */
const NOT_ALWAYS_RUN = {
  'scripts/e2e/soak.mjs': '按分钟计的长时运行，用 SOAK_MINUTES 显式开启（e2e:all 支持）',
  'scripts/e2e/style-fingerprint.mjs': '渲染指纹要与基线构建对比，单独跑；动样式时必跑',
  'scripts/e2e/measure-boot-scenario.mjs': '人为延迟测量的场景，由 scripts/e2e/measure-boot.mjs 调度',
  'scripts/e2e/interactive-states.mjs': '样式交互态审计（配 scripts/css 的 C1 工具），按需跑',
  'scripts/e2e/prod-smoke.mjs': '发布后对线上跑的只读冒烟（CI 里没有线上凭证）',
  'scripts/e2e/prod-full.mjs': '发布后对线上跑的完整只读验证（CI 里没有线上凭证）',
  'scripts/e2e/shot-brand.mjs': '生成品牌图标/截图的手工工具',
  'scripts/manual-e2e.mjs': '手工交互式排查脚本',
};

/** 驱动与引擎不是场景，别被算进来。 */
const INFRA = ['scripts/e2e/driver.mjs', 'scripts/e2e/driver-engine.mjs'];

function scenarioScripts() {
  const out = [];
  for (const dir of ['scripts', 'scripts/e2e']) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.mjs')) continue;
      const rel = dir + '/' + name;
      if (INFRA.includes(rel)) continue;
      if (/newPage\(/.test(fs.readFileSync(rel, 'utf8'))) out.push(rel);
    }
  }
  return out;
}

test('场景脚本不许"漏挂"：要么进常跑入口，要么在白名单里写明理由', () => {
  const wired = WIRING_FILES.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const scripts = scenarioScripts();
  assert.ok(scripts.length >= 15, '场景脚本清单异常（只扫到 ' + scripts.length + ' 个）');

  const missing = scripts.filter((rel) => {
    const base = rel.split('/').pop();
    return !wired.includes(base) && !(rel in NOT_ALWAYS_RUN);
  });
  assert.deepEqual(missing, [], '这些场景脚本既没被常跑入口引用、也不在白名单里：\n  - ' + missing.join('\n  - '));

  // 白名单不能残留：脚本删了/改名了要一并清理，否则它就成了"假装常跑"的遮羞布
  Object.keys(NOT_ALWAYS_RUN).forEach((rel) => {
    assert.ok(fs.existsSync(rel), '白名单里的脚本已不存在，请清理：' + rel);
  });
  // CI 必须真的在跑总入口 —— 否则"常跑"只是嘴上说说
  const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /e2e:all|run-all\.mjs/, 'CI 里要跑总入口（npm run e2e:all），专项脚本才不会腐烂');
});
