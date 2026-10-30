/* Funding Desk — lógica pura, sem DOM.
   Usado pelo index.html (window.FD) e pelos testes (node --test). */
(function (root) {
'use strict';

var VENUES = ['Binance', 'Bybit', 'Hyperliquid', 'OKX', 'Bitget', 'Gate'];
var HOURS_YEAR = 8760;
var DAY = 864e5, HOUR = 36e5;

// Taxas de tabela, nível básico (% por execução). Editáveis no painel.
var DEFAULT_FEES = {
  Binance:     { maker: 0.02,  taker: 0.05,  spotMaker: 0.1,  spotTaker: 0.1 },
  Bybit:       { maker: 0.02,  taker: 0.055, spotMaker: 0.1,  spotTaker: 0.1 },
  Hyperliquid: { maker: 0.015, taker: 0.045, spotMaker: 0.04, spotTaker: 0.07 },
  OKX:         { maker: 0.02,  taker: 0.05,  spotMaker: 0.08, spotTaker: 0.1 },
  Bitget:      { maker: 0.02,  taker: 0.06,  spotMaker: 0.1,  spotTaker: 0.1 },
  Gate:        { maker: 0.02,  taker: 0.05,  spotMaker: 0.1,  spotTaker: 0.1 }
};

/* ---------- normalização ---------- */
// rate: taxa decimal por intervalo (0.0001 = 0,01%). Retorna % a.a. (APR simples).
function aprFrom(rate, hours) { return rate * (HOURS_YEAR / hours) * 100; }
function rateFromApr(apr, hours) { return apr / 100 / (HOURS_YEAR / hours); }

// Unifica o ticker base: 1000PEPE (Binance/Bybit), kPEPE (Hyperliquid), SHIB1000 (Bybit), 1MBABYDOGE (Binance).
// O multiplicador muda o preço do contrato, não a taxa de funding.
function normBase(b) {
  var m = /^(1000000|100000|10000|1000|1M|k)([A-Z][A-Z0-9]*)$/.exec(b);
  if (m) return m[2];
  m = /^([A-Z][A-Z0-9]*?)1000$/.exec(b);
  if (m) return m[1];
  return b;
}
/* ---------- tipo de ativo (filtro "só cripto") ----------
   Perpétuos de ações, ETFs, índices, metais e commodities têm funding guiado pela bolsa tradicional
   (fecham à noite e no fim de semana, saltam na abertura). A Gate informa o tipo de cada contrato; esta lista
   cobre os mesmos tickers nas outras exchanges e o caso de a Gate não responder. */
var TRADFI = {};
('AAPL AMD AMZN BABA COIN CRCL GOOGL HOOD INTC META MSFT MSTR NFLX NVDA PLTR SAMSUNG SKHYNIX TSLA ORCL AVGO ' +
 'GME MCD JPM V UBER SHOP ARM TSM ASML SMCI RIVN').split(' ').forEach(function (t) { TRADFI[t] = 'ação'; });
'SPY QQQ TQQQ SOXL ARKK IWM GLD SLV'.split(' ').forEach(function (t) { TRADFI[t] = 'ETF'; });
'SPX NDX DJI US30 NAS100 US500'.split(' ').forEach(function (t) { TRADFI[t] = 'índice'; });
'XAU XAG XPT XPD PAXG XAUT GOLD SILVER'.split(' ').forEach(function (t) { TRADFI[t] = 'metal'; });
'CL NG NATGAS BRENT WTI COPPER HG'.split(' ').forEach(function (t) { TRADFI[t] = 'commodity'; });
var GATE_KIND = { stocks: 'ação', commodities: 'commodity', metals: 'metal', indices: 'índice', forex: 'câmbio', etf: 'ETF' };
// Tipo de cada moeda base nos dados lidos: '' = cripto. Usa o que a exchange informa e a lista acima.
function assetKinds(rows) {
  var k = {};
  Object.keys(rows).forEach(function (c) {
    var v = rows[c], found = '';
    Object.keys(v).forEach(function (x) { if (v[x] && v[x].kind) found = v[x].kind; });
    k[c] = found || TRADFI[c] || '';
  });
  return k;
}

// Em colisão (ex.: PEPE e 1000PEPE na mesma exchange) fica o contrato de maior volume.
function put(out, base, row) {
  var b = normBase(base), cur = out[b];
  if (!cur || (row.vol || 0) > (cur.vol || 0)) out[b] = row;
}
function nextHour(now) { return Math.floor(now / HOUR) * HOUR + HOUR; }

/* ---------- parsers (respostas das APIs públicas) ---------- */
// Binance USDⓈ-M: premiumIndex.lastFundingRate é a taxa corrente do período, liquidada em nextFundingTime.
function parseBinance(premium, tickers, fundingInfo, exchangeInfo) {
  var vol = {}, ih = {}, cap = {}, meta = null, out = {};
  (tickers || []).forEach(function (t) { vol[t.symbol] = parseFloat(t.quoteVolume) || 0; });
  (fundingInfo || []).forEach(function (f) {
    if (+f.fundingIntervalHours) ih[f.symbol] = +f.fundingIntervalHours;
    cap[f.symbol] = parseFloat(f.adjustedFundingRateCap);
  });
  if (exchangeInfo && exchangeInfo.symbols) {
    meta = {};
    exchangeInfo.symbols.forEach(function (s) { meta[s.symbol] = s; });
  }
  (premium || []).forEach(function (p) {
    var s = p.symbol;
    if (!/USDT$/.test(s)) return;
    var m = meta && meta[s];
    if (meta && (!m || m.contractType !== 'PERPETUAL' || m.status !== 'TRADING')) return;
    var r = parseFloat(p.lastFundingRate);
    if (!isFinite(r) || p.lastFundingRate === '') return;
    var h = ih[s] || 8;
    put(out, s.slice(0, -4), {
      sym: s, rate: r * 100, apr: aprFrom(r, h), hours: h,
      vol: vol[s] || 0, oi: null, mark: parseFloat(p.markPrice),
      next: +p.nextFundingTime || null, listed: m && m.onboardDate ? +m.onboardDate : null,
      capPct: isFinite(cap[s]) ? cap[s] * 100 : null, src: 'api'
    });
  });
  return out;
}

// Bybit v5 linear: tickers.fundingRate é a taxa do período corrente; fundingInterval (instruments-info) vem em minutos.
function parseBybit(tickers, instruments) {
  var list = tickers && tickers.result ? tickers.result.list : (tickers || []);
  var meta = null, out = {};
  if (instruments && instruments.length) {
    meta = {};
    instruments.forEach(function (i) { meta[i.symbol] = i; });
  }
  list.forEach(function (t) {
    var s = t.symbol;
    if (!/USDT$/.test(s)) return;
    var m = meta && meta[s];
    if (meta && (!m || m.contractType !== 'LinearPerpetual' || m.status !== 'Trading')) return;
    if (t.fundingRate === '' || t.fundingRate === undefined) return;
    var r = parseFloat(t.fundingRate);
    if (!isFinite(r)) return;
    var h = m && +m.fundingInterval ? m.fundingInterval / 60 : (+t.fundingIntervalHour || 8);
    put(out, s.slice(0, -4), {
      sym: s, rate: r * 100, apr: aprFrom(r, h), hours: h,
      vol: parseFloat(t.turnover24h) || 0, oi: parseFloat(t.openInterestValue) || null,
      mark: parseFloat(t.markPrice), next: +t.nextFundingTime || null,
      listed: m && +m.launchTime ? +m.launchTime : null,
      capPct: t.fundingCap ? parseFloat(t.fundingCap) * 100 : null, src: 'api'
    });
  });
  return out;
}

// Hyperliquid: ctx.funding é a taxa horária corrente; paga a cada hora cheia.
function parseHL(d, now) {
  var out = {};
  d[0].universe.forEach(function (u, i) {
    var c = d[1][i];
    if (!c || u.isDelisted) return;
    var r = parseFloat(c.funding);
    if (!isFinite(r)) return;
    var mark = parseFloat(c.markPx);
    put(out, u.name, {
      sym: u.name, rate: r * 100, apr: aprFrom(r, 1), hours: 1,
      vol: parseFloat(c.dayNtlVlm) || 0, oi: (parseFloat(c.openInterest) * mark) || null,
      mark: mark, next: nextHour(now || Date.now()), listed: null, capPct: null,
      maxLev: u.maxLeverage || null, src: 'api'
    });
  });
  return out;
}

// Hyperliquid predictedFundings: previsto de Binance e Bybit para moedas listadas na HL.
// Fonte reserva quando a API da exchange não responde (sem volume, sem listing).
var PF_NAMES = { BinPerp: 'Binance', BybitPerp: 'Bybit', HlPerp: 'Hyperliquid' };
function parsePredicted(d) {
  var out = { Binance: {}, Bybit: {}, Hyperliquid: {} };
  (d || []).forEach(function (e) {
    var coin = e[0];
    (e[1] || []).forEach(function (v) {
      var venue = PF_NAMES[v[0]], x = v[1];
      if (!venue || !x) return;
      var r = parseFloat(x.fundingRate), h = +x.fundingIntervalHours || (venue === 'Hyperliquid' ? 1 : 8);
      if (!isFinite(r)) return;
      put(out[venue], coin, {
        sym: coin, rate: r * 100, apr: aprFrom(r, h), hours: h, vol: null, oi: null, mark: null,
        next: +x.nextFundingTime || null, listed: null, capPct: null, src: 'via HL'
      });
    });
  });
  return out;
}

// OKX (v5): funding-rate?instId=ANY traz todos os perpétuos; tickers?instType=SWAP traz preço e volume (volCcy24h em moeda).
// fundingRate é o do período corrente, liquidado em fundingTime; o intervalo é fundingTime − prevFundingTime.
function parseOKX(funding, tickers) {
  var px = {}, vol = {}, out = {};
  ((tickers && tickers.data) || []).forEach(function (t) {
    var last = parseFloat(t.last);
    px[t.instId] = last; vol[t.instId] = (parseFloat(t.volCcy24h) || 0) * (last || 0);
  });
  ((funding && funding.data) || []).forEach(function (f) {
    var id = f.instId;
    if (!/-USDT-SWAP$/.test(id)) return;
    var r = parseFloat(f.fundingRate);
    if (!isFinite(r) || f.fundingRate === '') return;
    var h = Math.round((+f.fundingTime - +f.prevFundingTime) / HOUR);
    if (!(h >= 1 && h <= 8)) h = 8;
    put(out, id.split('-')[0], {
      sym: id, rate: r * 100, apr: aprFrom(r, h), hours: h, vol: vol[id] || 0, oi: null, mark: px[id] || null,
      next: +f.fundingTime || null, listed: null, capPct: parseFloat(f.maxFundingRate) * 100 || null, src: 'api'
    });
  });
  return out;
}

// Bitget (v2, USDT-FUTURES): current-fund-rate traz taxa, intervalo (h) e próximo pagamento; tickers traz volume em USDT.
function parseBitget(fundRates, tickers) {
  var t = {}, out = {};
  ((tickers && tickers.data) || []).forEach(function (x) { t[x.symbol] = x; });
  ((fundRates && fundRates.data) || []).forEach(function (f) {
    var s = f.symbol;
    if (!/USDT$/.test(s)) return;
    var r = parseFloat(f.fundingRate);
    if (!isFinite(r)) return;
    var h = +f.fundingRateInterval || 8, tk = t[s] || {};
    put(out, s.slice(0, -4), {
      sym: s, rate: r * 100, apr: aprFrom(r, h), hours: h, vol: parseFloat(tk.usdtVolume) || 0, oi: null,
      mark: parseFloat(tk.markPrice) || null, next: +f.nextUpdate || null, listed: null,
      capPct: parseFloat(f.maxFundingRate) * 100 || null, src: 'api'
    });
  });
  return out;
}

// Gate (v4, futures USDT): contracts traz taxa, intervalo (s), próximo pagamento (s) e data de criação; tickers traz volume.
function parseGate(contracts, tickers) {
  var vol = {}, out = {};
  (tickers || []).forEach(function (x) { vol[x.contract] = parseFloat(x.volume_24h_quote) || 0; });
  (contracts || []).forEach(function (c) {
    if (c.in_delisting || !/_USDT$/.test(c.name)) return;
    var r = parseFloat(c.funding_rate);
    if (!isFinite(r)) return;
    var h = (+c.funding_interval || 28800) / 3600;
    put(out, c.name.slice(0, -5), {
      sym: c.name, rate: r * 100, apr: aprFrom(r, h), hours: h, vol: vol[c.name] || 0, oi: null,
      mark: parseFloat(c.mark_price) || null, next: c.funding_next_apply ? c.funding_next_apply * 1000 : null,
      listed: c.create_time ? c.create_time * 1000 : null, capPct: null, src: 'api',
      kind: GATE_KIND[c.contract_type] || (c.contract_type ? c.contract_type : '')
    });
  });
  return out;
}

/* ---------- histórico (pagamentos liquidados) ---------- */
function parseBinanceHist(a) { return (a || []).map(function (x) { return { t: +x.fundingTime, rate: parseFloat(x.fundingRate) }; }); }
function parseBybitHist(d) { return ((d && d.result && d.result.list) || []).map(function (x) { return { t: +x.fundingRateTimestamp, rate: parseFloat(x.fundingRate) }; }); }
function parseHLHist(a) { return (a || []).map(function (x) { return { t: +x.time, rate: parseFloat(x.fundingRate) }; }); }
function parseOKXHist(d) { return ((d && d.data) || []).map(function (x) { return { t: +x.fundingTime, rate: parseFloat(x.realizedRate || x.fundingRate) }; }); }
function parseBitgetHist(d) { return ((d && d.data) || []).map(function (x) { return { t: +x.fundingTime, rate: parseFloat(x.fundingRate) }; }); }
function parseGateHist(a) { return (a || []).map(function (x) { return { t: x.t * 1000, rate: parseFloat(x.r) }; }); }

// Converte pontos {t, rate} em {t, apr, hours}; o intervalo de cada ponto sai da distância até o anterior
// (o intervalo pode ter mudado no período). Se não der para inferir, usa fallbackHours.
function historySeries(points, fallbackHours) {
  var p = points.filter(function (x) { return isFinite(x.t) && isFinite(x.rate); })
    .sort(function (a, b) { return a.t - b.t; });
  return p.map(function (x, i) {
    var ref = i > 0 ? x.t - p[i - 1].t : (p.length > 1 ? p[1].t - p[0].t : NaN);
    var h = Math.round(ref / HOUR);
    if (!(h >= 1 && h <= 8)) h = fallbackHours || 8;
    return { t: x.t, apr: aprFrom(x.rate, h), hours: h, rate: x.rate * 100 };
  });
}
// Valor da série no instante t: o pagamento que liquida o período que contém t.
function valueAt(series, t) {
  for (var i = 0; i < series.length; i++) if (series[i].t >= t) return series[i].apr;
  return null;
}
// Spread por hora (short − long). long null = spot (sem funding).
function spreadSeries(a, b) {
  if (!a.length || (b && !b.length)) return [];
  var start = Math.max(a[0].t - a[0].hours * HOUR, b ? b[0].t - b[0].hours * HOUR : -Infinity);
  var end = Math.min(a[a.length - 1].t, b ? b[b.length - 1].t : Infinity);
  var out = [];
  for (var t = Math.ceil(start / HOUR) * HOUR; t <= end; t += HOUR) {
    var va = valueAt(a, t), vb = b ? valueAt(b, t) : 0;
    if (va !== null && vb !== null) out.push({ t: t, apr: va - vb });
  }
  return out;
}
function seriesStats(s, beApr) {
  if (!s.length) return null;
  var v = s.map(function (x) { return x.apr; });
  var sum = v.reduce(function (a, b) { return a + b; }, 0);
  return {
    n: v.length, mean: sum / v.length, min: Math.min.apply(null, v), max: Math.max.apply(null, v),
    last: v[v.length - 1],
    pctPositive: v.filter(function (x) { return x > 0; }).length / v.length * 100,
    pctAboveBe: isFinite(beApr) ? v.filter(function (x) { return x >= beApr; }).length / v.length * 100 : null
  };
}

/* ---------- modelo de ciclo (projeção) ---------- */
// o: capital, lev, aprNet (% a.a.), days,
//    legFees [% por execução, uma por execução] OU feePct + exec,
//    slipPct (% do notional), fixedUsd (rebalanceamento etc., US$ por ciclo)
function cycle(o) {
  var notional = (o.capital / 2) * o.lev;                  // por perna
  var grossPct = o.aprNet / 365 * o.days;                   // % do notional
  var feeSum = o.legFees ? o.legFees.reduce(function (a, b) { return a + b; }, 0) : (o.feePct || 0) * (o.exec || 0);
  var fixedPct = notional > 0 ? (o.fixedUsd || 0) / notional * 100 : 0;
  var costPct = feeSum + (o.slipPct || 0) + fixedPct;       // % do notional
  var netUsd = notional * (grossPct - costPct) / 100;
  var perDay = o.aprNet / 365;
  return {
    notional: notional, gross: notional * grossPct / 100, cost: notional * costPct / 100,
    feeUsd: notional * feeSum / 100, fixedUsd: o.fixedUsd || 0,
    netUsd: netUsd, netOnCap: o.capital ? netUsd / o.capital * 100 : 0,
    be: perDay > 0 ? costPct / perDay : Infinity,           // dias para pagar os custos
    beApr: o.days > 0 ? costPct / o.days * 365 : Infinity,  // spread mínimo para empatar no ciclo
    perDayUsd: notional * perDay / 100, costPct: costPct
  };
}

function legFee(fees, venue, kind, spot) {
  var f = fees[venue] || {};
  var v = spot ? (kind === 'maker' ? f.spotMaker : f.spotTaker) : (kind === 'maker' ? f.maker : f.taker);
  return isFinite(v) ? v : 0;
}

/* ---------- scanner ---------- */
// p: capital, lev, hold, minVol, minOi, aprCap, mode ('pp'|'sp'), fees, execShort, execLong,
//    slipPct, rebalUsd, sort ('net'|'apr'|'be'), now
function opportunities(rows, p) {
  var out = [], now = p.now || Date.now(), cap = p.aprCap || 1e9;
  function okDepth(r) {
    if (r.vol !== null && r.vol < (p.minVol || 0)) return false;
    if (r.oi !== null && r.oi !== undefined && r.oi < (p.minOi || 0)) return false;
    return true;
  }
  function ageDays(rs) {
    var a = rs.filter(function (r) { return r && r.listed; }).map(function (r) { return (now - r.listed) / DAY; });
    return a.length ? Math.min.apply(null, a) : null;
  }
  Object.keys(rows).forEach(function (c) {
    if (p.cryptoOnly && p.kinds && p.kinds[c]) return;
    var vs = Object.keys(rows[c]);
    if (p.mode === 'sp') {
      vs.forEach(function (s) {
        var a = rows[c][s];
        if (!okDepth(a) || a.apr <= 0) return;
        var fs = legFee(p.fees, s, p.execShort), fl = legFee(p.fees, s, p.execLong, true);
        // spot comprado com metade do capital, perp vendido com a outra metade (1x)
        var m = cycle({ capital: p.capital, lev: 1, aprNet: Math.min(a.apr, cap), days: p.hold,
          legFees: [fs, fs, fl, fl], slipPct: p.slipPct, fixedUsd: 0 });
        out.push({ coin: c, s: s, l: 'Spot', spread: a.apr, vol: a.vol, m: m, rs: a, rl: null, age: ageDays([a]), capped: a.apr > cap });
      });
      return;
    }
    if (vs.length < 2) return;
    vs.sort(function (a, b) { return rows[c][b].apr - rows[c][a].apr; });
    for (var i = 0; i < vs.length; i++) for (var j = vs.length - 1; j > i; j--) {
      var s = vs[i], l = vs[j], a = rows[c][s], b = rows[c][l];
      if (!okDepth(a) || !okDepth(b)) continue;
      var spread = a.apr - b.apr;
      if (spread <= 0) continue;
      var fs = legFee(p.fees, s, p.execShort), fl = legFee(p.fees, l, p.execLong);
      var m = cycle({ capital: p.capital, lev: p.lev, aprNet: Math.min(spread, cap), days: p.hold,
        legFees: [fs, fs, fl, fl], slipPct: p.slipPct, fixedUsd: p.rebalUsd });
      var vol = a.vol === null || b.vol === null ? null : Math.min(a.vol, b.vol);
      out.push({ coin: c, s: s, l: l, spread: spread, vol: vol, m: m, rs: a, rl: b, age: ageDays([a, b]), capped: spread > cap });
    }
  });
  out.sort(function (x, y) {
    if (p.sort === 'apr') return y.spread - x.spread;
    if (p.sort === 'be') return x.m.be - y.m.be;
    return y.m.netOnCap - x.m.netOnCap;
  });
  var seen = {};
  return out.filter(function (o) { if (seen[o.coin]) return false; seen[o.coin] = 1; return true; });
}

/* ---------- posições ---------- */
function currentSpread(rows, pos) {
  var r = rows[normBase(pos.coin)] || rows[pos.coin];
  if (!r || !r[pos.s]) return null;
  if (pos.l === 'Spot') return r[pos.s].apr;
  if (!r[pos.l]) return null;
  return r[pos.s].apr - r[pos.l].apr;
}
// level: 'bad' (sair), 'warn' (atenção), 'ok', 'none' (sem dado)
function positionAlert(cur, pos) {
  if (cur === null || cur === undefined) return { level: 'none', text: 'sem dado ao vivo' };
  if (cur <= 0) return { level: 'bad', text: 'sair: spread inverteu' };
  if (isFinite(pos.beApr) && pos.beApr > 0 && cur < pos.beApr) return { level: 'bad', text: 'abaixo do break-even' };
  if (pos.apr > 0 && cur < pos.apr * 0.4) return { level: 'warn', text: 'spread caiu >60%' };
  return { level: 'ok', text: 'ok' };
}

/* ---------- diário: CSV / JSON ---------- */
var CSV_COLS = ['id', 'moeda', 'short', 'long', 'notional', 'spread_entrada', 'be_spread', 'dias_plano', 'taxas', 'funding', 'taxas_saida', 'pnl', 'entrada', 'saida', 'obs'];
function ensureId(p) { if (!p.id) p.id = String(p.t) + '-' + p.coin; return p; }
function csvCell(v) {
  if (v === null || v === undefined) return '';
  var s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function iso(t) { return t ? new Date(t).toISOString() : ''; }
function toCSV(pos) {
  return CSV_COLS.join(',') + '\n' + pos.map(function (p) {
    ensureId(p);
    return [p.id, p.coin, p.s, p.l, p.notional, p.apr, isFinite(p.beApr) ? p.beApr : '', p.days || '', p.fee, p.funding || 0,
      p.exitFee || 0, p.closed ? p.pnl : '', iso(p.t), iso(p.closed), p.note || ''].map(csvCell).join(',');
  }).join('\n');
}
function parseCSV(text) {
  var rows = [], row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}
function fromCSV(text) {
  var rows = parseCSV(text);
  if (!rows.length) return [];
  var h = rows[0].map(function (x) { return x.trim(); });
  if (h.indexOf('moeda') < 0) throw new Error('CSV sem cabeçalho "moeda"');
  function n(v) { var x = parseFloat(v); return isFinite(x) ? x : 0; }
  return rows.slice(1).map(function (r) {
    var o = {};
    h.forEach(function (k, i) { o[k] = r[i] === undefined ? '' : r[i]; });
    var p = {
      coin: o.moeda.toUpperCase(), s: o.short, l: o.long, notional: n(o.notional), apr: n(o.spread_entrada),
      fee: n(o.taxas), funding: n(o.funding), t: Date.parse(o.entrada) || Date.now()
    };
    if (o.id) p.id = o.id;
    if (o.be_spread !== '' && o.be_spread !== undefined) p.beApr = n(o.be_spread);
    if (o.dias_plano) p.days = n(o.dias_plano);
    if (o.obs) p.note = o.obs;
    if (o.saida) { p.closed = Date.parse(o.saida); p.exitFee = n(o.taxas_saida); p.pnl = o.pnl !== '' ? n(o.pnl) : p.funding - p.fee - p.exitFee; }
    return ensureId(p);
  });
}
function toJSON(pos) {
  return JSON.stringify({ app: 'funding-desk', version: 1, exported: new Date().toISOString(), positions: pos.map(ensureId) }, null, 2);
}
function fromJSON(text) {
  var d = JSON.parse(text), list = Array.isArray(d) ? d : d.positions;
  if (!Array.isArray(list)) throw new Error('JSON sem lista de posições');
  return list.filter(function (p) { return p && p.coin; }).map(ensureId);
}
// Mescla por id; o importado substitui o existente com o mesmo id.
function mergePositions(cur, inc) {
  var idx = {}, out = cur.map(ensureId).slice();
  out.forEach(function (p, i) { idx[p.id] = i; });
  var added = 0, updated = 0;
  inc.forEach(function (p) {
    ensureId(p);
    if (idx[p.id] !== undefined) { out[idx[p.id]] = p; updated++; }
    else { idx[p.id] = out.length; out.push(p); added++; }
  });
  out.sort(function (a, b) { return a.t - b.t; });
  return { list: out, added: added, updated: updated };
}

/* ---------- dados de exemplo (modo sem internet) ---------- */
var DEMO = {
  ENA: { Binance: [24, 8, 60e6], Bybit: [31, 8, 22e6], Hyperliquid: [58, 1, 40e6] },
  WLD: { Binance: [11, 8, 90e6], Bybit: [14, 8, 30e6], Hyperliquid: [39, 1, 28e6] },
  SUI: { Binance: [9, 8, 120e6], Bybit: [10, 8, 45e6], Hyperliquid: [22, 1, 35e6] },
  DOGE: { Binance: [10.9, 8, 300e6], Bybit: [11.5, 8, 90e6], Hyperliquid: [17, 1, 80e6] },
  BTC: { Binance: [7, 8, 4000e6], Bybit: [7.4, 8, 1500e6], Hyperliquid: [11, 1, 900e6] },
  ETH: { Binance: [8.5, 8, 2500e6], Bybit: [9, 8, 900e6], Hyperliquid: [12, 1, 600e6] }
};
function demoData(now) {
  var rows = {};
  Object.keys(DEMO).forEach(function (c) {
    rows[c] = {};
    Object.keys(DEMO[c]).forEach(function (v) {
      var d = DEMO[c][v], h = d[1];
      rows[c][v] = { sym: c, apr: d[0], rate: rateFromApr(d[0], h) * 100, hours: h, vol: d[2], oi: null, mark: 0,
        next: Math.floor(now / (h * HOUR)) * h * HOUR + h * HOUR, listed: null, capPct: null, src: 'exemplo' };
    });
  });
  return rows;
}

var FD = {
  VENUES: VENUES, DEFAULT_FEES: DEFAULT_FEES, HOUR: HOUR, DAY: DAY,
  aprFrom: aprFrom, rateFromApr: rateFromApr, normBase: normBase, nextHour: nextHour,
  parseBinance: parseBinance, parseBybit: parseBybit, parseHL: parseHL, parsePredicted: parsePredicted,
  parseOKX: parseOKX, parseBitget: parseBitget, parseGate: parseGate, TRADFI: TRADFI, assetKinds: assetKinds,
  parseBinanceHist: parseBinanceHist, parseBybitHist: parseBybitHist, parseHLHist: parseHLHist,
  parseOKXHist: parseOKXHist, parseBitgetHist: parseBitgetHist, parseGateHist: parseGateHist,
  historySeries: historySeries, spreadSeries: spreadSeries, seriesStats: seriesStats,
  cycle: cycle, legFee: legFee, opportunities: opportunities,
  currentSpread: currentSpread, positionAlert: positionAlert,
  CSV_COLS: CSV_COLS, toCSV: toCSV, fromCSV: fromCSV, parseCSV: parseCSV, toJSON: toJSON, fromJSON: fromJSON,
  mergePositions: mergePositions, ensureId: ensureId, demoData: demoData
};
if (typeof module !== 'undefined' && module.exports) module.exports = FD;
else root.FD = FD;
})(typeof window !== 'undefined' ? window : globalThis);
