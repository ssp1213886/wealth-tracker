// 云同步的"决策层"：拉取逐键判定、推送脏键、409 核对计划。
// 这里只做判断，不碰网络/存储/DOM（事实由调用方算好传进来），因此可以离线单测。
// 背景：v141 那批"永远消不掉的假冲突"就出在这套判定里，所以它值得被测试钉住。

/** 实际会推送出去的业务键（payload 里除 prices/__expectedVersions 之外有值的键）。 */
export function pushedKeysOf(payload, keys) {
  const out = [];
  (keys || []).forEach(function (k) {
    if (payload && Object.prototype.hasOwnProperty.call(payload, k)) out.push(k);
  });
  return out;
}

/** 当前处于"待同步"状态的键。 */
export function pendingDirtyKeys(state, keys) {
  const dirty = (state && state.dirty) || {};
  return (keys || []).filter(function (k) { return !!dirty[k]; });
}

/** 只带 prices/版本戳（没有业务键）时不必推送——省一次请求，也避免刷无意义的 log。 */
export function shouldSkipPush(payload, keys) {
  return pushedKeysOf(payload, keys).length === 0;
}

/**
 * 拉取时"单个键该做什么"。事实全部由调用方算好：
 *   hasCloud      云端有这一行
 *   hasLocal      本地有这一份数据
 *   cloudEmpty    云端这一行是空值（空数组/空对象/空串/0）
 *   equal         本地与云端内容等价（state 会先归一化再比）
 *   cloudChanged  云端版本号和"我上次见到的"不一样（不知道版本时按 true）
 *   dirty         本地有未推送的改动
 *
 * 返回的动作：
 *   'mark-dirty-drop-ts' 云端没有该行 → 本地为准，标脏等推送，并忘掉旧版本号
 *   'adopt-ts'           本地没有、云端也是空 → 什么都不做，只记下版本号
 *   'apply-cloud'        用云端覆盖本地（含"本地没有"和"云端更新且本地没改过"）
 *   'clear-dirty'        内容一致 → 清脏标记、记下版本号
 *   'conflict'           云端更新了、本地也改过 → 交给用户确认
 *   'keep-local'         云端没变、本地有改动 → 等推送（不动）
 *   'mark-dirty'         其余情况（两边都有但既没变也没脏）→ 标脏，下次推上去
 */
export function decidePullAction(f) {
  const x = f || {};
  if (!x.hasCloud) return x.hasLocal ? 'mark-dirty-drop-ts' : 'nothing';
  if (!x.hasLocal) return x.cloudEmpty ? 'adopt-ts' : 'apply-cloud';
  if (x.equal) return 'clear-dirty';
  if (x.cloudChanged && x.dirty) return 'conflict';
  if (x.cloudChanged && !x.dirty) return 'apply-cloud';
  if (!x.cloudChanged && x.dirty) return 'keep-local';
  return 'mark-dirty';
}

/**
 * 把整轮拉取算成一份执行计划（不再直接改全局状态）。
 * 调用方随后按 applies 调 applyCloudVal、按 conflicts 弹冲突框、把 dirty/cloudTs 存回去。
 */
export function planPullSync(opts) {
  const o = opts || {};
  const keys = o.keys || [];
  const cloudData = o.cloudData || {};
  const meta = o.meta || {};
  const state = o.state || {};
  const normalizeTs = o.normalizeTs || function (v) { return Number(v) || 0; };
  const dirty = Object.assign({}, state.dirty || {});
  const cloudTs = Object.assign({}, state.cloudTs || {});
  const conflicts = [];
  const pendingCloud = {};
  const applies = [];

  keys.forEach(function (key) {
    const cv = cloudData[key];
    const cTs = normalizeTs(meta[key]);              // 缺版本号时是 0（不是 undefined）
    const lastTs = cloudTs[key];
    const hasC = typeof o.hasCloud === 'function' ? !!o.hasCloud(key, cv) : (cv !== undefined && cv !== null);
    const hasL = typeof o.hasLocal === 'function' ? !!o.hasLocal(key) : false;
    const cloudChanged = cTs !== lastTs;             // 不知道见过的版本 → 视为"云端变过"
    const action = decidePullAction({
      hasCloud: hasC,
      hasLocal: hasL,
      cloudEmpty: typeof o.isEmptyCloud === 'function' ? !!o.isEmptyCloud(cv) : false,
      equal: (hasC && hasL && typeof o.equal === 'function') ? !!o.equal(key) : false,
      cloudChanged: cloudChanged,
      dirty: !!dirty[key],
    });
    if (action === 'mark-dirty-drop-ts') {
      dirty[key] = true;
      delete cloudTs[key];
    } else if (action === 'adopt-ts') {
      dirty[key] = false;
      if (cTs) cloudTs[key] = cTs;
    } else if (action === 'apply-cloud') {
      applies.push(key);
      dirty[key] = false;
      if (cTs) cloudTs[key] = cTs;
    } else if (action === 'clear-dirty') {
      dirty[key] = false;
      if (cTs) cloudTs[key] = cTs;
    } else if (action === 'conflict') {
      conflicts.push(key);
      pendingCloud[key] = cv;
    } else if (action === 'mark-dirty') {
      dirty[key] = true;
    }
  });
  return { applies: applies, conflicts: conflicts, pendingCloud: pendingCloud, dirty: dirty, cloudTs: cloudTs };
}

/**
 * 推送撞上 409 后的"核对计划"：逐键看云端到底是不是和本机一样。
 * 一样 → 静默对齐（清脏 + 记版本号）；不一样 → 进 diff 交给冲突弹窗；
 * 云端没有这一行 → 忘掉版本号并标脏，下次推送会重新建立。
 */
export function planConflictHeal(opts) {
  const o = opts || {};
  const state = o.state || {};
  const cloudData = o.cloudData || {};
  const meta = o.meta || {};
  const normalizeTs = o.normalizeTs || function (v) { return Number(v) || 0; };
  const dirty = Object.assign({}, state.dirty || {});
  const cloudTs = Object.assign({}, state.cloudTs || {});
  const diff = [];
  (o.sentKeys || []).forEach(function (key) {
    const cv = cloudData[key];
    if (cv === undefined || cv === null) {
      delete cloudTs[key];
      dirty[key] = true;
      return;
    }
    if (typeof o.equal === 'function' && o.equal(key)) {
      dirty[key] = false;
      const ts = normalizeTs(meta[key]);
      if (ts) cloudTs[key] = ts;
      return;
    }
    diff.push(key);
  });
  return { diff: diff, dirty: dirty, cloudTs: cloudTs };
}
