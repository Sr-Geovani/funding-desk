// Testes do laboratório de novas frentes (base, P2P, Boros, Pendle PT). Rodar: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { basisOf, p2pOf, borosOf, pendleOf, labStep, labSummary, LAB_RULES, cdiBar, bfxOf, borosRealized, p2pMerchant } from '../worker/src/lab.js';

const T = Date.UTC(2026, 10, 4, 12);

test('base: anualiza o prêmio do futuro e desconta o custo de ida e volta', () => {
  const r = basisOf([{ instrument_name: 'BTC-25DEC26', mark_price: 101, estimated_delivery_price: 100, open_interest: 5 }, { instrument_name: 'BTC-PERPETUAL', mark_price: 100, estimated_delivery_price: 100 }], T);
  assert.equal(r.length, 1);
  const days = (Date.UTC(2026, 11, 25, 8) - T) / 864e5;
  assert.ok(Math.abs(r[0].apr - 1 * 365 / days) < 0.01);
  assert.ok(Math.abs(r[0].netApr - 0.7 * 365 / days) < 0.01);
  assert.equal(basisOf([{ instrument_name: 'BTC-5NOV26', mark_price: 101, estimated_delivery_price: 100 }], T).length, 0, 'vence em menos de 2 dias');
});

test('P2P: usa só anúncios que aceitam R$500 e mostra que comprar e vender na hora perde o spread', () => {
  const sell = [{ price: '5.50', minAmount: '100', maxAmount: '2000' }, { price: '5.40', minAmount: '1000', maxAmount: '5000' }];
  const buy = [{ price: '5.46', minAmount: '50', maxAmount: '900' }];
  const r = p2pOf(sell, buy, 5.45);
  assert.equal(r.ask, 5.5); assert.equal(r.bid, 5.46);
  assert.ok(r.crossPct < 0); assert.ok(r.spreadPct > 0.7 && r.spreadPct < 0.75);
  assert.equal(p2pOf([], buy, 5.45), null);
});

test('Boros: diferença fixo − flutuante, liquidez mínima e mercados fora de cripto descartados', () => {
  const mk = (sym, mark, fl, oi, extra) => ({ config: { status: 2 }, imData: { symbol: sym }, metadata: Object.assign({ platformName: 'Binance' }, extra), data: { markApr: mark, floatingApr: fl, notionalOI: oi, assetMarkPrice: 1, timeToMaturity: 86400 * 30 } });
  const r = borosOf({ results: [mk('BTCUSDT-BN', 0.05, 0.11, 50000), mk('ETH-tiny', 0.2, 0.05, 10), mk('OIL-X', 0.3, 0.1, 1e6)] });
  assert.equal(r.length, 2);
  assert.equal(r[0].gapPp, -6); assert.equal(r[0].liquid, true); assert.equal(r[0].days, 30);
  assert.equal(r[1].liquid, false);
});

test('Pendle: separa stablecoin de primeira linha das exóticas e compara com a Aave', () => {
  const mk = (name, apy, liq, days) => ({ name, expiry: new Date(T + days * 864e5).toISOString(), details: { impliedApy: apy, liquidity: liq } });
  const r = pendleOf([['Ethereum', { markets: [mk('sUSDS', 0.06, 4e6, 21), mk('sUSDfr', 0.26, 2e6, 60), mk('stETH', 0.03, 9e6, 60), mk('USDC', 0.05, 5e5, 60), mk('GHO', 0.05, 2e6, 7)] }]], 4.8, T);
  assert.deepEqual(r.map((x) => x.name), ['sUSDS', 'sUSDfr'], 'blue primeiro; ETH, pouca liquidez e prazo curto ficam fora');
  assert.equal(r[0].blue, true); assert.equal(r[1].blue, false); assert.equal(r[0].gapPp, 1.2); assert.equal(r[0].l1, true);
});

test('laboratório: conta acertos, abre papel só para o que passa da regra e fecha no vencimento', () => {
  const exp = T + 30 * 864e5, futExp = new Date(Date.UTC(2026, 11, 25));
  const deribit = [{ instrument_name: 'BTC-25DEC26', mark_price: 103, estimated_delivery_price: 100 }];
  const pendle = [['Ethereum', { markets: [{ name: 'sUSDe', expiry: new Date(exp).toISOString(), details: { impliedApy: 0.09, liquidity: 5e6 } }, { name: 'xUSD', expiry: new Date(exp).toISOString(), details: { impliedApy: 0.3, liquidity: 5e6 } }] }]];
  const r1 = labStep(null, { now: T, deribit, pendle, aaveApy: 5, cdiPct: 13.65 });
  assert.equal(r1.lab.counts.basis.hits, 1); assert.equal(r1.lab.counts.pendle.hits, 1); assert.equal(r1.lab.counts.p2p.n, 1); assert.equal(r1.lab.counts.p2p.hits, 0);
  assert.equal(r1.lab.paper.open.length, 2, 'base + PT de primeira linha; a exótica não entra');
  assert.ok(r1.lab.paper.open.every((o) => !/xUSD/.test(o.key)));
  assert.equal(r1.events.length, 2);
  const pt = r1.lab.paper.open.find((o) => o.kind.startsWith('PT'));
  assert.ok(Math.abs(pt.lockedUsd - 500 * 0.09 * 30 / 365) < 0.01);
  const r2 = labStep(r1.lab, { now: T + 900e3, deribit, pendle, aaveApy: 5 });
  assert.equal(r2.lab.paper.open.length, 2, 'não duplica a posição'); assert.equal(r2.events.length, 0);
  const r3 = labStep(r2.lab, { now: exp + 1, deribit: [], pendle: [], aaveApy: 5 });
  assert.equal(r3.lab.paper.closed.length, 1); assert.match(r3.events.join(' '), /venceu/);
  const s = labSummary(r3.lab);
  assert.equal(s.samples, 3); assert.ok(Math.abs(s.hitPct.basis - 200 / 3) < 1e-9);
  assert.ok(s.paper.lockedUsd > 0); assert.ok(futExp > T);
  assert.equal(labSummary(null), null);
});

test('laboratório: série limitada', () => {
  let L = null;
  const rules = Object.assign({}, LAB_RULES, { keepSeries: 3 });
  for (let i = 0; i < 5; i++) L = labStep(L, { now: T + i * 900e3, aaveApy: 5, rules }).lab;
  assert.equal(L.series.length, 3); assert.equal(L.series[0][0], T + 2 * 900e3);
});

test('régua do CDI: CDB líquido de IR e quanto o dólar precisa render bruto para empatar', () => {
  const b = cdiBar(13.65);
  assert.equal(b.cdbNetPct, 11.26); assert.equal(b.usdGrossNeedPct, 13.25);
});

test('Bitfinex: taxa diária vira taxa ao ano; papel "picos" só empresta quando a taxa negociada chega na oferta', () => {
  const tk = (last) => [0.0003, 0.00023, 120, 1, 0.000133, 3, 1, 0, 0, last];
  const x = bfxOf(tk(0.000133), [[0, 0, 0, 0.00014, 0, 0]]);
  assert.equal(x.lastApr, 4.85); assert.equal(x.hiApr, 5.11); assert.equal(x.bidDays, 120);
  let L = labStep(null, { now: T, bfx: tk(0.000133), bfxCandles: [[0, 0, 0, 0.00014, 0, 0]], aaveApy: 5 }).lab;
  assert.equal(L.bfxPaper.sempre.loans, 1); assert.equal(L.bfxPaper.picos.loans, 0);
  const r = labStep(L, { now: T + 900e3, bfx: tk(0.0002), bfxCandles: [[0, 0, 0, 0.0005, 0, 0]], aaveApy: 5 }); L = r.lab; // pico de 18% ao ano
  assert.equal(L.bfxPaper.picos.loans, 1); assert.equal(L.bfxPaper.picos.apr, 16); assert.match(r.events.join(' '), /Bitfinex/);
  L = labStep(L, { now: T + 3 * 864e5, bfx: tk(0.000133), bfxCandles: [[0, 0, 0, 0.00014, 0, 0]], aaveApy: 5 }).lab;
  const s = labSummary(L).bfxPaper;
  assert.ok(Math.abs(s.picos.earnedUsd - 500 * 0.16 * 2 / 365 * 0.85) < 0.01, 'juro do pico só conta depois de vencer, já sem os 15% da corretora');
  assert.ok(s.sempre.earnedUsd > 0);
});

test('Boros: compara o fixo de cada hora com o flutuante que aconteceu depois', () => {
  const a = []; for (let h = 0; h <= 24 * 9; h++) a.push([T + h * 3600e3, 8, 11]); // fixo 8%, flutuante realizado 11%
  const r = borosRealized({ 'BTC-X': a }, 7);
  assert.ok(r.n > 40); assert.equal(r.avgPp, 3); assert.equal(r.payWinPct, 100);
  assert.equal(borosRealized({ 'BTC-X': a.slice(0, 100) }, 7).n, 0, 'sem 7 dias de história depois, não conta');
});

test('P2P como comerciante: compra no bid e revende no ask h horas depois', () => {
  const S = []; for (let i = 0; i < 40; i++) S.push([T + i * 900e3, 0, 0, 0, 0, 0, 0, 5.52 + (i % 2 ? 0.01 : 0), 5.49]);
  const m = p2pMerchant(S, 1);
  assert.ok(m.n >= 30); assert.equal(m.winPct, 100); assert.ok(m.avgPct > 0.5 && m.avgPct < 0.75);
  const down = S.map((r, i) => [r[0], 0, 0, 0, 0, 0, 0, 5.52 - i * 0.01, 5.49 - i * 0.01]);
  assert.ok(p2pMerchant(down, 6).avgPct < 0, 'dólar caindo no giro come o spread');
});
