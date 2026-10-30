// Testes da inteligência do copiloto. Rodar: node --test tests/*.test.js tests/*.test.mjs
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../insights.js');
const FD = require('../core.js');
const close = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} esperado ${b}, veio ${a}`);
const H = 36e5, NOW = Date.UTC(2026, 9, 30, 18);

const opp = (o) => {
  const m = FD.cycle({ capital: 1000, lev: 2, aprNet: Math.min(o.spread, 150), days: 3, legFees: [0.05, 0.05, 0.05, 0.05], slipPct: 0.03, fixedUsd: 1 });
  return Object.assign({ coin: 'ENA', s: 'Bybit', l: 'Hyperliquid', m, vol: 5e7 }, o);
};

test('cronograma: pagamentos das duas pernas, primeiro recebimento e empate', () => {
  // short Bybit 0,1%/8 h (109,5% a.a.); long HL 0,00125%/h (10,95% a.a.)
  const o = opp({ spread: 98.55, rs: { rate: 0.1, hours: 8, next: NOW + 30 * 60e3 }, rl: { rate: 0.00125, hours: 1, next: NOW + 10 * 60e3 } });
  const p = I.fundingPlan(o, { now: NOW, hold: 3 });
  assert.equal(p.count, 9 + 72);                       // 9 da Bybit (8 h) + 72 da HL (1 h) em 3 dias
  assert.equal(p.first.venue, 'Hyperliquid');          // a perna long paga primeiro (taxa positiva)
  assert.ok(p.first.amount < 0);
  assert.equal(p.firstIncome.venue, 'Bybit');
  close(p.firstIncome.amount, 1000 * 0.001);           // US$1 por pagamento com US$1.000 por perna
  assert.ok(p.soon, 'recebe em menos de 1 h');
  close(p.income, 9 * 1 - 72 * 1000 * 0.0000125, 1e-9);
  assert.ok(p.toBreakEven > 0 && p.timeToBreakEven > 0);
  assert.match(I.planText(p, o, NOW), /Primeiro recebimento: Bybit em 30 min \(~US\$1,00\)/);
});

test('cronograma: spread extremo usa o teto, como a projeção', () => {
  const o = opp({ spread: 300, rs: { rate: 0.2738, hours: 8, next: NOW + H }, rl: null, l: 'Spot' });
  const p = I.fundingPlan(o, { now: NOW, hold: 3, aprCap: 150 });
  close(p.firstIncome.amount, 1000 * 0.002738 * 0.5, 1e-9);
});

test('meta: capital necessário e teto de liquidez', () => {
  const o = opp({ spread: 100 });
  const c = I.capitalForTarget(o, 50, { lev: 2, hold: 3, slipPct: 0.03, rebalUsd: 1 });
  // por US$1 de capital: 2/2 × (100/365×3 − 0,2 − 0,03)/100
  const per = (100 / 365 * 3 - 0.2 - 0.03) / 100;
  close(c.capital, 51 / per, 1e-6);
  close(c.maxCapital, 5e7 * 0.001 * 2 / 2);
  assert.equal(c.feasible, c.capital <= c.maxCapital);
  assert.equal(I.capitalForTarget(opp({ spread: 5 }), 50, { lev: 2, hold: 3, slipPct: 0.03 }), null, 'sem margem não há capital que chegue');
});

test('backtest: só entra acima do break-even e mede o resultado real do ciclo', () => {
  const t0 = NOW - 7 * 24 * H;
  // 4 dias a 60% a.a., depois 3 dias a 0%
  const s = Array.from({ length: 168 }, (_, i) => ({ t: t0 + i * H, apr: i < 96 ? 60 : 0 }));
  const b = I.backtestFunding(s, { holdDays: 1, beApr: 30, notional: 1000, costPct: 0.1 });
  assert.equal(b.n, 96 - 0, 'entradas só nas horas acima do break-even com 24 h de dados depois');
  assert.ok(b.winRate < 100 && b.winRate > 50);
  assert.ok(b.worst < 0 && b.best > 0);
  assert.equal(I.backtestFunding(s.slice(0, 10), { holdDays: 1, beApr: 30, notional: 1000, costPct: 0.1 }), null);
  // acima do break-even só no fim: não há ciclo completo para simular → pico
  const late = Array.from({ length: 168 }, (_, i) => ({ t: t0 + i * H, apr: i > 160 ? 90 : 0 }));
  const bl = I.backtestFunding(late, { holdDays: 1, beApr: 30, notional: 1000, costPct: 0.1 });
  assert.deepEqual(bl, { n: 0, hoursAbove: 7, hours: 168 });
  assert.match(I.backtestText(bl, 1), /Trate como pico/);
  assert.match(I.backtestText({ n: 0, hoursAbove: 0, hours: 168 }, 1), /nunca ficou acima/);
  assert.match(I.backtestText(b, 1), /entradas simuladas/);
});

test('rede: chance do próximo bloco, divisão entre pools e último bloco', () => {
  close(I.nextBlockChance(10, 10), 1 - Math.exp(-1));
  const blocks = [
    { height: 5, time: NOW - 3 * 60e3, miner: null, tag: '/ViaBTC/', difficulty: 1 },
    { height: 4, time: NOW - 20 * 60e3, miner: 'AntPool', tag: '', difficulty: 1 },
    { height: 3, time: NOW - 30 * 60e3, miner: null, tag: 'BlockSniper.ai smart solo', difficulty: 1 },
    { height: 2, time: NOW - 45 * 60e3, miner: 'ViaBTC', tag: '', difficulty: 1 }
  ];
  const sp = I.networkSplit(blocks);
  assert.deepEqual(sp[0], { name: 'ViaBTC', n: 2, pct: 50 });
  assert.ok(sp.some((x) => x.name === 'BlockSniper (solo)'));
  const st = I.lastBlockStory(blocks, NOW);
  assert.equal(st.took, 17); assert.equal(st.pool, 'ViaBTC');
  assert.match(st.text, /não muda a sua chance/);
});

test('mineração: entrar, teto ou esperar, com fatores a favor e contra', () => {
  const base = { minEdgePct: 3, rent: 36, budget: 300, hours: 6, coin: 'BCH' };
  const e = I.miningOutlook(Object.assign({ edgeNow: 6, diffVsAvgPct: -2, price24hPct: 4 }, base));
  assert.equal(e.action, 'entrar');
  close(e.suggestPh, 300 / (36 * 6 / 24));
  assert.match(e.title, /Entre com ~33,3 PH\/s por 6 h/);
  assert.equal(e.pros.length, 3);
  assert.match(e.plus, /dobre a potência/);
  // livro raso nunca recomenda entrar a mercado
  assert.equal(I.miningOutlook(Object.assign({ edgeNow: 6, thin: 2 }, base)).action, 'teto');
  // não compensa agora, mas houve janelas
  const hist = Array.from({ length: 40 }, (_, i) => ({ t: i, v: i < 8 ? 5 : -6 }));
  const t = I.miningOutlook(Object.assign({ edgeNow: -6, hist, bestHour: { h: 3, avg: 2.1 } }, base));
  assert.equal(t.action, 'teto'); assert.equal(t.favPct, 20);
  assert.match(t.text, /compensou em 20% das leituras\. Melhor horário médio: 3h/);
  // quase no empate: ordem com teto
  assert.equal(I.miningOutlook(Object.assign({ edgeNow: -0.5 }, base)).action, 'teto');
  // sem janelas: esperar
  assert.equal(I.miningOutlook(Object.assign({ edgeNow: -8, hist: hist.map((h) => ({ t: h.t, v: -8 })) }, base)).action, 'esperar');
  // reajuste do BTC entra como fator
  const r = I.miningOutlook(Object.assign({ edgeNow: -8, btcRetarget: { changePct: 4, remainingMs: 2 * 864e5 } }, base));
  assert.ok(r.pros.some((x) => /Bitcoin deve reajustar a dificuldade em \+4,0%/.test(x)));
  assert.equal(I.miningOutlook({ edgeNow: NaN }).action, 'sem-dado');
});

test('plano combinado: divide o capital conforme o que compensa', () => {
  const f = { level: 'go', netUsd: 9, hold: 3, capital: 1000, winRate: 80 };
  let a = I.allocation(2000, f, { level: 'no', ratio: 0.9, favPct: 0 });
  assert.equal(a.lines[0].name, 'Funding'); close(a.lines[0].share, 1);
  close(a.lines[0].monthUsd, 9 * 2 * 10 * 0.8);
  a = I.allocation(2000, f, { level: 'go', ratio: 1.05 });
  assert.deepEqual(a.lines.map((l) => [l.name, l.share]), [['Funding', 0.7], ['Mineração', 0.3]]);
  close(a.lines[1].monthUsd, 600 * 0.05);
  a = I.allocation(2000, { level: 'no' }, { level: 'no', ratio: 0.9, favPct: 0 });
  assert.deepEqual(a.lines.map((l) => l.name), ['Em caixa']);
  assert.match(a.summary, /fique em caixa/);
  a = I.allocation(2000, { level: 'no' }, { level: 'no', ratio: 0.9, favPct: 20 });
  assert.ok(a.lines.some((l) => l.name === 'Mineração' && l.share === 0.2));
});
