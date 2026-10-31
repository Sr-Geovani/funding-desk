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
