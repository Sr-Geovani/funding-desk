// Operações simuladas de funding (Perp × Perp), registradas no ciclo em que a decisão acontece, sem olhar o futuro.
// Regras fixas:
//  - Entrada: oportunidade "Compensa" em 2 leituras seguidas; até 3 abertas ao mesmo tempo, uma por moeda,
//    na ordem do maior líquido projetado. US$1.000 por operação, 2x (US$1.000 por perna).
//  - Pagamentos: no horário de cada exchange, com a taxa prevista na última leitura antes do horário
//    (short recebe a taxa; long paga a taxa). Fonte: previsto da Hyperliquid (Binance, Bybit, Hyperliquid).
//  - Saída: diferença de funding ≤ 0 em 2 leituras seguidas, ou a moeda sumir dos dados por 2 leituras.
//  - Custos: taxa taker nas 4 execuções + 0,03% de deslize (metade na entrada, metade na saída).
export const FUND_RULES = { confirm: 2, exitConfirm: 2, maxOpen: 3, capital: 1000, lev: 2, slipPct: 0.03, keepClosed: 200 };

function legsFeePct(fees, s, l) {
  const t = (v) => (fees[v] && isFinite(fees[v].taker) ? fees[v].taker : 0.05);
  return t(s) + t(l); // % do tamanho, numa ponta (entrada ou saída)
}

// pf: estado anterior; rows: rows[moeda][exchange] = { rate (% por intervalo), apr, hours, next };
// best: oportunidades "Compensa" (key, coin, s, l, spread), já ordenadas. Devolve { pf, events }.
export function fundPaperStep(pf, { rows, best, now, fees, rules = FUND_RULES }) {
  const p = pf && pf.since ? JSON.parse(JSON.stringify(pf)) : { since: now, open: [], closed: [], seen: {}, nextId: 1 };
  const events = [];
  if (!rows) return { pf: p, events };
  const notional = rules.capital / 2 * rules.lev;

  // 1) posições abertas: pagamentos vencidos, diferença atual e regra de saída
  const still = [];
  for (const o of p.open) {
    const cr = rows[o.coin] || {};
    for (const side of ['s', 'l']) {
      const leg = o.legs[side], cur = cr[leg.venue];
      if (leg.next && now >= leg.next && leg.next > (leg.paidAt || 0)) {
        const usd = notional * leg.rate / 100 * (side === 's' ? 1 : -1);
        o.fundingUsd += usd; o.payments++; leg.paidAt = leg.next;
      }
      if (cur) { leg.rate = cur.rate; leg.next = cur.next; }
    }
    const rs = cr[o.legs.s.venue], rl = cr[o.legs.l.venue];
    const spread = rs && rl ? rs.apr - rl.apr : null;
    o.spreadNow = spread;
    if (spread === null) o.missing = (o.missing || 0) + 1; else o.missing = 0;
    o.neg = spread !== null && spread <= 0 ? (o.neg || 0) + 1 : 0;
    const why = o.neg >= rules.exitConfirm ? 'funding virou contra (diferença ≤ 0 em 2 leituras)'
      : o.missing >= rules.exitConfirm ? 'moeda saiu dos dados' : null;
    if (!why) { still.push(o); continue; }
    const exitFee = notional * (legsFeePct(fees, o.s, o.l) + rules.slipPct / 2) / 100;
    const c = Object.assign({}, o, { closedAt: now, reason: why, feesUsd: o.feesUsd + exitFee });
    c.netUsd = c.fundingUsd - c.feesUsd; c.retPct = c.netUsd / rules.capital * 100;
    delete c.legs; delete c.neg; delete c.missing;
    p.closed.push(c);
    events.push(`Funding simulado: saiu de ${o.coin} (short ${o.s}, long ${o.l}) após ${o.payments} pagamentos: ${c.netUsd >= 0 ? '+' : '−'}US$${Math.abs(c.netUsd).toFixed(2)} (${why})`);
  }
  p.open = still;

  // 2) entradas: "Compensa" em 2 leituras seguidas
  const seen = {};
  for (const b of best || []) seen[b.key] = (p.seen[b.key] || 0) + 1;
  p.seen = seen;
  for (const b of best || []) {
    if (p.open.length >= rules.maxOpen) break;
    if (seen[b.key] < rules.confirm || p.open.some((o) => o.coin === b.coin)) continue;
    const cr = rows[b.coin] || {}, rs = cr[b.s], rl = cr[b.l];
    if (!rs || !rl) continue;
    const entryFee = notional * (legsFeePct(fees, b.s, b.l) + rules.slipPct / 2) / 100;
    p.open.push({ id: p.nextId++, key: b.key, coin: b.coin, s: b.s, l: b.l, openedAt: now, notional, entrySpread: rs.apr - rl.apr, spreadNow: rs.apr - rl.apr,
      feesUsd: entryFee, fundingUsd: 0, payments: 0, neg: 0, missing: 0,
      legs: { s: { venue: b.s, rate: rs.rate, next: rs.next }, l: { venue: b.l, rate: rl.rate, next: rl.next } } });
    events.push(`Funding simulado: entrou em ${b.coin} (short ${b.s}, long ${b.l}) com diferença de ${(rs.apr - rl.apr).toFixed(1)}% a.a.`);
  }
  p.closed = p.closed.slice(-rules.keepClosed);
  return { pf: p, events };
}

// Resumo para a tela (todas as fechadas guardadas + abertas).
export function fundPaperSummary(p) {
  if (!p) return null;
  const c = p.closed || [], wins = c.filter((x) => x.netUsd > 0).length;
  const net = c.reduce((a, x) => a + x.netUsd, 0), hours = c.reduce((a, x) => a + (x.closedAt - x.openedAt) / 3600e3, 0);
  const openNet = (p.open || []).reduce((a, x) => a + x.fundingUsd - x.feesUsd, 0);
  return { since: p.since, closed: c.length, wins, netUsd: net, avgHours: c.length ? hours / c.length : 0, open: (p.open || []).length, openNetUsd: openNet };
}
