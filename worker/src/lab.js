// Laboratório de novas frentes (levantamento de 30 dias, sem capital), como recomendado na pesquisa de 04/11:
// 1) base spot × futuro (Deribit), 2) P2P USDT/BRL (Bybit), 3) funding com taxa fixa (Pendle Boros),
// 4) juros fixos de stablecoin (Pendle PT) contra empréstimo (Aave). Coleta a cada 15 min na varredura, grava a série,
// conta as oportunidades executáveis (já com custos) e simula em papel as que travam o retorno (base e PT).
// Regra do projeto: nenhuma frente vira operação real por APR anunciado; só com histórico de lucro líquido repetido.
export const LAB_RULES = { basisMinNetApr: 10, basisFeesPct: 0.3, pendleMinGapPp: 2, pendleMinLiqUsd: 1e6, borosMinGapPp: 5, borosMinOiUsd: 10000,
  p2pMinNetPct: 0.8, paperUsd: 500, keepSeries: 3000,
  // régua: CDB 100% CDI com IR de 17,5% (1 a 2 anos); rendimento em plataforma no exterior paga 15% de IR (Lei 14.754/2023)
  cdbIrPct: 17.5, abroadIrPct: 15,
  // Bitfinex: a corretora fica com 15% dos juros; papel B só empresta quando a taxa passa do que bate o CDB depois de taxa e IR
  bfxFeePct: 15, bfxSpikeApr: 16, bfxDays: 2, boHistKeep: 900 };
const STABLE = /usd|dai|gho|frax|usde|usdai|usdc|usdt|crvusd|lusd|pyusd/i;
// stablecoins de primeira linha (emissor grande, histórico longo); o resto é "exótica": juros altos = prêmio de risco
const BLUE = /^(s?usdc|s?usdt|s?dai|s?usds|s?gho|s?usde|pyusd|crvusd|s?frax|scrvusd|sdai|susde|usdc\.e)$/i;

// Base: prêmio anualizado do futuro sobre o índice, menos custo de montar e desmontar (spot + futuro, ida e volta).
export function basisOf(rows, now, rules = LAB_RULES) {
  return (rows || []).filter((r) => /-\d{1,2}[A-Z]{3}\d{2}$/.test(r.instrument_name || '') && r.mark_price > 0 && r.estimated_delivery_price > 0).map((r) => {
    const m = /-(\d{1,2})([A-Z]{3})(\d{2})$/.exec(r.instrument_name), mon = 'JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC'.indexOf(m[2]) / 3;
    const exp = Date.UTC(2000 + +m[3], mon, +m[1], 8), days = (exp - now) / 864e5;
    if (!(days > 2)) return null;
    const prem = (r.mark_price / r.estimated_delivery_price - 1) * 100, apr = prem * 365 / days, net = (prem - rules.basisFeesPct) * 365 / days;
    return { inst: r.instrument_name, days: +days.toFixed(1), premPct: +prem.toFixed(3), apr: +apr.toFixed(2), netApr: +net.toFixed(2), oiUsd: r.open_interest || 0, exp };
  }).filter(Boolean).sort((a, b) => b.netApr - a.netApr);
}

// P2P: melhor preço para comprar USDT (anúncio de venda) e para vender (anúncio de compra), com tamanho real (≥ R$500).
export function p2pOf(sellAds, buyAds, ptax) {
  const ok = (i) => +i.minAmount <= 500 && +i.maxAmount >= 500 && +i.price > 0;
  const ask = (sellAds || []).filter(ok).map((i) => +i.price).sort((a, b) => a - b)[0] || null, bid = (buyAds || []).filter(ok).map((i) => +i.price).sort((a, b) => b - a)[0] || null;
  if (!ask || !bid) return null;
  const mid = (ask + bid) / 2;
  return { ask, bid, spreadPct: +((ask - bid) / mid * 100).toFixed(3), crossPct: +((bid - ask) / ask * 100).toFixed(3), premPtaxPct: ptax ? +((mid / ptax - 1) * 100).toFixed(3) : null };
}

// Boros: taxa fixa negociada (mark) contra a flutuante; só mercados com posição aberta ou volume.
export function borosOf(res, rules = LAB_RULES) {
  return ((res && res.results) || []).filter((m) => m.config && m.config.status === 2 && m.data).map((m) => {
    const d = m.data, md = m.metadata || {}, fixed = d.markApr * 100, fl = d.floatingApr * 100;
    return { sym: m.imData && m.imData.symbol, venue: md.platformName, asset: md.assetSymbol, spread: !!md.isSpreadMarket, fixed: +fixed.toFixed(2), floating: +fl.toFixed(2),
      gapPp: +(fixed - fl).toFixed(2), oiUsd: Math.round((d.notionalOI || 0) * (d.assetMarkPrice || 1)), vol24: Math.round((d.volume24h || 0) * (d.assetMarkPrice || 1)),
      days: d.timeToMaturity ? +(d.timeToMaturity / 86400).toFixed(1) : null, liquid: (d.notionalOI || 0) * (d.assetMarkPrice || 1) >= rules.borosMinOiUsd };
  }).filter((x) => x.sym && !/OIL|GOLD|xyz/i.test(x.sym));
}

// Pendle PT de stablecoin: juros fixos até o vencimento, contra o empréstimo de USDC na Aave.
export function pendleOf(lists, aaveApy, now, rules = LAB_RULES) {
  const out = [];
  for (const [chain, j] of lists) for (const m of (j && j.markets) || []) {
    const d = m.details || {}, exp = Date.parse(m.expiry), days = (exp - now) / 864e5;
    if (!STABLE.test(m.name || '') || !(d.impliedApy > 0) || !(d.liquidity >= rules.pendleMinLiqUsd) || !(days >= 14 && days <= 400)) continue;
    const apy = d.impliedApy * 100;
    out.push({ name: m.name, chain, days: +days.toFixed(0), apy: +apy.toFixed(2), liqUsd: Math.round(d.liquidity), gapPp: aaveApy !== null ? +(apy - aaveApy).toFixed(2) : null, exp, blue: BLUE.test(String(m.name || '').trim()), l1: chain === 'Ethereum' });
  }
  return out.sort((a, b) => (b.blue - a.blue) || (b.apy - a.apy)).slice(0, 14);
}

// Papel: base e PT travam o retorno até o vencimento; abre uma posição de US$500 quando passa da regra, uma por instrumento.
function paperOpen(paper, key, kind, apr, days, now, exp, rules) {
  if (paper.open.some((o) => o.key === key) || paper.open.length >= 6) return null;
  const o = { key, kind, apr, days, start: now, exp, usd: rules.paperUsd, lockedUsd: +(rules.paperUsd * apr / 100 * days / 365).toFixed(2) };
  paper.open.push(o); return o;
}

// Régua do CDI depois do imposto: quanto um rendimento em dólar precisa render (bruto) para empatar, sem contar o câmbio.
export function cdiBar(cdiPct, rules = LAB_RULES) {
  const cdi = cdiPct || 13.65, net = cdi * (1 - rules.cdbIrPct / 100);
  return { cdiPct: cdi, cdbNetPct: +net.toFixed(2), usdGrossNeedPct: +(net / (1 - rules.abroadIrPct / 100)).toFixed(2) };
}

// Bitfinex (empréstimo de dólar): taxa do dia × 365. Ticker fUSD: [FRR, BID, BID_PERIOD, BID_SIZE, ASK, ASK_PERIOD, ASK_SIZE, ..., LAST(9)].
export function bfxOf(tk, candles) {
  if (!Array.isArray(tk) || !(tk[9] > 0)) return null;
  const apr = (r) => +(r * 365 * 100).toFixed(2), hi = Array.isArray(candles) && candles.length ? Math.max(...candles.map((c) => c[3] || 0)) : null;
  return { frrApr: apr(tk[0]), bidApr: apr(tk[1]), bidDays: tk[2], askApr: apr(tk[4]), lastApr: apr(tk[9]), hiApr: hi ? apr(hi) : null };
}

// Papel na Bitfinex com US$500: A = sempre emprestado a 2 dias na taxa negociada; B = oferta parada na taxa de pico (só é tomada
// se a taxa negociada chegar nela); ninguém conta o juro antes de o empréstimo vencer. Taxa de 15% da corretora já descontada.
function bfxPaperStep(Q, x, now, rules) {
  const book = (k) => Q[k] || (Q[k] = { since: now, earnedUsd: 0, loans: 0, until: 0, apr: null, lentMs: 0, last: now });
  const step = (k, take) => {
    const b = book(k); if (b.until && b.until > b.last) b.lentMs += Math.min(now, b.until) - b.last; b.last = now;
    if (b.until && now >= b.until && b.pendingUsd) { b.earnedUsd += b.pendingUsd; b.pendingUsd = 0; }
    if (now >= b.until && x) { const r = take(); if (r) { b.apr = r.apr; b.until = now + r.days * 864e5; b.pendingUsd = rules.paperUsd * r.apr / 100 * r.days / 365 * (1 - rules.bfxFeePct / 100); b.loans++; return r; } }
    return null;
  };
  step('sempre', () => ({ apr: x.lastApr, days: rules.bfxDays }));
  return step('picos', () => (x.hiApr !== null && x.hiApr >= rules.bfxSpikeApr ? { apr: rules.bfxSpikeApr, days: rules.bfxDays } : null));
}
function bfxPaperSum(Q, now, rules) {
  const o = {};
  for (const [k, b] of Object.entries(Q || {})) { const yrs = Math.max(1 / 365, (now - b.since) / 365 / 864e5); o[k] = { earnedUsd: +b.earnedUsd.toFixed(2), loans: b.loans, aprRealized: +(b.earnedUsd / rules.paperUsd / yrs * 100).toFixed(2), lentPct: +(b.lentMs / Math.max(1, now - b.since) * 100).toFixed(0), days: +((now - b.since) / 864e5).toFixed(1), lentNow: b.until > now ? b.apr : null }; }
  return o;
}

// Boros: guarda fixo e flutuante de hora em hora (BTC e ETH, mercados líquidos) para responder a pergunta certa:
// o fixo de hoje erra o funding que acontece depois? flutuante médio realizado − fixo > 0: quem paga fixo ganhou; < 0: quem recebe fixo.
function borosHistStep(H, BO, now, rules) {
  H = H || {};
  for (const b of BO.filter((x) => x.liquid && !x.spread && /BTC|ETH/i.test(x.sym))) {
    const a = H[b.sym] || (H[b.sym] = []);
    if (!a.length || now - a[a.length - 1][0] >= 3540e3) a.push([now, b.fixed, b.floating]);
    if (a.length > rules.boHistKeep) a.splice(0, a.length - rules.boHistKeep);
  }
  for (const k of Object.keys(H)) if (!H[k].length || now - H[k][H[k].length - 1][0] > 3 * 864e5) delete H[k];
  return H;
}
export function borosRealized(H, days) {
  let n = 0, sum = 0, pay = 0; const by = {};
  for (const [k, a] of Object.entries(H || {})) {
    const pre = [0]; for (const r of a) pre.push(pre[pre.length - 1] + r[2]);
    let kn = 0, ks = 0, j = 0;
    for (let i = 0; i < a.length; i++) {
      const end = a[i][0] + days * 864e5; if (a[a.length - 1][0] < end) break;
      if (j < i + 1) j = i + 1; while (j < a.length && a[j][0] <= end) j++;
      const c = j - (i + 1); if (c < days * 24 * 0.6) continue;
      const d = (pre[j] - pre[i + 1]) / c - a[i][1]; kn++; ks += d; n++; sum += d; if (d > 0) pay++;
    }
    if (kn) by[k] = { n: kn, avgPp: +(ks / kn).toFixed(2) };
  }
  return { days, n, avgPp: n ? +(sum / n).toFixed(2) : null, payWinPct: n ? Math.round(pay / n * 100) : null, by };
}

// P2P como comerciante: compra USDT pelo anúncio de compra (bid) e revende depois pelo anúncio de venda (ask) h horas mais tarde.
// Mede se o spread paga a variação do dólar no tempo do giro (sem contar golpe, devolução de Pix e o trabalho manual).
export function p2pMerchant(series, hours) {
  const S = (series || []).filter((r) => r[7] > 0 && r[8] > 0); let n = 0, sum = 0, win = 0, worst = null, j = 0;
  for (let i = 0; i < S.length; i++) {
    const target = S[i][0] + hours * 3600e3; if (j < i) j = i; while (j < S.length && S[j][0] < target) j++;
    if (j >= S.length) break; if (S[j][0] - target > 1800e3) continue;
    const r = (S[j][7] / S[i][8] - 1) * 100; n++; sum += r; if (r > 0) win++; if (worst === null || r < worst) worst = r;
  }
  return { hours, n, avgPct: n ? +(sum / n).toFixed(3) : null, winPct: n ? Math.round(win / n * 100) : null, worstPct: worst === null ? null : +worst.toFixed(3) };
}

export function labStep(prev, { now, deribit, p2p, boros, pendle, aaveApy, ptax, cdiPct, errs, bfx, bfxCandles, pendleCache, rules = LAB_RULES }) {
  const L = prev && prev.since ? JSON.parse(JSON.stringify(prev)) : { since: now, series: [], counts: {}, paper: { open: [], closed: [] } };
  const events = [];
  const B = basisOf(deribit, now, rules), P = p2p ? p2pOf(p2p.sell, p2p.buy, ptax) : null, BO = borosOf(boros, rules), PE = pendleOf(pendle || [], aaveApy, now, rules);
  const c = (k, on) => { const x = L.counts[k] || (L.counts[k] = { n: 0, hits: 0 }); x.n++; if (on) x.hits++; };
  const bBest = B[0] || null, PEb = PE.filter((x) => x.blue), boLiq = BO.filter((x) => x.liquid && !x.spread), boRecv = boLiq.slice().sort((a, b) => b.gapPp - a.gapPp)[0] || null, boPay = boLiq.slice().sort((a, b) => a.gapPp - b.gapPp)[0] || null, peBest = PEb.slice().sort((a, b) => b.apy - a.apy)[0] || null;
  c('basis', bBest && bBest.netApr >= rules.basisMinNetApr);
  c('p2p', P && P.crossPct >= rules.p2pMinNetPct);
  c('borosRecebeFixo', boRecv && boRecv.gapPp >= rules.borosMinGapPp);
  c('borosPagaFixo', boPay && -boPay.gapPp >= rules.borosMinGapPp);
  c('pendle', peBest && peBest.gapPp !== null && peBest.gapPp >= rules.pendleMinGapPp);
  // papel
  for (const b of B.filter((x) => x.netApr >= rules.basisMinNetApr)) { const o = paperOpen(L.paper, 'basis:' + b.inst, 'Base ' + b.inst, b.netApr, b.days, now, b.exp, rules); if (o) events.push(`Laboratório (papel): base ${b.inst} travaria ${b.netApr.toFixed(1).replace('.', ',')}% ao ano líquido por ${Math.round(b.days)} dias (US$${o.lockedUsd.toFixed(2).replace('.', ',')} em US$500)`); }
  for (const p of PEb.filter((x) => x.gapPp !== null && x.gapPp >= rules.pendleMinGapPp).sort((a, b) => b.apy - a.apy).slice(0, 2)) { const o = paperOpen(L.paper, 'pt:' + p.name + ':' + p.exp, 'PT ' + p.name, p.apy, p.days, now, p.exp, rules); if (o) events.push(`Laboratório (papel): PT ${p.name} travaria ${p.apy.toFixed(1).replace('.', ',')}% ao ano por ${p.days} dias (US$${o.lockedUsd.toFixed(2).replace('.', ',')} em US$500; Aave paga ${aaveApy !== null ? aaveApy.toFixed(1).replace('.', ',') : '—'}%${p.l1 ? '; na rede Ethereum o custo de transação pesa abaixo de ~US$5.000' : ''})`); }
  L.paper.open = L.paper.open.filter((o) => { if (now >= o.exp) { L.paper.closed.push(Object.assign(o, { end: now, resultUsd: o.lockedUsd })); events.push(`Laboratório (papel): ${o.kind} venceu: +US$${o.lockedUsd.toFixed(2).replace('.', ',')}`); return false; } return true; });
  L.paper.closed = L.paper.closed.slice(-50);
  L.boHist = borosHistStep(L.boHist, BO, now, rules);
  const BX = bfxOf(bfx, bfxCandles); L.bfxPaper = L.bfxPaper || {};
  const got = bfxPaperStep(L.bfxPaper, BX, now, rules);
  if (got) events.push(`Laboratório (papel): Bitfinex emprestaria US$500 a ${got.apr.toFixed(1).replace('.', ',')}% ao ano por ${got.days} dias (pico da taxa; a média hoje é ${BX.lastApr.toFixed(1).replace('.', ',')}%)`);
  c('bitfinexPico', BX && BX.hiApr !== null && BX.hiApr >= rules.bfxSpikeApr);
  L.series.push([now, bBest ? bBest.netApr : null, P ? P.spreadPct : null, P ? P.premPtaxPct : null, boRecv ? boRecv.gapPp : null, peBest ? peBest.apy : null, aaveApy, P ? P.ask : null, P ? P.bid : null, BX ? BX.lastApr : null, BX ? BX.hiApr : null]);
  if (L.series.length > rules.keepSeries) L.series.splice(0, L.series.length - rules.keepSeries);
  L.now = { at: now, basis: B.slice(0, 6), p2p: P, boros: BO.sort((a, b) => Math.abs(b.gapPp) - Math.abs(a.gapPp)).slice(0, 10), pendle: PE.slice(0, 8), aaveApy, cdiPct, bar: cdiBar(cdiPct, rules), bfx: BX, errs: errs && Object.keys(errs).length ? errs : null,
    pendleRaw: (pendle || []).map(([c, j]) => c + ':' + (j && j.markets ? j.markets.length : 'vazio')).join(' ') || 'sem leitura' };
  if (pendleCache) L.pendleCache = pendleCache;
  L.now.pendleAt = pendleCache ? pendleCache.at : null;
  L.lastTs = now;
  return { lab: L, events };
}

// Resumo do levantamento: médias da série e frequência das oportunidades executáveis.
export function labSummary(L) {
  if (!L) return null;
  const S = L.series || [], avg = (i) => { const v = S.map((r) => r[i]).filter((x) => x !== null && isFinite(x)); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };
  const pct = (k) => (L.counts[k] && L.counts[k].n ? L.counts[k].hits / L.counts[k].n * 100 : null);
  const locked = (L.paper.open || []).reduce((a, o) => a + o.lockedUsd, 0) + (L.paper.closed || []).reduce((a, o) => a + (o.resultUsd || 0), 0);
  return { since: L.since, days: L.lastTs ? (L.lastTs - L.since) / 864e5 : 0, samples: S.length, now: L.now,
    avg: { basisNetApr: avg(1), p2pSpreadPct: avg(2), p2pPremPtaxPct: avg(3), borosGapPp: avg(4), pendleApy: avg(5), aaveApy: avg(6) },
    hitPct: { basis: pct('basis'), p2p: pct('p2p'), borosRecebeFixo: pct('borosRecebeFixo'), borosPagaFixo: pct('borosPagaFixo'), pendle: pct('pendle'), bitfinexPico: pct('bitfinexPico') },
    paper: { open: L.paper.open, closed: (L.paper.closed || []).slice(-10), lockedUsd: locked },
    bar: cdiBar(L.now && L.now.cdiPct), avgBfx: { lastApr: avg(9), hiApr: avg(10) }, bfxPaper: bfxPaperSum(L.bfxPaper, L.lastTs || L.since, LAB_RULES),
    borosRealized: [borosRealized(L.boHist, 7), borosRealized(L.boHist, 30)], p2pMerchant: [p2pMerchant(S, 1), p2pMerchant(S, 6)] };
}
