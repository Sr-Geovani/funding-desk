// Testes do backend (Worker). Rodar: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { authMessage, hmacHex, algoUnits, createClient } from '../worker/src/nicehash.js';
import { paidTo, normAddr, createChain } from '../worker/src/chain.js';
import { DEFAULT_CONFIG, sanitizeConfig, parseBook, computeMarket, decide, DOWN_STEP_MS } from '../worker/src/bot.js';
import worker, { tick } from '../worker/src/index.js';
import { createMock, MOCK_KEYS } from '../worker/dev/mock.mjs';
import { memoryKV } from '../worker/dev/server.mjs';
import { seal, unseal, chatFromUpdates, parseNiceHash } from '../worker/src/creds.js';
import { paperStep, realStep } from '../worker/src/paper.js';
import { algoPaperStep } from '../worker/src/paperalgo.js';
import { fundPaperStep, fundPaperSummary, alertScoreStep, alertScoreSummary, FUND_RULES } from '../worker/src/paperfund.js';
const TAKER = Object.assign({}, FUND_RULES, { exec: 'taker' });
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

test('unidades: SHA256ASICBOOST real (mínimo 1 PH/s, degrau 0,002)', () => {
  const u = algoUnits({ algorithm: 'SHA256ASICBOOST', marketFactor: '1000000000000000000.00000000', displayMarketFactor: 'EH', priceFactor: '1000000000000000000.00000000', minSpeedLimit: '0.00100000', maxSpeedLimit: '100.00000000', priceDownStep: '-0.00200000', minimalOrderAmount: '0.00100000', enabledMarketsNewOrder: 'BTC' });
  close(u.minLimitPH, 1); close(u.priceDownStepEH, 0.002); close(u.priceToEH, 1); close(u.minOrderBtc, 0.001);
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
  const c = decide({ cfg: cfgOf({ onBlock: 'continue' }), mkt: mk(), orders: [order({ limitPH: 20, paidBtc: 0.003 })], state: { sess: { startTs: NOW - 7200e3, carryBtc: 0.001, paid: { A: { start: 0, last: 0.002 } } } }, now: NOW, units, limits: lim, blockEvent: ev });
  assert.deepEqual([c.state.sess.paid.A.start, c.state.sess.carryBtc], [0.003, 0], 'tentativa recomeça após o bloco');
});

test('robô: stop-loss da sessão e limite diário', () => {
  const S0 = { sess: { startTs: NOW - 7200e3, carryBtc: 0, paid: { A: { start: 0, last: 0 } } } };
  const sl = decide({ cfg: cfgOf(), mkt: mk(), orders: [order({ paidBtc: 0.004 })], state: S0, now: NOW, units, limits: lim });
  assert.equal(sl.actions[0].type, 'cancel');
  assert.match(sl.actions[0].reason, /stop-loss/);
  assert.equal(sl.state.stopUntil, NOW + 6 * 3600e3);
  // a ordem acabou (orçamento da ordem esgotado): o gasto dela continua contando na tentativa
  const o1 = decide({ cfg: cfgOf({ autoCreate: true, poolId: 'p', managed: ['A', 'B'] }), mkt: mk(), orders: [order({ paidBtc: 0.002 })], state: S0, now: NOW, units, limits: lim });
  const o2 = decide({ cfg: cfgOf({ autoCreate: true, poolId: 'p', managed: ['A', 'B'] }), mkt: mk(), orders: [], state: o1.state, now: NOW + 180e3, units, limits: lim });
  assert.equal(o2.state.sess.carryBtc, 0.002); assert.equal(o2.actions[0].type, 'create', 'ainda dentro do orçamento: cria');
  const o3 = decide({ cfg: cfgOf({ autoCreate: true, poolId: 'p', managed: ['A', 'B'] }), mkt: mk(), orders: [order({ id: 'B', paidBtc: 0.0021, createdTs: NOW + 200e3 })], state: o2.state, now: NOW + 360e3, units, limits: lim });
  assert.equal(o3.actions[0].type, 'cancel', 'A + B passaram de US$300: stop-loss vale para a tentativa toda');
  // durante a espera não cria ordem nova, mesmo com sinal verde
  const w = decide({ cfg: cfgOf({ autoCreate: true, poolId: 'p' }), mkt: mk(), orders: [], state: o3.state, now: NOW + 3600e3, units, limits: lim });
  assert.equal(w.actions.length, 0); assert.ok(w.notes.some((n) => /sem ordem nova/.test(n)));
  const w2 = decide({ cfg: cfgOf({ autoCreate: true, poolId: 'p' }), mkt: mk(), orders: [], state: o3.state, now: NOW + 7 * 3600e3, units, limits: lim });
  assert.equal(w2.actions[0].type, 'create', 'depois da espera volta a operar');
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
    NH_BASE: base + '/nh', BCH_REST: base + '/bch', PRICE_URL: base + '/cg/x', HL_URL: base + '/hl/info', WTM_URL: base + '/wtm/asic.json', HP_URL: base + '/hp', MRR_URL: base + '/mrr', LIGHTER_URL: base + '/x', WTM_GPU_URL: base + '/x', UPBIT_URL: base + '/x', FX_URL: base + '/x', CRIPTOYA_URL: base + '/x', COINBASE_URL: base + '/x', OKX_URL: base + '/x', GATE_URL: base + '/x', BITGET_URL: base + '/x', GAMMA_URL: base + '/x', LLAMA_URL: base + '/x', BCB_FOCUS_URL: base + '/x', UST_URL: base + '/x', BFX_URL: base + '/x', DERIBIT_URL: base + '/x', ETHENA_URL: base + '/x', HL_INFO_URL: base + '/x', ZPOOL_URL: base + '/x', MB_URL: base + '/x', BCB_PTAX_URL: base + '/x', BCB_SGS_URL: base + '/x', MEMPOOL_URL: base + '/mempool', KRAKEN_URL: base + '/kraken', NH_API_KEY: MOCK_KEYS.key, NH_API_SECRET: MOCK_KEYS.secret, NH_ORG_ID: MOCK_KEYS.org,
    MAX_ORDER_BTC: '0.01', MAX_LIMIT_PH: '100', MAX_DAILY_USD: '1000' };
  const call = async (method, path, body, token = env.PANEL_TOKEN) => {
    const r = await worker.fetch(new Request('https://api.example' + path, { method, headers: { Authorization: 'Bearer ' + token, Origin: 'https://sr-geovani.github.io', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, {});
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
  // Os testes antigos de funding exercitam a regra sem a exigência de 24 h (o mock não tem histórico horário).
  await env.FD_KV.put('config', JSON.stringify({ fundStable24: false }));
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
    assert.equal(t.state.orders[b].alive, false, 'stop-loss vale para a tentativa toda (todas as ordens do robô)');
    const k = await t.call('POST', '/api/kill');
    assert.ok(Array.isArray(k.body.cancelled));
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

test('integração: alertas de funding exigem persistência, respeitam o intervalo e aparecem no status', async () => {
  const t = await setup();
  try {
    let r = await t.call('POST', '/api/tick');
    assert.equal(r.body.alerts.filter((a) => a.area === 'funding').length, 0, 'primeira leitura não alerta');
    r = await t.call('POST', '/api/tick');
    const fe = r.body.alerts.filter((a) => a.kind === 'entrada' && a.area === 'funding');
    assert.equal(fe.length, 1, JSON.stringify(r.body.alerts));
    assert.match(fe[0].title, /ENA \(short Bybit, long Hyperliquid\)/);
    r = await t.call('POST', '/api/tick');
    assert.equal(r.body.alerts.filter((a) => a.area === 'funding').length, 0, 'não repete dentro do intervalo');
    const st = await t.call('GET', '/api/status');
    assert.ok(st.body.state.alerts.some((a) => /ENA/.test(a.title)));
    const log = await t.call('GET', '/api/log');
    assert.ok(log.body.log.some((l) => l.kind === 'alerta'));
    // desligar alertas
    await t.call('PUT', '/api/config', { alerts: false });
    r = await t.call('POST', '/api/tick');
    assert.deepEqual(r.body.alerts, []);
  } finally { t.server.close(); }
});

test('integração: proxy da WhatToMine só nas rotas permitidas', async () => {
  const t = await setup();
  try {
    const bad = await worker.fetch(new Request('https://api.example/wtm/coins/1.json'), t.env, {});
    assert.equal(bad.status, 404);
  } finally { t.server.close(); }
});

test('Telegram: saída e risco na hora; entradas em resumo de 30 min', async () => {
  const t = await setup();
  try {
    const sent = [];
    const env = Object.assign({}, t.env, { TELEGRAM_BOT_TOKEN: 'tg', TELEGRAM_CHAT_ID: '1' });
    const fetchFn = (u, o) => { if (String(u).includes('api.telegram.org')) { sent.push(JSON.parse(o.body).text); return Promise.resolve(new Response('{}')); } return fetch(u, o); };
    const T0 = Date.now();
    await tick(env, { fetchFn, now: T0 });                 // primeira leitura: sem entrada
    await tick(env, { fetchFn, now: T0 + 5 * 60e3 });       // entrada persistente → vai para o resumo (primeiro resumo sai já)
    assert.equal(sent.filter((x) => /resumo: 1 alerta novo: Entrada: ENA/.test(x)).length, 1, JSON.stringify(sent));
    const n = sent.length;
    // novas entradas dentro de 30 min ficam na fila
    await t.call('PUT', '/api/config', { alertHold: 4 });  // muda a chave do alerta? não: mesma chave, intervalo de 6 h segura
    await tick(env, { fetchFn, now: T0 + 10 * 60e3 });
    assert.equal(sent.length, n, 'nada novo dentro do intervalo');
  } finally { t.server.close(); }
});

/* ---------- contas conectadas pelo painel (credenciais cifradas no KV) ---------- */
const ENC = 'chave-de-cifra-de-teste-com-32-chars!';

test('credenciais: cifra AES-GCM, chave errada não abre, texto não aparece', async () => {
  const box = await seal(ENC, { NH_API_SECRET: 'segredo-super-secreto' });
  assert.ok(!JSON.stringify(box).includes('segredo'));
  assert.deepEqual(await unseal(ENC, box), { NH_API_SECRET: 'segredo-super-secreto' });
  await assert.rejects(unseal(ENC + 'x', box));
  await assert.rejects(seal('curta', {}), /ENC_KEY/);
  assert.equal(parseNiceHash({ key: 'abc', secret: 'x', org: '' }).errors.length, 3);
  assert.equal(parseNiceHash({ key: 'mesma-coisa-1', secret: 'mesma-coisa-1', org: 'org-12345' }).errors.length, 1);
  assert.equal(parseNiceHash({ key: 'k-12345678', secret: 's-12345678', org: 'o-12345678', env: 'mainnet' }).errors.length, 1);
});

test('credenciais: NiceHash pelo painel (confere, cifra, usa no robô, remove)', async () => {
  const t = await setup();
  try {
    const env = Object.assign({}, t.env, { NH_API_KEY: '', NH_API_SECRET: '', NH_ORG_ID: '', ENC_KEY: ENC });
    const call = async (method, path, body) => {
      const r = await worker.fetch(new Request('https://api.example' + path, { method, headers: { Authorization: 'Bearer ' + env.PANEL_TOKEN, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, {});
      return { status: r.status, body: await r.json() };
    };
    let r = await call('GET', '/api/credentials');
    assert.equal(r.body.nicehash.set, false); assert.equal(r.body.encryption, true);
    assert.equal((await call('GET', '/api/balance')).status, 412);
    // chave errada: a NiceHash (falsa) recusa a assinatura e nada é salvo
    r = await call('PUT', '/api/credentials', { nicehash: { key: MOCK_KEYS.key, secret: 'segredo-errado-123', org: MOCK_KEYS.org, env: 'test' } });
    assert.equal(r.status, 400); assert.match(r.body.error, /não aceitou/);
    assert.equal(await env.FD_KV.get('creds'), null);
    // chave certa
    r = await call('PUT', '/api/credentials', { nicehash: { key: MOCK_KEYS.key, secret: MOCK_KEYS.secret, org: MOCK_KEYS.org, env: 'test' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.nicehash.set, true); assert.equal(r.body.nicehash.source, 'painel'); assert.equal(r.body.nicehash.key, '…-key');
    assert.equal(r.body.balanceBtc, '0.05');
    assert.ok(!JSON.stringify(r.body).includes(MOCK_KEYS.secret), 'segredo nunca volta');
    const raw = await env.FD_KV.get('creds');
    assert.ok(raw && !raw.includes(MOCK_KEYS.secret) && !raw.includes(MOCK_KEYS.key), 'KV guarda só texto cifrado');
    // backend passa a usar a chave salva
    assert.equal((await call('GET', '/api/balance')).body.available, '0.05');
    assert.equal((await call('PUT', '/api/config', { mode: 'active', payoutAddress: ADDR })).status, 200);
    const st = await call('GET', '/api/status');
    assert.equal(st.body.keys, true); assert.equal(st.body.creds.nicehash.source, 'painel');
    const tk = await tick(env);
    assert.deepEqual(tk.errors.filter((e) => /ordens/.test(e)), [], 'robô lê as ordens com a chave do painel');
    assert.equal(t.state.authFails, 1, 'só a tentativa com chave errada falhou');
    // remover
    r = await call('PUT', '/api/credentials', { remove: 'nicehash' });
    assert.equal(r.body.nicehash.set, false);
    assert.equal((await call('GET', '/api/status')).body.config.mode, 'observe', 'sem chave, sai do modo ativo');
    assert.equal((await call('GET', '/api/balance')).status, 412);
    // sem ENC_KEY não salva
    const env2 = Object.assign({}, env, { ENC_KEY: '' });
    const r2 = await worker.fetch(new Request('https://api.example/api/credentials', { method: 'PUT', headers: { Authorization: 'Bearer ' + env.PANEL_TOKEN }, body: JSON.stringify({ nicehash: { key: MOCK_KEYS.key, secret: MOCK_KEYS.secret, org: MOCK_KEYS.org } }) }), env2, {});
    assert.equal(r2.status, 412);
  } finally { t.server.close(); }
});

test('credenciais: troca de ambiente põe o robô em Observar', async () => {
  const t = await setup();
  try {
    const env = Object.assign({}, t.env, { NH_API_KEY: '', NH_API_SECRET: '', NH_ORG_ID: '', ENC_KEY: ENC });
    const call = async (method, path, body) => {
      const r = await worker.fetch(new Request('https://api.example' + path, { method, headers: { Authorization: 'Bearer ' + env.PANEL_TOKEN }, body: body ? JSON.stringify(body) : undefined }), env, {});
      return { status: r.status, body: await r.json() };
    };
    const nh = { key: MOCK_KEYS.key, secret: MOCK_KEYS.secret, org: MOCK_KEYS.org };
    await call('PUT', '/api/credentials', { nicehash: Object.assign({ env: 'test' }, nh) });
    await call('PUT', '/api/config', { mode: 'active', payoutAddress: ADDR, managed: ['ord-1'], poolId: 'pool-1' });
    const r = await call('PUT', '/api/credentials', { nicehash: Object.assign({ env: 'prod' }, nh) }); // NH_BASE fixo: o mock responde
    assert.equal(r.body.nicehash.env, 'personalizado');
    const cfg = (await call('GET', '/api/status')).body.config;
    assert.deepEqual([cfg.mode, cfg.managed, cfg.poolId], ['observe', [], '']);
  } finally { t.server.close(); }
});

test('credenciais: Telegram acha o chat pela mensagem e manda teste', async () => {
  assert.deepEqual(chatFromUpdates([{ message: { chat: { id: -100, type: 'group', title: 'G' } } }, { message: { chat: { id: 42, type: 'private', first_name: 'Geo' } } }, { my_chat_member: { chat: { id: -7, type: 'channel', title: 'C' } } }]), { id: '42', type: 'private', name: 'Geo' });
  assert.equal(chatFromUpdates([]), null);
  const t = await setup();
  try {
    const env = Object.assign({}, t.env, { ENC_KEY: ENC });
    const TOKEN = '123456789:AAHfakeTokenFakeTokenFakeToken12345';
    let updates = [];
    const sent = [];
    const fetchFn = async (u, o) => {
      const m = /api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(String(u));
      if (!m) return fetch(u, o);
      if (m[1] !== TOKEN) return new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), { status: 401 });
      if (m[2] === 'getMe') return Response.json({ ok: true, result: { username: 'meu_fd_bot' } });
      if (m[2] === 'getUpdates') return Response.json({ ok: true, result: updates });
      if (m[2] === 'sendMessage') { sent.push(JSON.parse(o.body)); return Response.json({ ok: true, result: {} }); }
      return Response.json({ ok: false });
    };
    const call = async (body) => {
      const r = await worker.fetch(new Request('https://api.example/api/telegram', { method: 'POST', headers: { Authorization: 'Bearer ' + env.PANEL_TOKEN }, body: JSON.stringify(body) }), env, {}, fetchFn);
      return { status: r.status, body: await r.json() };
    };
    assert.equal((await call({ token: 'abc' })).status, 400);
    assert.equal((await call({ token: '123456789:AAHoutroTokenOutroTokenOutroToken999' })).status, 400, 'Telegram recusa');
    let r = await call({ token: TOKEN });
    assert.deepEqual([r.status, r.body.needMessage, r.body.link], [200, true, 'https://t.me/meu_fd_bot']);
    updates = [{ update_id: 1, message: { chat: { id: 4242, type: 'private', first_name: 'Geo' }, text: 'oi' } }];
    r = await call({}); // segunda vez: usa o token já salvo
    assert.equal(r.body.connected, true, JSON.stringify(r.body));
    assert.equal(sent[0].chat_id, '4242'); assert.match(sent[0].text, /conectado/);
    const st = await worker.fetch(new Request('https://api.example/api/credentials', { headers: { Authorization: 'Bearer ' + env.PANEL_TOKEN } }), env, {});
    const sb = await st.json();
    assert.deepEqual([sb.telegram.set, sb.telegram.bot, sb.telegram.source], [true, 'meu_fd_bot', 'painel']);
    assert.ok(!JSON.stringify(sb).includes('AAHfake'), 'token nunca volta');
    // o robô avisa pelo Telegram salvo no painel
    await t.call('PUT', '/api/config', { payoutAddress: ADDR });
    await tick(env, { fetchFn }); // primeira leitura só marca a altura
    await fetch(t.base + '/_mine', { method: 'POST', body: JSON.stringify({ address: ADDR }) });
    await tick(env, { fetchFn });
    assert.ok(sent.some((x) => /bloco .* encontrado/.test(x.text) && x.chat_id === '4242'), JSON.stringify(sent.map((x) => x.text)));
  } finally { t.server.close(); }
});

test('credenciais: chave da conta real com "Teste" escolhido sugere Produção', async () => {
  const t = await setup();
  try {
    const env = Object.assign({}, t.env, { NH_BASE: '', NH_API_KEY: '', NH_API_SECRET: '', NH_ORG_ID: '', ENC_KEY: ENC });
    // produção = NiceHash falsa (aceita as chaves); teste = recusa tudo
    const fetchFn = (u, o) => {
      const s = String(u);
      if (s.startsWith('https://api2.nicehash.com')) return fetch(s.replace('https://api2.nicehash.com', t.base + '/nh'), o);
      if (s.startsWith('https://api-test.nicehash.com')) return Promise.resolve(new Response('{"error_id":"x"}', { status: 401 }));
      return fetch(u, o);
    };
    const put = async (envName) => {
      const r = await worker.fetch(new Request('https://api.example/api/credentials', { method: 'PUT', headers: { Authorization: 'Bearer ' + env.PANEL_TOKEN },
        body: JSON.stringify({ nicehash: { key: MOCK_KEYS.key, secret: MOCK_KEYS.secret, org: MOCK_KEYS.org, env: envName } }) }), env, {}, fetchFn);
      return { status: r.status, body: await r.json() };
    };
    let r = await put('test');
    assert.deepEqual([r.status, r.body.suggestEnv], [400, 'prod']);
    assert.match(r.body.error, /conta real/);
    assert.equal(await env.FD_KV.get('creds'), null, 'nada salvo na sugestão');
    r = await put('prod');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.nicehash.env, 'prod');
    const cfg = JSON.parse(await env.FD_KV.get('config'));
    assert.equal(cfg.mode, 'observe', 'conta real começa em Observar');
  } finally { t.server.close(); }
});

test('cotações: CoinGecko bloqueada cai para Kraken, depois Coinbase', async () => {
  const calls = [];
  const mk = (rules) => async (u) => {
    calls.push(String(u));
    for (const [re, status, body] of rules) if (re.test(u)) return new Response(JSON.stringify(body), { status });
    return new Response('{}', { status: 404 });
  };
  let c = createChain({ fetchFn: mk([[/coingecko/, 403, {}], [/kraken/, 200, { error: [], result: { XXBTZUSD: { c: ['77220.3', '1'] }, BCHUSD: { c: ['296.51', '1'] } } }]]) });
  assert.deepEqual(await c.prices(), { btcUsd: 77220.3, bchUsd: 296.51, src: 'Kraken' });
  c = createChain({ fetchFn: mk([[/coingecko/, 403, {}], [/kraken/, 520, {}], [/BTC-USD/, 200, { data: { amount: '77000' } }], [/BCH-USD/, 200, { data: { amount: '296' } }]]) });
  assert.deepEqual(await c.prices(), { btcUsd: 77000, bchUsd: 296, src: 'Coinbase' });
  c = createChain({ fetchFn: mk([]) });
  await assert.rejects(c.prices(), /nenhuma fonte de cotação respondeu \(CoinGecko: HTTP 404/);
  c = createChain({ fetchFn: mk([[/coingecko/, 200, { bitcoin: { usd: 77100 }, 'bitcoin-cash': { usd: 295 } }]]) });
  assert.equal((await c.prices()).src, 'CoinGecko');
});

test('livro: pede o mercado SHA256ASICBOOST inteiro (sem size vêm só as 100 mais caras)', async () => {
  let url = '';
  const c = createClient({ base: 'https://api2.nicehash.com', fetchFn: async (u) => { url = String(u); return Response.json({ stats: {} }); } });
  await c.orderBook();
  assert.match(url, /algorithm=SHA256ASICBOOST/); assert.match(url, /size=1000/);
});

/* ---------- simulação (modo Observar) e resultado real ---------- */
const PCFG = Object.assign({}, DEFAULT_CONFIG, { targetPh: 10, rentFeePct: 3, sessionBudgetUsd: 300, dailyBudgetUsd: 500 });
const PU = { minLimitPH: 1 }, PL = { maxLimitPh: 100 };
const pm = (o) => Object.assign({ ok: true, green: true, bidEH: 0.40, capEH: 0.42, edgeAtBidPct: 8, D: 500e9, btcUsd: 77000, blockNetUsd: 900 }, o);

test('simulação: acumula gasto, receita média e blocos esperados só enquanto "compraria"', () => {
  const T0 = Date.UTC(2026, 9, 31, 12);
  let r = paperStep(null, { cfg: PCFG, mkt: pm(), now: T0, units: PU, limits: PL });
  assert.match(r.events[0], /compraria 10 PH\/s a 0\.4000/);
  assert.equal(r.paper.spendUsd, 0);
  r = paperStep(r.paper, { cfg: PCFG, mkt: pm(), now: T0 + 180e3, units: PU, limits: PL });
  const cost = 10 * 0.40 / 1000 * 77000 * 1.03 * 180 / 86400, lam = 10 * 1e15 * 180 / (500e9 * 4294967296);
  close(r.paper.spendUsd, cost, 1e-9); close(r.paper.lambda, lam, 1e-15); close(r.paper.evUsd, lam * 900, 1e-9);
  assert.deepEqual(r.events, [], 'sem log repetido');
  r = paperStep(r.paper, { cfg: PCFG, mkt: pm({ green: false, bidEH: 0.45 }), now: T0 + 360e3, units: PU, limits: PL });
  assert.match(r.events[0], /pausaria \(aluguel 0\.4500 acima do teto 0\.4200\)/);
  const spent = r.paper.spendUsd;
  r = paperStep(r.paper, { cfg: PCFG, mkt: pm({ green: false }), now: T0 + 540e3, units: PU, limits: PL });
  close(r.paper.spendUsd, spent, 1e-12, 'pausado não gasta');
  // backend parado 2 h: conta no máximo 15 min
  r = paperStep(r.paper, { cfg: PCFG, mkt: pm(), now: T0 + 600e3, units: PU, limits: PL });
  const before = r.paper.spendUsd;
  r = paperStep(r.paper, { cfg: PCFG, mkt: pm(), now: T0 + 600e3 + 2 * 3600e3, units: PU, limits: PL });
  close(r.paper.spendUsd - before, 10 * 0.40 / 1000 * 77000 * 1.03 * 900 / 86400, 1e-9);
  assert.equal(r.paper.sessions, 1, 'pausar não abre sessão nova (mesma ordem, só potência menor)');
});

test('simulação: stop-loss e limite diário virtuais', () => {
  const T0 = Date.UTC(2026, 9, 31, 0);
  const cfg = Object.assign({}, PCFG, { targetPh: 100, sessionBudgetUsd: 50, dailyBudgetUsd: 120, stopCooldownH: 0 }); // sem espera: testa o limite do dia
  let r = paperStep(null, { cfg, mkt: pm(), now: T0, units: PU, limits: PL }), all = [];
  for (let i = 1; i <= 20; i++) { r = paperStep(r.paper, { cfg, mkt: pm(), now: T0 + i * 180e3, units: PU, limits: PL }); all.push(...r.events); }
  assert.ok(all.some((e) => /stop-loss da tentativa/.test(e)), all.join(' | '));
  assert.ok(all.some((e) => /limite diário de US\$120/.test(e)), all.join(' | '));
  assert.ok(r.paper.days['2026-10-31'].spendUsd < 120 + 40, 'para perto do limite do dia');
  assert.equal(r.paper.on, false);
});

test('resultado real: soma o pago nas ordens gerenciadas e os blocos', () => {
  const T0 = Date.UTC(2026, 9, 31, 12);
  let r = realStep(null, { orders: [{ id: 'A', paidBtc: 0, createdTs: T0 }, { id: 'X', paidBtc: 1 }], managedIds: ['A'], btcUsd: 77000, bchUsd: 300, now: T0 });
  r = realStep(r, { orders: [{ id: 'A', paidBtc: 0.001, createdTs: T0 }], managedIds: ['A'], btcUsd: 77000, bchUsd: 300, now: T0 + 180e3 });
  close(r.spendUsd, 77);
  r = realStep(r, { orders: [], managedIds: ['A'], btcUsd: 77000, bchUsd: 300, now: T0 + 360e3, blockEvent: { height: 1, bch: 3.1 } });
  assert.equal(r.blocks, 1); close(r.revenueUsd, 930);
  assert.deepEqual(r.paid, {}, 'ordem encerrada sai da conta');
});

test('integração: modo Observar registra a simulação e mostra no status', async () => {
  const t = await setup();
  try {
    await t.call('PUT', '/api/config', { mode: 'observe', targetPh: 20 });
    let r = await t.call('POST', '/api/tick');
    assert.ok(r.body.paper && r.body.paper.on, JSON.stringify(r.body.market));
    const log = await t.call('GET', '/api/log');
    assert.ok(log.body.log.some((l) => l.kind === 'simulado' && /Simulação: compraria 20 PH\/s/.test(l.text)));
    const st = await t.call('GET', '/api/status');
    assert.equal(st.body.state.paper.sessions, 1);
    assert.ok(st.body.state.market.blockNetUsd > 0);
    assert.equal((await t.call('POST', '/api/paper/reset')).status, 200);
    assert.equal((await t.call('GET', '/api/status')).body.state.paper, null);
  } finally { t.server.close(); }
});

test('funding simulado: entra após 2 leituras, recebe nos horários de cada exchange, sai quando vira contra', () => {
  const T0 = Date.UTC(2026, 9, 31, 12), M = 60e3;
  const fees = { Bybit: { taker: 0.055 }, Hyperliquid: { taker: 0.045 } };
  const rows = (sBy, nBy, sHl, nHl) => ({ ENA: { Bybit: { rate: sBy, apr: sBy * 3 * 365, hours: 8, next: nBy }, Hyperliquid: { rate: sHl, apr: sHl * 24 * 365, hours: 1, next: nHl } } });
  const best = [{ key: 'ENA|Bybit|Hyperliquid', coin: 'ENA', s: 'Bybit', l: 'Hyperliquid' }];
  let r = fundPaperStep(null, { rows: rows(0.1, T0 + 60 * M, 0.00125, T0 + 10 * M), best, now: T0, fees, rules: TAKER });
  assert.equal(r.pf.open.length, 0, 'uma leitura só não entra');
  r = fundPaperStep(r.pf, { rows: rows(0.1, T0 + 60 * M, 0.00125, T0 + 10 * M), best, now: T0 + 3 * M, fees, rules: TAKER });
  assert.equal(r.pf.open.length, 1); assert.match(r.events[0], /entrou em ENA \(short Bybit, long Hyperliquid\)/);
  close(r.pf.open[0].feesUsd, 1000 * (0.055 + 0.045 + 0.015) / 100);
  r = fundPaperStep(r.pf, { rows: rows(0.1, T0 + 60 * M, 0.00125, T0 + 70 * M), best, now: T0 + 15 * M, fees, rules: TAKER });
  close(r.pf.open[0].fundingUsd, -0.0125, 1e-12, 'long na HL paga a taxa');
  r = fundPaperStep(r.pf, { rows: rows(0.1, T0 + 60 * M, 0.00125, T0 + 70 * M), best, now: T0 + 18 * M, fees, rules: TAKER });
  assert.equal(r.pf.open[0].payments, 1, 'não paga duas vezes o mesmo horário');
  r = fundPaperStep(r.pf, { rows: rows(0.1, T0 + 540 * M, 0.00125, T0 + 70 * M), best, now: T0 + 61 * M, fees, rules: TAKER });
  close(r.pf.open[0].fundingUsd, 1 - 0.0125, 1e-12, 'short na Bybit recebe 0,1%');
  // diferença vira negativa duas vezes: sai
  r = fundPaperStep(r.pf, { rows: rows(-0.01, T0 + 540 * M, 0.00125, T0 + 130 * M), best: [], now: T0 + 64 * M, fees, rules: TAKER });
  assert.equal(r.pf.open.length, 1, 'uma leitura negativa ainda não sai');
  r = fundPaperStep(r.pf, { rows: rows(-0.01, T0 + 540 * M, 0.00125, T0 + 130 * M), best: [], now: T0 + 67 * M, fees, rules: TAKER });
  assert.equal(r.pf.open.length, 0); assert.equal(r.pf.closed.length, 1);
  const c = r.pf.closed[0];
  close(c.netUsd, 1 - 0.0125 - 2 * 1.15, 1e-9); assert.match(c.reason, /virou contra/); assert.match(r.events[0], /saiu de ENA .* −US\$1\.31/);
  const sum = fundPaperSummary(r.pf);
  assert.deepEqual([sum.closed, sum.wins, sum.open], [1, 0, 0]);
  close(sum.fundingUsd - sum.feesUsd, sum.netUsd, 1e-9, 'quadro financeiro: recebido − taxas = resultado');
});

test('funding simulado: no máximo 3 abertas, uma por moeda; moeda que some fecha', () => {
  const T0 = Date.UTC(2026, 9, 31, 12), fees = {};
  const coins = ['A', 'B', 'C', 'D'], rows = {}, best = [];
  for (const c of coins) { rows[c] = { Bybit: { rate: 0.05, apr: 54.75, hours: 8, next: T0 + 36e5 }, Binance: { rate: 0.01, apr: 10.95, hours: 8, next: T0 + 36e5 } }; best.push({ key: c + '|Bybit|Binance', coin: c, s: 'Bybit', l: 'Binance' }); }
  best.push({ key: 'A|Bybit|Hyperliquid', coin: 'A', s: 'Bybit', l: 'Hyperliquid' });
  let r = fundPaperStep(null, { rows, best, now: T0, fees });
  r = fundPaperStep(r.pf, { rows, best, now: T0 + 18e4, fees });
  assert.deepEqual(r.pf.open.map((o) => o.coin), ['A', 'B', 'C']);
  const rows2 = Object.assign({}, rows); delete rows2.B;
  r = fundPaperStep(r.pf, { rows: rows2, best: [], now: T0 + 36e4, fees });
  r = fundPaperStep(r.pf, { rows: rows2, best: [], now: T0 + 54e4, fees });
  assert.equal(r.pf.closed[0].coin, 'B'); assert.match(r.pf.closed[0].reason, /saiu dos dados/);
});

test('mineração simulada: cada "compraria → pausaria" vira uma operação com resultado', () => {
  const T0 = Date.UTC(2026, 9, 31, 12);
  let r = paperStep(null, { cfg: PCFG, mkt: pm(), now: T0, units: PU, limits: PL });
  assert.equal(r.paper.run.ph, 10);
  r = paperStep(r.paper, { cfg: PCFG, mkt: pm(), now: T0 + 600e3, units: PU, limits: PL });
  r = paperStep(r.paper, { cfg: PCFG, mkt: pm({ green: false, bidEH: 0.45 }), now: T0 + 1200e3, units: PU, limits: PL });
  assert.equal(r.paper.runs.length, 1); assert.equal(r.paper.run, null);
  const run = r.paper.runs[0];
  close(run.spendUsd, 10 * 0.40 / 1000 * 77000 * 1.03 * 1200 / 86400, 1e-9); assert.match(run.reason, /acima do teto/);
  close(run.hours, 1200 / 3600, 1e-9);
  // stop-loss fecha a operação e espera stopCooldownH (igual ao robô); depois, se continuar verde, abre outra
  const cfg = Object.assign({}, PCFG, { targetPh: 100, sessionBudgetUsd: 30 });
  r = paperStep(null, { cfg, mkt: pm(), now: T0, units: PU, limits: PL });
  for (let i = 1; i <= 8; i++) r = paperStep(r.paper, { cfg, mkt: pm(), now: T0 + i * 180e3, units: PU, limits: PL });
  assert.ok(r.paper.runs.some((x) => /stop-loss/.test(x.reason)));
  assert.ok(!r.paper.on, 'em espera depois do stop-loss');
  r = paperStep(r.paper, { cfg, mkt: pm(), now: T0 + 7 * 3600e3, units: PU, limits: PL });
  assert.ok(r.paper.run && r.paper.on, 'nova operação depois da espera');
});

test('mineração simulada: simulação antiga (sem diário) abre a operação no próximo ciclo', () => {
  const T0 = Date.UTC(2026, 9, 31, 12);
  const old = { since: T0 - 3600e3, lastTs: T0 - 180e3, on: true, ph: 10, priceEH: 0.4, D: 500e9, btcUsd: 77000, blockNetUsd: 900, spendUsd: 5, evUsd: 5.2, lambda: 0.01, hoursOn: 1, sessions: 1, stops: 0, sess: { start: T0 - 3600e3, spendUsd: 5, lambda: 0.01 }, days: {} };
  const r = paperStep(old, { cfg: PCFG, mkt: pm(), now: T0, units: PU, limits: PL });
  assert.deepEqual(r.events, []); assert.equal(r.paper.run.start, T0); assert.deepEqual(r.paper.runs, []);
});

test('placar dos alertas: acompanha o prazo projetado e compara com o que pagou', () => {
  const T0 = Date.UTC(2026, 9, 31, 12), H = 36e5, fees = { Bybit: { taker: 0.055 }, Hyperliquid: { taker: 0.045 } };
  const rows = (next) => ({ ENA: { Bybit: { rate: 0.05, apr: 54.75, hours: 8, next }, Hyperliquid: { rate: 0, apr: 0, hours: 1, next: T0 + 999 * H } } });
  const e = [{ key: 'ENA|Bybit|Hyperliquid', coin: 'ENA', s: 'Bybit', l: 'Hyperliquid', projUsd: 2.2 }];
  let sc = alertScoreStep(null, { rows: rows(T0 + 8 * H), entries: e, now: T0, fees, holdDays: 1, rules: TAKER });
  assert.equal(sc.open.length, 1);
  sc = alertScoreStep(sc, { rows: rows(T0 + 16 * H), entries: [], now: T0 + 8 * H + 60e3, fees, holdDays: 1, rules: TAKER });
  sc = alertScoreStep(sc, { rows: rows(T0 + 24 * H), entries: [], now: T0 + 16 * H + 60e3, fees, holdDays: 1, rules: TAKER });
  sc = alertScoreStep(sc, { rows: rows(T0 + 32 * H), entries: [], now: T0 + 24 * H + 60e3, fees, holdDays: 1, rules: TAKER });
  assert.equal(sc.open.length, 0); assert.equal(sc.done.length, 1);
  const d = sc.done[0];
  assert.equal(d.payments, 3); close(d.fundingUsd, 1.5, 1e-9);
  close(d.costsUsd, 1000 * (2 * 0.1 + 0.03) / 100, 1e-9); close(d.netUsd, 1.5 - 2.3, 1e-9); assert.equal(d.hit, false);
  const sum = alertScoreSummary(sc);
  assert.deepEqual([sum.scored, sum.hits], [1, 0]); close(sum.projUsd, 2.2); close(sum.realUsd, -0.8, 1e-9);
});

test('integração: alerta de entrada de funding entra no placar', async () => {
  const t = await setup();
  try {
    await t.call('POST', '/api/tick'); const r = await t.call('POST', '/api/tick');
    assert.ok(r.body.alerts.some((a) => /ENA/.test(a.title)));
    const st = await t.call('GET', '/api/status');
    const sc = st.body.state.alertScore;
    assert.equal(sc.summary.open, 1); assert.equal(sc.open[0].coin, 'ENA'); assert.ok(sc.open[0].projUsd > 0);
    assert.equal(sc.open[0].legs, undefined);
  } finally { t.server.close(); }
});

test('mineração simulada: sorteio honesto pelos blocos reais da rede (hash do bloco)', () => {
  const T0 = Date.UTC(2026, 9, 31, 12), D = 500e9;
  const prob = 10e15 / (D * 4294967296 / 600 + 10e15);
  let r = paperStep(null, { cfg: PCFG, mkt: pm({ D }), now: T0, units: PU, limits: PL, blocks: [{ height: 1, hash: 'ab00000000', difficulty: D }] });
  assert.equal(r.paper.draws || 0, 0, 'antes de comprar não sorteia');
  r = paperStep(r.paper, { cfg: PCFG, mkt: pm({ D }), now: T0 + 180e3, units: PU, limits: PL, blocks: [{ height: 2, hash: '00ffffffff', difficulty: D }] });
  assert.equal(r.paper.draws, 1); assert.equal(r.paper.blocks || 0, 0, 'número sorteado alto: não é seu');
  r = paperStep(r.paper, { cfg: PCFG, mkt: pm({ D }), now: T0 + 360e3, units: PU, limits: PL, blocks: [{ height: 3, hash: '0000000000', difficulty: D, time: T0 + 300e3 }] });
  assert.equal(r.paper.blocks, 1); close(r.paper.wonUsd, 900);
  assert.match(r.events[0], new RegExp('bloco 3 seria seu .*chance era ' + (prob * 100).toFixed(2).replace('.', '\\.') + '%'));
  assert.equal(r.paper.runs.length, 1); assert.match(r.paper.runs[0].reason, /bloco achado: encerraria a ordem/);
  assert.equal(r.paper.runs[0].blocks, 1); close(r.paper.runs[0].wonUsd, 900);
  assert.ok(r.paper.on && r.paper.run && r.paper.run.start === T0 + 360e3, 'mercado favorável: abre outra operação');
  assert.equal(r.paper.wins[0].height, 3);
  // "continuar" não encerra a operação
  const cfg = Object.assign({}, PCFG, { onBlock: 'continue' });
  let c = paperStep(null, { cfg, mkt: pm({ D }), now: T0, units: PU, limits: PL });
  c = paperStep(c.paper, { cfg, mkt: pm({ D }), now: T0 + 180e3, units: PU, limits: PL, blocks: [{ height: 9, hash: '00', difficulty: D }] });
  assert.equal(c.paper.runs.length, 0); assert.equal(c.paper.run.blocks, 1);
});

test('integração: bloco real da rede sorteado como seu na simulação', async () => {
  const t = await setup();
  try {
    await t.call('PUT', '/api/config', { mode: 'observe', targetPh: 20 });
    await t.call('POST', '/api/tick');
    await fetch(t.base + '/_set', { method: 'POST', body: JSON.stringify({ hashes: { [t.state.height + 1]: '00000000000000000000aa00000000' } }) });
    await fetch(t.base + '/_mine', { method: 'POST', body: JSON.stringify({ address: 'qoutro' }) });
    const r = await t.call('POST', '/api/tick');
    assert.equal(r.body.paper.blocks, 1, JSON.stringify(r.body.paper));
    const log = await t.call('GET', '/api/log');
    assert.ok(log.body.log.some((l) => /seria seu \(sorteio pelo hash do bloco/.test(l.text)));
  } finally { t.server.close(); }
});

test('outras moedas (PPS): orçamento fixo enquanto compensa; pausa com o motivo', () => {
  const T0 = Date.UTC(2026, 9, 31, 12), M = 60e3;
  const mk = (level, edge, thin) => [{ algo: 'SCRYPT', label: 'Scrypt', coins: ['LTC', 'DOGE'], level, edgePct: edge, thin: !!thin }];
  let r = algoPaperStep(null, { map: mk('go', 10), now: T0 });
  assert.match(r.events[0], /compraria Scrypt \(LTC\+DOGE\) com margem de 10\.0%/);
  r = algoPaperStep(r.pa, { map: mk('go', 10), now: T0 + 15 * M });
  const a = r.pa.algos.SCRYPT, sp = 100 * 15 / 1440;
  close(a.spendUsd, sp, 1e-9); close(a.revUsd, sp * 1.10, 1e-9); close(a.hoursOn, 0.25, 1e-9);
  close(r.pa.days['2026-10-31'].revUsd - r.pa.days['2026-10-31'].spendUsd, sp * 0.10, 1e-9, 'total do dia para a evolução no Início');
  r = algoPaperStep(r.pa, { map: mk('maybe', 4, true), now: T0 + 30 * M });
  assert.match(r.events[0], /pausaria Scrypt \(livro raso/);
  const b = r.pa.algos.SCRYPT;
  assert.equal(b.on, false); assert.equal(b.runs.length, 1); close(b.runs[0].revUsd - b.runs[0].spendUsd, 2 * sp * 0.10, 1e-9);
  // parado não gasta; volta com nova operação
  r = algoPaperStep(r.pa, { map: mk('no', -20), now: T0 + 45 * M });
  close(r.pa.algos.SCRYPT.spendUsd, 2 * sp, 1e-9);
  r = algoPaperStep(r.pa, { map: mk('go', 6), now: T0 + 60 * M });
  assert.ok(r.pa.algos.SCRYPT.run && r.pa.algos.SCRYPT.run.start === T0 + 60 * M);
  // intervalo longo (servidor parado) conta no máximo 20 min
  r = algoPaperStep(r.pa, { map: mk('go', 6), now: T0 + 60 * M + 5 * 36e5 });
  close(r.pa.algos.SCRYPT.run.spendUsd, 100 * 20 / 1440, 1e-9);
});

test('integração: outras moedas entram no status a cada 15 min', async () => {
  const t = await setup();
  try {
    const T0 = Date.now();
    await tick(t.env, { now: T0 });
    let st = (await t.call('GET', '/api/status')).body.state;
    assert.ok(st.algoPaper && st.algoPaper.algos.SCRYPT, JSON.stringify(st.algoPaper));
    const since = st.algoPaper.since;
    await tick(t.env, { now: T0 + 5 * 60e3 }); // antes de 15 min: não recalcula
    st = (await t.call('GET', '/api/status')).body.state;
    assert.equal(st.algoPaper.lastTs, since);
    await tick(t.env, { now: T0 + 16 * 60e3 });
    st = (await t.call('GET', '/api/status')).body.state;
    assert.equal(st.algoPaper.lastTs, T0 + 16 * 60e3);
  } finally { t.server.close(); }
});

test('outras moedas: margem irreal (> 100%) não entra', () => {
  const r = algoPaperStep(null, { map: [{ algo: 'X11', label: 'X11', coins: ['DASH'], level: 'go', edgePct: 450 }], now: Date.UTC(2026, 9, 31) });
  assert.equal(r.pa.algos.X11.on, false); assert.deepEqual(r.events, []);
});

/* ---------- IA do funding (modo sombra) ---------- */
import { updateHistory, pickCoins, scorePairs } from '../worker/src/fundai.js';
import { pairFeatures, score, FEATURES } from '../worker/src/features.js';

test('IA: características só do passado e nota logística', () => {
  const be = 30, flat = new Array(72).fill(60), spike = new Array(71).fill(5).concat([140]);
  const a = pairFeatures(flat, be), b = pairFeatures(spike, be);
  assert.equal(a.length, FEATURES.length);
  close(a[0], 0.30); close(a[3], 0.30); close(a[5], 1); close(a[6], 1, 1e-9, '72 h seguidas acima do empate');
  assert.ok(b[7] > a[7], 'pico fica marcado'); close(b[6], 1 / 72);
  const m = { mean: new Array(8).fill(0), std: new Array(8).fill(1), weights: [0, 0, 0, 4, 0, 0, 0, -1], bias: 0 };
  assert.ok(score(m, a) > score(m, b), 'spread estável vale mais que pico');
});

test('IA: histórico horário próprio (72 h) e nota dos pares candidatos', () => {
  const rows = (x) => ({ ENA: { Bybit: { apr: x }, Hyperliquid: { apr: 10 } }, BTC: { Binance: { apr: 11 }, Hyperliquid: { apr: 10 } } });
  let fh = null;
  for (let h = 0; h < 80; h++) fh = updateHistory(fh, { rows: rows(90), selected: pickCoins(rows(90), []), hour: 1000 + h });
  assert.deepEqual(Object.keys(fh.coins), ['ENA'], 'só moedas com diferença ≥ 20% a.a.');
  assert.equal(fh.coins.ENA.v.Bybit.length, 72);
  assert.equal(updateHistory(fh, { rows: rows(0), selected: [], hour: 1079 }).coins.ENA.v.Bybit.length, 72, 'mesma hora: não muda');
  const model = { mean: new Array(8).fill(0), std: new Array(8).fill(1), weights: [1, 0, 0, 0, 0, 0, 0, 0], bias: 0, threshold: 0.5 };
  const fees = { Bybit: { taker: 0.055 }, Hyperliquid: { taker: 0.045 } };
  const sc = scorePairs(fh, { model, fees });
  assert.deepEqual(Object.keys(sc), ['ENA|Bybit|Hyperliquid'], 'só a direção acima do empate');
  assert.ok(sc['ENA|Bybit|Hyperliquid'].p > 0.5); assert.equal(sc['ENA|Bybit|Hyperliquid'].hours, 72);
  // moeda nova com menos de 6 h de histórico ainda não recebe nota
  let f2 = null; for (let h = 0; h < 4; h++) f2 = updateHistory(f2, { rows: rows(90), selected: ['ENA'], hour: h });
  assert.deepEqual(scorePairs(f2, { model, fees }), {});
  // some do acompanhamento 24 h depois de sair da seleção
  let f3 = fh; for (let h = 1080; h < 1106; h++) f3 = updateHistory(f3, { rows: rows(0), selected: [], hour: h });
  assert.deepEqual(Object.keys(f3.coins), []);
});

test('placar: separa os alertas que a IA aprovaria dos que vetaria', () => {
  const T0 = Date.UTC(2026, 9, 31, 12), H = 36e5, fees = {};
  const rows = { A: { Bybit: { rate: 0.05, apr: 54.75, hours: 8, next: T0 + 8 * H }, Binance: { rate: 0, apr: 0, hours: 8, next: T0 + 8 * H } } };
  let sc = alertScoreStep(null, { rows, entries: [{ key: 'A|Bybit|Binance', coin: 'A', s: 'Bybit', l: 'Binance', projUsd: 1, ai: 0.8 }, { key: 'A|Bybit|Binance', coin: 'A', s: 'Bybit', l: 'Binance', projUsd: 1, ai: 0.2 }], now: T0, fees, holdDays: 1 });
  sc = alertScoreStep(sc, { rows, entries: [], now: T0 + 25 * H, fees, holdDays: 1 });
  const s = alertScoreSummary(sc, 0.5);
  assert.deepEqual([s.aiYes.n, s.aiNo.n], [1, 1]);
});

test('integração: simulação em rajada (50 PH/s, para no bloco) roda ao lado da contínua', async () => {
  const t = await setup();
  try {
    await t.call('PUT', '/api/config', { mode: 'observe', targetPh: 10 });
    await t.call('POST', '/api/tick');
    await fetch(t.base + '/_set', { method: 'POST', body: JSON.stringify({ hashes: { [t.state.height + 1]: 'ffffffff' } }) });
    await fetch(t.base + '/_mine', { method: 'POST', body: JSON.stringify({ address: 'qoutro' }) });
    await t.call('POST', '/api/tick');
    const st = (await t.call('GET', '/api/status')).body.state;
    assert.equal(st.paperBurst.ph, 50); assert.equal(st.paper.ph, 10);
    assert.equal(st.paperBurst.draws, 1); assert.equal(st.paper.draws, 1, 'mesmo bloco real nas duas');
    assert.ok(st.paperBurst.spendUsd > st.paper.spendUsd * 4.9, 'rajada gasta 5x mais por hora');
    assert.equal(st.paperAlways.ph, 10); assert.equal(st.paperAlways.draws, 1, 'sempre ligado usa os mesmos blocos');
  } finally { t.server.close(); }
});

test('simulação: preço da ordem desce só um degrau a cada 10 min (regra da NiceHash, igual ao robô)', () => {
  const T0 = Date.UTC(2026, 9, 31, 12);
  const U = { minLimitPH: 1, priceDownStepEH: 0.002 };
  let r = paperStep(null, { cfg: PCFG, mkt: pm({ bidEH: 0.410 }), now: T0, units: U, limits: PL });
  r = paperStep(r.paper, { cfg: PCFG, mkt: pm({ bidEH: 0.400 }), now: T0 + 180e3, units: U, limits: PL });
  assert.equal(+r.paper.priceEH.toFixed(4), 0.408, 'primeiro degrau');
  r = paperStep(r.paper, { cfg: PCFG, mkt: pm({ bidEH: 0.400 }), now: T0 + 360e3, units: U, limits: PL });
  assert.equal(+r.paper.priceEH.toFixed(4), 0.408, 'antes de 10 min não desce');
  r = paperStep(r.paper, { cfg: PCFG, mkt: pm({ bidEH: 0.415 }), now: T0 + 540e3, units: U, limits: PL });
  assert.equal(r.paper.priceEH, 0.415, 'subir é na hora');
});

test('integração: "sempre ligado" segue comprando quando o aluguel passa do teto', async () => {
  const t = await setup();
  try {
    await t.call('PUT', '/api/config', { mode: 'observe', targetPh: 10, minEdgePct: 90 }); // teto inalcançável: o robô pausa
    await t.call('POST', '/api/tick');
    const st = (await t.call('GET', '/api/status')).body.state;
    assert.equal(st.paper.on, false); assert.equal(st.paperAlways.on, true);
  } finally { t.server.close(); }
});

/* ---------- registro dos blocos da rede ---------- */
import { blockRecord, blockSummary, poolOf } from '../worker/src/blocks.js';
import { tagFrom } from '../worker/src/chain.js';

test('blocos: assinatura do pool, recompensa, taxas, hash da rede e contexto', () => {
  assert.equal(tagFrom('03a7e10e042553e56a0e736f6c6f706f6f6c2e6f7267eeac348e3d15cb587f3b80000088'), 'solopool.org', 'bloco 975271 de verdade');
  assert.deepEqual(poolOf('/BlockSniper/ x'), { pool: 'BlockSniper', solo: true });
  assert.deepEqual(poolOf('/ViaBTC/Mined by y'), { pool: 'ViaBTC', solo: false });
  const b = { height: 975271, hash: '00ab', time: 1793413925000, difficulty: 522769773689.7484, size: 23618, txs: 46, tag: 'solopool.org',
    outs: [{ value: 3.06350017 }, { value: 0.06252041 }] };
  const r = blockRecord(b, { prevT: 1793413925000 - 540e3, mkt: { ok: true, bchUsd: 290, bidEH: 0.41, medianEH: 0.42, breakEvenEH: 0.4380, edgeAtBidPct: 6.8 }, book: { totalPH: 19450.2 }, sim: { ph: 10, prob: 0.0026, won: false } });
  assert.deepEqual([r.pool, r.solo, r.dt, r.size, r.txs, r.outs], ['SoloPool.org', true, 540, 23618, 46, 2]);
  close(r.reward, 3.12602058); close(r.fees, 0.00102058, 1e-8); close(r.poolFeePct, 2, 0.01);
  close(r.netPH, 3742, 1); close(r.usd, 906.55, 0.01); assert.equal(r.nhPH, 19450.2); assert.equal(r.simPH, 10);
  const sum = blockSummary([r, Object.assign({}, r, { pool: 'ViaBTC', solo: false, dt: 2000, edge: -2 })]);
  assert.deepEqual([sum.n, sum.solo.n, sum.other.n, sum.slow], [2, 1, 1, 1]);
  assert.equal(sum.byPool.length, 2); assert.equal(sum.solo.hoursUtc[2], 1);
});

test('integração: blocos da rede ficam registrados com o contexto', async () => {
  const t = await setup();
  try {
    await t.call('PUT', '/api/config', { mode: 'observe', targetPh: 10 });
    await t.call('POST', '/api/tick');
    await fetch(t.base + '/_mine', { method: 'POST', body: JSON.stringify({ address: 'qoutro' }) });
    await t.call('POST', '/api/tick');
    const r = await t.call('GET', '/api/blocks');
    assert.equal(r.body.blocks.length, 1);
    const b = r.body.blocks[0];
    assert.deepEqual([b.pool, b.solo, b.txs, b.simPH], ['Solo (outro)', true, 40, 10]);
    assert.ok(b.netPH > 0 && b.nhPH > 0 && b.edge !== undefined && b.simProb > 0);
    assert.equal(r.body.summary.n, 1);
  } finally { t.server.close(); }
});

test('integração: busca blocos anteriores ao registro (só dados da blockchain)', async () => {
  const t = await setup();
  try {
    await t.call('POST', '/api/tick');
    await fetch(t.base + '/_mine', { method: 'POST', body: JSON.stringify({ address: 'qoutro' }) });
    await t.call('POST', '/api/tick');
    const r = await t.call('POST', '/api/blocks/backfill', { count: 5 });
    assert.equal(r.body.added, 5);
    const b = (await t.call('GET', '/api/blocks')).body.blocks;
    assert.equal(b.length, 6); assert.ok(b[5].backfill); assert.equal(b[5].pool, 'ViaBTC');
    assert.deepEqual(b.map((x) => x.h), [...b.map((x) => x.h)].sort((x, y) => y - x), 'mais novo primeiro');
    assert.ok(b[1].dt !== null, 'intervalo calculado com o vizinho');
  } finally { t.server.close(); }
});

test('blocos: nomes de pool agrupados mesmo com assinatura suja', () => {
  assert.equal(poolOf('/JCBCH/Z').pool, 'JCBCH'); assert.equal(poolOf('LXBG LSoftware DMCC 9810').pool, 'LSoftware DMCC');
  assert.equal(poolOf('/luckyfastblocks/').pool, 'luckyfastblocks'); assert.equal(poolOf('000d5fce KardanPool').pool, 'KardanPool');
  assert.equal(poolOf('themule.online').pool, 'themule.online'); assert.deepEqual(poolOf(''), { pool: 'desconhecido', solo: false });
});

test('funding: regra validada exige 24 h seguidas acima do empate (ordem limite)', async () => {
  const { stablePairs } = await import('../worker/src/fundai.js');
  const fees = { Bybit: { maker: 0.02 }, Hyperliquid: { maker: 0.015 } };
  const mk = (n, x) => ({ coins: { ENA: { lastSel: 1, v: { Bybit: new Array(n).fill(x), Hyperliquid: new Array(n).fill(0) } } } });
  assert.deepEqual(stablePairs(mk(24, 40), { fees }), { 'ENA|Bybit|Hyperliquid': true });
  assert.deepEqual(stablePairs(mk(23, 40), { fees }), {}, 'menos de 24 h: ainda não');
  const dip = mk(24, 40); dip.coins.ENA.v.Bybit[10] = 5;
  assert.deepEqual(stablePairs(dip, { fees }), {}, 'uma hora abaixo do empate quebra');
  // no servidor: sem 24 h de histórico, a oportunidade fica "no limite" e não gera alerta de entrada
  const t = await setup();
  try {
    await t.call('PUT', '/api/config', { fundStable24: true });
    await t.call('POST', '/api/tick'); const r = await t.call('POST', '/api/tick');
    assert.equal(r.body.alerts.filter((a) => a.kind === 'entrada' && a.area === 'funding').length, 0);
  } finally { t.server.close(); }
});

/* ---------- sinais de mineração (DARR etc.) ---------- */
import { hashpriceEH, darrOf, darrBand, retargetOf, momentumOf, windowMeter, weekAdd } from '../worker/src/signals.js';
test('DARR: BCH paga por hash ÷ BTC paga por hash', () => {
  const hp = hashpriceEH(1e12, 3.125, 1);
  close(hp, 86400 * 1e18 / (1e12 * 4294967296) * 3.125, 1e-9);
  // mesma dificuldade relativa e BCH a 1/150 do BTC com dificuldade 150x menor → DARR 1
  const r = darrOf({ dBch: 1e12, bchBtc: 1 / 150, dBtc: 150e12 });
  close(r.darr, 1, 1e-12);
  assert.match(darrBand(1.06), /só 0,1% das horas/); assert.match(darrBand(0.9), /abaixo da média/);
  const rt = retargetOf({ difficultyChange: 5, estimatedRetargetDate: 1, remainingBlocks: 10, progressPercent: 99 }, 0.97);
  close(rt.darrAfter, 0.97 * 1.05, 1e-12);
  const m = momentumOf(new Array(100).fill(0.004).concat(new Array(24).fill(0.0044)));
  assert.ok(m.vsEmaPct > 0 && m.ret24Pct > 9);
  const now = Date.UTC(2026, 9, 31, 12), rec = [];
  for (let i = 0; i < 10; i++) rec.push({ t: now - i * 300e3, pool: i < 6 ? 'ViaBTC' : 'CKPool Solo', solo: i >= 6 });
  const w = windowMeter(rec, now);
  assert.deepEqual([w.last1h, w.solo6h], [10, 4]); close(w.bigShare6h, 0.6);
  let wk = weekAdd(null, now, { edge: 2, price: 0.42, ph: 19000, darr: 1.01 });
  wk = weekAdd(wk, now, { edge: 4, price: 0.40, ph: 19000, darr: 1.03 });
  const b = wk[new Date(now).getUTCDay() * 24 + 12]; assert.equal(b[0], 2); close(b[1] / b[0], 3);
});

test('integração: DARR, reajuste do BTC, BCH/BTC contra a média e medidor no status', async () => {
  const t = await setup();
  try {
    await t.call('POST', '/api/tick');
    const st = (await t.call('GET', '/api/status')).body.state;
    assert.ok(st.darr && st.darr.v > 0, JSON.stringify(st.darr));
    close(st.retarget.darrAfter, st.darr.v * 1.04, 1e-9);
    assert.ok(st.momentum.vsEmaPct > 0 && st.momentum.ret24Pct > 0);
    assert.equal(st.window.exp1h, 6); assert.equal(st.nhWeek.length, 168);
    assert.ok(st.edgeHist.length && st.edgeHist[0].length >= 4);
  } finally { t.server.close(); }
});

/* ---------- copiloto IA: previsões conferíveis, XP e maturidade ---------- */
import { brainStep, analysis, levelOf, reliability, actionPlan } from '../worker/src/brain.js';
test('IA: cria previsões dos sinais, confere no prazo e ganha XP', () => {
  const T0 = Date.UTC(2026, 9, 31, 12), H = 36e5;
  const base = { now: T0, edge: 1.5, green: false, minEdge: 3, darr: 1.05, D: 5e11, mom: { vsEmaPct: 3 }, ret: null, win: { last6h: 30, bigShare6h: 0.5, bigShare24h: 0.5 }, fund: [], rows: {}, stable24: {}, algos: [{ k: 'SCRYPT', label: 'Scrypt', edge: 8, level: 'go' }], scoreDone: [] };
  let r = brainStep(null, base);
  assert.deepEqual(r.ai.open.map((o) => o.type).sort(), ['algo_go', 'mine_wait']);
  assert.match(r.events[0], /IA prevê/);
  // margem passa do mínimo antes de 6 h → acerto; Scrypt segue positivo em 6 h → acerto
  r = brainStep(r.ai, Object.assign({}, base, { now: T0 + 2 * H, edge: 3.5, green: true }));
  r = brainStep(r.ai, Object.assign({}, base, { now: T0 + 6 * H + 1, edge: 1, green: false }));
  const done = r.ai.done.filter((d) => d.hit !== null);
  assert.ok(done.some((d) => d.type === 'mine_wait' && d.hit) && done.some((d) => d.type === 'algo_go' && d.hit), JSON.stringify(done));
  assert.ok(r.ai.xp > 0);
  // a compra feita às 2 h (mine_buy) é conferida 1 h depois: margem 1% ≥ 0 → acerto
  assert.ok(r.ai.done.some((d) => d.type === 'mine_buy' && d.hit));
  const L = levelOf(r.ai); assert.equal(L.level.name, 'Aprendiz'); assert.ok(L.progress > 0 && L.progress < 1);
  const a = analysis(Object.assign({}, base, { green: true, edge: 4 }), r.ai);
  assert.match(a.lines[0], /janela aberta/); assert.ok(a.recs.some((x) => x.area === 'outras'));
  // confiança aprende com o histórico do tipo
  const ai = { stats: { mine_avoid: { n: 30, hits: 27 } } };
  assert.ok(reliability(ai, 'mine_avoid').trusted && reliability(ai, 'mine_avoid').conf > 0.75);
});

test('outros fornecedores: Braiins (preço para receber hash) e MiningRigRentals', async () => {
  const { braiinsOf, mrrOf, stratumCheck } = await import('../worker/src/hashmarkets.js');
  const rd = (f) => JSON.parse(readFileSync(new URL('./fixtures/' + f, import.meta.url)));
  const b = braiinsOf(rd('braiins-orderbook.real.json'), rd('braiins-stats.real.json'));
  assert.equal(b.matchEH, 0.4348); assert.equal(b.bestAskEH, 0.42193); assert.ok(b.availPH > 5000 && b.matchedPH > 1000); assert.equal(b.feePct, 0);
  const m = mrrOf(rd('mrr-sha256.real.json'));
  close(m.suggestedEH, 0.6267, 1e-9); close(m.availPH, 3009.665, 1e-3); close(m.rentedPH, 29.0548, 1e-3);
  // Stratum: lê o extranonce2_size do mining.subscribe (Braiins exige ≥ 7)
  const fake = (reply) => () => ({ writable: new WritableStream(), readable: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(reply)); c.close(); } }), close() {} });
  const ok = await stratumCheck('pool.example', 3333, fake('{"id":1,"result":[[["mining.notify","a"]],"0800abcd",8],"error":null}\n'));
  assert.deepEqual([ok.extranonce2Size, ok.extranonce1Bytes, ok.braiins], [8, 4, true]);
  const bch = await stratumCheck('pool.example', 3333, fake('{"id":null,"method":"x"}\n{"id":1,"result":[[],"0800abcd",4],"error":null}\n'));
  assert.equal(bch.braiins, false);
  await assert.rejects(stratumCheck('pool.example', 3333, fake('')), /fechou/);
  const t = await setup();
  try {
    t.env.CONNECT = fake('{"id":1,"result":[[],"00",4],"error":null}\n');
    const r = await t.call('POST', '/api/pool/check', { host: 'stratum+tcp://Solo.BlockSniper.ai', port: 3333 });
    assert.deepEqual([r.body.host, r.body.extranonce2Size, r.body.braiins], ['solo.blocksniper.ai', 4, false]);
    assert.equal((await t.call('POST', '/api/pool/check', { host: 'x', port: 3333 })).status, 400);
  } finally { t.server.close(); }
});

test('frentes: leitura das fontes reais e robô de funding com a Lighter (taxa zero)', async () => {
  const F = await import('../worker/src/fronts.js');
  const rd = (f) => JSON.parse(readFileSync(new URL('./fixtures/' + f, import.meta.url)));
  const NOWF = Date.UTC(2026, 9, 31, 13);
  const b = F.bitfinexOf(rd('bitfinex-funding-tickers.real.json')); close(b.netApr, b.lastApr * 0.85, 1e-9); assert.ok(b.frrApr > 10 && b.frrApr < 15);
  const d = F.deribitBasisOf(rd('deribit-btc-futures.real.json').result, NOWF);
  assert.equal(d.contract, 'BTC-29JAN27'); assert.ok(d.basisApr > 5 && d.basisApr < 6.5 && d.netApr < d.basisApr);
  assert.ok(Math.abs(F.ethenaOf(rd('ethena-yield.real.json')).apr30 - 4.77) < 0.01);
  const z = F.zpoolOf(rd('zpool-status.real.json')); close(z.sha256PerH * 1e18, 0.343, 1e-9, 'BTC por EH/s por dia');
  const r = F.brlOf(rd('mercadobitcoin-tickers.real.json'), rd('bcb-ptax.real.json')); assert.equal(r.ptax, 5.4212); assert.ok(r.usdtPremPct > 2 && r.usdcPremPct > 0.5 && r.usdcPremPct < 1);
  assert.equal(F.cdiOf([{ data: '29/10/2026', valor: '13.65' }]), 13.65);
  // Lighter: linhas no formato do funding simulado; empate menor com a perna de taxa zero
  const by = F.lighterTable(rd('lighter-funding.real.json')); assert.deepEqual(Object.keys(by.BTC).sort(), ['binance', 'bybit', 'hyperliquid', 'lighter']);
  close(F.ltBe('lighter', 'hyperliquid'), 0.06 / 3 * 365, 1e-9); assert.ok(F.ltBe('lighter', 'hyperliquid') < F.ltBe('binance', 'hyperliquid'));
  assert.equal(F.lighterRows({ NVDA: { lighter: 0.001, bybit: 0 } }, NOWF).NVDA, undefined, 'ações ficam fora');
  assert.equal(F.lighterRows({ X: { lighter: 0.001, bybit: 0 } }, NOWF, { X: 1000 }).X, undefined, 'mercado raso fica fora');
  let rows = F.lighterRows(by, NOWF), pairs = F.lighterPairs(rows, {});
  assert.ok(pairs.every((p) => p.s === 'lighter' || p.l === 'lighter')); assert.equal(pairs[0].coin, 'PONS');
  // 24 leituras horárias seguidas acima do empate → par estável; uma abaixo zera
  let st = null; for (let h = 0; h < 24; h++) st = F.streakStep(st, pairs, 1000 + h);
  assert.equal(st.s[pairs[0].key], 24);
  st = F.streakStep(st, pairs.map((p) => Object.assign({}, p, { spread: p.key === pairs[0].key ? 0 : p.spread })), 1024); assert.equal(st.s[pairs[0].key], undefined);
  // ASIC próprio: hashprice e lucro por energia; GPU: moedas que mais pagam, com liquidez
  const a = F.asicOf({ dBtc: 148364561003867.4, feesBtc: 2.96190910 / 144, btcUsd: 77392.6 });
  assert.ok(Math.abs(a.hashpriceUsdPh - 33.0) < 0.1, String(a.hashpriceUsdPh)); assert.ok(a.breakEvenKwh > 0.09 && a.breakEvenKwh < 0.11);
  assert.ok(a.rows.find((r) => r.kwh === 0.065).profitUsdDay > 2 && a.rows.find((r) => r.kwh === 0.15).profitUsdDay < 0);
  const g = F.gpuOf(rd('wtm-gpu.real.json'), 77392.6);
  assert.equal(g.top[0].tag, 'PRL'); assert.ok(g.top[0].usdDay > 3 && g.rvnUsdDay < 1); assert.ok(!g.top.some((c) => c.tag === 'XTM'), 'pouca liquidez fica fora');
  // papel das frentes passivas: US$1.000 a 10% a.a. por 1 h; CDI ao lado
  let pp = F.frontsPaperStep(null, { rates: { bfx: 10 }, cdi: 13.65, now: NOWF });
  pp = F.frontsPaperStep(pp, { rates: { bfx: 10 }, cdi: 13.65, now: NOWF + 3600e3 });
  close(pp.f.bfx.usd, 1000 * 0.10 / 8760, 1e-9); close(pp.f.bfx.cdiPct, (Math.pow(1.1365, 1 / 8760) - 1) * 100, 1e-9);
});

test('lastro de mercado: ágio por país, BTC entre corretoras, Polymarket e rendimentos de referência', async () => {
  const F = await import('../worker/src/fronts.js');
  const rd = (f) => JSON.parse(readFileSync(new URL('./fixtures/' + f, import.meta.url)));
  const P = F.premiumsOf({ upbit: rd('upbit-ticker.real.json'), mb: rd('mercadobitcoin-btc.real.json'), kraken: rd('kraken-ticker.real.json'), fx: rd('frankfurter-usd.real.json'), ars: rd('criptoya-dolar.real.json') });
  assert.equal(P.usdBtc, 77393.9);
  assert.ok(P.kr.btcPct > 0.5 && P.kr.btcPct < 2 && P.kr.usdtPct > 0.5, JSON.stringify(P.kr));
  assert.ok(Math.abs(P.br.btcPct) < 1 && P.br.usdtPct > 1, JSON.stringify(P.br));
  assert.ok(P.ar.usdtPct > 4 && P.ar.usdtPct < 7, JSON.stringify(P.ar));
  const S = F.spotSpreadOf([{ ex: 'A', quote: 'USD', px: 100 }, { ex: 'B', quote: 'USD', px: 100.3 }, { ex: 'C', quote: 'USDT', px: 99 }]);
  close(S.usd.pct, 0.3, 1e-9); assert.equal(S.usd.high, 'B'); assert.equal(S.usdt, null, 'uma cotação só não forma diferença');
  const pm = F.polymarketOf(rd('polymarket-gamma.real.json'));
  assert.ok(pm.markets > 0 && pm.dailyUsd > 0 && pm.top[0].aprMax >= pm.top[pm.top.length - 1].aprMax);
  const y = F.llamaOf(rd('defillama-steth.real.json')); assert.equal(y.project, 'lido'); assert.ok(y.apy > 2 && y.apy < 5);
});

test('panorama do mercado (IA): macro fora de cripto, regime, ranking e mudanças em 7 dias', async () => {
  const { macroOf, marketPanorama } = await import('../worker/src/panorama.js');
  const rd = (f) => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');
  const mac = macroOf({ selic: [{ data: '04/11/2026', valor: '13.75' }], ipca12: [{ data: '01/09/2026', valor: '4.58' }], focus: JSON.parse(rd('bcb-focus-ipca.real.json')), tbillCsv: rd('ust-tbill.real.csv') });
  assert.deepEqual([mac.selic, mac.ipca12, mac.tbill], [13.75, 4.58, 4.08]); assert.ok(mac.ipcaExp > 3 && mac.ipcaExp < 6);
  const fronts = { cdi: 13.65, basis: { basisApr: 5.6, netApr: 4.8, contract: 'BTC-29JAN27' }, bfx: { frrApr: 9, netApr: 4.3 }, ethena: { apr30: 4.8 }, hlp: { apr: 4.4 },
    asic: { hashpriceUsdPh: 33, breakEvenKwh: 0.1 }, lt: { top: [{ coin: 'X', spread: 60, be: 8.5, hours: 30 }] },
    hist: { '2026-10-24': { bfx: 9, usdt: 0.5 }, '2026-10-31': { bfx: 4.3, usdt: 1.3 } } };
  const P = marketPanorama({ fronts, market2: { macro: mac, yields: { stEth: { apy: 3.2 } }, prem: { br: { usdtPct: 1.3 } } }, mkt: { ok: true, edgeAtBidPct: 2 }, darr: 1.02, sentiment: { avg: 6 }, now: 1 });
  assert.equal(P.regime.leverage, 'frio');
  assert.equal(P.rank[0].name.startsWith('Funding com Lighter'), true, 'maior retorno medido em primeiro');
  assert.ok(P.rank.some((r) => r.name === 'CDI (reais)') && P.rank.every((r, i, a) => !i || a[i - 1].apr >= r.apr));
  assert.ok(P.changes.some((c) => /Bitfinex ↓/.test(c)) && P.lines.some((l) => /juro real/.test(l)));
});

test('livro da NiceHash: só conta como recebendo a ordem com máquinas (velocidade média engana)', () => {
  const d = JSON.parse(readFileSync(new URL('./fixtures/nicehash-book-stale.real.json', import.meta.url)));
  const b = parseBook(d);
  assert.ok(b.fillEH >= 0.425 && b.fillEH < 0.4256, 'preço real para receber ~0,4254, não 0,40: ' + b.fillEH);
  assert.ok(b.staleOrders > 10, 'ordens com velocidade mas sem máquinas');
  assert.ok(b.depth.length > 3 && b.depth.every((x, i, a) => !i || (x[0] > a[i - 1][0] && x[1] >= a[i - 1][1])), 'profundidade crescente');
  const R = createRequire(import.meta.url)('../radar.js'); assert.ok(R.bookPerHash(d).fill * 1e18 >= 0.425);
});

test('potência ideal (IA): lucro esperado por potência pela profundidade do livro, sorte e capital de Kelly', async () => {
  const { powerPlan } = await import('../worker/src/brain.js');
  const book = parseBook(JSON.parse(readFileSync(new URL('./fixtures/nicehash-book-stale.real.json', import.meta.url))));
  const cfg = Object.assign({}, DEFAULT_CONFIG, { bidPremiumPct: 0.1 }), lim = { maxLimitPh: 100 };
  const base = { ok: true, btcUsd: 77371, phDaysPerBlock: 26.18, fillEH: book.fillEH, depth: book.depth, breakEvenEH: 0.42 };
  // bloco de US$885 (empate ~0,4242) abaixo do preço real (0,4254): nenhuma potência dá lucro esperado → ideal 0
  const neg = powerPlan(Object.assign({ blockNetUsd: 885 }, base), cfg, lim);
  assert.equal(neg.idealPh, 0); assert.ok(neg.edgePct < 0); assert.ok(neg.curve.every((r) => r.profitDay < 0));
  // bloco de US$915 (~3% acima do custo): lucro cresce com a potência (livro fundo) → ideal no teto; Kelly = V ÷ (2 × margem)
  const pos = powerPlan(Object.assign({ blockNetUsd: 915 }, base), cfg, lim);
  assert.equal(pos.idealPh, 100); assert.ok(pos.idealProfitDay > 0 && pos.edgePct > 2.5);
  close(pos.bankrollMinUsd, 915 / (2 * pos.edgePct / 100), 1e-6);
  const r100 = pos.curve.find((r) => r.ph === 100); close(r100.blocksDay, 100 / 26.18, 1e-9); close(r100.luckDay, Math.sqrt(100 / 26.18) * 915, 1e-6);
  assert.ok(pos.curve.some((r) => r.overCap), 'mostra acima do teto marcado');
});

test('placar da sorte: blocos que seriam seus por potência, custo e testes de padrão (acaso)', async () => {
  const { luckBoard, needPH } = await import('../worker/src/blocks.js');
  const reg = JSON.parse(readFileSync(new URL('./fixtures/bch-blocks-registry.real.json', import.meta.url)));
  const now = reg[reg.length - 1].t + 60e3;
  const L = luckBoard(reg, { now, priceEH: 0.4259, btcUsd: 77400, blockUsd: 885 });
  const w24 = L.windows.find((w) => w.hours === 24);
  assert.ok(w24.blocks > 120 && w24.blocks < 170);
  const r100 = w24.rows.find((r) => r.ph === 100), sel = reg.filter((r) => r.t >= now - 24 * 3600e3);
  assert.equal(r100.won, sel.filter((r) => needPH(r) <= 100).length);
  assert.ok(r100.expected > 3 && r100.expected < 4.5 && r100.costUsd > 3000 && r100.costUsd < 3800, JSON.stringify(r100));
  close(r100.profitUsd, r100.revUsd - r100.costUsd, 1e-6);
  assert.ok(w24.rows.every((r, i, a) => !i || r.won >= a[i - 1].won), 'mais potência nunca acha menos blocos');
  assert.equal(L.tests.pattern, false, 'blocos reais: sorteio sem padrão');
  assert.ok(Math.abs(L.tests.autocorr) < 3 / Math.sqrt(L.tests.n) && L.tests.chi2 < 21.67);
  assert.equal(L.recent.length, 12);
});

test('cartilha de entrada: 9 fatores em sequência e veredito', async () => {
  const { entryChecklist } = await import('../worker/src/entry.js');
  const cfg = Object.assign({}, DEFAULT_CONFIG, { minEdgePct: 3, sessionBudgetUsd: 300 });
  const mk = (edge) => ({ ok: true, edgeAtBidPct: edge, bidEH: 0.4259, breakEvenEH: 0.4259 * (1 + edge / 100), costPerBlockUsd: 860, blockNetUsd: 885 });
  const good = { mkt: mk(4), darr: 1.09, mom: { vsEmaPct: 3, ret24Pct: 1 }, ret: { changePct: 5, remainingBlocks: 200, darrAfter: 1.14 }, win: { last6h: 28, bigShare6h: 0.2 },
    nhWeek: null, hashMkts: { braiins: { matchEH: 0.43, feePct: 0 } }, power: { idealPh: 100, idealProfitDay: 120, bankrollMinUsd: 11000 }, cfg, now: Date.UTC(2026, 9, 31, 15) };
  const A = entryChecklist(good);
  assert.equal(A.steps.length, 9); assert.equal(A.verdict, 'entrar'); assert.ok(A.steps.every((x, i) => x.n === i + 1));
  assert.match(A.steps.find((x) => x.id === 'tentativa').value, /29% de chance/); // 1 − e^(−300 ÷ 860)
  assert.equal(entryChecklist(Object.assign({}, good, { mom: { vsEmaPct: -3 } })).verdict, 'cautela', 'margem boa mas preço caindo antes da dificuldade');
  const neg = entryChecklist(Object.assign({}, good, { mkt: mk(-0.4), darr: 1.05, power: { idealPh: 0 }, hashMkts: { braiins: { matchEH: 0.4348, feePct: 0 } } }));
  assert.equal(neg.verdict, 'nao'); assert.equal(neg.steps.find((x) => x.id === 'margem_nh').status, 'bad'); assert.match(neg.lottery, /0,4%/);
  const viaBraiins = entryChecklist(Object.assign({}, good, { mkt: mk(-0.4), hashMkts: { braiins: { matchEH: 0.41, feePct: 0 } } }));
  assert.equal(viaBraiins.verdict, 'esperar'); assert.match(viaBraiins.text, /Braiins/);
  assert.match(A.lottery, /Margem positiva/);
  // menor preço com margem boa, mas sem hash para 1 PH/s: vale a margem do tamanho que dá para comprar (profundidade)
  const thin = entryChecklist(Object.assign({}, good, { mkt: Object.assign(mk(3.9), { bidEH: 0.402, breakEvenEH: 0.4177 }), hashMkts: { braiins: { matchEH: 0.4348, feePct: 0 } }, power: { idealPh: 0, curve: [{ ph: 1, bidEH: 0.4221, edgePct: -1.04, overCap: false }] } }));
  assert.equal(thin.verdict, 'nao'); assert.match(thin.steps[0].value, /não há hash para 1 PH\/s/);
  // reajuste longe e horário na média não contam como "atenção"
  assert.equal(entryChecklist(Object.assign({}, good, { ret: { changePct: 4, remainingBlocks: 800 } })).steps.find((x) => x.id === 'reajuste').status, 'info');
});

test('auditoria IA: mesma régua do robô, reajuste real, funding acompanhado e grupo de controle', () => {
  const T0 = Date.UTC(2026, 9, 31, 12), H = 36e5;
  const base = { now: T0, edge: 1.5, green: false, minEdge: 3, darr: 1.05, D: 5e11, mom: { vsEmaPct: 3 }, ret: null, win: null, fund: [], rows: {}, stable24: {}, algos: [] };
  // margem passa de 3% mas o robô não compraria (lance acima do teto): "janela abriu" é ERRO, como o robô veria
  let r = brainStep(null, base);
  r = brainStep(r.ai, Object.assign({}, base, { now: T0 + H, edge: 3.05, green: false }));
  r = brainStep(r.ai, Object.assign({}, base, { now: T0 + 6 * H + 1 }));
  assert.equal(r.ai.done.find((d) => d.type === 'mine_wait').hit, false);
  // controle: a mesma pergunta sem sinal, a cada 6 h
  assert.ok(r.ai.ctrl.stats.mine_wait.n >= 1 && r.ai.ctrl.stats.mine_close.n >= 1);
  // reajuste do BTC: não confere antes de acontecer, mesmo com o prazo vencido
  const ret = { at: T0 + 10 * H, remainingBlocks: 60, darrAfter: 1.10, changePct: 5 };
  let q = brainStep(null, Object.assign({}, base, { ret }));
  const p0 = q.ai.open.find((o) => o.type === 'btc_retarget'); assert.equal(p0.naive, 1.05); assert.equal(p0.rem0, 60);
  q = brainStep(q.ai, Object.assign({}, base, { now: T0 + 13 * H, ret: Object.assign({}, ret, { remainingBlocks: 5 }) }));
  assert.ok(q.ai.open.some((o) => o.type === 'btc_retarget'), 'atrasou: espera');
  q = brainStep(q.ai, Object.assign({}, base, { now: T0 + 15 * H, darr: 1.09, ret: Object.assign({}, ret, { remainingBlocks: 2010 }) }));
  const dr = q.ai.done.find((d) => d.type === 'btc_retarget');
  assert.equal(dr.hit, true); assert.equal(q.ai.stats.btc_retarget.beat, 1, 'previsão chegou mais perto que "fica igual"');
  // funding: a IA acompanha a própria posição (pagamentos − taxas), sem depender de alerta
  const rows = (rs, next) => ({ X: { Bybit: { rate: rs, apr: rs * 3 * 365, hours: 8, next }, Binance: { rate: 0, apr: 0, hours: 8, next } } });
  const fb = Object.assign({}, base, { fund: [{ key: 'X|Bybit|Binance', coin: 'X', netUsd: 1 }], rows: rows(0.05, T0 + H), fees: { Bybit: { maker: 0.02 }, Binance: { maker: 0.02 } } });
  let g = brainStep(null, fb);
  assert.ok(g.ai.open.find((o) => o.type === 'fund_go').pos);
  for (let i = 1; i <= 9; i++) g = brainStep(g.ai, Object.assign({}, fb, { fund: [], now: T0 + i * 8 * H + 60e3, rows: rows(0.05, T0 + (i * 8 + 1) * H) }));
  const fd = g.ai.done.find((d) => d.type === 'fund_go');
  assert.ok(fd && fd.hit === true && fd.value > 0, JSON.stringify(fd)); // 9 pagamentos de 0,05% de US$1.000 = US$4,50 − US$1,10 de custos
  // nível: vantagem sobre o acaso ≤ 0 segura em Analista, mesmo com acerto alto nas difíceis
  const ai = { stats: { mine_buy: { n: 90, hits: 88 }, mine_wait: { n: 30, hits: 18 } }, ctrl: { stats: { mine_wait: { n: 30, hits: 20 } } } };
  const L = levelOf(ai); assert.equal(L.level.name, 'Analista'); assert.ok(L.lift.pts < 0);
  ai.ctrl.stats.mine_wait.hits = 6; assert.equal(levelOf(ai).level.name, 'Estrategista'); assert.ok(levelOf(ai).lift.pts > 30);
});

test('IA: nível sobe com previsões conferidas e acerto', () => {
  assert.equal(levelOf({ stats: { mine_buy: { n: 120, hits: 118 } } }).level.name, 'Aprendiz', 'só previsões fáceis (tempo) não sobe de nível');
  assert.equal(levelOf({ stats: { mine_buy: { n: 30, hits: 29 }, mine_wait: { n: 5, hits: 1 } } }).level.name, 'Analista');
  assert.equal(levelOf({ stats: { mine_buy: { n: 90, hits: 88 }, mine_wait: { n: 30, hits: 12 } } }).level.name, 'Analista', 'difíceis abaixo de 50% não vira Estrategista');
  const L = levelOf({ stats: { mine_buy: { n: 90, hits: 88 }, mine_wait: { n: 30, hits: 16 } } });
  assert.equal(L.level.name, 'Estrategista'); assert.deepEqual([L.hard.n, L.hard.hits], [30, 16]);
  // XP antigo (até 15 por acerto de qualquer tipo, 1 por erro) é refeito com o peso por dificuldade
  const { ai } = brainStep({ since: 1, xp: 999, open: [], done: [{ type: 'mine_buy', hit: true, xp: 13 }, { type: 'mine_wait', hit: false, xp: 1 }], stats: { mine_buy: { n: 10, hits: 10 }, mine_wait: { n: 4, hits: 2 } }, last: {} }, { now: 2 });
  assert.equal(ai.xp, 10 * 2 + 2 * 10); assert.deepEqual(ai.done.map((d) => d.xp), [2, 0]); assert.equal(ai.v, 2);
});

test('integração: copiloto IA e mempool aparecem no status', async () => {
  const t = await setup();
  try {
    await t.call('POST', '/api/tick');
    const st = (await t.call('GET', '/api/status')).body.state;
    assert.ok(st.ai && st.ai.level.name === 'Aprendiz'); assert.ok(st.aiAnalysis.lines.length >= 2);
    assert.deepEqual([st.mempool.tx, st.mempool.bytes], [57, 30891]); assert.ok(st.aiTypes.mine_wait);
  } finally { t.server.close(); }
});

test('plano de ação: potência, preço, orçamento, duração e travas', () => {
  const cfg = Object.assign({}, DEFAULT_CONFIG, { sessionBudgetUsd: 300, mode: 'observe', poolId: '', autoCreate: false, payoutAddress: ADDR });
  const mkt = { ok: true, green: true, bidEH: 0.42, capEH: 0.43, edgeAtBidPct: 5, btcUsd: 77000, phDaysPerBlock: 26.2, blockNetUsd: 900, bookTotalPH: 19000 };
  const p = actionPlan({ cfg, limits: { maxLimitPh: 100, maxOrderBtc: 0.01 }, mkt, acct: { balanceBtc: 0.00002, pools: [{ id: 'p1', name: 'Blocksniper Solo', algorithm: 'SHA256ASICBOOST' }] }, fund: [], algoMap: [{ algo: 'SCRYPT', label: 'Scrypt', coins: ['LTC'], edgePct: 12, level: 'go', capBtcPerUnit: 0.0001, unit: 'TH' }], capital: 1000, pools: { SCRYPT: [['LiteSolo', 'x']] } });
  assert.equal(p.mining.action, 'alugar'); assert.equal(p.mining.ph, 100, 'limitado ao teto do servidor');
  assert.ok(p.mining.durationH > 1 && p.mining.chance > 0.2 && p.mining.chance < 0.5);
  assert.deepEqual(p.blockers.map((b) => b.id), ['pool', 'balance', 'auto', 'mode']);
  assert.equal(p.blockers[0].poolId, 'p1');
  assert.equal(p.mining.apply.autoCreate, true);
  assert.equal(p.funding.action, 'esperar'); assert.match(p.others[0].text, /LiteSolo/);
});

test('integração: ajuste do operador recalcula o plano na hora e fica registrado', async () => {
  const t = await setup();
  try {
    await t.call('PUT', '/api/config', { mode: 'observe', targetPh: 10, sessionBudgetUsd: 300 });
    await t.call('POST', '/api/tick');
    let st = (await t.call('GET', '/api/status')).body.state;
    assert.equal(st.plan.mining.budgetUsd, 300); assert.equal(st.plan.mining.mine.ph, 10);
    await t.call('PUT', '/api/config', { targetPh: 30, sessionBudgetUsd: 100 });
    st = (await t.call('GET', '/api/status')).body.state;
    assert.equal(st.plan.mining.budgetUsd, 100, 'plano usa o novo stop-loss sem esperar o ciclo');
    assert.equal(st.plan.mining.mine.ph, 30, 'sua potência aparece no plano');
    assert.equal(st.opLog[0].changes.length, 2);
    const log = await t.call('GET', '/api/log');
    assert.ok(log.body.log.some((l) => l.kind === 'operador' && /potência alvo 10 → 30/.test(l.text)));
    await t.call('POST', '/api/tick');
    st = (await t.call('GET', '/api/status')).body.state;
    assert.ok(st.paperPlan, 'cenário do copiloto roda na simulação');
  } finally { t.server.close(); }
});

test('integração: par conferido pelo painel destrava a entrada do robô de funding', async () => {
  const t = await setup();
  try {
    await t.call('PUT', '/api/config', { fundStable24: true });
    await t.call('POST', '/api/tick'); let r = await t.call('POST', '/api/tick');
    assert.equal(r.body.alerts.filter((a) => a.kind === 'entrada' && a.area === 'funding').length, 0, 'sem histórico: não entra');
    const v = await t.call('POST', '/api/funding/verified', { pairs: [{ key: 'ENA|Bybit|Hyperliquid', stable24: true, expNet: 2.5, halfLifeH: 30 }, { key: 'x"bad', stable24: true }] });
    assert.equal(v.body.pairs, 1);
    await t.call('POST', '/api/tick'); r = await t.call('POST', '/api/tick');
    const st = (await t.call('GET', '/api/status')).body.state;
    assert.equal(st.fundPaper.summary.open, 1, 'robô simulado entrou no par conferido');
    // conferido mas a meia-vida não paga as taxas: não vale
    await t.call('POST', '/api/funding/verified', { pairs: [{ key: 'ENA|Bybit|Hyperliquid', stable24: true, expNet: -1 }] });
  } finally { t.server.close(); }
});
