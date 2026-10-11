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

// v389 补的第二道守卫：**"跑进常跑入口"不等于"挂了会红"**。
//
// 实测教训（v389）：`run-all.mjs` / `run.mjs` 只看 driver 的退出码，而 driver 原来无论脚本内部
// 断言挂没挂都退 0 —— 于是 `e2e:all` 一直打印"全部通过（7 项）"，实际有三条断言在裸奔：
//   · `scripts/e2e-full.mjs` 查的 `otmVgt*` 三个 id 从 v336 起就不存在了（改名成 `probOtm*`）
//   · `scripts/test-options.mjs` 从 v297 起没先打开期权录入弹层就去 `fill('#ostrike')`
// 所以"防腐烂"必须钉住驱动本身：它要读返回值里的失败信息（`scripts/e2e/verdict.mjs`），
// 并在判定失败时以非 0 退出码结束。
test('常跑入口必须真的会红：驱动要读返回值里的失败信息，不能只看"脚本有没有 throw"', () => {
  for (const rel of ['scripts/e2e/driver.mjs', 'scripts/e2e/driver-engine.mjs']) {
    const src = fs.readFileSync(rel, 'utf8');
    assert.match(src, /import \{ failureOf \} from '\.\/verdict\.mjs'/, rel + '：没接入 verdict 判据');
    assert.match(src, /const verdict = failureOf\(result\)/, rel + '：没有对返回值做失败判定');
    assert.match(src, /if \(verdict\) \{[\s\S]{0,160}?process\.exit\(1\)/,
      rel + '：判定失败时没有以非 0 退出码结束（run-all 会继续报"全部通过"）');
  }
  assert.ok(fs.existsSync('scripts/e2e/verdict.mjs'), 'verdict.mjs 必须存在（判据的唯一来源）');
});
