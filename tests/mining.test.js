// Testes da matemática de mineração. Rodar: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const M = require('../mining.js');
const fx = (f) => require(path.join(__dirname, 'fixtures', f));
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= (eps ?? 1e-9), (msg || '') + ` esperado ${b}, veio ${a}`);

const D = 527.94e9;          // dificuldade BCH em 2026-10-30
const BCH = 283.49, BTC = 77366;

test('PH·dia por bloco e blocos esperados', () => {
  close(M.phDaysPerBlock(D), D * 2 ** 32 / 1e15 / 86400);
  close(M.phDaysPerBlock(D), 26.244, 0.01);
  // 26,244 PH/s por 1 dia = 1 bloco esperado
  close(M.expectedBlocks(M.phDaysPerBlock(D), 24, D), 1);
  // Silver L do vídeo: 121 PH/s por 4h → λ ≈ 0,768, P(≥1) ≈ 53,6% ("1 em 1,9")
  const lam = M.expectedBlocks(121, 4, D);
  close(lam, 0.7684, 0.001);
  close(1 / M.probAtLeast(1, lam), 1.866, 0.01);
});

test('Poisson: pmf, cdf e caudas', () => {
  close(M.poissonPmf(0, 1), Math.exp(-1));
  close(M.poissonPmf(2, 3), Math.exp(-3) * 9 / 2);
  close(M.poissonCdf(1, 2), Math.exp(-2) * 3);
  close(M.probAtLeast(1, 0.5), 1 - Math.exp(-0.5));
  close(M.probAtLeast(0, 0.5), 1);
  let s = 0; for (let k = 0; k < 60; k++) s += M.poissonPmf(k, 7); close(s, 1, 1e-12);
});

test('hashprice e aluguel', () => {
  const hp = M.hashpriceUsd(D, 3.125, BCH);
  close(hp, 3.125 * BCH / 26.244, 0.05);             // ≈ US$33,76/PH/dia
  close(M.rentalUsdPerPhDay(0.41, BTC, 3), 0.41 / 1000 * BTC * 1.03);
  close(M.rentalUsdPerPhDay(0.44, BTC, 0), 34.041, 0.01);
});

test('plan: Silver L do vídeo (0,01 BTC por 121 PH × 4h)', () => {
  // 121 PH × 4h = 20,17 PH·dia por 0,01 BTC → 0,4959 BTC/EH/dia
  const price = 0.01 / (121 * 4 / 24) * 1000;
  const p = M.plan({ ph: 121, hours: 4, D, rewardCoin: 3.125, coinUsd: BCH, priceBtcPerEhDay: price, btcUsd: BTC, rentFeePct: 0, poolFeePct: 2 });
  close(p.cost, 0.01 * BTC, 1e-6);
  close(p.ev, p.lambda * 3.125 * BCH * 0.98, 1e-9);
  assert.ok(p.evRatio > 0.85 && p.evRatio < 0.87, 'EV/custo ≈ 0,86: ' + p.evRatio);
  close(p.p0 + p.p1, 1, 1e-12);
  // preço de empate: aluguel = hashprice líquido
  const be = M.plan({ ph: 121, hours: 4, D, rewardCoin: 3.125, coinUsd: BCH, priceBtcPerEhDay: p.breakEvenPrice, btcUsd: BTC, rentFeePct: 0, poolFeePct: 2 });
  close(be.evRatio, 1, 1e-9);
});

test('regra de parada não muda o valor esperado por dólar', () => {
  // Parar mais cedo reduz custo e chance na mesma proporção: EV/custo constante (Wald).
  const base = { ph: 50, D, rewardCoin: 3.125, coinUsd: BCH, priceBtcPerEhDay: 0.44, btcUsd: BTC, rentFeePct: 3, poolFeePct: 2 };
  const r1 = M.plan(Object.assign({ hours: 1 }, base)).evRatio;
  const r24 = M.plan(Object.assign({ hours: 24 }, base)).evRatio;
  const burst = M.plan(Object.assign({}, base, { ph: 1000, hours: 0.25 })).evRatio;
  close(r1, r24, 1e-12);
  close(r1, burst, 1e-12);
});

test('budgetForProb', () => {
  const c = 34;
  close(M.budgetForProb(0.5, D, c), Math.LN2 * 26.244 * c, 1);
  assert.ok(M.budgetForProb(0.9, D, c) > M.budgetForProb(0.5, D, c) * 3);
});

test('NiceHash: livro de ordens real', () => {
  const m = M.parseNiceHashBook(fx('nicehash-book.real.json'));
  assert.ok(m.length >= 1);
  const b = m[0];
  assert.ok(b.orders > 0);
  if (b.activeOrders) {
    assert.ok(b.minActive <= b.medianWeighted && b.medianWeighted <= b.maxActive);
    assert.ok(b.minActive > 0.05 && b.minActive < 5, 'preço em BTC/EH/dia: ' + b.minActive);
  }
});

test('NiceHash: mediana ponderada por velocidade', () => {
  const d = { stats: { X: { totalSpeed: '3', orders: [
    { price: '0.40', acceptedSpeed: '0.5', type: 'STANDARD', alive: true },
    { price: '0.45', acceptedSpeed: '2', type: 'STANDARD', alive: true },
    { price: '0.60', acceptedSpeed: '0.5', type: 'FIXED', alive: true },
    { price: '0.30', acceptedSpeed: '0', type: 'STANDARD', alive: true },
    { price: '0.10', acceptedSpeed: '9', type: 'STANDARD', alive: false }] } } };
  const b = M.parseNiceHashBook(d)[0];
  assert.equal(b.activeOrders, 3);
  assert.equal(b.minActive, 0.40);
  assert.equal(b.medianWeighted, 0.45);
  assert.equal(b.maxActive, 0.60);
});

test('Blockchair: blocos reais, coinbase e estatística', () => {
  const blocks = M.parseBlocks(fx('bch-blocks.real.json'));
  assert.equal(blocks.length, 10);
  assert.ok(blocks[0].height > blocks[1].height);
  assert.ok(blocks.some((b) => /Mining-Dutch|ViaBTC|AntPool|\//.test(b.tag + (b.miner || ''))), 'alguma tag de pool');
  const st = M.blockStats(blocks, blocks[0].time + 5 * 60000);
  close(st.sinceLastMin, 5);
  assert.equal(st.intervals.length, 9);
  assert.ok(st.intervals.every((x) => x >= -120));
  assert.ok(Math.abs(st.diffVsAvgPct) < 10);
});

test('cotação implícita no bloco', () => {
  const b = M.parseBlocks({ data: [{ id: 1, time: '2026-10-30 13:00:00', difficulty: 1, reward: 312550000, reward_usd: 886.0, coinbase_data_hex: '' }] })[0];
  close(b.priceUsd, 886 / 3.1255, 1e-9);
  assert.equal(b.time, Date.UTC(2026, 9, 30, 13));
});

test('coinbaseTag extrai texto legível', () => {
  const hex = Buffer.from('\x03\x5c\xe1\x0e/Mining-Dutch/-PPS\x00\x01BlockSniper.ai smart solo').toString('hex');
  const t = M.coinbaseTag(hex);
  assert.ok(t.includes('/Mining-Dutch/-PPS'));
  assert.ok(t.includes('BlockSniper.ai smart solo'));
});

test('signal: só o aluguel vs receita decide', () => {
  assert.equal(M.signal({ edgePct: 3 }).level, 'favoravel');
  assert.equal(M.signal({ edgePct: -3 }).level, 'neutro');
  assert.equal(M.signal({ edgePct: -12, diffVsAvgPct: -2 }).level, 'desfavoravel');
  assert.equal(M.signal({ edgePct: NaN }).level, 'sem-dado');
});

test('diário: sorte real vs esperado e etiquetas', () => {
  const s = [
    { t: 1, ph: 26.244, hours: 24, D, costUsd: 900, blocks: 2, rewardUsd: 1700, tags: ['rede-rapida'] },
    { t: 2, ph: 26.244, hours: 24, D, costUsd: 900, blocks: 0, rewardUsd: 0, tags: ['rede-lenta'] },
    { t: 3, ph: 26.244, hours: 12, D, costUsd: 450, blocks: 1, rewardUsd: 850, tags: ['rede-rapida', 'burst'] }
  ];
  const r = M.summarize(s);
  close(r.lambda, 2.5, 1e-3);
  assert.equal(r.blocks, 3);
  close(r.luck, 1.2, 1e-3);
  close(r.net, 2550 - 2250);
  close(r.pAsGood, M.probAtLeast(3, r.lambda));
  const t = M.byTag(s);
  assert.deepEqual(t.map((x) => x.tag), ['burst', 'rede-lenta', 'rede-rapida']);
  assert.equal(t.find((x) => x.tag === 'rede-rapida').blocks, 3);
  const csv = M.sessionsToCSV(s);
  assert.ok(csv.split('\n')[0].startsWith('id,inicio'));
  assert.ok(csv.includes('rede-rapida|burst'));
});

test('investimento × retorno: Poisson exato', () => {
  const cpb = 900, net = 870;          // custo médio por bloco e bloco líquido
  const a = M.investment(900, cpb, net);
  close(a.lambda, 1);
  assert.equal(a.kProfit, 2);          // 1 bloco (870) não paga 900: precisa de 2
  close(a.pProfit, M.probAtLeast(2, 1));
  close(a.pLossAll, Math.exp(-1));
  close(a.expectedNet, 870 - 900);
  close(a.roiPct, (870 / 900 - 1) * 100);
  // com edge negativo, investir mais deixa o prejuízo mais provável
  const big = M.investment(90000, cpb, net);
  assert.ok(big.pProfit < 0.45 && big.pProfit < M.investment(9000, cpb, net).pProfit + 0.2);
  // com edge positivo, investir mais deixa o lucro mais provável
  const g1 = M.investment(2000, 800, 870), g2 = M.investment(50000, 800, 870);
  assert.ok(g2.pProfit > g1.pProfit && g2.pProfit > 0.7, `${g1.pProfit} ${g2.pProfit}`);
  assert.ok(a.p10 <= a.p50 && a.p50 <= a.p90);
});

test('Poisson estável com λ grande', () => {
  let s = 0; for (let k = 0; k < 2000; k++) s += M.poissonPmf(k, 800); close(s, 1, 1e-9);
  close(M.poissonQuantile(0.5, 800), 800, 2);
});

test('simulação: parar no bloco não muda o retorno esperado por dólar', () => {
  const base = { sessions: 10, budget: 300, cpb: 900, blockNet: 870, runs: 20000, seed: 7 };
  const stop = M.simulateSessions(Object.assign({ stopOnBlock: true }, base));
  const cont = M.simulateSessions(Object.assign({ stopOnBlock: false }, base));
  // retorno por dólar ≈ 870/900 nos dois casos (Wald)
  close((stop.mean + stop.avgSpent) / stop.avgSpent, 870 / 900, 0.02);
  close((cont.mean + cont.avgSpent) / cont.avgSpent, 870 / 900, 0.02);
  // parar no bloco gasta menos em média
  assert.ok(stop.avgSpent < cont.avgSpent);
  // mesma semente, mesmo resultado
  assert.equal(M.simulateSessions(Object.assign({ stopOnBlock: true }, base)).mean, stop.mean);
});
