// Arbitragem de stablecoins (08/11): mapa global de preços de USDC, USDT, BRL e USD em corretoras (globais e brasileiras) e
// em DEX, com o resultado LÍQUIDO de taxas. Três tipos:
//   1) mesma dupla entre plataformas (compra onde está mais barato, vende onde está mais caro, com estoque nas duas);
//   2) triangular: BRL → USDT → USDC → BRL (ou o inverso), numa corretora só ou combinando corretoras; o mesmo com USD;
//   3) CEX × DEX: o preço que um agregador de DEX entrega para US$1.000, já com a taxa do pool e o custo de rede.
// Só lê dados públicos. Oportunidade que não persiste entre duas leituras (3 min) é tratada como "fantasma": o papel só
// executa o que continua lá na leitura seguinte, pelo preço dessa leitura (o que daria para pegar de verdade).
// Taxas: as de balcão (taker) do nível básico de cada plataforma, de tabelas públicas e comparativos de 2026; as oficiais
// pedem login e há promoções que zeram taxa de stable. São estimativas editáveis, e o painel mostra o bruto ao lado do líquido.

const SOL_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', SOL_USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const ARB_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', ARB_USDT = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', BASE_USDT = '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2';
const ETH_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', ETH_USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

// kind: cex (corretora), br (corretora brasileira com Pix), dex (sem cadastro, carteira própria). exec: o robô sabe operar.
export const VENUES = {
  binance: { name: 'Binance', kind: 'cex', fee: 0.10, exec: true },
  okx: { name: 'OKX', kind: 'cex', fee: 0.10, exec: true },
  bybit: { name: 'Bybit', kind: 'cex', fee: 0.10, exec: true },
  kucoin: { name: 'KuCoin', kind: 'cex', fee: 0.10, exec: true },
  gate: { name: 'Gate', kind: 'cex', fee: 0.20 },
  mexc: { name: 'MEXC', kind: 'cex', fee: 0.05 },
  bitget: { name: 'Bitget', kind: 'cex', fee: 0.10 },
  htx: { name: 'HTX', kind: 'cex', fee: 0.20 },
  kraken: { name: 'Kraken', kind: 'cex', fee: 0.20 },
  coinbase: { name: 'Coinbase', kind: 'cex', fee: 0.60 },
  bitstamp: { name: 'Bitstamp', kind: 'cex', fee: 0.40 },
  foxbit: { name: 'Foxbit', kind: 'br', fee: 0.50, exec: true },
  mb: { name: 'Mercado Bitcoin', kind: 'br', fee: 0.70 },
  bitso: { name: 'Bitso', kind: 'br', fee: 0.65 },
  ripio: { name: 'Ripio', kind: 'br', fee: 0.50 },
  bitpreco: { name: 'BitPreço', kind: 'br', fee: 0.30 },
  novadax: { name: 'NovaDAX', kind: 'br', fee: 0.50 },
  hyperliquid: { name: 'Hyperliquid', kind: 'dex', fee: 0.07 },
  jupiter: { name: 'Jupiter (Solana)', kind: 'dex', fee: 0 },
  kyberArb: { name: 'KyberSwap (Arbitrum)', kind: 'dex', fee: 0 },
  kyberBase: { name: 'KyberSwap (Base)', kind: 'dex', fee: 0 },
  paraswap: { name: 'ParaSwap (Ethereum)', kind: 'dex', fee: 0 }
};
export const ARB_RULES = { sizeUsd: 1000, minNetPct: 0.05, paperTradeUsd: 200, paperStockUsd: 1000, rebalanceUsd: 1, rebalanceLowPct: 20, keepSeries: 2000, maxStaleMs: 5 * 60e3 };

const n = (x) => (x === null || x === undefined || x === '' ? NaN : +x);
const q = (v, pair, bid, ask, bq, aq, extra) => { const b = n(bid), a = n(ask); return b > 0 && a > 0 && a >= b * 0.97 && a <= b * 1.03 ? Object.assign({ v, pair, bid: b, ask: a, bq: n(bq) || null, aq: n(aq) || null }, extra || {}) : null; };
const inv = (x) => (x > 0 ? 1 / x : NaN);

// Fontes públicas: url (+ corpo para POST) e como ler. Cada uma pode falhar sozinha; o erro fica registrado por fonte.
export function arbSources() {
  const dex = (v, url, outPath, gasPath) => ({ v, url, parse: (j) => ({ out: n(outPath(j)), gas: gasPath ? n(gasPath(j)) || 0 : 0 }) });
  return [
    { v: 'binance', url: 'https://data-api.binance.vision/api/v3/ticker/bookTicker?symbols=%5B%22USDCUSDT%22,%22USDTBRL%22,%22USDCBRL%22%5D',
      parse: (j) => (j || []).map((x) => q('binance', { USDCUSDT: 'USDC/USDT', USDTBRL: 'USDT/BRL', USDCBRL: 'USDC/BRL' }[x.symbol], x.bidPrice, x.askPrice, x.bidQty, x.askQty)) },
    ...[['USDC-USDT', 'USDC/USDT'], ['USDT-BRL', 'USDT/BRL'], ['USDC-BRL', 'USDC/BRL']].map(([i, p]) => ({ v: 'okx', url: 'https://www.okx.com/api/v5/market/ticker?instId=' + i,
      parse: (j) => { const d = j && j.data && j.data[0]; return d ? [q('okx', p, d.bidPx, d.askPx, d.bidSz, d.askSz)] : []; } })),
    ...[['USDCUSDT', 'USDC/USDT'], ['USDTBRL', 'USDT/BRL']].map(([s, p]) => ({ v: 'bybit', url: 'https://api.bybit.com/v5/market/tickers?category=spot&symbol=' + s,
      parse: (j) => { const d = j && j.result && j.result.list && j.result.list[0]; return d ? [q('bybit', p, d.bid1Price, d.ask1Price, d.bid1Size, d.ask1Size)] : []; } })),
    { v: 'kucoin', url: 'https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=USDC-USDT', parse: (j) => { const d = j && j.data; return d ? [q('kucoin', 'USDC/USDT', d.bestBid, d.bestAsk, d.bestBidSize, d.bestAskSize)] : []; } },
    { v: 'gate', url: 'https://api.gateio.ws/api/v4/spot/order_book?currency_pair=USDC_USDT&limit=1', parse: (j) => [q('gate', 'USDC/USDT', j.bids && j.bids[0] && j.bids[0][0], j.asks && j.asks[0] && j.asks[0][0], j.bids && j.bids[0] && j.bids[0][1], j.asks && j.asks[0] && j.asks[0][1])] },
    { v: 'mexc', url: 'https://api.mexc.com/api/v3/ticker/bookTicker?symbol=USDCUSDT', parse: (j) => [q('mexc', 'USDC/USDT', j.bidPrice, j.askPrice, j.bidQty, j.askQty)] },
    ...[['USDCUSDT', 'USDC/USDT'], ['USDTBRL', 'USDT/BRL']].map(([s, p]) => ({ v: 'bitget', url: 'https://api.bitget.com/api/v2/spot/market/tickers?symbol=' + s,
      parse: (j) => { const d = j && j.data && j.data[0]; return d ? [q('bitget', p, d.bidPr, d.askPr, d.bidSz, d.askSz)] : []; } })),
    { v: 'htx', url: 'https://api.huobi.pro/market/detail/merged?symbol=usdcusdt', parse: (j) => { const t = j && j.tick; return t ? [q('htx', 'USDC/USDT', t.bid && t.bid[0], t.ask && t.ask[0], t.bid && t.bid[1], t.ask && t.ask[1])] : []; } },
    { v: 'kraken', url: 'https://api.kraken.com/0/public/Ticker?pair=USDCUSDT,USDTZUSD,USDCUSD',
      parse: (j) => Object.entries((j && j.result) || {}).map(([k, x]) => q('kraken', { USDCUSDT: 'USDC/USDT', USDTZUSD: 'USDT/USD', USDCUSD: 'USDC/USD' }[k], x.b && x.b[0], x.a && x.a[0], x.b && x.b[2], x.a && x.a[2])) },
    // Coinbase cota USDT em USDC: o lado de compra de USDC é o de venda de USDT (inverte)
    { v: 'coinbase', url: 'https://api.exchange.coinbase.com/products/USDT-USDC/ticker', parse: (j) => [q('coinbase', 'USDC/USDT', inv(n(j.ask)), inv(n(j.bid)), null, null)] },
    { v: 'coinbase', url: 'https://api.exchange.coinbase.com/products/USDT-USD/ticker', parse: (j) => [q('coinbase', 'USDT/USD', j.bid, j.ask, null, null)] },
    { v: 'bitstamp', url: 'https://www.bitstamp.net/api/v2/ticker/usdcusdt/', parse: (j) => [q('bitstamp', 'USDC/USDT', j.bid, j.ask, null, null)] },
    ...[['usdtbrl', 'USDT/BRL'], ['usdcbrl', 'USDC/BRL']].map(([s, p]) => ({ v: 'foxbit', url: 'https://api.foxbit.com.br/rest/v3/markets/' + s + '/orderbook?depth=1',
      parse: (j) => [q('foxbit', p, j.bids && j.bids[0] && j.bids[0][0], j.asks && j.asks[0] && j.asks[0][0], j.bids && j.bids[0] && j.bids[0][1], j.asks && j.asks[0] && j.asks[0][1])] })),
    { v: 'mb', url: 'https://api.mercadobitcoin.net/api/v4/tickers?symbols=USDT-BRL,USDC-BRL', parse: (j) => (Array.isArray(j) ? j : []).map((x) => q('mb', String(x.pair || '').replace('-', '/'), x.buy, x.sell, null, null)) },
    { v: 'bitso', url: 'https://api.bitso.com/v3/ticker/?book=usdt_brl', parse: (j) => [q('bitso', 'USDT/BRL', j.payload && j.payload.bid, j.payload && j.payload.ask, null, null)] },
    { v: 'ripio', url: 'https://api.ripiotrade.co/v4/public/tickers', parse: (j) => ((j && j.data) || []).filter((x) => x.pair === 'USDT_BRL' || x.pair === 'USDC_BRL').map((x) => q('ripio', x.pair.replace('_', '/'), x.bid, x.ask, null, null)) },
    { v: 'bitpreco', url: 'https://api.bitpreco.com/usdt-brl/orderbook', parse: (j) => [q('bitpreco', 'USDT/BRL', j.bids && j.bids[0] && j.bids[0].price, j.asks && j.asks[0] && j.asks[0].price, j.bids && j.bids[0] && j.bids[0].amount, j.asks && j.asks[0] && j.asks[0].amount)] },
    { v: 'novadax', url: 'https://api.novadax.com/v1/market/ticker?symbol=USDT_BRL', parse: (j) => [q('novadax', 'USDT/BRL', j.data && j.data.bid, j.data && j.data.ask, null, null)] },
    // Hyperliquid (DEX com livro): USDT0/USDC; o lado de compra de USDC é o de venda de USDT0
    { v: 'hyperliquid', url: 'https://api.hyperliquid.xyz/info', body: { type: 'l2Book', coin: '@166' }, parse: (j) => { const L = (j && j.levels) || [], b = L[0] && L[0][0], a = L[1] && L[1][0]; return b && a ? [q('hyperliquid', 'USDC/USDT', inv(n(a.px)), inv(n(b.px)), n(a.sz) * n(a.px), n(b.sz) * n(b.px))] : []; } },
    // agregadores de DEX: quanto sai de US$1.000 em cada sentido (já com a taxa dos pools); gás em dólar
    dex('jupiter:sell', `https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL_USDC}&outputMint=${SOL_USDT}&amount=1000000000&slippageBps=10`, (j) => j.outAmount / 1e6, null),
    dex('jupiter:buy', `https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL_USDT}&outputMint=${SOL_USDC}&amount=1000000000&slippageBps=10`, (j) => j.outAmount / 1e6, null),
    dex('kyberArb:sell', `https://aggregator-api.kyberswap.com/arbitrum/api/v1/routes?tokenIn=${ARB_USDC}&tokenOut=${ARB_USDT}&amountIn=1000000000`, (j) => j.data.routeSummary.amountOut / 1e6, (j) => j.data.routeSummary.gasUsd),
    dex('kyberArb:buy', `https://aggregator-api.kyberswap.com/arbitrum/api/v1/routes?tokenIn=${ARB_USDT}&tokenOut=${ARB_USDC}&amountIn=1000000000`, (j) => j.data.routeSummary.amountOut / 1e6, (j) => j.data.routeSummary.gasUsd),
    dex('kyberBase:sell', `https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=${BASE_USDC}&tokenOut=${BASE_USDT}&amountIn=1000000000`, (j) => j.data.routeSummary.amountOut / 1e6, (j) => j.data.routeSummary.gasUsd),
    dex('kyberBase:buy', `https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=${BASE_USDT}&tokenOut=${BASE_USDC}&amountIn=1000000000`, (j) => j.data.routeSummary.amountOut / 1e6, (j) => j.data.routeSummary.gasUsd),
    dex('paraswap:sell', `https://api.paraswap.io/prices?srcToken=${ETH_USDC}&destToken=${ETH_USDT}&amount=1000000000&srcDecimals=6&destDecimals=6&network=1&side=SELL`, (j) => j.priceRoute.destAmount / 1e6, (j) => j.priceRoute.gasCostUSD),
    dex('paraswap:buy', `https://api.paraswap.io/prices?srcToken=${ETH_USDT}&destToken=${ETH_USDC}&amount=1000000000&srcDecimals=6&destDecimals=6&network=1&side=SELL`, (j) => j.priceRoute.destAmount / 1e6, (j) => j.priceRoute.gasCostUSD)
  ];
}

// Junta as respostas em cotações {v, pair, bid, ask, bq, aq, gasUsd}. DEX: "sell" = vender 1.000 USDC (bid), "buy" = comprar
// USDC com 1.000 USDT (ask = 1000 ÷ USDC recebido).
export function arbQuotes(results) {
  const out = [], dexs = {};
  for (const r of results || []) {
    if (!r || !r.ok) continue;
    try {
      const v = r.src.v;
      if (v.includes(':')) { const [d, side] = v.split(':'), x = r.src.parse(r.json); if (x.out > 0) (dexs[d] || (dexs[d] = {}))[side] = x; continue; }
      for (const x of r.src.parse(r.json) || []) if (x && x.pair) out.push(x);
    } catch (e) { r.ok = false; r.err = 'formato: ' + String(e.message || e).slice(0, 60); }
  }
  for (const [d, s] of Object.entries(dexs)) if (s.sell && s.buy) {
    const x = q(d, 'USDC/USDT', s.sell.out / 1000, 1000 / s.buy.out, 1000, 1000, { gasUsd: Math.max(s.sell.gas || 0, s.buy.gas || 0), dex: true });
    if (x) out.push(x);
  }
  return out;
}

const feeOf = (v, fees) => (fees && isFinite(fees[v]) ? fees[v] : (VENUES[v] ? VENUES[v].fee : 0.2));
const usdOf = (pair, px, qty, brl) => (!(qty > 0) ? null : pair.endsWith('/BRL') ? qty * px / (brl || 5.6) : qty * px);

// Oportunidades: dupla direta entre plataformas e triangulares (BRL e USD). Tudo em % do valor, líquido de taxas de balcão
// das pernas e do gás das DEX para o tamanho da operação.
export function arbOpportunities(quotes, { brlUsd = null, fees = null, rules = ARB_RULES } = {}) {
  const Q = quotes || [], byPair = {}, ops = [];
  for (const x of Q) (byPair[x.pair] || (byPair[x.pair] = [])).push(x);
  const gasPct = (x) => (x.gasUsd ? x.gasUsd / rules.sizeUsd * 100 : 0);
  // 1) mesma dupla
  for (const [pair, L] of Object.entries(byPair)) for (const a of L) for (const b of L) {
    if (a === b || a.v === b.v) continue;
    const gross = (b.bid / a.ask - 1) * 100, cost = feeOf(a.v, fees) + feeOf(b.v, fees) + gasPct(a) + gasPct(b);
    const liq = Math.min(usdOf(pair, a.ask, a.aq, brlUsd) || rules.sizeUsd, usdOf(pair, b.bid, b.bq, brlUsd) || rules.sizeUsd);
    ops.push({ id: `dir:${pair}:${a.v}>${b.v}`, type: 'direta', pair, buy: a.v, sell: b.v, buyPx: a.ask, sellPx: b.bid, grossPct: +gross.toFixed(4), costPct: +cost.toFixed(4), netPct: +(gross - cost).toFixed(4), liqUsd: Math.round(liq), dex: !!(a.dex || b.dex) });
  }
  // 2) triangulares: moeda X (BRL ou USD) → USDT → USDC → X e o inverso, em qualquer combinação de plataformas
  for (const X of ['BRL', 'USD']) {
    const T = byPair['USDT/' + X] || [], C = byPair['USDC/' + X] || [], CU = byPair['USDC/USDT'] || [];
    for (const t of T) for (const c of C) for (const cu of CU) {
      const f = feeOf(t.v, fees) + feeOf(c.v, fees) + feeOf(cu.v, fees) + gasPct(cu), one = t.v === c.v && c.v === cu.v;
      const gA = (c.bid / (t.ask * cu.ask) - 1) * 100, gB = (t.bid * cu.bid / c.ask - 1) * 100;
      const base = { type: one ? 'triangular (uma corretora)' : 'triangular', pair: X + '→USDT→USDC→' + X, legs: [t.v, cu.v, c.v], dex: !!cu.dex };
      ops.push(Object.assign({}, base, { id: `tri:${X}:A:${t.v}:${cu.v}:${c.v}`, route: `compra USDT (${t.v}), troca por USDC (${cu.v}), vende USDC (${c.v})`, grossPct: +gA.toFixed(4), costPct: +f.toFixed(4), netPct: +(gA - f).toFixed(4) }));
      ops.push(Object.assign({}, base, { id: `tri:${X}:B:${c.v}:${cu.v}:${t.v}`, pair: X + '→USDC→USDT→' + X, route: `compra USDC (${c.v}), troca por USDT (${cu.v}), vende USDT (${t.v})`, grossPct: +gB.toFixed(4), costPct: +f.toFixed(4), netPct: +(gB - f).toFixed(4) }));
    }
  }
  return ops.sort((x, y) => y.netPct - x.netPct);
}

// Um passo do mapa: cotações, oportunidades, persistência (fantasma × persistente), frequência e papel.
export function arbStep(prev, { now, quotes, errs = {}, brlUsd = null, fees = null, rules = ARB_RULES }) {
  const A = prev && prev.since ? JSON.parse(JSON.stringify(prev)) : { since: now, scans: 0, routes: {}, series: [], paper: null };
  const events = [], ops = arbOpportunities(quotes, { brlUsd, fees, rules }), seenPrev = new Set(A.lastPos || []);
  A.scans++;
  const pos = ops.filter((o) => o.netPct > 0), conf = pos.filter((o) => seenPrev.has(o.id)); // continuou positiva desde a leitura anterior
  // frequência por rota (só as que já foram positivas alguma vez, para não guardar milhares)
  for (const o of ops) {
    const r = A.routes[o.id];
    if (!r && !(o.netPct > 0)) continue;
    const R = r || (A.routes[o.id] = { type: o.type, pair: o.pair, label: o.route || `compra ${o.buy}, vende ${o.sell}`, n: 0, pos: 0, conf: 0, maxNet: -Infinity, first: now });
    R.n++; if (o.netPct > 0) R.pos++; if (seenPrev.has(o.id) && o.netPct > 0) R.conf++; R.maxNet = Math.max(R.maxNet, o.netPct); R.last = now; R.lastNet = o.netPct;
  }
  const ids = Object.keys(A.routes); if (ids.length > 300) ids.sort((a, b) => A.routes[a].last - A.routes[b].last).slice(0, ids.length - 300).forEach((k) => delete A.routes[k]);
  A.lastPos = pos.map((o) => o.id);
  const best = (t) => ops.filter((o) => t(o))[0] || null, bDir = best((o) => o.type === 'direta' && !o.dex), bTri = best((o) => o.type.startsWith('triangular')), bDex = best((o) => o.dex);
  A.series.push([now, bDir ? bDir.netPct : null, bTri ? bTri.netPct : null, bDex ? bDex.netPct : null, pos.length, conf.length]);
  if (A.series.length > rules.keepSeries) A.series.splice(0, A.series.length - rules.keepSeries);
  // papel: executa só o que continuou positivo (preço desta leitura), com estoque por plataforma e custo de reequilíbrio
  A.paper = paperStep(A.paper, conf.filter((o) => o.netPct >= rules.minNetPct), now, rules, events);
  A.now = { at: now, quotes, ops: ops.slice(0, 40), pos: pos.length, conf: conf.length, errs, best: { direta: bDir, triangular: bTri, dex: bDex } };
  A.lastTs = now;
  return { arb: A, events, confirmed: conf.filter((o) => o.netPct >= rules.minNetPct) };
}

function paperStep(P0, opps, now, rules, events) {
  const P = P0 || { since: now, trades: 0, grossUsd: 0, feesUsd: 0, rebalUsd: 0, netUsd: 0, stock: {}, last: [] };
  for (const o of opps.slice(0, 3)) {
    const legs = o.legs || [o.buy, o.sell], size = Math.min(rules.paperTradeUsd, o.liqUsd || rules.paperTradeUsd);
    // estoque virtual: cada perna gasta de um lado do estoque da plataforma; abaixo de 20% reequilibra (transferência ~US$1)
    let reb = 0;
    for (const v of legs) {
      const s = P.stock[v] || (P.stock[v] = { used: 0 });
      s.used += size;
      if (s.used >= rules.paperStockUsd * (1 - rules.rebalanceLowPct / 100)) { s.used = 0; reb += rules.rebalanceUsd; }
    }
    const gross = size * o.grossPct / 100, fee = size * o.costPct / 100, net = gross - fee - reb;
    P.trades++; P.grossUsd += gross; P.feesUsd += fee; P.rebalUsd += reb; P.netUsd += net;
    P.last = [{ t: now, id: o.id, type: o.type, label: o.route || `compra ${o.buy}, vende ${o.sell}`, pair: o.pair, sizeUsd: size, netPct: o.netPct, netUsd: +net.toFixed(4), rebUsd: reb }].concat(P.last).slice(0, 30);
    events.push(`Arbitragem (papel): ${o.type} ${o.pair} — ${o.route || `compra na ${VENUES[o.buy] ? VENUES[o.buy].name : o.buy}, vende na ${VENUES[o.sell] ? VENUES[o.sell].name : o.sell}`}: ${o.netPct.toFixed(3).replace('.', ',')}% líquido em US$${size.toFixed(0)} → ${net >= 0 ? '+' : '−'}US$${Math.abs(net).toFixed(2).replace('.', ',')}${reb ? ' (com reequilíbrio)' : ''}`);
  }
  return P;
}

// Resumo para o painel e o Jarbas.
export function arbSummary(A) {
  if (!A) return null;
  const S = A.series || [], col = (i) => S.map((r) => r[i]).filter((x) => x !== null && isFinite(x));
  const share = (i) => { const v = col(i); return v.length ? Math.round(v.filter((x) => x > 0).length / v.length * 100) : null; };
  const routes = Object.entries(A.routes || {}).map(([id, r]) => Object.assign({ id }, r, { posPct: r.n ? Math.round(r.pos / r.n * 100) : 0 })).sort((a, b) => b.conf - a.conf || b.pos - a.pos).slice(0, 15);
  return { since: A.since, scans: A.scans, lastTs: A.lastTs, now: A.now, routes, paper: A.paper,
    posPct: { direta: share(1), triangular: share(2), dex: share(3) }, maxNet: { direta: col(1).length ? Math.max(...col(1)) : null, triangular: col(2).length ? Math.max(...col(2)) : null, dex: col(3).length ? Math.max(...col(3)) : null } };
}
