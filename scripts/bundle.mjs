// 用 esbuild 把 src/app/index.js 打包成单文件产物 public/assets/app.js
// 产物仍是浏览器直接可跑的单文件（IIFE），部署方式不变。
import { build } from 'esbuild';

const outfile = 'public/assets/app.js';

const result = await build({
  entryPoints: ['src/app/index.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2019'],
  charset: 'utf8',
  legalComments: 'none',
  outfile,
  metafile: true,
  logLevel: 'warning',
});

const bytes = Object.values(result.metafile.outputs)[0].bytes;
console.log('bundle ok → ' + outfile + ' (' + Math.round(bytes / 1024) + 'KB)');
