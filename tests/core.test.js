// Testes da lógica pura. Rodar: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const FD = require('../core.js');
const fx = (f) => require(path.join(__dirname, 'fixtures', f));
const close = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || '') + ` esperado ${b}, veio ${a}`);
const NOW = 1793361600000; // 2026-10-30 12:00 UTC

test('aprFrom: rate × 8760 / horas × 100', () => {
  close(FD.aprFrom(0.0001, 8), 10.95);      // 0,01% a cada 8h
  close(FD.aprFrom(0.0001, 4), 21.9);       // mesmo rate em 4h vale o dobro
  close(FD.aprFrom(0.0000125, 1), 10.95);   // 0,00125%/h (padrão da HL) = 0,01%/8h
  close(FD.aprFrom(-0.0005, 8), -54.75);
  close(FD.rateFromApr(FD.aprFrom(0.00037, 4), 4), 0.00037);
});

test('normBase unifica tickers com multiplicador', () => {
  assert.equal(FD.normBase('1000PEPE'), 'PEPE');
  assert.equal(FD.normBase('kPEPE'), 'PEPE');
  assert.equal(FD.normBase('SHIB1000'), 'SHIB');
  assert.equal(FD.normBase('1MBABYDOGE'), 'BABYDOGE');
  assert.equal(FD.normBase('1000000MOG'), 'MOG');
  assert.equal(FD.normBase('1INCH'), '1INCH');
  assert.equal(FD.normBase('KAS'), 'KAS');
  assert.equal(FD.normBase('BTC'), 'BTC');
});

test('cycle(): caso de referência calculado à mão', () => {
  // 1000 de capital, 2x → 1000 por perna. 36,5% a.a. por 3 dias = 0,3% → US$3.
  // custos: 4 × 0,05% + 0,03% = 0,23% → US$2,30. Líquido US$0,70 = 0,07% do capital.
  const m = FD.cycle({ capital: 1000, lev: 2, aprNet: 36.5, days: 3, feePct: 0.05, exec: 4, slipPct: 0.03 });
  close(m.notional, 1000);
  close(m.gross, 3);
  close(m.cost, 2.3);
  close(m.netUsd, 0.7);
  close(m.netOnCap, 0.07);
  close(m.be, 2.3);                     // 0,23% / 0,1% ao dia
  close(m.beApr, 0.23 / 3 * 365);       // 27,98% a.a. para empatar em 3 dias
  close(m.perDayUsd, 1);
});

test('cycle(): taxas por execução e rebalanceamento fixo', () => {
  // short taker 0,05 (abre e fecha), long maker 0,02 → 0,14%; slip 0,03; US$1 em 1000 = 0,1%
  const m = FD.cycle({ capital: 1000, lev: 2, aprNet: 36.5, days: 3, legFees: [0.05, 0.05, 0.02, 0.02], slipPct: 0.03, fixedUsd: 1 });
  close(m.costPct, 0.27);
  close(m.cost, 2.7);
  close(m.feeUsd, 1.4);
  close(m.netUsd, 0.3);
  close(m.be, 2.7);
});

test('cycle(): spread zero ou negativo nunca empata', () => {
  assert.equal(FD.cycle({ capital: 1000, lev: 2, aprNet: 0, days: 3, feePct: 0.05, exec: 4 }).be, Infinity);
  const neg = FD.cycle({ capital: 1000, lev: 2, aprNet: -20, days: 3, feePct: 0.05, exec: 4 });
  assert.equal(neg.be, Infinity);
  assert.ok(neg.netUsd < 0);
});

test('parseBinance: intervalo do fundingInfo, padrão 8h, filtros de contrato', () => {
  const r = FD.parseBinance(fx('binance-premium.synthetic.json'), fx('binance-ticker.synthetic.json'),
    fx('binance-fundinginfo.synthetic.json'), fx('binance-exchangeinfo.synthetic.json'));
  assert.deepEqual(Object.keys(r).sort(), ['BTC', 'ENA', 'PEPE']); // sem trimestral, USDC, nem SETTLING
  assert.equal(r.BTC.hours, 8);
  close(r.BTC.apr, 10.95);
  assert.equal(r.ENA.hours, 4);
  close(r.ENA.apr, 0.0003 * 2190 * 100);
  close(r.ENA.capPct, 2);
  assert.equal(r.PEPE.sym, '1000PEPEUSDT');
  close(r.PEPE.apr, -54.75);
  assert.equal(r.BTC.vol, 15e9);
  assert.equal(r.ENA.listed, 1793000000000);
  assert.equal(r.BTC.next, 1793376000000);
});

test('parseBinance sem exchangeInfo não filtra por status', () => {
  const r = FD.parseBinance(fx('binance-premium.synthetic.json'), [], [], null);
  assert.ok(r.OLD);
  assert.ok(!r.BTCUSDT_261225 && !r['BTCUSDT_2612']);
});

test('parseBybit: fundingInterval em minutos, OI, listing, SHIB1000', () => {
  const r = FD.parseBybit(fx('bybit-tickers.synthetic.json'), fx('bybit-instruments.synthetic.json'));
  assert.deepEqual(Object.keys(r).sort(), ['BTC', 'ENA', 'PEPE', 'SHIB']);
  assert.equal(r.ENA.hours, 4);
  close(r.ENA.apr, 0.0006 * 2190 * 100);
  assert.equal(r.SHIB.hours, 1);
  close(r.SHIB.apr, 0.0002 * 8760 * 100);
  assert.equal(r.BTC.oi, 5e9);
  assert.equal(r.SHIB.listed, 1793200000000);
});

test('parseBybit sem instruments usa 8h', () => {
  const r = FD.parseBybit(fx('bybit-tickers.synthetic.json'), null);
  assert.equal(r.ENA.hours, 8);
});

test('parseHL com resposta real: horário, delistados fora, kPEPE → PEPE', () => {
  const d = fx('hl-meta.real.json');
  const r = FD.parseHL(d, NOW + 60e3);
  assert.deepEqual(Object.keys(r).sort(), ['BTC', 'ETH', 'PEPE', 'SOL']);
  const i = d[0].universe.findIndex((u) => u.name === 'BTC');
  close(r.BTC.apr, parseFloat(d[1][i].funding) * 8760 * 100);
  assert.equal(r.BTC.hours, 1);
  assert.equal(r.BTC.next, NOW + FD.HOUR);
  assert.ok(r.BTC.oi > 0 && r.BTC.vol > 0);
});

test('parsePredicted com resposta real: Binance/Bybit via HL', () => {
  const p = FD.parsePredicted(fx('hl-predicted.real.json'));
  assert.ok(p.Binance.BTC && p.Bybit.BTC && p.Hyperliquid.BTC);
  assert.equal(p.Binance.BTC.src, 'via HL');
  assert.equal(p.Binance.BTC.vol, null);
  close(p.Binance.BTC.apr, FD.aprFrom(p.Binance.BTC.rate / 100, p.Binance.BTC.hours));
  assert.ok(p.Binance.PEPE, 'kPEPE normalizado');
});

test('historySeries infere intervalo e spreadSeries alinha por hora', () => {
  const H = FD.HOUR, t0 = NOW - 24 * H;
  const a = FD.historySeries([0, 8, 16, 24].map((k) => ({ t: t0 + k * H, rate: 0.0003 })), 8); // 8h, 32,85%
  const b = FD.historySeries(Array.from({ length: 25 }, (_, k) => ({ t: t0 + k * H, rate: 0.0000125 })), 1); // 1h, 10,95%
  assert.equal(a[1].hours, 8);
  assert.equal(a[0].hours, 8);
  assert.equal(b[3].hours, 1);
  const s = FD.spreadSeries(a, b);
  assert.ok(s.length >= 24);
  s.forEach((x) => close(x.apr, 32.85 - 10.95, 1e-9));
  const st = FD.seriesStats(s, 15);
  close(st.mean, 21.9, 1e-9);
  assert.equal(st.pctAboveBe, 100);
  assert.equal(st.pctPositive, 100);
});

test('historySeries com histórico real da HL', () => {
  const s = FD.historySeries(FD.parseHLHist(fx('hl-history-btc.real.json')), 1);
  assert.ok(s.length >= 20);
  s.forEach((x) => assert.equal(x.hours, 1));
});

test('opportunities: short no maior, long no menor, filtros e teto', () => {
  const rows = {
    ENA: { Binance: { apr: 24, vol: 60e6, oi: null }, Bybit: { apr: 31, vol: 22e6, oi: 50e6 }, Hyperliquid: { apr: 58, vol: 40e6, oi: 30e6 } },
    BTC: { Binance: { apr: 7, vol: 4e9, oi: null }, Hyperliquid: { apr: 11, vol: 9e8, oi: 1e9 } },
    LOW: { Binance: { apr: 1, vol: 1e6, oi: null }, Hyperliquid: { apr: 300, vol: 1e6, oi: 1e6 } }
  };
  const p = { capital: 1000, lev: 2, hold: 3, minVol: 20e6, minOi: 0, aprCap: 150, mode: 'pp', fees: FD.DEFAULT_FEES,
    execShort: 'taker', execLong: 'taker', slipPct: 0.03, rebalUsd: 1, sort: 'net', now: NOW };
  const o = FD.opportunities(rows, p);
  assert.deepEqual(o.map((x) => x.coin), ['ENA', 'BTC']); // LOW cai no volume
  assert.equal(o[0].s, 'Hyperliquid');
  assert.equal(o[0].l, 'Binance');
  close(o[0].spread, 34);
  // custos: HL taker 0,045×2 + Binance taker 0,05×2 = 0,19 + slip 0,03 + US$1/1000 = 0,1 → 0,32%
  close(o[0].m.costPct, 0.32, 1e-9);
  // teto: spread acima de 150 é limitado no cálculo e sinalizado
  const o2 = FD.opportunities(rows, Object.assign({}, p, { minVol: 0 }));
  const low = o2.find((x) => x.coin === 'LOW');
  assert.ok(low.capped);
  close(low.m.gross, 1000 * 150 / 365 * 3 / 100);
  // OI mínimo exclui onde há dado
  assert.ok(!FD.opportunities(rows, Object.assign({}, p, { minOi: 40e6 })).find((x) => x.coin === 'ENA' && x.s === 'Hyperliquid'));
});

test('opportunities spot+perp: só funding positivo, taxa spot na perna long', () => {
  const rows = { X: { Binance: { apr: 20, vol: 1e8, oi: null }, Bybit: { apr: -5, vol: 1e8, oi: null } } };
  const o = FD.opportunities(rows, { capital: 1000, lev: 2, hold: 3, minVol: 0, aprCap: 150, mode: 'sp', fees: FD.DEFAULT_FEES,
    execShort: 'taker', execLong: 'taker', slipPct: 0.05, rebalUsd: 1, sort: 'net', now: NOW });
  assert.equal(o.length, 1);
  assert.equal(o[0].l, 'Spot');
  close(o[0].m.notional, 500);
  close(o[0].m.costPct, 0.05 * 2 + 0.1 * 2 + 0.05);
});

test('positionAlert: inverteu, abaixo do break-even, queda, ok', () => {
  assert.equal(FD.positionAlert(-1, { apr: 30, beApr: 20 }).level, 'bad');
  assert.equal(FD.positionAlert(15, { apr: 30, beApr: 20 }).level, 'bad');
  assert.equal(FD.positionAlert(25, { apr: 80, beApr: 20 }).level, 'warn');
  assert.equal(FD.positionAlert(40, { apr: 50, beApr: 20 }).level, 'ok');
  assert.equal(FD.positionAlert(null, { apr: 50 }).level, 'none');
  assert.equal(FD.positionAlert(10, { apr: 12 }).level, 'ok'); // posição antiga sem beApr
});

test('currentSpread com Spot e com ticker 1000PEPE', () => {
  const rows = { PEPE: { Binance: { apr: 30 }, Bybit: { apr: 10 } } };
  close(FD.currentSpread(rows, { coin: '1000PEPE', s: 'Binance', l: 'Bybit' }), 20);
  close(FD.currentSpread(rows, { coin: 'PEPE', s: 'Binance', l: 'Spot' }), 30);
  assert.equal(FD.currentSpread(rows, { coin: 'PEPE', s: 'Binance', l: 'OKX' }), null);
});

test('diário: CSV e JSON ida e volta, aspas e vírgulas', () => {
  const pos = [
    { coin: 'ENA', s: 'Hyperliquid', l: 'Bybit', notional: 1000, apr: 34.5, beApr: 28, days: 3, fee: 1.9, funding: 2.1, t: NOW - 3 * FD.DAY, note: 'teste, "um"' },
    { coin: 'BTC', s: 'Binance', l: 'Spot', notional: 500, apr: 12, fee: 1, funding: 0.8, exitFee: 1, pnl: -1.2, t: NOW - 6 * FD.DAY, closed: NOW - 2 * FD.DAY }
  ];
  const back = FD.fromCSV(FD.toCSV(JSON.parse(JSON.stringify(pos))));
  assert.equal(back.length, 2);
  assert.equal(back[0].note, 'teste, "um"');
  assert.equal(back[0].beApr, 28);
  assert.equal(back[1].closed, pos[1].closed);
  close(back[1].pnl, -1.2);
  const j = FD.fromJSON(FD.toJSON(JSON.parse(JSON.stringify(pos))));
  assert.deepEqual(j.map((p) => p.coin), ['ENA', 'BTC']);
  assert.throws(() => FD.fromCSV('a,b\n1,2'));
});

test('mergePositions: por id, sem duplicar', () => {
  const a = [{ coin: 'A', t: 1, fee: 0 }, { coin: 'B', t: 2, fee: 0 }];
  const r = FD.mergePositions(a, [{ coin: 'B', t: 2, fee: 5 }, { coin: 'C', t: 3, fee: 0 }]);
  assert.equal(r.list.length, 3);
  assert.equal(r.added, 1);
  assert.equal(r.updated, 1);
  assert.equal(r.list.find((p) => p.coin === 'B').fee, 5);
});

test('OKX, Bitget e Gate com respostas reais', () => {
  const okx = FD.parseOKX(fx('okx-funding.real.json'), fx('okx-tickers.real.json'));
  assert.ok(okx.BTC && okx.ETH);
  assert.equal(okx.BTC.sym, 'BTC-USDT-SWAP');
  assert.equal(okx.BTC.hours, 8);
  close(okx.BTC.apr, FD.aprFrom(okx.BTC.rate / 100, 8));
  assert.ok(okx.BTC.vol > 1e8 && okx.BTC.next > 0);
  assert.ok(!Object.values(okx).some((r) => /-USD-SWAP$/.test(r.sym)), 'contratos inversos (USD) ficam fora');
  const bg = FD.parseBitget(fx('bitget-fundrate.real.json'), fx('bitget-tickers.real.json'));
  assert.ok(bg.BTC && bg.BTC.vol > 1e8);
  assert.ok(Object.values(bg).some((r) => r.hours !== 8), 'intervalo diferente de 8h vem da API');
  const gt = FD.parseGate(fx('gate-contracts.real.json'), fx('gate-tickers.real.json'));
  assert.ok(gt.BTC && gt.BTC.vol > 1e8);
  assert.equal(gt.BTC.hours, 8);
  assert.ok(gt.BTC.listed > 0 && gt.BTC.next > Date.UTC(2026, 0, 1));
  assert.ok(!fx('gate-contracts.real.json').some((c) => c.in_delisting && gt[c.name.slice(0, -5)] && gt[c.name.slice(0, -5)].sym === c.name), 'contrato em delisting fica fora');
});

test('históricos de OKX, Bitget e Gate', () => {
  assert.deepEqual(FD.parseOKXHist({ data: [{ fundingTime: '1793376000000', fundingRate: '0.0002', realizedRate: '0.0001' }] }), [{ t: 1793376000000, rate: 0.0001 }]);
  assert.deepEqual(FD.parseBitgetHist({ data: [{ fundingTime: '1793376000000', fundingRate: '-0.00001' }] }), [{ t: 1793376000000, rate: -0.00001 }]);
  assert.deepEqual(FD.parseGateHist([{ r: '0.0001', t: 1793376000 }]), [{ t: 1793376000000, rate: 0.0001 }]);
});

test('seis exchanges: taxas padrão e oportunidades entre qualquer par', () => {
  assert.deepEqual(FD.VENUES, ['Binance', 'Bybit', 'Hyperliquid', 'OKX', 'Bitget', 'Gate']);
  FD.VENUES.forEach((v) => assert.ok(FD.DEFAULT_FEES[v].taker > 0));
  const rows = { ETH: { OKX: { apr: 40, vol: 1e9, oi: null }, Gate: { apr: 2, vol: 1e9, oi: null }, Binance: { apr: 10, vol: 1e9, oi: null } } };
  const o = FD.opportunities(rows, { capital: 1000, lev: 2, hold: 3, minVol: 0, aprCap: 150, mode: 'pp', fees: FD.DEFAULT_FEES, execShort: 'taker', execLong: 'taker', slipPct: 0.03, rebalUsd: 1, sort: 'net', now: NOW });
  assert.deepEqual([o[0].s, o[0].l], ['OKX', 'Gate']);
  assert.ok(Object.keys(FD.demoData(NOW).BTC).length === 3, 'dados de exemplo continuam com 3 exchanges');
});

test('filtro só cripto: tipo do ativo pela Gate e pela lista de reserva', () => {
  const gate = FD.parseGate([
    { name: 'NVDA_USDT', funding_rate: '0.0005', funding_interval: 28800, contract_type: 'stocks' },
    { name: 'CL_USDT', funding_rate: '0.0001', funding_interval: 28800, contract_type: 'commodities' },
    { name: 'ETH_USDT', funding_rate: '0.0001', funding_interval: 28800, contract_type: '' }
  ], []);
  assert.equal(gate.NVDA.kind, 'ação'); assert.equal(gate.CL.kind, 'commodity'); assert.equal(gate.ETH.kind, '');
  const rows = { NVDA: { Gate: gate.NVDA, OKX: { apr: 1, vol: 1e9 } }, SOXL: { OKX: { apr: 90, vol: 1e9 }, Bitget: { apr: 1, vol: 1e9 } }, ETH: { Gate: gate.ETH } };
  const k = FD.assetKinds(rows);
  assert.deepEqual(k, { NVDA: 'ação', SOXL: 'ETF', ETH: '' });
  const p = { capital: 1000, lev: 2, hold: 3, minVol: 0, aprCap: 150, mode: 'pp', fees: FD.DEFAULT_FEES, execShort: 'taker', execLong: 'taker', slipPct: 0.03, rebalUsd: 1, sort: 'net', now: NOW };
  assert.ok(FD.opportunities(rows, p).some((o) => o.coin === 'SOXL'));
  assert.ok(!FD.opportunities(rows, Object.assign({ cryptoOnly: true, kinds: k }, p)).some((o) => o.coin === 'SOXL'));
  assert.equal(FD.TRADFI.PAXG, 'metal', 'ouro tokenizado segue o preço do ouro');
});
