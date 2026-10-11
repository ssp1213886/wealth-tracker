/**
 * 「这批场景脚本到底算不算失败」的唯一判据（v389）。
 *
 * 背景：`run-all.mjs` / `run.mjs` 只看 driver 的**退出码**，而 driver 原来无论脚本内部断言挂没挂都退 0 ——
 * 于是常跑入口一直报"全部通过（7 项）"，实际有三条断言在裸奔，烂了 50 多个版本没人发现：
 *   · `scripts/e2e-full.mjs` 查的 `otmVgt*` 三个 id 从 v336 起就不存在了（改名成 `probOtm*`）
 *   · `scripts/test-options.mjs` 从 v297 起没先打开期权录入弹层就去 `fill('#ostrike')`
 * 现在 driver 用这个函数把"返回值里的失败信息"翻成非 0 退出码。
 *
 * 约定 —— 场景脚本要么自己 `throw`，要么用返回值的下面三个字段表达失败：
 *   · `failed > 0`           计数式（`scripts/e2e-full.mjs`）
 *   · `log` 里任一 `ok:false` 步骤式（`scripts/test-options.mjs`、`scripts/test-backup.mjs`）
 *   · `lastError` 非空        运行期未捕获错误
 * 返回失败原因（字符串）；没问题返回 null。
 */
export function failureOf(result) {
  if (!result || typeof result !== 'object') return null;
  const failed = Number(result.failed);
  if (Number.isFinite(failed) && failed > 0) return '脚本自报 ' + failed + ' 项失败';
  if (Array.isArray(result.log)) {
    const bad = result.log.filter(function (step) { return step && step.ok === false; });
    if (bad.length) {
      return '步骤失败 ' + bad.length + ' 项：' +
        bad.map(function (step) { return String(step.step); }).slice(0, 3).join(' / ');
    }
  }
  if (result.lastError) return '运行期有未捕获错误：' + String(result.lastError).slice(0, 120);
  return null;
}
