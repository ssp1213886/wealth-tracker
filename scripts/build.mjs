import fs from 'node:fs';

const files = [
  'public/index.html',
  'public/assets/main.css',
  'public/assets/app.js',
  'public/sw.js',
  'public/manifest.json',
  'public/guide.html',
  'public/icon.png',
];
for (const file of files) {
  if (!fs.existsSync(file)) throw new Error('Missing build input: ' + file);
}
console.log('build validation passed (' + files.length + ' files)');
