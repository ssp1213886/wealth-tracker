// 观察列表搜索：内置名单 + 匹配逻辑（从 index.js 抽出，便于单测与维护）。
// 名单 = 手写的中文别名表（LIST/LIST2） + 维基百科成分表生成的 S&P100 ∪ 纳斯达克100（IDX）。
// 匹配规则与抽取前完全一致：先别名表（代码前缀优先、其次名称子串），再查 IDX
// （代码完全相等放行 → 代码前缀/名称子串，并过滤杠杆反向 ETF 噪音），去重后取前 N 条。

const LIST=[
  ['VGT','Vanguard Information Tech ETF','先锋信息科技'],['SMH','VanEck Semiconductor ETF','半导体'],['BTCETF','Grayscale Bitcoin Mini Trust','比特币ETF'],['BTC','Bitcoin','比特币'],['ETH','Ethereum','以太坊'],['BNB','Binance Coin','币安币'],['HYPE','Hyperliquid',''],['SOL','Solana','索拉纳'],
  ['VOO','Vanguard S&P 500 ETF','标普500'],['QQQM','Invesco Nasdaq 100 ETF','纳斯达克100'],['QQQ','Invesco QQQ Trust','纳指ETF'],['SPY','SPDR S&P 500 ETF','标普500ETF'],['DIA','SPDR Dow Jones Industrial','道指'],['IWM','iShares Russell 2000 ETF',''],['SCHD','Schwab US Dividend Equity',''],
  ['GOLD','Gold','黄金'],['GLD','SPDR Gold Shares','黄金ETF'],['SLV','iShares Silver Trust','白银'],['TLT','iShares 20+ Year Treasury','长债'],['SGOV','iShares 0-3 Month Treasury','短债'],['ARKK','ARK Innovation ETF',''],['SOXX','iShares Semiconductor ETF','半导体ETF'],['XLK','Technology Select Sector SPDR',''],
  ['NVDA','NVIDIA Corp','英伟达'],['AAPL','Apple Inc','苹果'],['MSFT','Microsoft Corp','微软'],['GOOGL','Alphabet Inc','谷歌'],['AMZN','Amazon.com Inc','亚马逊'],['META','Meta Platforms Inc','脸书'],['TSLA','Tesla Inc','特斯拉'],['AVGO','Broadcom Inc','博通'],['TSM','Taiwan Semiconductor','台积电'],['AMD','Advanced Micro Devices','超威'],['MU','Micron Technology','美光'],['INTC','Intel Corp','英特尔'],['ASML','ASML Holding','阿斯麦'],['SMCI','Super Micro Computer',''],['PLTR','Palantir Technologies',''],['CRCL','Circle Internet Group',''],['MSTR','MicroStrategy Inc','微策略'],['COIN','Coinbase Global',''],['NFLX','Netflix Inc','奈飞'],['DIS','Walt Disney Co','迪士尼'],['ORCL','Oracle Corp','甲骨文'],['ADBE','Adobe Inc',''],['UBER','Uber Technologies',''],['BABA','Alibaba Group','阿里'],['PDD','PDD Holdings','拼多多'],['JD','JD.com','京东'],['V','Visa Inc',''],['MA','Mastercard Inc',''],['JPM','JPMorgan Chase','摩根大通'],['WMT','Walmart Inc','沃尔玛'],['COST','Costco Wholesale','好市多'],
  ['IBIT','iShares Bitcoin Trust',''],['FBTC','Fidelity Wise Origin Bitcoin',''],['ETHA','iShares Ethereum Trust',''],['DOGE','Dogecoin','狗狗币'],['XRP','XRP','瑞波'],['ADA','Cardano','艾达币'],['AVAX','Avalanche',''],['LINK','Chainlink','']
];
/* 补充表（v216）：常见大票与 ETF，带中文别名 */
const LIST2=[
  ['BRK-B','Berkshire Hathaway B','伯克希尔'],['BRK-A','Berkshire Hathaway A','伯克希尔A'],
  ['UNH','UnitedHealth Group','联合健康'],['XOM','Exxon Mobil','埃克森美孚'],['LLY','Eli Lilly','礼来'],['NVO','Novo Nordisk','诺和诺德'],
  ['QCOM','Qualcomm Inc','高通'],['ARM','Arm Holdings','安谋'],['SHOP','Shopify Inc',''],
  ['MS','Morgan Stanley','摩根士丹利'],['GS','Goldman Sachs','高盛'],['BAC','Bank of America','美国银行'],
  ['KO','Coca-Cola','可口可乐'],['PEP','PepsiCo','百事'],['MCD','McDonalds','麦当劳'],['NKE','Nike Inc','耐克'],
  ['SBUX','Starbucks','星巴克'],['BA','Boeing Co','波音'],['CAT','Caterpillar','卡特彼勒'],['CVX','Chevron','雪佛龙'],
  ['TMO','Thermo Fisher','赛默飞'],['ABBV','AbbVie Inc','艾伯维'],['MRK','Merck and Co','默沙东'],['PFE','Pfizer Inc','辉瑞'],
  ['T','AT&T',''],['VZ','Verizon',''],['CMCSA','Comcast',''],['TMUS','T-Mobile US',''],
  ['EFA','iShares MSCI EAFE ETF','发达国家'],['EEM','iShares MSCI Emerging Markets','新兴市场'],['BND','Vanguard Total Bond Market','债券'],
  ['VXUS','Vanguard Total International','国际'],['VNQ','Vanguard Real Estate ETF','房地产'],
  ['XLF','Financial Select Sector SPDR','金融'],['XLE','Energy Select Sector SPDR','能源'],['XLV','Health Care Select Sector SPDR','医疗'],['XLY','Consumer Discretionary SPDR','消费']
];

const IDX=[["AAPL","Apple Inc."],["ABBV","AbbVie"],["ABNB","Airbnb"],["ABT","Abbott Laboratories"],["ACN","Accenture"],["ADBE","Adobe Inc."],["ADI","Analog Devices"],["ADP","Automatic Data Processing"],["ADSK","Autodesk"],["AEP","American Electric Power"],["ALAB","Astera Labs"],["ALNY","Alnylam Pharmaceuticals"],["AMAT","Applied Materials"],["AMD","Advanced Micro Devices"],["AMGN","Amgen"],["AMT","American Tower"],["AMZN","Amazon"],["ANET","Arista Networks"],["APP","AppLovin"],["ARM","Arm Holdings"],["ASML","ASML Holding"],["AVGO","Broadcom"],["AXON","Axon Enterprise"],["AXP","American Express"],["BA","Boeing"],["BAC","Bank of America"],["BKNG","Booking Holdings"],["BKR","Baker Hughes"],["BLK","BlackRock"],["BMY","Bristol Myers Squibb"],["BNY","BNY Mellon"],["BRK-B","Berkshire Hathaway"],["C","Citigroup"],["CAT","Caterpillar Inc."],["CCEP","Coca-Cola Europacific Partners"],["CDNS","Cadence Design Systems"],["CEG","Constellation Energy"],["CMCSA","Comcast"],["COF","Capital One"],["COP","ConocoPhillips"],["COST","Costco"],["CPRT","Copart"],["CRM","Salesforce"],["CRWD","CrowdStrike"],["CRWV","CoreWeave"],["CSCO","Cisco"],["CSX","CSX Corporation"],["CTAS","Cintas"],["CVS","CVS Health"],["CVX","Chevron Corporation"],["DASH","DoorDash"],["DDOG","Datadog"],["DE","Deere & Company"],["DELL","Dell Technologies"],["DHR","Danaher Corporation"],["DIS","Walt Disney Company"],["DUK","Duke Energy"],["DXCM","DexCom"],["EMR","Emerson Electric"],["EXC","Exelon"],["FANG","Diamondback Energy"],["FAST","Fastenal"],["FDX","FedEx"],["FER","Ferrovial"],["FTNT","Fortinet"],["GD","General Dynamics"],["GE","GE Aerospace"],["GEHC","GE HealthCare"],["GEV","GE Vernova"],["GILD","Gilead Sciences"],["GM","General Motors"],["GOOG","Alphabet Inc."],["GOOGL","Alphabet Inc."],["GS","Goldman Sachs"],["HD","Home Depot"],["HON","Honeywell Technologies"],["HONA","Honeywell Aerospace"],["IBM","IBM"],["IDXX","Idexx Laboratories"],["INTC","Intel"],["INTU","Intuit"],["ISRG","Intuitive Surgical"],["JNJ","Johnson & Johnson"],["JPM","JPMorgan Chase"],["KDP","Keurig Dr Pepper"],["KLAC","KLA Corporation"],["KO","Coca-Cola Company"],["LIN","Linde plc"],["LITE","Lumentum"],["LLY","Eli Lilly and Company"],["LMT","Lockheed Martin"],["LOW","Lowe's"],["LRCX","Lam Research"],["MA","Mastercard"],["MAR","Marriott International"],["MCD","McDonald's"],["MCHP","Microchip Technology"],["MDLZ","Mondelēz International"],["MDT","Medtronic"],["MELI","Mercado Libre"],["META","Meta Platforms"],["MMM","3M"],["MNST","Monster Beverage"],["MO","Altria"],["MPWR","Monolithic Power Systems"],["MRK","Merck & Co."],["MRVL","Marvell Technology"],["MS","Morgan Stanley"],["MSFT","Microsoft"],["MSTR","MicroStrategy"],["MU","Micron Technology"],["NBIS","Nebius Group"],["NEE","NextEra Energy"],["NFLX","Netflix, Inc."],["NOW","ServiceNow"],["NVDA","Nvidia"],["NXPI","NXP Semiconductors"],["ODFL","Old Dominion Freight Line"],["ORCL","Oracle Corporation"],["ORLY","O'Reilly Automotive"],["PANW","Palo Alto Networks"],["PAYX","Paychex"],["PCAR","Paccar"],["PDD","PDD Holdings"],["PEP","PepsiCo"],["PFE","Pfizer"],["PG","Procter & Gamble"],["PLTR","Palantir Technologies"],["PM","Philip Morris International"],["PYPL","PayPal"],["QCOM","Qualcomm"],["REGN","Regeneron Pharmaceuticals"],["RKLB","Rocket Lab"],["ROP","Roper Technologies"],["ROST","Ross Stores"],["RTX","RTX Corporation"],["SBUX","Starbucks"],["SCHW","Charles Schwab Corporation"],["SHOP","Shopify"],["SNDK","Sandisk"],["SNPS","Synopsys"],["SO","Southern Company"],["SPCX","SpaceX"],["STX","Seagate Technology"],["T","AT&T"],["TER","Teradyne"],["TMO","Thermo Fisher Scientific"],["TMUS","T-Mobile US"],["TRI","Thomson Reuters"],["TSLA","Tesla, Inc."],["TTWO","Take-Two Interactive"],["TXN","Texas Instruments"],["UBER","Uber"],["UNH","UnitedHealth Group"],["UNP","Union Pacific Corporation"],["UPS","United Parcel Service"],["USB","U.S. Bancorp"],["V","Visa Inc."],["VRTX","Vertex Pharmaceuticals"],["VZ","Verizon"],["WBD","Warner Bros. Discovery"],["WDAY","Workday, Inc."],["WDC","Western Digital"],["WFC","Wells Fargo"],["WMT","Walmart"],["XEL","Xcel Energy"],["XOM","ExxonMobil"]];
const IDXL=IDX.map(function(r){return [r[0],r[1],String(r[0]||'').toLowerCase(),String(r[1]||'').toLowerCase()]});
/* 噪音：杠杆/反向/日频 ETF（仅代码完全相同时放行） */
const JUNK=/2x|3x|short|leverage|inverse|ultra|bull|bear|daily/i;

const ALL=LIST.concat(LIST2);

export { JUNK };

/** 搜索：返回 [代码, 名称] 数组（limit 默认 8）。 */
export function searchSymbols(query, limit) {
  var q=String(query||'').trim().toLowerCase();
  if(!q)return[];
  var pre=[],mid=[],seen={};
  var addHit=function(sym,name){var k=String(sym||'').toUpperCase();if(!k||seen[k])return;seen[k]=1;(k.toLowerCase().indexOf(q)===0?pre:mid).push([k,name])};
  for(var i=0;i<ALL.length&&(pre.length+mid.length)<24;i+=1){
    var it=ALL[i],sym=it[0].toLowerCase(),en=String(it[1]||'').toLowerCase(),cn=String(it[2]||'').toLowerCase();
    if(sym.indexOf(q)===0||en.indexOf(q)>=0||(cn&&cn.indexOf(q)>=0))addHit(it[0],it[1]);
  }
  for(var i4=0;i4<IDXL.length;i4+=1){
    var r4=IDXL[i4];
    if(seen[r4[0]])continue;
    if(r4[2]===q)addHit(r4[0],r4[1]);
    else if(r4[2].indexOf(q)===0||r4[3].indexOf(q)>=0){if(!JUNK.test(r4[3]))addHit(r4[0],r4[1])}
  }
  return pre.concat(mid).slice(0,limit===undefined?8:limit);
}

export const SEARCH_LIST_COUNT = LIST.length;
export const SEARCH_INDEX_COUNT = IDX.length;
