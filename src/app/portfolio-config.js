// 核心组合的唯一配置源。标的顺序、目标比例、持久化键和展示信息都从这里派生，
// 避免定投、再平衡、交易白名单、图表和备份各自维护一份后逐渐漂移。

export const CORE_PORTFOLIO = Object.freeze([
  Object.freeze({
    sym: 'QQQM',
    stateKey: 'qqqm',
    target: 0.5,
    name: 'Invesco NASDAQ 100 ETF',
    shortName: 'Invesco 纳指100',
    colorToken: '--orange',
  }),
  Object.freeze({
    sym: 'VGT',
    stateKey: 'vgt',
    target: 0.3,
    name: 'Vanguard Information Tech ETF',
    shortName: 'Vanguard 信息科技',
    colorToken: '--violet',
  }),
  Object.freeze({
    sym: 'SMH',
    stateKey: 'smh',
    target: 0.2,
    name: 'VanEck Semiconductor ETF',
    shortName: 'VanEck 半导体',
    colorToken: '--blue',
  }),
]);

export const CORE_SYMBOLS = Object.freeze(CORE_PORTFOLIO.map((item) => item.sym));

export const CORE_TARGETS = Object.freeze(CORE_PORTFOLIO.reduce((out, item) => {
  out[item.sym] = item.target;
  return out;
}, {}));

export const TARGET_STATE = Object.freeze(CORE_PORTFOLIO.reduce((out, item) => {
  out[item.stateKey] = item.target;
  return out;
}, {}));

export const LEG_STATE_KEY = Object.freeze(CORE_PORTFOLIO.reduce((out, item) => {
  out[item.sym] = item.stateKey;
  return out;
}, {}));

export const PRICE_SYMBOLS = Object.freeze(CORE_SYMBOLS.reduce((out, sym) => {
  out[sym] = sym;
  return out;
}, {}));

export const ETF_NAMES = Object.freeze(CORE_PORTFOLIO.reduce((out, item) => {
  out[item.sym] = item.shortName;
  return out;
}, {}));

export const ETF_FULL_NAMES = Object.freeze(CORE_PORTFOLIO.reduce((out, item) => {
  out[item.sym] = item.name;
  return out;
}, {}));

export const ETF_COLOR_TOKENS = Object.freeze(CORE_PORTFOLIO.reduce((out, item) => {
  out[item.sym] = item.colorToken;
  return out;
}, {}));

// v433：核心仓退役标的。仅用于迁移、备份兼容和旧客户端宽限，不进入新组合。
export const RETIRED_CORE_SYMBOLS = Object.freeze(['IBIT']);
