import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

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
const assetFiles = ['public/assets/app.js'];
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

// 样式债预算：!important 只许减少，不许增加
const cssSource = fs.readFileSync('public/assets/main.css', 'utf8');
const importantCount = (cssSource.match(/!important/g) || []).length;
const IMPORTANT_BUDGET = 1609;
if (importantCount > IMPORTANT_BUDGET) {
  errors.push(
    'public/assets/main.css: !important 数量 ' + importantCount + ' 超过预算 ' + IMPORTANT_BUDGET +
      '；请用更具体的语义选择器（如 td[data-cell="x"]）替代，而不是新增 !important',
  );
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(
  'lint passed (' + (sourceFiles.length + assetFiles.length) + ' files) · !important ' +
    importantCount + '/' + IMPORTANT_BUDGET,
);
