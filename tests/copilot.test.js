// Testes do copiloto (vereditos em linguagem simples). Rodar: node --test tests/*.test.js tests/*.test.mjs
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../copilot.js');
const FD = require('../core.js');

const opp = (over) => {
  const m = FD.cycle({ capital: 1000, lev: 2, aprNet: over.spread, days: 3, legFees: [0.045, 0.045, 0.05, 0.05], slipPct: 0.03, fixedUsd: 1 });
  return Object.assign({ coin: 'ENA', s: 'Hyperliquid', l: 'Binance', spread: over.spread, m, rs: {}, rl: {}, capped: false, age: null }, over);
};

test('funding: verde quando os custos se pagam em menos de 60% do ciclo', () => {
  // custos 0,32% do notional; 100% a.a. ≈ 0,274%/dia → se pagam em ~1,2 dia de 3
  const o = opp({ spread: 100 });
  const v = C.fundingVerdict(o, { hold: 3 });
  assert.equal(v.level, 'go');
  assert.match(v.title, /Short na Hyperliquid, long na Binance/);
  assert.match(v.why, /100,0% ao ano/);
  assert.match(v.why, /se pagam em/);
  assert.match(v.action, /Pode entrar/);
});

test('funding: no limite quando a margem é apertada, extremo ou pico', () => {
  const tight = opp({ spread: 50 }); // se paga em ~2,3 dias de 3
  assert.equal(C.fundingVerdict(tight, { hold: 3 }).level, 'maybe');
  const ext = C.fundingVerdict(opp({ spread: 300, capped: true }), { hold: 3, aprCap: 150 });
  assert.equal(ext.level, 'maybe');
  assert.match(ext.why, /usa no máximo 150% ao ano/);
  const pico = C.stability({ n: 72, pctAboveBe: 20 });
  const v = C.fundingVerdict(opp({ spread: 100 }), { hold: 3, stab: pico });
  assert.equal(v.level, 'maybe');
  assert.ok(v.risks.some((r) => /pico/.test(r)));
});

test('funding: vermelho quando não cobre as taxas e explica por quê', () => {
  const v = C.fundingVerdict(opp({ spread: 5 }), { hold: 3 });
  assert.equal(v.level, 'no');
  assert.match(v.why, /não cobre as taxas/);
});

test('funding: riscos de listing novo, fonte alternativa e alavancagem', () => {
  const v = C.fundingVerdict(opp({ spread: 100, age: 5, rs: { maxLev: 1 } }), { hold: 3, newDays: 30, src: { Hyperliquid: 'api', Binance: 'via HL' }, lev: 2 });
  assert.equal(v.risks.length, 3);
});

test('estabilidade pelo histórico', () => {
  assert.equal(C.stability({ n: 72, pctAboveBe: 85 }).key, 'estavel');
  assert.equal(C.stability({ n: 72, pctAboveBe: 55 }).key, 'oscila');
  assert.equal(C.stability({ n: 72, pctAboveBe: 10 }).key, 'pico');
  assert.equal(C.stability({ n: 3, pctAboveBe: 90 }), null, 'poucos pontos não bastam');
  assert.equal(C.stability(null), null);
});

test('resumo de funding', () => {
  const ops = [opp({ spread: 100 }), opp({ coin: 'WLD', spread: 50 }), opp({ coin: 'X', spread: 5 })];
  const vs = ops.map((o) => C.fundingVerdict(o, { hold: 3 }));
  const s = C.fundingSummary(ops, vs, { hold: 3 });
  assert.equal(s.level, 'go'); assert.equal(s.count, 1); assert.match(s.text, /Melhor agora: ENA/);
  const none = C.fundingSummary([ops[2]], [vs[2]], { hold: 3 });
  assert.equal(none.level, 'no');
});

test('mineração: veredito, motivo, quando compensa e explicação dos mineradores', () => {
  const v = C.miningVerdict({ coin: 'BCH', revenue: 33.86, rent: 36.37, rentPriceEH: 0.46, breakEvenEH: 0.4181, coinUsd: 291, networkPH: 4200, avgBlockMin: 10, minEdgePct: 3 });
  assert.equal(v.level, 'no');
  assert.match(v.why, /US\$1,07 para cada US\$1/);
  assert.match(v.note, /4\.200 PH\/s/);
  assert.match(v.when, /0,4056 BTC\/EH\/dia/);          // 0,4181 × 0,97
  assert.match(v.when, /BCH subir para US\$322/);        // 291 × 36,37 / (33,86 × 0,97)
  assert.equal(C.miningVerdict({ coin: 'BCH', revenue: 36, rent: 35.5, minEdgePct: 3 }).level, 'maybe');
  assert.equal(C.miningVerdict({ coin: 'BCH', revenue: 40, rent: 35, minEdgePct: 3 }).level, 'go');
  assert.equal(C.miningVerdict({ coin: 'BCH', revenue: 0, rent: 35 }).level, 'none');
});

test('comparação de moedas SHA-256: ordem, variação e veredito', () => {
  const r = C.coinCompare([
    { coin: 'BTC', D: 148.36e12, rewardCoin: 3.125, coinUsd: 77366 },
    { coin: 'BCH', D: 527.94e9, rewardCoin: 3.125, coinUsd: 283.49 },
    { coin: 'BSV', D: 27.06e9, rewardCoin: 3.125, coinUsd: 17.27 },
    { coin: 'XXX', D: 0, rewardCoin: 1, coinUsd: 1 }
  ], { rent: 36.37, poolFeePct: 2, minEdgePct: 3, refPh: 10 });
  assert.deepEqual(r.map((x) => x.coin), ['BSV', 'BCH', 'BTC']);
  assert.equal(r.find((x) => x.coin === 'BTC').variance.key, 'loteria');
  assert.equal(r.find((x) => x.coin === 'BCH').variance.key, 'media');   // ~63 h com 10 PH/s
  assert.equal(r.find((x) => x.coin === 'BSV').variance.key, 'baixa');   // ~3 h com 10 PH/s
  assert.equal(r[0].level, 'go');
  assert.ok(Math.abs(r.find((x) => x.coin === 'BCH').phDaysPerBlock - 26.24) < 0.05);
});

test('jornadas: passos e estado atual', () => {
  const f = C.journey('funding', { goCount: 2, best: 'ENA', openPositions: 1, alerts: 1 });
  assert.equal(f.length, 7);
  assert.equal(f[1].status, 'now'); assert.match(f[1].detail, /2 verdes/);
  assert.equal(f[5].status, 'now');
  const m = C.journey('mining', { level: 'no', mode: 'observe' });
  assert.equal(m[0].status, 'now', 'sem endereço: preparar é o passo atual');
  assert.equal(m[1].status, 'wait');
  assert.match(m[4].detail, /observando/);
  assert.ok(C.GLOSSARY.length >= 12 && C.MOMENTS.funding.length && C.MOMENTS.mining.length);
});

test('formatação pt-BR', () => {
  assert.equal(C.money(1234.5), 'US$1.234,50');
  assert.equal(C.money(-3.2), '-US$3,20');
  assert.equal(C.daysTxt(0.5), '12 h');
  assert.equal(C.hoursTxt(63), '3 dias');
  assert.equal(C.hoursTxt(30), '30,0 h');
  assert.equal(C.hoursTxt(24 * 3000), '8 anos');
});

test('mineração com livro raso não vira "compensa"', () => {
  const v = C.miningVerdict({ coin: 'BCH', revenue: 40, rent: 35, minEdgePct: 3, thin: 2 });
  assert.equal(v.level, 'maybe');
  assert.match(v.note, /Livro da NiceHash raso agora \(2 ordens/);
  const r = C.coinCompare([{ coin: 'BSV', D: 27.06e9, rewardCoin: 3.125, coinUsd: 17.27 }], { rent: 30, poolFeePct: 2, minEdgePct: 3, thin: 2 });
  assert.equal(r[0].level, 'maybe');
});
