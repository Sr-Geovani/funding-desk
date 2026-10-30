// Testes do backend (Worker). Rodar: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { authMessage, hmacHex, algoUnits } from '../worker/src/nicehash.js';
import { paidTo, normAddr } from '../worker/src/chain.js';
import { DEFAULT_CONFIG, sanitizeConfig, parseBook, computeMarket, decide, DOWN_STEP_MS } from '../worker/src/bot.js';
import worker, { tick } from '../worker/src/index.js';
import { createMock, MOCK_KEYS } from '../worker/dev/mock.mjs';
import { memoryKV } from '../worker/dev/server.mjs';
const FDM = createRequire(import.meta.url)('../mining.js');

const close = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} esperado ${b}, veio ${a}`);
const ADDR = 'bitcoincash:qrcuqadqrzp2uztjl9wn5sthepkg22majyxw4gmv6p';

test('assinatura NiceHash = algoritmo do cliente oficial (Python)', async () => {
  const r = { key: 'k-123', time: '1793372924880', nonce: 'n-1', org: 'org-9', method: 'POST', path: '/main/api/v2/hashpower/order', query: 'a=1&b=2', body: '{"x":1}' };
  // composição exatamente como em rest-clients-demo/python/nicehash.py
  const msg = Buffer.concat([r.key, '\0', r.time, '\0', r.nonce, '\0', '\0', r.org, '\0', '\0', r.method, '\0', r.path, '\0', r.query, '\0', r.body].map((x) => Buffer.from(x)));
  const want = crypto.createHmac('sha256', 's3cr3t').update(msg).digest('hex');
  assert.equal(await hmacHex('s3cr3t', authMessage(r)), want);
  // sem corpo, não há o separador final
  const noBody = Object.assign({}, r, { body: '' });
  const want2 = crypto.createHmac('sha256', 's3cr3t').update(msg.subarray(0, msg.length - r.body.length - 1)).digest('hex');
  assert.equal(await hmacHex('s3cr3t', authMessage(noBody)), want2);
});

test('unidades: produção (EH) e teste (PH)', () => {
  const prod = algoUnits({ marketFactor: '1000000000000000000', displayMarketFactor: 'EH', priceFactor: '1000000000000000000', minSpeedLimit: '0.0001', maxSpeedLimit: '50', priceDownStep: '-0.01', minimalOrderAmount: '0.001', enabledMarketsNewOrder: 'BTC' });
  close(prod.minLimitPH, 0.1); close(prod.priceDownStepEH, 0.01); close(prod.priceToEH, 1); close(prod.limitToPH, 1000);
  const t = algoUnits({ marketFactor: '1000000000000000', displayMarketFactor: 'PH', priceFactor: '1000000000000000', minSpeedLimit: '0.05', maxSpeedLimit: '50000', priceDownStep: '-0.0001', minimalOrderAmount: '0.001' });
  close(t.priceToEH, 1000); close(t.limitToPH, 1); close(t.priceDownStepEH, 0.1); close(t.minLimitPH, 0.05);
});

test('coinbase: detecta pagamento ao endereço', () => {
  const cb = { outs: [{ value: 3.1, addrs: [normAddr(ADDR)] }, { value: 0.06, addrs: ['qpoolfee'] }] };
  close(paidTo(cb, ADDR), 3.1);
  close(paidTo(cb, normAddr(ADDR)), 3.1);
  assert.equal(paidTo(cb, 'bitcoincash:qoutro'), 0);
  assert.equal(paidTo(cb, ''), 0);
});

test('configuração: valida e rejeita valores perigosos', () => {
  const lim = { maxOrderBtc: 0.01, maxLimitPh: 100, maxDailyUsd: 1000 };
  let r = sanitizeConfig({ mode: 'active', targetPh: 20, payoutAddress: ADDR }, DEFAULT_CONFIG, lim);
  assert.deepEqual(r.errors, []); assert.equal(r.config.mode, 'active');
  r = sanitizeConfig({ targetPh: 500, orderAmountBtc: 1, mode: 'turbo', payoutAddress: 'xyz' }, DEFAULT_CONFIG, lim);
  assert.equal(r.errors.length, 4);
  assert.equal(r.config.targetPh, DEFAULT_CONFIG.targetPh);
});

test('mercado: preço de empate igual ao do painel (mining.js)', () => {
  const book = parseBook({ stats: { BTC: { priceFactor: '1e18', marketFactor: '1e18', orders: [
    { price: '0.45', acceptedSpeed: '0.001', alive: true }, { price: '0.40', acceptedSpeed: '0', alive: true }, { price: '0.47', acceptedSpeed: '0.002', alive: true }] } } });
  close(book.fillEH, 0.45); close(book.medianEH, 0.47); close(book.totalPH, 3);
  const cfg = Object.assign({}, DEFAULT_CONFIG, { poolFeePct: 2, rentFeePct: 3, minEdgePct: 3, bidPremiumPct: 0.5 });
  const m = computeMarket({ D: 527.94e9, bchUsd: 283.49, btcUsd: 77366, book, cfg });
  const p = FDM.plan({ ph: 1, hours: 24, D: 527.94e9, rewardCoin: 3.125, coinUsd: 283.49, priceBtcPerEhDay: 0.45, btcUsd: 77366, rentFeePct: 3, poolFeePct: 2 });
  close(m.breakEvenEH, p.breakEvenPrice, 1e-9, 'empate');
  close(m.capEH, m.breakEvenEH * 0.97);
  close(m.bidEH, 0.4523);
  assert.equal(m.green, m.bidEH <= m.capEH);
});

const units = { minLimitPH: 0.1, priceDownStepEH: 0.01, minOrderBtc: 0.001 };
const lim = { maxOrderBtc: 0.01, maxLimitPh: 100, maxDailyUsd: 1000 };
const NOW = Date.UTC(2026, 9, 30, 15);
const mk = (o) => Object.assign({ ok: true, btcUsd: 77000, bidEH: 0.40, capEH: 0.42, edgeAtBidPct: 8, green: true, market: 'BTC' }, o);
const order = (o) => Object.assign({ id: 'A', alive: true, priceEH: 0.40, limitPH: 0.1, paidBtc: 0, createdTs: NOW - 3600e3 }, o);
const cfgOf = (o) => Object.assign({}, DEFAULT_CONFIG, { mode: 'active', managed: ['A'], targetPh: 20, sessionBudgetUsd: 300, dailyBudgetUsd: 500 }, o);

test('robô: sinal verde sobe para a potência alvo no lance', () => {
  const d = decide({ cfg: cfgOf(), mkt: mk(), orders: [order({ priceEH: 0.39 })], now: NOW, units, limits: lim });
  assert.equal(d.actions.length, 1);
  assert.deepEqual([d.actions[0].type, d.actions[0].priceEH, d.actions[0].limitPH], ['update', 0.40, 20]);
});

test('robô: acima do teto pausa e baixa o preço só um degrau a cada 10 min', () => {
  const m = mk({ green: false, bidEH: 0.47, capEH: 0.42 });
  const d1 = decide({ cfg: cfgOf(), mkt: m, orders: [order({ priceEH: 0.46, limitPH: 20 })], now: NOW, units, limits: lim });
  assert.deepEqual([d1.actions[0].priceEH, d1.actions[0].limitPH], [0.45, 0.1]);
  // 5 min depois: não pode baixar de novo; mantém pausado
  const d2 = decide({ cfg: cfgOf(), mkt: m, orders: [order({ priceEH: 0.45, limitPH: 0.1 })], state: d1.state, now: NOW + 5 * 60e3, units, limits: lim });
  assert.equal(d2.actions.length, 0);
  const d3 = decide({ cfg: cfgOf(), mkt: m, orders: [order({ priceEH: 0.45, limitPH: 0.1 })], state: d1.state, now: NOW + DOWN_STEP_MS, units, limits: lim });
  assert.equal(d3.actions[0].priceEH, 0.44);
});

test('robô: bloco no endereço encerra a ordem (ou reduz, ou continua)', () => {
  const ev = { height: 900001, bch: 3.1 };
  assert.equal(decide({ cfg: cfgOf(), mkt: mk(), orders: [order()], now: NOW, units, limits: lim, blockEvent: ev }).actions[0].type, 'cancel');
  const m = decide({ cfg: cfgOf({ onBlock: 'min' }), mkt: mk(), orders: [order({ limitPH: 20 })], now: NOW, units, limits: lim, blockEvent: ev });
  assert.deepEqual([m.actions[0].type, m.actions[0].limitPH], ['update', 0.1]);
  const c = decide({ cfg: cfgOf({ onBlock: 'continue' }), mkt: mk(), orders: [order({ limitPH: 20, paidBtc: 0.003 })], state: { sessions: { A: { startPaid: 0 } } }, now: NOW, units, limits: lim, blockEvent: ev });
  assert.equal(c.state.sessions.A.startPaid, 0.003, 'sessão recomeça após o bloco');
});

test('robô: stop-loss da sessão e limite diário', () => {
  const sl = decide({ cfg: cfgOf(), mkt: mk(), orders: [order({ paidBtc: 0.004 })], state: { sessions: { A: { startPaid: 0 } } }, now: NOW, units, limits: lim });
  assert.equal(sl.actions[0].type, 'cancel');
  assert.match(sl.actions[0].reason, /stop-loss/);
  const dl = decide({ cfg: cfgOf({ sessionBudgetUsd: 0 }), mkt: mk(), orders: [order({ paidBtc: 0.007, limitPH: 20 })], state: { day: '2026-10-30', dayStart: { A: 0 } }, now: NOW, units, limits: lim });
  assert.deepEqual([dl.actions[0].type, dl.actions[0].limitPH], ['update', 0.1]);
  assert.ok(dl.notes.some((n) => /limite diário/.test(n)));
});

test('robô: só mexe em ordens gerenciadas; desligado não faz nada; cria ordem com sinal verde', () => {
  assert.equal(decide({ cfg: cfgOf({ managed: [] }), mkt: mk(), orders: [order()], now: NOW, units, limits: lim }).actions.length, 0);
  assert.equal(decide({ cfg: cfgOf({ mode: 'off' }), mkt: mk(), orders: [order({ priceEH: 0.3 })], now: NOW, units, limits: lim }).actions.length, 0);
  const c = decide({ cfg: cfgOf({ managed: [], autoCreate: true, poolId: 'p1', orderAmountBtc: 0.5 }), mkt: mk(), orders: [], now: NOW, units, limits: lim });
  assert.deepEqual([c.actions[0].type, c.actions[0].amountBtc, c.actions[0].limitPH], ['create', 0.01, 20], 'valor limitado ao teto do servidor');
  assert.equal(decide({ cfg: cfgOf({ managed: [], autoCreate: true, poolId: 'p1' }), mkt: mk({ green: false }), orders: [], now: NOW, units, limits: lim }).actions.length, 0);
});

/* ---------- integração: Worker + NiceHash falsa ---------- */
async function setup() {
  const { server, state } = createMock();
  await new Promise((r) => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const env = { FD_KV: memoryKV(), PANEL_TOKEN: 'token-de-teste-com-mais-de-24-chars', ALLOWED_ORIGIN: 'https://sr-geovani.github.io',
    NH_BASE: base + '/nh', BCH_REST: base + '/bch', PRICE_URL: base + '/cg/x', NH_API_KEY: MOCK_KEYS.key, NH_API_SECRET: MOCK_KEYS.secret, NH_ORG_ID: MOCK_KEYS.org,
    MAX_ORDER_BTC: '0.01', MAX_LIMIT_PH: '100', MAX_DAILY_USD: '1000' };
  const call = async (method, path, body, token = env.PANEL_TOKEN) => {
    const r = await worker.fetch(new Request('https://api.example' + path, { method, headers: { Authorization: 'Bearer ' + token, Origin: 'https://sr-geovani.github.io', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, {});
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
  return { server, state, env, call, base };
}

test('integração: autenticação e origem', async () => {
  const t = await setup();
  try {
    assert.equal((await t.call('GET', '/api/status', null, 'errado')).status, 401);
    const r = await worker.fetch(new Request('https://api.example/api/status', { headers: { Authorization: 'Bearer ' + t.env.PANEL_TOKEN, Origin: 'https://malicioso.example' } }), t.env, {});
    assert.equal(r.status, 403);
    const ok = await t.call('GET', '/api/status');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.keys, true);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://sr-geovani.github.io');
    assert.equal((await worker.fetch(new Request('https://api.example/api/status', { headers: { Authorization: 'Bearer curto' } }), Object.assign({}, t.env, { PANEL_TOKEN: 'curto' }), {})).status, 401, 'token curto não vale');
  } finally { t.server.close(); }
});

test('integração: ordem manual, robô observando, robô ativo, bloco encerra a ordem', async () => {
  const t = await setup();
  try {
    assert.equal((await t.call('GET', '/api/balance')).body.available, '0.05');
    assert.equal((await t.call('POST', '/api/orders', { priceEH: 0.4, limitPH: 1, amountBtc: 0.5, poolId: 'pool-1' })).status, 400, 'teto de valor');
    const o = await t.call('POST', '/api/orders', { priceEH: 0.39, limitPH: 1, amountBtc: 0.005, poolId: 'pool-1' });
    assert.equal(o.status, 200, JSON.stringify(o.body));
    const id = o.body.id;
    assert.equal(t.state.authFails, 0, 'todas as assinaturas conferidas pela NiceHash falsa');

    // modo observar: decide mas não executa
    let r = await t.call('PUT', '/api/config', { mode: 'observe', payoutAddress: ADDR, targetPh: 20, minEdgePct: 3 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await t.call('POST', '/api/tick');
    assert.ok(r.body.market.green, 'mercado de teste com margem positiva');
    assert.equal(r.body.actions[0].executed, false);
    assert.equal(t.state.orders[id].updates.length, 0);

    // modo ativo: aplica lance e potência
    await t.call('PUT', '/api/config', { mode: 'active' });
    r = await t.call('POST', '/api/tick');
    assert.equal(r.body.actions[0].executed, true, JSON.stringify(r.body));
    assert.equal(+t.state.orders[id].limit, 0.02, '20 PH/s = 0,02 EH/s');
    close(+t.state.orders[id].price, 0.4020);

    // a recompensa de um bloco cai no endereço → ordem encerrada
    await fetch(t.base + '/_mine', { method: 'POST', body: JSON.stringify({ address: ADDR }) });
    r = await t.call('POST', '/api/tick');
    assert.equal(r.body.blockEvent.height, t.state.height);
    assert.equal(r.body.actions[0].type, 'cancel');
    assert.equal(t.state.orders[id].alive, false);
    const st = await t.call('GET', '/api/status');
    assert.equal(st.body.state.myBlocks.length, 1);
    const log = await t.call('GET', '/api/log');
    assert.ok(log.body.log.some((l) => /Bloco .* pago no seu endereço/.test(l.text)));
    assert.equal(t.state.authFails, 0);
  } finally { t.server.close(); }
});

test('integração: stop-loss e emergência', async () => {
  const t = await setup();
  try {
    await t.call('PUT', '/api/config', { mode: 'active', payoutAddress: ADDR, sessionBudgetUsd: 100 });
    const a = (await t.call('POST', '/api/orders', { priceEH: 0.402, limitPH: 20, amountBtc: 0.005, poolId: 'pool-1' })).body.id;
    const b = (await t.call('POST', '/api/orders', { priceEH: 0.402, limitPH: 20, amountBtc: 0.005, poolId: 'pool-1' })).body.id;
    await t.call('POST', '/api/tick'); // abre as sessões
    await fetch(t.base + '/_spend', { method: 'POST', body: JSON.stringify({ id: a, btc: 0.0015 }) }); // ~US$115
    const r = await t.call('POST', '/api/tick');
    assert.ok(r.body.actions.some((x) => x.type === 'cancel' && x.id === a && /stop-loss/.test(x.reason)));
    assert.equal(t.state.orders[a].alive, false);
    assert.equal(t.state.orders[b].alive, true);
    const k = await t.call('POST', '/api/kill');
    assert.ok(k.body.cancelled.includes(b));
    assert.equal(t.state.orders[b].alive, false);
    assert.equal((await t.call('GET', '/api/status')).body.config.mode, 'off');
  } finally { t.server.close(); }
});

test('integração: modo ativo exige chaves; proxy público só nas rotas permitidas', async () => {
  const t = await setup();
  try {
    const env2 = Object.assign({}, t.env, { NH_API_KEY: '' });
    const r = await worker.fetch(new Request('https://api.example/api/config', { method: 'PUT', headers: { Authorization: 'Bearer ' + t.env.PANEL_TOKEN }, body: JSON.stringify({ mode: 'active' }) }), env2, {});
    assert.equal(r.status, 400);
    const p = await worker.fetch(new Request('https://api.example/binance/fapi/v1/order'), t.env, {});
    assert.equal(p.status, 404, 'proxy não repassa rotas de ordem');
  } finally { t.server.close(); }
});
