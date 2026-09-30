#!/usr/bin/env node
// 忘密码时的兜底：清空 accounts 表，让"服务器密码"重新变成主账号密码。
//
// 为什么这样就救得回来：首次登录引导的规则是「accounts 为空 + 输入等于服务器密钥
// （AUTH_TOKEN / APP_PASSWORD）→ 就用这个用户名建 owner(id=1)」。而你的数据一直挂在
// user_id=1 名下，所以重建出来的 owner 会直接接管全部数据。
//
// ⚠️ 副作用：其它账号（id ≥ 2）的登录入口会一并清掉，它们的数据行还在但暂时没人能访问；
//    真要保留就先把那份 JSON 导出（App 里"导出备份"或删除账号时自动导出）。
//
// 用法：
//   npm run account:reset            # 只看有哪些账号
//   npm run account:reset -- --force # 确认清空
import { spawnSync } from 'node:child_process';

const DB = 'wealth-db';
const force = process.argv.includes('--force');

function run(sql) {
  const out = spawnSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', sql], {
    encoding: 'utf8',
    shell: true,
  });
  const text = (out.stdout || '') + (out.stderr || '');
  if (out.status !== 0) {
    console.error('执行失败：\n' + text.slice(-800));
    process.exit(1);
  }
  try {
    const parsed = JSON.parse(out.stdout);
    return (parsed[0] && parsed[0].results) || [];
  } catch (e) {
    return [];
  }
}

const accounts = run('SELECT id, username, role, disabled FROM accounts ORDER BY id');
console.log('当前账号（' + accounts.length + ' 个）：');
if (!accounts.length) console.log('  （还没有账号）');
accounts.forEach((row) => {
  console.log('  id=' + row.id + '  ' + row.username + '  ' + row.role + (Number(row.disabled) ? '  [已禁用]' : ''));
});

if (!force) {
  console.log('\n这只是查看。要清空账号表（忘密码时用）请加 --force：');
  console.log('  npm run account:reset -- --force\n');
  console.log('清空后：用「服务器密钥」当密码登录，会重新建立 owner（id=1）并接管原有数据。');
  console.log('如果连服务器密钥也忘了：先 `npx wrangler secret put APP_PASSWORD` 设一个新的，再执行本命令。');
  process.exit(0);
}

console.log('\n正在清空 accounts 表…');
run('DELETE FROM accounts');
const after = run('SELECT COUNT(*) AS n FROM accounts');
console.log('已清空（剩余 ' + ((after[0] && after[0].n) || 0) + ' 个账号）。数据行未删除。');
console.log('\n下一步：打开 App → 用「你想用的用户名」+「服务器密钥」登录 → 它会成为主账号并接管数据。');
