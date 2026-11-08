// Testes da arbitragem de stablecoins (mapa, oportunidades, papel, robô). Rodar: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { arbSources, arbQuotes, arbOpportunities, arbStep, arbSummary } from '../worker/src/arb.js';
import { hmac, ADAPTERS, execStep, checkKey } from '../worker/src/arbexec.js';
import { arbScan } from '../worker/src/index.js';
import { memoryKV } from '../worker/dev/server.mjs';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} esperado ${b}, veio ${a}`);
const FIX = {
  'data-api.binance.vision': [{ symbol: 'USDCUSDT', bidPrice: '1.0012', bidQty: '1000', askPrice: '1.0013', askQty: '1000' }, { symbol: 'USDTBRL', bidPrice: '5.6300', bidQty: '500', askPrice: '5.6310', askQty: '500' }, { symbol: 'USDCBRL', bidPrice: '5.6420', bidQty: '500', askPrice: '5.6430', askQty: '500' }],
  'api.bitget.com/api/v2/spot/market/tickers?symbol=USDTBRL': { data: [{ bidPr: '5.6600', askPr: '5.6650', bidSz: '300', askSz: '300' }] },
  'api.exchange.coinbase.com/products/USDT-USDC': { bid: '0.9987', ask: '0.9988' },
  'lite-api.jup.ag/swap/v1/quote?inputMint=EPj': { outAmount: '1001180000' },
  'lite-api.jup.ag/swap/v1/quote?inputMint=Es9': { outAmount: '998810000' }
};
const fakeFetch = (calls = []) => async (u, o) => {
  calls.push({ u: String(u), m: (o && o.method) || 'GET' });
  const k = Object.keys(FIX).find((x) => String(u).includes(x));
  return k ? new Response(JSON.stringify(FIX[k]), { status: 200 }) : new Response('{}', { status: 404 });
};

test('arbitragem: lê as fontes, inverte a Coinbase (USDT-USDC) e junta os dois sentidos da DEX', async () => {
  const src = arbSources(), res = await Promise.all(src.map(async (s) => { const r = await fakeFetch()(s.url); return r.ok ? { src: s, ok: true, json: await r.json() } : { src: s, ok: false, err: 'HTTP 404' }; }));
  const Q = arbQuotes(res);
  const cb = Q.find((x) => x.v === 'coinbase' && x.pair === 'USDC/USDT'); close(cb.bid, 1 / 0.9988, 1e-12); close(cb.ask, 1 / 0.9987, 1e-12);
  const jp = Q.find((x) => x.v === 'jupiter'); close(jp.bid, 1.00118, 1e-9); close(jp.ask, 1000 / 998.81, 1e-9);
  assert.ok(Q.find((x) => x.v === 'binance' && x.pair === 'USDT/BRL') && Q.find((x) => x.v === 'bitget'));
  assert.ok(src.length >= 30, 'cerca de 30 fontes públicas');
});

test('arbitragem: direta e triangular líquidas de taxa', () => {
  const Q = [{ v: 'binance', pair: 'USDT/BRL', bid: 5.63, ask: 5.631, aq: 500, bq: 500 }, { v: 'bitget', pair: 'USDT/BRL', bid: 5.66, ask: 5.665, aq: 300, bq: 300 },
    { v: 'binance', pair: 'USDC/BRL', bid: 5.642, ask: 5.643 }, { v: 'binance', pair: 'USDC/USDT', bid: 1.0012, ask: 1.0013 }];
  const O = arbOpportunities(Q, { brlUsd: 5.63 });
  const d = O.find((o) => o.id === 'dir:USDT/BRL:binance>bitget');
  close(d.grossPct, (5.66 / 5.631 - 1) * 100, 1e-3); close(d.netPct, d.grossPct - 0.2, 1e-3); assert.ok(d.liqUsd <= 302 && d.liqUsd >= 299);
  const t = O.find((o) => o.id === 'tri:BRL:A:binance:binance:binance');
  close(t.grossPct, (5.642 / (5.631 * 1.0013) - 1) * 100, 1e-3); close(t.costPct, 0.3, 1e-9); assert.equal(t.type, 'triangular (uma corretora)');
});

test('arbitragem: só o que continua positivo na leitura seguinte vai para o papel; estoque gasto cobra reequilíbrio', () => {
  const Q = [{ v: 'binance', pair: 'USDT/BRL', bid: 5.63, ask: 5.631, aq: 1000, bq: 1000 }, { v: 'bitget', pair: 'USDT/BRL', bid: 5.66, ask: 5.665, aq: 1000, bq: 1000 }];
  const T = Date.UTC(2026, 10, 8);
  let r = arbStep(null, { now: T, quotes: Q, brlUsd: 5.63 });
  assert.equal(r.arb.paper.trades, 0, 'primeira vez: pode ser fantasma');
  r = arbStep(r.arb, { now: T + 180e3, quotes: Q, brlUsd: 5.63 });
  assert.equal(r.arb.paper.trades, 1); assert.match(r.events[0], /papel.*compra na Binance, vende na Bitget/);
  const net1 = r.arb.paper.netUsd; close(net1, 200 * ((5.66 / 5.631 - 1) * 100 - 0.2) / 100, 0.01);
  for (let i = 2; i <= 4; i++) r = arbStep(r.arb, { now: T + i * 180e3, quotes: Q, brlUsd: 5.63 });
  assert.equal(r.arb.paper.trades, 4); close(r.arb.paper.rebalUsd, 2, 1e-9, 'US$800 de US$1.000 de estoque usados nas duas pontas: um reequilíbrio em cada');
  const S = arbSummary(r.arb); assert.equal(S.scans, 5); assert.ok(S.routes[0].conf >= 4);
});

test('robô: assinatura da Binance bate com o exemplo oficial da documentação', async () => {
  const sig = await hmac('NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j', 'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559');
  assert.equal(sig, 'c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71');
  const r = await ADAPTERS.binance.order({ key: 'K', secret: 's' }, { pair: 'USDT/BRL', side: 'buy', price: 5.631, qty: 50 }, 1);
  assert.match(r.url, /symbol=USDTBRL&side=BUY&type=LIMIT&timeInForce=IOC&quantity=50&price=5.631/); assert.equal(r.headers['X-MBX-APIKEY'], 'K');
  const o = await ADAPTERS.okx.order({ key: 'K', secret: 's', passphrase: 'p' }, { pair: 'USDC/USDT', side: 'sell', price: 1.0012, qty: 10 }, 0);
  assert.equal(JSON.parse(o.body).ordType, 'ioc'); assert.equal(o.headers['OK-ACCESS-TIMESTAMP'], '1970-01-01T00:00:00.000Z');
});

test('robô: desligado não faz nada; ensaio confere saldo e não envia ordem; real com uma perna recusada se desliga', async () => {
  const opp = { id: 'dir:USDT/BRL:binance>okx', type: 'direta', pair: 'USDT/BRL', buy: 'binance', sell: 'okx', buyPx: 5.631, sellPx: 5.66, netPct: 0.3, liqUsd: 500 };
  const keys = { binance: { key: 'a', secret: 'b' }, okx: { key: 'c', secret: 'd', passphrase: 'e' } }, cfg = { arbMode: 'off', arbMaxTradeUsd: 50, arbMaxDayUsd: 200, arbMinNetPct: 0.1 };
  const calls = [];
  const f = async (u, o) => { calls.push({ u: String(u), m: o.method });
    if (/account\?|balance/.test(u)) return new Response(JSON.stringify(/binance/.test(u) ? { balances: [{ asset: 'BRL', free: '1000' }] } : { data: [{ details: [{ ccy: 'USDT', availBal: '200' }] }] }));
    if (/binance.*order/.test(u)) return new Response(JSON.stringify({ orderId: 1, status: 'FILLED', executedQty: '50' }));
    return new Response(JSON.stringify({ code: '1', msg: 'recusada' }), { status: 400 }); };
  let r = await execStep(null, { opp, cfg, keys, fetchFn: f, now: 1 }); assert.equal(calls.length, 0); assert.equal(r.events.length, 0);
  r = await execStep(null, { opp, cfg: Object.assign({}, cfg, { arbMode: 'ensaio' }), keys, fetchFn: f, now: 1 });
  assert.match(r.events[0], /ensaio.*compraria 50 USDT na binance/); assert.ok(calls.every((c) => c.m === 'GET'), 'ensaio: só leitura de saldo');
  r = await execStep(null, { opp, cfg: Object.assign({}, cfg, { arbMode: 'real' }), keys, fetchFn: f, now: 1 });
  assert.ok(r.exec.halted, 'só a compra foi aceita: robô desligado'); assert.match(r.events[0], /ROBÔ DESLIGADO/);
  const again = await execStep(r.exec, { opp, cfg: Object.assign({}, cfg, { arbMode: 'real' }), keys, fetchFn: f, now: 2 }); assert.equal(again.events.length, 0, 'desligado não tenta de novo');
  const k = await checkKey('okx', { key: 'a', secret: 'b' }, f); assert.match(k.error, /senha/);
});

test('arbitragem no servidor: varredura grava o mapa e manda só a primeira confirmação para o Telegram', async () => {
  const env = { FD_KV: memoryKV(), PANEL_TOKEN: 'token-de-teste-com-mais-de-24-chars' };
  await arbScan(env, { fetchFn: fakeFetch(), now: Date.UTC(2026, 10, 8, 12) });
  const A = await arbScan(env, { fetchFn: fakeFetch(), now: Date.UTC(2026, 10, 8, 12, 3) });
  assert.ok(A.now.quotes.length >= 6); assert.ok(A.now.errs.okx, 'fonte que falhou fica registrada');
  assert.ok(A.paper.trades >= 1); assert.ok(!A.exec || !A.exec.runs || A.exec.runs.length === 0, 'robô desligado por padrão');
});
