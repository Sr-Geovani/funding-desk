// Testes do laboratório de novas frentes (base, P2P, Boros, Pendle PT). Rodar: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { basisOf, p2pOf, borosOf, pendleOf, labStep, labSummary, LAB_RULES } from '../worker/src/lab.js';

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
