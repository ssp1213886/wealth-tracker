import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { checkStyles, IMPORTANT_BUDGET } from './css-guard.mjs';

const sourceFiles = [
  'src/worker.js',
  'src/lib/auth.js',
  'src/lib/assets.js',
  'src/lib/http.js',
  'src/lib/price.js',
  'src/lib/rate-limit.js',
  'src/lib/sync.js',
  'scripts/lan-preview.mjs',
  'scripts/build.mjs',
];
const assetFiles = ['src/app/index.js'];
let errors = [];

for (const file of [...sourceFiles, ...assetFiles]) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) errors.push((check.stderr || check.stdout).trim());
}

for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8');
  if (/\bdebugger\b/.test(source)) errors.push(file + ': debugger statement');
}

const html = fs.readFileSync('public/index.html', 'utf8');
if (!html.includes('/assets/main.css')) errors.push('public/index.html: missing main.css reference');
if (!html.includes('/assets/app.js')) errors.push('public/index.html: missing app.js reference');

// 样式债守卫：!important 只减不增 + :hover 必须包在可悬停媒体查询里（实现见 scripts/css-guard.mjs）
const cssSource = fs.readFileSync('public/assets/main.css', 'utf8');
const styleCheck = checkStyles(cssSource, IMPORTANT_BUDGET);
styleCheck.errors.forEach((message) => errors.push(message));

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(
  'lint passed (' + (sourceFiles.length + assetFiles.length) + ' files) · !important ' +
    styleCheck.important + '/' + IMPORTANT_BUDGET +
    ' · :hover 包裹 ' + styleCheck.hoverWrapped + '/' + styleCheck.hoverAll,
);
