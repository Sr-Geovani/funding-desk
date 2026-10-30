// Testes do radar: mapas, padrões e alertas. Rodar: node --test tests/*.test.js tests/*.test.mjs
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const R = require('../radar.js');
const fx = (f) => require(path.join(__dirname, 'fixtures', f));
const close = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} esperado ${b}, veio ${a}`);
const H = 36e5, NOW = Date.UTC(2026, 9, 30, 18);
const V = ['Binance', 'Bybit', 'OKX'];

test('mapa de funding: majors, extras pela maior diferença e filtro de volume', () => {
  const rows = {
    BTC: { Binance: { apr: 10, vol: 1e9 }, Bybit: { apr: 12, vol: 1e9 }, OKX: { apr: 9, vol: 1e9 } },
    ETH: { Binance: { apr: -5, vol: 1e9 }, OKX: { apr: 20, vol: 1e9 } },
    ABC: { Binance: { apr: 100, vol: 5e7 }, Bybit: { apr: -50, vol: 5e7 } },
    TINY: { Binance: { apr: 900, vol: 1e3 }, Bybit: { apr: -900, vol: 1e3 } }
  };
  const m = R.fundingMatrix(rows, V, { extra: 3, minVol: 1e6 });
  assert.deepEqual(m.map((x) => x.coin), ['BTC', 'ETH', 'ABC']);
  const eth = m.find((x) => x.coin === 'ETH');
  assert.equal(eth.cells[1], null);
  assert.deepEqual([eth.hi.venue, eth.lo.venue, eth.spread], ['OKX', 'Binance', 25]);
  assert.ok(m[2].major === false && m[0].major === true);
});

test('sentimento dos majors pelo funding médio', () => {
  const mk = (a) => ({ BTC: { Binance: { apr: a } }, ETH: { Binance: { apr: a } }, SOL: { Binance: { apr: a } } });
  assert.equal(R.sentiment(mk(45), ['Binance']).key, 'euforia');
  assert.equal(R.sentiment(mk(20), ['Binance']).key, 'comprado');
  assert.equal(R.sentiment(mk(11), ['Binance']).key, 'neutro');
  assert.equal(R.sentiment(mk(-8), ['Binance']).key, 'vendido');
  assert.equal(R.sentiment({}, ['Binance']), null);
});

test('receita por hash (WhatToMine): fórmula e BTC em US$', () => {
  const w = fx('wtm-asic.real.json');
  const coins = R.wtmCoins(w);
  const bch = coins.find((c) => c.tag === 'BCH');
  close(R.coinRevenueBtc(bch), 86400 / bch.block_time * bch.block_reward * bch.exchange_rate / bch.nethash);
  const btc = coins.find((c) => c.tag === 'BTC');
  close(R.coinRevenueBtc(btc), 86400 / btc.block_time * btc.block_reward / btc.nethash, 1e-30, 'BTC usa taxa 1');
  assert.ok(R.btcUsdFrom(w) > 10000);
  assert.ok(!coins.some((c) => c.tag === 'NICEHASH'));
  // ordem de grandeza: SHA-256 rende ~0,4 BTC por EH/s por dia
  const perEH = R.coinRevenueBtc(bch) * 1e18;
  assert.ok(perEH > 0.2 && perEH < 0.8, String(perEH));
});

test('livro de qualquer algoritmo em BTC por H/s por dia (Scrypt real, em TH)', () => {
  const b = R.bookPerHash(fx('nicehash-book-scrypt.real.json'));
  assert.equal(b.unit, 'TH');
  assert.ok(b.fill > 0 && b.median >= b.fill);
  close(b.fill * b.factor, Math.min(...fx('nicehash-book-scrypt.real.json').stats.BTC.orders.filter((o) => +o.acceptedSpeed > 0 && o.alive !== false).map((o) => +o.price)), 1e-12);
});

test('mapa de mineração: Scrypt soma LTC + DOGE (merged) e calcula a margem', () => {
  const w = fx('wtm-asic.real.json');
  const books = { SHA256: fx('nicehash-book.real.json'), SCRYPT: fx('nicehash-book-scrypt.real.json') };
  const m = R.miningMap(w, books, { poolFeePct: 2, rentFeePct: 3, minEdgePct: 3 });
  const sc = m.find((x) => x.algo === 'SCRYPT');
  assert.ok(sc.merged);
  assert.deepEqual(sc.coins.slice().sort(), ['DOGE', 'LTC']);
  const coins = R.wtmCoins(w), ltc = coins.find((c) => c.tag === 'LTC'), doge = coins.find((c) => c.tag === 'DOGE');
  close(sc.revBtcPerH, (R.coinRevenueBtc(ltc) + R.coinRevenueBtc(doge)) * 0.98, 1e-25);
  const b = R.bookPerHash(books.SCRYPT);
  close(sc.rentBtcPerH, b.median * 1.03, 1e-25);
  close(sc.edgePct, (sc.revBtcPerH / sc.rentBtcPerH - 1) * 100, 1e-9);
  assert.ok(['go', 'maybe', 'no'].includes(sc.level));
  assert.equal(sc.unit, 'TH');
  assert.ok(sc.small.includes('QUAI'), 'QUAI rende mais por hash, mas tem pouca liquidez: fica fora da opção principal');
  const sha = m.find((x) => x.algo === 'SHA256');
  assert.equal(sha.merged, false);
  assert.ok(['BCH', 'BTC', 'XEC'].includes(sha.coins[0]) === false || sha.coins[0] !== 'QUAI');
  assert.ok(!sha.coins.includes('QUAI'));
  // algoritmo sem livro: sem veredito
  assert.equal(m.find((x) => x.algo === 'X11').level, 'none');
  // ordenado pela margem, os sem livro por último
  assert.ok(m.findIndex((x) => x.edgePct === null) > m.findIndex((x) => x.algo === 'SCRYPT'));
});

test('BSV entra como moeda extra no SHA-256', () => {
  const w = { coins: { a: { tag: 'BCH', algorithm: 'SHA-256', block_time: 600, block_reward: 3.125, nethash: 4e18, exchange_rate: 0.0037 } } };
  const bsv = { tag: 'BSV', algorithm: 'SHA-256', block_time: 600, block_reward: 3.125, nethash: 0.2e18, exchange_rate: 0.00022 };
  const m = R.miningMap(w, {}, { extra: [bsv], btcUsd: 77000 });
  assert.deepEqual(m[0].coins, ['BSV']);
});

test('histórico: agrupa leituras próximas e descarta as antigas', () => {
  let h = [];
  h = R.pushHistory(h, { t: NOW, edges: { BCH: -5 } });
  h = R.pushHistory(h, { t: NOW + 5 * 60e3, edges: { BCH: -4 } });
  assert.equal(h.length, 1); assert.equal(h[0].edges.BCH, -4);
  h = R.pushHistory(h, { t: NOW + 15 * 60e3, edges: { BCH: -3 } });
  assert.equal(h.length, 2);
  h = R.pushHistory(h, { t: NOW + 8 * 864e5, edges: { BCH: 1 } });
  assert.equal(h.length, 1, 'mais de 7 dias sai');
});

test('padrão por hora do dia e variação de preço', () => {
  const hist = [];
  for (let d = 0; d < 3; d++) for (let hh = 0; hh < 24; hh++) hist.push({ t: Date.UTC(2026, 9, 27 + d, hh), edges: { BCH: hh < 6 ? 2 : -6 }, prices: { BCH: 280 } });
  const p = R.hourProfile(hist, 'BCH', -180); // horário de Brasília
  assert.equal(p.length, 24);
  assert.equal(p[21].avg, 2, '00h–05h UTC = 21h–02h em Brasília');
  assert.equal(p[12].avg, -6);
  const ph = [{ t: NOW - 60 * 60e3, prices: { BCH: 280 } }, { t: NOW - 30 * 60e3, prices: { BCH: 285 } }, { t: NOW, prices: { BCH: 296.8 } }];
  close(R.priceMove(ph, 'BCH', NOW, 60), 6, 1e-9);
  assert.equal(R.priceMove([{ t: NOW, prices: { BCH: 1 } }], 'BCH', NOW, 60), null);
});

test('alertas: entrada persistente ou estável, saída, sentimento, mineração e preço', () => {
  const best = (lvl, stab) => [{ key: 'ENA|Hyperliquid|Binance', coin: 'ENA', title: 'short Hyperliquid, long Binance', level: lvl, stab, netTxt: 'US$9 em 3 dias' }];
  // entrada só com estabilidade ou persistência
  let r = R.evaluateAlerts({ snap: { best: best('go') }, prev: {}, now: NOW });
  assert.equal(r.alerts.length, 0, 'uma leitura só não basta');
  r = R.evaluateAlerts({ snap: { best: best('go') }, prev: { best: best('go') }, now: NOW });
  assert.equal(r.alerts[0].kind, 'entrada');
  r = R.evaluateAlerts({ snap: { best: best('go', 'estavel') }, prev: {}, now: NOW });
  assert.match(r.alerts[0].text, /estável/);
  // cooldown: não repete em menos de 6 h
  const again = R.evaluateAlerts({ snap: { best: best('go', 'estavel') }, prev: {}, now: NOW + H, mem: r.mem });
  assert.equal(again.alerts.length, 0);
  assert.equal(R.evaluateAlerts({ snap: { best: best('go', 'estavel') }, prev: {}, now: NOW + 7 * H, mem: r.mem }).alerts.length, 1);
  // saída de posição
  r = R.evaluateAlerts({ snap: {}, positions: [{ id: 'p1', coin: 'ENA', s: 'HL', l: 'Binance', level: 'bad', text: 'spread inverteu' }], now: NOW });
  assert.equal(r.alerts[0].kind, 'saida');
  // sentimento só na mudança para extremo
  r = R.evaluateAlerts({ snap: { sent: { key: 'euforia', label: 'Comprado demais', text: 'x' } }, prev: { sent: { key: 'comprado' } }, now: NOW });
  assert.equal(r.alerts[0].kind, 'risco');
  assert.equal(R.evaluateAlerts({ snap: { sent: { key: 'euforia', label: 'x', text: 'x' } }, prev: { sent: { key: 'euforia' } }, now: NOW }).alerts.length, 0);
  // primeira leitura (sem anterior) não gera alerta de mineração
  assert.equal(R.evaluateAlerts({ snap: { edges: { X11: 20 } }, prev: {}, now: NOW, minEdgePct: 3 }).alerts.length, 0);
  // mineração cruza a margem e depois cai abaixo de zero
  r = R.evaluateAlerts({ snap: { edges: { SCRYPT: 4 } }, prev: { edges: { SCRYPT: 1 } }, now: NOW, minEdgePct: 3 });
  assert.match(r.alerts[0].title, /SCRYPT passou a compensar \(\+4,0%\)/);
  r = R.evaluateAlerts({ snap: { edges: { BCH: -2 } }, prev: { edges: { BCH: 0.5 } }, now: NOW, minEdgePct: 3 });
  assert.equal(r.alerts[0].kind, 'saida');
  // alta de preço
  const hist = [{ t: NOW - 60 * 60e3, prices: { BCH: 280 } }, { t: NOW, prices: { BCH: 300 } }];
  r = R.evaluateAlerts({ snap: {}, hist, now: NOW });
  assert.equal(r.alerts[0].kind, 'oportunidade');
});

test('mapa de players: categorias, links https e quem já está no painel', () => {
  assert.ok(R.PLAYERS.length >= 20);
  R.PLAYERS.forEach((p) => { assert.match(p.url, /^https:\/\//); assert.ok(R.PLAYER_CATS[p.cat], p.name); assert.ok(p.what.length > 10); });
  const inPanel = R.PLAYERS.filter((p) => p.cat === 'funding' && p.panel).map((p) => p.name);
  assert.deepEqual(inPanel, ['Binance', 'Bybit', 'OKX', 'Bitget', 'Gate', 'Hyperliquid']);
});

test('livro raso rebaixa "compensa" para "no limite"', () => {
  const w = { coins: { a: { tag: 'BCH', algorithm: 'SHA-256', block_time: 600, block_reward: 3.125, nethash: 4e18, exchange_rate: 0.0045, exchange_rate_vol: 300 } } };
  const book = (n) => ({ stats: { BTC: { priceFactor: '1e18', displayPriceFactor: 'EH', orders: Array.from({ length: n }, (_, i) => ({ price: '0.30', acceptedSpeed: '0.001', alive: true })) } } });
  assert.equal(R.miningMap(w, { SHA256: book(10) }, { btcUsd: 77000 })[0].level, 'go');
  const thin = R.miningMap(w, { SHA256: book(2) }, { btcUsd: 77000 })[0];
  assert.equal(thin.level, 'maybe'); assert.equal(thin.thin, true);
});

test('alertas "agora": condições ativas por prioridade, agrupadas, com silêncio e dispensa', () => {
  const snap = {
    best: [{ key: 'ENA|A|B', coin: 'ENA', title: 'short A, long B', level: 'go', netTxt: 'US$9', stab: 'estavel' }, { key: 'WLD|A|B', coin: 'WLD', title: 'x', level: 'go', netTxt: 'US$5' }],
    sent: { key: 'euforia', label: 'Comprado demais', text: 't' },
    edges: { BSV: 12, BCH: -1, X11: 18 }, thin: { X11: true }
  };
  const positions = [{ id: 'p1', coin: 'ENA', s: 'A', l: 'B', level: 'bad', text: 'sair: funding negativo' }, { id: 'p2', coin: 'SOL', s: 'A', l: 'B', level: 'warn', text: 'abaixo' }];
  const a = R.activeConditions({ snap, positions, minEdgePct: 3 });
  assert.deepEqual(a.map((x) => x.kind), ['saida', 'risco', 'atencao', 'entrada', 'entrada', 'entrada']);
  assert.ok(!a.some((x) => x.key === 'me:X11'), 'livro raso não vira entrada');
  assert.ok(!a.some((x) => x.key === 'me:BCH'));
  const g = R.groupConditions(a);
  const gf = g.find((x) => x.key === 'grupo:funding');
  assert.equal(gf.items.length, 2); assert.match(gf.title, /2 entradas de funding: ENA, WLD/);
  assert.equal(g.find((x) => x.key === 'me:BSV').kind, 'entrada', 'grupo de um item vira o próprio item');
  // silenciar e dispensar
  const prefs = { snooze: { 'fe:ENA|A|B': NOW + H }, dismissed: { 'sent:euforia': NOW } };
  assert.ok(R.isMuted('fe:ENA|A|B', prefs, NOW)); assert.ok(!R.isMuted('fe:ENA|A|B', prefs, NOW + 2 * H));
  assert.ok(R.isMuted('sent:euforia', prefs, NOW));
  const cleaned = R.cleanDismissed(prefs, ['fe:ENA|A|B']);
  assert.deepEqual(cleaned.dismissed, {}, 'dispensa some quando a condição deixa de valer');
  // histórico com retenção de 7 dias
  const hist = [{ t: NOW - 8 * 864e5 }, { t: NOW - 6 * 864e5 }, { t: NOW }];
  assert.equal(R.pruneHistory(hist, NOW).length, 2);
});

test('alertas de mineração abrem o algoritmo certo; vida útil das condições', () => {
  let r = R.evaluateAlerts({ snap: { edges: { RandomX: 4 } }, prev: { edges: { RandomX: 1 } }, now: NOW, minEdgePct: 3 });
  assert.deepEqual([r.alerts[0].go, r.alerts[0].focus], ['mine:algos', 'RandomX']);
  r = R.evaluateAlerts({ snap: { edges: { BSV: 4 } }, prev: { edges: { BSV: 1 } }, now: NOW, minEdgePct: 3 });
  assert.equal(r.alerts[0].go, 'mine');
  assert.equal(R.activeConditions({ snap: { edges: { Scrypt: 9 } }, minEdgePct: 3 })[0].go, 'mine:algos');
  // desde quando vale e quando acabou
  let since = R.trackSince({}, ['me:RandomX'], NOW);
  since = R.trackSince(since, ['me:RandomX', 'fe:X'], NOW + H);
  assert.deepEqual(since, { 'me:RandomX': NOW, 'fe:X': NOW + H });
  assert.deepEqual(R.trackSince(since, ['fe:X'], NOW + 2 * H), { 'fe:X': NOW + H });
  const ev = R.markEnded([{ key: 'me:RandomX', t: NOW }, { key: 'pm:BCH', t: NOW }], [], NOW + H);
  assert.equal(ev[0].endedAt, NOW + H); assert.equal(ev[1].endedAt, undefined);
  assert.equal(R.markEnded(ev, [], NOW + 2 * H)[0].endedAt, NOW + H, 'não sobrescreve o fim');
  // teto nas unidades da NiceHash
  const w = { coins: { a: { tag: 'XMR', algorithm: 'RandomX', block_time: 120, block_reward: 0.6, nethash: 6.5e9, exchange_rate: 0.0077, exchange_rate_vol: 50 } } };
  const book = { stats: { BTC: { priceFactor: '1e9', displayPriceFactor: 'GH', orders: Array.from({ length: 6 }, () => ({ price: '0.0001', acceptedSpeed: '0.01', alive: true })) } } };
  const m = R.miningMap(w, { RANDOMXMONERO: book }, { btcUsd: 77000, minEdgePct: 3 }).find((x) => x.algo === 'RANDOMXMONERO');
  close(m.capBtcPerUnit, m.revBtcPerH * 1e9 / 1.03 * 0.97, 1e-12);
  close(m.fillBtcPerUnit, 0.0001, 1e-12);
  assert.ok(R.POOLS.RANDOMXMONERO.length >= 2 && R.POOLS.SCRYPT[0][1].startsWith('https://'));
});
