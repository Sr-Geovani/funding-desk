// Frentes em observação (pesquisa em docs/pesquisa-frentes.md): só dados públicos, sem chave. Cada frente passiva tem
// um "papel" de US$1.000 que rende a taxa observada, e o CDI corre ao lado no mesmo período, para comparar.
// Nada aqui executa ordem.
export const FRONT_CAPITAL = 1000;
const YEAR = 365 * 864e5;

// Bitfinex margin funding (emprestar USDT): [SÍMBOLO, FRR, BID, BID_PERIOD, BID_SIZE, ASK, ASK_PERIOD, ASK_SIZE, ..., LAST(10)]
// taxa diária. Líquido = último empréstimo fechado × 365 × (1 − 15% da Bitfinex); supõe dinheiro emprestado o tempo todo.
export const BFX_FEE = 0.15;
export function bitfinexOf(tickers) {
  const t = (tickers || []).find((x) => Array.isArray(x) && x[0] === 'fUST');
  if (!t) return null;
  const apr = (x) => (isFinite(x) ? x * 365 * 100 : null);
  const last = apr(t[10]), frr = apr(t[1]);
  return { frrApr: frr, lastApr: last, netApr: last !== null ? last * (1 - BFX_FEE) : null };
}

// Cash-and-carry na Deribit: comprar BTC e vender o futuro com vencimento. Base anualizada do contrato mais perto de
// 90 dias (pelo menos 20 dias); líquido desconta ~0,2% de idas e voltas (compra à vista + futuro), diluído no prazo.
export function deribitBasisOf(summary, now) {
  const fut = (summary || []).filter((x) => x && /^BTC-\d{1,2}[A-Z]{3}\d{2}$/.test(x.instrument_name) && x.estimated_delivery_price > 0 && x.mark_price > 0);
  const M = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  const rows = fut.map((x) => {
    const m = x.instrument_name.match(/^BTC-(\d{1,2})([A-Z]{3})(\d{2})$/), exp = Date.UTC(2000 + +m[3], M[m[2]], +m[1], 8);
    const days = (exp - now) / 864e5;
    return { name: x.instrument_name, days, basisApr: (x.mark_price / x.estimated_delivery_price - 1) * 365 / days * 100 };
  }).filter((r) => r.days >= 20).sort((a, b) => Math.abs(a.days - 90) - Math.abs(b.days - 90));
  if (!rows.length) return null;
  const r = rows[0];
  return { contract: r.name, days: r.days, basisApr: r.basisApr, netApr: r.basisApr - 0.2 * 365 / r.days };
}

export function ethenaOf(j) { const v = j && j.avg30dSusdeYield && +j.avg30dSusdeYield.value; return isFinite(v) ? { apr30: v } : null; }
export function hlpOf(j) { return j && isFinite(+j.apr) ? { apr: +j.apr * 100 } : null; }

// zpool (multipool que paga em BTC): pago de fato nas últimas 24 h, em BTC por H/s por dia. actual_last24h vem em mBTC
// por (mbtc_mh_factor × MH/s) por dia.
export function zpoolOf(status) {
  const per = (a) => (a && isFinite(+a.actual_last24h) && +a.mbtc_mh_factor > 0 ? +a.actual_last24h * 1e-3 / (+a.mbtc_mh_factor * 1e6) : null);
  return status ? { sha256PerH: per(status.sha256), scryptPerH: per(status.scrypt) } : null;
}

// Câmbio: quanto acima do dólar oficial (PTAX de venda) custa comprar USDT/USDC em reais no Mercado Bitcoin.
export function brlOf(mb, ptax) {
  const v = ptax && Array.isArray(ptax.value) && ptax.value.length ? ptax.value[ptax.value.length - 1] : null;
  const p = v ? +v.cotacaoVenda : null;
  const t = (pair) => (Array.isArray(mb) ? mb.find((x) => x.pair === pair) : null);
  const u = t('USDT-BRL'), c = t('USDC-BRL');
  const prem = (x) => (x && p > 0 && +x.sell > 0 ? (+x.sell / p - 1) * 100 : null);
  return { ptax: p, ptaxAt: v ? v.dataHoraCotacao : null, usdtAsk: u ? +u.sell : null, usdcAsk: c ? +c.sell : null, usdtPremPct: prem(u), usdcPremPct: prem(c) };
}
export function cdiOf(sgs) { const v = Array.isArray(sgs) && sgs.length ? +String(sgs[sgs.length - 1].valor).replace(',', '.') : null; return isFinite(v) ? v : null; }

/* ---------- funding com uma perna em DEX de taxa zero (Lighter) ----------
   O endpoint público da Lighter traz a taxa de Binance, Bybit, Hyperliquid e Lighter normalizada por 8 h.
   Taxas: Lighter 0% (maker e taker); demais, maker. Regra igual à validada: diferença acima do empate (3 dias de
   permanência, 4 execuções + 0,03% de deslize) em 24 leituras horárias seguidas. */
export const LT_FEES = { lighter: { maker: 0, taker: 0 }, hyperliquid: { maker: 0.015, taker: 0.045 }, binance: { maker: 0.02, taker: 0.05 }, bybit: { maker: 0.02, taker: 0.055 } };
export function lighterTable(json) {
  const by = {};
  for (const x of (json && json.funding_rates) || []) if (x && x.symbol && LT_FEES[x.exchange] && isFinite(x.rate)) (by[x.symbol] = by[x.symbol] || {})[x.exchange] = +x.rate;
  return by;
}
// A Lighter lista ações, ETFs, câmbio, índices, metais e empresas antes da bolsa: funding guiado por mercado que fecha
// à noite e no fim de semana. A regra validada é de cripto: esses ficam fora do robô.
export const LT_TRADFI = new Set(('AAOI AAPL AMD AMZN ANTHROPIC ARM ASML AUDUSD AVGO AXTI BABA BE BMNR BRENTOIL BYD CBRS CHIP COIN CRCL CRWV CXMT ' +
  'DELL DRAM EURUSD EWY GBPUSD GEV GME GOOGL H100 HOOD HYUNDAIUSD IBM INTC IWM KIOXIA KORU LITE META MINIMAX MRNA MRVL MSFT MSTR MU ' +
  'NATGAS NBIS NOK NOW NVDA NZDUSD OPENAI ORCL OURA PAXG PLTR POPMART QCOM QQQ RKLB SAMSUNGUSD SHEIN SKHY SKHYNIXUSD SMIC SNDK SOXL SOXS ' +
  'SPCX SPX SPY STRC TENCENT TSLA TSM TTWO TUR30 UNITREE US100 US10Y US500 USDCAD USDCHF USDHKD USDJPY USDKRW WDC WTI XAG XAU XCU XIAOMI XPD XPT ZHIPU').split(' '));
export const LT_MIN_OI_USD = 300e3;
// Contratos em aberto (US$) por símbolo na Lighter (/api/v1/orderBooks): filtra mercados rasos.
export function lighterOi(json) {
  const o = {};
  for (const m of (json && json.order_books) || []) if (m && m.symbol && m.market_type === 'perp') o[m.symbol] = +m.open_interest_usd || 0;
  return o;
}
export const ltBe = (a, b) => (2 * (LT_FEES[a].maker + LT_FEES[b].maker) + 0.03) / 3 * 365; // % a.a.
// Linhas no formato do funding simulado (pagamento horário com a taxa normalizada: média correta ao longo dos dias).
export function lighterRows(by, now, oi) {
  const next = Math.floor(now / 3600e3) * 3600e3 + 3600e3, rows = {};
  for (const [c, v] of Object.entries(by)) {
    if (!('lighter' in v) || Object.keys(v).length < 2 || LT_TRADFI.has(c)) continue;
    if (oi && !((oi[c] || 0) >= LT_MIN_OI_USD)) continue;
    rows[c] = {};
    for (const [ex, r] of Object.entries(v)) rows[c][ex] = { rate: r * 100 / 8, apr: r * 3 * 365 * 100, hours: 1, next };
  }
  return rows;
}
// Pares com a Lighter numa das pernas: diferença agora, empate e quantas horas seguidas ficou acima do empate.
export function lighterPairs(rows, streak) {
  const out = [];
  for (const [c, v] of Object.entries(rows)) for (const s of Object.keys(v)) for (const l of Object.keys(v)) {
    if (s === l || (s !== 'lighter' && l !== 'lighter')) continue;
    const key = c + '|' + s + '|' + l, sp = v[s].apr - v[l].apr, be = ltBe(s, l);
    out.push({ key, coin: c, s, l, spread: sp, be, hours: (streak || {})[key] || 0 });
  }
  return out.sort((a, b) => (b.spread - b.be) - (a.spread - a.be));
}
// Uma leitura por hora: soma 1 hora a quem está acima do empate, zera quem caiu. Buraco > 2 h zera tudo.
export function streakStep(prev, pairs, hour) {
  const st = prev && prev.hour !== undefined && hour - prev.hour <= 2 ? prev : { hour, s: {} };
  if (st.hour === hour && prev) return st;
  const s = {};
  for (const p of pairs) if (p.spread >= p.be) s[p.key] = (st.s[p.key] || 0) + 1;
  return { hour, s };
}

/* ---------- papel das frentes passivas: US$1.000 rendendo a taxa observada; CDI no mesmo período ---------- */
export function frontsPaperStep(prev, { rates, cdi, now }) {
  const p = prev && prev.since ? JSON.parse(JSON.stringify(prev)) : { since: now, lastTs: now, f: {}, cdiPct: 0 };
  const dt = Math.min(Math.max(0, now - (p.lastTs || now)), 2 * 3600e3);
  for (const [k, r] of Object.entries(rates || {})) {
    const f = p.f[k] || (p.f[k] = { since: now, usd: 0, cdiPct: 0 });
    if (isFinite(r) && dt > 0) { f.usd += FRONT_CAPITAL * r / 100 * dt / YEAR; f.rate = r; }
    if (isFinite(cdi) && dt > 0) f.cdiPct = ((1 + f.cdiPct / 100) * Math.pow(1 + cdi / 100, dt / YEAR) - 1) * 100;
  }
  p.lastTs = now;
  return p;
}

/* ---------- mineração com equipamento próprio ---------- */
// ASIC de bitcoin: hashprice (US$ por PH/s por dia) pela dificuldade e taxas do BTC, e o lucro por dia de uma máquina
// atual (S21 XP: 270 TH/s, 3,645 kW) conforme o preço da energia. Pool FPPS ~2%. Não inclui compra da máquina.
export const ASIC_REF = { name: 'S21 XP', th: 270, kw: 3.645 };
export const POWER = [['Etiópia (hospedagem)', 0.053], ['Paraguai (hospedagem)', 0.065], ['Brasil residencial', 0.15]];
export function asicOf({ dBtc, feesBtc = 0, btcUsd }) {
  if (!(dBtc > 0 && btcUsd > 0)) return null;
  const hp = 86400e15 / (dBtc * 4294967296) * (3.125 + feesBtc) * btcUsd, rev = hp * ASIC_REF.th / 1000 * 0.98;
  return { hashpriceUsdPh: hp, revUsdDay: rev, breakEvenKwh: rev / (ASIC_REF.kw * 24),
    rows: POWER.map(([where, kwh]) => ({ where, kwh, profitUsdDay: rev - ASIC_REF.kw * 24 * kwh })) };
}
// GPU: moedas que mais pagam por placa de referência da WhatToMine (receita bruta de 24 h, US$/dia), só com liquidez.
export function gpuOf(wtm, btcUsd, minVolBtc = 2) {
  if (!wtm || !wtm.coins || !(btcUsd > 0)) return null;
  const all = Object.entries(wtm.coins).map(([name, c]) => ({ name, tag: c.tag, algo: c.algorithm, usdDay: (+c.btc_revenue24 || +c.btc_revenue || 0) * btcUsd, vol: +c.exchange_rate_vol || 0, lag: !!c.lagging }))
    .filter((c) => c.usdDay > 0 && !c.lag && c.tag !== 'NICEHASH');
  const ok = all.filter((c) => c.vol >= minVolBtc).sort((a, b) => b.usdDay - a.usdDay);
  const ref = all.find((c) => c.tag === 'RVN');
  return { top: ok.slice(0, 5).map(({ name, tag, algo, usdDay, vol }) => ({ name, tag, algo, usdDay, vol })), rvnUsdDay: ref ? ref.usdDay : null };
}

/* ---------- lastro de mercado (dados para comparar, sem filtro) ---------- */
// Ágio do mercado local sobre o dólar: Coreia (Upbit, "kimchi premium"), Brasil (Mercado Bitcoin) e Argentina (dólar
// cripto × oficial, CriptoYa). Referência: BTC/USD na Kraken e câmbio do BCE (Frankfurter).
export function premiumsOf({ upbit, mb, kraken, fx, ars }) {
  const usdBtc = kraken && kraken.result ? +Object.values(kraken.result).find((v) => v && v.c).c[0] : null;
  const r = (fx && fx.rates) || {}, out = { usdBtc, fxDate: fx && fx.date };
  const u = (m) => (Array.isArray(upbit) ? upbit.find((x) => x.market === m) : null);
  const p = (x, ref) => (x > 0 && ref > 0 ? (x / ref - 1) * 100 : null);
  if (r.KRW) out.kr = { btcPct: p(u('KRW-BTC') && u('KRW-BTC').trade_price, usdBtc * r.KRW), usdtPct: p(u('KRW-USDT') && u('KRW-USDT').trade_price, r.KRW) };
  const m = (pair) => (Array.isArray(mb) ? mb.find((x) => x.pair === pair) : null);
  if (r.BRL) out.br = { btcPct: p(m('BTC-BRL') && +m('BTC-BRL').last, usdBtc * r.BRL), usdtPct: p(m('USDT-BRL') && +m('USDT-BRL').last, r.BRL) };
  if (ars && ars.oficial && ars.cripto && ars.cripto.usdt) out.ar = { usdtPct: p(+ars.cripto.usdt.ask, +ars.oficial.price), bluePct: ars.blue ? p(+ars.blue.ask, +ars.oficial.price) : null };
  return out;
}
// Mesmo BTC em corretoras diferentes: maior diferença entre as cotações (em USD e em USDT separadas). Ida e volta a
// mercado custa ~0,2% (2 × 0,1%) mais a transferência.
export function spotSpreadOf(quotes) {
  const g = (q) => { const v = (quotes || []).filter((x) => x.quote === q && x.px > 0); if (v.length < 2) return null;
    const lo = v.reduce((a, b) => (b.px < a.px ? b : a)), hi = v.reduce((a, b) => (b.px > a.px ? b : a));
    return { low: lo.ex, high: hi.ex, pct: (hi.px / lo.px - 1) * 100, n: v.length }; };
  return { usd: g('USD'), usdt: g('USDT'), roundTripPct: 0.2 };
}
// Polymarket: recompensa diária de liquidez nos mercados de maior volume e o rendimento bruto máximo (recompensa ÷
// liquidez no livro, se toda a liquidez dividisse o prêmio; quem fica mais perto do meio do livro leva mais).
export function polymarketOf(markets) {
  const rows = (markets || []).map((m) => {
    const rate = (m.clobRewards || []).reduce((a, r) => a + (+r.rewardsDailyRate || 0), 0), liq = +m.liquidityNum || 0;
    return { q: String(m.question || '').slice(0, 90), rate, liq, aprMax: liq > 0 ? rate / liq * 365 * 100 : null, spread: +m.rewardsMaxSpread || null };
  }).filter((x) => x.rate > 0);
  return { dailyUsd: rows.reduce((a, x) => a + x.rate, 0), markets: rows.length, total: (markets || []).length, top: rows.sort((a, b) => (b.aprMax || 0) - (a.aprMax || 0)).slice(0, 5) };
}
// Rendimentos de referência (DefiLlama, pool por pool): staking e empréstimo de stablecoin.
export const LLAMA_POOLS = { stEth: '747c1d2a-c668-4682-b9f9-296708a3dd90', jitoSol: '0e7d0722-9054-4907-8593-567b353c0900',
  aaveUsdc: 'aa70268e-4b52-42bf-a116-608b370f9501', aaveUsdt: 'f981a304-bb6c-45b8-b0c5-fd2f515ad23a', sUsds: 'd8c4eff5-c8a9-46fc-a888-057c4c668e72' };
export function llamaOf(j) { const p = j && Array.isArray(j.data) ? j.data[0] : null; return p && isFinite(+p.apy) ? { apy: +p.apy, tvlUsd: +p.tvlUsd || null, project: p.project, symbol: p.symbol } : null; }
