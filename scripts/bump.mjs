// 版本号自动升级：一次改完 sw.js / manifest.json / app.js / tests，并自检
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const SW = 'public/sw.js';
const MANIFEST = 'public/manifest.json';
const APP = 'src/app/index.js';
const TESTS = 'tests/smoke.test.mjs';

const dry = process.argv.includes('--dry');
const read = (f) => fs.readFileSync(f, 'utf8');
const write = (f, s) => {
  if (!dry) fs.writeFileSync(f, s, 'utf8');
};
const need = (src, from, to, label) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`[${label}] 期望命中 1 次，实际 ${n} 次`);
  return src.split(from).join(to);
};

const sw = read(SW);
const found = sw.match(/wealth-v(\d+)/);
if (!found) throw new Error('sw.js 里找不到 wealth-vN 版本号');
const cur = Number(found[1]);
const next = cur + 1;

const manifest = JSON.parse(read(MANIFEST));
const curManifestVer = String(manifest.version);
const nextManifestVer = String((Math.round(Number(curManifestVer) * 10) + 1) / 10);

const changed = [];

// 1) sw.js：注释版本 + cache 名
let swNext = need(sw, `// Service Worker v${cur} `, `// Service Worker v${next} `, 'sw 注释');
swNext = need(swNext, `var CACHE = 'wealth-v${cur}';`, `var CACHE = 'wealth-v${next}';`, 'sw cache');
write(SW, swNext);
changed.push(`sw.js        → v${next} (cache wealth-v${next})`);

// 2) manifest.json：start_url + version
let manifestNext = need(read(MANIFEST), `/?v=${cur}`, `/?v=${next}`, 'manifest start_url');
manifestNext = need(manifestNext, `"version": "${curManifestVer}"`, `"version": "${nextManifestVer}"`, 'manifest version');
write(MANIFEST, manifestNext);
changed.push(`manifest.json → start_url ?v=${next}, version ${curManifestVer} → ${nextManifestVer}`);

// 3) app.js：Service Worker 注册 URL + 构建版本常量
let appNext = need(read(APP), `sw.js?v=${cur}`, `sw.js?v=${next}`, 'app 注册 URL');
appNext = need(appNext, `var APP_BUILD='v${cur}';`, `var APP_BUILD='v${next}';`, 'app 构建版本');
write(APP, appNext);
changed.push(`app.js       → register sw.js?v=${next}, APP_BUILD v${next}`);

// 4) tests：三处断言
let tests = read(TESTS);
tests = need(tests, `assert.equal(manifest.start_url, '/?v=${cur}');`, `assert.equal(manifest.start_url, '/?v=${next}');`, 'test start_url');
tests = need(tests, `/wealth-v${cur}/`, `/wealth-v${next}/`, 'test cache');
tests = need(tests, `sw\\.js\\?v=${cur}`, `sw\\.js\\?v=${next}`, 'test register');
write(TESTS, tests);
changed.push(`tests        → 3 处断言同步到 v${next}`);

console.log((dry ? '[dry-run] ' : '') + `版本 v${cur} → v${next}`);
changed.forEach((line) => console.log('  ' + line));

if (dry) process.exit(0);

// 5) 自检：跑测试，失败就提示（不自动回滚，让使用者看到具体哪里没对上）
const check = spawnSync(process.execPath, ['--test', 'tests/smoke.test.mjs'], { encoding: 'utf8' });
if (check.status !== 0) {
  console.error('\n⚠ 测试未通过，请检查是否还有遗漏的版本号引用：');
  console.error((check.stdout || '') + (check.stderr || ''));
  process.exit(1);
}

// 版本号写的是源文件，必须重新打包，产物才会带上新版本
const bundle = spawnSync(process.execPath, ['scripts/bundle.mjs'], { encoding: 'utf8' });
if (bundle.status !== 0) {
  console.error('\n⚠ 打包失败：');
  console.error((bundle.stdout || '') + (bundle.stderr || ''));
  process.exit(1);
}
console.log((bundle.stdout || '').trim());
console.log('✓ 测试通过、产物已重建，可以直接提交部署');
